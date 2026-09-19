import { z } from 'zod';

import {
    PROTOCOL_VERSION,
    childOrderSchema,
    commandErrorSchema,
    documentResponseSchema,
    nodeUiStateSchema,
    parseWith,
    projectSettingsSchema,
    trailModeSchema,
    trailNodeSchema,
    trailOriginSchema,
    trailSummarySchema,
    uuidSchema,
    workspaceSearchResponseSchema,
    type ParseResult,
} from './schemas.js';
import { analysisDocumentSchema, analysisSummarySchema, sharePreviewSchema } from './analysisSchemas.js';

/**
 * 서버 → 브라우저 이벤트.
 *
 * 명령 하나가 여러 이벤트를 낳을 수 있고(예: 정의 클릭 → `trail.nodeBusy` on →
 * `trail.nodeAdded` → `trail.nodeBusy` off), 열려 있는 모든 탭이 같은 이벤트를 받는다.
 * 그래서 이벤트는 "누가 시켰는지"(`commandId`)와 "어느 시점인지"(`revision`)를
 * 함께 싣는다. 자기가 보낸 명령의 결과인지 다른 탭이 만든 변화인지 구분해야
 * 포커스 이동 같은 동작을 한 탭에서만 할 수 있다.
 */

// ── 트레일 ──────────────────────────────────────────────────────────────────

/**
 * 트레일 전체 상태. 처음 붙었을 때, 재연결했을 때, 그리고 `baseRevision` 이 오래된
 * 명령을 거부했을 때 보낸다. 부분 갱신으로 따라잡을 수 없을 때의 복구 수단이다.
 */
export const trailSnapshotPayloadSchema = z.object({
    id: uuidSchema,
    title: z.string(),
    revision: z.int().min(0),
    mode: trailModeSchema,
    /** `null` 이면 화면이 `settings.ui.childOrder` 를 쓴다. */
    childOrder: childOrderSchema.nullable(),
    activeNodeId: uuidSchema.nullable(),
    roots: z.array(trailNodeSchema),
    nodeUi: z.record(uuidSchema, nodeUiStateSchema),
});

export const rootAddedPayloadSchema = z.object({
    node: trailNodeSchema,
});

export const nodeAddedPayloadSchema = z.object({
    parentId: uuidSchema,
    node: trailNodeSchema,
});

export const nodeRemovedPayloadSchema = z.object({
    nodeId: uuidSchema,
    /** 지운 노드의 이름. 알림에 무엇을 지웠는지 적는다. */
    name: z.string().optional(),
    /** 하위 노드를 포함해 사라진 노드 수. */
    count: z.int().min(1).optional(),
    /** 서버가 되돌리기 버퍼에 담아 뒀는지. 담겼을 때만 `되돌리기` 를 붙인다. */
    undoable: z.boolean().optional(),
});

export const nodeToggledPayloadSchema = z.object({
    nodeId: uuidSchema,
    collapsed: z.boolean(),
});

/** `⇱` 로 새 루트가 되었다. 구조가 바뀌었으므로 클라이언트는 통째로 다시 그린다. */
export const nodePromotedPayloadSchema = z.object({
    nodeId: uuidSchema,
    /** 승격된 노드의 이름. 알림에 무엇을 떼어냈는지 적는다. */
    name: z.string().optional(),
    /** 서버가 되돌리기 버퍼에 담아 뒀는지. 담겼을 때만 `되돌리기` 를 붙인다(V10). */
    undoable: z.boolean().optional(),
});

/** 해석이 도는 동안 노드에 진행 표시를 켜고 끈다. */
export const nodeBusyPayloadSchema = z.object({
    nodeId: uuidSchema,
    on: z.boolean(),
});

export const nodeUiChangedPayloadSchema = z.object({
    nodeId: uuidSchema,
    state: nodeUiStateSchema.nullable(),
});

export const modeChangedPayloadSchema = z.object({
    mode: trailModeSchema,
});

export const childOrderChangedPayloadSchema = z.object({
    childOrder: childOrderSchema.nullable(),
});

export const activeNodeChangedPayloadSchema = z.object({
    nodeId: uuidSchema.nullable(),
});

export const trailRenamedPayloadSchema = z.object({
    title: z.string(),
});

export const trailListChangedPayloadSchema = z.object({
    trails: z.array(trailSummarySchema),
    activeTrailId: uuidSchema.nullable(),
});

/**
 * Markdown 이 준비됐다. 본문을 이벤트에 싣지 않는다 — 큰 문서를 WebSocket 으로
 * 흘리는 대신 HTTP 로 받아 브라우저 다운로드에 그대로 넘긴다(구현서 15.1).
 */
export const exportReadyPayloadSchema = z.object({
    trailId: uuidSchema,
    url: z.string(),
    fileName: z.string(),
});

