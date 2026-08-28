import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { api, ApiError, type Bootstrap, type DocumentContent, type TrailSummary } from '../api/http.js';
import { TrailSocket, type ConnectionState, type ServerEventMessage } from '../api/socket.js';
import { CodeView } from '../features/source/CodeView.js';
import { FileSearch } from '../features/workspace/FileSearch.js';
import { FileTree } from '../features/workspace/FileTree.js';

/**
 * 화면 뼈대 (구현서 16.1).
 *
 * ```text
 * ┌───────────────────────────────────────────────┐
 * │ 상단 앱 바: 프로젝트 · 트레일 · 연결 상태     │
 * ├───────────────┬───────────────────────────────┤
 * │ 파일 탐색기   │ 코드 화면                     │
 * │ 검색          │ (단계 7에서 트레일 화면 추가) │
 * └───────────────┴───────────────────────────────┘
 * ```
 *
 * 지금은 코드 화면까지다. 트레일·보드 캔버스는 단계 7~8에서 이 자리에 들어온다.
 */

const STATE_LABEL: Record<ConnectionState, string> = {
    connecting: '연결 중',
    open: '연결됨',
    closed: '끊김',
};

export function App(): JSX.Element {
    const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
    const [trails, setTrails] = useState<TrailSummary[]>([]);
    const [connection, setConnection] = useState<ConnectionState>('connecting');
    const [document, setDocument] = useState<DocumentContent | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [staleDocument, setStaleDocument] = useState(false);
    const socketRef = useRef<TrailSocket | null>(null);
    // 이벤트 처리기가 항상 최신 문서를 보게 한다. 상태를 의존성에 넣으면
    // 문서를 열 때마다 소켓이 다시 붙는다.
    const documentRef = useRef<DocumentContent | null>(null);
    documentRef.current = document;

    useEffect(() => {
        void api
            .bootstrap()
            .then((data) => {
                setBootstrap(data);
                setTrails(data.trails);
            })
            .catch((cause: unknown) => {
                setError(
                    cause instanceof ApiError
                        ? cause.message
                        : '서버에 연결하지 못했다. 터미널에서 code-trail 을 다시 실행한다.',
                );
            });
    }, []);

    useEffect(() => {
        const socket = new TrailSocket({
            onState: setConnection,
            onEvent: (event: ServerEventMessage) => {
                if (event.type === 'trail.listChanged') {
                    const payload = event.payload as { trails: TrailSummary[] };
                    setTrails(payload.trails);
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
                }
            },
        });
        socketRef.current = socket;
        socket.connect();
        return () => {
            socket.close();
            socketRef.current = null;
        };
    }, []);

    const openFile = useCallback((relPath: string) => {
        void api
            .open(relPath)
            .then((content) => {
                setDocument(content);
                setStaleDocument(false);
                setError(null);
            })
            .catch((cause: unknown) => {
                setError(cause instanceof ApiError ? cause.message : '파일을 열지 못했다.');
            });
    }, []);

    if (error !== null && bootstrap === null) {
        return (
            <div className="fatal">
                <h1>Code Trail</h1>
                <p>{error}</p>
            </div>
        );
    }

    return (
        <div className="app">
            <header className="app-bar">
                <span className="app-name">Code Trail</span>
                <span className="project">{bootstrap?.project.name ?? '…'}</span>
                <span className="spacer" />
                <span className="trail-count">트레일 {trails.length}</span>
                <span className={`conn conn-${connection}`}>{STATE_LABEL[connection]}</span>
            </header>

            <div className="app-body">
                <aside className="sidebar">
                    <FileSearch onOpenFile={openFile} />
                    <FileTree onOpenFile={openFile} activePath={document?.relPath ?? null} />
                </aside>

                <main className="main">
                    {document === null ? (
                        <div className="placeholder">
                            <p>왼쪽에서 파일을 고르면 여기에 코드가 열린다.</p>
                            <p className="muted">
                                식별자를 클릭해 정의를 펼치는 트레일 화면은 다음 단계에서 붙는다.
                            </p>
                        </div>
                    ) : (
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
                            <CodeView document={document} />
                        </>
                    )}
                    {error !== null ? <p className="panel-error">{error}</p> : null}
                </main>
            </div>
        </div>
    );
}
