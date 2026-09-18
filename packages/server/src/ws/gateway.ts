import type { WebSocket } from 'ws';

import {
    PROTOCOL_VERSION,
    isStructureCommand,
    newEventId,
    parseClientCommand,
    toStoredTrail,
    type ClientCommand,
    type CommandError,
    type EventType,
    type ChildOrder,
    type RemovedSubtree,
    type Trail,
    type TrailNode,
    type AnalysisDocument,
    type AnnotationTarget,
    type Author,
    type CodeRange,
    type ShareExportPolicy,
    type WalkthroughStep,
} from '@code-trail/shared';

import type { ServerContext } from '../context.js';
import { EditorDeniedError } from '../editor/service.js';
import type { SupportedLanguage } from '../workspace/languages.js';
import type { ResolveFlowResult } from '../trails/resolveFlow.js';
import { contextForRange, createBaselineFile, reanchor, sha256 } from '../analysis/baselines.js';

/**
 * WebSocket 게이트웨이.
 *
 * 도메인 규칙을 여기서 구현하지 않는다(구현서 5.2). 하는 일은 셋이다.
 *
 * 1. 받은 값을 스키마로 통과시켜 명령으로 만든다.
 * 2. 같은 `commandId` 를 두 번 처리하지 않는다.
 * 3. 결과 이벤트를 **연결된 모든 탭**에 뿌린다.
 *
 * 3번이 핵심이다. 브라우저 탭 여러 개가 같은 서버를 보고 있고, 한 탭에서 바꾼
 * 것이 다른 탭에도 즉시 보여야 한다. 그래서 이벤트는 명령을 보낸 연결이 아니라
 * 전체에 나간다 — 보낸 쪽은 `commandId` 로 자기 것을 알아본다.
 */

/** 중복 처리를 막기 위해 기억하는 최근 commandId 수. */
const RECENT_COMMAND_LIMIT = 512;

interface Client {
    socket: WebSocket;
    id: number;
}

export class WebSocketGateway {
    private readonly clients = new Set<Client>();
    private readonly recentCommands = new Set<string>();
    private nextClientId = 1;
    /**
     * 종료 절차가 시작됐다.
     *
     * 여기부터는 새 연결도 새 명령도 받지 않는다. 받아 두면 저장을 이미 끝낸
     * 뒤에 트레일이 또 바뀌고, 그 변경은 어디에도 남지 않는다.
     */
    private stopping = false;
    private readonly anchorCandidates = new Map<string, {
        analysisId: string; anchorId: string; documentId: string;
        range: CodeRange; contentHash: string;
    }>();

    constructor(private readonly context: ServerContext) {}

    get clientCount(): number {
        return this.clients.size;
    }

    get isStopping(): boolean {
        return this.stopping;
    }

    /** 새 연결. 인증은 이 함수를 부르기 전에 끝나 있어야 한다. */
    accept(socket: WebSocket): void {
        if (this.stopping) {
            // 1001 = going away
            socket.close(1001, 'server stopping');
            return;
        }
        const client: Client = { socket, id: this.nextClientId++ };
        this.clients.add(client);
        this.context.logger.debug('웹소켓이 붙었다.', { clientId: client.id });

        socket.on('message', (raw: unknown) => {
            void this.onMessage(client, String(raw));
        });
        socket.on('close', () => {
            this.clients.delete(client);
            this.context.logger.debug('웹소켓이 끊겼다.', { clientId: client.id });
        });
        socket.on('error', () => {
            this.clients.delete(client);
        });

        void this.sendSnapshots(client);
    }

    /** 모든 연결을 닫는다. 종료 절차가 부른다. */
    closeAll(): void {
        this.stopping = true;
        this.broadcast('server.stopping' as EventType, {}, {});
        for (const client of this.clients) {
            client.socket.close(1001, 'server stopping');
        }
        this.clients.clear();
    }

    // ── 보내기 ──────────────────────────────────────────────────────────────

    private send(client: Client, payload: unknown): void {
        // readyState 1 = OPEN. 닫히는 중인 소켓에 쓰면 예외가 난다.
        if (client.socket.readyState !== 1) {
            return;
        }
        client.socket.send(JSON.stringify(payload));
    }

    broadcast(
        type: EventType | 'server.stopping',
        payload: unknown,
        meta: { commandId?: string; trailId?: string; revision?: number },
    ): void {
        const event = {
            protocolVersion: PROTOCOL_VERSION,
            type,
            eventId: newEventId(),
            ...meta,
            payload,
        };
        for (const client of this.clients) {
            this.send(client, event);
        }
    }

    private sendError(client: Client, error: CommandError, commandId?: string): void {
        this.send(client, {
            protocolVersion: PROTOCOL_VERSION,
            type: 'command.error',
            eventId: newEventId(),
            ...(commandId !== undefined ? { commandId } : {}),
            payload: { error },
        });
    }

    /**
     * `revealInExternalEditorOnAdd` 가 켜져 있으면 새 노드의 위치를 외부
     * 에디터에서도 연다. 설정이 꺼져 있거나 에디터가 없으면 아무 일도 안 한다 —
     * 사용자가 정하기 전에는 실행하지 않는다(구현서 17.2 3단계).
     */
    private async revealIfAsked(
        symbol: { documentId: string | null; anchorLine: number; anchorChar: number } | undefined,
        commandId: string,
    ): Promise<void> {
        if (symbol === undefined || symbol.documentId === null) {
            return;
        }
        if (!this.context.store.getSettings().ui.revealInExternalEditorOnAdd) {
            return;
        }
        if (!this.context.editor.isConfigured()) {
            return;
        }
        try {
            const opened = await this.context.editor.open(
                symbol.documentId,
                symbol.anchorLine,
                symbol.anchorChar,
            );
            this.broadcast('editor.opened', {
                displayPath: opened.displayPath,
                line: opened.line,
                column: opened.column,
                launched: opened.launched,
                reason: opened.reason,
            }, { commandId });
        } catch {
            // 노드를 붙이는 일이 에디터 때문에 실패하면 안 된다.
        }
    }

    private snapshotPayload(trail: Trail): unknown {
        const stored = toStoredTrail(trail);
        return {
            id: stored.id,
            title: stored.title,
            revision: stored.revision,
            mode: stored.mode,
            childOrder: stored.childOrder ?? null,
            activeNodeId: stored.activeNodeId,
            roots: trail.roots,
            nodeUi: stored.nodeUi,
        };
    }

