/**
 * 기록 목록 거르기·세우기·묶기 (V15).
 *
 * 기록이 수백 개가 되면 본문 검색과 종류만으로는 원하는 것을 못 찾는다.
 * 열림/해결·작성자·대상 종류로 거르고, 위치순으로 세우고, 파일별로 묶는다.
 *
 * 브라우저 없이 테스트할 수 있도록 순수 함수로 둔다.
 */

export type ListKind = 'explanation' | 'question' | 'concern' | 'conclusion';
export type ListStatus = 'open' | 'resolved';
export type ListTargetKind = 'trail' | 'node' | 'range';
export type ListSort = 'recent' | 'location' | 'kind';

export interface ListItemLike {
    id: string;
    target: { kind?: string; nodeId?: string; anchorId?: string };
    kind: string;
    body: string;
    tags: string[];
    status: string;
    authorId: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface ListFilters {
    query: string;
    kind: 'all' | ListKind;
    status: 'all' | ListStatus;
    authorId: 'all' | string;
    targetKind: 'all' | ListTargetKind;
    showDeleted: boolean;
}

export interface ListContext {
    /** 앵커 → 파일·시작 줄. 위치순 정렬과 파일별 묶기가 쓴다. */
    anchorPlace: ReadonlyMap<string, { relPath: string; line: number }>;
    /** 노드 ID → 트레일에서 보이는 순서. 없으면 맨 뒤로 보낸다. */
    nodeOrder: ReadonlyMap<string, number>;
}

export const EMPTY_FILTERS: ListFilters = {
    query: '',
    kind: 'all',
    status: 'all',
    authorId: 'all',
    targetKind: 'all',
    showDeleted: false,
};

export function filterAnnotations<T extends ListItemLike>(
    items: readonly T[],
    filters: ListFilters,
): T[] {
    const needle = filters.query.trim().toLocaleLowerCase('ko');
    return items.filter((item) => {
        if (!filters.showDeleted && item.deletedAt !== null) return false;
        if (filters.kind !== 'all' && item.kind !== filters.kind) return false;
        if (filters.status !== 'all' && item.status !== filters.status) return false;
        if (filters.authorId !== 'all' && item.authorId !== filters.authorId) return false;
        if (filters.targetKind !== 'all' && item.target.kind !== filters.targetKind) return false;
        if (needle === '') return true;
        return `${item.body} ${item.tags.join(' ')}`.toLocaleLowerCase('ko').includes(needle);
    });
}

/**
 * 위치순은 `relPath` → 시작 줄 → 노드는 트레일의 보이는 순서다.
 * 트레일 전체 대상은 맨 위 — 그 문서에서 가장 넓은 말이기 때문이다.
 */
export function sortAnnotations<T extends ListItemLike>(
    items: readonly T[],
    sort: ListSort,
    context: ListContext,
): T[] {
    const copy = [...items];
    if (sort === 'recent') {
        return copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    if (sort === 'kind') {
        const order: Record<string, number> = { concern: 0, question: 1, conclusion: 2, explanation: 3 };
        return copy.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9)
            || b.updatedAt.localeCompare(a.updatedAt));
    }
    const rank = (item: ListItemLike): [number, string, number] => {
        if (item.target.kind === 'trail') return [0, '', 0];
        if (item.target.kind === 'node') {
            return [1, '', context.nodeOrder.get(item.target.nodeId ?? '') ?? Number.MAX_SAFE_INTEGER];
        }
        const place = context.anchorPlace.get(item.target.anchorId ?? '');
        return place === undefined ? [3, '', 0] : [2, place.relPath, place.line];
    };
    return copy.sort((a, b) => {
        const left = rank(a);
        const right = rank(b);
        return left[0] - right[0]
            || left[1].localeCompare(right[1])
            || left[2] - right[2];
    });
}

/**
 * 파일별로 묶는다. 파일에 붙지 않은 기록(트레일·노드 대상)은 맨 앞 한 무리로 모은다.
 * 파일 하나씩 훑는 리뷰에서는 이쪽이 읽는 순서와 맞다.
 */
export function groupByFile<T extends ListItemLike>(
    items: readonly T[],
    context: ListContext,
): Array<{ relPath: string | null; items: T[] }> {
    const groups = new Map<string, T[]>();
    const loose: T[] = [];
    for (const item of items) {
        const place = item.target.kind === 'range'
            ? context.anchorPlace.get(item.target.anchorId ?? '')
            : undefined;
        if (place === undefined) {
            loose.push(item);
            continue;
        }
        groups.set(place.relPath, [...(groups.get(place.relPath) ?? []), item]);
    }
    const out: Array<{ relPath: string | null; items: T[] }> = [];
    if (loose.length > 0) out.push({ relPath: null, items: loose });
    for (const relPath of [...groups.keys()].sort()) {
        out.push({ relPath, items: groups.get(relPath) as T[] });
    }
    return out;
}

/** 이 분석에 쓰인 태그. 태그 입력의 `<datalist>` 가 쓴다. */
export function tagSuggestions(items: readonly ListItemLike[]): string[] {
    const seen = new Set<string>();
    for (const item of items) {
        if (item.deletedAt !== null) continue;
        for (const tag of item.tags) seen.add(tag);
    }
    return [...seen].sort();
}
