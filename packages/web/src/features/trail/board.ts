import type { NodeUiView, TrailNodeView } from './types.js';

/**
 * 보드 배치 계산 (구현서 16.4).
 *
 * **부모-자식은 모델에만 있다.** 보드 모드에서는 노드가 `#root` 바로 아래에
 * 평평하게 놓이므로 DOM 을 훑어서는 누가 누구의 자식인지 알 수 없다. 그래서
 * 여기 있는 함수는 전부 `TrailNodeView.children` 만 보고 계산한다.
 *
 * 화면을 그리지 않는 순수 함수만 둔다. 크기는 밖에서 재서 넘긴다 —
 * 그래야 브라우저 없이 단위 테스트로 배치 규칙을 확인할 수 있다.
 */

/** 열 사이 간격. 확장의 값을 그대로 옮겼다. */
export const BOARD_GAP_X = 90;
/** 같은 열에서 위아래 간격. */
export const BOARD_GAP_Y = 26;
/** 캔버스 가장자리 여백. */
export const BOARD_EDGE = 14;
/** 크기를 아직 못 잰 노드에 쓰는 기본 폭. `--ct-board-width` 와 같은 값이다. */
export const BOARD_DEFAULT_WIDTH = 520;
/** 크기를 아직 못 잰 노드에 쓰는 기본 높이. */
export const BOARD_DEFAULT_HEIGHT = 180;
/** 연결선이 헤더 줄에 닿도록 내리는 양. */
const BOARD_ANCHOR_Y = 16;
/** 이 정도 안에 겹치면 같은 자리로 본다. */
const BOARD_OVERLAP = 40;

export interface BoardPoint {
    x: number;
    y: number;
}

export interface BoardSize {
    width: number;
    height: number;
}

export type BoardRect = BoardPoint & BoardSize;

/** 트리를 편 결과 한 줄. 트리 모드의 재귀 렌더링이 주던 값을 미리 계산해 둔다. */
export interface FlatNode {
    node: TrailNodeView;
    depth: number;
    /** 형제 중 몇 번째(1-based). 0 이면 루트다. 부모 호출부의 ①과 짝이 된다. */
    ordinal: number;
    /** 진입 링크에 찍는 부모 이름. 루트면 빈 문자열. */
    parentName: string;
}

export type ChildOrder = 'source' | 'click';

/**
 * 형제 정렬.
 *
 * `source` 는 부모 코드에 나온 순서(= 호출 순서), `click` 은 내가 클릭한 순서다.
 * 클릭 순서는 서버가 붙인 순서 그대로라 정렬하지 않는다.
 */
export function sortChildren(
    children: readonly TrailNodeView[],
    order: ChildOrder,
): TrailNodeView[] {
    if (order === 'click') {
        return [...children];
    }
    return [...children].sort((a, b) => {
        const al = a.origin?.line ?? 0;
        const bl = b.origin?.line ?? 0;
        if (al !== bl) {
            return al - bl;
        }
        return (a.origin?.char ?? 0) - (b.origin?.char ?? 0);
    });
}

/** 헤더에 찍는 이름. `splitName` 과 같은 규칙이지만 여기서는 이름만 쓴다. */
function headerName(node: TrailNodeView): string {
    const raw = node.symbol.name;
    const cut = raw.indexOf('(');
    return cut > 0 ? raw.slice(0, cut).trim() : raw;
}

/**
 * 모델을 깊이 우선으로 편다.
 *
 * 보드 모드가 그릴 목록이자, 배치 계산의 입력이다. 부모가 항상 자식보다 앞에
 * 온다 — 자식 자리를 부모 자리 기준으로 잡으려면 이 순서여야 한다.
 */
export function flattenTree(
    roots: readonly TrailNodeView[],
    order: ChildOrder,
): FlatNode[] {
    const out: FlatNode[] = [];
    const walk = (
        nodes: readonly TrailNodeView[],
        depth: number,
        parentName: string,
    ): void => {
        const sorted = depth === 0 ? [...nodes] : sortChildren(nodes, order);
        sorted.forEach((node, index) => {
            out.push({
                node,
                depth,
                ordinal: depth === 0 ? 0 : index + 1,
                parentName,
            });
            walk(sortChildren(node.children, order), depth + 1, headerName(node));
        });
    };
    walk(roots, 0, '');
    return out;
}

function sizeOf(
    id: string,
    sizes: Readonly<Record<string, BoardSize>>,
): BoardSize {
    const measured = sizes[id];
    if (measured === undefined || measured.width <= 0 || measured.height <= 0) {
        return { width: BOARD_DEFAULT_WIDTH, height: BOARD_DEFAULT_HEIGHT };
    }
    return measured;
}