    /**
     * 저장에서 불러온 노드에 문서 권한을 다시 발급한다 (구현서 8.2).
     *
     * `documentId` 는 세션 전용이라 저장하지 않는다. 다시 채워주지 않으면 `↗`
     * 와 Ctrl+클릭이 재시작 뒤에 조용히 아무 일도 안 한다.
     *
     * **프로젝트 밖 파일은 다시 열어주지 않는다.** 그건 언어 서버가 결과로
     * 돌려줬을 때만 얻는 권한이고, 재시작하면 사라지는 것이 맞다.
     * 같은 파일이 여러 노드에 나오므로 경로별로 한 번만 발급한다.
     */
    private async grantMapFor(roots: readonly TrailNode[]): Promise<Map<string, string>> {
        const wanted = new Set<string>();
        const walk = (nodes: readonly TrailNode[]): void => {
            for (const node of nodes) {
                const { symbol } = node;
                if (symbol.documentId === null && symbol.relPath !== null && !symbol.external) {
                    wanted.add(symbol.relPath);
                }
                walk(node.children);
            }
        };
        walk(roots);

        const map = new Map<string, string>();
        for (const relPath of wanted) {
            const grant = await this.context.documents
                .grantInsideProject(relPath)
                .catch(() => null);
            if (grant !== null) {
                map.set(relPath, grant.documentId);
            }
        }
        return map;
    }

    private static applyGrants(
        nodes: readonly TrailNode[],
        grants: ReadonlyMap<string, string>,
    ): TrailNode[] {
        return nodes.map((node) => {
            const documentId = node.symbol.documentId
                ?? (node.symbol.relPath === null ? null : grants.get(node.symbol.relPath) ?? null);
            return {
                ...node,
                symbol: { ...node.symbol, documentId },
                children: WebSocketGateway.applyGrants(node.children, grants),
            };
        });
    }

    private async snapshotPayloadWithGrants(trail: Trail): Promise<unknown> {
        const grants = await this.grantMapFor(trail.roots);
        const payload = this.snapshotPayload(trail) as { roots: TrailNode[] };
        return { ...payload, roots: WebSocketGateway.applyGrants(trail.roots, grants) };
    }

    /** 붙자마자 지금 상태를 통째로 보낸다. 재연결 복구도 같은 길을 쓴다. */
    private async sendSnapshots(client: Client): Promise<void> {
        this.send(client, {
            protocolVersion: PROTOCOL_VERSION,
            type: 'trail.listChanged',
            eventId: newEventId(),
            payload: {
                trails: this.context.trails.list(),
                activeTrailId: this.context.trails.getActiveTrailId(),
            },
        });
        const activeId = this.context.trails.getActiveTrailId();
        const active = activeId ? this.context.trails.get(activeId) : undefined;
        if (active) {
            this.send(client, {
                protocolVersion: PROTOCOL_VERSION,
                type: 'trail.snapshot',
                eventId: newEventId(),
                trailId: active.id,
                revision: active.revision,
                payload: await this.snapshotPayloadWithGrants(active),
            });
        }
        this.send(client, {
            protocolVersion: PROTOCOL_VERSION,
            type: 'analysis.listChanged',
            eventId: newEventId(),
            payload: { analyses: this.context.analyses.list() },
        });
        for (const summary of this.context.analyses.list()) {
            const analysis = this.context.analyses.get(summary.id);
            if (analysis) this.send(client, {
                protocolVersion: PROTOCOL_VERSION,
                type: 'analysis.snapshot',
                eventId: newEventId(),
                payload: { analysis },
            });
        }
    }

    private analysisChanged(
        eventType: 'annotation.created' | 'annotation.updated' | 'annotation.deleted'
            | 'annotation.restored' | 'review.changed' | 'anchor.checked'
            | 'anchor.rebound' | 'walkthrough.changed',
        document: AnalysisDocument,
        entityId: string,
        commandId: string,
    ): void {
        const entityKey = eventType.startsWith('annotation.') ? 'annotationId'
            : eventType === 'review.changed' ? 'reviewId'
                : eventType.startsWith('anchor.') ? 'anchorId' : 'walkthroughId';
        this.broadcast(eventType, { analysisId: document.id, [entityKey]: entityId }, { commandId });
        this.broadcast('analysis.snapshot', { analysis: document }, { commandId });
        this.broadcast('analysis.persisted', { analysisId: document.id, revision: document.revision }, { commandId });
        this.broadcast('analysis.listChanged', { analyses: this.context.analyses.list() }, {});
    }

    // ── 받기 ────────────────────────────────────────────────────────────────

    private async onMessage(client: Client, raw: string): Promise<void> {
        if (this.stopping) {
            // 저장은 이미 끝났다. 여기서 받아 처리하면 그 변경은 어디에도 안 남는다.
            this.sendError(client, {
                code: 'SERVER_STOPPING',
                message: '서버가 닫히는 중이다. 이 명령은 저장되지 않는다.',
                retryable: false,
            });
            return;
        }
        let parsedJson: unknown;
        try {
            parsedJson = JSON.parse(raw);
        } catch {
            this.sendError(client, {
                code: 'INVALID_COMMAND',
                message: 'JSON 이 아니다.',
                retryable: false,
            });
            return;
        }

        const parsed = parseClientCommand(parsedJson);
        if (!parsed.ok) {
            const commandId = (parsedJson as { commandId?: unknown }).commandId;
            this.sendError(
                client,
                parsed.error,
                typeof commandId === 'string' ? commandId : undefined,
            );
            return;
        }
        const command = parsed.value;

        // 같은 commandId 재전송은 한 번만 처리한다(구현서 14.1).
        // 재연결 후 클라이언트가 처리 중이던 명령을 다시 보내기 때문이다.
        if (this.recentCommands.has(command.commandId)) {
            this.context.logger.debug('이미 처리한 명령이다.', { commandId: command.commandId });
            return;
        }
        this.remember(command.commandId);

        try {
            await this.dispatch(client, command);
        } catch (error) {
            this.context.logger.error('명령 처리 중 오류가 났다.', {
                type: command.type,
                reason: error instanceof Error ? error.message : String(error),
            });
            this.sendError(
                client,
                {
                    code: 'INTERNAL_ERROR',
                    message: '명령을 처리하지 못했다.',
                    retryable: true,
                },
                command.commandId,
            );
        }
    }

