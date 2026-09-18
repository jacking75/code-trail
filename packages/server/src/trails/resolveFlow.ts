import { randomUUID } from 'node:crypto';

import {
    isSameSymbol,
    type CommandError,
    type CommandErrorContext,
    type ProjectSettings,
    type ResolvedSymbol,
    type TrailNode,
    type TrailOrigin,
} from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { LspTimeoutError, LspUnavailableError, type PublicLspState } from '../lsp/types.js';
import type { LocationCandidate, SymbolResolver } from '../symbols/resolver.js';
import { supportedLanguageFor, type SupportedLanguage } from '../workspace/languages.js';
import type { DocumentGrant, DocumentRegistry } from '../workspace/documents.js';
import type { TrailService } from './service.js';

/**
 * 정의 클릭 한 번이 일으키는 일 (구현서 13.5, 15.3).
 *
 * 게이트웨이는 메시지를 나르고, 도메인은 트리 불변식을 지킨다. 그 사이에서
 * "언어 서버에 무엇을 묻고, 답을 받아 트리에 어떻게 붙일지" 를 정하는 것이
 * 여기다. 게이트웨이에 넣으면 프로토콜 코드에 도메인 규칙이 섞이고, 도메인에
 * 넣으면 도메인이 네트워크를 알게 된다.
 *
 * 지키는 규칙 넷.
 *
 * - 후보가 여럿이면 **고르지 않는다.** 사용자에게 넘긴다.
 * - 같은 부모 아래 같은 심볼이 이미 있으면 붙이지 않고 그 노드로 보낸다.
 * - 선언만인 노드는 구현을 따라간 뒤에도 **지우지 않는다.**
 * - 몸통 있는 구현이 **정확히 하나**일 때만 자동으로 이어 붙인다.
 */

/** 사용자가 고르기를 기다리는 물음. 서버가 응답을 붙들고 기다리지 않는다. */
interface PendingChoice {
    trailId: string;
    /** 어느 노드에서 클릭했는지. 루트를 만드는 중이면 `null`. */
    nodeId: string | null;
    origin: TrailOrigin | null;
    candidates: LocationCandidate[];
    /**
     * 이미 해석이 끝난 후보.
     *
     * 구현 목록은 `resolveImplementations` 가 심볼을 통째로 만들어 두므로 다시
     * 언어 서버에 물을 것이 없다. 후보 ID 로 그 심볼을 바로 꺼내 쓴다.
     */
    resolved?: Map<string, ResolvedSymbol>;
    /**
     * 고른 뒤 할 일.
     *
     * `attach` 는 자식으로 붙이는 보통의 정의 클릭이고, `refresh` 는 그 노드의
     * 심볼만 갈아 끼우는 다시 읽기다. 후보 목록 UI 는 같지만 결과가 다르다.
     */
    outcome?: 'attach' | 'refresh';
    createdAt: number;
}

/** 화면에 보내는 후보 한 줄. 서버 안의 위치 정보는 담지 않는다. */
export interface ChoiceCandidateView {
    candidateId: string;
    name: string;
    displayPath: string;
    line: number;
    hasBody: boolean;
}

/** 동시에 기억하는 물음 수. 사용자가 대화상자를 닫아버리면 답이 안 온다. */
const MAX_PENDING_CHOICES = 32;

export type ResolveFlowResult =
    | { kind: 'added'; parentId: string; node: TrailNode; revision: number }
    /** 노드의 심볼만 현재 코드로 갈아 끼웠다. 자식과 진입 링크는 그대로다. */
    | { kind: 'refreshed'; nodeId: string; revision: number }
    | { kind: 'existing'; nodeId: string }
    | {
        kind: 'choice';
        choiceId: string;
        nodeId: string | null;
        origin: TrailOrigin | null;
        candidates: LocationCandidate[];
    }
    /**
     * 언어 서버가 갈 곳을 주지 않았다.
     *
     * 왜 못 찾았는지를 함께 준다. "언어 서버가 켜져 있는지 확인한다" 한 줄로는
     * 사용자가 무엇을 할지 정할 수 없다 — 뜨는 중인지, 죽었는지, 확인 전인지,
     * C# 솔루션을 안 골랐는지에 따라 다음 행동이 전부 다르다.
     */
    | { kind: 'none'; message: string; context: CommandErrorContext }
    | { kind: 'error'; error: CommandError };