/** 저장된 좌표. 둘 다 있어야 쓴다 — 하나만 있으면 자리를 정한 것이 아니다. */
function storedPoint(ui: NodeUiView | undefined): BoardPoint | null {
    if (ui === undefined || ui.boardX === undefined || ui.boardY === undefined) {
        return null;
    }
    return { x: ui.boardX, y: ui.boardY };
}

/**
 * 부모 오른쪽 빈자리를 찾는다.
 *
 * 그 자리에 이미 뭔가 있으면 아래로 민다. 새로 붙은 자식이 부모 근처에 나타나야
 * 어디서 갈라진 것인지 눈으로 따라갈 수 있다.
 */
export function placeNear(
    parent: BoardRect,
    taken: readonly BoardRect[],
): BoardPoint {
    const x = parent.x + parent.width + BOARD_GAP_X;
    let y = parent.y;
    let moved = true;
    let guard = 0;
    while (moved && guard < 200) {
        moved = false;
        guard += 1;
        for (const other of taken) {
            if (Math.abs(other.x - x) < BOARD_OVERLAP
                && Math.abs(other.y - y) < BOARD_OVERLAP) {
                y = other.y + other.height + BOARD_GAP_Y;
                moved = true;
            }
        }
    }
    return { x: Math.max(0, x), y: Math.max(0, y) };
}

/**
 * 모든 노드의 자리를 정한다.
 *
 * 1. 저장된 좌표가 있으면 그대로 쓴다. 사용자가 끌어다 놓은 자리다.
 * 2. 부모 자리를 아는 자식은 부모 오른쪽에 놓는다.
 * 3. 루트는 왼쪽 열에 위에서 아래로 쌓는다.
 */
export function autoPlace(
    flat: readonly FlatNode[],
    stored: Readonly<Record<string, NodeUiView>>,
    sizes: Readonly<Record<string, BoardSize>>,
): Record<string, BoardPoint> {
    const placed: Record<string, BoardPoint> = {};
    const rects: BoardRect[] = [];
    let rootBottom = BOARD_EDGE;

    for (const item of flat) {
        const size = sizeOf(item.node.id, sizes);
        const saved = storedPoint(stored[item.node.id]);
        let point: BoardPoint;
        if (saved !== null) {
            point = saved;
        } else {
            const parentId = item.node.parentId;
            const parentPoint = parentId === null ? undefined : placed[parentId];
            if (parentPoint !== undefined) {
                point = placeNear({ ...parentPoint, ...sizeOf(parentId as string, sizes) }, rects);
            } else {
                point = { x: BOARD_EDGE, y: rootBottom };
            }
        }
        if (item.node.parentId === null) {
            rootBottom = Math.max(rootBottom, point.y + size.height + BOARD_GAP_Y);
        }
        placed[item.node.id] = point;
        rects.push({ ...point, ...size });
    }
    return placed;
}

/**
 * 부모 오른쪽에서 자식 왼쪽으로 가는 곡선.
 *
 * 직선이 아니라 곡선인 이유는 노드가 겹쳐 놓였을 때 어느 선이 어디로 가는지
 * 구분되기 때문이다.
 */
export function connectorPath(parent: BoardRect, child: BoardRect): string {
    const x1 = parent.x + parent.width;
    const y1 = parent.y + BOARD_ANCHOR_Y;
    const x2 = child.x;
    const y2 = child.y + BOARD_ANCHOR_Y;
    const bend = Math.max(30, Math.abs(x2 - x1) / 2);
    return `M${x1} ${y1} C${x1 + bend} ${y1},${x2 - bend} ${y2},${x2} ${y2}`;
}

/** 캔버스가 담아야 할 크기. 이만큼 늘려야 스크롤이 생긴다. */
export function boardExtent(rects: readonly BoardRect[]): BoardSize {
    let width = 0;
    let height = 0;
    for (const rect of rects) {
        width = Math.max(width, rect.x + rect.width);
        height = Math.max(height, rect.y + rect.height);
    }
    return { width: width + BOARD_EDGE * 2, height: height + BOARD_EDGE * 2 };
}

/**
 * 그릴 연결선 목록.
 *
 * 자식을 **모델**에서 찾는다. DOM 순회로 되돌리면 보드 모드에서 자식을 하나도
 * 못 찾고, 트리 모드에서는 접힌 노드까지 이어 버린다.
 */
export function connectors(
    flat: readonly FlatNode[],
    rects: Readonly<Record<string, BoardRect>>,
): Array<{ id: string; d: string }> {
    const lines: Array<{ id: string; d: string }> = [];
    for (const item of flat) {
        const parentId = item.node.parentId;
        if (parentId === null) {
            continue;
        }
        const from = rects[parentId];
        const to = rects[item.node.id];
        if (from === undefined || to === undefined) {
            continue;
        }
        lines.push({ id: item.node.id, d: connectorPath(from, to) });
    }
    return lines;
}
