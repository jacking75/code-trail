import type { TrailNodeView } from './types.js';
import { sortChildren, type ChildOrder } from './board.js';

/**
 * 키보드 이동 (U16).
 *
 * 화살표가 데려갈 다음 노드를 정한다. **보이는 것만** 센다 — 접힌 서브트리와
 * 필터에 걸러진 노드로 커서가 들어가면 사용자 눈에는 커서가 사라진 것이다.
 *
 * 브라우저 없이 테스트할 수 있게 순수 함수로 둔다. DOM 을 훑지 않는 이유는
 * 보드 모드 때문이기도 하다 — 거기서는 자식이 부모 안에 중첩돼 있지 않다.
 */

export interface VisibleNode {
    id: string;
    depth: number;
    parentId: string | null;
    collapsed: boolean;
    hasChildren: boolean;
}

/**
 * 위에서 아래로 본 순서.
 *
 * 접힌 노드의 자식은 넣지 않는다. 필터가 켜져 있으면 걸린 것만 남긴다 —
 * 화면에 없는 노드로 `↓` 가 데려가면 안 된다.
 */
export function visibleOrder(
    roots: readonly TrailNodeView[],
    order: ChildOrder,
    visibleIds: ReadonlySet<string> | null,
): VisibleNode[] {
    const out: VisibleNode[] = [];
    const walk = (nodes: readonly TrailNodeView[], depth: number): void => {
        for (const node of sortChildren(nodes, order)) {
            if (visibleIds !== null && !visibleIds.has(node.id)) {
                continue;
            }
            const children = visibleIds === null
                ? node.children
                : node.children.filter((child) => visibleIds.has(child.id));
            out.push({
                id: node.id,
                depth,
                parentId: node.parentId,
                collapsed: node.collapsed,
                hasChildren: children.length > 0,
            });
            if (!node.collapsed) {
                walk(children, depth + 1);
            }
        }
    };
    walk(roots, 0);
    return out;
}

function indexOf(list: readonly VisibleNode[], id: string | null): number {
    return id === null ? -1 : list.findIndex((item) => item.id === id);
}

/** 다음 노드. 마지막에서는 그대로 둔다 — 끝에서 처음으로 돌아가면 길을 잃는다. */
export function nextVisible(list: readonly VisibleNode[], current: string | null): string | null {
    if (list.length === 0) {
        return null;
    }
    const at = indexOf(list, current);
    if (at < 0) {
        return list[0]?.id ?? null;
    }
    return list[Math.min(at + 1, list.length - 1)]?.id ?? null;
}

/** 이전 노드. 처음에서는 그대로 둔다. */
export function prevVisible(list: readonly VisibleNode[], current: string | null): string | null {
    if (list.length === 0) {
        return null;
    }
    const at = indexOf(list, current);
    if (at < 0) {
        return list[0]?.id ?? null;
    }
    return list[Math.max(at - 1, 0)]?.id ?? null;
}

/** 첫 자식. 접혀 있거나 자식이 없으면 `null`. */
export function firstChild(list: readonly VisibleNode[], current: string | null): string | null {
    const at = indexOf(list, current);
    const node = at < 0 ? undefined : list[at];
    const next = at < 0 ? undefined : list[at + 1];
    if (node === undefined || next === undefined || next.parentId !== node.id) {
        return null;
    }
    return next.id;
}

/** 부모. 루트면 `null`. */
export function parentOf(list: readonly VisibleNode[], current: string | null): string | null {
    const at = indexOf(list, current);
    const node = at < 0 ? undefined : list[at];
    if (node === undefined || node.parentId === null) {
        return null;
    }
    return list.some((item) => item.id === node.parentId) ? node.parentId : null;
}