/**
 * 자동 추적 결과. 선언 노드에 이어 붙인 구현이 있으면 함께 돌려준다.
 * 없으면 왜 없는지(후보 0개 / 여러 개)를 알려준다 — 화면이 안내를 띄운다.
 */
export interface AutoFollowResult {
    node: TrailNode | undefined;
    candidateCount: number;
    /** 몸통 있는 후보. 여럿일 때 화면이 그 자리에서 고를 수 있게 준다. */
    candidates: ResolvedSymbol[];
}

export interface ResolveFlowOptions {
    trails: TrailService;
    resolver: SymbolResolver;
    documents: DocumentRegistry;
    logger: Logger;
    getSettings: () => ProjectSettings;
    /** 그 언어 서버의 지금 상태. 프로세스를 띄우지 않는다. */
    lspStatus: (language: SupportedLanguage) => {
        enabled: boolean;
        state: PublicLspState;
        verified: boolean;
        lastError: string | null;
    };
    /** C# 솔루션 후보 수. 고르지 않은 채 후보가 여럿이면 그것이 원인일 때가 많다. */
    solutionCandidateCount: () => Promise<number>;
}

export class ResolveFlow {
    private readonly pending = new Map<string, PendingChoice>();
    private readonly logger: Logger;

    constructor(private readonly options: ResolveFlowOptions) {
        this.logger = options.logger.child('flow');
    }

    /** 노드 본문의 식별자를 클릭했다. */
    async resolveFromNode(args: {
        trailId: string;
        baseRevision: number;
        nodeId: string;
        line: number;
        char: number;
        text: string;
        mode: 'definition' | 'implementation';
    }): Promise<ResolveFlowResult> {
        const trail = this.options.trails.get(args.trailId);
        if (!trail) {
            return { kind: 'error', error: notFound('트레일') };
        }
        const node = trail.get(args.nodeId);
        if (!node) {
            return { kind: 'error', error: notFound('노드') };
        }
        const grant = await this.grantOf(node.symbol);
        if (!grant) {
            return {
                kind: 'error',
                error: {
                    code: 'NOT_FOUND',
                    message: '이 노드의 원본 파일을 다시 열 수 없다. 프로젝트 밖 파일이면 '
                        + '서버를 다시 띄운 뒤에는 열기가 막힌다.',
                    retryable: false,
                },
            };
        }

        const origin: TrailOrigin = { line: args.line, char: args.char, text: args.text };
        const position = { line: args.line, character: args.char };

        try {
            const outcome = args.mode === 'implementation'
                ? await this.options.resolver.resolveImplementation(grant, position)
                : await this.options.resolver.resolveDefinition(grant, position);

            if (outcome.kind === 'none') {
                return this.notFound(grant);
            }
            if (outcome.kind === 'candidates') {
                return this.remember(args.trailId, args.nodeId, origin, outcome.candidates);
            }
            return this.attach(args.trailId, args.baseRevision, args.nodeId, outcome.symbol, origin);
        } catch (error) {
            return { kind: 'error', error: toCommandError(error, await this.contextOf(grant)) };
        }
    }

    /** 코드 화면의 커서 위치에서 새 루트를 만든다. */
    async addRootAt(args: {
        trailId: string;
        baseRevision: number;
        documentId: string;
        line: number;
        char: number;
    }): Promise<ResolveFlowResult> {
        const grant = this.options.documents.get(args.documentId);
        if (!grant) {
            return { kind: 'error', error: notFound('문서') };
        }
        try {
            // 언어 서버 왕복은 큐 **밖에서** 한다. 안에서 기다리면 그 트레일의
            // 다른 명령이 전부 막힌다.
            const symbol = await this.options.resolver.resolveEnclosing(grant, {
                line: args.line,
                character: args.char,
            });
            if (!symbol) {
                return this.notFound(grant);
            }
            return this.attachRoot(args.trailId, args.baseRevision, symbol);
        } catch (error) {
            return { kind: 'error', error: toCommandError(error, await this.contextOf(grant)) };
        }
    }

