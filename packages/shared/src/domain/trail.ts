import { newNodeId, newTrailId } from './ids.js';
import type { ResolvedSymbol } from './symbol.js';
import { symbolKey } from './symbol.js';

/** 부모 본문에서 클릭했던 그 지점. */
export interface TrailOrigin {
    /** 부모 코드에서 클릭된 줄 (0-based, 원본 파일 기준). */
    line: number;
    /** 클릭된 컬럼 (0-based, UTF-16 코드 단위). */
    char: number;
    /** 클릭된 식별자 텍스트. */
    text: string;
}

/** 심볼 하나가 차지하는 덩어리. */
export interface TrailNode {
    id: string;
    parentId: string | null;
    symbol: ResolvedSymbol;
    origin: TrailOrigin | null;
    collapsed: boolean;
    /** 조상 중에 같은 심볼이 이미 있으면 true (재귀·순환). */
    recursive: boolean;
    children: TrailNode[];
}

/**
 * 노드별 화면 상태. 트리 구조와 무관하다.
 *
 * 확장에서는 패널이 열려 있는 동안만 살아 있던 값들이다. 이제 트레일과 함께
 * 저장하므로 서버를 다시 띄워도 배치와 크기가 남는다.
 */
export interface NodeUiState {
    /** 보드 모드에서 캔버스 기준 x 좌표(px). */
    boardX?: number;
    /** 보드 모드에서 캔버스 기준 y 좌표(px). */
    boardY?: number;
    /** 사용자가 모서리를 끌어 정한 본문 높이(px). */
    bodyHeight?: number;
    /** 사용자가 Ctrl+휠로 정한 코드 글자 크기(px). 폭 맞춤이 건드리지 않는다. */
    codeFontSize?: number;
}

export const NODE_UI_KEYS = ['boardX', 'boardY', 'bodyHeight', 'codeFontSize'] as const;

export type TrailMode = 'tree' | 'board';

/** 같은 부모 아래 형제 노드를 늘어놓는 순서. `null` 이면 설정 기본값을 따른다. */
export type ChildOrder = 'source' | 'click';

/**
 * 트리에서 떼어낸 서브트리.
 *
 * 되돌리기(`trail.undoRemove`)가 원래 자리에 그대로 되살리려면 노드만으로는
 * 모자란다. 어느 부모의 몇 번째였는지와 그 노드들이 갖고 있던 화면 상태까지
 * 함께 들고 있어야 순번·진입 링크·보드 좌표가 그대로 돌아온다.
 */
export interface RemovedSubtree {
    /** 떼어낸 최상위 노드. 자식이 그대로 달려 있다. */
    root: TrailNode;
    parentId: string | null;
    /** 부모(루트면 `roots`) 안에서의 형제 인덱스. */
    index: number;
    nodeUi: Record<string, NodeUiState>;
    /** 떼어낸 노드 수. 루트를 포함한다. */
    count: number;
}

/**
 * `⇱` 로 새 루트가 된 노드가 원래 있던 자리 (V10).
 *
 * 승격은 부모 관계를 바꾸는 유일한 동작이다. 되돌리려면 어느 부모의 몇 번째에
 * 어떤 진입 링크로 달려 있었는지가 그 순간에만 남아 있으므로 함께 들고 있는다.
 */
export interface PromotedNode {
    /** 승격된 노드. 자식이 그대로 달려 있다. */
    node: TrailNode;
    /** 승격 전 부모. 루트였던 노드는 승격되지 않으므로 `null` 이 아니다. */
    previousParentId: string;
    /** 부모 안에서의 형제 인덱스. */
    index: number;
    /** 지워진 진입 링크. */
    origin: TrailOrigin | null;
    /** 승격 전 재귀 표시. */
    recursiveBefore: boolean;
}

export interface TrailInit {
    id?: string;
    title?: string;
    createdAt?: string;
    /** 시각 공급자. 테스트에서 결정적인 값을 넣기 위해 주입 가능하게 뒀다. */
    now?: () => string;
}

function defaultNow(): string {
    return new Date().toISOString();
}

/**
 * 패널에 담긴 탐색 트리 전체. 저장·불러오기·Markdown 내보내기의 단위다.
 *
 * 정본은 서버 메모리에 있고 브라우저는 복사본만 그린다(구현서 14.1). 그래서
 * 모든 변경은 `revision` 을 하나 올리고, 명령은 자기가 본 `baseRevision` 을 함께
 * 보낸다. 실제로 아무것도 바뀌지 않은 호출은 revision 을 올리지 않는다 —
 * 그래야 "바뀐 게 없는데 다른 탭이 다시 그리는" 일이 없다.
 */
