import * as vscode from 'vscode';

/** 웹뷰로 넘길 수 있는 직렬화된 심볼 정보. */
export interface ResolvedSymbol {
    /** 심볼 이름 (예: "ProcessPacket") */
    name: string;
    /** 언어 서버가 준 부가 설명 (시그니처 등). 없을 수 있다. */
    detail: string;
    /** vscode.SymbolKind 숫자값 */
    kind: number;
    /** 대상 파일 URI 문자열 */
    uri: string;
    /** 워크스페이스 상대경로 */
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

function relPathOf(uri: vscode.Uri): string {
    const ws = vscode.workspace.getWorkspaceFolder(uri);
    if (!ws) {
        return vscode.workspace.asRelativePath(uri, false);
    }
    const rel = uri.fsPath.slice(ws.uri.fsPath.length).replace(/^[\\/]/, '');
    return rel.replace(/\\/g, '/');
}

type AnySymbol = vscode.DocumentSymbol | vscode.SymbolInformation;

function isDocumentSymbol(s: AnySymbol): s is vscode.DocumentSymbol {
    return (s as vscode.DocumentSymbol).children !== undefined
        || (s as vscode.DocumentSymbol).selectionRange !== undefined;
}

interface FlatSymbol {
    name: string;
    detail: string;
    kind: vscode.SymbolKind;
    range: vscode.Range;
    selectionRange: vscode.Range;
    depth: number;
}

function flatten(symbols: AnySymbol[] | undefined, depth = 0, out: FlatSymbol[] = []): FlatSymbol[] {
    if (!symbols) {
        return out;
    }
    for (const s of symbols) {
        if (isDocumentSymbol(s)) {
            out.push({
                name: s.name,
                detail: s.detail ?? '',
                kind: s.kind,
                range: s.range,
                selectionRange: s.selectionRange ?? s.range,
                depth,
            });
            flatten(s.children, depth + 1, out);
        } else {
            const si = s as vscode.SymbolInformation;
            out.push({
                name: si.name,
                detail: si.containerName ?? '',
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
 * position을 감싸는 심볼 중 "본문을 보여주기에 적절한" 것을 고른다.
 *
 * 가장 깊은 심볼이 항상 정답은 아니다. 예를 들어 클래스 안의 메서드를 클릭하면
 * 메서드를 보여줘야 하지만, 필드 변수를 클릭하면 그 필드 한 줄만 보여주는 게 맞다.
 * 그래서 "position을 포함하는 심볼 중 가장 깊은 것"을 그대로 쓰되,
 * 그 심볼이 이름만 있고 범위가 0줄인 경우에만 부모로 올라간다.
 */
function pickEnclosing(symbols: FlatSymbol[], position: vscode.Position): FlatSymbol | undefined {
    const containing = symbols.filter((s) => s.range.contains(position));
    if (containing.length === 0) {
        return undefined;
    }
    containing.sort((a, b) => b.depth - a.depth);
    return containing[0];
}

/** 정의 위치(선언 이름 위치)와 정확히 맞아떨어지는 심볼을 찾는다. */
function pickByDeclaration(symbols: FlatSymbol[], position: vscode.Position): FlatSymbol | undefined {
    // 1) selectionRange(이름 부분)가 position을 포함하는 것 우선
    const byName = symbols.filter((s) => s.selectionRange.contains(position));
    if (byName.length > 0) {
        byName.sort((a, b) => b.depth - a.depth);
        return byName[0];
    }
    // 2) 없으면 범위로
    return pickEnclosing(symbols, position);
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
): Promise<ResolvedSymbol> {
    const contextLines = vscode.workspace
        .getConfiguration('codeTrail')
        .get<number>('contextLines', 40);

    let range: vscode.Range;
    let approximate = false;
    let name = fallbackName;
    let detail = '';
    let kind: vscode.SymbolKind = vscode.SymbolKind.Null;
    let anchor = fallbackPosition;

    if (sym) {
        range = sym.range;
        name = sym.name || fallbackName;
        detail = sym.detail;
        kind = sym.kind;
        anchor = sym.selectionRange.start;
        // 언어 서버가 한 줄짜리 range만 준 경우(일부 C++ 서버)에는 보정한다.
        if (range.start.line === range.end.line && isBodyKind(kind)) {
            const end = Math.min(doc.lineCount - 1, range.start.line + contextLines);
            range = new vscode.Range(range.start.line, 0, end, doc.lineAt(end).text.length);
            approximate = true;
        }
    } else {
        const start = Math.max(0, fallbackPosition.line);
        const end = Math.min(doc.lineCount - 1, start + contextLines);
        range = new vscode.Range(start, 0, end, doc.lineAt(end).text.length);
        approximate = true;
    }

    const { code, startLine } = sliceCode(doc, range);
    const callable = isBodyKind(kind);

    return {
        name,
        detail,
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
            kind: vscode.SymbolKind.Null,
            range: chosen.fullRange,
            selectionRange: new vscode.Range(chosen.selection, chosen.selection),
            depth: 0,
        };
    }

    const wordRange = doc.getWordRangeAtPosition(chosen.selection);
    const fallbackName = wordRange ? doc.getText(wordRange) : '(unknown)';
    return buildResolved(doc, sym, chosen.selection, fallbackName);
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
    const symbols = await documentSymbols(doc.uri);
    const sym = pickEnclosing(symbols, position);
    const fallbackName = wordRange ? doc.getText(wordRange) : `${relPathOf(doc.uri)}:${position.line + 1}`;
    return buildResolved(doc, sym, position, fallbackName);
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
