import { shortName, type ResolvedSymbol } from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { pathToUri, uriToPath } from '../lsp/documents.js';
import type { LspManager } from '../lsp/manager.js';
import type { LspSession } from '../lsp/session.js';
import { LspUnavailableError } from '../lsp/types.js';
import type { DocumentGrant, DocumentRegistry } from '../workspace/documents.js';
import { chooseBodyRange, sliceLines, splitLines } from './body.js';
import { isDeclarationOnly } from './declaration.js';
import { flattenDocumentSymbols, type FlatSymbol, type Position } from './flatten.js';
import { normalizeLocations, onlyReadable, type NormalizedLocation } from './locations.js';
import { isBodyKind, pickByDeclaration, pickEnclosing, pickEnclosingBody } from './select.js';
import { wordAt } from './word.js';

/**
 * 심볼 해석 서비스 (구현서 13.5).
 *
 * 언어 서버가 준 결과를 화면에 붙일 수 있는 `ResolvedSymbol` 로 만든다.
 * **여기서 타입 추론이나 AST 분석을 하지 않는다.** 하는 일은 넷이다.
 *
 * 1. 어느 요청을 어떤 순서로 보낼지 정한다 (definition → typeDefinition 폴백).
 * 2. 돌아온 위치를 정규화하고 읽을 수 있는 것만 남긴다.
 * 3. 그 문서의 심볼 목록에서 "이 위치의 심볼" 을 고른다.
 * 4. 본문 범위를 정하고 원문을 잘라 담는다.
 *
 * `textDocument/references` 는 쓰지 않는다(구현서 11.1). 참조 결과에는 호출부가
 * 섞여 있어서 "이 메서드를 부르는 함수" 를 구현이라고 붙이게 된다.
 */

export const IMPLEMENTATION_CANDIDATE_LIMIT = 25;

export type ResolveMode = 'definition' | 'implementation' | 'typeDefinition';

const LSP_METHOD: Record<ResolveMode, string> = {
    definition: 'textDocument/definition',
    implementation: 'textDocument/implementation',
    typeDefinition: 'textDocument/typeDefinition',
};

/** 후보가 하나면 바로 해석하고, 여럿이면 사용자에게 고르게 한다. */
export type ResolveOutcome =
    | { kind: 'resolved'; symbol: ResolvedSymbol }
    | { kind: 'candidates'; candidates: LocationCandidate[] }
    | { kind: 'none' };

export interface LocationCandidate {
    /** 이 후보를 다시 지목할 때 쓰는 키. 경로가 아니다. */
    candidateId: string;
    name: string;
    displayPath: string;
    line: number;
    hasBody: boolean;
    /** 서버 안에서만 쓴다. 브라우저로 나가지 않는다. */
    location: NormalizedLocation;
}

export interface ResolverOptions {
    lsp: LspManager;
    documents: DocumentRegistry;
    logger: Logger;
    getContextLines: () => number;
}

export class SymbolResolver {
    private readonly logger: Logger;

    constructor(private readonly options: ResolverOptions) {
        this.logger = options.logger.child('resolve');
    }

    // ── 공개 동작 ───────────────────────────────────────────────────────────

    /**
     * 노드 본문의 식별자를 클릭했다.
     *
     * definition 을 먼저 묻고, 빈손이면 typeDefinition 으로 넘어간다(구현서 13.5).
     * 변수를 클릭했을 때 그 타입의 정의로 가는 것이 사용자가 기대하는 동작이다.
     */
    async resolveDefinition(grant: DocumentGrant, position: Position): Promise<ResolveOutcome> {
        return this.resolveWithModes(grant, position, ['definition', 'typeDefinition']);
    }

    /**
     * `Alt`+클릭. 구현을 먼저 묻고 없으면 정의로 되돌아간다.
     *
     * 되돌아가는 것은 사용자가 이미 구현을 원한다고 말했기 때문이다 — 아무것도
     * 안 주는 것보다 정의라도 보여주는 편이 낫다.
     */
    async resolveImplementation(grant: DocumentGrant, position: Position): Promise<ResolveOutcome> {
        return this.resolveWithModes(grant, position, ['implementation', 'definition']);
    }