    /** 루트로 붙인다. revision 검사를 거쳐 한 번만 바꾼다. */
    private async attachRoot(
        trailId: string,
        baseRevision: number,
        symbol: ResolvedSymbol,
    ): Promise<ResolveFlowResult> {
        let added: TrailNode | undefined;
        const result = await this.options.trails.mutate(trailId, baseRevision, (trail) => {
            added = trail.addRoot(symbol);
            return true;
        });
        if (!result.ok) {
            return { kind: 'error', error: result.error };
        }
        if (!added) {
            return { kind: 'none', message: '루트를 붙이지 못했다.', context: {} };
        }
        return { kind: 'added', parentId: '', node: added, revision: result.value.revision };
    }

    /** 노드의 심볼만 갈아 끼운다. revision 검사를 거쳐 한 번만 바꾼다. */
    private async replace(
        trailId: string,
        baseRevision: number,
        nodeId: string,
        symbol: ResolvedSymbol,
    ): Promise<ResolveFlowResult> {
        const result = await this.options.trails.mutate(trailId, baseRevision, (trail) =>
            trail.replaceSymbol(nodeId, symbol) !== undefined);
        if (!result.ok) {
            return { kind: 'error', error: result.error };
        }
        return { kind: 'refreshed', nodeId, revision: result.value.revision };
    }

    /** 사용자가 후보 하나를 골랐다. */
    async chooseCandidate(args: {
        choiceId: string;
        candidateId: string;
        baseRevision: number;
    }): Promise<ResolveFlowResult> {
        const choice = this.pending.get(args.choiceId);
        if (!choice) {
            return {
                kind: 'error',
                error: {
                    code: 'NOT_FOUND',
                    message: '이미 지난 물음이다. 다시 클릭한다.',
                    retryable: false,
                },
            };
        }
        this.pending.delete(args.choiceId);

        const preResolved = choice.resolved?.get(args.candidateId);
        if (preResolved) {
            // 구현 목록은 심볼을 이미 만들어 뒀다. 언어 서버에 다시 묻지 않는다.
            if (choice.nodeId === null) {
                return this.attachRoot(choice.trailId, args.baseRevision, preResolved);
            }
            const parent = this.options.trails.get(choice.trailId)?.get(choice.nodeId);
            return this.attach(
                choice.trailId,
                args.baseRevision,
                choice.nodeId,
                preResolved,
                parent
                    ? {
                        line: parent.symbol.anchorLine,
                        char: parent.symbol.anchorChar,
                        text: parent.symbol.name,
                    }
                    : null,
            );
        }

        const candidate = choice.candidates.find((c) => c.candidateId === args.candidateId);
        if (!candidate) {
            return { kind: 'error', error: notFound('후보') };
        }

        try {
            const symbol = await this.options.resolver.resolveCandidate(candidate);
            if (!symbol) {
                return { kind: 'none', message: '고른 후보의 코드를 읽지 못했다.', context: {} };
            }
            if (choice.outcome === 'refresh' && choice.nodeId !== null) {
                return this.replace(choice.trailId, args.baseRevision, choice.nodeId, symbol);
            }
            if (choice.nodeId === null) {
                return this.attachRoot(choice.trailId, args.baseRevision, symbol);
            }
            return this.attach(
                choice.trailId,
                args.baseRevision,
                choice.nodeId,
                symbol,
                choice.origin,
            );
        } catch (error) {
            return { kind: 'error', error: toCommandError(error, {}) };
        }
    }

