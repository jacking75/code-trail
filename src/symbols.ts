import * as vscode from 'vscode';

/** 웹뷰로 넘길 수 있는 직렬화된 심볼 정보. */
export interface ResolvedSymbol {
    /** 심볼 이름 (예: "ProcessPacket") */
    name: string;
    /** 언어 서버가 준 부가 설명 (시그니처 등). 없을 수 있다. */
    detail: string;
    /**
     * 이 심볼을 감싸는 클래스/네임스페이스 이름. 없으면 빈 문자열.
     * 함수 노드에서는 표시하지 않는다 — 클래스를 직접 펼쳤을 때만 보여준다.
     */
    container: string;
    /** vscode.SymbolKind 숫자값 */
    kind: number;
    /** 대상 파일 URI 문자열 */
    uri: string;
    /** 저장소 루트 디렉터리 이름부터 시작하는 경로 */
    relPath: string;
    /** 절대경로(표시용) */
    fsPath: string;
    /** 언어 ID (하이라이팅용) */
    languageId: string;
    /** 본문 코드 */
    code: string;
    /** code의 첫 줄이 원본 파일에서 몇 번째 줄인지 (0-based) */
    startLine: number;
    /** 심볼 이름이 위치한 줄 (0-based). 에디터로 점프할 때 사용 */
    anchorLine: number;
    /** 심볼 이름이 위치한 컬럼 (0-based) */
    anchorChar: number;
    /** 본문 범위 전체를 못 구하고 주변 N줄로 대체했는지 여부 */
    approximate: boolean;
    /** 함수/메서드/클래스처럼 "구현"이라는 개념이 있는 심볼인지 */
    callable: boolean;
    /**
     * 몸통 없이 선언만 있는지.
     * C# 인터페이스 메서드, C++ 순수 가상 함수, Go 인터페이스 메서드,
     * Rust 트레이트의 기본 구현 없는 메서드가 여기 해당한다.
     */
    declarationOnly: boolean;
}

const MAX_TOTAL_LINES_HARD_CAP = 4000;

/** Roslyn 등이 "Foo(int) : Task<T>" 형태로 주는 이름에서 식별자만 뽑는다. */
export function shortName(name: string): string {
    const cut = name.indexOf('(');
    return cut > 0 ? name.slice(0, cut).trim() : name;
}

/**
 * 표시용 경로. 저장소 루트 디렉터리 이름부터 시작해 끝까지 전부 담는다.
 * 멀티 루트 워크스페이스에서 어느 저장소의 파일인지도 이걸로 구분된다.
 */
function relPathOf(uri: vscode.Uri): string {
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    if (!ws) {
        // 워크스페이스 밖의 파일(시스템 헤더, 외부 패키지 등)은 절대경로를 그대로 둔다.
        return uri.fsPath.replace(/\\/g, '/');
    }
    const rel = uri.fsPath
        .slice(ws.uri.fsPath.length)
        .replace(/^[\\/]/, '')
        .replace(/\\/g, '/');
    return rel ? `${ws.name}/${rel}` : ws.name;
}

type AnySymbol = vscode.DocumentSymbol | vscode.SymbolInformation;

function isDocumentSymbol(s: AnySymbol): s is vscode.DocumentSymbol {
    return (s as vscode.DocumentSymbol).children !== undefined
        || (s as vscode.DocumentSymbol).selectionRange !== undefined;
}

interface FlatSymbol {
    name: string;
    detail: string;
    /** 감싸는 클래스/네임스페이스 이름 */
    container: string;
    kind: vscode.SymbolKind;
    range: vscode.Range;
    selectionRange: vscode.Range;
    depth: number;
}

function flatten(
    symbols: AnySymbol[] | undefined,
    depth = 0,
    out: FlatSymbol[] = [],
    parentName = '',
): FlatSymbol[] {
    if (!symbols) {
        return out;
    }
    for (const s of symbols) {
        if (isDocumentSymbol(s)) {
            out.push({
                name: s.name,
                // DocumentSymbol.detail 은 LSP 정의상 시그니처 같은 부가 설명이다.
                detail: s.detail ?? '',
                container: parentName,
                kind: s.kind,
                range: s.range,
                selectionRange: s.selectionRange ?? s.range,
                depth,
            });
            flatten(s.children, depth + 1, out, shortName(s.name));
        } else {
            const si = s as vscode.SymbolInformation;
            // SymbolInformation 의 containerName 은 감싸는 클래스 이름이다.
            // 예전에는 이걸 detail 에 넣어서 함수 헤더에 클래스명이 딸려 나왔다.
            out.push({
                name: si.name,
                detail: '',
                container: si.containerName ?? '',
                kind: si.kind,
                range: si.location.range,
                selectionRange: si.location.range,
                depth,
            });
        }
    }
    return out;
}

