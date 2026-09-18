import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import {
    api,
    ApiError,
    type Bootstrap,
    type DocumentContent,
    type GitHunkView,
    type LanguageDiagnostics,
    type ProjectSettingsView,
    type AnalysisDocumentView,
    type AnalysisSummaryView,
    type AnchorComparisonView,
} from '../api/http.js';
import { commands, type CommandContext } from '../api/commands.js';
import { TrailSocket, type ConnectionState, type ServerEventMessage } from '../api/socket.js';
import { DiagnosticsView } from '../features/diagnostics/DiagnosticsView.js';
import { LspStatus } from '../features/diagnostics/LspStatus.js';
import { CodeView, type CodeViewHandle } from '../features/source/CodeView.js';
import { SettingsView } from '../features/settings/SettingsView.js';
import { StartCard } from '../features/start/StartCard.js';
import { ShortcutsHelp } from '../features/help/ShortcutsHelp.js';
import { Notices } from '../features/notices/Notices.js';
import { useNotices, type NoticeAction } from '../features/notices/useNotices.js';
import { SelectionChip } from '../features/selection/SelectionChip.js';
import { TrailBar } from '../features/trail/TrailBar.js';
import { TrailView } from '../features/trail/TrailView.js';
import { useTrail } from '../features/trail/useTrail.js';
import { buildAnnotationIndex } from '../features/trail/annotationIndex.js';
import { findNode, splitName, type TrailNodeView } from '../features/trail/types.js';
import { FileSearch } from '../features/workspace/FileSearch.js';
import { FileTree } from '../features/workspace/FileTree.js';
import {
    AnalysisPanel,
    internalReference,
    targetLinks,
    type AiDraftView,
    type AnalysisTarget,
    type ImportPreviewView,
    type SelectedCodeRange,
    type SharePreviewView,
} from '../features/annotations/AnalysisPanel.js';
import { AnnotationColumn, ANNOTATION_COLUMN_DEFAULT } from '../features/annotations/AnnotationColumn.js';
import { AnnotationComposer, type ComposerTargetKind } from '../features/annotations/AnnotationComposer.js';
import { AnnotationItem, type AnnotationKind } from '../features/annotations/AnnotationItem.js';
import { ReadingStarts, type ChangeEntry, type DocumentSymbolEntry } from '../features/changes/ReadingStarts.js';
import { currentToken } from '../api/session.js';

/**
 * 화면 뼈대 (구현서 16.1).
 *
 * ```text
 * ┌──────────────────────────────────────────────────────┐
 * │ 앱 바: 프로젝트 · 트레일 고르기 · 서버 상태 · 연결   │
 * ├───────────────┬──────────────────────────────────────┤
 * │ 파일 탐색기   │ [코드] [트레일] [분석 기록] … 탭     │
 * │ 검색          │ 코드 화면 또는 트레일 화면           │
 * └───────────────┴──────────────────────────────────────┘
 * ```
 *
 * 코드 화면과 트레일 화면을 탭으로 바꾼다. 작은 화면에서 둘을 나란히 놓으면
 * 코드도 트리도 못 읽는다.
 *
 * **사람에게 보여줄 말은 여기서 정한다.** 서버 이벤트를 상태로 옮기는 것은
 * `useTrail` 이고, 그 상태를 알림·버튼으로 바꾸는 것이 `App` 이다(U02).
 */

const STATE_LABEL: Record<ConnectionState, string> = {
    connecting: '연결 중',
    open: '연결됨',
    closed: '끊김',
};

type Pane = 'code' | 'trail' | 'analysis' | 'settings' | 'diagnostics';
type NavigationPoint = {
    pane: 'code' | 'trail'; relPath?: string; line?: number; char?: number;
    trailId?: string; nodeId?: string;
};

/** 되돌리기 버튼을 띄워 두는 시간. 서버 버퍼(60초)보다 짧게 잡는다. */
const UNDO_NOTICE_MS = 8_000;