    /**
     * 선언 노드의 구현을 전부 붙인다 (`⚑`).
     *
     * 참조 검색 폴백이 없다. 참조에는 호출부가 섞여 "이 메서드를 부르는 함수" 가
     * 구현으로 붙는다(구현서 11.1).
     */
    async resolveImplementations(args: {
        trailId: string;
        baseRevision: number;
        nodeId: string;
    }): Promise<
        | { kind: 'added'; nodes: TrailNode[]; truncated: boolean; revision: number }
        | { kind: 'none'; message: string; context: CommandErrorContext }
        | { kind: 'error'; error: CommandError }
    > {
        const trail = this.options.trails.get(args.trailId);
        if (!trail) {
            return { kind: 'error', error: notFound('트레일') };
        }
        const node = trail.get(args.nodeId);
        if (!node) {
            return { kind: 'error', error: notFound('노드') };
        }
        const grant = await this.grantOf(node.symbol);
        if (!grant) {
            return { kind: 'error', error: notFound('원본 파일') };
        }

        try {
            const found = await this.options.resolver.resolveImplementations(grant, {
                line: node.symbol.anchorLine,
                character: node.symbol.anchorChar,
            });
            if (found.symbols.length === 0) {
                return { kind: 'none', ...(await this.notFoundParts(grant)) };
            }

            const added: TrailNode[] = [];
            const result = await this.options.trails.mutate(
                args.trailId,
                args.baseRevision,
                (current) => {
                    for (const symbol of found.symbols) {
                        if (current.findExistingChild(args.nodeId, symbol)) {
                            continue;
                        }
                        const origin: TrailOrigin = {
                            line: node.symbol.anchorLine,
                            char: node.symbol.anchorChar,
                            text: node.symbol.name,
                        };
                        const child = current.addChild(args.nodeId, symbol, origin);
                        if (child) {
                            added.push(child);
                        }
                    }
                    return added.length > 0;
                },
            );
            if (!result.ok) {
                return { kind: 'error', error: result.error };
            }
            return {
                kind: 'added',
                nodes: added,
                truncated: found.truncated,
                revision: result.value.revision,
            };
        } catch (error) {
            return { kind: 'error', error: toCommandError(error, await this.contextOf(grant)) };
        }
    }

    /**
     * 선언만인 노드의 구현을 자동으로 이어 붙인다 (구현서 13.5 8~9단계).
     *
     * **몸통 있는 후보가 정확히 하나일 때만** 붙인다. 둘 이상이면 손대지 않는다 —
     * 호출부의 정적 타입만으로는 어느 구현이 도는지 알 수 없고, 자동으로 고르면
     * 그게 실행되는 코드라고 오해하게 된다.
     *
     * **선언 노드는 어느 쪽이든 지우지 않는다.** "인터페이스를 거쳐 갔다" 도
     * 경로의 일부다.
     */
    async autoFollowSingleImplementation(args: {
        trailId: string;
        nodeId: string;
    }): Promise<AutoFollowResult> {
        if (!this.options.getSettings().ui.autoFollowSingleImplementation) {
            return { node: undefined, candidateCount: 0, candidates: [] };
        }
        const trail = this.options.trails.get(args.trailId);
        const node = trail?.get(args.nodeId);
        if (!trail || !node || !node.symbol.declarationOnly) {
            return { node: undefined, candidateCount: 0, candidates: [] };
        }
        const grant = await this.grantOf(node.symbol);
        if (!grant) {
            return { node: undefined, candidateCount: 0, candidates: [] };
        }

        let found;
        try {
            found = await this.options.resolver.resolveImplementations(grant, {
                line: node.symbol.anchorLine,
                character: node.symbol.anchorChar,
            });
        } catch (error) {
            this.logger.debug('자동 구현 추적에 실패했다.', {
                reason: error instanceof Error ? error.message : String(error),
            });
            return { node: undefined, candidateCount: 0, candidates: [] };
        }

        const withBody = found.symbols.filter((symbol) => !symbol.declarationOnly);
        if (withBody.length !== 1) {
            // 0개면 붙일 것이 없고, 2개 이상이면 고를 수 없다. 둘 다 손대지 않는다.
            return { node: undefined, candidateCount: withBody.length, candidates: withBody };
        }
        const only = withBody[0] as ResolvedSymbol;

        const result = await this.options.trails.updateUi(args.trailId, (current) => {
            if (current.findExistingChild(args.nodeId, only)) {
                return false;
            }
            return current.addChild(args.nodeId, only, {
                line: node.symbol.anchorLine,
                char: node.symbol.anchorChar,
                text: node.symbol.name,
            }) !== undefined;
        });
        if (!result.ok) {
            return { node: undefined, candidateCount: 1, candidates: withBody };
        }
        const parent = result.value.trail.get(args.nodeId);
        const children = parent?.children ?? [];
        return { node: children[children.length - 1], candidateCount: 1, candidates: withBody };
    }

