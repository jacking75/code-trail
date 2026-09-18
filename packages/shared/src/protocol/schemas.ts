import { z } from 'zod';

import type { NodeUiState, TrailNode, TrailOrigin } from '../domain/trail.js';
import type { ResolvedSymbol } from '../domain/symbol.js';
import type { ProjectSettings, LanguageServerSettings, LocalSettings } from '../domain/settings.js';
import type { StoredTrail, StoredTrailNode, TrailSummary } from '../domain/storage.js';

/**
 * 서버와 브라우저가 주고받는 모든 값의 런타임 스키마.
 *
 * 타입은 도메인 쪽(`domain/`)이 정본이고 여기서는 그 모양을 런타임에 확인한다.
 * 두 곳이 어긋나면 `satisfies z.ZodType<...>` 에서 컴파일이 깨지므로,
 * 도메인 타입을 고치면 여기도 반드시 같이 고치게 된다.
 *
 * HTTP 응답과 WebSocket 명령·이벤트가 같은 스키마 도구를 쓴다(구현서 6.1).
 * 스키마를 통과하지 않은 값은 도메인에 들어가지 않는다.
 */

export const PROTOCOL_VERSION = 1;

// ── 기본형 ──────────────────────────────────────────────────────────────────

/** 노드·트레일 ID. 항상 UUID 다. 파일명으로 쓰이므로 형식을 강제한다. */
export const uuidSchema = z.uuid();

/** 0 이상의 정수. 줄·컬럼 좌표에 쓴다. */
export const offsetSchema = z.int().min(0);

/** 화면 좌표와 크기. 픽셀 단위 실수를 허용한다. */
export const pixelSchema = z.number().finite();

export const trailModeSchema = z.enum(['tree', 'board']);

export const childOrderSchema = z.enum(['source', 'click']);

/** 심볼 해석을 지원하는 언어. 오류 맥락과 상태 이벤트가 함께 쓴다. */
export const supportedLanguageSchema = z.enum(['cpp', 'csharp', 'go', 'rust', 'typescript']);

export const lspStateSchema = z.enum(['notStarted', 'starting', 'ready', 'failed', 'stopped']);

// ── 도메인 ──────────────────────────────────────────────────────────────────

export const resolvedSymbolSchema = z.object({
    name: z.string(),
    detail: z.string(),
    container: z.string(),
    kind: z.int(),
    relPath: z.string().nullable(),
    displayPath: z.string(),
    external: z.boolean(),
    languageId: z.string(),
    code: z.string(),
    startLine: offsetSchema,
    anchorLine: offsetSchema,
    anchorChar: offsetSchema,
    approximate: z.boolean(),
    callable: z.boolean(),
    declarationOnly: z.boolean(),
    contentHash: z.string().nullable(),
    modifiedAt: z.string().nullable(),
    documentId: z.string().nullable(),
}) satisfies z.ZodType<ResolvedSymbol>;

/** 저장 파일의 심볼. `documentId` 가 없다 — 세션 밖으로 나가지 않는 값이다. */
export const storedSymbolSchema = resolvedSymbolSchema.omit({ documentId: true });

export const trailOriginSchema = z.object({
    line: offsetSchema,
    char: offsetSchema,
    text: z.string(),
}) satisfies z.ZodType<TrailOrigin>;

export const trailNodeSchema: z.ZodType<TrailNode> = z.lazy(() =>
    z.object({
        id: uuidSchema,
        parentId: uuidSchema.nullable(),
        symbol: resolvedSymbolSchema,
        origin: trailOriginSchema.nullable(),
        collapsed: z.boolean(),
        recursive: z.boolean(),
        children: z.array(trailNodeSchema),
    }),
);

export const storedTrailNodeSchema: z.ZodType<StoredTrailNode> = z.lazy(() =>
    z.object({
        id: uuidSchema,
        parentId: uuidSchema.nullable(),
        symbol: storedSymbolSchema,
        origin: trailOriginSchema.nullable(),
        collapsed: z.boolean(),
        recursive: z.boolean(),
        children: z.array(storedTrailNodeSchema),
    }),
);

export const nodeUiStateSchema = z.object({
    boardX: pixelSchema.optional(),
    boardY: pixelSchema.optional(),
    bodyHeight: pixelSchema.optional(),
    codeFontSize: pixelSchema.optional(),
}) satisfies z.ZodType<NodeUiState>;

export const storedTrailSchema = z.object({
    schemaVersion: z.literal(1),
    id: uuidSchema,
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: z.int().min(0),
    activeNodeId: uuidSchema.nullable(),
    mode: trailModeSchema,
    // 옛 저장 파일에는 없다. 없으면 화면이 설정 기본값을 쓴다.
    childOrder: childOrderSchema.nullable().optional(),
    roots: z.array(storedTrailNodeSchema),
    nodeUi: z.record(uuidSchema, nodeUiStateSchema),
}) satisfies z.ZodType<StoredTrail>;