/**
 * 저장된 스냅샷과 현재 파일 내용이 달라졌다.
 *
 * 노드를 지우거나 자동으로 다시 읽지 않는다 — 사용자가 원할 때만 갱신한다(구현서 9.4).
 * 파일이 같은 내용으로 다시 저장된 경우에는 보내지 않는다. 해시가 같으면
 * 노드가 보여주는 코드도 그대로이기 때문이다.
 */
export const nodesStalePayloadSchema = z.object({
    trailId: uuidSchema,
    nodeIds: z.array(uuidSchema),
    /** 다시 읽어서 더 이상 오래되지 않은 노드. 배지를 떼는 신호다. */
    cleared: z.array(uuidSchema).optional(),
});

/**
 * 트레일이 디스크에 쓰였다.
 *
 * 앱 바의 `저장됨` 표시가 이 revision 과 지금 revision 을 견준다. debounce 로
 * 모아 쓰기 때문에 명령이 끝난 시점과 파일에 남은 시점이 다르고, 그 차이를
 * 사용자가 알 방법이 지금까지 없었다.
 */
export const trailPersistedPayloadSchema = z.object({
    trailId: uuidSchema,
    revision: z.int().min(0),
});

// ── 워크스페이스·설정·언어 서버 ─────────────────────────────────────────────

export const documentOpenedPayloadSchema = documentResponseSchema;

export const searchResultPayloadSchema = workspaceSearchResponseSchema;

/**
 * 프로젝트 안의 파일이 바뀌었다.
 *
 * 서버가 대신 다시 읽지 않는다. 보고 있던 코드가 발밑에서 바뀌면 읽던 흐름이
 * 끊기기 때문이다(구현서 9.4). 무엇이 바뀌었는지만 알리고 갱신은 화면이 정한다.
 */
export const filesChangedPayloadSchema = z.object({
    relPaths: z.array(z.string()),
});

export const settingsChangedPayloadSchema = z.object({
    settings: projectSettingsSchema,
});

export const lspStateChangedPayloadSchema = z.object({
    language: z.enum(['cpp', 'csharp', 'go', 'rust', 'typescript']),
    state: z.enum(['notStarted', 'starting', 'ready', 'failed', 'stopped']),
    message: z.string().nullable(),
});

/**
 * 구현 후보가 둘 이상이라 서버가 고르지 않았다.
 *
 * 호출부의 정적 타입만으로는 어느 구현이 도는지 알 수 없다. 하나를 골라 붙이면
 * 그게 실행되는 코드라고 오해하게 되므로 사용자에게 넘긴다.
 */
export const implementationChoicePayloadSchema = z.object({
    nodeId: uuidSchema,
    /**
     * 사용자가 고르면 `trail.chooseCandidate` 에 실어 보낼 값.
     * 잘림을 알리기만 하는 경우에는 고를 것이 없으므로 `null` 이다.
     */
    choiceId: z.string().min(1).nullable(),
    /** 노드 헤더에 붙일 제목. 무엇의 구현 목록인지 보여준다. */
    title: z.string().optional(),
    /** 상한에 걸려 잘렸는지. 잘렸으면 UI 가 그 사실을 표시한다. */
    truncated: z.boolean(),
    candidates: z.array(z.object({
        candidateId: z.string().min(1),
        name: z.string(),
        displayPath: z.string(),
        line: z.int().min(0),
        /** 몸통이 있는 후보를 먼저 보여준다. */
        hasBody: z.boolean(),
    })),
});

/**
 * 정의 후보가 여럿이라 서버가 고르지 않았다.
 *
 * 구현 후보와 이유가 같다. 어느 것이 맞는지는 호출부의 정적 타입만으로 알 수
 * 없고, 하나를 골라 붙이면 그게 정답이라고 오해하게 된다.
 * 사용자가 고르면 `trail.chooseCandidate` 로 돌아온다.
 */
export const definitionChoicePayloadSchema = z.object({
    choiceId: z.string().min(1),
    /** 어느 노드에서 클릭했는지. 루트를 만드는 중이면 `null`. */
    nodeId: uuidSchema.nullable(),
    /**
     * 클릭한 그 지점. 화면이 후보 창을 그 토큰 바로 아래에 띄운다 —
     * 트리 맨 위에 뜨면 무엇의 후보인지 알 수 없다.
     */
    origin: trailOriginSchema.nullable().optional(),
    /** 창 제목. 없으면 화면이 기본 문구를 쓴다. */
    title: z.string().optional(),
    candidates: z.array(z.object({
        candidateId: z.string().min(1),
        name: z.string(),
        displayPath: z.string(),
        line: z.int().min(0),
        hasBody: z.boolean(),
    })),
});

