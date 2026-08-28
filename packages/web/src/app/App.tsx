import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';

import {
    api,
    ApiError,
    type Bootstrap,
    type DocumentContent,
    type LanguageDiagnostics,
    type ProjectSettingsView,
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

type Pane = 'code' | 'trail' | 'diagnostics';

export function App(): JSX.Element {
    const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
    const [settings, setSettings] = useState<ProjectSettingsView | null>(null);
    const [connection, setConnection] = useState<ConnectionState>('connecting');
    const [document, setDocument] = useState<DocumentContent | null>(null);
    const [staleDocument, setStaleDocument] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pane, setPane] = useState<Pane>('code');
    const [diagnostics, setDiagnostics] = useState<LanguageDiagnostics[]>([]);
    const [recoveryCandidates, setRecoveryCandidates] = useState<unknown[]>([]);
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

    const trailState = useTrail(socket);
    // 이벤트 처리기가 항상 최신이어야 한다. 의존성에 넣으면 소켓이 다시 붙는다.
    const handleEventRef = useRef(trailState.handleEvent);
    handleEventRef.current = trailState.handleEvent;
    const refreshDiagnosticsRef = useRef<() => void>(() => undefined);

    useEffect(() => {
        void api
            .bootstrap()
            .then((data) => {
                setBootstrap(data);
                setSettings(data.settings);
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
                setRecoveryCandidates(data.recoveryCandidates);
            })
            .catch(() => undefined);
    }, []);

    refreshDiagnosticsRef.current = refreshDiagnostics;

    useEffect(() => {
        refreshDiagnostics();
    }, [refreshDiagnostics]);

    useEffect(() => {
        const created = new TrailSocket({
            onState: setConnection,
            onEvent: (event: ServerEventMessage) => {
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

    const openFile = useCallback((relPath: string) => {
        void api
            .open(relPath)
            .then((content) => {
                setDocument(content);
                setStaleDocument(false);
                setError(null);
                setPane('code');
            })
            .catch((cause: unknown) => {
                setError(cause instanceof ApiError ? cause.message : '파일을 열지 못했다.');
            });
    }, []);

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
                </aside>

                <main className="main">
                    <div className="pane-tabs">
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
        return (
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
                onFocusNode={(nodeId) => commands.setActiveNode(context, nodeId)}
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
        );
    }
}
