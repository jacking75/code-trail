import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import {
    api,
    ApiError,
    type Bootstrap,
    type DocumentContent,
    type LanguageDiagnostics,
    type ProjectSettingsView,
    type AnalysisDocumentView,
    type AnalysisSummaryView,
    type AnchorComparisonView,
} from '../api/http.js';
import { commands, type CommandContext } from '../api/commands.js';
import { TrailSocket, type ConnectionState, type ServerEventMessage } from '../api/socket.js';
import { DiagnosticsView } from '../features/diagnostics/DiagnosticsView.js';
import { CodeView } from '../features/source/CodeView.js';
import { TrailBar } from '../features/trail/TrailBar.js';
import { TrailView } from '../features/trail/TrailView.js';
import { useTrail } from '../features/trail/useTrail.js';
import type { TrailNodeView } from '../features/trail/types.js';
import { FileSearch } from '../features/workspace/FileSearch.js';
import { FileTree } from '../features/workspace/FileTree.js';
import {
    AnalysisPanel,
    type AiDraftView,
    type AnalysisTarget,
    type ImportPreviewView,
    type SelectedCodeRange,
    type SharePreviewView,
} from '../features/annotations/AnalysisPanel.js';
import { ReadingStarts } from '../features/changes/ReadingStarts.js';
import { currentToken } from '../api/session.js';

/**
 * 화면 뼈대 (구현서 16.1).
 *
 * ```text
 * ┌──────────────────────────────────────────────────────┐
 * │ 앱 바: 프로젝트 · 트레일 고르기 · 연결 상태          │
 * ├───────────────┬──────────────────────────────────────┤
 * │ 파일 탐색기   │ [코드] [트레일] 탭                   │
 * │ 검색          │ 코드 화면 또는 트레일 화면           │
 * └───────────────┴──────────────────────────────────────┘
 * ```
 *
 * 코드 화면과 트레일 화면을 탭으로 바꾼다. 작은 화면에서 둘을 나란히 놓으면
 * 코드도 트리도 못 읽는다.
 */

const STATE_LABEL: Record<ConnectionState, string> = {
    connecting: '연결 중',
    open: '연결됨',
    closed: '끊김',
};

type Pane = 'code' | 'trail' | 'analysis' | 'diagnostics';
type NavigationPoint = {
    pane: 'code' | 'trail'; relPath?: string; line?: number; char?: number;
    trailId?: string; nodeId?: string;
};

