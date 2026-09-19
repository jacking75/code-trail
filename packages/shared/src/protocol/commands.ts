import { z } from 'zod';

import {
    PROTOCOL_VERSION,
    childOrderSchema,
    localUiStateSchema,
    nodeUiStateSchema,
    offsetSchema,
    parseWith,
    projectSettingsSchema,
    trailModeSchema,
    uuidSchema,
    type ParseResult,
} from './schemas.js';
import {
    annotationTargetSchema,
    authorSchema,
    codeRangeSchema,
    shareExportPolicySchema,
} from './analysisSchemas.js';

/**
 * 브라우저 → 서버 명령.
 *
 * 트레일의 정본은 서버에 있고 브라우저는 복사본만 그린다. 그래서 화면에서 일어난
 * 모든 변경은 여기 있는 명령 중 하나로 서버에 도착해야 한다(구현서 14.1).
 *
 * 명령은 두 갈래다.
 * - **구조 명령** — 트리 모양을 바꾼다. `baseRevision` 을 반드시 싣는다.
 * - **화면 명령** — 배치·크기·모드만 바꾼다. 트리 모양은 건드리지 않는다.
 *
 * 이 구분을 타입으로 강제해 두면, 나중에 "드래그할 때마다 구조 명령이 날아가서
 * revision 이 폭주하는" 종류의 사고를 코드 리뷰 전에 컴파일러가 잡는다.
 */

// ── 구조 명령 ───────────────────────────────────────────────────────────────

/** 커서 위치에서 감싸는 심볼을 찾아 새 루트로 만든다. */
export const addRootAtPayloadSchema = z.object({
    documentId: z.string().min(1),
    line: offsetSchema,
    char: offsetSchema,
});

/** 문서 심볼 목록에서 고른 심볼을 새 루트로 만든다. */
export const addRootFromSymbolPayloadSchema = z.object({
    documentId: z.string().min(1),
    /** 심볼의 selectionRange 시작 위치. 이름이 아니라 좌표로 지목한다. */
    line: offsetSchema,
    char: offsetSchema,
});

/** 노드 본문의 식별자를 클릭했다. 정의를 찾아 자식으로 붙인다. */
export const resolvePayloadSchema = z.object({
    nodeId: uuidSchema,
    /** 원본 파일 기준 0-based 줄. */
    line: offsetSchema,
    /** 원본 파일 기준 0-based UTF-16 컬럼. */
    char: offsetSchema,
    /** 클릭된 식별자 텍스트. 진입 링크에 그대로 쓴다. */
    text: z.string(),
});

/** 선언 노드의 구현을 모두 찾아 형제 자식으로 붙인다. */
export const resolveImplementationsPayloadSchema = z.object({
    nodeId: uuidSchema,
});

export const nodeIdPayloadSchema = z.object({
    nodeId: uuidSchema,
});

/**
 * 정의 후보가 여럿일 때 사용자가 하나를 골랐다.
 *
 * 서버는 후보 목록을 `trail.definitionChoice` 로 보내고 그 자리에서 기다리지
 * 않는다. 사용자가 고르면 이 명령이 와서 그때 노드를 붙인다 — 서버가 응답을
 * 붙들고 기다리면 그 사이 다른 명령이 막힌다.
 */
export const chooseCandidatePayloadSchema = z.object({
    /** `trail.definitionChoice` 가 준 값. 어느 물음에 대한 답인지 가른다. */
    choiceId: z.string().min(1),
    candidateId: z.string().min(1),
});

/**
 * 방금 지운 노드를 되돌린다.
 *
 * 구조 명령이다. 서버가 한 단계만, 짧은 시간만 기억한다 — 그 사이에 트리가
 * 또 바뀌면 원래 자리가 없어져 되살릴 수 없다.
 */
export const undoRemovePayloadSchema = z.object({
    nodeId: uuidSchema,
});