    /** 사용자가 여러 후보 중 하나를 골랐다. */
    async resolveCandidate(candidate: LocationCandidate): Promise<ResolvedSymbol | undefined> {
        return this.buildFromLocation(candidate.location);
    }

    /**
     * 선언 노드의 구현을 전부 찾는다 (구현서 13.5 "구현 버튼").
     *
     * **참조 검색 폴백이 없다.** 확장에는 `allowReferenceFallback` 이 있었지만,
     * 참조에는 호출부가 섞여 들어와 "이 메서드를 부르는 함수" 가 구현으로 붙는다.
     * 새 구현에서는 그 통로 자체를 두지 않는다(구현서 11.1).
     */
    async resolveImplementations(
        grant: DocumentGrant,
        position: Position,
    ): Promise<{ symbols: ResolvedSymbol[]; truncated: boolean }> {
        const session = await this.sessionFor(grant);
        if (!session.capabilities.implementation) {
            throw new LspUnavailableError(
                session.language,
                '이 언어 서버는 구현 찾기를 지원하지 않는다.',
            );
        }

        const raw = await session.request<unknown>(LSP_METHOD.implementation, {
            textDocument: { uri: this.uriOf(grant) },
            position,
        });

        const found = onlyReadable(normalizeLocations(raw)).filter(
            // 선언 자기 자신은 구현이 아니다.
            (location) => !(location.key === this.keyOf(grant) && location.selection.line === position.line),
        );

        const truncated = found.length > IMPLEMENTATION_CANDIDATE_LIMIT;
        const symbols: ResolvedSymbol[] = [];
        for (const location of found.slice(0, IMPLEMENTATION_CANDIDATE_LIMIT)) {
            const symbol = await this.buildFromLocation(location);
            if (symbol) {
                symbols.push(symbol);
            }
        }
        // 몸통 있는 것부터. 다른 인터페이스에서 상속한 또 다른 선언은 뒤로 민다.
        symbols.sort((a, b) => Number(a.declarationOnly) - Number(b.declarationOnly));
        return { symbols, truncated };
    }

    /**
     * 커서를 감싸는 심볼을 통째로 가져온다 (구현서 10.3 — 루트 만들기).
     *
     * 1. 커서가 식별자 위이고 자기 선언이 아니면 정의로 먼저 간다.
     *    (호출부에서 시작하면 그 함수가 아니라 불리는 쪽을 보고 싶다.)
     * 2. 아니면 커서를 감싸는 몸통 심볼을 보여준다.
     * 3. 문서 심볼이 없으면 현재 줄부터 `contextLines` 만큼을 근사 본문으로 만든다.
     */
    async resolveEnclosing(
        grant: DocumentGrant,
        position: Position,
    ): Promise<ResolvedSymbol | undefined> {
        const session = await this.sessionFor(grant);
        const uri = this.uriOf(grant);
        const content = await this.options.documents.read(grant.documentId);
        const lines = splitLines(content.text);
        const symbols = await this.documentSymbols(session, uri, lines.length);

        const word = wordAt(lines[position.line] ?? '', position.character);
        if (word !== '') {
            const enclosing = pickEnclosing(symbols, position);
            const onOwnDeclaration = enclosing !== undefined
                && containsPosition(enclosing.selectionRange, position);
            if (!onOwnDeclaration) {
                const outcome = await this.resolveWithModes(grant, position, ['definition']);
                if (outcome.kind === 'resolved') {
                    return outcome.symbol;
                }
                if (outcome.kind === 'candidates') {
                    // 루트를 만드는 자리에서 대화상자를 띄우지 않는다.
                    // 감싸는 심볼로 조용히 되돌아간다.
                    this.logger.debug('루트 만들기에서 정의 후보가 여럿이라 감싸는 심볼을 쓴다.');
                }
            }
        }

        const symbol = pickEnclosingBody(symbols, position);
        return this.build({
            grant,
            symbols,
            symbol,
            lines,
            content,
            fallbackPosition: position,
            fallbackName: word !== '' ? word : `${grant.displayPath}:${position.line + 1}`,
        });
    }

