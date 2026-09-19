import type { AnnotationIndex } from './annotationIndex.js';
import { countForNode, marksInRange } from './annotationIndex.js';

/**
 * 트레일 필터 (V09).
 *
 * 이름·경로만 보던 필터를 **본문**과 **기록**까지 넓힌다. "이 트레일에서
 * `mutex` 를 만진 곳", "우려가 달린 노드만" 을 찾을 수 있어야 한다.
 *
 * 본문 매치는 `symbol.code` 의 줄 단위 부분 일치다. 토크나이저를 돌리지 않는다 —
 * 필터는 정확도를 책임지지 않고, 한 글자 칠 때마다 전체를 토큰화하면 느려진다.
 *
 * 브라우저 없이 테스트할 수 있도록 순수 함수로 둔다.
 */

export type FilterScope = 'name' | 'body' | 'notes';

/** 필터가 노드에서 보는 만큼만. `TrailNodeView` 를 그대로 받지 않는다. */
export interface FilterNodeLike {
    id: string;
    symbol: {
        name: string;
        displayPath: string;
        relPath: string | null;
        startLine: number;
        code: string;
    };
    children: readonly FilterNodeLike[];
}

export interface FilterResult {
    /** 남길 노드. 걸린 노드와 그 조상이다. `null` 이면 필터가 꺼진 것이다. */
    visibleIds: Set<string> | null;
    /** 실제로 걸린 노드(조상 제외). 매치 수와 `Enter` 이동이 쓴다. */
    hitIds: Set<string>;
    /** 노드별로 본문에서 걸린 줄(원본 파일 기준 0-based). 본문 강조가 쓴다. */
    hitLines: Map<string, number[]>;
}

/** 기록 매치에서 낱말로도 받아주는 것들. `우려`, `미해결` 처럼 친다. */
const KIND_WORDS: Record<string, 'explanation' | 'question' | 'concern' | 'conclusion'> = {
    설명: 'explanation',
    질문: 'question',
    우려: 'concern',
    결론: 'conclusion',
};

/**
 * 필터에 걸린 노드와 그 조상.
 *
 * 조상을 함께 남기는 이유는 트리 모양을 지키기 위해서다. 걸린 노드만 남기면
 * 부모가 사라져 어디서 갈라진 것인지 알 수 없다.
 */
export function filterTrail(
    roots: readonly FilterNodeLike[],
    query: string,
    scope: FilterScope,
    index: AnnotationIndex,
): FilterResult {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
        return { visibleIds: null, hitIds: new Set(), hitLines: new Map() };
    }
    const keep = new Set<string>();
    const hits = new Set<string>();
    const hitLines = new Map<string, number[]>();

    const matches = (node: FilterNodeLike): boolean => {
        if (scope === 'name') {
            return node.symbol.name.toLowerCase().includes(needle)
                || node.symbol.displayPath.toLowerCase().includes(needle);
        }
        if (scope === 'body') {
            const lines = node.symbol.code === '' ? [] : node.symbol.code.split(/\r?\n/);
            const found: number[] = [];
            lines.forEach((line, offset) => {
                if (line.toLowerCase().includes(needle)) {
                    found.push(node.symbol.startLine + offset);
                }
            });
            if (found.length === 0) return false;
            hitLines.set(node.id, found);
            return true;
        }
        return matchesNotes(node, needle, index);
    };

    const walk = (node: FilterNodeLike, chain: FilterNodeLike[]): boolean => {
        const nextChain = [...chain, node];
        const hit = matches(node);
        let anyChild = false;
        for (const child of node.children) {
            anyChild = walk(child, nextChain) || anyChild;
        }
        if (hit) hits.add(node.id);
        if (hit || anyChild) {
            for (const inChain of nextChain) keep.add(inChain.id);
            return true;
        }
        return false;
    };
    roots.forEach((root) => walk(root, []));
    return { visibleIds: keep, hitIds: hits, hitLines };
}

function matchesNotes(node: FilterNodeLike, needle: string, index: AnnotationIndex): boolean {
    const lineCount = node.symbol.code === '' ? 0 : node.symbol.code.split(/\r?\n/).length;
    const end = node.symbol.startLine + Math.max(0, lineCount - 1);
    const count = countForNode(index, node.id, node.symbol.relPath, node.symbol.startLine, end);
    if (count.total === 0) return false;
    if (needle === '미해결') return count.open > 0;
    if (needle === '재검토') return index.reviewByNode.get(node.id) === 'needsReview';
    if (needle === '확인함') return index.reviewByNode.get(node.id) === 'reviewed';
    const kind = KIND_WORDS[needle];
    if (kind !== undefined) return count.byKind[kind] > 0;
    // 본문은 범위 기록의 앞줄만 들고 있다. 노드 대상 기록의 본문은 색인에
    // 없으므로 종류·미해결 낱말과 앞줄 일치까지가 여기서 할 수 있는 전부다.
    return marksInRange(index, node.symbol.relPath, node.symbol.startLine, end)
        .some((mark) => mark.preview.toLowerCase().includes(needle));
}