/**
 * 방금 `⇱` 로 떼어낸 노드를 원래 부모의 원래 자리로 되돌린다 (V10).
 *
 * 삭제 되돌리기와 **같은 한 단계 버퍼**를 쓴다. 그 사이에 다른 구조 명령이
 * 들어오면 원래 자리가 더 이상 그 자리가 아니라 되살릴 수 없다.
 */
export const undoPromotePayloadSchema = z.object({
    nodeId: uuidSchema,
});

/**
 * 파일이 바뀐 노드를 현재 코드로 다시 읽는다.
 *
 * 본문이 통째로 바뀌므로 구조 명령이다. 같은 이름·컨테이너·종류의 심볼을
 * `documentSymbol` 에서 다시 찾는다 — 옛 좌표를 그대로 믿지 않는다.
 */
export const refreshNodePayloadSchema = z.object({
    nodeId: uuidSchema,
});

export const toggleNodePayloadSchema = z.object({
    nodeId: uuidSchema,
    collapsed: z.boolean(),
});

export const trailTitlePayloadSchema = z.object({
    title: z.string().min(1).max(200),
});

export const emptyPayloadSchema = z.object({});

// ── 화면 명령 ───────────────────────────────────────────────────────────────

export const setModePayloadSchema = z.object({
    mode: trailModeSchema,
});

/**
 * 노드 화면 상태. 값에 `null` 을 주면 그 키를 지운다(크기 되돌리기).
 *
 * 드래그 중 매 pointer event 마다 보내지 않는다. 클라이언트가 프레임 단위로 그리고
 * drag end 에 최종 좌표만 한 번 보낸다(구현서 14.2).
 */
export const setNodeUiPayloadSchema = z.object({
    nodeId: uuidSchema,
    patch: z.object({
        boardX: nodeUiStateSchema.shape.boardX.nullable().optional(),
        boardY: nodeUiStateSchema.shape.boardY.nullable().optional(),
        bodyHeight: nodeUiStateSchema.shape.bodyHeight.nullable().optional(),
        codeFontSize: nodeUiStateSchema.shape.codeFontSize.nullable().optional(),
    }),
});

export const setActiveNodePayloadSchema = z.object({
    nodeId: uuidSchema.nullable(),
});

/** 형제 정렬. `null` 이면 설정 기본값을 따른다. 트리 모양은 안 바뀐다. */
export const setChildOrderPayloadSchema = z.object({
    childOrder: childOrderSchema.nullable(),
});

/**
 * 보드에서 손으로 옮긴 자리를 모두 지운다 (V11).
 *
 * 좌표는 화면 상태다. 되돌리기 버퍼에 넣지 않고 revision 도 올리지 않는다 —
 * 구조가 아니라 배치이기 때문이다.
 */
export const resetBoardLayoutPayloadSchema = z.object({});

/**
 * 이 기계의 개인 화면 상태를 저장한다 (V18).
 *
 * `localStorage` 는 origin 이 포트에 묶여 재시작을 못 견딘다. 서버가 들고 있어야
 * "저장한 줄 알았던 값" 이 실제로 남는다. 트레일과는 무관하므로 `trailId` 도
 * `baseRevision` 도 싣지 않는다.
 */
export const saveLocalUiStatePayloadSchema = z.object({
    state: localUiStateSchema,
});

/**
 * 트레일을 Markdown 으로 내보낸다 (V23).
 *
 * 분석 ID 를 함께 주면 그 분석의 기록·검토·안내 순서가 같은 문서에 실린다.
 * 어디서 내보내도 형식이 같아야 하므로 공유 묶음의 Markdown 과 같은 함수를 쓴다.
 */
export const exportMarkdownPayloadSchema = z.object({
    analysisId: uuidSchema.optional(),
    mermaid: z.boolean().default(false),
});

// ── 워크스페이스·에디터·설정 명령 ───────────────────────────────────────────

export const openDocumentPayloadSchema = z.object({
    /** 프로젝트 루트 기준 `/` 구분 상대경로. 절대경로는 받지 않는다. */
    relPath: z.string().min(1),
});

export const searchFilesPayloadSchema = z.object({
    query: z.string(),
});