    // ── 내부 ────────────────────────────────────────────────────────────────

    private async sessionFor(grant: DocumentGrant): Promise<LspSession> {
        const fsPath = uriToPath(this.uriOf(grant)) ?? grant.realPath;
        return this.options.lsp.openFor(fsPath, this.uriOf(grant));
    }

    private uriOf(grant: DocumentGrant): string {
        return pathToUri(grant.realPath);
    }

    private keyOf(grant: DocumentGrant): string {
        return normalizeKey(this.uriOf(grant));
    }

    private async resolveWithModes(
        grant: DocumentGrant,
        position: Position,
        modes: readonly ResolveMode[],
    ): Promise<ResolveOutcome> {
        const session = await this.sessionFor(grant);

        let locations: NormalizedLocation[] = [];
        for (const mode of modes) {
            if (!this.supports(session, mode)) {
                continue;
            }
            try {
                const raw = await session.request<unknown>(LSP_METHOD[mode], {
                    textDocument: { uri: this.uriOf(grant) },
                    position,
                });
                locations = onlyReadable(normalizeLocations(raw));
            } catch (error) {
                this.logger.debug('요청이 실패했다.', {
                    mode,
                    reason: error instanceof Error ? error.message : String(error),
                });
                locations = [];
            }
            if (locations.length > 0) {
                break;
            }
        }

        if (locations.length === 0) {
            return { kind: 'none' };
        }
        if (locations.length === 1) {
            const symbol = await this.buildFromLocation(locations[0] as NormalizedLocation);
            return symbol ? { kind: 'resolved', symbol } : { kind: 'none' };
        }

        // 후보가 여럿이다. **자동으로 고르지 않는다** — 어느 것이 맞는지는
        // 호출부의 정적 타입만으로 알 수 없고, 골라주면 그게 정답이라고 오해한다.
        const candidates: LocationCandidate[] = [];
        for (const [index, location] of locations.entries()) {
            const preview = await this.describeCandidate(location, index);
            if (preview) {
                candidates.push(preview);
            }
        }
        if (candidates.length === 0) {
            return { kind: 'none' };
        }
        if (candidates.length === 1) {
            const only = candidates[0] as LocationCandidate;
            const symbol = await this.buildFromLocation(only.location);
            return symbol ? { kind: 'resolved', symbol } : { kind: 'none' };
        }
        return { kind: 'candidates', candidates };
    }

    private supports(session: LspSession, mode: ResolveMode): boolean {
        const capabilities = session.capabilities;
        switch (mode) {
            case 'definition':
                return capabilities.definition;
            case 'implementation':
                return capabilities.implementation;
            case 'typeDefinition':
                return capabilities.typeDefinition;
            default:
                return false;
        }
    }

    /** 후보 목록에 보여줄 최소 정보. 본문은 읽지 않는다 — 목록이 느려진다. */
    private async describeCandidate(
        location: NormalizedLocation,
        index: number,
    ): Promise<LocationCandidate | undefined> {
        const grant = this.grantFor(location.uri);
        if (!grant) {
            return undefined;
        }
        let name = '';
        let hasBody = false;
        try {
            const session = await this.sessionFor(grant);
            const content = await this.options.documents.read(grant.documentId);
            const lines = splitLines(content.text);
            const symbols = await this.documentSymbols(session, this.uriOf(grant), lines.length);
            const symbol = pickByDeclaration(symbols, location.selection);
            name = symbol ? shortName(symbol.name) : wordAt(
                lines[location.selection.line] ?? '',
                location.selection.character,
            );
            hasBody = symbol !== undefined && symbol.range.end.line > symbol.range.start.line;
        } catch {
            // 후보 하나를 못 읽어도 목록은 보여준다.
        }
        return {
            candidateId: `c${index}`,
            name: name || '(이름 없음)',
            displayPath: grant.displayPath,
            line: location.selection.line,
            hasBody,
            location,
        };
    }

