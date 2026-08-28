import type { TrailSocket } from './socket.js';

/**
 * 명령 보내기.
 *
 * 트레일의 정본은 서버에 있다(구현서 14.1). 화면에서 무언가를 바꾸려면 반드시
 * 명령을 보내야 하고, 화면은 돌아온 이벤트로만 자기 상태를 고친다. 여기서
 * 낙관적으로 먼저 그려두면 서버가 거절했을 때 두 상태가 어긋난다.
 *
 * 구조 명령에는 `baseRevision` 을 반드시 싣는다 — 서버가 스키마에서 막는다.
 */

export const PROTOCOL_VERSION = 1;

function newCommandId(): string {
    return crypto.randomUUID();
}

export interface CommandContext {
    socket: TrailSocket;
    trailId: string | null;
    revision: number;
}

function send(
    context: CommandContext,
    type: string,
    payload: unknown,
    options: { withRevision?: boolean; withTrail?: boolean } = {},
): boolean {
    const withTrail = options.withTrail ?? true;
    if (withTrail && context.trailId === null) {
        return false;
    }
    return context.socket.send({
        protocolVersion: PROTOCOL_VERSION,
        type,
        commandId: newCommandId(),
        ...(withTrail && context.trailId !== null ? { trailId: context.trailId } : {}),
        ...(options.withRevision ?? true ? { baseRevision: context.revision } : {}),
        payload,
    });
}

export const commands = {
    createTrail: (context: CommandContext, title?: string) =>
        send(context, 'trail.create', title === undefined ? {} : { title }, {
            withTrail: false,
        }),

    renameTrail: (context: CommandContext, title: string) =>
        send(context, 'trail.rename', { title }),

    deleteTrail: (context: CommandContext) =>
        send(context, 'trail.delete', {}),

    selectTrail: (context: CommandContext, trailId: string) =>
        context.socket.send({
            protocolVersion: PROTOCOL_VERSION,
            type: 'trail.select',
            commandId: newCommandId(),
            trailId,
            payload: {},
        }),

    addRootAt: (context: CommandContext, documentId: string, line: number, char: number) =>
        send(context, 'trail.addRootAt', { documentId, line, char }),

    resolve: (
        context: CommandContext,
        nodeId: string,
        line: number,
        char: number,
        text: string,
    ) => send(context, 'trail.resolve', { nodeId, line, char, text }),

    resolveImplementations: (context: CommandContext, nodeId: string) =>
        send(context, 'trail.resolveImplementations', { nodeId }),

    chooseCandidate: (context: CommandContext, choiceId: string, candidateId: string) =>
        send(context, 'trail.chooseCandidate', { choiceId, candidateId }),

    removeNode: (context: CommandContext, nodeId: string) =>
        send(context, 'trail.removeNode', { nodeId }),

    toggleNode: (context: CommandContext, nodeId: string, collapsed: boolean) =>
        send(context, 'trail.toggleNode', { nodeId, collapsed }, { withRevision: false }),

    promoteToRoot: (context: CommandContext, nodeId: string) =>
        send(context, 'trail.promoteToRoot', { nodeId }),

    clear: (context: CommandContext) => send(context, 'trail.clear', {}),

    setActiveNode: (context: CommandContext, nodeId: string | null) =>
        send(context, 'trail.setActiveNode', { nodeId }, { withRevision: false }),

    exportMarkdown: (context: CommandContext) =>
        send(context, 'trail.exportMarkdown', {}, { withRevision: false }),

    /** 외부 에디터에서 열기. 단계 9에서 서버 쪽이 붙는다. */
    openInEditor: (context: CommandContext, documentId: string, line: number, char: number) =>
        send(context, 'editor.openLocation', { documentId, line, char }, {
            withRevision: false,
            withTrail: false,
        }),

    updateSettings: (context: CommandContext, settings: unknown) =>
        send(context, 'settings.update', { settings }, {
            withRevision: false,
            withTrail: false,
        }),
};
