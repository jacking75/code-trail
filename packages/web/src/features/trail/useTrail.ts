import { useCallback, useEffect, useRef, useState } from 'react';

import type { ServerEventMessage, TrailSocket } from '../../api/socket.js';
import type {
    DefinitionChoice,
    NodeUiView,
    TrailNodeView,
    TrailSnapshot,
    TrailSummaryView,
} from './types.js';

/**
 * 서버 이벤트를 화면 상태로 옮긴다 (구현서 16.2).
 *
 * **낙관적 갱신을 하지 않는다.** 화면은 명령을 보내고 이벤트를 받아서만 바뀐다.
 * 먼저 그려두면 서버가 거절했을 때(오래된 revision, 권한 없는 문서) 두 상태가
 * 어긋나고, 그 어긋남은 다음 명령의 `baseRevision` 을 타고 번진다.
 *
 * 트리 모양이 크게 바뀌는 명령(`⇱`, 지우기)은 서버가 snapshot 을 다시 보낸다.
 * 그래서 여기서는 부분 갱신을 단순하게 유지할 수 있다.
 */

export interface TrailState {
    trail: TrailSnapshot | null;
    trails: TrailSummaryView[];
    activeTrailId: string | null;
    /** 지금 해석 중인 노드. 헤더에 진행 표시를 띄운다. */
    busyNodeIds: ReadonlySet<string>;
    /** 사용자가 골라야 하는 정의 후보. 없으면 `null`. */
    choice: DefinitionChoice | null;
    /** 마지막 오류 한 줄. 토스트로 띄운다. */
    notice: { level: 'info' | 'warn' | 'error'; message: string } | null;
}

/** 트리 안의 노드 하나를 바꾼 새 트리를 만든다. */
function mapNode(
    roots: TrailNodeView[],
    id: string,
    change: (node: TrailNodeView) => TrailNodeView,
): TrailNodeView[] {
    return roots.map((node) => {
        if (node.id === id) {
            return change(node);
        }
        const children = mapNode(node.children, id, change);
        return children === node.children ? node : { ...node, children };
    });
}

function addChild(roots: TrailNodeView[], parentId: string, child: TrailNodeView): TrailNodeView[] {
    return mapNode(roots, parentId, (parent) => ({
        ...parent,
        children: [...parent.children, child],
    }));
}

function removeNode(roots: TrailNodeView[], id: string): TrailNodeView[] {
    return roots
        .filter((node) => node.id !== id)
        .map((node) => {
            const children = removeNode(node.children, id);
            return children === node.children ? node : { ...node, children };
        });
}