async function documentSymbols(uri: vscode.Uri): Promise<FlatSymbol[]> {
    try {
        const raw = await vscode.commands.executeCommand<AnySymbol[]>(
            'vscode.executeDocumentSymbolProvider',
            uri,
        );
        return flatten(raw);
    } catch {
        return [];
    }
}

/**
 * 범위가 좁은 것을 앞으로. 같으면 더 깊은 것을 앞으로.
 *
 * depth 만으로 정렬하면 안 된다. 언어 서버가 계층 없는 SymbolInformation 을 주면
 * 클래스도 메서드도 전부 depth 0 이고 selectionRange 가 심볼 전체 범위라서,
 * 메서드를 클릭했는데 그 메서드를 감싸는 클래스가 먼저 걸려 나온다.
 * (클래스 코드가 통째로 펼쳐지고, 정작 함수 본문은 잘려 보이던 원인이다.)
 */
function narrower(a: FlatSymbol, b: FlatSymbol): number {
    const la = a.range.end.line - a.range.start.line;
    const lb = b.range.end.line - b.range.start.line;
    if (la !== lb) {
        return la - lb;
    }
    if (a.depth !== b.depth) {
        return b.depth - a.depth;
    }
    return 0;
}

/**
 * position을 감싸는 심볼 중 "본문을 보여주기에 적절한" 것을 고른다.
 *
 * 가장 깊은 심볼이 항상 정답은 아니다. 예를 들어 클래스 안의 메서드를 클릭하면
 * 메서드를 보여줘야 하지만, 필드 변수를 클릭하면 그 필드 한 줄만 보여주는 게 맞다.
 * 그래서 position을 감싸는 것 중 가장 좁은 심볼을 쓴다.
 */
function pickEnclosing(symbols: FlatSymbol[], position: vscode.Position): FlatSymbol | undefined {
    const containing = symbols.filter((s) => s.range.contains(position));
    if (containing.length === 0) {
        return undefined;
    }
    containing.sort(narrower);
    return containing[0];
}

/**
 * 커서를 감싸는 심볼 중 "몸통이 있는" 가장 안쪽 것.
 *
 * 함수 안에 커서를 두고 탐색을 시작했는데 언어 서버가 지역 변수까지 심볼로
 * 보고하는 경우, 가장 좁은 심볼은 그 변수 한 줄이 된다. 그때는 함수를 보여줘야 한다.
 */
function pickEnclosingBody(symbols: FlatSymbol[], position: vscode.Position): FlatSymbol | undefined {
    const containing = symbols.filter((s) => s.range.contains(position));
    if (containing.length === 0) {
        return undefined;
    }
    const bodies = containing.filter((s) => isBodyKind(s.kind));
    const pool = bodies.length > 0 ? bodies : containing;
    pool.sort(narrower);
    return pool[0];
}

/** 정의 위치(선언 이름 위치)와 정확히 맞아떨어지는 심볼을 찾는다. */
function pickByDeclaration(symbols: FlatSymbol[], position: vscode.Position): FlatSymbol | undefined {
    // 1) selectionRange(이름 부분)가 position을 포함하는 것 우선
    const byName = symbols.filter((s) => s.selectionRange.contains(position));
    if (byName.length > 0) {
        byName.sort(narrower);
        return byName[0];
    }
    // 2) 없으면 범위로
    return pickEnclosing(symbols, position);
}

/**
 * 언어 서버가 심볼의 range 를 한 줄만 준 경우(일부 C++ 서버) 본문 끝을 추정한다.
 *
 * 자체 파서를 두지 않는다는 원칙을 지키려고, 중괄호를 세는 대신 언어 서버가 준
 * 문서 심볼 목록만 쓴다. "이 심볼보다 뒤에서 시작하는, 이 심볼의 자식이 아닌
 * 가장 가까운 심볼" 바로 앞 줄을 본문의 끝으로 본다.
 * 그 경계조차 없으면(파일 마지막 심볼 등) contextLines 만큼만 보여준다.
 */
