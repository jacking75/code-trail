import { clearSession, currentToken } from './session.js';

/**
 * HTTP 클라이언트.
 *
 * 모든 요청에 Bearer 토큰을 싣는다. 토큰이 거부되면 저장된 값을 지운다 —
 * 남겨두면 모든 요청이 조용히 401 로 실패하고 화면은 "로딩 중" 에 머문다.
 */

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = currentToken();
    if (token === null) {
        throw new ApiError(401, 'UNAUTHORIZED', '세션 토큰이 없다.');
    }

    const response = await fetch(path, {
        ...init,
        headers: {
            ...(init?.headers ?? {}),
            Authorization: `Bearer ${token}`,
        },
        // 로컬 서버 하나만 부른다. 다른 origin 으로는 나가지 않는다.
        credentials: 'omit',
        mode: 'same-origin',
    });

    if (response.status === 401) {
        clearSession();
        throw new ApiError(401, 'UNAUTHORIZED', '세션이 만료됐다. 터미널에서 다시 실행한다.');
    }
    if (!response.ok) {
        let code = 'INTERNAL_ERROR';
        let message = `요청이 실패했다 (${response.status}).`;
        try {
            const body = (await response.json()) as { code?: string; message?: string };
            code = body.code ?? code;
            message = body.message ?? message;
        } catch {
            // 본문이 JSON 이 아니다. 상태 코드만으로 충분하다.
        }
        throw new ApiError(response.status, code, message);
    }

    return (await response.json()) as T;
}

export interface WorkspaceEntry {
    id: string;
    name: string;
    kind: 'file' | 'directory';
    hasChildren?: boolean;
    languageId?: string | null;
}

export interface DocumentContent {
    documentId: string;
    relPath: string;
    displayPath: string;
    languageId: string;
    contentHash: string;
    modifiedAt: string;
    text: string;
}

export interface TrailSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    nodeCount: number;
    rootCount: number;
}

export interface LanguageServerView {
    enabled: boolean;
    executable: string | null;
    args: string[];
    env: Record<string, string>;
    initializationOptions: unknown;
}

/**
 * 화면이 쓰는 설정.
 *
 * 서버가 준 객체를 그대로 들고 있다가 고쳐서 되돌려 보낸다. 그래서 여기 안 적은
 * 필드(`schemaVersion` 등)도 값에는 남아 있다 — 통째로 펼쳐 보내야 서버 스키마를
 * 통과한다.
 */
export interface ProjectSettingsView {
    ui: {
        theme: 'system' | 'light' | 'dark';
        clickTarget: 'allSymbols' | 'callsOnly';
        childOrder: 'source' | 'click';
        maxCodeLines: number;
        contextLines: number;
        fitToWidth: boolean;
        minFontSize: number;
        fontSize: number;
        autoFollowSingleImplementation: boolean;
        revealInExternalEditorOnAdd: boolean;
    };
    editor: {
        executable: string | null;
        /** `{path}`, `{line}`, `{column}`, `{project}` 만 쓸 수 있다. */
        args: string[];
    };
    languages: {
        cpp: LanguageServerView;
        csharp: LanguageServerView & { solutionPath: string | null };
        go: LanguageServerView;
        rust: LanguageServerView;
    };
}

export interface Bootstrap {
    protocolVersion: number;
    project: { name: string };
    settings: ProjectSettingsView;
    trails: TrailSummary[];
    activeTrailId: string | null;
    capabilities: { externalEditor: boolean; languages: string[] };
}

export interface HealthCheckView {
    label: string;
    level: 'ok' | 'warn' | 'error';
    detail: string;
}

export interface LanguageDiagnostics {
    language: 'cpp' | 'csharp' | 'go' | 'rust';
    displayName: string;
    enabled: boolean;
    state: 'notStarted' | 'starting' | 'ready' | 'failed' | 'stopped';
    executableName: string | null;
    detectionSource: string;
    lastError: string | null;
    restartCount: number;
    missingCapabilities: string[];
    healthChecks: HealthCheckView[];
    /** 자식 프로세스 PID. 안 떠 있으면 `null`. */
    pid: number | null;
    /** 서버가 **광고한** 네 capability. 광고와 실제 응답은 다를 수 있다. */
    capabilities: {
        definition: boolean;
        documentSymbol: boolean;
        implementation: boolean;
        typeDefinition: boolean;
    };
    initializeMs: number | null;
    lastRequest: { method: string; durationMs: number; at: string } | null;
    lastExit: { code: number | null; signal: string | null; at: string } | null;
    /** 실제 샘플 문서에서 요청이 응답했는지. `지원됨` 표시의 근거다. */
    verified: boolean;
    verifiedMethods: string[];
}

export interface EditorCandidateView {
    name: string;
    displayName: string;
    args: string[];
    executable: string;
}

export interface EditorDiagnostics {
    candidates: EditorCandidateView[];
    /** 지금 설정된 실행 파일. `null` 이면 열기 기능이 꺼져 있다. */
    configured: string | null;
    args: string[];
}

export interface SolutionDiagnostics {
    candidates: string[];
    suggested: string | null;
    selected: string | null;
}

export const api = {
    bootstrap: () => request<Bootstrap>('/api/bootstrap'),

    children: (id: string) =>
        request<{ parentId: string; entries: WorkspaceEntry[]; truncated: boolean }>(
            `/api/workspace/children?id=${encodeURIComponent(id)}`,
        ),

    search: (query: string) =>
        request<{ query: string; truncated: boolean; entries: WorkspaceEntry[] }>(
            `/api/workspace/search?q=${encodeURIComponent(query)}`,
        ),

    /** 프로젝트 안의 상대경로를 열어 문서 권한과 본문을 함께 받는다. */
    open: (relPath: string) =>
        request<DocumentContent>(`/api/workspace/open?relPath=${encodeURIComponent(relPath)}`),

    document: (documentId: string) =>
        request<DocumentContent>(`/api/documents/${encodeURIComponent(documentId)}`),

    diagnostics: () =>
        request<{ languages: LanguageDiagnostics[]; recoveryCandidates: unknown[] }>(
            '/api/diagnostics',
        ),

    editorDiagnostics: () => request<EditorDiagnostics>('/api/diagnostics/editor'),

    solutions: () => request<SolutionDiagnostics>('/api/diagnostics/csharp/solutions'),

    /**
     * 언어 서버의 최근 stderr.
     *
     * 코드 본문이 섞여 들어올 수 있어 기본 진단 화면에는 넣지 않고 사용자가
     * 따로 열게 한다(구현서 11.6).
     */
    lspLog: (language: string) =>
        request<{ language: string; lines: string[] }>(
            `/api/diagnostics/${encodeURIComponent(language)}/log`,
        ),
};