export const trailSummarySchema = z.object({
    id: uuidSchema,
    title: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    revision: z.int().min(0),
    nodeCount: z.int().min(0),
    rootCount: z.int().min(0),
}) satisfies z.ZodType<TrailSummary>;

// ── 설정 ────────────────────────────────────────────────────────────────────

export const languageServerSettingsSchema = z.object({
    enabled: z.boolean(),
    executable: z.string().nullable(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()),
    initializationOptions: z.unknown(),
}) satisfies z.ZodType<LanguageServerSettings>;

export const projectSettingsSchema = z.object({
    schemaVersion: z.literal(1),
    ui: z.object({
        theme: z.enum(['system', 'light', 'dark']),
        clickTarget: z.enum(['allSymbols', 'callsOnly']),
        childOrder: z.enum(['source', 'click']),
        maxCodeLines: z.int().min(1),
        contextLines: z.int().min(1),
        fitToWidth: z.boolean(),
        minFontSize: z.number().min(1),
        fontSize: z.number().min(0),
        autoFollowSingleImplementation: z.boolean(),
        revealInExternalEditorOnAdd: z.boolean(),
    }),
    editor: z.object({
        executable: z.string().nullable(),
        args: z.array(z.string()),
    }),
    languages: z.object({
        cpp: languageServerSettingsSchema,
        // C# 만 솔루션 경로를 더 갖는다. 프로젝트 상대경로다.
        csharp: languageServerSettingsSchema.extend({
            solutionPath: z.string().nullable(),
        }),
        go: languageServerSettingsSchema,
        rust: languageServerSettingsSchema,
        typescript: languageServerSettingsSchema.default({
            enabled: true, executable: null, args: [], env: {}, initializationOptions: null,
        }),
    }),
}) satisfies z.ZodType<ProjectSettings>;

const localLanguageSettingsSchema = languageServerSettingsSchema.omit({ enabled: true });

export const localSettingsSchema = z.object({
    schemaVersion: z.literal(1),
    editor: z.object({
        executable: z.string().nullable(),
        args: z.array(z.string()),
    }),
    languages: z.object({
        cpp: localLanguageSettingsSchema,
        csharp: localLanguageSettingsSchema,
        go: localLanguageSettingsSchema,
        rust: localLanguageSettingsSchema,
        typescript: localLanguageSettingsSchema.default({
            executable: null, args: [], env: {}, initializationOptions: null,
        }),
    }),
    author: z.object({ id: uuidSchema, displayName: z.string().trim().min(1).max(100) }).nullable(),
    ai: z.object({
        enabled: z.boolean(),
        provider: z.literal('ollama'),
        // shared 패키지는 DOM의 URL 타입에 의존하지 않는다. 경로 없는 loopback
        // origin만 허용해 제공자가 프로젝트 파일을 이용한 SSRF 통로가 되지 않게 한다.
        endpoint: z.string().regex(
            /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?\/?$/,
            { message: 'AI 제공자는 로컬 호스트 주소만 허용한다.' },
        ),
        model: z.string().max(200),
        maxInputBytes: z.int().min(1_024).max(1_048_576),
        timeoutMs: z.int().min(1_000).max(300_000),
    }).default({
        enabled: false,
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        model: '',
        maxInputBytes: 65_536,
        timeoutMs: 60_000,
    }),
}) satisfies z.ZodType<LocalSettings>;

// ── 오류 ────────────────────────────────────────────────────────────────────

export const COMMAND_ERROR_CODES = [
    'INVALID_COMMAND',
    'UNAUTHORIZED',
    'STALE_REVISION',
    'ANNOTATION_CONFLICT',
    'NOT_FOUND',
    'LSP_UNAVAILABLE',
    'LSP_TIMEOUT',
    'PATH_DENIED',
    'PERSISTENCE_FAILED',
    /** 서버가 닫히는 중이다. 이 명령은 저장되지 않는다. */
    'SERVER_STOPPING',
    'INTERNAL_ERROR',
] as const;

export type CommandErrorCode = (typeof COMMAND_ERROR_CODES)[number];

/**
 * 오류가 난 자리의 상황.
 *
 * "정의를 찾지 못했다" 만으로는 사용자가 다음에 무엇을 할지 모른다. 어느 언어
 * 서버였고 그 서버가 어떤 상태였는지, 그리고 화면이 어떤 버튼을 붙이면 되는지를
 * 함께 싣는다. **경로도 실행 파일 위치도 담지 않는다** — 담는 것은 상태뿐이다.
 */
export interface CommandErrorContext {
    language?: 'cpp' | 'csharp' | 'go' | 'rust' | 'typescript';
    lspState?: 'notStarted' | 'starting' | 'ready' | 'failed' | 'stopped';
    /** 실제 샘플 요청으로 확인된 서버인지. */
    verified?: boolean;
    /** 화면이 알림에 붙일 버튼. */
    action?: 'openDiagnostics' | 'retry' | 'chooseSolution' | 'verify';
}