export function App(): JSX.Element {
    const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
    const [settings, setSettings] = useState<ProjectSettingsView | null>(null);
    const [connection, setConnection] = useState<ConnectionState>('connecting');
    const [document, setDocument] = useState<DocumentContent | null>(null);
    const [staleDocument, setStaleDocument] = useState(false);
    const [fatal, setFatal] = useState<string | null>(null);
    const [pane, setPane] = useState<Pane>('code');
    const [diagnostics, setDiagnostics] = useState<LanguageDiagnostics[]>([]);
    const [recoveryCandidates, setRecoveryCandidates] = useState<Array<{ trailId?: string; analysisId?: string; kind?: 'temporary' | 'backup'; savedAt: string }>>([]);
    const [analyses, setAnalyses] = useState<AnalysisSummaryView[]>([]);
    const [analysis, setAnalysis] = useState<AnalysisDocumentView | null>(null);
    const [persistedRevision, setPersistedRevision] = useState<number | null>(null);
    const [selectedRange, setSelectedRange] = useState<SelectedCodeRange | null>(null);
    const [chipAnchor, setChipAnchor] = useState<{ x: number; y: number } | null>(null);
    const [sharePreview, setSharePreview] = useState<SharePreviewView | null>(null);
    const [importPreview, setImportPreview] = useState<ImportPreviewView | null>(null);
    const [aiDraft, setAiDraft] = useState<AiDraftView | null>(null);
    const [aiBusy, setAiBusy] = useState(false);
    const [anchorComparison, setAnchorComparison] = useState<AnchorComparisonView | null>(null);
    const [, setNavigationVersion] = useState(0);
    const [symbols, setSymbols] = useState<DocumentSymbolEntry[]>([]);
    const [changes, setChanges] = useState<ChangeEntry[]>([]);
    const [hunks, setHunks] = useState<GitHunkView[]>([]);
    const [originalText, setOriginalText] = useState<string | null>(null);
    const [diffMode, setDiffMode] = useState(false);
    const [showShortcuts, setShowShortcuts] = useState(false);
    const [composerTarget, setComposerTarget] = useState<ComposerTargetKind>('trail');
    const [composerBody, setComposerBody] = useState('');
    const [systemDark, setSystemDark] = useState(
        () => !window.matchMedia('(prefers-color-scheme: light)').matches,
    );

    // 화면 배치는 브라우저에 남긴다. 트레일과 함께 저장하지 않는다.
    const [sidebarWidth, setSidebarWidth] = useState(
        () => Number(window.localStorage.getItem('code-trail.sidebarWidth')) || 280,
    );
    const [sidebarCollapsed, setSidebarCollapsed] = useState(
        () => window.localStorage.getItem('code-trail.sidebarCollapsed') === '1',
    );
    const [columnOpen, setColumnOpen] = useState(
        () => window.localStorage.getItem('code-trail.annotationColumn') === '1',
    );
    const [columnWidth, setColumnWidth] = useState(
        () => Number(window.localStorage.getItem('code-trail.annotationColumnWidth'))
            || ANNOTATION_COLUMN_DEFAULT,
    );

    const navigation = useRef<{ points: NavigationPoint[]; index: number }>({ points: [], index: -1 });
    const restoringNavigation = useRef(false);
    const [author, setAuthor] = useState(() => {
        const saved = window.localStorage.getItem('code-trail.author');
        if (saved) {
            try { return JSON.parse(saved) as { id: string; displayName: string }; } catch { /* 새로 만든다. */ }
        }
        return { id: crypto.randomUUID(), displayName: '로컬 작성자' };
    });

    const notices = useNotices();
    const noticesRef = useRef(notices);
    noticesRef.current = notices;

    const [socket, setSocket] = useState<TrailSocket | null>(null);
    const documentRef = useRef<DocumentContent | null>(null);
    documentRef.current = document;
    const authorRef = useRef(author);
    authorRef.current = author;
    const codeViewRef = useRef<CodeViewHandle | null>(null);
    /** 사이드바 손잡이를 끄는 중. */
    const sidebarDrag = useRef<{ startX: number; startWidth: number } | null>(null);

    const trailState = useTrail(socket);
    const trailRef = useRef(trailState);
    trailRef.current = trailState;
    // 이벤트 처리기가 항상 최신이어야 한다. 의존성에 넣으면 소켓이 다시 붙는다.
    const handleEventRef = useRef(trailState.handleEvent);
    handleEventRef.current = trailState.handleEvent;
    const refreshDiagnosticsRef = useRef<() => void>(() => undefined);
    const contextRef = useRef<CommandContext | null>(null);
    const pendingAnnotation = useRef<{
        body: string; kind: AnnotationKind; tags: string[];
    } | null>(null);
    /** 분석이 없어 먼저 만들고 있는 중. 만들어지면 이 기록을 저장한다(U11). */
    const pendingForNewAnalysis = useRef<{
        body: string; kind: AnnotationKind; tags: string[];
        target: AnalysisTarget | SelectedCodeRange;
    } | null>(null);
    const pendingUpload = useRef<Uint8Array<ArrayBuffer> | null>(null);
    const pendingAiRequest = useRef<string | null>(null);
    const handledReference = useRef<string | null>(null);
    /** 트레일이 없을 때 누른 `Ctrl+Alt+T`. 트레일이 생기면 바로 이어 붙인다(U05). */
    const pendingRoot = useRef<{ documentId: string; line: number; char: number; at: number } | null>(null);
    /** 마지막 해석 명령. 알림의 `다시 시도` 가 이것을 다시 보낸다(U01). */
    const lastResolve = useRef<(() => void) | null>(null);
    /** 사용자가 분석 선택 상자에서 직접 고른 것. 트레일을 바꿔도 유지한다. */
    const manualAnalysis = useRef<string | null>(null);

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
                setFatal(
                    cause instanceof ApiError
                        ? cause.message
                        : '서버에 연결하지 못했다. 터미널에서 code-trail 을 다시 실행한다.',
                );
            });
        void api.changes().then((value) => setChanges(value.changes)).catch(() => setChanges([]));
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

    /** 진단 화면의 그 언어 카드로 데려간다. */
    const openDiagnostics = useCallback((language: string | null): void => {
        refreshDiagnosticsRef.current();
        setPane('diagnostics');
        if (language === null) return;
        window.setTimeout(() => {
            window.document
                .querySelector(`[data-language="${language}"]`)
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }, 50);
    }, []);

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
                    handleCommandError(event.payload as {
                        error: {
                            code: string; message: string; retryable: boolean;
                            context?: {
                                language?: string;
                                action?: 'openDiagnostics' | 'retry' | 'chooseSolution' | 'verify';
                            };
                        };
                    });
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
                    void api.changes().then((value) => setChanges(value.changes)).catch(() => undefined);
                    return;
                }
                if (event.type === 'settings.changed') {
                    setSettings((event.payload as { settings: ProjectSettingsView }).settings);
                }
                if (event.type === 'lsp.stateChanged') {
                    refreshDiagnosticsRef.current();
                }
                if (event.type === 'trail.rootAdded') {
                    renameNewTrail(event.payload as { node: TrailNodeView }, event.revision);
                }
                if (event.type === 'trail.nodeRemoved') {
                    offerUndo(event.payload as {
                        nodeId: string; name?: string; count?: number; undoable?: boolean;
                    });
                }
                if (event.type === 'trail.implementationChoice') {
                    const payload = event.payload as { truncated: boolean; choiceId: string | null };
                    if (payload.truncated && payload.choiceId === null) {
                        noticesRef.current.push({ level: 'warn', message: '구현이 많아 일부만 붙였다.' });
                    }
                }
                if (event.type === 'trail.exportReady') {
                    const payload = event.payload as { url: string; fileName: string };
                    void downloadProtected(payload.url, payload.fileName).catch(() =>
                        noticesRef.current.push({ level: 'error', message: 'Markdown 을 내려받지 못했다.' }));
                }
                if (event.type === 'editor.opened') {
                    const opened = event.payload as {
                        displayPath: string;
                        line: number;
                        column: number;
                        launched: boolean;
                        reason: string | null;
                    };
                    if (!opened.launched) {
                        // 에디터를 못 띄웠다고 막다른 길이 되면 안 된다.
                        // 경로와 줄을 복사해 주면 손으로 찾아갈 수 있다(구현서 17.2 6단계).
                        const where = `${opened.displayPath}:${opened.line}:${opened.column}`;
                        noticesRef.current.push({
                            level: 'error',
                            message: `${opened.reason ?? '에디터를 띄우지 못했다.'} — ${where}`,
                            actions: [
                                { label: '경로·줄 복사', run: () => { void navigator.clipboard?.writeText(where); } },
                                { label: '에디터 정하기', run: () => setPane('diagnostics') },
                            ],
                        });
                    }
                    return;
                }
                if (event.type === 'analysis.listChanged') {
                    const payload = event.payload as { analyses: AnalysisSummaryView[] };
                    setAnalyses(payload.analyses);
                    return;
                }
                if (event.type === 'analysis.snapshot') {
                    const payload = event.payload as { analysis: AnalysisDocumentView };
                    setAnalysis((current) => {
                        if (current !== null && current.id !== payload.analysis.id) return current;
                        return payload.analysis;
                    });
                    flushPendingAnnotation(payload.analysis);
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
                    void downloadProtected(payload.url, payload.fileName).catch(() =>
                        noticesRef.current.push({ level: 'error', message: '공유 파일을 내려받지 못했다.' }));
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
                if (event.type === 'share.imported' || event.type === 'share.merged') {
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

    /**
     * 서버가 거절한 명령을 알림 하나로 바꾼다 (U01, U02).
     *
     * `context.action` 이 다음에 누를 버튼을 정한다. 무엇이 잘못됐는지만 알려주고
     * 어디로 가야 할지 안 알려주면 사용자는 진단 화면을 스스로 찾아야 한다.
     */
    function handleCommandError(payload: {
        error: {
            code: string; message: string; retryable: boolean;
            context?: {
                language?: string;
                action?: 'openDiagnostics' | 'retry' | 'chooseSolution' | 'verify';
            };
        };
    }): void {
        const { error } = payload;
        const actions: NoticeAction[] = [];
        const language = error.context?.language ?? null;
        switch (error.context?.action) {
            case 'openDiagnostics':
                actions.push({ label: '진단 화면', run: () => openDiagnostics(language) });
                break;
            case 'chooseSolution':
                actions.push({ label: '솔루션 고르기', run: () => openDiagnostics('csharp') });
                break;
            case 'verify':
                actions.push({
                    label: '언어 서버 확인',
                    run: () => {
                        const commandContext = contextRef.current;
                        if (commandContext && language) commands.verifyLsp(commandContext, language);
                        openDiagnostics(language);
                    },
                });
                break;
            case 'retry':
                if (lastResolve.current) {
                    actions.push({ label: '다시 시도', run: () => lastResolve.current?.() });
                }
                break;
            default:
        }
        noticesRef.current.push({
            level: error.retryable ? 'warn' : 'error',
            message: error.message,
            actions,
        });
    }

    /**
     * 첫 루트가 붙으면 트레일 이름을 그 함수 이름으로 (U05).
     *
     * 사용자가 이미 이름을 바꿨으면 손대지 않는다. 트레일 목록의
     * `새 트레일 (3)` 이 `HandlePacket (3)` 이 된다.
     */
    function renameNewTrail(payload: { node: TrailNodeView }, revision?: number): void {
        const current = trailRef.current.trail;
        const commandContext = contextRef.current;
        if (!current || !commandContext) return;
        if (current.title !== '새 트레일' || current.roots.length !== 0) return;
        // 이벤트가 실어 온 revision 을 쓴다. 화면 상태는 아직 이 루트를 모르고,
        // 그 낡은 값으로 보내면 서버가 `STALE_REVISION` 으로 거절한다.
        commands.renameTrail(
            { ...commandContext, revision: revision ?? commandContext.revision },
            splitName(payload.node.symbol).name,
        );
    }

    /** 노드를 지웠다. 8초 안에 되돌릴 수 있다고 알린다 (U03). */
    function offerUndo(payload: {
        nodeId: string; name?: string; count?: number; undoable?: boolean;
    }): void {
        const rest = (payload.count ?? 1) - 1;
        const what = payload.name === undefined
            ? '노드를 지웠다.'
            : rest > 0
                ? `『${payload.name}』와 하위 ${rest}개를 지웠다.`
                : `『${payload.name}』를 지웠다.`;
        const id = noticesRef.current.push({
            level: 'info',
            message: what,
            actions: payload.undoable === false ? [] : [{
                label: '되돌리기',
                run: () => {
                    const commandContext = contextRef.current;
                    if (commandContext) commands.undoRemove(commandContext, payload.nodeId);
                },
            }],
        });
        window.setTimeout(() => noticesRef.current.dismiss(id), UNDO_NOTICE_MS);
    }

    /** 분석이 막 생겼다. 그 전에 쓴 기록을 이제 저장한다 (U11). */
    function flushPendingAnnotation(created: AnalysisDocumentView): void {
        const pending = pendingForNewAnalysis.current;
        const commandContext = contextRef.current;
        if (!pending || !commandContext) return;
        pendingForNewAnalysis.current = null;
        if ('documentId' in pending.target) {
            pendingAnnotation.current = {
                body: pending.body, kind: pending.kind, tags: pending.tags,
            };
            commands.captureAnchor(commandContext, {
                analysisId: created.id,
                documentId: pending.target.documentId,
                range: pending.target.range,
            });
            return;
        }
        commands.createAnnotation(commandContext, {
            analysisId: created.id,
            target: pending.target as unknown as Record<string, unknown>,
            body: pending.body,
            kind: pending.kind,
            tags: pending.tags,
            author: authorRef.current,
        });
    }

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

    // 연결이 끊기면 계속 남는 알림 하나. 다시 붙으면 지운다.
    useEffect(() => {
        if (connection === 'closed') {
            notices.push({
                level: 'error',
                message: '서버와 연결이 끊겼다. 터미널의 code-trail 이 살아 있는지 본다.',
                key: 'connection',
                sticky: true,
            });
        } else if (connection === 'open') {
            notices.dismissKey('connection');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [connection]);

    useEffect(() => {
        window.localStorage.setItem('code-trail.author', JSON.stringify(author));
        if (bootstrap === null) return;
        const timer = window.setTimeout(() => {
            const commandContext = contextRef.current;
            if (commandContext) commands.updateLocalAuthor(commandContext, author);
        }, 400);
        return () => window.clearTimeout(timer);
    }, [author, bootstrap]);

    useEffect(() => {
        window.localStorage.setItem('code-trail.sidebarWidth', String(Math.round(sidebarWidth)));
        window.localStorage.setItem('code-trail.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
        window.localStorage.setItem('code-trail.annotationColumn', columnOpen ? '1' : '0');
        window.localStorage.setItem('code-trail.annotationColumnWidth', String(Math.round(columnWidth)));
    }, [sidebarWidth, sidebarCollapsed, columnOpen, columnWidth]);

    const openFile = useCallback((relPath: string, line?: number, char?: number) => {
        void api
            .open(relPath)
            .then((content) => {
                setDocument(content);
                setStaleDocument(false);
                setDiffMode(false);
                setPane('code');
                cursorRef.current = { line: line ?? 0, char: char ?? 0 };
                if (line !== undefined) {
                    window.setTimeout(() => codeViewRef.current?.revealLine(line, char ?? 0), 40);
                }
                recordNavigation({ pane: 'code', relPath, line: line ?? 0, char: char ?? 0 });
            })
            .catch((cause: unknown) => {
                noticesRef.current.push({
                    level: 'error',
                    message: cause instanceof ApiError ? cause.message : '파일을 열지 못했다.',
                });
            });
    }, [recordNavigation]);

    // 열어둔 문서의 문서 심볼. `App` 이 들고 사이드바와 문서 줄이 나눠 쓴다(U07).
    useEffect(() => {
        if (!document) { setSymbols([]); return undefined; }
        let cancelled = false;
        const controller = new AbortController();
        void api.documentSymbols(document.documentId, controller.signal)
            .then((value) => { if (!cancelled) setSymbols(value.symbols); })
            .catch(() => { if (!cancelled) setSymbols([]); });
        return () => { cancelled = true; controller.abort(); };
    }, [document]);

    // 열어둔 문서가 변경 목록에 있으면 바뀐 줄을 받아 온다(U14).
    useEffect(() => {
        setHunks([]);
        setOriginalText(null);
        if (!document || !changes.some((change) => change.relPath === document.relPath)) {
            return;
        }
        let cancelled = false;
        void api.hunks(document.relPath)
            .then((value) => { if (!cancelled) setHunks(value.hunks); })
            .catch(() => undefined);
        void api.originalText(document.relPath)
            .then((value) => { if (!cancelled) setOriginalText(value.text); })
            .catch(() => undefined);
        return () => { cancelled = true; };
    }, [document, changes]);

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
                window.setTimeout(() => codeViewRef.current?.revealLine(point.line ?? 0, point.char ?? 0), 40);
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

    /** 활성 분석의 기록 색인. 헤더 배지·줄 표시·변경 목록이 함께 쓴다(U10). */
    const annotationIndex = useMemo(() => buildAnnotationIndex(analysis), [analysis]);

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

    /** 코드 화면에서 루트를 만든다. 트레일이 없으면 먼저 하나 만든다 (U05). */
    const addRootHere = useCallback((line: number, char: number) => {
        const open = documentRef.current;
        if (context === null || open === null) {
            return;
        }
        // 지원하지 않는 파일에서는 서버에 보내지 않는다(U01).
        if (open.supportedLanguage === null) {
            const extension = open.relPath.slice(open.relPath.lastIndexOf('.'));
            noticesRef.current.push({
                level: 'warn',
                message: `이 파일 형식(${extension})은 심볼 해석을 지원하지 않는다. `
                    + '지원 언어: C/C++·C#·Go·Rust·TypeScript.',
            });
            return;
        }
        if (context.trailId === null) {
            // 트레일이 없으면 먼저 만든다. 사용자에게 "한 번 더 누르라" 고 하지 않는다.
            pendingRoot.current = {
                documentId: open.documentId, line, char, at: Date.now(),
            };
            commands.createTrail(context);
            setPane('trail');
            return;
        }
        lastResolve.current = () => {
            const again = contextRef.current;
            const current = documentRef.current;
            if (again && current) commands.addRootAt(again, current.documentId, line, char);
        };
        commands.addRootAt(context, open.documentId, line, char);
        setPane('trail');
    }, [context]);

    // 트레일이 생기면 기다리던 루트를 이어 붙인다(U05).
    useEffect(() => {
        const pending = pendingRoot.current;
        if (pending === null || context === null || context.trailId === null) {
            return undefined;
        }
        pendingRoot.current = null;
        commands.addRootAt(context, pending.documentId, pending.line, pending.char);
        return undefined;
    }, [context]);

    // 트레일이 5초 안에 안 생기면 알린다. 조용히 아무 일도 안 일어나면 안 된다.
    useEffect(() => {
        const timer = window.setInterval(() => {
            const pending = pendingRoot.current;
            if (pending !== null && Date.now() - pending.at > 5_000) {
                pendingRoot.current = null;
                noticesRef.current.push({ level: 'error', message: '트레일을 만들지 못했다.' });
            }
        }, 1_000);
        return () => window.clearInterval(timer);
    }, []);

    /**
     * 트레일을 고르면 그 트레일의 분석이 따라온다 (U11).
     *
     * 사용자가 선택 상자에서 직접 고른 것은 그 세션 동안 유지한다 — 일부러
     * 고른 것을 트레일 전환이 덮으면 안 된다.
     */
    useEffect(() => {
        const trailId = trailState.activeTrailId;
        if (trailId === null || manualAnalysis.current !== null) return;
        const paired = analyses.find((item) => (item.trailIds ?? []).includes(trailId));
        if (paired === undefined) {
            setAnalysis((current) => (current === null ? current : null));
            return;
        }
        setAnalysis((current) => {
            if (current?.id === paired.id) return current;
            void api.analysis(paired.id).then((value) => {
                setAnalysis(value);
                setPersistedRevision(value.revision);
            }).catch(() => undefined);
            return current;
        });
    }, [trailState.activeTrailId, analyses]);

    // `Ctrl+Alt+T` — 확장과 같은 키다. 코드 화면 밖(파일 탐색기 등)을 위해 남긴다.
    const cursorRef = useRef<{ line: number; char: number }>({ line: 0, char: 0 });
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            const typing = target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

            if ((event.ctrlKey || event.metaKey) && event.altKey && event.key.toLowerCase() === 't') {
                event.preventDefault();
                addRootHere(cursorRef.current.line, cursorRef.current.char);
                return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
                event.preventDefault();
                setSidebarCollapsed(false);
                window.setTimeout(() => {
                    window.document.querySelector<HTMLInputElement>('.file-search input')?.focus();
                }, 0);
                return;
            }
            if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                event.preventDefault();
                moveNavigation(event.key === 'ArrowLeft' ? -1 : 1);
                return;
            }
            if (!typing && event.key === '?') {
                event.preventDefault();
                setShowShortcuts((open) => !open);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [addRootHere, moveNavigation]);

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
        // 옛 좌표로 언어 서버에 물으면 엉뚱한 곳으로 간다(U08).
        if (trailState.staleNodeIds.has(node.id)) {
            noticesRef.current.push({
                level: 'warn',
                message: '옛 코드의 좌표다. 먼저 ↻ 로 다시 읽는다.',
                actions: [{
                    label: '다시 읽기',
                    run: () => {
                        const again = contextRef.current;
                        if (again) commands.refreshNode(again, node.id);
                    },
                }],
            });
            return;
        }
        commands.setActiveNode(context, node.id);
        lastResolve.current = () => {
            const again = contextRef.current;
            if (again) commands.resolve(again, node.id, line, char, text);
        };
        // Alt+클릭도 같은 명령으로 간다. 서버가 implementation 을 먼저 묻고
        // 없으면 정의로 되돌아간다 — 어느 쪽이든 사용자는 갈 곳을 얻는다.
        commands.resolve(context, node.id, line, char, text);
    }, [context, trailState.staleNodeIds]);

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

    // 테마. `system` 이면 브라우저 설정을 따르고, Monaco 도 같은 값을 쓴다(U15).
    useEffect(() => {
        const theme = settings?.ui.theme ?? 'system';
        const root = window.document.documentElement;
        if (theme === 'system') {
            root.removeAttribute('data-theme');
        } else {
            root.setAttribute('data-theme', theme);
        }
    }, [settings?.ui.theme]);

    useEffect(() => {
        const query = window.matchMedia('(prefers-color-scheme: light)');
        const onChange = (): void => setSystemDark(!query.matches);
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    const resolvedTheme = settings?.ui.theme === 'light'
        ? 'light'
        : settings?.ui.theme === 'dark'
            ? 'dark'
            : systemDark ? 'dark' : 'light';

    if (fatal !== null && bootstrap === null) {
        return (
            <div className="fatal">
                <h1>Code Trail</h1>
                <p>{fatal}</p>
            </div>
        );
    }

    const ui = settings?.ui;
    const readOnly = bootstrap?.capabilities.readOnlyShare ?? false;

    /**
     * 지금 열어둔 트레일에서 구현 찾기를 쓸 수 있는지.
     *
     * 언어 서버가 준비되지 않았으면 판단할 근거가 없으므로 켜 둔다 — 눌러보면
     * 서버가 이유를 알려준다. 준비된 뒤에 `implementation` 이 빠져 있다면 그때 끈다.
     */
    const implementationSupported = diagnostics
        .filter((info) => info.state === 'ready')
        .every((info) => !info.missingCapabilities.includes('implementation'));

    const activeNode = trailState.trail?.activeNodeId
        ? findNode(trailState.trail.roots, trailState.trail.activeNodeId) ?? null
        : null;
    const activeNodeLabel = activeNode
        ? `『${splitName(activeNode.symbol).name}』 · ${activeNode.symbol.displayPath}:${activeNode.symbol.anchorLine + 1}`
        : null;

    const saveState: 'saved' | 'saving' | 'none' = trailState.trail === null
        ? 'none'
        : trailState.persistedRevision === trailState.trail.revision ? 'saved' : 'saving';

    /** 커서를 감싸는 문서 심볼 이름. 문서 줄의 시작 버튼 옆에 적는다(U07). */
    const enclosingSymbol = symbols
        .filter((symbol) => symbol.selectionRange.start.line <= cursorRef.current.line)
        .slice(-1)[0]?.name ?? null;

    return (
        <div className="app">
            <header className="app-bar">
                <button
                    type="button"
                    className="sidebar-toggle"
                    aria-label={sidebarCollapsed ? '파일 탐색기 펴기' : '파일 탐색기 접기'}
                    aria-expanded={!sidebarCollapsed}
                    onClick={() => setSidebarCollapsed((value) => !value)}
                >
                    ☰
                </button>
                <span className="app-name">Code Trail</span>
                <span className="project">{bootstrap?.project.name ?? '…'}</span>
                {context === null ? null : (
                    <TrailBar
                        trails={trailState.trails}
                        activeTrailId={trailState.activeTrailId}
                        saveState={saveState}
                        annotationCount={annotationIndex.trailTotal}
                        onSelect={(trailId) => commands.selectTrail(context, trailId)}
                        onCreate={() => commands.createTrail(context)}
                        onRename={(title) => commands.renameTrail(context, title)}
                        onDelete={() => commands.deleteTrail(context)}
                    />
                )}
                <span className="spacer" />
                {document === null ? null : (
                    <LspStatus
                        language={document.supportedLanguage ?? null}
                        diagnostics={diagnostics}
                        onOpen={openDiagnostics}
                    />
                )}
                <span className={`conn conn-${connection}`}>{STATE_LABEL[connection]}</span>
            </header>

            <div className="app-body">
                {sidebarCollapsed ? null : (
                    <aside className="sidebar" style={{ width: `${Math.round(sidebarWidth)}px` }}>
                        <FileSearch onOpenFile={openFile} />
                        <FileTree onOpenFile={openFile} activePath={document?.relPath ?? null} />
                        <ReadingStarts
                            document={document}
                            changes={changes}
                            symbols={symbols}
                            openedPaths={openedPaths()}
                            noteCounts={noteCounts()}
                            onOpenFile={openFile}
                            onAddRoot={addRootHere}
                        />
                    </aside>
                )}
                {sidebarCollapsed ? null : (
                    <div
                        className="sidebar-handle"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="파일 탐색기 폭"
                        tabIndex={0}
                        onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture(event.pointerId);
                            sidebarDrag.current = { startX: event.clientX, startWidth: sidebarWidth };
                        }}
                        onPointerMove={(event) => {
                            const drag = sidebarDrag.current;
                            if (drag === null) return;
                            setSidebarWidth(Math.max(
                                180,
                                Math.min(drag.startWidth + (event.clientX - drag.startX), window.innerWidth * 0.5),
                            ));
                        }}
                        onPointerUp={(event) => {
                            sidebarDrag.current = null;
                            try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 이미 놓였다. */ }
                        }}
                        onDoubleClick={() => setSidebarWidth(280)}
                        onKeyDown={(event) => {
                            if (event.key === 'ArrowLeft') {
                                event.preventDefault();
                                setSidebarWidth((value) => Math.max(180, value - 16));
                            } else if (event.key === 'ArrowRight') {
                                event.preventDefault();
                                setSidebarWidth((value) => Math.min(window.innerWidth * 0.5, value + 16));
                            }
                        }}
                    />
                )}

                <main className="main">
                    <div className="pane-tabs">
                        <button type="button" className="tab nav" aria-label="이전 읽던 위치" disabled={navigation.current.index <= 0} onClick={() => moveNavigation(-1)}>←</button>
                        <button type="button" className="tab nav" aria-label="다음 읽던 위치" disabled={navigation.current.index >= navigation.current.points.length - 1} onClick={() => moveNavigation(1)}>→</button>
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
                            className={pane === 'analysis' ? 'tab active' : 'tab'}
                            onClick={() => setPane('analysis')}
                        >
                            {`분석 기록${analysis ? ` (${analysis.annotations.filter((item) => item.deletedAt === null).length})` : ''}`}
                        </button>
                        <button
                            type="button"
                            className={pane === 'settings' ? 'tab active' : 'tab'}
                            onClick={() => setPane('settings')}
                        >
                            설정
                        </button>
                        <button
                            type="button"
                            className={pane === 'diagnostics' ? 'tab active' : 'tab'}
                            onClick={() => openDiagnostics(null)}
                        >
                            진단
                        </button>
                        <span className="spacer" />
                        <button
                            type="button"
                            className="tab"
                            title="단축키 (?)"
                            onClick={() => setShowShortcuts(true)}
                        >
                            ?
                        </button>
                    </div>

                    {pane === 'code'
                        ? renderCodePane()
                        : pane === 'trail'
                            ? renderTrailPane()
                            : pane === 'analysis'
                                ? renderAnalysisPane()
                                : pane === 'settings'
                                    ? renderSettingsPane()
                                    : renderDiagnosticsPane()}
                </main>
            </div>

            {chipAnchor === null || selectedRange === null ? null : (
                <SelectionChip
                    anchor={chipAnchor}
                    aiEnabled={bootstrap?.capabilities.ai.enabled ?? false}
                    onNote={() => {
                        setComposerTarget('range');
                        if (columnOpen && pane === 'trail') return;
                        setPane('analysis');
                    }}
                    onAiDraft={() => generateAi()}
                    onCopy={() => {
                        const text = window.getSelection()?.toString() ?? '';
                        if (text !== '') void navigator.clipboard?.writeText(text);
                        setChipAnchor(null);
                    }}
                    onDismiss={() => setChipAnchor(null)}
                />
            )}

            {showShortcuts ? <ShortcutsHelp onClose={() => setShowShortcuts(false)} /> : null}

            <Notices
                notices={notices.notices}
                onDismiss={notices.dismiss}
                onHold={notices.hold}
            />
        </div>
    );

    function openedPaths(): ReadonlySet<string> {
        const seen = new Set<string>();
        for (const point of navigation.current.points) {
            if (point.relPath) seen.add(point.relPath);
        }
        return seen;
    }

    function noteCounts(): ReadonlyMap<string, number> {
        const counts = new Map<string, number>();
        for (const [relPath, marks] of annotationIndex.byFile) {
            counts.set(relPath, marks.length);
        }
        return counts;
    }

    function generateAi(): void {
        if (!context || !selectedRange || aiBusy) return;
        if (!analysis) {
            noticesRef.current.push({
                level: 'warn',
                message: 'AI 초안을 쓰려면 분석이 있어야 한다. 기록을 하나 저장하면 만들어진다.',
            });
            return;
        }
        const requestId = crypto.randomUUID();
        pendingAiRequest.current = requestId;
        setAiDraft(null);
        setAiBusy(true);
        commands.generateAiDraft(context, {
            requestId,
            analysisId: analysis.id,
            documentId: selectedRange.documentId,
            range: selectedRange.range,
            purpose: analysis.purpose,
        });
        setPane('analysis');
    }

    /**
     * 기록을 만든다. 분석이 없으면 먼저 하나 만든다 (U11).
     *
     * "분석을 먼저 만드세요" 단계를 없앤다. 제목은 활성 트레일 이름을 쓰고
     * `trailIds` 로 짝지어 둔다 — 다음에 그 트레일을 고르면 따라온다.
     */
    function createAnnotation(value: {
        target: AnalysisTarget | SelectedCodeRange;
        body: string;
        kind: AnnotationKind;
        tags: string[];
    }): void {
        if (!context) return;
        if (!analysis) {
            pendingForNewAnalysis.current = value;
            commands.createAnalysis(context, {
                title: trailState.trail?.title ?? '분석',
                purpose: '',
                trailIds: trailState.activeTrailId ? [trailState.activeTrailId] : [],
                author,
            });
            return;
        }
        if ('documentId' in value.target) {
            pendingAnnotation.current = { body: value.body, kind: value.kind, tags: value.tags };
            commands.captureAnchor(context, {
                analysisId: analysis.id,
                documentId: value.target.documentId,
                range: value.target.range,
            });
            return;
        }
        commands.createAnnotation(context, {
            analysisId: analysis.id,
            target: value.target as unknown as Record<string, unknown>,
            body: value.body, kind: value.kind, tags: value.tags, author,
        });
    }

    function renderCodePane(): JSX.Element {
        if (document === null) {
            return (
                <StartCard
                    bootstrap={bootstrap}
                    diagnostics={diagnostics}
                    changedFiles={changes}
                    recentFiles={[...openedPaths()].slice(-5).reverse()}
                    onOpenFile={openFile}
                    onOpenDiagnostics={openDiagnostics}
                />
            );
        }
        const supported = document.supportedLanguage ?? null;
        return (
            <>
                <div className="doc-bar">
                    <span className="doc-path">{document.displayPath}</span>
                    <LspStatus
                        language={supported}
                        diagnostics={diagnostics}
                        onOpen={openDiagnostics}
                    />
                    <button
                        type="button"
                        className="start"
                        disabled={supported === null}
                        title={supported === null
                            ? '이 파일 형식은 심볼 해석을 지원하지 않는다.'
                            : 'Ctrl+Alt+T · 커서가 있는 함수부터'}
                        onClick={() => addRootHere(cursorRef.current.line, cursorRef.current.char)}
                    >
                        ▶ 트레일 시작
                    </button>
                    {enclosingSymbol === null ? null : (
                        <span className="muted">{`${enclosingSymbol} 에서`}</span>
                    )}
                    {hunks.length === 0 ? null : (
                        <>
                            <button
                                type="button"
                                title="이전 변경 (Alt+↑)"
                                onClick={() => jumpChange(-1)}
                            >
                                ↑ 이전 변경
                            </button>
                            <button
                                type="button"
                                title="다음 변경 (Alt+↓)"
                                onClick={() => jumpChange(1)}
                            >
                                ↓ 다음 변경
                            </button>
                            <button
                                type="button"
                                className={diffMode ? 'picked' : ''}
                                disabled={originalText === null}
                                onClick={() => setDiffMode((value) => !value)}
                            >
                                변경 보기
                            </button>
                        </>
                    )}
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
                    handle={codeViewRef}
                    document={document}
                    theme={resolvedTheme === 'light' ? 'vs' : 'vs-dark'}
                    hunks={hunks}
                    originalText={originalText}
                    diff={diffMode}
                    onAddRoot={(position) => addRootHere(position.line, position.char)}
                    onPositionClick={(position) => {
                        cursorRef.current = { line: position.line, char: position.char };
                    }}
                    onSelectionChange={(range, anchor) => {
                        setSelectedRange(range && document ? {
                            documentId: document.documentId,
                            label: `${document.displayPath}:${range.start.line + 1}`,
                            range,
                        } : null);
                        setChipAnchor(range === null ? null : anchor);
                    }}
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

    /** 이전·다음 변경으로 커서를 옮긴다 (U14). */
    function jumpChange(delta: -1 | 1): void {
        if (hunks.length === 0) return;
        const current = cursorRef.current.line + 1;
        const starts = hunks.map((hunk) => Math.max(1, hunk.newStart)).sort((a, b) => a - b);
        const next = delta > 0
            ? starts.find((line) => line > current) ?? starts[0]
            : [...starts].reverse().find((line) => line < current) ?? starts[starts.length - 1];
        if (next === undefined) return;
        cursorRef.current = { line: next - 1, char: 0 };
        codeViewRef.current?.revealLine(next - 1, 0);
    }

    function renderSettingsPane(): JSX.Element {
        return (
            <SettingsView
                settings={settings}
                readOnly={readOnly}
                author={author}
                aiCapability={bootstrap?.capabilities.ai
                    ?? { enabled: false, provider: 'ollama', model: '', maxInputBytes: 0 }}
                onUpdate={(next) => {
                    if (context !== null) commands.updateSettings(context, next);
                }}
                onAuthorName={(displayName) => setAuthor((current) => ({ ...current, displayName }))}
                onOpenDiagnostics={() => openDiagnostics(null)}
            />
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
                readOnly={readOnly}
                onRecoverAnalysis={(analysisId, kind) => {
                    if (context) commands.recoverAnalysis(context, analysisId, kind);
                }}
                onNotice={(message, level) => noticesRef.current.push({
                    message,
                    ...(level === undefined ? {} : { level }),
                })}
            />
        );
    }

    function renderTrailPane(): JSX.Element {
        if (trailState.trail === null || context === null) {
            return (
                <div className="placeholder">
                    <p>아직 트레일이 없다.</p>
                    <p className="muted">
                        코드 화면에서 함수 위를 누르고 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>.
                        트레일은 자동으로 생긴다.
                    </p>
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
                staleNodeIds={trailState.staleNodeIds}
                clickTarget={ui?.clickTarget ?? 'allSymbols'}
                maxCodeLines={ui?.maxCodeLines ?? 250}
                fontSize={ui?.fontSize ?? 0}
                fitToWidth={ui?.fitToWidth ?? true}
                minFontSize={ui?.minFontSize ?? 8}
                implementationSupported={implementationSupported}
                choice={trailState.choice}
                annotations={annotationIndex}
                childOrderDefault={ui?.childOrder ?? 'source'}
                focusRequest={trailState.focusRequest}
                annotationColumn={columnOpen ? renderAnnotationColumn() : null}
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
                onNote={(node) => {
                    commands.setActiveNode(context, node.id);
                    setComposerTarget('node');
                    if (!columnOpen) setColumnOpen(true);
                }}
                onShowNotes={(node) => {
                    commands.setActiveNode(context, node.id);
                    if (!columnOpen) setColumnOpen(true);
                }}
                onRefresh={(node) => commands.refreshNode(context, node.id)}
                onOpenAnnotation={(annotationId) => {
                    setPane('analysis');
                    window.setTimeout(() => {
                        const href = internalReference(analysis, { annotationId });
                        const element = window.document.getElementById(href.slice(1));
                        element?.focus({ preventScroll: true });
                        element?.scrollIntoView({ block: 'nearest' });
                    }, 0);
                }}
                onIdentifierClick={onIdentifierClick}
                onRangeSelect={(node, range, anchor) => {
                    if (node.symbol.documentId) setSelectedRange({
                        documentId: node.symbol.documentId,
                        label: `${node.symbol.displayPath}:${range.start.line + 1}`,
                        range,
                    });
                    // **탭을 바꾸지 않는다.** 코드 한 줄을 복사하려던 것일 수 있다(U04).
                    setChipAnchor(anchor);
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
                onAttachAllImplementations={(nodeId) => {
                    commands.resolveImplementations(context, nodeId);
                    trailState.dismissChoice();
                }}
                onDismissChoice={trailState.dismissChoice}
                onSetMode={(mode) => commands.setMode(context, mode)}
                onSetChildOrder={(order) => commands.setChildOrder(context, order)}
                onNodeUi={(nodeId, patch) => commands.setNodeUi(context, nodeId, patch)}
            />
        </>
        );
    }

    /** 트레일 패널 옆의 기록 열 (U12). */
    function renderAnnotationColumn(): JSX.Element {
        const marks = activeNode
            ? (annotationIndex.byFile.get(activeNode.symbol.relPath ?? '') ?? []).filter((mark) => {
                const lineCount = activeNode.symbol.code === ''
                    ? 0 : activeNode.symbol.code.split(/\r?\n/).length;
                const end = activeNode.symbol.startLine + Math.max(0, lineCount - 1);
                return mark.startLine <= end && mark.endLine >= activeNode.symbol.startLine;
            })
            : [];
        const nodeIds = new Set(marks.map((mark) => mark.annotationId));
        const items = (analysis?.annotations ?? []).filter((item) => {
            if (item.deletedAt !== null) return false;
            if (nodeIds.has(item.id)) return true;
            const target = item.target as { kind?: string; nodeId?: string };
            return target.kind === 'node' && target.nodeId === activeNode?.id;
        });

        const composerLabel = composerTarget === 'range'
            ? selectedRange?.label ?? '코드를 먼저 선택한다.'
            : composerTarget === 'node'
                ? activeNodeLabel ?? '노드를 먼저 고른다.'
                : `트레일 전체 · ${trailState.trail?.title ?? ''}`;

        return (
            <AnnotationColumn
                targetLabel={composerLabel}
                width={columnWidth}
                onWidth={setColumnWidth}
                onClose={() => setColumnOpen(false)}
                itemCount={items.length}
                onOpenAnalysisPane={() => setPane('analysis')}
                composer={(
                    <AnnotationComposer
                        targetKind={composerTarget}
                        onTargetKind={setComposerTarget}
                        targetLabel={composerLabel}
                        nodeAvailable={activeNode !== null}
                        rangeAvailable={selectedRange !== null}
                        readOnly={readOnly}
                        body={composerBody}
                        onBody={setComposerBody}
                        canSubmit={composerTargetValue() !== null}
                        onSubmit={(value) => {
                            const target = composerTargetValue();
                            if (target === null) return;
                            createAnnotation({ target, ...value });
                            setComposerBody('');
                        }}
                    />
                )}
                items={items.map((item) => {
                    const target = item.target as unknown as AnalysisTarget;
                    const href = internalReference(analysis, { annotationId: item.id });
                    return (
                        <AnnotationItem
                            key={item.id}
                            anchorId={`col-${item.id}`}
                            annotation={item as never}
                            authorName={analysis?.authors.find((value) => value.id === item.authorId)?.displayName ?? '알 수 없음'}
                            replies={(analysis?.replies ?? []).filter((value) => value.annotationId === item.id && value.deletedAt === null)}
                            readOnly={readOnly}
                            referenceHref={href}
                            targetLinks={targetLinks(analysis, target, navigateAnalysisTarget)}
                            onFocusReference={() => setPane('analysis')}
                            onUpdate={(patch) => {
                                if (context && analysis) commands.updateAnnotation(context, {
                                    analysisId: analysis.id, annotationId: item.id,
                                    baseVersion: item.version, actorId: author.id, patch,
                                });
                            }}
                            onDelete={() => {
                                if (context && analysis) commands.deleteAnnotation(context, {
                                    analysisId: analysis.id, annotationId: item.id,
                                    baseVersion: item.version, actorId: author.id,
                                });
                            }}
                            onRestore={() => {
                                if (context && analysis) commands.restoreAnnotation(context, {
                                    analysisId: analysis.id, annotationId: item.id,
                                    baseVersion: item.version, actorId: author.id,
                                });
                            }}
                            onReply={(body) => {
                                if (context && analysis) commands.replyAnnotation(context, {
                                    analysisId: analysis.id, annotationId: item.id, body, author,
                                });
                            }}
                        />
                    );
                })}
            />
        );
    }

    function composerTargetValue(): AnalysisTarget | SelectedCodeRange | null {
        if (composerTarget === 'range') return selectedRange;
        if (composerTarget === 'node') {
            return trailState.activeTrailId && activeNode
                ? { kind: 'node', trailId: trailState.activeTrailId, nodeId: activeNode.id }
                : null;
        }
        return trailState.activeTrailId ? { kind: 'trail', trailId: trailState.activeTrailId } : null;
    }

    function renderAnalysisPane(): JSX.Element {
        return (
            <AnalysisPanel
                analyses={analyses}
                analysis={analysis}
                activeTrailId={trailState.activeTrailId}
                activeNodeId={activeNode?.id ?? null}
                activeNodeLabel={activeNodeLabel}
                selectedRange={selectedRange}
                author={author}
                persistedRevision={persistedRevision}
                readOnly={readOnly}
                sharePreview={sharePreview}
                importPreview={importPreview}
                aiCapability={bootstrap?.capabilities.ai ?? { enabled: false, provider: 'ollama', model: '', maxInputBytes: 0 }}
                aiDraft={aiDraft}
                aiBusy={aiBusy}
                comparison={anchorComparison}
                composerTarget={composerTarget}
                composerBody={composerBody}
                onComposerTarget={setComposerTarget}
                onComposerBody={setComposerBody}
                onSelect={(analysisId) => {
                    manualAnalysis.current = analysisId === '' ? null : analysisId;
                    if (analysisId === '') { setAnalysis(null); return; }
                    void api.analysis(analysisId).then((value) => {
                        setAnalysis(value); setPersistedRevision(value.revision); setAnchorComparison(null);
                    });
                }}
                onCreateAnalysis={(title, purpose) => {
                    if (context) commands.createAnalysis(context, {
                        title, purpose,
                        trailIds: trailState.activeTrailId ? [trailState.activeTrailId] : [],
                        author,
                    });
                }}
                onCreateAnnotation={createAnnotation}
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
                    if (!context || file.size > 32 * 1024 * 1024) {
                        noticesRef.current.push({ level: 'error', message: '공유 파일이 너무 크다.' });
                        return;
                    }
                    void file.arrayBuffer().then(async (buffer) => {
                        const bytes = new Uint8Array(buffer);
                        const digest = await crypto.subtle.digest('SHA-256', bytes);
                        pendingUpload.current = bytes;
                        commands.uploadStart(context, bytes.length, [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''));
                    });
                }}
                onCommitImport={(uploadId) => { if (context) commands.importCommit(context, uploadId); }}
                onCommitMerge={(planId) => { if (context) commands.mergeCommit(context, planId, author.id); }}
                onGenerateAi={() => generateAi()}
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
                    void api.anchorComparison(analysis.id, anchorId)
                        .then(setAnchorComparison)
                        .catch((cause: unknown) => noticesRef.current.push({
                            level: 'error',
                            message: cause instanceof ApiError ? cause.message : '코드를 비교하지 못했다.',
                        }));
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
