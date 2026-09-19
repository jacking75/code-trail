/**
 * 기록 색인 (U10).
 *
 * 분석 문서 하나를 훑어 "어느 노드에", "어느 파일의 어느 줄에" 기록이 달려
 * 있는지를 미리 모은다. 트레일 패널이 노드마다 이 계산을 다시 하면 노드 수 ×
 * 기록 수가 되고, 1,000개 노드에서 눈에 띄게 느려진다.
 *
 * **활성 분석 하나만 본다.** 여러 분석의 기록을 합치면 "누구의 우려인지" 가
 * 흐려진다. 분석을 바꾸면 배지도 바뀐다.
 *
 * 브라우저 없이 테스트할 수 있도록 순수 함수로 둔다.
 */

export type AnnotationKind = 'explanation' | 'question' | 'concern' | 'conclusion';

/** 검토 표시의 네 상태. 헤더의 `☐/☑` 와 hunk 줄이 함께 쓴다(V02·V03). */
export type ReviewStateView = 'unreviewed' | 'reviewing' | 'reviewed' | 'needsReview';

/** 파일의 이 줄 범위가 어떤 검토 상태인지. hunk 겹침 판정이 쓴다(V03). */
export interface ReviewMarkView {
    startLine: number;
    endLine: number;
    state: ReviewStateView;
}

export interface AnnotationMarkView {
    annotationId: string;
    kind: AnnotationKind;
    /** 미해결 질문·우려인지. 배지 색을 가른다. */
    open: boolean;
    /** 원본 파일 기준 0-based 줄. */
    startLine: number;
    endLine: number;
    /** 목록에서 앞줄만 보여줄 때 쓴다. */
    preview: string;
}

export interface AnnotationCount {
    total: number;
    open: number;
    /** 종류별 개수. 헤더 `title` 에 "설명 2 · 질문 1(미해결)" 로 적는다. */
    byKind: Record<AnnotationKind, number>;
}

export interface AnnotationIndex {
    byNode: Map<string, AnnotationCount>;
    byFile: Map<string, AnnotationMarkView[]>;
    /** 트레일 전체를 대상으로 한 기록. 노드에 붙이지 않고 툴바에만 센다. */
    trailTotal: number;
    total: number;
    open: number;
    /** 노드 대상 검토 상태. 헤더의 `☑` 와 배지가 쓴다(V02). */
    reviewByNode: Map<string, ReviewStateView>;
    /** 파일별 범위 검토. 변경 목록의 hunk 표시가 쓴다(V03). */
    reviewsByFile: Map<string, ReviewMarkView[]>;
    /** 툴바의 `확인함 N · 재검토 K`. 분모는 두지 않는다. */
    reviewCounts: { reviewed: number; needsReview: number };
}

/** 분석 문서에서 색인이 보는 만큼만. 화면 타입을 그대로 받지 않는다. */
export interface AnalysisLike {
    annotations: ReadonlyArray<{
        id: string;
        target: Record<string, unknown>;
        kind: string;
        body: string;
        status: string;
        deletedAt: string | null;
    }>;
    anchors: ReadonlyArray<Record<string, unknown>>;
    baselines: ReadonlyArray<Record<string, unknown>>;
    /** 검토 기록. 없는 화면 타입도 있으므로 선택이다. */
    reviews?: ReadonlyArray<{ target: Record<string, unknown>; state: string }>;
}

function emptyCount(): AnnotationCount {
    return {
        total: 0,
        open: 0,
        byKind: { explanation: 0, question: 0, concern: 0, conclusion: 0 },
    };
}

function isKind(value: unknown): value is AnnotationKind {
    return value === 'explanation' || value === 'question'
        || value === 'concern' || value === 'conclusion';
}

interface Point { line: number; char: number }
interface RangeLike { start: Point; end: Point }

function asRange(value: unknown): RangeLike | null {
    const range = value as RangeLike | null | undefined;
    if (!range || typeof range.start?.line !== 'number' || typeof range.end?.line !== 'number') {
        return null;
    }
    return range;
}