/**
 * 외부 에디터 열기 결과 (구현서 17.2).
 *
 * 성공과 실패를 한 이벤트로 알린다. 못 열었을 때도 경로와 줄을 함께 주는데,
 * 화면이 그걸 복사할 수 있게 해서 에디터가 없어도 손으로 찾아갈 수 있게 한다.
 * **절대경로가 아니라 화면에 찍는 경로다.**
 */
export const editorOpenedPayloadSchema = z.object({
    displayPath: z.string(),
    /** 외부 에디터 관례에 맞춘 1-based 줄과 컬럼. */
    line: z.int().min(1),
    column: z.int().min(1),
    launched: z.boolean(),
    reason: z.string().nullable(),
});

export const commandErrorPayloadSchema = z.object({
    error: commandErrorSchema,
});

export const analysisListChangedPayloadSchema = z.object({ analyses: z.array(analysisSummarySchema) });
export const analysisSnapshotPayloadSchema = z.object({ analysis: analysisDocumentSchema });
export const analysisPersistedPayloadSchema = z.object({ analysisId: uuidSchema, revision: z.int().min(0) });
export const annotationChangedPayloadSchema = z.object({ analysisId: uuidSchema, annotationId: uuidSchema });
export const replyAddedPayloadSchema = z.object({ analysisId: uuidSchema, annotationId: uuidSchema, replyId: uuidSchema });
export const reviewChangedPayloadSchema = z.object({ analysisId: uuidSchema, reviewId: uuidSchema });
export const anchorChangedPayloadSchema = z.object({ analysisId: uuidSchema, anchorId: uuidSchema });
export const sharePreparedPayloadSchema = z.object({ preview: sharePreviewSchema });
export const shareReadyPayloadSchema = z.object({
    analysisId: uuidSchema,
    format: z.enum(['ctshare', 'markdown', 'html']),
    url: z.string().min(1),
    fileName: z.string().min(1),
});
export const shareUploadPayloadSchema = z.object({ uploadId: uuidSchema });
export const shareImportPreviewPayloadSchema = z.object({
    uploadId: uuidSchema,
    title: z.string(),
    annotationCount: z.int().min(0),
    trailCount: z.int().min(0),
    codeIncluded: z.boolean(),
    merge: z.object({
        planId: uuidSchema,
        additionCount: z.int().min(0),
        updateCount: z.int().min(0),
        deletionCount: z.int().min(0),
        conflicts: z.array(z.object({
            entity: z.enum(['annotation', 'reply']),
            id: uuidSchema,
            reason: z.enum(['bothChanged', 'deleteUpdate', 'missingBase']),
            localBody: z.string().nullable(),
            incomingBody: z.string().nullable(),
        })),
    }).nullable(),
});
export const shareImportedPayloadSchema = z.object({ analysisId: uuidSchema, duplicate: z.boolean() });
export const shareMergedPayloadSchema = z.object({
    analysisId: uuidSchema,
    additionCount: z.int().min(0),
    updateCount: z.int().min(0),
    deletionCount: z.int().min(0),
});
export const draftSavedPayloadSchema = z.object({ analysisId: uuidSchema, draftId: uuidSchema });
export const aiDraftReadyPayloadSchema = z.object({
    requestId: uuidSchema,
    inputBytes: z.int().min(0),
    languageId: z.string(),
    draft: z.object({
        id: uuidSchema,
        anchorId: uuidSchema,
        provider: z.string(),
        model: z.string(),
        baselineId: uuidSchema,
        range: z.object({
            start: z.object({ line: z.int().min(0), char: z.int().min(0) }),
            end: z.object({ line: z.int().min(0), char: z.int().min(0) }),
        }),
        body: z.string(),
        questions: z.array(z.string()),
        evidence: z.array(z.object({ anchorId: uuidSchema, claim: z.string() })),
        createdAt: z.iso.datetime(),
        acceptedAt: z.iso.datetime().nullable(),
    }),
});
export const aiAcceptedPayloadSchema = z.object({
    analysisId: uuidSchema,
    draftId: uuidSchema,
    annotationId: uuidSchema,
});
export const aiCancelledPayloadSchema = z.object({ requestId: uuidSchema, cancelled: z.boolean() });

// ── 이벤트 목록 ─────────────────────────────────────────────────────────────