function guessBodyEnd(
    all: FlatSymbol[],
    sym: FlatSymbol,
    lineCount: number,
    contextLines: number,
): number {
    const startLine = sym.range.start.line;
    let boundary = -1;
    for (const s of all) {
        if (s === sym || s.range.start.line <= startLine) {
            continue;
        }
        // 이 심볼 안쪽(지역 변수 등)은 경계가 아니다.
        if (s.depth > sym.depth) {
            continue;
        }
        if (boundary === -1 || s.range.start.line < boundary) {
            boundary = s.range.start.line;
        }
    }
    const end = boundary > startLine ? boundary - 1 : startLine + contextLines;
    return Math.max(startLine, Math.min(lineCount - 1, end));
}

function sliceCode(doc: vscode.TextDocument, range: vscode.Range): { code: string; startLine: number } {
    const startLine = range.start.line;
    let endLine = range.end.line;
    if (endLine - startLine > MAX_TOTAL_LINES_HARD_CAP) {
        endLine = startLine + MAX_TOTAL_LINES_HARD_CAP;
    }
    const lines: string[] = [];
    for (let i = startLine; i <= endLine && i < doc.lineCount; i++) {
        lines.push(doc.lineAt(i).text);
    }
    // 공통 들여쓰기 제거는 하지 않는다. 원본 그대로 보여야 위치 계산이 단순해진다.
    return { code: lines.join('\n'), startLine };
}

async function buildResolved(
    doc: vscode.TextDocument,
    sym: FlatSymbol | undefined,
    fallbackPosition: vscode.Position,
    fallbackName: string,
    allSymbols: FlatSymbol[] = [],
    /** 언어 서버가 LocationLink 로 알려준 전체 범위. 있으면 가장 정확하다. */
    hintRange?: vscode.Range,
): Promise<ResolvedSymbol> {
    const contextLines = vscode.workspace
        .getConfiguration('codeTrail')
        .get<number>('contextLines', 40);

    const hintSpansBody = (from: number): boolean =>
        hintRange !== undefined
        && hintRange.start.line <= from
        && hintRange.end.line > from;

    let range: vscode.Range;
    let approximate = false;
    let name = fallbackName;
    let detail = '';
    let container = '';
    let kind: vscode.SymbolKind = vscode.SymbolKind.Null;
    let anchor = fallbackPosition;

    if (sym) {
        range = sym.range;
        name = sym.name || fallbackName;
        detail = sym.detail;
        container = sym.container;
        kind = sym.kind;
        anchor = sym.selectionRange.start;
        // 언어 서버가 한 줄짜리 range만 준 경우(일부 C++ 서버)에는 보정한다.
        if (range.start.line === range.end.line && isBodyKind(kind)) {
            const end = hintSpansBody(range.start.line)
                ? Math.min(doc.lineCount - 1, (hintRange as vscode.Range).end.line)
                : guessBodyEnd(allSymbols, sym, doc.lineCount, contextLines);
            range = new vscode.Range(range.start.line, 0, end, doc.lineAt(end).text.length);
            approximate = true;
        }
    } else {
        const start = Math.max(0, fallbackPosition.line);
        const end = hintSpansBody(start)
            ? Math.min(doc.lineCount - 1, (hintRange as vscode.Range).end.line)
            : Math.min(doc.lineCount - 1, start + contextLines);
        range = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
        approximate = true;
    }

    const { code, startLine } = sliceCode(doc, range);
    const callable = isBodyKind(kind);

    return {
        name,
        detail,
        container,
        kind,
        uri: doc.uri.toString(),
        relPath: relPathOf(doc.uri),
        fsPath: doc.uri.fsPath,
        languageId: doc.languageId,
        code,
        startLine,
        anchorLine: anchor.line,
        anchorChar: anchor.character,
        approximate,
        callable,
        // 중괄호가 하나도 없으면 몸통이 없는 선언으로 본다.
        // C#/C++/Rust는 물론 Go 인터페이스 메서드까지 이 규칙으로 잡힌다.
        declarationOnly: callable && !approximate && !code.includes('{'),
    };
}