/**
 * 외부 에디터로 위치를 연다.
 *
 * 브라우저가 보낸 경로를 쓰지 않는다(구현서 17.2). 서버가 발급한 문서 ID 로
 * 실제 경로를 역조회한다 — 그래야 브라우저가 임의 파일을 열게 만들 수 없다.
 */
export const openLocationPayloadSchema = z.object({
    documentId: z.string().min(1),
    line: offsetSchema,
    char: offsetSchema,
});

export const settingsUpdatePayloadSchema = z.object({
    settings: projectSettingsSchema,
});

export const localAuthorUpdatePayloadSchema = z.object({ author: authorSchema });

export const lspRestartPayloadSchema = z.object({
    language: z.enum(['cpp', 'csharp', 'go', 'rust', 'typescript']),
});

/**
 * 실제 샘플 요청으로 이 언어 서버가 정말 도는지 확인한다.
 *
 * 프로세스가 떴다는 것과 `documentSymbol`·`definition` 이 응답한다는 것은 다른
 * 말이다. 진단 화면의 `지원됨` 은 뒤쪽을 뜻하고, 그 확인이 이 명령이다.
 */
export const lspVerifyPayloadSchema = z.object({
    language: z.enum(['cpp', 'csharp', 'go', 'rust', 'typescript']),
});

// ── 분석 기록·공유 명령 ────────────────────────────────────────────────────

export const analysisCreatePayloadSchema = z.object({
    title: z.string().trim().min(1).max(200),
    purpose: z.string().max(65_536).default(''),
    trailIds: z.array(uuidSchema).max(10_000),
    author: authorSchema,
});

export const analysisPlanUpdatePayloadSchema = z.object({
    analysisId: uuidSchema,
    baseRevision: z.int().min(0),
    purpose: z.string().max(65_536),
    actorId: uuidSchema,
    goals: z.array(z.object({
        id: uuidSchema,
        title: z.string().trim().min(1).max(500),
        targetIds: z.array(uuidSchema).max(10_000),
        evidenceIds: z.array(uuidSchema).max(10_000),
    })).max(1_000),
    importantLocations: z.array(z.object({
        id: uuidSchema,
        title: z.string().trim().min(1).max(200),
        target: annotationTargetSchema,
    })).max(10_000),
});

export const analysisRecoverPayloadSchema = z.object({
    analysisId: uuidSchema,
    kind: z.enum(['temporary', 'backup']),
});

export const annotationCreatePayloadSchema = z.object({
    analysisId: uuidSchema,
    target: annotationTargetSchema,
    body: z.string().trim().min(1).max(65_536),
    kind: z.enum(['explanation', 'question', 'concern', 'conclusion']),
    tags: z.array(z.string().trim().min(1).max(64)).max(20),
    author: authorSchema,
});

export const annotationUpdatePayloadSchema = z.object({
    analysisId: uuidSchema,
    annotationId: uuidSchema,
    baseVersion: z.int().min(1),
    actorId: uuidSchema,
    patch: z.object({
        body: z.string().trim().min(1).max(65_536).optional(),
        kind: z.enum(['explanation', 'question', 'concern', 'conclusion']).optional(),
        tags: z.array(z.string().trim().min(1).max(64)).max(20).optional(),
        status: z.enum(['open', 'resolved']).optional(),
    }),
});

export const annotationVersionPayloadSchema = z.object({
    analysisId: uuidSchema,
    annotationId: uuidSchema,
    baseVersion: z.int().min(1),
    actorId: uuidSchema,
});

export const annotationReplyPayloadSchema = z.object({
    analysisId: uuidSchema,
    annotationId: uuidSchema,
    body: z.string().trim().min(1).max(32_768),
    author: authorSchema,
});

export const reviewSetStatePayloadSchema = z.object({
    analysisId: uuidSchema,
    target: annotationTargetSchema,
    baselineId: uuidSchema,
    state: z.enum(['unreviewed', 'reviewing', 'reviewed', 'needsReview']),
    authorId: uuidSchema,
    evidenceIds: z.array(uuidSchema).max(10_000),
});

