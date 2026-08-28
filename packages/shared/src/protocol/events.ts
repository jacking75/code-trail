import { z } from 'zod';

import {
    PROTOCOL_VERSION,
    commandErrorSchema,
    documentResponseSchema,
    nodeUiStateSchema,
    parseWith,
    projectSettingsSchema,
    trailModeSchema,
    trailNodeSchema,
    trailSummarySchema,
    uuidSchema,
    workspaceSearchResponseSchema,
    type ParseResult,
} from './schemas.js';

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
});

export const nodeToggledPayloadSchema = z.object({
    nodeId: uuidSchema,
    collapsed: z.boolean(),
});

/** `⇱` 로 새 루트가 되었다. 구조가 바뀌었으므로 클라이언트는 통째로 다시 그린다. */
export const nodePromotedPayloadSchema = z.object({
    nodeId: uuidSchema,
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
 * 노드를 지우거나 자동으로 다시 읽지 않는다 — 사용자가 원할 때만 갱신한다(구현서 9.4).
 */
export const nodeStalePayloadSchema = z.object({
    nodeIds: z.array(uuidSchema),
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
    language: z.enum(['cpp', 'csharp', 'go', 'rust']),
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

export const commandErrorPayloadSchema = z.object({
    error: commandErrorSchema,
});

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
    'trail.nodeStale': nodeStalePayloadSchema,
    'trail.modeChanged': modeChangedPayloadSchema,
    'trail.activeNodeChanged': activeNodeChangedPayloadSchema,
    'trail.renamed': trailRenamedPayloadSchema,
    'trail.listChanged': trailListChangedPayloadSchema,
    'trail.exportReady': exportReadyPayloadSchema,
    'trail.implementationChoice': implementationChoicePayloadSchema,
    'workspace.documentOpened': documentOpenedPayloadSchema,
    'workspace.searchResult': searchResultPayloadSchema,
    'workspace.filesChanged': filesChangedPayloadSchema,
    'settings.changed': settingsChangedPayloadSchema,
    'lsp.stateChanged': lspStateChangedPayloadSchema,
    'command.error': commandErrorPayloadSchema,
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