export const EVENT_PAYLOADS = {
    'trail.snapshot': trailSnapshotPayloadSchema,
    'trail.rootAdded': rootAddedPayloadSchema,
    'trail.nodeAdded': nodeAddedPayloadSchema,
    'trail.nodeRemoved': nodeRemovedPayloadSchema,
    'trail.nodeToggled': nodeToggledPayloadSchema,
    'trail.nodePromoted': nodePromotedPayloadSchema,
    'trail.nodeBusy': nodeBusyPayloadSchema,
    'trail.nodeUiChanged': nodeUiChangedPayloadSchema,
    'trail.nodesStale': nodesStalePayloadSchema,
    'trail.persisted': trailPersistedPayloadSchema,
    'trail.modeChanged': modeChangedPayloadSchema,
    'trail.childOrderChanged': childOrderChangedPayloadSchema,
    'trail.activeNodeChanged': activeNodeChangedPayloadSchema,
    'trail.renamed': trailRenamedPayloadSchema,
    'trail.listChanged': trailListChangedPayloadSchema,
    'trail.exportReady': exportReadyPayloadSchema,
    'trail.implementationChoice': implementationChoicePayloadSchema,
    'trail.definitionChoice': definitionChoicePayloadSchema,
    'workspace.documentOpened': documentOpenedPayloadSchema,
    'workspace.searchResult': searchResultPayloadSchema,
    'workspace.filesChanged': filesChangedPayloadSchema,
    'settings.changed': settingsChangedPayloadSchema,
    'lsp.stateChanged': lspStateChangedPayloadSchema,
    'editor.opened': editorOpenedPayloadSchema,
    'command.error': commandErrorPayloadSchema,
    'analysis.listChanged': analysisListChangedPayloadSchema,
    'analysis.snapshot': analysisSnapshotPayloadSchema,
    'analysis.persisted': analysisPersistedPayloadSchema,
    'annotation.created': annotationChangedPayloadSchema,
    'annotation.updated': annotationChangedPayloadSchema,
    'annotation.deleted': annotationChangedPayloadSchema,
    'annotation.restored': annotationChangedPayloadSchema,
    'annotation.replyAdded': replyAddedPayloadSchema,
    'review.changed': reviewChangedPayloadSchema,
    'anchor.checked': anchorChangedPayloadSchema,
    'anchor.rebound': anchorChangedPayloadSchema,
    'walkthrough.changed': z.object({ analysisId: uuidSchema, walkthroughId: uuidSchema }),
    'share.prepared': sharePreparedPayloadSchema,
    'share.ready': shareReadyPayloadSchema,
    'share.uploadReady': shareUploadPayloadSchema,
    'share.importPreview': shareImportPreviewPayloadSchema,
    'share.imported': shareImportedPayloadSchema,
    'share.merged': shareMergedPayloadSchema,
    'analysis.draftSaved': draftSavedPayloadSchema,
    'ai.draftReady': aiDraftReadyPayloadSchema,
    'ai.accepted': aiAcceptedPayloadSchema,
    'ai.cancelled': aiCancelledPayloadSchema,
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;

export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_PAYLOADS)[T]>;

export interface ServerEvent<T extends EventType = EventType> {
    protocolVersion: typeof PROTOCOL_VERSION;
    type: T;
    eventId: string;
    /** 이 이벤트를 낳은 명령. 다른 탭이 만든 변화면 없다. */
    commandId?: string;
    trailId?: string;
    /** 이 이벤트를 적용한 뒤의 revision. 트레일을 바꾸지 않는 이벤트에는 없다. */
    revision?: number;
    payload: EventPayload<T>;
}

const envelopeSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    type: z.string(),
    eventId: z.string().min(1),
    commandId: z.string().min(1).optional(),
    trailId: uuidSchema.optional(),
    revision: z.int().min(0).optional(),
    payload: z.unknown(),
});

/**
 * 받은 값을 이벤트로 해석한다. 브라우저가 서버 응답을 믿기 전에 통과시킨다.
 * 서버를 못 믿어서가 아니라, 버전이 어긋난 채로 화면이 반쯤 그려지는 것을 막기 위해서다.
 */
export function parseServerEvent(raw: unknown): ParseResult<ServerEvent> {
    const envelope = parseWith(envelopeSchema, raw);
    if (!envelope.ok) {
        return envelope;
    }
    const { type } = envelope.value;
    if (!(type in EVENT_PAYLOADS)) {
        return {
            ok: false,
            error: {
                code: 'INVALID_COMMAND',
                message: '모르는 이벤트다.',
                retryable: false,
                details: { type },
            },
        };
    }
    const eventType = type as EventType;
    const schema: z.ZodType = EVENT_PAYLOADS[eventType];
    const payload = parseWith(schema, envelope.value.payload);
    if (!payload.ok) {
        return payload;
    }
    return {
        ok: true,
        value: {
            protocolVersion: PROTOCOL_VERSION,
            type: eventType,
            eventId: envelope.value.eventId,
            ...(envelope.value.commandId !== undefined
                ? { commandId: envelope.value.commandId }
                : {}),
            ...(envelope.value.trailId !== undefined ? { trailId: envelope.value.trailId } : {}),
            ...(envelope.value.revision !== undefined
                ? { revision: envelope.value.revision }
                : {}),
            payload: payload.value as EventPayload<EventType>,
        },
    };
}