export class Trail {
    readonly id: string;
    title: string;
    readonly createdAt: string;
    updatedAt: string;
    mode: TrailMode = 'tree';
    /**
     * 이 트레일에서 고른 형제 정렬. `null` 이면 `settings.ui.childOrder` 를 따른다.
     * 트리 모양을 바꾸지 않는 화면 상태다 — revision 을 올리지 않는다.
     */
    childOrder: ChildOrder | null = null;
    activeNodeId: string | null = null;
    roots: TrailNode[] = [];

    private revisionValue = 0;
    private readonly index = new Map<string, TrailNode>();
    private readonly ui = new Map<string, NodeUiState>();
    private readonly now: () => string;

    constructor(init: TrailInit = {}) {
        this.now = init.now ?? defaultNow;
        this.id = init.id ?? newTrailId();
        this.title = init.title ?? '새 트레일';
        this.createdAt = init.createdAt ?? this.now();
        this.updatedAt = this.createdAt;
    }

    get revision(): number {
        return this.revisionValue;
    }

    get isEmpty(): boolean {
        return this.roots.length === 0;
    }

    /** 트리에 달린 노드 수. 루트를 포함한 전체다. */
    get size(): number {
        return this.index.size;
    }

    get(id: string): TrailNode | undefined {
        return this.index.get(id);
    }

    /** 노드 하나의 화면 상태. 없으면 `undefined`. */
    getNodeUi(id: string): NodeUiState | undefined {
        return this.ui.get(id);
    }

    /**
     * 화면 상태가 있는 노드 전체. 저장할 때 쓴다.
     *
     * 노드 ID 로 정렬해 돌려준다. `Map` 의 삽입 순서를 그대로 쓰면 사용자가 어떤
     * 노드를 먼저 옮겼는지에 따라 저장 파일이 달라지고, 불러온 트레일과 원본
     * 트레일이 같은 내용인데도 다른 순서를 갖는다.
     */
    nodeUiEntries(): Array<[string, NodeUiState]> {
        return [...this.ui.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    }

    // ── 구조 변경 ────────────────────────────────────────────────────────

    addRoot(symbol: ResolvedSymbol): TrailNode {
        const node: TrailNode = {
            id: newNodeId(),
            parentId: null,
            symbol,
            origin: null,
            collapsed: false,
            recursive: false,
            children: [],
        };
        this.roots.push(node);
        this.index.set(node.id, node);
        this.touch();
        return node;
    }

    /**
     * 부모 아래에 자식을 붙인다.
     *
     * 부모는 "클릭한 코드가 어느 노드에 속했는가" 로만 정해진다. A 안에서 B, C 를
     * 클릭하면 둘 다 A 의 형제 자식이다. 이 규칙을 여기서 깨지 않는다.
     */
    addChild(parentId: string, symbol: ResolvedSymbol, origin: TrailOrigin): TrailNode | undefined {
        const parent = this.index.get(parentId);
        if (!parent) {
            return undefined;
        }
        const node: TrailNode = {
            id: newNodeId(),
            parentId,
            symbol,
            origin,
            collapsed: false,
            recursive: this.isAncestorSymbol(parent, symbol),
            children: [],
        };
        parent.children.push(node);
        this.index.set(node.id, node);
        this.touch();
        return node;
    }

    /** 같은 부모 아래에 같은 대상이 이미 있으면 그 노드를 돌려준다. */
    findExistingChild(parentId: string, symbol: ResolvedSymbol): TrailNode | undefined {
        const parent = this.index.get(parentId);
        if (!parent) {
            return undefined;
        }
        const key = symbolKey(symbol);
        return parent.children.find((c) => symbolKey(c.symbol) === key);
    }

    /**
     * 노드와 하위 노드를 떼어낸다.
     *
     * 떼어낸 것을 그대로 돌려준다. 되돌리기가 원래 자리·원래 ID·원래 화면
     * 상태로 되살릴 수 있어야 하고, 그 정보는 떼어내는 이 순간에만 있다.
     */
    remove(id: string): RemovedSubtree | undefined {
        const node = this.index.get(id);
        if (!node) {
            return undefined;
        }
        const siblings = node.parentId ? this.index.get(node.parentId)?.children : this.roots;
        let index = -1;
        if (siblings) {
            index = siblings.indexOf(node);
            if (index >= 0) {
                siblings.splice(index, 1);
            }
        }
        const nodeUi: Record<string, NodeUiState> = {};
        let count = 0;
        const drop = (n: TrailNode): void => {
            count += 1;
            const state = this.ui.get(n.id);
            if (state) {
                nodeUi[n.id] = { ...state };
            }
            this.index.delete(n.id);
            this.ui.delete(n.id);
            if (this.activeNodeId === n.id) {
                this.activeNodeId = null;
            }
            n.children.forEach(drop);
        };
        drop(node);
        this.touch();
        return {
            root: node,
            parentId: node.parentId,
            index: index < 0 ? 0 : index,
            nodeUi,
            count,
        };
    }

    /**
     * 떼어냈던 서브트리를 원래 자리에 되돌린다 (`trail.undoRemove`).
     *
     * 같은 ID 로 되살린다. 노드 ID 는 화면 상태와 분석 기록 대상의 키라서
     * 새로 매기면 배지와 보드 좌표가 끊긴다. 부모가 그새 사라졌으면 되돌릴
     * 자리가 없다는 뜻이므로 `undefined` 를 준다.
     */
    insertSubtree(
        parentId: string | null,
        root: TrailNode,
        index: number,
        nodeUi: Record<string, NodeUiState> = {},
    ): TrailNode | undefined {
        if (this.index.has(root.id)) {
            return undefined;
        }
        const siblings = parentId === null ? this.roots : this.index.get(parentId)?.children;
        if (!siblings) {
            return undefined;
        }
        const link = (n: TrailNode, parent: string | null): void => {
            n.parentId = parent;
            this.index.set(n.id, n);
            n.children.forEach((child) => link(child, n.id));
        };
        link(root, parentId);
        siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, root);

        for (const [nodeId, state] of Object.entries(nodeUi)) {
            if (this.index.has(nodeId)) {
                this.ui.set(nodeId, { ...state });
            }
        }
        // 조상 사슬은 떼어내기 전과 같으므로 재귀 표시도 같다. 그래도 다시 센다 —
        // 저장값을 믿지 않는 `fromStructure` 와 같은 규칙이다.
        const parent = parentId === null ? undefined : this.index.get(parentId);
        root.recursive = parent === undefined
            ? false
            : this.isAncestorSymbol(parent, root.symbol);
        this.recomputeRecursive(root);
        this.touch();
        return root;
    }