    /**
     * 파일이 바뀐 노드를 현재 코드로 다시 읽는다 (U08).
     *
     * 저장된 좌표를 그대로 믿지 않는다. 같은 이름·컨테이너·종류의 심볼을
     * `documentSymbol` 에서 다시 찾아, 정확히 하나일 때만 갈아 끼운다.
     * 자식·진입 링크·접힘 상태는 건드리지 않는다 — 다른 심볼로 간 것이 아니라
     * 같은 심볼의 새 본문을 읽은 것이다.
     */
    async refreshNode(args: {
        trailId: string;
        baseRevision: number;
        nodeId: string;
    }): Promise<ResolveFlowResult> {
        const trail = this.options.trails.get(args.trailId);
        if (!trail) {
            return { kind: 'error', error: notFound('트레일') };
        }
        const node = trail.get(args.nodeId);
        if (!node) {
            return { kind: 'error', error: notFound('노드') };
        }
        const grant = await this.grantOf(node.symbol);
        if (!grant) {
            return { kind: 'error', error: notFound('원본 파일') };
        }

        try {
            const outcome = await this.options.resolver.resolveByName(grant, {
                name: node.symbol.name,
                container: node.symbol.container,
                kind: node.symbol.kind,
            });
            if (outcome.kind === 'none') {
                return {
                    kind: 'error',
                    error: {
                        code: 'NOT_FOUND',
                        message: '현재 파일에 같은 이름의 심볼이 없다. '
                            + '이름이 바뀌었거나 지워졌을 수 있다.',
                        retryable: false,
                    },
                };
            }
            if (outcome.kind === 'candidates') {
                const choiceId = randomUUID();
                this.pending.set(choiceId, {
                    trailId: args.trailId,
                    nodeId: args.nodeId,
                    origin: node.origin,
                    candidates: outcome.candidates,
                    outcome: 'refresh',
                    createdAt: Date.now(),
                });
                this.trimPending();
                return {
                    kind: 'choice',
                    choiceId,
                    nodeId: args.nodeId,
                    origin: node.origin,
                    candidates: outcome.candidates,
                };
            }
            return this.replace(args.trailId, args.baseRevision, args.nodeId, outcome.symbol);
        } catch (error) {
            return { kind: 'error', error: toCommandError(error, await this.contextOf(grant)) };
        }
    }

    /**
     * 구현 후보를 기억해 두고 `choiceId` 를 준다 (U09).
     *
     * 구현이 여럿일 때 하나를 자동으로 고르지 않는다는 규칙은 그대로다. 달라진
     * 것은 "`⚑` 를 다시 누르라" 고 알리는 대신 그 자리에서 고를 수 있게 목록을
     * 함께 준다는 점이다. 고르는 주체는 여전히 사람이다.
     */
    rememberImplementationChoice(args: {
        trailId: string;
        nodeId: string;
        symbols: readonly ResolvedSymbol[];
    }): { choiceId: string; candidates: ChoiceCandidateView[] } {
        const choiceId = randomUUID();
        const resolved = new Map<string, ResolvedSymbol>();
        const candidates: ChoiceCandidateView[] = args.symbols.map((symbol, index) => {
            const candidateId = `i${index}`;
            resolved.set(candidateId, symbol);
            return {
                candidateId,
                name: symbol.name,
                displayPath: symbol.displayPath,
                line: symbol.anchorLine,
                hasBody: !symbol.declarationOnly,
            };
        });
        this.pending.set(choiceId, {
            trailId: args.trailId,
            nodeId: args.nodeId,
            origin: null,
            candidates: [],
            resolved,
            createdAt: Date.now(),
        });
        this.trimPending();
        return { choiceId, candidates };
    }

