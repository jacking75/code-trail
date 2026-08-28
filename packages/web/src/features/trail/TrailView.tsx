import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type JSX,
    type PointerEvent as ReactPointerEvent,
    type MouseEvent as ReactMouseEvent,
} from 'react';

import type { ClickTarget } from '../../tokenizer/tokenize.js';
import {
    BOARD_DEFAULT_HEIGHT,
    BOARD_DEFAULT_WIDTH,
    autoPlace,
    boardExtent,
    connectors,
    flattenTree,
    type BoardPoint,
    type BoardRect,
    type BoardSize,
} from './board.js';
import { TrailNode } from './TrailNode.js';
import { BASE_CODE_FONT_SIZE, useFitToWidth } from './useFitToWidth.js';
import {
    ancestorsOf,
    splitName,
    type DefinitionChoice,
    type NodeUiView,
    type TrailNodeView,
    type TrailSnapshot,
} from './types.js';

/**
 * 트레일 화면 (구현서 16.1, 16.3, 16.4).
 *
 * 툴바 · 브레드크럼 · 트리 세 부분이다.
 *
 * **트리 모드**의 배치는 CSS 가 만든다 — 부모가 위, 자식이 그 아래 같은 행에
 * 좌우로 놓인다. 자식이 부모 DOM 안에 중첩돼 있다.
 *
 * **보드 모드**에서는 모든 노드를 `#root` 바로 아래에 평평하게 늘어놓고
 * `left/top` 으로 배치한다. 중첩된 채로 절대 배치를 하면 자식 좌표가 부모
 * 기준이 되어 엉킨다. 부모-자식 관계는 없어지지 않는다 — 모델은 그대로고
 * 화면에는 곡선으로 잇는다. **노드를 아무 데나 끌어다 놓아도 관계는 안 바뀐다.**
 */

export interface TrailViewProps {
    trail: TrailSnapshot;
    busyNodeIds: ReadonlySet<string>;
    clickTarget: ClickTarget;
    maxCodeLines: number;
    /** 코드 글자 크기 관련 설정. 폭 맞춤은 코드 본문에만 건다. */
    fontSize: number;
    fitToWidth: boolean;
    minFontSize: number;
    /** 이 언어 서버가 구현 찾기를 지원하는지. */
    implementationSupported: boolean;
    choice: DefinitionChoice | null;

    onToggle: (node: TrailNodeView) => void;
    onToggleAll: (collapsed: boolean) => void;
    onRemove: (node: TrailNodeView) => void;
    onPromote: (node: TrailNodeView) => void;
    onImplementations: (node: TrailNodeView) => void;
    onOpenInEditor: (node: TrailNodeView) => void;
    onIdentifierClick: (
        node: TrailNodeView,
        line: number,
        char: number,
        text: string,
        modifiers: { alt: boolean; ctrl: boolean },
    ) => void;
    onFocusNode: (nodeId: string) => void;
    onClear: () => void;
    onExportMarkdown: () => void;
    onChooseCandidate: (choiceId: string, candidateId: string) => void;
    onDismissChoice: () => void;
    onSetMode: (mode: 'tree' | 'board') => void;
    onNodeUi: (
        nodeId: string,
        patch: {
            boardX?: number | null;
            boardY?: number | null;
            bodyHeight?: number | null;
            codeFontSize?: number | null;
        },
    ) => void;
}

/**
 * 필터에 걸린 노드와 그 조상.
 *
 * 조상을 함께 남기는 이유는 트리 모양을 지키기 위해서다. 걸린 노드만 남기면
 * 부모가 사라져 어디서 갈라진 것인지 알 수 없다.
 */
function filterIds(roots: readonly TrailNodeView[], query: string): Set<string> | null {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
        return null;
    }
    const keep = new Set<string>();
    const walk = (node: TrailNodeView, chain: TrailNodeView[]): boolean => {
        const nextChain = [...chain, node];
        const hit = node.symbol.name.toLowerCase().includes(needle)
            || node.symbol.displayPath.toLowerCase().includes(needle);
        let anyChild = false;
        for (const child of node.children) {
            anyChild = walk(child, nextChain) || anyChild;
        }
        if (hit || anyChild) {
            for (const inChain of nextChain) {
                keep.add(inChain.id);
            }
            return true;
        }
        return false;
    };
    roots.forEach((root) => walk(root, []));
    return keep;
}