    /**
     * 노드가 감싼 심볼만 새 것으로 바꾼다 (`trail.refreshNode`).
     *
     * 자식·진입 링크·접힘 상태는 그대로 둔다. 파일이 바뀌어 본문을 다시 읽은
     * 것이지 다른 심볼로 간 것이 아니다. 조상 사슬은 그대로지만 심볼 키가
     * 달라질 수 있으므로 재귀 표시는 다시 센다.
     */
    replaceSymbol(id: string, symbol: ResolvedSymbol): TrailNode | undefined {
        const node = this.index.get(id);
        if (!node) {
            return undefined;
        }
        node.symbol = symbol;
        const parent = node.parentId === null ? undefined : this.index.get(node.parentId);
        node.recursive = parent === undefined ? false : this.isAncestorSymbol(parent, symbol);
        this.recomputeRecursive(node);
        this.touch();
        return node;
    }

    /**
     * 자식 노드를 트리 맨 위로 떼어내 독립된 루트로 만든다. 하위 노드는 함께 따라간다.
     *
     * 부모 관계를 바꾸는 유일한 동작이다. 부모에서 왔다는 사실이 더 이상 유효하지
     * 않으므로 진입 링크를 지우고, 조상 사슬이 달라졌으니 하위 노드의 재귀 표시를
     * 새 사슬 기준으로 다시 계산한다.
     */
    promoteToRoot(id: string): PromotedNode | undefined {
        const node = this.index.get(id);
        if (!node || node.parentId === null) {
            return undefined;
        }
        const previousParentId = node.parentId;
        const origin = node.origin;
        const recursiveBefore = node.recursive;
        const parent = this.index.get(previousParentId);
        let index = 0;
        if (parent) {
            const i = parent.children.indexOf(node);
            if (i >= 0) {
                index = i;
                parent.children.splice(i, 1);
            }
        }
        node.parentId = null;
        node.origin = null;
        node.recursive = false;
        this.roots.push(node);
        this.recomputeRecursive(node);
        this.touch();
        return { node, previousParentId, index, origin, recursiveBefore };
    }