/**
 * `details` 에 stack, 절대경로, 코드 본문, 환경 변수, 원문 LSP payload 를 넣지 않는다
 * (구현서 15.2). 브라우저는 신뢰 경계 밖이고, 오류 메시지는 그 경계를 넘는 통로다.
 */
export interface CommandError {
    code: CommandErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
    context?: CommandErrorContext;
}

export const commandErrorContextSchema = z.object({
    language: supportedLanguageSchema.optional(),
    lspState: lspStateSchema.optional(),
    verified: z.boolean().optional(),
    action: z.enum(['openDiagnostics', 'retry', 'chooseSolution', 'verify']).optional(),
}) satisfies z.ZodType<CommandErrorContext>;

export const commandErrorSchema = z.object({
    code: z.enum(COMMAND_ERROR_CODES),
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
    // 전부 선택이라 `context` 를 모르는 옛 화면도 그대로 통과한다.
    context: commandErrorContextSchema.optional(),
}) satisfies z.ZodType<CommandError>;

// ── HTTP ────────────────────────────────────────────────────────────────────

export const workspaceEntrySchema = z.object({
    /** 프로젝트 루트 기준 `/` 구분 상대경로. 루트 자신은 빈 문자열이다. */
    id: z.string(),
    name: z.string(),
    kind: z.enum(['file', 'directory']),
    /** 디렉터리일 때 하위 항목이 있는지. 접힌 채로 화살표를 그릴지 정한다. */
    hasChildren: z.boolean().optional(),
    /** 파일일 때 언어 ID. 모르면 `null`. */
    languageId: z.string().nullable().optional(),
});

export const workspaceChildrenResponseSchema = z.object({
    parentId: z.string(),
    entries: z.array(workspaceEntrySchema),
});

export const workspaceSearchResponseSchema = z.object({
    query: z.string(),
    /** 상한에 걸려 잘렸는지. 잘렸으면 UI 가 그 사실을 표시한다. */
    truncated: z.boolean(),
    entries: z.array(workspaceEntrySchema),
});

export const documentResponseSchema = z.object({
    documentId: z.string(),
    relPath: z.string(),
    displayPath: z.string(),
    languageId: z.string(),
    contentHash: z.string(),
    modifiedAt: z.string(),
    /** 원문 그대로. 들여쓰기·탭·줄바꿈을 손대지 않는다. */
    text: z.string(),
});

export const bootstrapResponseSchema = z.object({
    protocolVersion: z.literal(PROTOCOL_VERSION),
    project: z.object({
        /** 표시용 프로젝트 이름. 절대경로를 내보내지 않는다. */
        name: z.string(),
    }),
    settings: projectSettingsSchema,
    localAuthor: z.object({ id: uuidSchema, displayName: z.string() }).nullable(),
    trails: z.array(trailSummarySchema),
    activeTrailId: uuidSchema.nullable(),
    capabilities: z.object({
        externalEditor: z.boolean(),
        languages: z.array(z.enum(['cpp', 'csharp', 'go', 'rust', 'typescript'])),
        analyses: z.boolean(),
        sharing: z.boolean(),
        readOnlyShare: z.boolean(),
    }),
});

export const healthResponseSchema = z.object({
    status: z.literal('ok'),
    /** 프로세스가 뜬 뒤 지난 초. 절대 시각을 내보내지 않는다. */
    uptimeSeconds: z.number().min(0),
});

export const diagnosticsResponseSchema = z.object({
    languages: z.array(z.object({
        language: z.enum(['cpp', 'csharp', 'go', 'rust', 'typescript']),
        enabled: z.boolean(),
        state: z.enum(['notStarted', 'starting', 'ready', 'failed', 'stopped']),
        /** 탐지된 실행 파일 이름. 전체 경로는 내보내지 않는다. */
        executableName: z.string().nullable(),
        lastError: z.string().nullable(),
    })),
    /** 시작할 때 발견한 `.tmp` 복구 후보. */
    recoveryCandidates: z.array(z.object({
        trailId: uuidSchema,
        savedAt: z.string(),
    })),
});

// ── 검증 헬퍼 ───────────────────────────────────────────────────────────────

export type ParseResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: CommandError };

/**
 * 스키마를 통과시키고, 실패하면 브라우저에 그대로 보내도 되는 오류로 바꾼다.
 *
 * zod 의 오류를 그대로 넘기지 않는다. 받은 값이 오류 메시지에 섞여 나가면
 * 코드 본문이나 경로가 신뢰 경계를 넘을 수 있다. 어디가 틀렸는지(`path`)만 남긴다.
 */
export function parseWith<T>(schema: z.ZodType<T>, value: unknown): ParseResult<T> {
    const result = schema.safeParse(value);
    if (result.success) {
        return { ok: true, value: result.data };
    }
    return {
        ok: false,
        error: {
            code: 'INVALID_COMMAND',
            message: '형식이 맞지 않는 값이다.',
            retryable: false,
            details: {
                issues: result.error.issues.map((issue) => ({
                    path: issue.path.join('.'),
                    code: issue.code,
                })),
            },
        },
    };
}