    private remember(commandId: string): void {
        this.recentCommands.add(commandId);
        if (this.recentCommands.size > RECENT_COMMAND_LIMIT) {
            const oldest = this.recentCommands.values().next();
            if (!oldest.done) {
                this.recentCommands.delete(oldest.value);
            }
        }
    }

    /** 구조 명령이 오래된 revision 을 들고 왔을 때 최신 상태를 되돌려준다. */
    private sendStaleRecovery(client: Client, trailId: string, error: CommandError, commandId: string): void {
        this.sendError(client, error, commandId);
        const trail = this.context.trails.get(trailId);
        if (trail) {
            this.send(client, {
                protocolVersion: PROTOCOL_VERSION,
                type: 'trail.snapshot',
                eventId: newEventId(),
                trailId: trail.id,
                revision: trail.revision,
                payload: this.snapshotPayload(trail),
            });
        }
    }

    /**
     * 해석 명령 하나를 돌린다.
     *
     * 셋 다 같은 모양이라 한곳에 모았다 — 노드에 진행 표시를 켜고, 결과에 따라
     * 이벤트를 뿌리고, 무슨 일이 있어도 진행 표시를 끈다. `finally` 가 핵심이다.
     * 여기서 빠뜨리면 실패한 노드가 영원히 도는 표시를 달고 남는다.
     */
    private async runResolve(
        client: Client,
        command: ClientCommand,
        trailId: string,
        busyNodeId: string | null,
        run: () => Promise<ResolveFlowResult>,
    ): Promise<void> {
        if (busyNodeId !== null) {
            this.broadcast('trail.nodeBusy', { nodeId: busyNodeId, on: true }, { trailId });
        }
        try {
            const result = await run();

            switch (result.kind) {
                case 'error':
                    if (result.error.code === 'STALE_REVISION') {
                        this.sendStaleRecovery(client, trailId, result.error, command.commandId);
                        return;
                    }
                    this.sendError(client, result.error, command.commandId);
                    return;

                case 'none':
                    // 왜 못 찾았는지를 그대로 전한다. 한 줄로 뭉뚱그리면 사용자가
                    // 다음에 무엇을 할지 정할 수 없다(U01).
                    this.sendError(
                        client,
                        {
                            code: 'NOT_FOUND',
                            message: result.message,
                            retryable: result.context.action === 'retry',
                            context: result.context,
                        },
                        command.commandId,
                    );
                    return;

                case 'existing':
                    // 이미 붙어 있다. 새로 만들지 않고 그 노드로 보낸다.
                    this.broadcast('trail.activeNodeChanged', { nodeId: result.nodeId }, {
                        commandId: command.commandId,
                        trailId,
                    });
                    return;

                case 'choice':
                    // **자동으로 고르지 않는다.** 사용자에게 넘긴다.
                    // 클릭한 지점을 함께 보내 화면이 그 토큰 바로 아래에 띄운다(U09).
                    this.broadcast('trail.definitionChoice', {
                        choiceId: result.choiceId,
                        nodeId: result.nodeId,
                        origin: result.origin,
                        title: result.origin === null
                            ? `정의 후보 ${result.candidates.length}개`
                            : `『${result.origin.text}』의 정의 후보 ${result.candidates.length}개`,
                        candidates: result.candidates.map((candidate) => ({
                            candidateId: candidate.candidateId,
                            name: candidate.name,
                            displayPath: candidate.displayPath,
                            line: candidate.line,
                            hasBody: candidate.hasBody,
                        })),
                    }, { commandId: command.commandId, trailId });
                    return;

                case 'refreshed': {
                    // 이 노드는 이제 현재 코드다. `바뀜` 배지를 떼라고 알린다.
                    this.broadcast('trail.nodesStale', {
                        trailId,
                        nodeIds: [],
                        cleared: [result.nodeId],
                    }, { trailId });
                    // 본문이 통째로 바뀌었다. 부분 갱신 대신 다시 그리게 한다.
                    const refreshed = this.context.trails.get(trailId);
                    if (refreshed) {
                        this.broadcast(
                            'trail.snapshot',
                            await this.snapshotPayloadWithGrants(refreshed),
                            {
                                commandId: command.commandId,
                                trailId,
                                revision: result.revision,
                            },
                        );
                    }
                    return;
                }

                case 'added': {
                    const eventType = result.parentId === ''
                        ? 'trail.rootAdded'
                        : 'trail.nodeAdded';
                    const payload = result.parentId === ''
                        ? { node: result.node }
                        : { parentId: result.parentId, node: result.node };
                    this.broadcast(eventType, payload, {
                        commandId: command.commandId,
                        trailId,
                        revision: result.revision,
                    });
                    await this.afterNodeAdded(trailId, result.node.id, command.commandId);
                    return;
                }

                default:
                    return;
            }
        } finally {
            if (busyNodeId !== null) {
                this.broadcast('trail.nodeBusy', { nodeId: busyNodeId, on: false }, { trailId });
            }
        }
    }

    /**
     * 붙인 노드가 선언뿐이면 구현을 한 단계 더 따라간다 (구현서 13.5 8~9단계).
     *
     * 몸통 있는 후보가 **정확히 하나**일 때만 붙는다. 여러 개면 붙이지 않고
     * 그 사실만 알린다 — 화면은 `선언만` 배지와 `⚑` 를 그대로 둔다.
     */
    private async afterNodeAdded(
        trailId: string,
        nodeId: string,
        commandId: string,
    ): Promise<void> {
        const trail = this.context.trails.get(trailId);
        const node = trail?.get(nodeId);
        await this.revealIfAsked(node?.symbol, commandId);
        if (!node?.symbol.declarationOnly) {
            return;
        }
        const followed = await this.context.resolveFlow.autoFollowSingleImplementation({
            trailId,
            nodeId,
        });
        if (followed.node) {
            this.broadcast('trail.nodeAdded', { parentId: nodeId, node: followed.node }, {
                commandId,
                trailId,
                revision: this.context.trails.get(trailId)?.revision ?? 0,
            });
            return;
        }
        if (followed.candidateCount > 1) {
            // 고르지는 않되, 고를 수 있게 목록을 그 자리에 띄운다(U09).
            // `⚑` 를 한 번 더 누르라고만 알리던 자리다.
            const choice = this.context.resolveFlow.rememberImplementationChoice({
                trailId,
                nodeId,
                symbols: followed.candidates,
            });
            this.broadcast('trail.implementationChoice', {
                nodeId,
                choiceId: choice.choiceId,
                title: `『${node.symbol.name}』의 구현 ${choice.candidates.length}개`,
                truncated: false,
                candidates: choice.candidates,
            }, { commandId, trailId });
        }
    }

