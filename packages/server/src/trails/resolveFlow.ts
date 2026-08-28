import { randomUUID } from 'node:crypto';

import {
    isSameSymbol,
    type CommandError,
    type ProjectSettings,
    type ResolvedSymbol,
    type TrailNode,
    type TrailOrigin,
} from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { LspTimeoutError, LspUnavailableError } from '../lsp/types.js';
import type { LocationCandidate, SymbolResolver } from '../symbols/resolver.js';
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
    createdAt: number;
}

/** 동시에 기억하는 물음 수. 사용자가 대화상자를 닫아버리면 답이 안 온다. */
const MAX_PENDING_CHOICES = 32;

export type ResolveFlowResult =
    | { kind: 'added'; parentId: string; node: TrailNode; revision: number }
    | { kind: 'existing'; nodeId: string }
    | { kind: 'choice'; choiceId: string; nodeId: string | null; candidates: LocationCandidate[] }
    | { kind: 'none' }
    | { kind: 'error'; error: CommandError };

/**
 * 자동 추적 결과. 선언 노드에 이어 붙인 구현이 있으면 함께 돌려준다.
 * 없으면 왜 없는지(후보 0개 / 여러 개)를 알려준다 — 화면이 안내를 띄운다.
 */
export interface AutoFollowResult {
    node: TrailNode | undefined;
    candidateCount: number;
}

export interface ResolveFlowOptions {
    trails: TrailService;
    resolver: SymbolResolver;
    documents: DocumentRegistry;
    logger: Logger;
    getSettings: () => ProjectSettings;
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
                return { kind: 'none' };
            }
            if (outcome.kind === 'candidates') {
                return this.remember(args.trailId, args.nodeId, origin, outcome.candidates);
            }
            return this.attach(args.trailId, args.baseRevision, args.nodeId, outcome.symbol, origin);
        } catch (error) {
            return { kind: 'error', error: toCommandError(error) };
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
                return { kind: 'none' };
            }
            return this.attachRoot(args.trailId, args.baseRevision, symbol);
        } catch (error) {
            return { kind: 'error', error: toCommandError(error) };
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
            return { kind: 'none' };
        }
        return { kind: 'added', parentId: '', node: added, revision: result.value.revision };
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

        const candidate = choice.candidates.find((c) => c.candidateId === args.candidateId);
        if (!candidate) {
            return { kind: 'error', error: notFound('후보') };
        }

        try {
            const symbol = await this.options.resolver.resolveCandidate(candidate);
            if (!symbol) {
                return { kind: 'none' };
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
            return { kind: 'error', error: toCommandError(error) };
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
        | { kind: 'none' }
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
                return { kind: 'none' };
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
            return { kind: 'error', error: toCommandError(error) };
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
            return { node: undefined, candidateCount: 0 };
        }
        const trail = this.options.trails.get(args.trailId);
        const node = trail?.get(args.nodeId);
        if (!trail || !node || !node.symbol.declarationOnly) {
            return { node: undefined, candidateCount: 0 };
        }
        const grant = await this.grantOf(node.symbol);
        if (!grant) {
            return { node: undefined, candidateCount: 0 };
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
            return { node: undefined, candidateCount: 0 };
        }

        const withBody = found.symbols.filter((symbol) => !symbol.declarationOnly);
        if (withBody.length !== 1) {
            // 0개면 붙일 것이 없고, 2개 이상이면 고를 수 없다. 둘 다 손대지 않는다.
            return { node: undefined, candidateCount: withBody.length };
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
            return { node: undefined, candidateCount: 1 };
        }
        const parent = result.value.trail.get(args.nodeId);
        const children = parent?.children ?? [];
        return { node: children[children.length - 1], candidateCount: 1 };
    }

    // ── 내부 ────────────────────────────────────────────────────────────────

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
            return { kind: 'none' };
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
        // 답이 안 오는 물음이 쌓이지 않게 오래된 것부터 버린다.
        while (this.pending.size > MAX_PENDING_CHOICES) {
            const oldest = this.pending.keys().next();
            if (oldest.done) {
                break;
            }
            this.pending.delete(oldest.value);
        }
        return { kind: 'choice', choiceId, nodeId, candidates };
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

function toCommandError(error: unknown): CommandError {
    if (error instanceof LspTimeoutError) {
        return {
            code: 'LSP_TIMEOUT',
            message: '언어 서버가 제때 답하지 않았다. 프로젝트를 아직 읽는 중일 수 있다.',
            retryable: true,
        };
    }
    if (error instanceof LspUnavailableError) {
        return {
            code: 'LSP_UNAVAILABLE',
            message: error.message,
            // 죽은 서버는 다시 뜬다. 사용자가 다시 눌러볼 여지를 남긴다.
            retryable: true,
        };
    }
    return {
        code: 'INTERNAL_ERROR',
        message: '심볼을 해석하지 못했다.',
        retryable: true,
    };
}