function isBodyKind(kind: vscode.SymbolKind): boolean {
    return (
        kind === vscode.SymbolKind.Function ||
        kind === vscode.SymbolKind.Method ||
        kind === vscode.SymbolKind.Constructor ||
        kind === vscode.SymbolKind.Class ||
        kind === vscode.SymbolKind.Struct ||
        kind === vscode.SymbolKind.Interface ||
        kind === vscode.SymbolKind.Enum ||
        kind === vscode.SymbolKind.Namespace ||
        kind === vscode.SymbolKind.Module
    );
}

interface NormalizedLocation {
    uri: vscode.Uri;
    /** 정의된 이름의 위치 */
    selection: vscode.Position;
    /** 언어 서버가 알려준 전체 범위 (있으면) */
    fullRange?: vscode.Range;
}

function normalizeLocations(
    result: (vscode.Location | vscode.LocationLink)[] | undefined,
): NormalizedLocation[] {
    if (!result) {
        return [];
    }
    const out: NormalizedLocation[] = [];
    for (const r of result) {
        if ('targetUri' in r) {
            const link = r as vscode.LocationLink;
            out.push({
                uri: link.targetUri,
                selection: (link.targetSelectionRange ?? link.targetRange).start,
                fullRange: link.targetRange,
            });
        } else {
            const loc = r as vscode.Location;
            out.push({ uri: loc.uri, selection: loc.range.start });
        }
    }
    return out;
}

export type ResolveMode = 'definition' | 'implementation' | 'typeDefinition';

const COMMAND_BY_MODE: Record<ResolveMode, string> = {
    definition: 'vscode.executeDefinitionProvider',
    implementation: 'vscode.executeImplementationProvider',
    typeDefinition: 'vscode.executeTypeDefinitionProvider',
};

/**
 * 주어진 위치의 심볼 정의를 찾아 본문까지 담아 돌려준다.
 * 후보가 여러 개면 사용자에게 고르게 한다.
 */
export async function resolveAt(
    uri: vscode.Uri,
    position: vscode.Position,
    mode: ResolveMode = 'definition',
): Promise<ResolvedSymbol | undefined> {
    let locations: NormalizedLocation[] = [];

    const tryModes: ResolveMode[] =
        mode === 'definition' ? ['definition', 'typeDefinition'] : [mode, 'definition'];

    for (const m of tryModes) {
        try {
            const raw = await vscode.commands.executeCommand<
                (vscode.Location | vscode.LocationLink)[]
            >(COMMAND_BY_MODE[m], uri, position);
            locations = normalizeLocations(raw);
        } catch {
            locations = [];
        }
        if (locations.length > 0) {
            break;
        }
    }

    if (locations.length === 0) {
        return undefined;
    }

    let chosen = locations[0];
    if (locations.length > 1) {
        const picked = await pickLocation(locations);
        if (!picked) {
            return undefined;
        }
        chosen = picked;
    }

    const doc = await vscode.workspace.openTextDocument(chosen.uri);
    const symbols = await documentSymbols(chosen.uri);
    let sym = pickByDeclaration(symbols, chosen.selection);

    // 언어 서버가 문서 심볼을 못 주는데 LocationLink로 전체 범위를 준 경우
    if (!sym && chosen.fullRange && chosen.fullRange.end.line > chosen.fullRange.start.line) {
        const wordRange = doc.getWordRangeAtPosition(chosen.selection);
        sym = {
            name: wordRange ? doc.getText(wordRange) : '(unknown)',
            detail: '',
            container: '',
            kind: vscode.SymbolKind.Null,
            range: chosen.fullRange,
            selectionRange: new vscode.Range(chosen.selection, chosen.selection),
            depth: 0,
        };
    }

    const wordRange = doc.getWordRangeAtPosition(chosen.selection);
    const fallbackName = wordRange ? doc.getText(wordRange) : '(unknown)';
    return buildResolved(doc, sym, chosen.selection, fallbackName, symbols, chosen.fullRange);
}

/**
 * 이 선언을 실제로 구현하는 곳들을 전부 찾는다.
 *
 * 인터페이스 메서드나 순수 가상 함수를 클릭하면 선언만 나오는데,
 * 정작 보고 싶은 건 그걸 구현한 클래스의 몸통이다. 그 간극을 메우는 용도다.
 */