    /**
     * 승격을 되돌려 원래 부모의 원래 자리에 다시 단다 (V10).
     *
     * 되돌리기 버퍼는 한 단계다. 그 사이에 다른 구조 명령이 들어오면 원래 자리가
     * 더 이상 그 자리가 아니라서 `TrailService.mutate` 가 버퍼를 비운다. 여기서는
     * 부모가 아직 있고 노드가 아직 루트인지만 확인한다.
     */
    undoPromote(record: PromotedNode): boolean {
        const node = this.index.get(record.node.id);
        const parent = this.index.get(record.previousParentId);
        if (!node || !parent || node.parentId !== null) {
            return false;
        }
        const at = this.roots.indexOf(node);
        if (at < 0) {
            return false;
        }
        this.roots.splice(at, 1);
        node.parentId = parent.id;
        node.origin = record.origin;
        parent.children.splice(
            Math.max(0, Math.min(record.index, parent.children.length)),
            0,
            node,
        );
        // 조상 사슬이 되돌아왔으므로 재귀 표시도 다시 센다. 저장값을 믿지 않는다.
        node.recursive = this.isAncestorSymbol(parent, node.symbol);
        this.recomputeRecursive(node);
        this.touch();
        return true;
    }

    clear(): boolean {
        if (this.roots.length === 0 && this.ui.size === 0 && this.activeNodeId === null) {
            return false;
        }
        this.roots = [];
        this.index.clear();
        this.ui.clear();
        this.activeNodeId = null;
        this.touch();
        return true;
    }

    // ── 화면 상태 ────────────────────────────────────────────────────────

    setCollapsed(id: string, collapsed: boolean): boolean {
        const node = this.index.get(id);
        if (!node || node.collapsed === collapsed) {
            return false;
        }
        node.collapsed = collapsed;
        // 화면 상태다. 접었다고 남의 구조 명령이 거절되면 안 된다.
        this.touch(false);
        return true;
    }

    setMode(mode: TrailMode): boolean {
        if (this.mode === mode) {
            return false;
        }
        this.mode = mode;
        this.touch(false);
        return true;
    }

    /** 형제 정렬. 접기와 같은 화면 상태라 revision 을 올리지 않는다. */
    setChildOrder(order: ChildOrder | null): boolean {
        if (this.childOrder === order) {
            return false;
        }
        this.childOrder = order;
        this.touch(false);
        return true;
    }

    setActiveNode(id: string | null): boolean {
        if (id !== null && !this.index.has(id)) {
            return false;
        }
        if (this.activeNodeId === id) {
            return false;
        }
        this.activeNodeId = id;
        this.touch(false);
        return true;
    }

    setTitle(title: string): boolean {
        if (this.title === title) {
            return false;
        }
        this.title = title;
        this.touch();
        return true;
    }

    /**
     * 노드 화면 상태를 덮어쓴다. 준 키만 바뀌고 나머지는 남는다.
     * 값에 `null` 을 주면 그 키를 지운다 — "이 노드만 크게" 를 되돌리는 동작이다.
     */
    setNodeUi(id: string, patch: Partial<Record<keyof NodeUiState, number | null>>): boolean {
        if (!this.index.has(id)) {
            return false;
        }
        const next: NodeUiState = { ...(this.ui.get(id) ?? {}) };
        let changed = false;
        for (const key of NODE_UI_KEYS) {
            if (!(key in patch)) {
                continue;
            }
            const value = patch[key];
            if (value === null || value === undefined) {
                if (key in next) {
                    delete next[key];
                    changed = true;
                }
            } else if (next[key] !== value) {
                next[key] = value;
                changed = true;
            }
        }
        if (!changed) {
            return false;
        }
        if (Object.keys(next).length === 0) {
            this.ui.delete(id);
        } else {
            this.ui.set(id, next);
        }
        this.touch(false);
        return true;
    }

    /**
     * 보드에서 손으로 옮긴 자리를 모두 지운다 (V11).
     *
     * 좌표만 지운다 — 본문 높이와 코드 글자 크기는 보드 배치와 상관없는 값이다.
     * 화면 상태이므로 revision 을 올리지 않는다.
     */
    resetBoardLayout(): number {
        let cleared = 0;
        for (const [id, state] of [...this.ui]) {
            if (state.boardX === undefined && state.boardY === undefined) {
                continue;
            }
            cleared += 1;
            const next: NodeUiState = { ...state };
            delete next.boardX;
            delete next.boardY;
            if (Object.keys(next).length === 0) {
                this.ui.delete(id);
            } else {
                this.ui.set(id, next);
            }
        }
        if (cleared > 0) {
            this.touch(false);
        }
        return cleared;
    }

