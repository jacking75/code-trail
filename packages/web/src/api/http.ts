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

/** 화면이 쓰는 설정. 서버 타입 전체를 가져오지 않고 필요한 것만 적는다. */
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
};
