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
    type Trail,
} from '@code-trail/shared';

import type { ServerContext } from '../context.js';

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

    constructor(private readonly context: ServerContext) {}

    get clientCount(): number {
        return this.clients.size;
    }

    /** 새 연결. 인증은 이 함수를 부르기 전에 끝나 있어야 한다. */
    accept(socket: WebSocket): void {
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

        this.sendSnapshots(client);
    }

    /** 모든 연결을 닫는다. 종료 절차가 부른다. */
    closeAll(): void {
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

    private snapshotPayload(trail: Trail): unknown {
        const stored = toStoredTrail(trail);
        return {
            id: stored.id,
            title: stored.title,
            revision: stored.revision,
            mode: stored.mode,
            activeNodeId: stored.activeNodeId,
            roots: trail.roots,
            nodeUi: stored.nodeUi,
        };
    }

    /** 붙자마자 지금 상태를 통째로 보낸다. 재연결 복구도 같은 길을 쓴다. */
    private sendSnapshots(client: Client): void {
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
                payload: this.snapshotPayload(active),
            });
        }
    }

    // ── 받기 ────────────────────────────────────────────────────────────────

    private async onMessage(client: Client, raw: string): Promise<void> {
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

    private async dispatch(client: Client, command: ClientCommand): Promise<void> {
        const { trails } = this.context;

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
                this.broadcast('trail.snapshot', this.snapshotPayload(trail), {
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
                const result = await trails.mutate(
                    trailId,
                    command.baseRevision as number,
                    (trail) => trail.remove(nodeId),
                );
                if (!result.ok) {
                    this.sendStaleRecovery(client, trailId, result.error, command.commandId);
                    return;
                }
                this.broadcast('trail.nodeRemoved', { nodeId }, {
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
                const result = await trails.mutate(
                    trailId,
                    command.baseRevision as number,
                    (trail) => trail.setCollapsed(nodeId, collapsed),
                );
                if (!result.ok) {
                    this.sendStaleRecovery(client, trailId, result.error, command.commandId);
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

            // 아래는 언어 서버가 붙는 단계 4~6, 외부 에디터가 붙는 단계 9의 몫이다.
            // 조용히 무시하지 않는다 — 클라이언트가 "왜 아무 일도 안 일어나지" 로
            // 남지 않게 아직 없다는 것을 분명히 알린다.
            case 'trail.addRootAt':
            case 'trail.addRootFromSymbol':
            case 'trail.resolve':
            case 'trail.resolveImplementations':
            case 'lsp.restart':
                this.sendError(
                    client,
                    {
                        code: 'LSP_UNAVAILABLE',
                        message: '언어 서버 연결은 아직 구현되지 않았다.',
                        retryable: false,
                    },
                    command.commandId,
                );
                return;

            case 'editor.openLocation':
                this.sendError(
                    client,
                    {
                        code: 'NOT_FOUND',
                        message: '외부 에디터 열기는 아직 구현되지 않았다.',
                        retryable: false,
                    },
                    command.commandId,
                );
                return;

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

            default: {
                const exhaustive: never = command.type;
                throw new Error(`처리하지 않은 명령: ${String(exhaustive)}`);
            }
        }
    }
}
