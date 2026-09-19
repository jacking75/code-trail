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

/**
 * 이 탭이 보낸 명령.
 *
 * 이벤트는 열려 있는 모든 탭에 나간다. "내가 시킨 결과인가" 를 알아야 이 탭만
 * 활성 노드로 스크롤할 수 있다 — 옆 탭의 조작을 따라 화면이 움직이면 방해다.
 */
const ownCommands = new Set<string>();
const OWN_COMMAND_LIMIT = 256;

export function isOwnCommand(commandId: string | undefined): boolean {
    return commandId !== undefined && ownCommands.has(commandId);
}

function newCommandId(): string {
    const id = crypto.randomUUID();
    ownCommands.add(id);
    if (ownCommands.size > OWN_COMMAND_LIMIT) {
        const oldest = ownCommands.values().next();
        if (!oldest.done) {
            ownCommands.delete(oldest.value);
        }
    }
    return id;
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

    /**
     * 방금 지운 노드를 되돌린다.
     *
     * 되돌리기도 서버가 한다. 정본이 서버에 있으므로 다른 탭에서 지운 것도
     * 같은 길로 되살아난다.
     */
    undoRemove: (context: CommandContext, nodeId: string) =>
        send(context, 'trail.undoRemove', { nodeId }),

    /** 파일이 바뀐 노드를 현재 코드로 다시 읽는다. */
    refreshNode: (context: CommandContext, nodeId: string) =>
        send(context, 'trail.refreshNode', { nodeId }),

    toggleNode: (context: CommandContext, nodeId: string, collapsed: boolean) =>
        send(context, 'trail.toggleNode', { nodeId, collapsed }, { withRevision: false }),

    promoteToRoot: (context: CommandContext, nodeId: string) =>
        send(context, 'trail.promoteToRoot', { nodeId }),

    /** 방금 떼어낸 노드를 원래 부모의 원래 자리로 (V10). */
    undoPromote: (context: CommandContext, nodeId: string) =>
        send(context, 'trail.undoPromote', { nodeId }),

    /** 보드에서 손으로 옮긴 자리를 모두 지운다. 화면 상태라 revision 을 싣지 않는다(V11). */
    resetBoardLayout: (context: CommandContext) =>
        send(context, 'trail.resetBoardLayout', {}, { withRevision: false }),

    clear: (context: CommandContext) => send(context, 'trail.clear', {}),

    setActiveNode: (context: CommandContext, nodeId: string | null) =>
        send(context, 'trail.setActiveNode', { nodeId }, { withRevision: false }),

    /** 형제 정렬. 접기와 같은 화면 상태라 revision 을 싣지 않는다. */
    setChildOrder: (context: CommandContext, childOrder: 'source' | 'click' | null) =>
        send(context, 'trail.setChildOrder', { childOrder }, { withRevision: false }),

    /**
     * 트리 ↔ 보드 전환. 화면 상태라 revision 을 실지 않는다 —
     * 모드를 바꿨다고 날아가던 구조 명령이 거절되면 안 된다.
     */
    setMode: (context: CommandContext, mode: 'tree' | 'board') =>
        send(context, 'trail.setMode', { mode }, { withRevision: false }),

    /**
     * 노드 하나의 화면 상태(보드 좌표, 본문 높이, 코드 글자 크기).
     *
     * `null` 을 넣으면 그 항목을 지우고 기본값으로 돌린다.
     */
    setNodeUi: (
        context: CommandContext,
        nodeId: string,
        patch: {
            boardX?: number | null;
            boardY?: number | null;
            bodyHeight?: number | null;
            codeFontSize?: number | null;
        },
    ) => send(context, 'trail.setNodeUi', { nodeId, patch }, { withRevision: false }),

    exportMarkdown: (
        context: CommandContext,
        options: { analysisId?: string; mermaid?: boolean } = {},
    ) => send(context, 'trail.exportMarkdown', {
        ...(options.analysisId === undefined ? {} : { analysisId: options.analysisId }),
        mermaid: options.mermaid ?? false,
    }, { withRevision: false }),

    /**
     * 이 기계의 개인 화면 상태를 저장한다 (V18).
     *
     * `localStorage` 는 origin 이 포트에 묶여 재시작을 못 견딘다. 트레일과 무관한
     * 값이므로 `trailId` 도 `baseRevision` 도 싣지 않는다.
     */
    saveLocalUiState: (context: CommandContext, state: unknown) =>
        send(context, 'ui.saveLocalState', { state }, {
            withRevision: false,
            withTrail: false,
        }),

    /**
     * 외부 에디터에서 열기.
     *
     * **경로를 보내지 않는다.** 서버가 발급한 `documentId` 만 보내고, 실제 경로는
     * 서버가 문서 권한 목록에서 역조회한다(구현서 17.2 5단계).
     */
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

    updateLocalAuthor: (context: CommandContext, author: { id: string; displayName: string }) =>
        send(context, 'settings.updateLocalAuthor', { author }, {
            withRevision: false,
            withTrail: false,
        }),

    restartLsp: (context: CommandContext, language: string) =>
        send(context, 'lsp.restart', { language }, {
            withRevision: false,
            withTrail: false,
        }),

    /**
     * 실제 샘플 요청으로 언어 서버를 확인한다.
     *
     * 프로세스가 떴다는 것과 요청이 응답한다는 것은 다른 말이다. 진단 화면의
     * `지원됨` 은 이 확인을 거친 것만 뜻한다(구현서 18).
     */
    verifyLsp: (context: CommandContext, language: string) =>
        send(context, 'lsp.verify', { language }, {
            withRevision: false,
            withTrail: false,
        }),

    createAnalysis: (
        context: CommandContext,
        payload: { title: string; purpose: string; trailIds: string[]; author: { id: string; displayName: string } },
    ) => send(context, 'analysis.create', payload, { withRevision: false, withTrail: false }),

    updateAnalysisPlan: (context: CommandContext, payload: Record<string, unknown>) =>
        send(context, 'analysis.updatePlan', payload, { withRevision: false, withTrail: false }),

    recoverAnalysis: (context: CommandContext, analysisId: string, kind: 'temporary' | 'backup') =>
        send(context, 'analysis.recover', { analysisId, kind }, { withRevision: false, withTrail: false }),

    createAnnotation: (
        context: CommandContext,
        payload: {
            analysisId: string; target: Record<string, unknown>; body: string;
            kind: 'explanation' | 'question' | 'concern' | 'conclusion'; tags: string[];
            author: { id: string; displayName: string };
        },
    ) => send(context, 'annotation.create', payload, { withRevision: false, withTrail: false }),

    updateAnnotation: (
        context: CommandContext,
        payload: { analysisId: string; annotationId: string; baseVersion: number; actorId: string; patch: Record<string, unknown> },
    ) => send(context, 'annotation.update', payload, { withRevision: false, withTrail: false }),

    deleteAnnotation: (
        context: CommandContext,
        payload: { analysisId: string; annotationId: string; baseVersion: number; actorId: string },
    ) => send(context, 'annotation.delete', payload, { withRevision: false, withTrail: false }),

    restoreAnnotation: (
        context: CommandContext,
        payload: { analysisId: string; annotationId: string; baseVersion: number; actorId: string },
    ) => send(context, 'annotation.restore', payload, { withRevision: false, withTrail: false }),

    replyAnnotation: (
        context: CommandContext,
        payload: { analysisId: string; annotationId: string; body: string; author: { id: string; displayName: string } },
    ) => send(context, 'annotation.reply', payload, { withRevision: false, withTrail: false }),

    setReview: (
        context: CommandContext,
        payload: { analysisId: string; target: Record<string, unknown>; baselineId: string; state: string; authorId: string; evidenceIds: string[] },
    ) => send(context, 'review.setState', payload, { withRevision: false, withTrail: false }),

    captureAnchor: (
        context: CommandContext,
        payload: { analysisId: string; documentId: string; range: { start: { line: number; char: number }; end: { line: number; char: number } } },
    ) => send(context, 'anchor.capture', payload, { withRevision: false, withTrail: false }),

    recheckAnchors: (
        context: CommandContext,
        payload: { analysisId: string; anchorIds: string[]; actorId: string },
    ) => send(context, 'anchor.recheck', payload, { withRevision: false, withTrail: false }),

    updateWalkthrough: (context: CommandContext, payload: Record<string, unknown>) =>
        send(context, 'walkthrough.update', payload, { withRevision: false, withTrail: false }),

    prepareShare: (context: CommandContext, analysisId: string, policy: Record<string, boolean>) =>
        send(context, 'share.prepare', { analysisId, policy }, { withRevision: false, withTrail: false }),

    exportShare: (context: CommandContext, planId: string, format: 'ctshare' | 'markdown' | 'html') =>
        send(context, 'share.export', { planId, format }, { withRevision: false, withTrail: false }),

    uploadStart: (context: CommandContext, byteLength: number, sha256: string) =>
        send(context, 'share.uploadStart', { byteLength, sha256 }, { withRevision: false, withTrail: false }),

    uploadChunk: (context: CommandContext, uploadId: string, index: number, base64: string) =>
        send(context, 'share.uploadChunk', { uploadId, index, base64 }, { withRevision: false, withTrail: false }),

    importPreview: (context: CommandContext, uploadId: string) =>
        send(context, 'share.importPreview', { uploadId }, { withRevision: false, withTrail: false }),

    importCommit: (context: CommandContext, uploadId: string, forceCopy = false) =>
        send(context, 'share.importCommit', { uploadId, forceCopy }, { withRevision: false, withTrail: false }),

    mergeCommit: (context: CommandContext, planId: string, actorId: string) =>
        send(context, 'share.mergeCommit', { planId, actorId }, { withRevision: false, withTrail: false }),

    saveDraft: (context: CommandContext, payload: Record<string, unknown>) =>
        send(context, 'analysis.saveDraft', payload, { withRevision: false, withTrail: false }),

    generateAiDraft: (context: CommandContext, payload: Record<string, unknown>) =>
        send(context, 'ai.generate', payload, { withRevision: false, withTrail: false }),

    cancelAiDraft: (context: CommandContext, requestId: string) =>
        send(context, 'ai.cancel', { requestId }, { withRevision: false, withTrail: false }),

    acceptAiDraft: (context: CommandContext, payload: Record<string, unknown>) =>
        send(context, 'ai.accept', payload, { withRevision: false, withTrail: false }),
};