export function useTrail(socket: TrailSocket | null): TrailState & {
    /** 이벤트를 넣는다. `App` 이 소켓에서 받아 넘긴다. */
    handleEvent: (event: ServerEventMessage) => void;
    dismissChoice: () => void;
    dismissNotice: () => void;
} {
    const [trail, setTrail] = useState<TrailSnapshot | null>(null);
    const [trails, setTrails] = useState<TrailSummaryView[]>([]);
    const [activeTrailId, setActiveTrailId] = useState<string | null>(null);
    const [busyNodeIds, setBusyNodeIds] = useState<ReadonlySet<string>>(() => new Set());
    const [choice, setChoice] = useState<DefinitionChoice | null>(null);
    const [notice, setNotice] = useState<TrailState['notice']>(null);

    // 소켓이 바뀌면 상태를 비운다. 다시 붙으면 서버가 snapshot 을 보내준다.
    const socketRef = useRef(socket);
    useEffect(() => {
        if (socketRef.current !== socket) {
            socketRef.current = socket;
            setBusyNodeIds(new Set());
        }
    }, [socket]);

    const handleEvent = useCallback((event: ServerEventMessage) => {
        switch (event.type) {
            case 'trail.listChanged': {
                const payload = event.payload as {
                    trails: TrailSummaryView[];
                    activeTrailId: string | null;
                };
                setTrails(payload.trails);
                setActiveTrailId(payload.activeTrailId);
                // 트레일이 하나도 안 남았으면 화면도 비운다.
                if (payload.activeTrailId === null) {
                    setTrail(null);
                }
                return;
            }

            case 'trail.snapshot': {
                setTrail(event.payload as TrailSnapshot);
                setActiveTrailId((event.payload as TrailSnapshot).id);
                return;
            }

            case 'trail.rootAdded': {
                const { node } = event.payload as { node: TrailNodeView };
                setTrail((prev) => (prev === null ? prev : {
                    ...prev,
                    revision: event.revision ?? prev.revision,
                    roots: [...prev.roots, node],
                }));
                return;
            }

            case 'trail.nodeAdded': {
                const { parentId, node } = event.payload as {
                    parentId: string;
                    node: TrailNodeView;
                };
                setTrail((prev) => (prev === null ? prev : {
                    ...prev,
                    revision: event.revision ?? prev.revision,
                    roots: addChild(prev.roots, parentId, node),
                }));
                return;
            }

            case 'trail.nodeRemoved': {
                const { nodeId } = event.payload as { nodeId: string };
                setTrail((prev) => (prev === null ? prev : {
                    ...prev,
                    revision: event.revision ?? prev.revision,
                    roots: removeNode(prev.roots, nodeId),
                }));
                return;
            }

            case 'trail.nodeToggled': {
                const { nodeId, collapsed } = event.payload as {
                    nodeId: string;
                    collapsed: boolean;
                };
                setTrail((prev) => (prev === null ? prev : {
                    ...prev,
                    revision: event.revision ?? prev.revision,
                    roots: mapNode(prev.roots, nodeId, (node) => ({ ...node, collapsed })),
                }));
                return;
            }

            case 'trail.nodeBusy': {
                const { nodeId, on } = event.payload as { nodeId: string; on: boolean };
                setBusyNodeIds((prev) => {
                    const next = new Set(prev);
                    if (on) {
                        next.add(nodeId);
                    } else {
                        next.delete(nodeId);
                    }
                    return next;
                });
                return;
            }

            case 'trail.modeChanged': {
                // 트리 ↔ 보드도 화면 상태다. revision 을 올리지 않는다.
                const { mode } = event.payload as { mode: 'tree' | 'board' };
                setTrail((prev) => (prev === null ? prev : { ...prev, mode }));
                return;
            }

            case 'trail.nodeUiChanged': {
                // 보드 좌표·본문 높이·코드 글자 크기. `state` 가 `null` 이면
                // 그 노드의 손조절을 전부 지운 것이다(줄 번호 더블클릭).
                const { nodeId, state } = event.payload as {
                    nodeId: string;
                    state: NodeUiView | null;
                };
                setTrail((prev) => {
                    if (prev === null) {
                        return prev;
                    }
                    const nodeUi = { ...prev.nodeUi };
                    if (state === null) {
                        delete nodeUi[nodeId];
                    } else {
                        nodeUi[nodeId] = state;
                    }
                    return { ...prev, nodeUi };
                });
                return;
            }

            case 'trail.activeNodeChanged': {
                // 활성 노드는 화면 상태다. revision 을 올리지 않는다 —
                // 노드를 하나 누른 것만으로 날아가던 구조 명령이 거절되면 안 된다.
                const { nodeId } = event.payload as { nodeId: string | null };
                setTrail((prev) => (prev === null ? prev : { ...prev, activeNodeId: nodeId }));
                return;
            }

            case 'trail.renamed': {
                const { title } = event.payload as { title: string };
                setTrail((prev) => (prev === null ? prev : {
                    ...prev,
                    title,
                    revision: event.revision ?? prev.revision,
                }));
                return;
            }

            case 'trail.definitionChoice': {
                // **자동으로 고르지 않는다.** 목록을 띄우고 기다린다.
                setChoice(event.payload as DefinitionChoice);
                return;
            }

            case 'trail.implementationChoice': {
                const payload = event.payload as { truncated: boolean };
                setNotice({
                    level: 'info',
                    message: payload.truncated
                        ? '구현이 많아 일부만 붙였다.'
                        : '구현이 여러 개다. 헤더의 ⚑ 를 눌러 전부 펼친다.',
                });
                return;
            }

            case 'trail.exportReady': {
                const { url, fileName } = event.payload as { url: string; fileName: string };
                setNotice({ level: 'info', message: `${fileName} 을 내려받는다.` });
                void downloadMarkdown(url, fileName);
                return;
            }

            case 'command.error': {
                const { error } = event.payload as {
                    error: { code: string; message: string; retryable: boolean };
                };
                setNotice({ level: error.retryable ? 'warn' : 'error', message: error.message });
                return;
            }

            default:
        }
    }, []);

    return {
        trail,
        trails,
        activeTrailId,
        busyNodeIds,
        choice,
        notice,
        handleEvent,
        dismissChoice: useCallback(() => setChoice(null), []),
        dismissNotice: useCallback(() => setNotice(null), []),
    };
}

/**
 * Markdown 을 내려받는다.
 *
 * 본문을 WebSocket 으로 흘리지 않는다(구현서 15.1). HTTP 로 받아 브라우저
 * 다운로드에 넘긴다 — 토큰이 필요하므로 fetch 로 받아 blob 을 만든다.
 */
async function downloadMarkdown(url: string, fileName: string): Promise<void> {
    const token = sessionStorage.getItem('codeTrail.token');
    if (token === null) {
        return;
    }
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
        return;
    }
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
}