    // ── 내부 ────────────────────────────────────────────────────────────────

    /**
     * 정의를 못 찾았을 때의 안내와 맥락.
     *
     * 같은 "못 찾았다" 라도 원인이 다르면 다음 행동이 다르다. 상태를 그대로
     * 문장으로 옮기고, 화면이 붙일 버튼을 `action` 으로 지정한다.
     */
    private async notFound(grant: DocumentGrant): Promise<ResolveFlowResult> {
        return { kind: 'none', ...(await this.notFoundParts(grant)) };
    }

    private async notFoundParts(
        grant: DocumentGrant,
    ): Promise<{ message: string; context: CommandErrorContext }> {
        const language = supportedLanguageFor(grant.languageId);
        if (language === null) {
            return {
                message: '이 파일 형식은 심볼 해석을 지원하지 않는다. '
                    + '지원 언어: C/C++·C#·Go·Rust·TypeScript.',
                context: {},
            };
        }
        const status = this.options.lspStatus(language);
        const context: CommandErrorContext = {
            language,
            lspState: status.state,
            verified: status.verified,
        };

        if (!status.enabled) {
            return {
                message: '이 언어의 언어 서버가 설정에서 꺼져 있다.',
                context: { ...context, action: 'openDiagnostics' },
            };
        }
        if (language === 'csharp'
            && this.options.getSettings().languages.csharp.solutionPath === null) {
            const candidates = await this.options.solutionCandidateCount().catch(() => 0);
            if (candidates > 1) {
                return {
                    message: `C# 솔루션을 고르지 않았다. 후보가 ${candidates}개다. `
                        + '진단 화면에서 하나를 고른다.',
                    context: { ...context, action: 'chooseSolution' },
                };
            }
        }
        switch (status.state) {
            case 'starting':
                return {
                    message: '언어 서버가 뜨는 중이다. 큰 프로젝트는 첫 요청까지 '
                        + '수십 초 걸린다.',
                    context: { ...context, action: 'retry' },
                };
            case 'failed':
            case 'stopped':
                return {
                    message: status.lastError
                        ? `언어 서버가 멎었다 — ${status.lastError}`
                        : '언어 서버가 멎었다.',
                    context: { ...context, action: 'openDiagnostics' },
                };
            case 'ready':
                return status.verified
                    ? {
                        message: '언어 서버가 정의를 돌려주지 않았다. 헤더 파일이나 '
                            + '생성 코드일 수 있다.',
                        context,
                    }
                    : {
                        message: '언어 서버는 떠 있지만 아직 실제 요청으로 확인하지 않았다.',
                        context: { ...context, action: 'verify' },
                    };
            default:
                return {
                    message: '언어 서버가 아직 뜨지 않았다.',
                    context: { ...context, action: 'retry' },
                };
        }
    }

    /** 오류에 실을 맥락. 메시지는 오류 자신이 갖고 있다. */
    private async contextOf(grant: DocumentGrant): Promise<CommandErrorContext> {
        const language = supportedLanguageFor(grant.languageId);
        if (language === null) {
            return {};
        }
        const status = this.options.lspStatus(language);
        return {
            language,
            lspState: status.state,
            verified: status.verified,
            action: status.state === 'failed' || status.state === 'stopped'
                ? 'openDiagnostics'
                : 'retry',
        };
    }