export function App(): JSX.Element {
    const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
    const [settings, setSettings] = useState<ProjectSettingsView | null>(null);
    const [connection, setConnection] = useState<ConnectionState>('connecting');
    const [document, setDocument] = useState<DocumentContent | null>(null);
    const [staleDocument, setStaleDocument] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pane, setPane] = useState<Pane>('code');
    const [diagnostics, setDiagnostics] = useState<LanguageDiagnostics[]>([]);
    const [recoveryCandidates, setRecoveryCandidates] = useState<Array<{ trailId?: string; analysisId?: string; kind?: 'temporary' | 'backup'; savedAt: string }>>([]);
    const [analyses, setAnalyses] = useState<AnalysisSummaryView[]>([]);
    const [analysis, setAnalysis] = useState<AnalysisDocumentView | null>(null);
    const [persistedRevision, setPersistedRevision] = useState<number | null>(null);
    const [selectedRange, setSelectedRange] = useState<SelectedCodeRange | null>(null);
    const [sharePreview, setSharePreview] = useState<SharePreviewView | null>(null);
    const [importPreview, setImportPreview] = useState<ImportPreviewView | null>(null);
    const [aiDraft, setAiDraft] = useState<AiDraftView | null>(null);
    const [aiBusy, setAiBusy] = useState(false);
    const [anchorComparison, setAnchorComparison] = useState<AnchorComparisonView | null>(null);
    const [, setNavigationVersion] = useState(0);
    const navigation = useRef<{ points: NavigationPoint[]; index: number }>({ points: [], index: -1 });
    const restoringNavigation = useRef(false);
    const [author, setAuthor] = useState(() => {
        const saved = window.localStorage.getItem('code-trail.author');
        if (saved) {
            try { return JSON.parse(saved) as { id: string; displayName: string }; } catch { /* 새로 만든다. */ }
        }
        return { id: crypto.randomUUID(), displayName: '로컬 작성자' };
    });
    /**
     * 외부 에디터를 못 띄웠을 때 보여줄 경로와 줄.
     *
     * 실행 실패가 곧 막다른 길이 되면 안 된다. 경로와 줄을 복사해 주면 에디터가
     * 없어도 사용자가 손으로 찾아갈 수 있다(구현서 17.2 6단계).
     */
    const [editorFallback, setEditorFallback] = useState<
        { displayPath: string; line: number; column: number; reason: string } | null
    >(null);

    const [socket, setSocket] = useState<TrailSocket | null>(null);
    const documentRef = useRef<DocumentContent | null>(null);
    documentRef.current = document;
    const authorRef = useRef(author);
    authorRef.current = author;

    const trailState = useTrail(socket);
    // 이벤트 처리기가 항상 최신이어야 한다. 의존성에 넣으면 소켓이 다시 붙는다.
    const handleEventRef = useRef(trailState.handleEvent);
    handleEventRef.current = trailState.handleEvent;
    const refreshDiagnosticsRef = useRef<() => void>(() => undefined);
    const contextRef = useRef<CommandContext | null>(null);
    const pendingAnnotation = useRef<{
        body: string; kind: 'explanation' | 'question' | 'concern' | 'conclusion'; tags: string[];
    } | null>(null);
    const pendingUpload = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const pendingAiRequest = useRef<string | null>(null);
    const handledReference = useRef<string | null>(null);

    const recordNavigation = useCallback((point: NavigationPoint): void => {
        if (restoringNavigation.current) return;
        const state = navigation.current;
        const previous = state.points[state.index];
        if (previous && JSON.stringify(previous) === JSON.stringify(point)) return;
        state.points = [...state.points.slice(0, state.index + 1), point].slice(-100);
        state.index = state.points.length - 1;
        window.localStorage.setItem('code-trail.navigation', JSON.stringify(state));
        setNavigationVersion((value) => value + 1);
    }, []);

    useEffect(() => {
        try {
            const saved = JSON.parse(window.localStorage.getItem('code-trail.navigation') ?? 'null') as { points?: NavigationPoint[]; index?: number } | null;
            if (saved && Array.isArray(saved.points) && Number.isInteger(saved.index)) {
                navigation.current = { points: saved.points.slice(-100), index: Math.min(saved.index ?? -1, saved.points.length - 1) };
                setNavigationVersion((value) => value + 1);
            }
        } catch { /* 개인 이동 이력은 손상되면 비운다. */ }
        void api
            .bootstrap()
            .then((data) => {
                setBootstrap(data);
                setSettings(data.settings);
                if (data.localAuthor) setAuthor(data.localAuthor);
            })
            .catch((cause: unknown) => {
                setError(
                    cause instanceof ApiError
                        ? cause.message
                        : '서버에 연결하지 못했다. 터미널에서 code-trail 을 다시 실행한다.',
                );
            });
    }, []);

    // 언어 서버 상태가 바뀔 때마다 다시 읽는다. capability 를 못 갖춘 기능은
    // UI 에서 아예 눌리지 않게 해야 한다.
    const refreshDiagnostics = useCallback(() => {
        void api
            .diagnostics()
            .then((data) => {
                setDiagnostics(data.languages);
                setRecoveryCandidates([...data.recoveryCandidates, ...data.analysisRecoveryCandidates]);
            })
            .catch(() => undefined);
    }, []);

    refreshDiagnosticsRef.current = refreshDiagnostics;

    useEffect(() => {
        refreshDiagnostics();
    }, [refreshDiagnostics]);

    useEffect(() => {
        const hash = window.location.hash;
        if (!hash || handledReference.current === hash || analyses.length === 0) return;
        const requested = new URLSearchParams(hash.slice(1)).get('localAnalysis');
        if (!requested || !analyses.some((item) => item.id === requested)) return;
        handledReference.current = hash;
        if (analysis?.id === requested) {
            setPane('analysis');
            return;
        }
        void api.analysis(requested).then((value) => {
            setAnalysis(value);
            setPersistedRevision(value.revision);
            setPane('analysis');
        }).catch(() => undefined);
    }, [analyses, analysis?.id]);

    useEffect(() => {
        const created = new TrailSocket({
            onState: setConnection,
            onEvent: (event: ServerEventMessage) => {
                if (event.type === 'command.error') {
                    const payload = event.payload as { error?: { message?: string } };
                    setError(payload.error?.message ?? '명령을 처리하지 못했다.');
                    if (pendingAiRequest.current) {
                        pendingAiRequest.current = null;
                        setAiBusy(false);
                    }
                    return;
                }
                if (event.type === 'workspace.filesChanged') {
                    // 열어둔 파일이 바뀌었으면 표시만 한다. 자동으로 다시 읽지
                    // 않는다 — 보고 있던 코드가 발밑에서 바뀌면 흐름이 끊긴다.
                    const payload = event.payload as { relPaths: string[] };
                    const open = documentRef.current;
                    if (open !== null && payload.relPaths.includes(open.relPath)) {
                        setStaleDocument(true);
                    }
                    return;
                }
                if (event.type === 'settings.changed') {
                    setSettings((event.payload as { settings: ProjectSettingsView }).settings);
                }
                if (event.type === 'lsp.stateChanged') {
                    refreshDiagnosticsRef.current();
                }
                if (event.type === 'editor.opened') {
                    const opened = event.payload as {
                        displayPath: string;
                        line: number;
                        column: number;
                        launched: boolean;
                        reason: string | null;
                    };
                    setEditorFallback(opened.launched ? null : {
                        displayPath: opened.displayPath,
                        line: opened.line,
                        column: opened.column,
                        reason: opened.reason ?? '에디터를 띄우지 못했다.',
                    });
                    return;
                }
                if (event.type === 'analysis.listChanged') {
                    const payload = event.payload as { analyses: AnalysisSummaryView[] };
                    setAnalyses(payload.analyses);
                    return;
                }
                if (event.type === 'analysis.snapshot') {
                    const payload = event.payload as { analysis: AnalysisDocumentView };
                    setAnalysis((current) => current === null || current.id === payload.analysis.id
                        ? payload.analysis : current);
                    return;
                }
                if (event.type === 'analysis.persisted') {
                    const payload = event.payload as { analysisId: string; revision: number };
                    setAnalysis((current) => {
                        if (current?.id === payload.analysisId) setPersistedRevision(payload.revision);
                        return current;
                    });
                    return;
                }
                if (event.type === 'anchor.checked' && pendingAnnotation.current) {
                    const payload = event.payload as { analysisId: string; anchorId: string };
                    const pending = pendingAnnotation.current;
                    pendingAnnotation.current = null;
                    const commandContext = contextRef.current;
                    if (commandContext) commands.createAnnotation(commandContext, {
                        analysisId: payload.analysisId,
                        target: { kind: 'range', anchorId: payload.anchorId },
                        ...pending,
                        author: authorRef.current,
                    });
                    return;
                }
                if (event.type === 'share.prepared') {
                    setSharePreview((event.payload as { preview: SharePreviewView }).preview);
                    return;
                }
                if (event.type === 'share.ready') {
                    const payload = event.payload as { url: string; fileName: string };
                    void downloadProtected(payload.url, payload.fileName).catch(() => setError('공유 파일을 내려받지 못했다.'));
                    return;
                }
                if (event.type === 'share.uploadReady') {
                    const uploadId = (event.payload as { uploadId: string }).uploadId;
                    const bytes = pendingUpload.current;
                    const commandContext = contextRef.current;
                    if (bytes && commandContext) {
                        for (let offset = 0, index = 0; offset < bytes.length; offset += 256 * 1024, index += 1) {
                            commands.uploadChunk(commandContext, uploadId, index, bytesToBase64(bytes.subarray(offset, offset + 256 * 1024)));
                        }
                        commands.importPreview(commandContext, uploadId);
                    }
                    return;
                }
                if (event.type === 'share.importPreview') {
                    setImportPreview(event.payload as ImportPreviewView);
                    return;
                }
                if (event.type === 'share.imported') {
                    const payload = event.payload as { analysisId: string };
                    void api.analysis(payload.analysisId).then((value) => {
                        setAnalysis(value); setPane('analysis'); setImportPreview(null); pendingUpload.current = null;
                    });
                    return;
                }
                if (event.type === 'share.merged') {
                    const payload = event.payload as { analysisId: string };
                    void api.analysis(payload.analysisId).then((value) => {
                        setAnalysis(value); setPane('analysis'); setImportPreview(null); pendingUpload.current = null;
                    });
                    return;
                }
                if (event.type === 'ai.draftReady') {
                    const payload = event.payload as { requestId: string; draft: AiDraftView };
                    if (pendingAiRequest.current === payload.requestId) {
                        setAiDraft(payload.draft);
                        pendingAiRequest.current = null;
                        setAiBusy(false);
                    }
                    return;
                }
                if (event.type === 'ai.cancelled') {
                    pendingAiRequest.current = null;
                    setAiBusy(false);
                    return;
                }
                if (event.type === 'ai.accepted') {
                    setAiDraft(null);
                    return;
                }
                handleEventRef.current(event);
            },
        });
        setSocket(created);
        created.connect();
        return () => {
            created.close();
            setSocket(null);
        };
    }, []);

    /** 명령을 보낼 때 쓰는 지금 상태. revision 이 어긋나면 서버가 거절한다. */
    const context: CommandContext | null = useMemo(() => {
        if (socket === null) {
            return null;
        }
        return {
            socket,
            trailId: trailState.trail?.id ?? trailState.activeTrailId,
            revision: trailState.trail?.revision ?? 0,
        };
    }, [socket, trailState.trail, trailState.activeTrailId]);
    contextRef.current = context;

    useEffect(() => {
        window.localStorage.setItem('code-trail.author', JSON.stringify(author));
        if (bootstrap === null) return;
        const timer = window.setTimeout(() => {
            const commandContext = contextRef.current;
            if (commandContext) commands.updateLocalAuthor(commandContext, author);
        }, 400);
        return () => window.clearTimeout(timer);
    }, [author, bootstrap]);

    const openFile = useCallback((relPath: string, line?: number, char?: number) => {
        void api
            .open(relPath)
            .then((content) => {
                setDocument(content);
                setStaleDocument(false);
                setError(null);
                setPane('code');
                if (line !== undefined) cursorRef.current = { line, char: char ?? 0 };
                recordNavigation({ pane: 'code', relPath, line: line ?? 0, char: char ?? 0 });
            })
            .catch((cause: unknown) => {
                setError(cause instanceof ApiError ? cause.message : '파일을 열지 못했다.');
            });
    }, [recordNavigation]);

    const moveNavigation = useCallback((delta: -1 | 1): void => {
        const state = navigation.current;
        const next = state.index + delta;
        const point = state.points[next];
        if (!point) return;
        state.index = next;
        restoringNavigation.current = true;
        if (point.pane === 'code' && point.relPath) {
            void api.open(point.relPath).then((content) => {
                setDocument(content); setStaleDocument(false); setPane('code');
                cursorRef.current = { line: point.line ?? 0, char: point.char ?? 0 };
            }).finally(() => { restoringNavigation.current = false; });
        } else if (point.pane === 'trail' && point.trailId) {
            const commandContext = contextRef.current;
            if (commandContext) {
                commands.selectTrail(commandContext, point.trailId);
                if (point.nodeId) commands.setActiveNode(commandContext, point.nodeId);
            }
            setPane('trail');
            restoringNavigation.current = false;
        } else restoringNavigation.current = false;
        window.localStorage.setItem('code-trail.navigation', JSON.stringify(state));
        setNavigationVersion((value) => value + 1);
    }, []);

    const navigateAnalysisTarget = useCallback((target: AnalysisTarget): void => {
        const commandContext = contextRef.current;
        if (target.kind === 'trail' || target.kind === 'node') {
            if (commandContext) {
                commands.selectTrail(commandContext, target.trailId);
                if (target.kind === 'node') commands.setActiveNode(commandContext, target.nodeId);
            }
            setPane('trail');
            return;
        }
        const anchor = (analysis?.anchors as Array<{
            id: string; fileId: string;
            range: SelectedCodeRange['range']; currentRange: SelectedCodeRange['range'] | null;
        }> | undefined)?.find((item) => item.id === target.anchorId);
        const file = (analysis?.baselines as Array<{ files: Array<{ fileId: string; relPath: string }> }> | undefined)
            ?.flatMap((baseline) => baseline.files).find((item) => item.fileId === anchor?.fileId);
        const range = anchor?.currentRange ?? anchor?.range;
        if (file && range) openFile(file.relPath, range.start.line, range.start.char);
    }, [analysis, openFile]);

    /** 코드 화면에서 루트를 만든다. 트레일이 없으면 먼저 하나 만든다. */
    const addRootHere = useCallback((line: number, char: number) => {
        if (context === null || documentRef.current === null) {
            return;
        }
        if (context.trailId === null) {
            commands.createTrail(context);
            setError('트레일을 새로 만들었다. 한 번 더 누른다.');
            return;
        }
        commands.addRootAt(context, documentRef.current.documentId, line, char);
        setPane('trail');
    }, [context]);

    // `Ctrl+Alt+T` — 확장과 같은 키다.
    const cursorRef = useRef<{ line: number; char: number }>({ line: 0, char: 0 });
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if (!(event.ctrlKey || event.metaKey) || !event.altKey) {
                return;
            }
            if (event.key.toLowerCase() !== 't') {
                return;
            }
            event.preventDefault();
            addRootHere(cursorRef.current.line, cursorRef.current.char);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [addRootHere]);

    const onIdentifierClick = useCallback((
        node: TrailNodeView,
        line: number,
        char: number,
        text: string,
        modifiers: { alt: boolean; ctrl: boolean },
    ) => {
        if (context === null) {
            return;
        }
        if (modifiers.ctrl) {
            // Ctrl/Cmd+클릭 — 외부 에디터에서 연다. 경로는 서버가 documentId 로
            // 역조회한다 — 브라우저는 경로를 모른다.
            if (node.symbol.documentId !== null) {
                commands.openInEditor(context, node.symbol.documentId, line, char);
            }
            return;
        }
        commands.setActiveNode(context, node.id);
        // Alt+클릭도 같은 명령으로 간다. 서버가 implementation 을 먼저 묻고
        // 없으면 정의로 되돌아간다 — 어느 쪽이든 사용자는 갈 곳을 얻는다.
        commands.resolve(context, node.id, line, char, text);
    }, [context]);

    /** 전체 펼치기·접기. 이미 그 상태인 노드는 건너뛴다. */
    const toggleAll = useCallback((collapsed: boolean) => {
        if (context === null || trailState.trail === null) {
            return;
        }
        const walk = (nodes: readonly TrailNodeView[]): void => {
            for (const node of nodes) {
                if (node.collapsed !== collapsed) {
                    commands.toggleNode(context, node.id, collapsed);
                }
                walk(node.children);
            }
        };
        walk(trailState.trail.roots);
    }, [context, trailState.trail]);

    // 테마. `system` 이면 아무것도 세우지 않고 브라우저 설정을 따른다.
    useEffect(() => {
        const theme = settings?.ui.theme ?? 'system';
        const root = window.document.documentElement;
        if (theme === 'system') {
            root.removeAttribute('data-theme');
        } else {
            root.setAttribute('data-theme', theme);
        }
    }, [settings?.ui.theme]);

    if (error !== null && bootstrap === null) {
        return (
            <div className="fatal">
                <h1>Code Trail</h1>
                <p>{error}</p>
            </div>
        );
    }

    const ui = settings?.ui;

    /**
     * 지금 열어둔 트레일에서 구현 찾기를 쓸 수 있는지.
     *
     * 언어 서버가 준비되지 않았으면 판단할 근거가 없으므로 켜 둔다 — 눌러보면
     * 서버가 이유를 알려준다. 준비된 뒤에 `implementation` 이 빠져 있다면 그때 끈다.
     */
    const implementationSupported = diagnostics
        .filter((info) => info.state === 'ready')
        .every((info) => !info.missingCapabilities.includes('implementation'));

    return (
        <div className="app">
            <header className="app-bar">
                <span className="app-name">Code Trail</span>
                <span className="project">{bootstrap?.project.name ?? '…'}</span>
                {context === null ? null : (
                    <TrailBar
                        trails={trailState.trails}
                        activeTrailId={trailState.activeTrailId}
                        onSelect={(trailId) => commands.selectTrail(context, trailId)}
                        onCreate={() => commands.createTrail(context)}
                        onRename={(title) => commands.renameTrail(context, title)}
                        onDelete={() => commands.deleteTrail(context)}
                    />
                )}
                <span className="spacer" />
                <span className={`conn conn-${connection}`}>{STATE_LABEL[connection]}</span>
            </header>

            <div className="app-body">
                <aside className="sidebar">
                    <FileSearch onOpenFile={openFile} />
                    <FileTree onOpenFile={openFile} activePath={document?.relPath ?? null} />
                    <ReadingStarts document={document} onOpenFile={openFile} onAddRoot={addRootHere} />
                </aside>

                <main className="main">
                    <div className="pane-tabs">
                        <button type="button" className="tab nav" aria-label="이전 읽던 위치" disabled={navigation.current.index <= 0} onClick={() => moveNavigation(-1)}>←</button>
                        <button type="button" className="tab nav" aria-label="다음 읽던 위치" disabled={navigation.current.index >= navigation.current.points.length - 1} onClick={() => moveNavigation(1)}>→</button>
                        <button
                            type="button"
                            className={pane === 'analysis' ? 'tab active' : 'tab'}
                            onClick={() => setPane('analysis')}
                        >
                            {`분석 기록${analysis ? ` (${analysis.annotations.filter((item) => item.deletedAt === null).length})` : ''}`}
                        </button>
                        <button
                            type="button"
                            className={pane === 'code' ? 'tab active' : 'tab'}
                            onClick={() => setPane('code')}
                        >
                            코드
                        </button>
                        <button
                            type="button"
                            className={pane === 'trail' ? 'tab active' : 'tab'}
                            onClick={() => setPane('trail')}
                        >
                            {`트레일${trailState.trail ? ` — ${trailState.trail.title}` : ''}`}
                        </button>
                        <button
                            type="button"
                            className={pane === 'diagnostics' ? 'tab active' : 'tab'}
                            onClick={() => {
                                refreshDiagnostics();
                                setPane('diagnostics');
                            }}
                        >
                            진단
                        </button>
                    </div>

                    {pane === 'code'
                        ? renderCodePane()
                        : pane === 'trail'
                            ? renderTrailPane()
                            : pane === 'analysis'
                                ? renderAnalysisPane()
                                : renderDiagnosticsPane()}

                    {error !== null ? <p className="panel-error">{error}</p> : null}
                </main>
            </div>

            {editorFallback === null ? null : (
                <div className="editor-fallback" role="status">
                    <span>{editorFallback.reason}</span>
                    <code>
                        {`${editorFallback.displayPath}:${editorFallback.line}`
                            + `:${editorFallback.column}`}
                    </code>
                    <button
                        type="button"
                        onClick={() => {
                            const text = `${editorFallback.displayPath}:${editorFallback.line}`
                                + `:${editorFallback.column}`;
                            void navigator.clipboard?.writeText(text);
                        }}
                    >
                        경로·줄 복사
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setEditorFallback(null);
                            setPane('diagnostics');
                        }}
                    >
                        에디터 정하기
                    </button>
                    <button
                        type="button"
                        className="danger"
                        onClick={() => setEditorFallback(null)}
                    >
                        닫기
                    </button>
                </div>
            )}

            {trailState.notice === null ? null : (
                <button
                    type="button"
                    className={`toast toast-${trailState.notice.level}`}
                    onClick={trailState.dismissNotice}
                >
                    {trailState.notice.message}
                </button>
            )}
        </div>
    );

    function renderCodePane(): JSX.Element {
        if (document === null) {
            return (
                <div className="placeholder">
                    <p>왼쪽에서 파일을 고르면 여기에 코드가 열린다.</p>
                    <p className="muted">
                        함수 위를 누르고 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> 를 누르면
                        트레일이 시작된다.
                    </p>
                </div>
            );
        }
        return (
            <>
                <div className="doc-bar">
                    <span className="doc-path">{document.displayPath}</span>
                    <span className="muted">{document.languageId}</span>
                    {staleDocument ? (
                        <button
                            type="button"
                            className="stale"
                            onClick={() => openFile(document.relPath)}
                        >
                            파일이 바뀌었다 — 다시 읽기
                        </button>
                    ) : null}
                </div>
                <CodeView
                    document={document}
                    onPositionClick={(position) => {
                        cursorRef.current = { line: position.line, char: position.char };
                    }}
                    onSelectionChange={(range) => setSelectedRange(range && document ? {
                        documentId: document.documentId,
                        label: `${document.displayPath}:${range.start.line + 1}`,
                        range,
                    } : null)}
                    annotationRanges={(analysis?.anchors ?? []).flatMap((anchor) => {
                        const value = anchor as { fileId?: string; currentRange?: SelectedCodeRange['range'] | null; range?: SelectedCodeRange['range'] };
                        const file = (analysis?.baselines ?? []).flatMap((baseline) => {
                            const base = baseline as { files?: Array<{ fileId: string; relPath: string }> };
                            return base.files ?? [];
                        }).find((candidate) => candidate.fileId === value.fileId && candidate.relPath === document.relPath);
                        return file ? [value.currentRange ?? value.range].filter((item): item is SelectedCodeRange['range'] => item !== undefined && item !== null) : [];
                    })}
                />
            </>
        );
    }

    function renderDiagnosticsPane(): JSX.Element {
        return (
            <DiagnosticsView
                languages={diagnostics}
                settings={settings}
                recoveryCandidates={recoveryCandidates}
                onRefresh={refreshDiagnostics}
                onRestart={(language) => {
                    if (context !== null) {
                        commands.restartLsp(context, language);
                    }
                }}
                onVerify={(language) => {
                    if (context !== null) {
                        commands.verifyLsp(context, language);
                    }
                }}
                onUpdateSettings={(next) => {
                    if (context !== null) {
                        commands.updateSettings(context, next);
                    }
                }}
                readOnly={bootstrap?.capabilities.readOnlyShare ?? false}
                onRecoverAnalysis={(analysisId, kind) => {
                    if (context) commands.recoverAnalysis(context, analysisId, kind);
                }}
            />
        );
    }

    function renderTrailPane(): JSX.Element {
        if (trailState.trail === null || context === null) {
            return (
                <div className="placeholder">
                    <p>아직 트레일이 없다.</p>
                    <p className="muted">위의 <b>＋ 새 트레일</b> 로 하나 만든다.</p>
                </div>
            );
        }
        const activeId = trailState.trail.activeNodeId;
        const nodes = flattenTrailNodes(trailState.trail.roots);
        const active = nodes.find((node) => node.id === activeId);
        const sameSymbol = active ? nodes.filter((node) => node.symbol.name === active.symbol.name
            && node.symbol.relPath === active.symbol.relPath
            && node.symbol.anchorLine === active.symbol.anchorLine) : [];
        const duplicateIndex = sameSymbol.findIndex((node) => node.id === activeId);
        const focusDuplicate = (index: number): void => {
            const node = sameSymbol[(index + sameSymbol.length) % sameSymbol.length];
            if (!node) return;
            commands.setActiveNode(context, node.id);
            recordNavigation({ pane: 'trail', trailId: trailState.trail?.id, nodeId: node.id });
        };
        return (<>
            {sameSymbol.length > 1 ? <div className="doc-bar"><span>{`같은 심볼 ${duplicateIndex + 1}/${sameSymbol.length}`}</span><button type="button" onClick={() => focusDuplicate(duplicateIndex - 1)}>이전</button><button type="button" onClick={() => focusDuplicate(duplicateIndex + 1)}>다음</button></div> : null}
            <TrailView
                trail={trailState.trail}
                busyNodeIds={trailState.busyNodeIds}
                clickTarget={ui?.clickTarget ?? 'allSymbols'}
                maxCodeLines={ui?.maxCodeLines ?? 250}
                fontSize={ui?.fontSize ?? 0}
                fitToWidth={ui?.fitToWidth ?? true}
                minFontSize={ui?.minFontSize ?? 8}
                implementationSupported={implementationSupported}
                choice={trailState.choice}
                onToggle={(node) => commands.toggleNode(context, node.id, !node.collapsed)}
                onToggleAll={toggleAll}
                onRemove={(node) => commands.removeNode(context, node.id)}
                onPromote={(node) => commands.promoteToRoot(context, node.id)}
                onImplementations={(node) => commands.resolveImplementations(context, node.id)}
                onOpenInEditor={(node) => {
                    if (node.symbol.documentId !== null) {
                        commands.openInEditor(
                            context,
                            node.symbol.documentId,
                            node.symbol.anchorLine,
                            node.symbol.anchorChar,
                        );
                    }
                }}
                onIdentifierClick={onIdentifierClick}
                onRangeSelect={(node, range) => {
                    if (node.symbol.documentId) setSelectedRange({
                        documentId: node.symbol.documentId,
                        label: `${node.symbol.displayPath}:${range.start.line + 1}`,
                        range,
                    });
                    setPane('analysis');
                }}
                onFocusNode={(nodeId) => {
                    commands.setActiveNode(context, nodeId);
                    recordNavigation({ pane: 'trail', trailId: trailState.trail?.id, nodeId });
                }}
                onClear={() => commands.clear(context)}
                onExportMarkdown={() => commands.exportMarkdown(context)}
                onChooseCandidate={(choiceId, candidateId) => {
                    commands.chooseCandidate(context, choiceId, candidateId);
                    trailState.dismissChoice();
                }}
                onDismissChoice={trailState.dismissChoice}
                onSetMode={(mode) => commands.setMode(context, mode)}
                onNodeUi={(nodeId, patch) => commands.setNodeUi(context, nodeId, patch)}
            />
        </>
        );
    }

    function renderAnalysisPane(): JSX.Element {
        return (
            <AnalysisPanel
                analyses={analyses}
                analysis={analysis}
                activeTrailId={trailState.activeTrailId}
                activeNodeId={trailState.trail?.activeNodeId ?? null}
                selectedRange={selectedRange}
                author={author}
                persistedRevision={persistedRevision}
                readOnly={bootstrap?.capabilities.readOnlyShare ?? false}
                sharePreview={sharePreview}
                importPreview={importPreview}
                aiCapability={bootstrap?.capabilities.ai ?? { enabled: false, provider: 'ollama', model: '', maxInputBytes: 0 }}
                aiDraft={aiDraft}
                aiBusy={aiBusy}
                comparison={anchorComparison}
                onSelect={(analysisId) => void api.analysis(analysisId).then((value) => {
                    setAnalysis(value); setPersistedRevision(value.revision); setAnchorComparison(null);
                })}
                onCreateAnalysis={(title, purpose) => {
                    if (context) commands.createAnalysis(context, {
                        title, purpose,
                        trailIds: trailState.activeTrailId ? [trailState.activeTrailId] : [],
                        author,
                    });
                }}
                onAuthorName={(displayName) => setAuthor((current) => ({ ...current, displayName }))}
                onCreateAnnotation={(value) => {
                    if (!context || !analysis) return;
                    if ('documentId' in value.target) {
                        pendingAnnotation.current = { body: value.body, kind: value.kind, tags: value.tags };
                        commands.captureAnchor(context, {
                            analysisId: analysis.id,
                            documentId: value.target.documentId,
                            range: value.target.range,
                        });
                    } else {
                        commands.createAnnotation(context, {
                            analysisId: analysis.id, target: value.target as unknown as Record<string, unknown>,
                            body: value.body, kind: value.kind, tags: value.tags, author,
                        });
                    }
                }}
                onUpdateAnnotation={(annotationId, baseVersion, patch) => {
                    if (context && analysis) commands.updateAnnotation(context, {
                        analysisId: analysis.id, annotationId, baseVersion, actorId: author.id, patch,
                    });
                }}
                onDeleteAnnotation={(annotationId, baseVersion) => {
                    if (context && analysis) commands.deleteAnnotation(context, {
                        analysisId: analysis.id, annotationId, baseVersion, actorId: author.id,
                    });
                }}
                onRestoreAnnotation={(annotationId, baseVersion) => {
                    if (context && analysis) commands.restoreAnnotation(context, {
                        analysisId: analysis.id, annotationId, baseVersion, actorId: author.id,
                    });
                }}
                onReply={(annotationId, body) => {
                    if (context && analysis) commands.replyAnnotation(context, { analysisId: analysis.id, annotationId, body, author });
                }}
                onReview={(target, state, evidenceIds) => {
                    if (!context || !analysis || target.kind !== 'range') return;
                    const anchor = (analysis.anchors as Array<{ id: string; baselineId: string }>).find((item) => item.id === target.anchorId);
                    if (anchor) commands.setReview(context, {
                        analysisId: analysis.id, target: target as unknown as Record<string, unknown>, baselineId: anchor.baselineId,
                        state, authorId: author.id, evidenceIds,
                    });
                }}
                onRecheck={() => {
                    if (context && analysis) commands.recheckAnchors(context, {
                        analysisId: analysis.id,
                        anchorIds: (analysis.anchors as Array<{ id: string }>).map((item) => item.id),
                        actorId: author.id,
                    });
                }}
                onCreateWalkthrough={() => {
                    if (!context || !analysis) return;
                    commands.updateWalkthrough(context, {
                        analysisId: analysis.id, title: '안내 순서', actorId: author.id,
                        steps: analysis.annotations.filter((item) => item.deletedAt === null).map((item) => ({
                            id: crypto.randomUUID(), title: item.body.split(/\r?\n/)[0]?.slice(0, 80) || '기록',
                            body: item.body, annotationId: item.id, target: item.target, baselineId: null,
                        })),
                    });
                }}
                onUpdateWalkthrough={(walkthrough) => {
                    if (!context || !analysis) return;
                    commands.updateWalkthrough(context, {
                        analysisId: analysis.id, walkthroughId: walkthrough.id,
                        baseVersion: walkthrough.version, title: walkthrough.title,
                        steps: walkthrough.steps, actorId: author.id,
                    });
                }}
                onPrepareShare={(includeCode) => {
                    if (context && analysis) commands.prepareShare(context, analysis.id, {
                        includeCode, includeAuthors: true, includeReplies: true, includeBoardLayout: false,
                    });
                }}
                onExport={(planId, format) => { if (context) commands.exportShare(context, planId, format); }}
                onChooseImport={(file) => {
                    if (!context || file.size > 32 * 1024 * 1024) { setError('공유 파일이 너무 크다.'); return; }
                    void file.arrayBuffer().then(async (buffer) => {
                        const bytes = new Uint8Array(buffer);
                        const digest = await crypto.subtle.digest('SHA-256', bytes);
                        pendingUpload.current = bytes;
                        commands.uploadStart(context, bytes.length, [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''));
                    });
                }}
                onCommitImport={(uploadId) => { if (context) commands.importCommit(context, uploadId); }}
                onCommitMerge={(planId) => { if (context) commands.mergeCommit(context, planId, author.id); }}
                onGenerateAi={(purpose) => {
                    if (!context || !analysis || !selectedRange || aiBusy) return;
                    const requestId = crypto.randomUUID();
                    pendingAiRequest.current = requestId;
                    setAiDraft(null);
                    setAiBusy(true);
                    setError(null);
                    commands.generateAiDraft(context, {
                        requestId,
                        analysisId: analysis.id,
                        documentId: selectedRange.documentId,
                        range: selectedRange.range,
                        purpose,
                    });
                }}
                onCancelAi={() => {
                    if (context && pendingAiRequest.current) commands.cancelAiDraft(context, pendingAiRequest.current);
                }}
                onAcceptAi={(draftId) => {
                    if (context && analysis) commands.acceptAiDraft(context, { analysisId: analysis.id, draftId, author });
                }}
                onSaveDraft={(draftId, target, body) => {
                    if (context && analysis) commands.saveDraft(context, {
                        analysisId: analysis.id, draftId, target, body,
                    });
                }}
                onUpdatePlan={(purpose, goals, importantLocations) => {
                    if (context && analysis) commands.updateAnalysisPlan(context, {
                        analysisId: analysis.id, baseRevision: analysis.revision, purpose,
                        goals, importantLocations, actorId: author.id,
                    });
                }}
                onNavigateTarget={navigateAnalysisTarget}
                onCompareAnchor={(anchorId) => {
                    if (!analysis) return;
                    setError(null);
                    void api.anchorComparison(analysis.id, anchorId)
                        .then(setAnchorComparison)
                        .catch((cause: unknown) => setError(cause instanceof ApiError ? cause.message : '코드를 비교하지 못했다.'));
                }}
                onCloseComparison={() => setAnchorComparison(null)}
            />
        );
    }
}

function flattenTrailNodes(roots: TrailNodeView[]): TrailNodeView[] {
    const result: TrailNodeView[] = [];
    const stack = [...roots].reverse();
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) break;
        result.push(node);
        stack.push(...node.children.slice().reverse());
    }
    return result;
}

async function downloadProtected(url: string, fileName: string): Promise<void> {
    const token = currentToken();
    if (!token) throw new Error('세션 토큰이 없다.');
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('다운로드 실패');
    const href = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = href; link.download = fileName; link.click();
    URL.revokeObjectURL(href);
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
}