export const anchorCapturePayloadSchema = z.object({
    analysisId: uuidSchema,
    documentId: z.string().min(1),
    range: codeRangeSchema,
});

export const anchorRecheckPayloadSchema = z.object({
    analysisId: uuidSchema,
    anchorIds: z.array(uuidSchema).min(1).max(1_000),
    actorId: uuidSchema,
});

export const anchorRebindPayloadSchema = z.object({
    analysisId: uuidSchema,
    anchorId: uuidSchema,
    candidateId: z.string().min(1),
    baseVersion: z.int().min(1),
    actorId: uuidSchema,
});

export const walkthroughUpdatePayloadSchema = z.object({
    analysisId: uuidSchema,
    walkthroughId: uuidSchema.optional(),
    baseVersion: z.int().min(1).optional(),
    title: z.string().trim().min(1).max(200),
    actorId: uuidSchema,
    steps: z.array(z.object({
        id: uuidSchema,
        title: z.string().trim().min(1).max(200),
        body: z.string().max(65_536),
        annotationId: uuidSchema.nullable(),
        target: annotationTargetSchema.nullable(),
        baselineId: uuidSchema.nullable(),
    })).max(10_000),
});

export const sharePreparePayloadSchema = z.object({
    analysisId: uuidSchema,
    policy: shareExportPolicySchema.partial(),
});