    /** 보드에서 손으로 옮긴 노드 수. 초기화 확인 문구가 쓴다. */
    placedNodeCount(): number {
        let count = 0;
        for (const state of this.ui.values()) {
            if (state.boardX !== undefined || state.boardY !== undefined) {
                count += 1;
            }
        }
        return count;
    }

    // ── 조회 ──────────────────────────────────────────────────────────────

    /** 루트부터 이 노드까지의 사슬. 브레드크럼이 쓴다. */
    ancestorsOf(id: string): TrailNode[] {
        const chain: TrailNode[] = [];
        let cur = this.index.get(id);
        while (cur) {
            chain.unshift(cur);
            cur = cur.parentId ? this.index.get(cur.parentId) : undefined;
        }
        return chain;
    }

    /** 트리 순회 순서(부모 → 자식)로 전체 노드. */
    walk(): TrailNode[] {
        const out: TrailNode[] = [];
        const visit = (n: TrailNode): void => {
            out.push(n);
            n.children.forEach(visit);
        };
        this.roots.forEach(visit);
        return out;
    }

    // ── 내부 ──────────────────────────────────────────────────────────────

    private isAncestorSymbol(from: TrailNode, symbol: ResolvedSymbol): boolean {
        const key = symbolKey(symbol);
        let cur: TrailNode | undefined = from;
        while (cur) {
            if (symbolKey(cur.symbol) === key) {
                return true;
            }
            cur = cur.parentId ? this.index.get(cur.parentId) : undefined;
        }
        return false;
    }

    private recomputeRecursive(from: TrailNode): void {
        const walk = (n: TrailNode): void => {
            for (const c of n.children) {
                c.recursive = this.isAncestorSymbol(n, c.symbol);
                walk(c);
            }
        };
        walk(from);
    }

    /**
     * 바뀌었다고 표시한다.
     *
     * `structural` 이 참일 때만 revision 이 오른다. revision 은 "내가 본 트리가
     * 아직 그대로인가" 를 재는 값이고, 구조 명령이 그것을 근거로 거절된다.
     * 배치·크기·활성 노드 같은 화면 상태까지 revision 을 올리면, 노드를 하나
     * 클릭해 활성으로 만드는 것만으로 그 순간 날아가던 정의 요청이 거절된다.
     *
     * 화면 상태도 저장은 해야 하므로 `updatedAt` 은 양쪽 다 갱신한다.
     */
    private touch(structural = true): void {
        if (structural) {
            this.revisionValue += 1;
        }
        this.updatedAt = this.now();
    }

    /**
     * 저장 파일에서 읽은 트리를 그대로 받아 세운다.
     *
     * 저장된 노드 ID 를 유지한다. 확장의 `loadJSON` 은 불러올 때마다 번호를 새로
     * 매겼지만, 이제 노드 ID 가 화면 상태(`nodeUi`)의 키라서 바꾸면 배치가 끊긴다.
     */
    static fromStructure(args: {
        id: string;
        title: string;
        createdAt: string;
        updatedAt: string;
        revision: number;
        mode: TrailMode;
        childOrder?: ChildOrder | null;
        activeNodeId: string | null;
        roots: TrailNode[];
        nodeUi: Record<string, NodeUiState>;
        now?: () => string;
    }): Trail {
        const trail = new Trail({
            id: args.id,
            title: args.title,
            createdAt: args.createdAt,
            ...(args.now ? { now: args.now } : {}),
        });
        trail.updatedAt = args.updatedAt;
        trail.revisionValue = args.revision;
        trail.mode = args.mode;
        trail.childOrder = args.childOrder ?? null;
        trail.roots = args.roots;

        const link = (n: TrailNode, parentId: string | null): void => {
            n.parentId = parentId;
            n.children = n.children ?? [];
            trail.index.set(n.id, n);
            n.children.forEach((c) => link(c, n.id));
        };
        trail.roots.forEach((r) => link(r, null));

        // 재귀 표시는 저장값을 믿지 않고 조상 사슬로 다시 계산한다.
        // 손으로 고친 파일에서도 트리 불변식이 유지된다.
        for (const root of trail.roots) {
            root.recursive = false;
            trail.recomputeRecursive(root);
        }

        for (const [nodeId, state] of Object.entries(args.nodeUi)) {
            if (trail.index.has(nodeId)) {
                trail.ui.set(nodeId, { ...state });
            }
        }

        trail.activeNodeId =
            args.activeNodeId !== null && trail.index.has(args.activeNodeId)
                ? args.activeNodeId
                : null;

        return trail;
    }
}