    /**
     * 트리에 붙인다. 같은 부모에 같은 심볼이 이미 있으면 그 노드로 보낸다
     * (구현서 13.5 5~6단계).
     */
    private async attach(
        trailId: string,
        baseRevision: number,
        parentId: string,
        symbol: ResolvedSymbol,
        origin: TrailOrigin | null,
    ): Promise<ResolveFlowResult> {
        const trail = this.options.trails.get(trailId);
        const existing = trail?.findExistingChild(parentId, symbol);
        if (existing) {
            return { kind: 'existing', nodeId: existing.id };
        }

        let added: TrailNode | undefined;
        const result = await this.options.trails.mutate(trailId, baseRevision, (current) => {
            // 큐 안에서 다시 본다. 기다리는 동안 다른 명령이 같은 것을 붙였을 수 있다.
            const again = current.findExistingChild(parentId, symbol);
            if (again) {
                added = again;
                return false;
            }
            added = current.addChild(parentId, symbol, origin ?? { line: 0, char: 0, text: '' });
            return added !== undefined;
        });
        if (!result.ok) {
            return { kind: 'error', error: result.error };
        }
        if (!added) {
            return { kind: 'none', message: '노드를 붙이지 못했다.', context: {} };
        }
        // 큐 안에서 중복을 발견해 안 붙인 경우.
        if (!isSameSymbol(added.symbol, symbol) || added.parentId !== parentId) {
            return { kind: 'existing', nodeId: added.id };
        }
        return {
            kind: 'added',
            parentId,
            node: added,
            revision: result.value.revision,
        };
    }

    private remember(
        trailId: string,
        nodeId: string | null,
        origin: TrailOrigin | null,
        candidates: LocationCandidate[],
    ): ResolveFlowResult {
        const choiceId = randomUUID();
        this.pending.set(choiceId, {
            trailId,
            nodeId,
            origin,
            candidates,
            createdAt: Date.now(),
        });
        this.trimPending();
        return { kind: 'choice', choiceId, nodeId, origin, candidates };
    }

    /** 답이 안 오는 물음이 쌓이지 않게 오래된 것부터 버린다. */
    private trimPending(): void {
        while (this.pending.size > MAX_PENDING_CHOICES) {
            const oldest = this.pending.keys().next();
            if (oldest.done) {
                break;
            }
            this.pending.delete(oldest.value);
        }
    }

    /**
     * 노드가 가리키는 문서 권한.
     *
     * 프로젝트 안 파일은 상대경로로 다시 발급받는다. 프로젝트 밖 파일은 세션에
     * 남아 있는 권한이 있을 때만 열 수 있다 — 재시작 후에는 저장된 스냅샷만
     * 보이고 다시 열기는 막힌다(구현서 8.2 6단계).
     */
    private async grantOf(symbol: ResolvedSymbol): Promise<DocumentGrant | undefined> {
        if (symbol.documentId !== null) {
            const existing = this.options.documents.get(symbol.documentId);
            if (existing) {
                return existing;
            }
        }
        if (symbol.relPath === null) {
            return undefined;
        }
        // 저장된 트레일을 다시 연 경우다. 상대경로로 권한을 새로 받는다 —
        // 경계 검사와 심볼릭 링크 확인을 그대로 다시 통과해야 한다.
        return this.options.documents
            .grantInsideProject(symbol.relPath)
            .catch(() => undefined);
    }
}

function notFound(what: string): CommandError {
    return { code: 'NOT_FOUND', message: `${what}을 찾을 수 없다.`, retryable: false };
}

function toCommandError(error: unknown, context: CommandErrorContext): CommandError {
    if (error instanceof LspTimeoutError) {
        return {
            code: 'LSP_TIMEOUT',
            message: '언어 서버가 제때 답하지 않았다. 프로젝트를 아직 읽는 중일 수 있다.',
            retryable: true,
            context: { ...context, action: 'retry' },
        };
    }
    if (error instanceof LspUnavailableError) {
        return {
            code: 'LSP_UNAVAILABLE',
            message: error.message,
            // 죽은 서버는 다시 뜬다. 사용자가 다시 눌러볼 여지를 남긴다.
            retryable: true,
            context: { ...context, action: 'openDiagnostics' },
        };
    }
    return {
        code: 'INTERNAL_ERROR',
        message: '심볼을 해석하지 못했다.',
        retryable: true,
        context,
    };
}