/** 끌고 있는 노드. 저장하기 전의 임시 좌표다. */
interface DragState {
    id: string;
    pointerId: number;
    dx: number;
    dy: number;
    hd: HTMLElement;
    box: HTMLElement;
    moved: boolean;
}

export function TrailView(props: TrailViewProps): JSX.Element {
    const { trail } = props;
    const [filter, setFilter] = useState('');
    const [childOrder, setChildOrder] = useState<'source' | 'click'>('source');

    const rootRef = useRef<HTMLDivElement | null>(null);
    const board = trail.mode === 'board';

    const visibleIds = useMemo(() => filterIds(trail.roots, filter), [trail.roots, filter]);

    const breadcrumb = useMemo(
        () => (trail.activeNodeId === null ? [] : ancestorsOf(trail.roots, trail.activeNodeId)),
        [trail.roots, trail.activeNodeId],
    );

    /*
     * 그릴 목록. 부모가 항상 자식보다 앞이다.
     *
     * 자식을 **모델**에서 찾는다. 보드 모드에서는 자식이 부모 안에 중첩돼 있지
     * 않아 DOM 순회로는 하나도 못 찾는다.
     */
    const flat = useMemo(() => flattenTree(trail.roots, childOrder), [trail.roots, childOrder]);

    // ── 보드 배치 ───────────────────────────────────────────────────────────

    /*
     * 노드 크기를 잰다.
     *
     * 자리를 잡으려면 실제 크기가 필요한데, 크기는 그려봐야 안다. 그래서 그린 뒤
     * 재고, 값이 달라졌을 때만 다시 계산하게 한다. 1px 이내 차이는 무시한다 —
     * 재고 그리고 다시 재는 것이 끝없이 반복되지 않게 하는 안전장치다.
     */
    const sizesRef = useRef<Record<string, BoardSize>>({});
    const [sizeVersion, setSizeVersion] = useState(0);

    useLayoutEffect(() => {
        const host = rootRef.current;
        if (!board || host === null) {
            return;
        }
        const next: Record<string, BoardSize> = {};
        let changed = false;
        host.querySelectorAll('.node').forEach((element) => {
            const box = element as HTMLElement;
            const id = box.dataset['id'];
            if (id === undefined) {
                return;
            }
            const size = { width: box.offsetWidth, height: box.offsetHeight };
            next[id] = size;
            const previous = sizesRef.current[id];
            if (previous === undefined
                || Math.abs(previous.width - size.width) > 1
                || Math.abs(previous.height - size.height) > 1) {
                changed = true;
            }
        });
        if (!changed
            && Object.keys(next).length === Object.keys(sizesRef.current).length) {
            return;
        }
        sizesRef.current = next;
        setSizeVersion((version) => version + 1);
    });

    const autoPositions = useMemo(
        () => (board ? autoPlace(flat, trail.nodeUi, sizesRef.current) : {}),
        // sizeVersion 이 바뀌면 sizesRef 의 내용도 바뀐 것이다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [board, flat, trail.nodeUi, sizeVersion],
    );

    /** 끌고 있는 동안의 임시 좌표. 손을 떼야 서버에 저장한다. */
    const [dragPoint, setDragPoint] = useState<(BoardPoint & { id: string }) | null>(null);
    const dragPointRef = useRef(dragPoint);
    dragPointRef.current = dragPoint;
    const dragRef = useRef<DragState | null>(null);
    /** 끌고 나서 올라오는 click 이 헤더 접기로 이어지지 않게 한 번 막는다. */
    const suppressClickRef = useRef(false);

    const positions = useMemo(() => {
        if (dragPoint === null) {
            return autoPositions;
        }
        return { ...autoPositions, [dragPoint.id]: { x: dragPoint.x, y: dragPoint.y } };
    }, [autoPositions, dragPoint]);

    const rects = useMemo(() => {
        const out: Record<string, BoardRect> = {};
        for (const item of flat) {
            const point = positions[item.node.id];
            if (point === undefined) {
                continue;
            }
            const size = sizesRef.current[item.node.id]
                ?? { width: BOARD_DEFAULT_WIDTH, height: BOARD_DEFAULT_HEIGHT };
            out[item.node.id] = { ...point, ...size };
        }
        return out;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [flat, positions, sizeVersion]);

    const lines = useMemo(() => (board ? connectors(flat, rects) : []), [board, flat, rects]);
    const extent = useMemo(() => boardExtent(Object.values(rects)), [rects]);

    const onNodeUi = props.onNodeUi;
    const onNodeUiRef = useRef(onNodeUi);
    onNodeUiRef.current = onNodeUi;

    /*
     * 자동으로 정한 자리를 서버에 저장한다.
     *
     * 저장해 두어야 보드에 다시 들어왔을 때, 그리고 서버를 다시 띄웠을 때 같은
     * 자리에 있다. 크기를 한 번이라도 잰 뒤에 보낸다 — 재기 전 기본 크기로 잡은
     * 자리는 겹쳐 있을 수 있다.
     */
    const persistedRef = useRef(new Set<string>());
    useEffect(() => {
        if (!board) {
            persistedRef.current.clear();
            return;
        }
        if (sizeVersion === 0) {
            return;
        }
        for (const item of flat) {
            const id = item.node.id;
            const stored = trail.nodeUi[id];
            if (stored?.boardX !== undefined && stored?.boardY !== undefined) {
                continue;
            }
            if (persistedRef.current.has(id)) {
                continue;
            }
            const point = autoPositions[id];
            if (point === undefined) {
                continue;
            }
            persistedRef.current.add(id);
            onNodeUiRef.current(id, {
                boardX: Math.round(point.x),
                boardY: Math.round(point.y),
            });
        }
    }, [board, flat, trail.nodeUi, autoPositions, sizeVersion]);

    /** 저장이 돌아오면 임시 좌표를 놓는다. 미리 놓으면 한 번 튄다. */
    useEffect(() => {
        if (dragPoint === null || dragRef.current !== null) {
            return;
        }
        const stored = trail.nodeUi[dragPoint.id];
        if (stored?.boardX === Math.round(dragPoint.x)
            && stored?.boardY === Math.round(dragPoint.y)) {
            setDragPoint(null);
        }
    }, [dragPoint, trail.nodeUi]);

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (!board || event.button !== 0) {
            return;
        }
        const target = event.target as HTMLElement;
        if (target.closest('button') !== null || target.closest('.clickable') !== null) {
            return;
        }
        const hd = target.closest('.hd') as HTMLElement | null;
        if (hd === null) {
            return;
        }
        const box = hd.closest('.node') as HTMLElement | null;
        const id = box?.dataset['id'];
        if (box === null || box === undefined || id === undefined) {
            return;
        }
        dragRef.current = {
            id,
            pointerId: event.pointerId,
            dx: event.clientX - box.offsetLeft,
            dy: event.clientY - box.offsetTop,
            hd,
            box,
            moved: false,
        };
        box.classList.add('dragging');
        hd.setPointerCapture(event.pointerId);
    }, [board]);

    const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (drag === null) {
            return;
        }
        drag.moved = true;
        setDragPoint({
            id: drag.id,
            x: Math.max(0, event.clientX - drag.dx),
            y: Math.max(0, event.clientY - drag.dy),
        });
    }, []);

    const endDrag = useCallback(() => {
        const drag = dragRef.current;
        if (drag === null) {
            return;
        }
        dragRef.current = null;
        drag.box.classList.remove('dragging');
        try {
            drag.hd.releasePointerCapture(drag.pointerId);
        } catch {
            // 이미 놓였다.
        }
        const point = dragPointRef.current;
        if (drag.moved && point !== null && point.id === drag.id) {
            onNodeUiRef.current(drag.id, {
                boardX: Math.round(point.x),
                boardY: Math.round(point.y),
            });
        } else {
            setDragPoint(null);
        }
        suppressClickRef.current = drag.moved;
        window.setTimeout(() => {
            suppressClickRef.current = false;
        }, 0);
    }, []);

    // ── 노드별 손조절 ───────────────────────────────────────────────────────

    /** Ctrl+휠 = 그 노드의 코드 글자 크기만 조절. 다른 노드는 그대로 둔다. */
    useEffect(() => {
        const host = rootRef.current;
        if (host === null) {
            return undefined;
        }
        const onWheel = (event: WheelEvent): void => {
            if (!event.ctrlKey) {
                return;
            }
            const target = event.target as HTMLElement | null;
            const code = target?.closest('.code') as HTMLElement | null;
            const box = code?.closest('.node') as HTMLElement | null;
            const id = box?.dataset['id'];
            if (code === null || code === undefined || id === undefined) {
                return;
            }
            event.preventDefault();
            const current = Number.parseFloat(code.style.fontSize)
                || Number.parseFloat(getComputedStyle(code).fontSize)
                || BASE_CODE_FONT_SIZE;
            const step = event.deltaY < 0 ? 1 : -1;
            const next = Math.max(6, Math.min(40, Math.round(current) + step));
            onNodeUiRef.current(id, { codeFontSize: next });
        };
        // preventDefault 를 해야 브라우저 확대가 끼어들지 않는다.
        host.addEventListener('wheel', onWheel, { passive: false });
        return () => host.removeEventListener('wheel', onWheel);
    }, []);

    /** 줄 번호 칸 더블클릭 = 그 노드에 손댄 높이·글자 크기를 원래대로. */
    const onDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        const gutter = target.closest('.cl > .no');
        const box = gutter?.closest('.node') as HTMLElement | null;
        const id = box?.dataset['id'];
        if (id === undefined) {
            return;
        }
        onNodeUiRef.current(id, { bodyHeight: null, codeFontSize: null });
    }, []);

    useFitToWidth(
        rootRef,
        { fontSize: props.fontSize, fitToWidth: props.fitToWidth, minFontSize: props.minFontSize },
        `${trail.mode}:${flat.length}:${sizeVersion}`,
    );

    /**
     * 진입 링크를 누르면 부모의 그 호출 지점으로 간다.
     *
     * 부모 노드를 활성으로 만들고 화면에 보이게 한다. 호출부에는 이미 ①이
     * 붙어 있어서, 활성 표시와 순번이 함께 어디를 봐야 할지 알려준다.
     */
    const onFocusNode = props.onFocusNode;
    const jumpToOrigin = useCallback((node: TrailNodeView) => {
        if (node.parentId === null) {
            return;
        }
        onFocusNode(node.parentId);
        const selector = `[data-id="${node.parentId}"] [data-l="${node.origin?.line}"][data-c="${node.origin?.char}"]`;
        const target = document.querySelector(selector);
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [onFocusNode]);

    const onToggle = props.onToggle;
    const toggleNode = useCallback((node: TrailNodeView) => {
        if (suppressClickRef.current) {
            return;
        }
        onToggle(node);
    }, [onToggle]);

    const nodeCount = flat.length;

    const shared = {
        activeNodeId: trail.activeNodeId,
        busyNodeIds: props.busyNodeIds,
        clickTarget: props.clickTarget,
        maxCodeLines: props.maxCodeLines,
        implementationSupported: props.implementationSupported,
        childOrder,
        visibleIds,
        positions,
        nodeUi: trail.nodeUi as Readonly<Record<string, NodeUiView>>,
        onToggle: toggleNode,
        onRemove: props.onRemove,
        onPromote: props.onPromote,
        onImplementations: props.onImplementations,
        onOpenInEditor: props.onOpenInEditor,
        onJumpToOrigin: jumpToOrigin,
        onIdentifierClick: props.onIdentifierClick,
        onNodeUi,
    };

    return (
        <div className="trail">
            <div className="toolbar" id="toolbar">
                <button type="button" onClick={() => props.onToggleAll(false)}>⤢ 전체 펼치기</button>
                <button type="button" onClick={() => props.onToggleAll(true)}>⤡ 전체 접기</button>
                <button
                    type="button"
                    onClick={() => setChildOrder(childOrder === 'source' ? 'click' : 'source')}
                    title="같은 부모 아래 형제 노드의 정렬 순서"
                >
                    {childOrder === 'source' ? '⇅ 코드 순서' : '⇅ 클릭 순서'}
                </button>
                <span className="sep" />
                <button
                    type="button"
                    id="board-toggle"
                    onClick={() => props.onSetMode(board ? 'tree' : 'board')}
                    title={board
                        ? '트리 모드로 — 부모 위, 자식 아래로 되돌린다'
                        : '보드 모드로 — 노드를 캔버스에 자유롭게 늘어놓고 헤더를 끌어 옮긴다'}
                >
                    {board ? '▤ 트리' : '⬚ 보드'}
                </button>
                <span className="sep" />
                <input
                    id="filter"
                    type="search"
                    value={filter}
                    placeholder="이름/경로 필터…"
                    aria-label="이름/경로 필터"
                    onChange={(event) => setFilter(event.target.value)}
                />
                <span className="sep" />
                <button type="button" onClick={props.onExportMarkdown}>Markdown</button>
                <button type="button" className="danger" onClick={props.onClear}>지우기</button>
                <span className="spacer" />
                <span className="muted">{`노드 ${nodeCount}`}</span>
            </div>

            <div className="breadcrumb" id="breadcrumb">
                {breadcrumb.length === 0 ? (
                    <span className="muted">노드를 고르면 여기에 경로가 나온다.</span>
                ) : breadcrumb.map((node, index) => (
                    <span key={node.id}>
                        {index > 0 ? <span className="crumb-sep">›</span> : null}
                        <button
                            type="button"
                            className="crumb"
                            onClick={() => props.onFocusNode(node.id)}
                        >
                            {splitName(node.symbol).name}
                        </button>
                    </span>
                ))}
            </div>

            {props.choice !== null ? (
                <div className="choice" role="dialog" aria-label="정의 후보">
                    <p>
                        정의 후보가 여러 개다. 어느 것이 실제로 도는지는 호출부만으로 알 수
                        없으니 직접 고른다.
                    </p>
                    <ul>
                        {props.choice.candidates.map((candidate) => (
                            <li key={candidate.candidateId}>
                                <button
                                    type="button"
                                    onClick={() => props.onChooseCandidate(
                                        (props.choice as DefinitionChoice).choiceId,
                                        candidate.candidateId,
                                    )}
                                >
                                    <span className="cand-name">{candidate.name}</span>
                                    <span className="cand-path">
                                        {`${candidate.displayPath}:${candidate.line + 1}`}
                                    </span>
                                    {candidate.hasBody ? null : (
                                        <span className="badge decl">선언만</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button type="button" className="danger" onClick={props.onDismissChoice}>
                        취소
                    </button>
                </div>
            ) : null}

            <div
                className={board ? 'tree board' : 'tree'}
                id="root"
                ref={rootRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={onDoubleClick}
            >
                {board && trail.roots.length > 0 ? (
                    <svg
                        className="board-lines"
                        width={extent.width}
                        height={extent.height}
                        aria-hidden="true"
                    >
                        {lines.map((line) => <path key={line.id} d={line.d} />)}
                    </svg>
                ) : null}

                {trail.roots.length === 0 ? (
                    <div className="placeholder">
                        <p>아직 노드가 없다.</p>
                        <p className="muted">
                            코드 화면에서 함수 위를 누르고 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>
                            를 누르면 여기에 펼쳐진다.
                        </p>
                    </div>
                ) : board ? flat.map((item) => (
                    <TrailNode
                        {...shared}
                        key={item.node.id}
                        node={item.node}
                        ordinal={item.ordinal}
                        depth={item.depth}
                        parentName={item.parentName}
                        layout="board"
                    />
                )) : trail.roots.map((root) => (
                    <TrailNode
                        {...shared}
                        key={root.id}
                        node={root}
                        ordinal={0}
                        depth={0}
                        parentName=""
                        layout="tree"
                    />
                ))}
            </div>
        </div>
    );
}