    private async dispatch(client: Client, command: ClientCommand): Promise<void> {
        const { trails } = this.context;

        if (this.context.readOnlyShare && ![
            'trail.select', 'trail.toggleNode', 'trail.setMode', 'trail.setActiveNode',
            'trail.setChildOrder',
            'trail.exportMarkdown', 'share.prepare', 'share.export',
            'settings.updateLocalAuthor',
        ].includes(command.type)) {
            this.sendError(client, {
                code: 'UNAUTHORIZED',
                message: '공유 읽기 모드에서는 원본 자료를 바꿀 수 없다.',
                retryable: false,
            }, command.commandId);
            return;
        }

        // 구조 명령은 대상 트레일과 baseRevision 이 둘 다 있어야 한다.
        // 스키마가 baseRevision 은 이미 확인했고, trailId 는 여기서 본다.
        if (isStructureCommand(command.type) && command.type !== 'trail.create') {
            if (command.trailId === undefined) {
                this.sendError(
                    client,
                    { code: 'INVALID_COMMAND', message: '대상 트레일이 없다.', retryable: false },
                    command.commandId,
                );
                return;
            }
        }

        switch (command.type) {
            case 'trail.create': {
                const payload = command.payload as { title?: string };
                const created = await trails.create(payload.title);
                this.broadcast('trail.listChanged', {
                    trails: trails.list(),
                    activeTrailId: trails.getActiveTrailId(),
                }, { commandId: command.commandId });
                this.broadcast('trail.snapshot', this.snapshotPayload(created.trail), {
                    commandId: command.commandId,
                    trailId: created.trail.id,
                    revision: created.revision,
                });
                return;
            }

            case 'trail.rename': {
                const trailId = command.trailId as string;
                const { title } = command.payload as { title: string };
                const result = await trails.mutate(
                    trailId,
                    command.baseRevision as number,
                    (trail) => trail.setTitle(title),
                );
                if (!result.ok) {
                    this.sendStaleRecovery(client, trailId, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.renamed', { title }, {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                this.broadcast('trail.listChanged', {
                    trails: trails.list(),
                    activeTrailId: trails.getActiveTrailId(),
                }, {});
                return;
            }

            case 'trail.delete': {
                const trailId = command.trailId as string;
                const result = await trails.remove(trailId);
                if (!result.ok) {
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.listChanged', {
                    trails: trails.list(),
                    activeTrailId: trails.getActiveTrailId(),
                }, { commandId: command.commandId });
                return;
            }

            case 'trail.select': {
                const trailId = command.trailId as string;
                const result = trails.select(trailId);
                if (!result.ok) {
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                const trail = trails.get(trailId) as Trail;
                this.broadcast('trail.snapshot', await this.snapshotPayloadWithGrants(trail), {
                    commandId: command.commandId,
                    trailId,
                    revision: trail.revision,
                });
                this.broadcast('trail.listChanged', {
                    trails: trails.list(),
                    activeTrailId: trails.getActiveTrailId(),
                }, {});
                return;
            }

            case 'trail.removeNode': {
                const trailId = command.trailId as string;
                const { nodeId } = command.payload as { nodeId: string };
                let removed: RemovedSubtree | undefined;
                const result = await trails.mutate(
                    trailId,
                    command.baseRevision as number,
                    (trail) => {
                        removed = trail.remove(nodeId);
                        return removed !== undefined;
                    },
                );
                if (!result.ok) {
                    this.sendStaleRecovery(client, trailId, result.error, command.commandId);
                    return;
                }
                // 되돌리기는 서버가 한다. 정본이 서버에 있으니 다른 탭에서 지운 것도
                // 같은 길로 되살아난다(U03).
                if (removed) {
                    trails.rememberRemoved(trailId, removed);
                }
                this.broadcast('trail.nodeRemoved', {
                    nodeId,
                    ...(removed ? { name: removed.root.symbol.name, count: removed.count } : {}),
                    undoable: removed !== undefined,
                }, {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                return;
            }

            case 'trail.undoRemove': {
                const trailId = command.trailId as string;
                const { nodeId } = command.payload as { nodeId: string };
                const result = await trails.undoRemove(
                    trailId,
                    command.baseRevision as number,
                    nodeId,
                );
                if (!result.ok) {
                    if (result.error.code === 'STALE_REVISION') {
                        this.sendStaleRecovery(client, trailId, result.error, command.commandId);
                        return;
                    }
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                // 되살린 서브트리가 통째로 돌아왔다. snapshot 으로 다시 그리게 한다.
                this.broadcast(
                    'trail.snapshot',
                    await this.snapshotPayloadWithGrants(result.value.trail),
                    {
                        commandId: command.commandId,
                        trailId,
                        revision: result.value.revision,
                    },
                );
                return;
            }

            case 'trail.refreshNode': {
                const trailId = command.trailId as string;
                const { nodeId } = command.payload as { nodeId: string };
                await this.runResolve(client, command, trailId, nodeId, () =>
                    this.context.resolveFlow.refreshNode({
                        trailId,
                        baseRevision: command.baseRevision as number,
                        nodeId,
                    }));
                return;
            }

            case 'trail.setChildOrder': {
                const trailId = command.trailId as string;
                const { childOrder } = command.payload as { childOrder: ChildOrder | null };
                const result = await trails.setChildOrder(trailId, childOrder);
                if (!result.ok) {
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.childOrderChanged', { childOrder }, {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                return;
            }

            case 'trail.toggleNode': {
                const trailId = command.trailId as string;
                const { nodeId, collapsed } = command.payload as {
                    nodeId: string;
                    collapsed: boolean;
                };
                const result = await trails.updateUi(
                    trailId,
                    (trail) => trail.setCollapsed(nodeId, collapsed),
                );
                if (!result.ok) {
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.nodeToggled', { nodeId, collapsed }, {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                return;
            }

            case 'trail.promoteToRoot': {
                const trailId = command.trailId as string;
                const { nodeId } = command.payload as { nodeId: string };
                const result = await trails.mutate(
                    trailId,
                    command.baseRevision as number,
                    (trail) => trail.promoteToRoot(nodeId) !== undefined,
                );
                if (!result.ok) {
                    this.sendStaleRecovery(client, trailId, result.error, command.commandId);
                    return;
                }
                // 트리 모양이 바뀌었다. 부분 갱신 대신 통째로 다시 그리게 한다.
                this.broadcast('trail.nodePromoted', { nodeId }, {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                this.broadcast('trail.snapshot', this.snapshotPayload(result.value.trail), {
                    trailId,
                    revision: result.value.revision,
                });
                return;
            }

            case 'trail.clear': {
                const trailId = command.trailId as string;
                const result = await trails.mutate(
                    trailId,
                    command.baseRevision as number,
                    (trail) => trail.clear(),
                );
                if (!result.ok) {
                    this.sendStaleRecovery(client, trailId, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.snapshot', this.snapshotPayload(result.value.trail), {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                return;
            }

            case 'trail.setMode': {
                const trailId = command.trailId as string;
                const { mode } = command.payload as { mode: 'tree' | 'board' };
                const result = await trails.setMode(trailId, mode);
                if (!result.ok) {
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.modeChanged', { mode }, {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                return;
            }

            case 'trail.setNodeUi': {
                const trailId = command.trailId as string;
                const { nodeId, patch } = command.payload as {
                    nodeId: string;
                    patch: Record<string, number | null>;
                };
                const result = await trails.setNodeUi(trailId, nodeId, patch);
                if (!result.ok) {
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.nodeUiChanged', {
                    nodeId,
                    state: result.value.trail.getNodeUi(nodeId) ?? null,
                }, {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                return;
            }

            case 'trail.setActiveNode': {
                const trailId = command.trailId as string;
                const { nodeId } = command.payload as { nodeId: string | null };
                const result = await trails.setActiveNode(trailId, nodeId);
                if (!result.ok) {
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.activeNodeChanged', { nodeId }, {
                    commandId: command.commandId,
                    trailId,
                    revision: result.value.revision,
                });
                return;
            }

            case 'trail.exportMarkdown': {
                const trailId = command.trailId as string;
                const result = trails.markdown(trailId);
                if (!result.ok) {
                    this.sendError(client, result.error, command.commandId);
                    return;
                }
                const trail = trails.get(trailId) as Trail;
                this.broadcast('trail.exportReady', {
                    trailId,
                    url: `/api/trails/${trailId}/export.md`,
                    fileName: `${trail.title}.md`,
                }, { commandId: command.commandId, trailId });
                return;
            }

            case 'settings.update': {
                const { settings } = command.payload as {
                    settings: ReturnType<ServerContext['store']['getSettings']>;
                };
                await this.context.store.saveSettings(settings);
                this.broadcast('settings.changed', { settings }, {
                    commandId: command.commandId,
                });
                return;
            }

            case 'trail.resolve': {
                const trailId = command.trailId as string;
                const payload = command.payload as {
                    nodeId: string;
                    line: number;
                    char: number;
                    text: string;
                };
                await this.runResolve(client, command, trailId, payload.nodeId, () =>
                    this.context.resolveFlow.resolveFromNode({
                        trailId,
                        baseRevision: command.baseRevision as number,
                        nodeId: payload.nodeId,
                        line: payload.line,
                        char: payload.char,
                        text: payload.text,
                        mode: 'definition',
                    }));
                return;
            }

            case 'trail.chooseCandidate': {
                const trailId = command.trailId as string;
                const payload = command.payload as { choiceId: string; candidateId: string };
                await this.runResolve(client, command, trailId, null, () =>
                    this.context.resolveFlow.chooseCandidate({
                        choiceId: payload.choiceId,
                        candidateId: payload.candidateId,
                        baseRevision: command.baseRevision as number,
                    }));
                return;
            }

            case 'trail.addRootAt':
            case 'trail.addRootFromSymbol': {
                const trailId = command.trailId as string;
                const payload = command.payload as {
                    documentId: string;
                    line: number;
                    char: number;
                };
                await this.runResolve(client, command, trailId, null, () =>
                    this.context.resolveFlow.addRootAt({
                        trailId,
                        baseRevision: command.baseRevision as number,
                        documentId: payload.documentId,
                        line: payload.line,
                        char: payload.char,
                    }));
                return;
            }

            case 'trail.resolveImplementations': {
                const trailId = command.trailId as string;
                const { nodeId } = command.payload as { nodeId: string };
                this.broadcast('trail.nodeBusy', { nodeId, on: true }, { trailId });
                try {
                    const result = await this.context.resolveFlow.resolveImplementations({
                        trailId,
                        baseRevision: command.baseRevision as number,
                        nodeId,
                    });
                    if (result.kind === 'error') {
                        this.sendError(client, result.error, command.commandId);
                        return;
                    }
                    if (result.kind === 'none') {
                        this.sendError(
                            client,
                            {
                                code: 'NOT_FOUND',
                                message: `구현을 찾지 못했다. ${result.message}`,
                                retryable: result.context.action === 'retry',
                                context: result.context,
                            },
                            command.commandId,
                        );
                        return;
                    }
                    for (const node of result.nodes) {
                        this.broadcast('trail.nodeAdded', { parentId: nodeId, node }, {
                            commandId: command.commandId,
                            trailId,
                            revision: result.revision,
                        });
                    }
                    if (result.truncated) {
                        this.broadcast('trail.implementationChoice', {
                            nodeId,
                            // 고를 것이 아니라 잘렸다는 알림이다.
                            choiceId: null,
                            truncated: true,
                            candidates: [],
                        }, { commandId: command.commandId, trailId });
                    }
                } finally {
                    this.broadcast('trail.nodeBusy', { nodeId, on: false }, { trailId });
                }
                return;
            }

            case 'lsp.restart': {
                const { language } = command.payload as {
                    language: 'cpp' | 'csharp' | 'go' | 'rust' | 'typescript';
                };
                try {
                    await this.context.lsp.restart(language);
                } catch (error) {
                    this.sendError(
                        client,
                        {
                            code: 'LSP_UNAVAILABLE',
                            message: error instanceof Error
                                ? error.message
                                : '언어 서버를 다시 시작하지 못했다.',
                            retryable: false,
                        },
                        command.commandId,
                    );
                }
                return;
            }

            case 'editor.openLocation': {
                const { documentId, line, char } = command.payload as {
                    documentId: string;
                    line: number;
                    char: number;
                };
                try {
                    // **브라우저가 보낸 경로를 쓰지 않는다.** 서버가 발급한 문서
                    // ID 에서 실제 경로를 역조회한다(구현서 17.2 5단계).
                    const opened = await this.context.editor.open(documentId, line, char);
                    this.broadcast('editor.opened', {
                        displayPath: opened.displayPath,
                        line: opened.line,
                        column: opened.column,
                        launched: opened.launched,
                        reason: opened.reason,
                    }, { commandId: command.commandId });
                } catch (error) {
                    this.sendError(
                        client,
                        {
                            code: 'PATH_DENIED',
                            message: error instanceof EditorDeniedError
                                ? error.message
                                : '외부 에디터를 열지 못했다.',
                            retryable: false,
                        },
                        command.commandId,
                    );
                }
                return;
            }

            case 'lsp.verify': {
                const { language } = command.payload as { language: SupportedLanguage };
                try {
                    // `지원됨` 은 프로세스가 떴다는 뜻이 아니라 실제 요청이
                    // 응답했다는 뜻이다(구현서 18).
                    await this.context.lsp.verify(language);
                    this.broadcast('lsp.stateChanged', {
                        language,
                        state: 'ready',
                        message: null,
                    }, { commandId: command.commandId });
                } catch (error) {
                    this.broadcast('lsp.stateChanged', {
                        language,
                        state: 'failed',
                        message: error instanceof Error
                            ? error.message.slice(0, 300)
                            : '샘플 요청이 실패했다.',
                    }, { commandId: command.commandId });
                }
                return;
            }

            case 'workspace.openDocument':
            case 'workspace.searchFiles':
                // 이 둘은 HTTP 로 처리한다(구현서 15.1). 명령 목록에는 남겨 두되
                // 여기서는 받지 않는다.
                this.sendError(
                    client,
                    {
                        code: 'INVALID_COMMAND',
                        message: '이 동작은 HTTP API 로 처리한다.',
                        retryable: false,
                    },
                    command.commandId,
                );
                return;

            case 'settings.updateLocalAuthor': {
                const { author } = command.payload as { author: Author };
                await this.context.store.saveLocalAuthor(author);
                return;
            }

            case 'analysis.create': {
                const payload = command.payload as {
                    title: string; purpose: string; trailIds: string[]; author: Author;
                };
                const analysis = await this.context.analyses.create(payload);
                this.broadcast('analysis.snapshot', { analysis }, { commandId: command.commandId });
                this.broadcast('analysis.persisted', { analysisId: analysis.id, revision: analysis.revision }, { commandId: command.commandId });
                this.broadcast('analysis.listChanged', { analyses: this.context.analyses.list() }, {});
                return;
            }

            case 'analysis.updatePlan': {
                const payload = command.payload as Parameters<typeof this.context.analyses.updatePlan>[0];
                const result = await this.context.analyses.updatePlan({ ...payload, commandId: command.commandId });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.broadcast('analysis.snapshot', { analysis: result.value.document }, { commandId: command.commandId });
                this.broadcast('analysis.persisted', {
                    analysisId: payload.analysisId, revision: result.value.persistedRevision,
                }, { commandId: command.commandId });
                this.broadcast('analysis.listChanged', { analyses: this.context.analyses.list() }, {});
                return;
            }

            case 'analysis.recover': {
                const payload = command.payload as { analysisId: string; kind: 'temporary' | 'backup' };
                await this.context.analysisStore.recover(payload.analysisId, payload.kind);
                const analysis = await this.context.analyses.reload(payload.analysisId);
                if (!analysis) { this.sendError(client, { code: 'PERSISTENCE_FAILED', message: '복구한 분석 문서를 열지 못했다.', retryable: true }, command.commandId); return; }
                this.broadcast('analysis.snapshot', { analysis }, { commandId: command.commandId });
                this.broadcast('analysis.listChanged', { analyses: this.context.analyses.list() }, {});
                return;
            }

            case 'annotation.create': {
                const payload = command.payload as {
                    analysisId: string; target: AnnotationTarget; body: string;
                    kind: 'explanation' | 'question' | 'concern' | 'conclusion';
                    tags: string[]; author: Author;
                };
                const result = await this.context.analyses.createAnnotation({ ...payload, commandId: command.commandId });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.analysisChanged('annotation.created', result.value.document, result.value.result, command.commandId);
                return;
            }

            case 'annotation.update':
            case 'annotation.setStatus': {
                const payload = command.payload as {
                    analysisId: string; annotationId: string; baseVersion: number; actorId: string;
                    patch: { body?: string; kind?: 'explanation' | 'question' | 'concern' | 'conclusion'; tags?: string[]; status?: 'open' | 'resolved' };
                };
                const result = await this.context.analyses.updateAnnotation({ ...payload, commandId: command.commandId });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.analysisChanged('annotation.updated', result.value.document, result.value.result, command.commandId);
                return;
            }

            case 'annotation.delete':
            case 'annotation.restore': {
                const payload = command.payload as {
                    analysisId: string; annotationId: string; baseVersion: number; actorId: string;
                };
                const deleted = command.type === 'annotation.delete';
                const result = await this.context.analyses.setDeleted({ ...payload, deleted, commandId: command.commandId });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.analysisChanged(deleted ? 'annotation.deleted' : 'annotation.restored', result.value.document, result.value.result, command.commandId);
                return;
            }

            case 'annotation.reply': {
                const payload = command.payload as { analysisId: string; annotationId: string; body: string; author: Author };
                const result = await this.context.analyses.reply({ ...payload, commandId: command.commandId });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.broadcast('annotation.replyAdded', {
                    analysisId: payload.analysisId, annotationId: payload.annotationId, replyId: result.value.result,
                }, { commandId: command.commandId });
                this.broadcast('analysis.snapshot', { analysis: result.value.document }, { commandId: command.commandId });
                this.broadcast('analysis.persisted', { analysisId: payload.analysisId, revision: result.value.persistedRevision }, { commandId: command.commandId });
                return;
            }

            case 'review.setState': {
                const payload = command.payload as {
                    analysisId: string; target: AnnotationTarget; baselineId: string;
                    state: 'unreviewed' | 'reviewing' | 'reviewed' | 'needsReview';
                    authorId: string; evidenceIds: string[];
                };
                const result = await this.context.analyses.setReview({ ...payload, commandId: command.commandId });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.analysisChanged('review.changed', result.value.document, result.value.result, command.commandId);
                return;
            }

            case 'walkthrough.update': {
                const payload = command.payload as {
                    analysisId: string; walkthroughId?: string; baseVersion?: number;
                    title: string; steps: WalkthroughStep[]; actorId: string;
                };
                const result = await this.context.analyses.updateWalkthrough({ ...payload, commandId: command.commandId });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.analysisChanged('walkthrough.changed', result.value.document, result.value.result, command.commandId);
                return;
            }

            case 'anchor.capture': {
                const payload = command.payload as { analysisId: string; documentId: string; range: CodeRange };
                const grant = this.context.documents.get(payload.documentId);
                if (!grant || grant.relPath === null) {
                    this.sendError(client, { code: 'PATH_DENIED', message: '프로젝트 안의 문서만 기록 위치로 만들 수 있다.', retryable: false }, command.commandId);
                    return;
                }
                const content = await this.context.documents.read(payload.documentId);
                const context = contextForRange(content.text, payload.range);
                if (!context) {
                    this.sendError(client, { code: 'INVALID_COMMAND', message: '선택 범위가 원본 코드와 맞지 않는다.', retryable: false }, command.commandId);
                    return;
                }
                const { baseline, fileId } = createBaselineFile({ relPath: grant.relPath, contentHash: content.contentHash });
                const baselineResult = await this.context.analyses.addBaseline({
                    analysisId: payload.analysisId, commandId: `${command.commandId}:baseline`, baseline,
                });
                if (!baselineResult.ok) { this.sendError(client, baselineResult.error, command.commandId); return; }
                const result = await this.context.analyses.addAnchor({
                    analysisId: payload.analysisId, commandId: command.commandId,
                    baselineId: baseline.id, fileId, range: payload.range,
                    selectedText: context.selectedText, selectedTextHash: sha256(context.selectedText),
                    contextBefore: context.before, contextBeforeHash: context.before ? sha256(context.before) : null,
                    contextAfter: context.after, contextAfterHash: context.after ? sha256(context.after) : null,
                });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.analysisChanged('anchor.checked', result.value.document, result.value.result, command.commandId);
                return;
            }

            case 'anchor.recheck': {
                const payload = command.payload as { analysisId: string; anchorIds: string[]; actorId: string };
                let latest = this.context.analyses.get(payload.analysisId);
                if (!latest) { this.sendError(client, { code: 'NOT_FOUND', message: '분석 문서를 찾을 수 없다.', retryable: false }, command.commandId); return; }
                for (const anchorId of payload.anchorIds) {
                    const anchor = latest.anchors.find((item) => item.id === anchorId);
                    const baseline = latest.baselines.find((item) => item.id === anchor?.baselineId);
                    const file = baseline?.files.find((item) => item.fileId === anchor?.fileId);
                    if (!anchor || !file) continue;
                    const grant = await this.context.documents.grantInsideProject(file.relPath).catch(() => null);
                    const content = grant ? await this.context.documents.read(grant.documentId).catch(() => null) : null;
                    const checked = content ? reanchor(anchor, content.text, content.contentHash)
                        : { state: 'missing' as const, currentRange: null, candidates: [] };
                    for (const candidate of checked.candidates) if (grant && content) this.anchorCandidates.set(candidate.id, {
                        analysisId: payload.analysisId, anchorId, documentId: grant.documentId,
                        range: candidate.range, contentHash: content.contentHash,
                    });
                    const result = await this.context.analyses.setAnchorCheck({
                        analysisId: payload.analysisId, commandId: `${command.commandId}:${anchorId}`,
                        anchorId, state: checked.state, currentRange: checked.currentRange,
                        candidateIds: checked.candidates.map((item) => item.id), actorId: payload.actorId,
                    });
                    if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                    latest = result.value.document;
                    this.analysisChanged('anchor.checked', latest, anchorId, command.commandId);
                }
                return;
            }

            case 'anchor.rebind': {
                const payload = command.payload as { analysisId: string; anchorId: string; candidateId: string; baseVersion: number; actorId: string };
                const candidate = this.anchorCandidates.get(payload.candidateId);
                if (!candidate || candidate.analysisId !== payload.analysisId || candidate.anchorId !== payload.anchorId) {
                    this.sendError(client, { code: 'INVALID_COMMAND', message: '재연결 후보가 만료되었거나 맞지 않는다.', retryable: true }, command.commandId);
                    return;
                }
                const content = await this.context.documents.read(candidate.documentId);
                if (content.contentHash !== candidate.contentHash) {
                    this.sendError(client, { code: 'STALE_REVISION', message: '재연결 중 코드가 바뀌었다.', retryable: true }, command.commandId);
                    return;
                }
                const current = this.context.analyses.get(payload.analysisId);
                const anchor = current?.anchors.find((item) => item.id === payload.anchorId);
                const oldFile = current?.baselines.find((item) => item.id === anchor?.baselineId)?.files.find((item) => item.fileId === anchor?.fileId);
                if (!anchor || !oldFile) return;
                const { baseline } = createBaselineFile({ relPath: oldFile.relPath, contentHash: content.contentHash, fileId: anchor.fileId });
                const savedBaseline = await this.context.analyses.addBaseline({ analysisId: payload.analysisId, commandId: `${command.commandId}:baseline`, baseline });
                if (!savedBaseline.ok) { this.sendError(client, savedBaseline.error, command.commandId); return; }
                const result = await this.context.analyses.rebindAnchor({
                    ...payload, commandId: command.commandId, baselineId: baseline.id,
                    range: candidate.range, selectedTextHash: sha256(contextForRange(content.text, candidate.range)?.selectedText ?? ''),
                });
                if (!result.ok) { this.sendError(client, result.error, command.commandId); return; }
                this.analysisChanged('anchor.rebound', result.value.document, payload.anchorId, command.commandId);
                this.anchorCandidates.delete(payload.candidateId);
                return;
            }

            case 'share.prepare': {
                const payload = command.payload as { analysisId: string; policy: Partial<ShareExportPolicy> };
                const preview = this.context.sharing.prepare(payload.analysisId, payload.policy);
                if (!preview) { this.sendError(client, { code: 'NOT_FOUND', message: '분석 문서를 찾을 수 없다.', retryable: false }, command.commandId); return; }
                this.broadcast('share.prepared', { preview }, { commandId: command.commandId });
                return;
            }

            case 'share.export': {
                const payload = command.payload as { planId: string; format: 'ctshare' | 'markdown' | 'html' };
                const exported = this.context.sharing.export(payload.planId);
                if (!exported) { this.sendError(client, { code: 'STALE_REVISION', message: '내보내기 준비 뒤 분석이 바뀌었다. 다시 준비한다.', retryable: true }, command.commandId); return; }
                const extension = payload.format === 'ctshare' ? 'ctshare.json' : payload.format === 'markdown' ? 'md' : 'html';
                this.broadcast('share.ready', {
                    analysisId: exported.bundle.analysis.id, format: payload.format,
                    url: `/api/shares/${payload.planId}/${payload.format}`,
                    fileName: `${exported.bundle.analysis.title}.${extension}`,
                }, { commandId: command.commandId });
                return;
            }

            case 'share.uploadStart': {
                const payload = command.payload as { byteLength: number; sha256: string };
                const uploadId = this.context.sharing.uploadStart(payload.byteLength, payload.sha256);
                this.broadcast('share.uploadReady', { uploadId }, { commandId: command.commandId });
                return;
            }

            case 'share.uploadChunk': {
                const payload = command.payload as { uploadId: string; index: number; base64: string };
                this.context.sharing.uploadChunk(payload.uploadId, payload.index, payload.base64);
                return;
            }

            case 'share.uploadFinish': {
                const { uploadId } = command.payload as { uploadId: string };
                this.context.sharing.uploadFinish(uploadId);
                return;
            }

            case 'share.importPreview': {
                const { uploadId } = command.payload as { uploadId: string };
                const bundle = this.context.sharing.uploadFinish(uploadId);
                const merge = this.context.sharing.prepareMerge(bundle);
                this.broadcast('share.importPreview', {
                    uploadId, title: bundle.analysis.title,
                    annotationCount: bundle.analysis.annotations.length,
                    trailCount: bundle.trails.length,
                    codeIncluded: bundle.exportPolicy.includeCode,
                    merge: merge ? {
                        planId: merge.id,
                        additionCount: merge.additions.length,
                        updateCount: merge.updates.length,
                        deletionCount: merge.deletions.length,
                        conflicts: merge.conflicts,
                    } : null,
                }, { commandId: command.commandId });
                return;
            }

            case 'share.importCommit': {
                const payload = command.payload as { uploadId: string; forceCopy: boolean };
                const text = this.context.sharing.uploadedText(payload.uploadId);
                if (!text) { this.sendError(client, { code: 'NOT_FOUND', message: '검증한 업로드가 없다.', retryable: false }, command.commandId); return; }
                const imported = await this.context.sharing.import(text, payload.forceCopy);
                this.context.sharing.finishUpload(payload.uploadId);
                this.broadcast('share.imported', { analysisId: imported.analysis.id, duplicate: imported.duplicate }, { commandId: command.commandId });
                this.broadcast('analysis.snapshot', { analysis: imported.analysis }, { commandId: command.commandId });
                this.broadcast('analysis.listChanged', { analyses: this.context.analyses.list() }, {});
                this.broadcast('trail.listChanged', { trails: trails.list(), activeTrailId: trails.getActiveTrailId() }, {});
                return;
            }

            case 'share.mergeCommit': {
                const payload = command.payload as { planId: string; actorId: string };
                const plan = this.context.sharing.getMergePlan(payload.planId);
                if (!plan) { this.sendError(client, { code: 'NOT_FOUND', message: '병합 계획이 없거나 만료되었다.', retryable: true }, command.commandId); return; }
                const merged = await this.context.sharing.applyMerge(payload.planId, command.commandId, payload.actorId);
                this.broadcast('share.merged', {
                    analysisId: merged.id,
                    additionCount: plan.additions.length,
                    updateCount: plan.updates.length,
                    deletionCount: plan.deletions.length,
                }, { commandId: command.commandId });
                this.broadcast('analysis.snapshot', { analysis: merged }, { commandId: command.commandId });
                this.broadcast('analysis.listChanged', { analyses: this.context.analyses.list() }, {});
                return;
            }

            case 'analysis.saveDraft': {
                const payload = command.payload as { analysisId: string; draftId: string; target: AnnotationTarget; body: string };
                await this.context.analysisStore.saveDraft(payload.analysisId, payload.draftId, payload);
                this.broadcast('analysis.draftSaved', { analysisId: payload.analysisId, draftId: payload.draftId }, { commandId: command.commandId });
                return;
            }

            case 'ai.generate': {
                const payload = command.payload as {
                    requestId: string; analysisId: string; documentId: string; range: CodeRange; purpose: string;
                };
                try {
                    const preview = await this.context.ai.generate(payload);
                    this.broadcast('ai.draftReady', {
                        requestId: payload.requestId,
                        ...preview,
                    }, { commandId: command.commandId });
                    const document = this.context.analyses.get(payload.analysisId);
                    if (document) {
                        this.broadcast('analysis.snapshot', { analysis: document }, { commandId: command.commandId });
                        this.broadcast('analysis.persisted', { analysisId: document.id, revision: document.revision }, { commandId: command.commandId });
                    }
                } catch (error) {
                    this.sendError(client, {
                        code: 'INVALID_COMMAND',
                        message: error instanceof Error ? error.message : 'AI 설명 초안을 만들지 못했다.',
                        retryable: true,
                    }, command.commandId);
                }
                return;
            }

            case 'ai.cancel': {
                const { requestId } = command.payload as { requestId: string };
                this.broadcast('ai.cancelled', {
                    requestId,
                    cancelled: this.context.ai.cancel(requestId),
                }, { commandId: command.commandId });
                return;
            }

            case 'ai.accept': {
                const payload = command.payload as { analysisId: string; draftId: string; author: Author };
                try {
                    const accepted = await this.context.ai.accept({ ...payload, commandId: command.commandId });
                    this.broadcast('ai.accepted', {
                        analysisId: payload.analysisId,
                        draftId: payload.draftId,
                        annotationId: accepted.annotationId,
                    }, { commandId: command.commandId });
                    const document = this.context.analyses.get(payload.analysisId);
                    if (document) this.analysisChanged('annotation.created', document, accepted.annotationId, command.commandId);
                } catch (error) {
                    this.sendError(client, {
                        code: 'INVALID_COMMAND',
                        message: error instanceof Error ? error.message : 'AI 초안을 채택하지 못했다.',
                        retryable: true,
                    }, command.commandId);
                }
                return;
            }

            default: {
                const exhaustive: never = command.type;
                throw new Error(`처리하지 않은 명령: ${String(exhaustive)}`);
            }
        }
    }
}