export const shareExportPayloadSchema = z.object({
    planId: uuidSchema,
    format: z.enum(['ctshare', 'markdown', 'html']).default('ctshare'),
});
export const shareUploadStartPayloadSchema = z.object({
    byteLength: z.int().min(1).max(32 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const shareUploadChunkPayloadSchema = z.object({
    uploadId: uuidSchema,
    index: z.int().min(0),
    base64: z.string().max(350_000),
});
export const shareUploadFinishPayloadSchema = z.object({ uploadId: uuidSchema });
export const shareImportCommitPayloadSchema = z.object({
    uploadId: uuidSchema,
    forceCopy: z.boolean().default(false),
});
export const shareMergeCommitPayloadSchema = z.object({
    planId: uuidSchema,
    actorId: uuidSchema,
});

export const draftSavePayloadSchema = z.object({
    analysisId: uuidSchema,
    draftId: uuidSchema,
    target: annotationTargetSchema,
    body: z.string().max(65_536),
});

export const aiGeneratePayloadSchema = z.object({
    requestId: uuidSchema,
    analysisId: uuidSchema,
    documentId: z.string().min(1),
    range: codeRangeSchema,
    purpose: z.string().max(4_000),
});
export const aiCancelPayloadSchema = z.object({ requestId: uuidSchema });
export const aiAcceptPayloadSchema = z.object({
    analysisId: uuidSchema,
    draftId: uuidSchema,
    author: authorSchema,
});

// ── 명령 목록 ───────────────────────────────────────────────────────────────

/** 트리 모양을 바꾸는 명령. 반드시 `baseRevision` 을 싣는다. */
export const STRUCTURE_COMMAND_TYPES = [
    'trail.create',
    'trail.rename',
    'trail.delete',
    'trail.addRootAt',
    'trail.addRootFromSymbol',
    'trail.resolve',
    'trail.resolveImplementations',
    'trail.removeNode',
    'trail.promoteToRoot',
    'trail.clear',
    'trail.chooseCandidate',
    'trail.undoRemove',
    'trail.undoPromote',
    'trail.refreshNode',
] as const;

/** 트리 모양을 건드리지 않는 명령. */
export const UI_COMMAND_TYPES = [
    'trail.select',
    // 접기는 트리 모양을 바꾸지 않는다. 보이고 안 보이고의 문제다.
    // 구조 명령으로 두면 "전체 접기" 가 노드마다 명령을 보내면서 두 번째부터
    // 전부 오래된 revision 으로 거절된다.
    'trail.toggleNode',
    'trail.setMode',
    'trail.setNodeUi',
    'trail.setActiveNode',
    'trail.setChildOrder',
    'trail.resetBoardLayout',
    'trail.exportMarkdown',
    'ui.saveLocalState',
    'workspace.openDocument',
    'workspace.searchFiles',
    'editor.openLocation',
    'settings.update',
    'settings.updateLocalAuthor',
    'lsp.restart',
    'lsp.verify',
    'analysis.create',
    'analysis.updatePlan',
    'analysis.recover',
    'annotation.create',
    'annotation.update',
    'annotation.delete',
    'annotation.restore',
    'annotation.reply',
    'annotation.setStatus',
    'review.setState',
    'anchor.capture',
    'anchor.recheck',
    'anchor.rebind',
    'walkthrough.update',
    'share.prepare',
    'share.export',
    'share.uploadStart',
    'share.uploadChunk',
    'share.uploadFinish',
    'share.importPreview',
    'share.importCommit',
    'share.mergeCommit',
    'analysis.saveDraft',
    'ai.generate',
    'ai.cancel',
    'ai.accept',
] as const;

export type StructureCommandType = (typeof STRUCTURE_COMMAND_TYPES)[number];
export type UiCommandType = (typeof UI_COMMAND_TYPES)[number];
export type CommandType = StructureCommandType | UiCommandType;

/** 명령 이름 → payload 스키마. 여기 없는 이름은 명령이 아니다. */
export const COMMAND_PAYLOADS = {
    'trail.create': trailTitlePayloadSchema.partial(),
    'trail.rename': trailTitlePayloadSchema,
    'trail.delete': emptyPayloadSchema,
    'trail.select': emptyPayloadSchema,
    'trail.addRootAt': addRootAtPayloadSchema,
    'trail.addRootFromSymbol': addRootFromSymbolPayloadSchema,
    'trail.resolve': resolvePayloadSchema,
    'trail.resolveImplementations': resolveImplementationsPayloadSchema,
    'trail.removeNode': nodeIdPayloadSchema,
    'trail.toggleNode': toggleNodePayloadSchema,
    'trail.promoteToRoot': nodeIdPayloadSchema,
    'trail.setMode': setModePayloadSchema,
    'trail.setNodeUi': setNodeUiPayloadSchema,
    'trail.setActiveNode': setActiveNodePayloadSchema,
    'trail.clear': emptyPayloadSchema,
    'trail.chooseCandidate': chooseCandidatePayloadSchema,
    'trail.undoRemove': undoRemovePayloadSchema,
    'trail.undoPromote': undoPromotePayloadSchema,
    'trail.refreshNode': refreshNodePayloadSchema,
    'trail.setChildOrder': setChildOrderPayloadSchema,
    'trail.resetBoardLayout': resetBoardLayoutPayloadSchema,
    'trail.exportMarkdown': exportMarkdownPayloadSchema,
    'ui.saveLocalState': saveLocalUiStatePayloadSchema,
    'workspace.openDocument': openDocumentPayloadSchema,
    'workspace.searchFiles': searchFilesPayloadSchema,
    'editor.openLocation': openLocationPayloadSchema,
    'settings.update': settingsUpdatePayloadSchema,
    'settings.updateLocalAuthor': localAuthorUpdatePayloadSchema,
    'lsp.restart': lspRestartPayloadSchema,
    'lsp.verify': lspVerifyPayloadSchema,
    'analysis.create': analysisCreatePayloadSchema,
    'analysis.updatePlan': analysisPlanUpdatePayloadSchema,
    'analysis.recover': analysisRecoverPayloadSchema,
    'annotation.create': annotationCreatePayloadSchema,
    'annotation.update': annotationUpdatePayloadSchema,
    'annotation.delete': annotationVersionPayloadSchema,
    'annotation.restore': annotationVersionPayloadSchema,
    'annotation.reply': annotationReplyPayloadSchema,
    'annotation.setStatus': annotationUpdatePayloadSchema,
    'review.setState': reviewSetStatePayloadSchema,
    'anchor.capture': anchorCapturePayloadSchema,
    'anchor.recheck': anchorRecheckPayloadSchema,
    'anchor.rebind': anchorRebindPayloadSchema,
    'walkthrough.update': walkthroughUpdatePayloadSchema,
    'share.prepare': sharePreparePayloadSchema,
    'share.export': shareExportPayloadSchema,
    'share.uploadStart': shareUploadStartPayloadSchema,
    'share.uploadChunk': shareUploadChunkPayloadSchema,
    'share.uploadFinish': shareUploadFinishPayloadSchema,
    'share.importPreview': shareUploadFinishPayloadSchema,
    'share.importCommit': shareImportCommitPayloadSchema,
    'share.mergeCommit': shareMergeCommitPayloadSchema,
    'analysis.saveDraft': draftSavePayloadSchema,
    'ai.generate': aiGeneratePayloadSchema,
    'ai.cancel': aiCancelPayloadSchema,
    'ai.accept': aiAcceptPayloadSchema,
} as const satisfies Record<CommandType, z.ZodType>;

export type CommandPayload<T extends CommandType> = z.infer<(typeof COMMAND_PAYLOADS)[T]>;

const STRUCTURE_SET: ReadonlySet<string> = new Set(STRUCTURE_COMMAND_TYPES);

export function isStructureCommand(type: string): type is StructureCommandType {
    return STRUCTURE_SET.has(type);
}

// ── 봉투 ────────────────────────────────────────────────────────────────────

export interface ClientCommand<T extends CommandType = CommandType> {
    protocolVersion: typeof PROTOCOL_VERSION;
    type: T;
    /** 재전송을 한 번만 처리하기 위한 키. 같은 값이 두 번 오면 두 번째는 무시한다. */
    commandId: string;
    trailId?: string;
    /** 클라이언트가 이 명령을 만들 때 보고 있던 revision. 구조 명령은 필수다. */
    baseRevision?: number;
    payload: CommandPayload<T>;
}

const envelopeSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.string(),
    commandId: z.string().min(1),
    trailId: uuidSchema.optional(),
    baseRevision: z.int().min(0).optional(),
    payload: z.unknown(),
});

/**
 * 받은 값을 명령으로 해석한다.
 *
 * 이름을 먼저 확인하고 그 이름의 payload 스키마로 다시 통과시킨다.
 * 구조 명령인데 `baseRevision` 이 없으면 거기서 막는다 — 서버가 revision 없이
 * 트리를 바꾸면 다른 탭이 조용히 어긋난다.
 */
export function parseClientCommand(raw: unknown): ParseResult<ClientCommand> {
    const envelope = parseWith(envelopeSchema, raw);
    if (!envelope.ok) {
        return envelope;
    }
    const { type } = envelope.value;
    if (!(type in COMMAND_PAYLOADS)) {
        return {
            ok: false,
            error: {
                code: 'INVALID_COMMAND',
                message: '모르는 명령이다.',
                retryable: false,
                details: { type },
            },
        };
    }
    const commandType = type as CommandType;
    if (isStructureCommand(commandType) && envelope.value.baseRevision === undefined) {
        return {
            ok: false,
            error: {
                code: 'INVALID_COMMAND',
                message: '구조를 바꾸는 명령에는 baseRevision 이 있어야 한다.',
                retryable: false,
                details: { type },
            },
        };
    }
    // 이름별 스키마는 서로 다른 타입이라 유니온으로 잡힌다. 여기서는 "무엇이든
    // 통과시키는 스키마" 로 좁혀 받고, 결과 타입은 아래에서 명령 타입으로 되돌린다.
    const schema: z.ZodType = COMMAND_PAYLOADS[commandType];
    const payload = parseWith(schema, envelope.value.payload);
    if (!payload.ok) {
        return payload;
    }
    return {
        ok: true,
        value: {
            protocolVersion: PROTOCOL_VERSION,
            type: commandType,
            commandId: envelope.value.commandId,
            ...(envelope.value.trailId !== undefined ? { trailId: envelope.value.trailId } : {}),
            ...(envelope.value.baseRevision !== undefined
                ? { baseRevision: envelope.value.baseRevision }
                : {}),
            payload: payload.value as CommandPayload<CommandType>,
        },
    };
}