export function buildAnnotationIndex(analysis: AnalysisLike | null): AnnotationIndex {
    const index: AnnotationIndex = {
        byNode: new Map(),
        byFile: new Map(),
        trailTotal: 0,
        total: 0,
        open: 0,
        reviewByNode: new Map(),
        reviewsByFile: new Map(),
        reviewCounts: { reviewed: 0, needsReview: 0 },
    };
    if (analysis === null) {
        return index;
    }

    // 기준 파일 목록은 분석마다 한 번만 편다. 앵커마다 다시 훑으면 제곱이 된다.
    const fileById = new Map<string, string>();
    for (const baseline of analysis.baselines) {
        const files = (baseline as { files?: Array<{ fileId?: string; relPath?: string }> }).files;
        for (const file of files ?? []) {
            if (typeof file.fileId === 'string' && typeof file.relPath === 'string') {
                fileById.set(file.fileId, file.relPath);
            }
        }
    }
    const anchorById = new Map<string, { fileId: string; range: RangeLike }>();
    for (const raw of analysis.anchors) {
        const anchor = raw as {
            id?: string; fileId?: string; range?: unknown; currentRange?: unknown;
        };
        // 위치가 다시 잡혔으면 그 자리가 지금의 자리다.
        const range = asRange(anchor.currentRange) ?? asRange(anchor.range);
        if (typeof anchor.id === 'string' && typeof anchor.fileId === 'string' && range) {
            anchorById.set(anchor.id, { fileId: anchor.fileId, range });
        }
    }

    for (const annotation of analysis.annotations) {
        // 지운 기록은 세지 않는다. 배지가 남아 있으면 있지도 않은 우려를 본다.
        if (annotation.deletedAt !== null) {
            continue;
        }
        const kind: AnnotationKind = isKind(annotation.kind) ? annotation.kind : 'explanation';
        const open = (kind === 'question' || kind === 'concern') && annotation.status === 'open';
        index.total += 1;
        if (open) {
            index.open += 1;
        }

        const target = annotation.target as { kind?: string; nodeId?: string; anchorId?: string };
        if (target.kind === 'node' && typeof target.nodeId === 'string') {
            const count = index.byNode.get(target.nodeId) ?? emptyCount();
            count.total += 1;
            count.byKind[kind] += 1;
            if (open) {
                count.open += 1;
            }
            index.byNode.set(target.nodeId, count);
            continue;
        }
        if (target.kind === 'trail') {
            index.trailTotal += 1;
            continue;
        }
        if (target.kind !== 'range' || typeof target.anchorId !== 'string') {
            continue;
        }
        const anchor = anchorById.get(target.anchorId);
        const relPath = anchor === undefined ? undefined : fileById.get(anchor.fileId);
        if (anchor === undefined || relPath === undefined) {
            continue;
        }
        const marks = index.byFile.get(relPath) ?? [];
        marks.push({
            annotationId: annotation.id,
            kind,
            open,
            startLine: anchor.range.start.line,
            endLine: anchor.range.end.line,
            preview: annotation.body.split(/\r?\n/)[0]?.slice(0, 120) ?? '',
        });
        index.byFile.set(relPath, marks);
    }

    // 검토는 기록과 별개의 목록이다. 같은 앵커·같은 노드를 가리키지만 "봤다" 는
    // 기록 없이도 남길 수 있다(V02·V03).
    for (const review of analysis.reviews ?? []) {
        const state = isReviewState(review.state) ? review.state : 'unreviewed';
        if (state === 'reviewed') index.reviewCounts.reviewed += 1;
        if (state === 'needsReview') index.reviewCounts.needsReview += 1;
        const target = review.target as { kind?: string; nodeId?: string; anchorId?: string };
        if (target.kind === 'node' && typeof target.nodeId === 'string') {
            index.reviewByNode.set(target.nodeId, state);
            continue;
        }
        if (target.kind !== 'range' || typeof target.anchorId !== 'string') continue;
        const anchor = anchorById.get(target.anchorId);
        const relPath = anchor === undefined ? undefined : fileById.get(anchor.fileId);
        if (anchor === undefined || relPath === undefined) continue;
        const marks = index.reviewsByFile.get(relPath) ?? [];
        marks.push({ startLine: anchor.range.start.line, endLine: anchor.range.end.line, state });
        index.reviewsByFile.set(relPath, marks);
    }
    return index;
}

function isReviewState(value: unknown): value is ReviewStateView {
    return value === 'unreviewed' || value === 'reviewing'
        || value === 'reviewed' || value === 'needsReview';
}

/**
 * 그 파일의 이 줄 범위를 덮는 검토 상태 (V03).
 *
 * 범위가 정확히 같지 않아도 `확인함` 범위가 hunk 를 덮으면 확인한 것으로 본다 —
 * 함수 하나를 통째로 확인하면 그 안의 hunk 도 본 것이다. 재검토가 하나라도
 * 겹치면 재검토가 이긴다. "다시 봐야 한다" 는 쪽이 놓치면 안 되는 신호다.
 */
