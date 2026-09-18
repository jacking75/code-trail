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
    /**
     * 이 파일 형식에 심볼 해석이 되는지. `null` 이면 언어 서버에 물을 것이 없다.
     * 서버 왕복 없이 화면에서 바로 안내한다.
     */
    supportedLanguage?: 'cpp' | 'csharp' | 'go' | 'rust' | 'typescript' | null;
}

/** 바뀐 줄 덩어리. 리뷰는 파일이 아니라 여기서 시작한다. */
export interface GitHunkView {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
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
        typescript: LanguageServerView;
    };
}

export interface Bootstrap {
    protocolVersion: number;
    project: { name: string };
    /** 확장자로 센 언어별 파일 수. 시작하기 카드가 쓴다. */
    languageSummary?: {
        languages: Array<{ languageId: string; fileCount: number }>;
        truncated: boolean;
    };
    settings: ProjectSettingsView;
    localAuthor: { id: string; displayName: string } | null;
    trails: TrailSummary[];
    activeTrailId: string | null;
    capabilities: {
        externalEditor: boolean;
        languages: string[];
        analyses: boolean;
        sharing: boolean;
        readOnlyShare: boolean;
        ai: { enabled: boolean; provider: string; model: string; maxInputBytes: number };
    };
}

export interface AnalysisSummaryView {
    id: string; title: string; purpose: string; revision: number; updatedAt: string;
    annotationCount: number; unresolvedCount: number; reviewedCount: number; reviewTargetCount: number;
    /** 이 분석이 다루는 트레일. 트레일을 고르면 짝지은 분석이 따라온다. */
    trailIds?: string[];
}

export interface AnalysisDocumentView {
    schemaVersion: 1; id: string; title: string; purpose: string; revision: number;
    createdAt: string; updatedAt: string; trailIds: string[];
    authors: Array<{ id: string; displayName: string }>;
    annotations: Array<{ id: string; version: number; target: Record<string, unknown>; kind: 'explanation' | 'question' | 'concern' | 'conclusion'; body: string; tags: string[]; status: 'open' | 'resolved'; authorId: string; createdAt: string; updatedAt: string; deletedAt: string | null }>;
    replies: Array<{ id: string; annotationId: string; body: string; authorId: string; deletedAt: string | null }>;
    anchors: Array<Record<string, unknown>>;
    baselines: Array<Record<string, unknown>>;
    reviews: Array<{ id: string; target: Record<string, unknown>; state: string; evidenceIds: string[] }>;
    walkthroughs: Array<{ id: string; version: number; title: string; steps: Array<{ id: string; title: string; body: string; annotationId: string | null; target: Record<string, unknown> | null; baselineId: string | null }> }>;
    goals: Array<Record<string, unknown>>;
    importantLocations: Array<Record<string, unknown>>;
    history: Array<Record<string, unknown>>;
    processedCommands: Array<Record<string, unknown>>;
    sourceShare: Record<string, unknown> | null;
}

export interface AnchorComparisonView {
    analysisId: string;
    anchorId: string;
    relPath: string;
    state: 'matched' | 'moved' | 'changed' | 'ambiguous' | 'missing' | 'unknown';
    previousRange: { start: { line: number; char: number }; end: { line: number; char: number } };
    currentRange: { start: { line: number; char: number }; end: { line: number; char: number } };
    previousText: string | null;
    currentText: string | null;
    previousUnavailableReason: 'code-not-included' | null;
    currentUnavailableReason: 'file-unavailable' | 'range-unavailable' | null;
}

export interface HealthCheckView {
    label: string;
    level: 'ok' | 'warn' | 'error';
    detail: string;
}

export interface LanguageDiagnostics {
    language: 'cpp' | 'csharp' | 'go' | 'rust' | 'typescript';
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
        request<{ languages: LanguageDiagnostics[]; recoveryCandidates: Array<{ trailId: string; savedAt: string }>; analysisRecoveryCandidates: Array<{ analysisId: string; kind: 'temporary' | 'backup'; savedAt: string }> }>(
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

    analyses: () => request<{ analyses: AnalysisSummaryView[] }>('/api/analyses'),

    analysis: (analysisId: string) =>
        request<AnalysisDocumentView>(`/api/analyses/${encodeURIComponent(analysisId)}`),

    anchorComparison: (analysisId: string, anchorId: string) =>
        request<AnchorComparisonView>(
            `/api/analyses/${encodeURIComponent(analysisId)}/anchors/${encodeURIComponent(anchorId)}/compare`,
        ),

    documentSymbols: (documentId: string, signal?: AbortSignal) =>
        request<{ documentId: string; symbols: Array<{ name: string; detail: string; container: string; kind: number; depth: number; selectionRange: { start: { line: number; character: number } } }> }>(
            `/api/documents/${encodeURIComponent(documentId)}/symbols`,
            { signal },
        ),

    changes: (from?: string, to?: string) => request<{ repository: boolean; changes: Array<{ relPath: string; status: string; area: string; addedLines: number | null; deletedLines: number | null }> }>(
        `/api/changes${from ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to ?? 'HEAD')}` : ''}`,
    ),

    /** 그 파일에서 바뀐 줄 덩어리. 변경 목록에 있는 파일만 받는다. */
    hunks: (relPath: string, from?: string, to?: string) =>
        request<{ relPath: string; hunks: GitHunkView[] }>(
            `/api/changes/hunks?relPath=${encodeURIComponent(relPath)}`
            + (from ? `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to ?? 'HEAD')}` : ''),
        ),

    /** `HEAD`(또는 커밋 해시) 시점의 본문. 좌우 비교의 왼쪽에 넣는다. */
    originalText: (relPath: string, ref = 'HEAD') =>
        request<{ ref: string; text: string }>(
            `/api/changes/original?relPath=${encodeURIComponent(relPath)}&ref=${encodeURIComponent(ref)}`,
        ),

    contentSearch: (query: string, scope = '', caseSensitive = false, signal?: AbortSignal) =>
        request<{ matches: Array<{ relPath: string; line: number; char: number; preview: string }>; truncated: boolean; scannedFiles: number }>(
            `/api/workspace/content-search?q=${encodeURIComponent(query)}&scope=${encodeURIComponent(scope)}&case=${caseSensitive ? '1' : '0'}`,
            { signal },
        ),
};
