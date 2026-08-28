import { z } from 'zod';

import {
    PROTOCOL_VERSION,
    nodeUiStateSchema,
    offsetSchema,
    parseWith,
    projectSettingsSchema,
    trailModeSchema,
    uuidSchema,
    type ParseResult,
} from './schemas.js';

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

export const lspRestartPayloadSchema = z.object({
    language: z.enum(['cpp', 'csharp', 'go', 'rust']),
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
    'trail.exportMarkdown',
    'workspace.openDocument',
    'workspace.searchFiles',
    'editor.openLocation',
    'settings.update',
    'lsp.restart',
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
    'trail.exportMarkdown': emptyPayloadSchema,
    'workspace.openDocument': openDocumentPayloadSchema,
    'workspace.searchFiles': searchFilesPayloadSchema,
    'editor.openLocation': openLocationPayloadSchema,
    'settings.update': settingsUpdatePayloadSchema,
    'lsp.restart': lspRestartPayloadSchema,
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
