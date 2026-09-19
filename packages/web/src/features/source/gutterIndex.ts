/**
 * 코드 화면 여백 표식 색인 (V04).
 *
 * 코드 화면은 "이 함수가 이미 트레일에 있다" 를 모르고, 기록 범위는 밑줄과
 * hover 글뿐이라 누를 수 없다. 여백에 표식을 두면 hunk 를 읽다가 트레일의
 * 그 노드로, 또는 그 줄의 기록으로 바로 간다.
 *
 * **활성 트레일과 활성 분석만 본다.** 여러 트레일의 노드를 한 여백에 섞으면
 * 눌렀을 때 어디로 가는지 알 수 없다.
 *
 * 브라우저 없이 테스트할 수 있도록 순수 함수로 둔다.
 */

export type GutterNoteKind = 'explanation' | 'question' | 'concern' | 'conclusion';

/** 색인이 노드에서 보는 만큼만. `TrailNodeView` 를 그대로 받지 않는다. */
export interface GutterNodeLike {
    id: string;
    symbol: { relPath: string | null; anchorLine: number; name: string };
    children: readonly GutterNodeLike[];
}

export interface GutterIndex {
    /** 파일 → 줄(0-based) → 그 줄에 걸린 노드. 여럿일 수 있다. */
    nodes: Map<string, Map<number, string[]>>;
    /** 파일 → 줄(0-based) → 그 줄에 걸린 기록. */
    notes: Map<string, Map<number, Array<{ annotationId: string; kind: GutterNoteKind }>>>;
}

function push<T>(target: Map<string, Map<number, T[]>>, relPath: string, line: number, value: T): void {
    const byLine = target.get(relPath) ?? new Map<number, T[]>();
    byLine.set(line, [...(byLine.get(line) ?? []), value]);
    target.set(relPath, byLine);
}

/**
 * 트레일 노드와 범위 기록을 줄별로 편다.
 *
 * 노드 표식은 `anchorLine` **한 줄**에만 둔다. 본문 전체에 색을 칠하면 hunk 의
 * 색 띠와 섞여 무엇이 무엇인지 알 수 없다.
 */
export function buildGutterIndex(
    roots: readonly GutterNodeLike[],
    marksByFile: ReadonlyMap<string, ReadonlyArray<{
        annotationId: string; kind: GutterNoteKind; startLine: number;
    }>>,
): GutterIndex {
    const index: GutterIndex = { nodes: new Map(), notes: new Map() };
    const walk = (node: GutterNodeLike): void => {
        if (node.symbol.relPath !== null) {
            push(index.nodes, node.symbol.relPath, node.symbol.anchorLine, node.id);
        }
        node.children.forEach(walk);
    };
    roots.forEach(walk);

    for (const [relPath, marks] of marksByFile) {
        for (const mark of marks) {
            push(index.notes, relPath, mark.startLine, {
                annotationId: mark.annotationId,
                kind: mark.kind,
            });
        }
    }
    return index;
}

/** 그 파일에서 표식이 있는 줄만. Monaco 장식을 만들 때 쓴다. */
export function gutterLines(
    index: GutterIndex,
    relPath: string | null,
): Array<{
    line: number;
    nodeIds: string[];
    notes: Array<{ annotationId: string; kind: GutterNoteKind }>;
}> {
    if (relPath === null) return [];
    const nodes = index.nodes.get(relPath) ?? new Map<number, string[]>();
    const notes = index.notes.get(relPath)
        ?? new Map<number, Array<{ annotationId: string; kind: GutterNoteKind }>>();
    const lines = new Set<number>([...nodes.keys(), ...notes.keys()]);
    return [...lines].sort((a, b) => a - b).map((line) => ({
        line,
        nodeIds: nodes.get(line) ?? [],
        notes: notes.get(line) ?? [],
    }));
}