export async function resolveImplementationsAt(
    uri: vscode.Uri,
    position: vscode.Position,
): Promise<ResolvedSymbol[]> {
    const seen = new Set<string>();
    const collected: NormalizedLocation[] = [];

    for (const cmd of ['vscode.executeImplementationProvider', 'vscode.executeReferenceProvider']) {
        let locs: NormalizedLocation[] = [];
        try {
            const raw = await vscode.commands.executeCommand<
                (vscode.Location | vscode.LocationLink)[]
            >(cmd, uri, position);
            locs = normalizeLocations(raw);
        } catch {
            locs = [];
        }
        for (const l of locs) {
            // 선언 자기 자신은 제외
            if (l.uri.toString() === uri.toString() && l.selection.line === position.line) {
                continue;
            }
            const key = `${l.uri.toString()}#${l.selection.line}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            collected.push(l);
        }
        // implementation provider가 답을 줬으면 references까지 갈 필요 없다
        if (collected.length > 0) {
            break;
        }
    }

    const out: ResolvedSymbol[] = [];
    for (const loc of collected.slice(0, 25)) {
        try {
            const doc = await vscode.workspace.openTextDocument(loc.uri);
            const symbols = await documentSymbols(loc.uri);
            const sym = pickByDeclaration(symbols, loc.selection);
            const wr = doc.getWordRangeAtPosition(loc.selection);
            const resolved = await buildResolved(
                doc, sym, loc.selection, wr ? doc.getText(wr) : '(unknown)',
                symbols, loc.fullRange,
            );
            // 또 다른 선언(다른 인터페이스에서 상속 등)은 구현이 아니므로 뒤로 민다
            out.push(resolved);
        } catch {
            /* 열 수 없는 위치는 건너뛴다 */
        }
    }
    // 몸통 있는 것부터 보여준다
    out.sort((a, b) => Number(a.declarationOnly) - Number(b.declarationOnly));
    return out;
}

async function pickLocation(locations: NormalizedLocation[]): Promise<NormalizedLocation | undefined> {
    const items = locations.map((l) => ({
        label: `${relPathOf(l.uri)}:${l.selection.line + 1}`,
        description: l.uri.fsPath,
        loc: l,
    }));
    const picked = await vscode.window.showQuickPick(items, {
        title: 'Code Trail: 정의 후보가 여러 개다. 하나를 고른다.',
        matchOnDescription: true,
    });
    return picked?.loc;
}

/** 커서가 놓인 위치를 감싸는 심볼(보통 현재 함수)을 통째로 가져온다. */
export async function resolveEnclosing(
    editor: vscode.TextEditor,
): Promise<ResolvedSymbol | undefined> {
    const doc = editor.document;
    const position = editor.selection.active;

    // 1) 커서가 어떤 식별자 위에 있고 그게 다른 곳의 정의를 가리킨다면, 그 정의로 간다.
    //    (예: 호출부에서 Ctrl+Alt+T)
    const wordRange = doc.getWordRangeAtPosition(position);
    if (wordRange) {
        const symbols = await documentSymbols(doc.uri);
        const enclosing = pickEnclosing(symbols, position);
        const isOnOwnDeclaration =
            enclosing !== undefined && enclosing.selectionRange.contains(position);
        if (!isOnOwnDeclaration) {
            const resolved = await resolveAt(doc.uri, position, 'definition');
            if (resolved) {
                return resolved;
            }
        }
    }

    // 2) 아니면 커서를 감싸는 심볼 자체를 보여준다.
    //    지역 변수 한 줄이 아니라 그걸 담고 있는 함수가 나와야 한다.
    const symbols = await documentSymbols(doc.uri);
    const sym = pickEnclosingBody(symbols, position);
    const fallbackName = wordRange ? doc.getText(wordRange) : `${relPathOf(doc.uri)}:${position.line + 1}`;
    return buildResolved(doc, sym, position, fallbackName, symbols);
}

/**
 * 현재 커서 위치에서 Code Trail이 필요로 하는 provider들이 실제로 응답하는지 점검한다.
 * "언어 서버가 제대로 붙었나"를 확인하는 용도다.
 */
export async function diagnose(editor: vscode.TextEditor): Promise<string> {
    const doc = editor.document;
    const pos = editor.selection.active;
    const wordRange = doc.getWordRangeAtPosition(pos);
    const word = wordRange ? doc.getText(wordRange) : '(식별자 없음)';

    const lines: string[] = [];
    lines.push(`# Code Trail 진단`);
    lines.push('');
    lines.push(`- 파일: \`${doc.uri.fsPath}\``);
    lines.push(`- 언어 ID: \`${doc.languageId}\``);
    lines.push(`- 커서: ${pos.line + 1}행 ${pos.character + 1}열, 심볼 \`${word}\``);
    lines.push('');

    const langExts = vscode.extensions.all.filter((e) => {
        const c = e.packageJSON?.contributes;
        return !!c && (!!c.languages || !!c.grammars) && !e.id.startsWith('vscode.');
    });
    const relevant = langExts
        .filter((e) => /csharp|cpptools|clangd|\bgo\b|rust-analyzer|dotnettools/i.test(e.id))
        .map((e) => `${e.id} ${e.isActive ? '(활성)' : '(비활성)'}`);
    lines.push(`## 감지된 언어 확장`);
    lines.push('');
    lines.push(relevant.length ? relevant.map((r) => `- ${r}`).join('\n') : '- 관련 확장을 못 찾았다.');
    lines.push('');

    lines.push(`## Provider 응답`);
    lines.push('');
    lines.push('| Provider | 쓰임새 | 결과 |');
    lines.push('| --- | --- | --- |');

    const symbols = await documentSymbols(doc.uri);
    lines.push(
        `| DocumentSymbol | 함수 본문 범위 추출 | ${
            symbols.length > 0 ? `✅ 심볼 ${symbols.length}개` : '❌ 응답 없음 — 함수 전체가 아니라 주변 몇 줄만 보이게 된다'
        } |`,
    );

    const checks: Array<[ResolveMode, string, string]> = [
        ['definition', 'executeDefinitionProvider', '식별자 클릭 (핵심)'],
        ['implementation', 'executeImplementationProvider', 'Alt+클릭 구현 찾기'],
        ['typeDefinition', 'executeTypeDefinitionProvider', '정의 못 찾을 때 폴백'],
    ];
    for (const [mode, cmdLabel, usage] of checks) {
        let text: string;
        try {
            const raw = await vscode.commands.executeCommand<
                (vscode.Location | vscode.LocationLink)[]
            >(COMMAND_BY_MODE[mode], doc.uri, pos);
            const locs = normalizeLocations(raw);
            text = locs.length > 0
                ? `✅ ${locs.length}건 → \`${relPathOf(locs[0].uri)}:${locs[0].selection.line + 1}\``
                : '⚠️ 0건 (이 위치에 해당 결과가 없을 수도 있다)';
        } catch (err) {
            text = `❌ 오류: ${err instanceof Error ? err.message : String(err)}`;
        }
        lines.push(`| ${cmdLabel} | ${usage} | ${text} |`);
    }

    lines.push('');
    if (doc.languageId === 'csharp') {
        lines.push('## C# 참고');
        lines.push('');
        lines.push('- C# Dev Kit은 필요 없다. 기본 `C#` 확장(`ms-dotnettools.csharp`)의 Roslyn 언어 서버만으로 동작한다.');
        lines.push('- 다른 프로젝트로 넘어가는 정의 이동이 안 되면 `dotnet.defaultSolution` 에 `.sln` 경로를 지정해본다.');
        lines.push('- OmniSharp로 되돌린 상태(`dotnet.server.useOmnisharp: true`)여도 동작하지만 Roslyn 쪽이 정확하다.');
        lines.push('');
    }
    lines.push('위 표에서 DocumentSymbol과 executeDefinitionProvider 두 줄이 ✅ 면 Code Trail은 정상 동작한다.');
    lines.push('');
    return lines.join('\n');
}

/** SymbolKind 숫자를 사람이 읽는 이름으로 */
export function kindName(kind: number): string {
    const names: Record<number, string> = {
        0: 'file', 1: 'module', 2: 'namespace', 3: 'package', 4: 'class',
        5: 'method', 6: 'property', 7: 'field', 8: 'constructor', 9: 'enum',
        10: 'interface', 11: 'function', 12: 'variable', 13: 'constant', 14: 'string',
        15: 'number', 16: 'boolean', 17: 'array', 18: 'object', 19: 'key',
        20: 'null', 21: 'enum-member', 22: 'struct', 23: 'event', 24: 'operator',
        25: 'type-parameter',
    };
    return names[kind] ?? 'symbol';
}