    /** 이 URI 에 문서 권한을 준다. 프로젝트 밖이면 세션 한정으로 허용한다. */
    private grantFor(uri: string): DocumentGrant | undefined {
        const fsPath = uriToPath(uri);
        if (fsPath === null) {
            return undefined;
        }
        // 언어 서버가 돌려준 위치다. 브라우저가 지목한 경로가 아니므로
        // 프로젝트 밖(표준 라이브러리 헤더 등)이어도 허용한다(구현서 8.2).
        return this.options.documents.grantExternal(fsPath);
    }

    private async buildFromLocation(
        location: NormalizedLocation,
    ): Promise<ResolvedSymbol | undefined> {
        const grant = this.grantFor(location.uri);
        if (!grant) {
            return undefined;
        }
        let content;
        try {
            content = await this.options.documents.read(grant.documentId);
        } catch {
            return undefined;
        }
        const lines = splitLines(content.text);

        let symbols: FlatSymbol[] = [];
        try {
            const session = await this.sessionFor(grant);
            symbols = await this.documentSymbols(session, this.uriOf(grant), lines.length);
        } catch {
            // 문서 심볼이 없어도 LocationLink 힌트로 본문을 만들 수 있다.
        }

        const symbol = pickByDeclaration(symbols, location.selection);
        return this.build({
            grant,
            symbols,
            symbol,
            lines,
            content,
            fallbackPosition: location.selection,
            fallbackName: wordAt(
                lines[location.selection.line] ?? '',
                location.selection.character,
            ),
            ...(location.fullRange ? { hintRange: location.fullRange } : {}),
        });
    }

    private async documentSymbols(
        session: LspSession,
        uri: string,
        lineCount: number,
    ): Promise<FlatSymbol[]> {
        if (!session.capabilities.documentSymbol) {
            return [];
        }
        try {
            const raw = await session.request<unknown>('textDocument/documentSymbol', {
                textDocument: { uri },
            });
            return flattenDocumentSymbols(raw, lineCount);
        } catch (error) {
            this.logger.debug('문서 심볼을 못 받았다.', {
                reason: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    private build(args: {
        grant: DocumentGrant;
        symbols: readonly FlatSymbol[];
        symbol: FlatSymbol | undefined;
        lines: readonly string[];
        content: { languageId: string; contentHash: string; modifiedAt: string };
        fallbackPosition: Position;
        fallbackName: string;
        hintRange?: { start: Position; end: Position };
    }): ResolvedSymbol {
        const { grant, symbol, lines, content } = args;

        const range = chooseBodyRange({
            symbol,
            fallbackLine: args.fallbackPosition.line,
            allSymbols: args.symbols,
            hintRange: args.hintRange,
            lineCount: lines.length,
            contextLines: this.options.getContextLines(),
        });
        const { code, startLine } = sliceLines(lines, range);

        const kind = symbol?.kind ?? 0;
        const callable = isBodyKind(kind);
        const anchor = symbol?.selectionRange.start ?? args.fallbackPosition;

        return {
            // Roslyn 은 이름에 시그니처를 통째로 넣는다. `(` 앞까지만 쓴다.
            name: shortName(symbol?.name || args.fallbackName || '(이름 없음)'),
            detail: symbol?.detail ?? '',
            container: symbol?.container ?? '',
            kind,
            relPath: grant.relPath,
            displayPath: grant.displayPath,
            external: grant.external,
            languageId: content.languageId,
            code,
            startLine,
            anchorLine: anchor.line,
            anchorChar: anchor.character,
            approximate: range.approximate,
            callable,
            declarationOnly: isDeclarationOnly({
                callable,
                approximate: range.approximate,
                code,
            }),
            contentHash: content.contentHash,
            modifiedAt: content.modifiedAt,
            documentId: grant.documentId,
        };
    }
}

function containsPosition(range: { start: Position; end: Position }, position: Position): boolean {
    const afterStart = range.start.line < position.line
        || (range.start.line === position.line && range.start.character <= position.character);
    const beforeEnd = position.line < range.end.line
        || (position.line === range.end.line && position.character <= range.end.character);
    return afterStart && beforeEnd;
}

function normalizeKey(uri: string): string {
    return normalizeLocations([{ uri, range: { start: { line: 0, character: 0 } } }])[0]?.key ?? uri;
}
