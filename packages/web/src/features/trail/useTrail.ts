import { useCallback, useEffect, useRef, useState } from 'react';

import { isOwnCommand } from '../../api/commands.js';
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
 * 트리 모양이 크게 바뀌는 명령(`⇱`, 지우기, 되돌리기, 다시 읽기)은 서버가
 * snapshot 을 다시 보낸다. 그래서 여기서는 부분 갱신을 단순하게 유지할 수 있다.
 *
 * **알림을 만들지 않는다.** 이벤트 → 상태만 담당하고, 사람에게 보여줄 말은
 * `App` 이 정한다(U02) — 오류 표시 통로가 둘이면 같은 오류를 두 모양으로 본다.
 */

export interface TrailState {
    trail: TrailSnapshot | null;
    trails: TrailSummaryView[];
    activeTrailId: string | null;
    /** 지금 해석 중인 노드. 헤더에 진행 표시를 띄운다. */
    busyNodeIds: ReadonlySet<string>;
    /** 파일이 바뀌어 옛 코드를 보여주고 있는 노드. */
    staleNodeIds: ReadonlySet<string>;
    /** 사용자가 골라야 하는 정의·구현 후보. 없으면 `null`. */
    choice: DefinitionChoice | null;
    /** 디스크에 마지막으로 쓰인 revision. 앱 바의 저장 표시가 쓴다. */
    persistedRevision: number | null;
    /**
     * 이 탭이 시킨 활성 노드 변경.
     *
     * 옆 탭이 노드를 골랐다고 이 탭이 따라 스크롤하면 방해가 된다.
     * `seq` 가 오를 때만 화면을 움직인다.
     */
    focusRequest: { nodeId: string; seq: number } | null;
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
} {
    const [trail, setTrail] = useState<TrailSnapshot | null>(null);
    const [trails, setTrails] = useState<TrailSummaryView[]>([]);
    const [activeTrailId, setActiveTrailId] = useState<string | null>(null);
    const [busyNodeIds, setBusyNodeIds] = useState<ReadonlySet<string>>(() => new Set());
    const [staleNodeIds, setStaleNodeIds] = useState<ReadonlySet<string>>(() => new Set());
    const [choice, setChoice] = useState<DefinitionChoice | null>(null);
    const [persistedRevision, setPersistedRevision] = useState<number | null>(null);
    const [focusRequest, setFocusRequest] = useState<TrailState['focusRequest']>(null);
    const focusSeq = useRef(0);

    // 소켓이 바뀌면 상태를 비운다. 다시 붙으면 서버가 snapshot 을 보내준다.
    const socketRef = useRef(socket);
    useEffect(() => {
        if (socketRef.current !== socket) {
            socketRef.current = socket;
            setBusyNodeIds(new Set());
        }
    }, [socket]);

    const requestFocus = useCallback((nodeId: string | null, commandId?: string): void => {
        if (nodeId === null || !isOwnCommand(commandId)) {
            return;
        }
        focusSeq.current += 1;
        setFocusRequest({ nodeId, seq: focusSeq.current });
    }, []);

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

            case 'trail.persisted': {
                const { trailId, revision } = event.payload as {
                    trailId: string; revision: number;
                };
                setTrail((prev) => {
                    if (prev !== null && prev.id === trailId) {
                        setPersistedRevision(revision);
                    }
                    return prev;
                });
                return;
            }

            case 'trail.rootAdded': {
                const { node } = event.payload as { node: TrailNodeView };
                setTrail((prev) => (prev === null ? prev : {
                    ...prev,
                    revision: event.revision ?? prev.revision,
                    roots: [...prev.roots, node],
                }));
                requestFocus(node.id, event.commandId);
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
                requestFocus(node.id, event.commandId);
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

            case 'trail.nodesStale': {
                // 서버가 해시를 견줘 실제로 달라진 노드만 준다.
                const { nodeIds, cleared } = event.payload as {
                    trailId: string; nodeIds: string[]; cleared?: string[];
                };
                setStaleNodeIds((prev) => {
                    const next = new Set([...prev, ...nodeIds]);
                    for (const nodeId of cleared ?? []) {
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

            case 'trail.childOrderChanged': {
                const { childOrder } = event.payload as { childOrder: 'source' | 'click' | null };
                setTrail((prev) => (prev === null ? prev : { ...prev, childOrder }));
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
                requestFocus(nodeId, event.commandId);
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
                // **자동으로 고르지 않는다.** 목록을 클릭한 자리 옆에 띄우고 기다린다.
                setChoice({ ...(event.payload as DefinitionChoice), kind: 'definition' });
                return;
            }

            case 'trail.implementationChoice': {
                const payload = event.payload as DefinitionChoice & {
                    choiceId: string | null; truncated: boolean;
                };
                // 잘림 알림에는 고를 것이 없다. 그건 `App` 이 알림으로 띄운다.
                if (payload.choiceId === null || payload.candidates.length === 0) {
                    return;
                }
                setChoice({
                    choiceId: payload.choiceId,
                    nodeId: payload.nodeId,
                    candidates: payload.candidates,
                    ...(payload.title === undefined ? {} : { title: payload.title }),
                    kind: 'implementation',
                });
                return;
            }

            default:
        }
    }, [requestFocus]);

    return {
        trail,
        trails,
        activeTrailId,
        busyNodeIds,
        staleNodeIds,
        choice,
        persistedRevision,
        focusRequest,
        handleEvent,
        dismissChoice: useCallback(() => setChoice(null), []),
    };
}
