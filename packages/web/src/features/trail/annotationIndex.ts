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
    return index;
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