export function reviewForRange(
    index: AnnotationIndex,
    relPath: string | null,
    startLine: number,
    endLine: number,
): ReviewStateView {
    if (relPath === null) return 'unreviewed';
    let best: ReviewStateView = 'unreviewed';
    for (const mark of index.reviewsByFile.get(relPath) ?? []) {
        if (mark.startLine > startLine || mark.endLine < endLine) continue;
        if (mark.state === 'needsReview') return 'needsReview';
        if (mark.state === 'reviewed' || best === 'unreviewed') best = mark.state;
    }
    return best;
}

/**
 * 그 파일의 이 줄 범위와 겹치는 기록.
 *
 * 노드 본문은 파일의 일부만 보여준다. 범위 기록이 본문 밖에 있으면 그 노드와는
 * 상관이 없다 — 그래서 겹침을 파일 단위가 아니라 줄 단위로 본다.
 */
export function marksInRange(
    index: AnnotationIndex,
    relPath: string | null,
    startLine: number,
    endLine: number,
): AnnotationMarkView[] {
    if (relPath === null) {
        return [];
    }
    return (index.byFile.get(relPath) ?? []).filter(
        (mark) => mark.startLine <= endLine && mark.endLine >= startLine,
    );
}

/** 노드 헤더에 찍을 개수. 노드 대상과 본문에 겹치는 범위 대상을 합친다. */
export function countForNode(
    index: AnnotationIndex,
    nodeId: string,
    relPath: string | null,
    startLine: number,
    endLine: number,
): AnnotationCount {
    const base = index.byNode.get(nodeId);
    const merged = emptyCount();
    if (base) {
        merged.total += base.total;
        merged.open += base.open;
        for (const kind of Object.keys(merged.byKind) as AnnotationKind[]) {
            merged.byKind[kind] += base.byKind[kind];
        }
    }
    for (const mark of marksInRange(index, relPath, startLine, endLine)) {
        merged.total += 1;
        merged.byKind[mark.kind] += 1;
        if (mark.open) {
            merged.open += 1;
        }
    }
    return merged;
}

const KIND_LABEL: Record<AnnotationKind, string> = {
    explanation: '설명',
    question: '질문',
    concern: '우려',
    conclusion: '결론',
};

/** 헤더 배지의 `title`. "설명 2 · 질문 1(미해결 1)". */
export function describeCount(count: AnnotationCount): string {
    const parts = (Object.keys(count.byKind) as AnnotationKind[])
        .filter((kind) => count.byKind[kind] > 0)
        .map((kind) => `${KIND_LABEL[kind]} ${count.byKind[kind]}`);
    if (count.open > 0) {
        parts.push(`미해결 ${count.open}`);
    }
    return parts.join(' · ');
}

/** 접힌 노드가 감추고 있는 것 (V12). */
export interface SubtreeSummary {
    /** 자기 자신을 뺀 하위 노드 수. */
    nodes: number;
    /** 하위(자기 포함) 기록 수. */
    notes: number;
    /** 하위(자기 포함) 미해결 질문·우려 수. */
    open: number;
    /** 하위(자기 포함) `재검토` 노드 수. */
    needsReview: number;
}

/** 요약 계산이 노드에서 보는 만큼만. `TrailNodeView` 를 그대로 받지 않는다. */
export interface SummaryNodeLike {
    id: string;
    symbol: { relPath: string | null; startLine: number; code: string };
    children: readonly SummaryNodeLike[];
}

/**
 * 노드마다 하위 요약을 한 번의 순회로 (V12).
 *
 * 접힌 노드는 `↳ N`(직계 자식 수)뿐이라 그 안에 미해결 우려가 있는지 알 수 없다.
 * 노드마다 따로 세면 트리 깊이 × 노드 수가 되므로 아래에서 위로 한 번만 센다.
 */
export function subtreeSummary(
    roots: readonly SummaryNodeLike[],
    index: AnnotationIndex,
): Map<string, SubtreeSummary> {
    const out = new Map<string, SubtreeSummary>();
    const visit = (node: SummaryNodeLike): SubtreeSummary => {
        const lineCount = node.symbol.code === '' ? 0 : node.symbol.code.split(/\r?\n/).length;
        const end = node.symbol.startLine + Math.max(0, lineCount - 1);
        const own = countForNode(index, node.id, node.symbol.relPath, node.symbol.startLine, end);
        const summary: SubtreeSummary = {
            nodes: 0,
            notes: own.total,
            open: own.open,
            needsReview: index.reviewByNode.get(node.id) === 'needsReview' ? 1 : 0,
        };
        for (const child of node.children) {
            const childSummary = visit(child);
            summary.nodes += childSummary.nodes + 1;
            summary.notes += childSummary.notes;
            summary.open += childSummary.open;
            summary.needsReview += childSummary.needsReview;
        }
        out.set(node.id, summary);
        return summary;
    };
    roots.forEach(visit);
    return out;
}
