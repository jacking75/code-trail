import { newEntityId } from './ids.js';

export const ANALYSIS_SCHEMA_VERSION = 1 as const;
export const MAX_ANNOTATION_BYTES = 64 * 1024;
export const MAX_REPLY_BYTES = 32 * 1024;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 64;
export const MAX_ANALYSIS_ENTITIES = 10_000;

/**
 * 자동 재확인이 남기는 이력의 작성자 (V17).
 *
 * 사람이 아니라 시스템이다. 이력의 `actorId` 는 UUID 라서 `'system'` 같은 글자를
 * 넣을 수 없고, 넣지 않으면 "누가 상태를 바꿨나" 를 답할 수 없다.
 */
export const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000000';

export interface Position {
    line: number;
    char: number;
}

/** 끝 좌표를 포함하지 않는 원본 UTF-16 범위다. */
export interface CodeRange {
    start: Position;
    end: Position;
}

export type AnnotationTarget =
    | { kind: 'trail'; trailId: string }
    | { kind: 'node'; trailId: string; nodeId: string }
    | { kind: 'range'; anchorId: string };

export type AnnotationKind = 'explanation' | 'question' | 'concern' | 'conclusion';
export type AnnotationStatus = 'open' | 'resolved';
export type ReviewState = 'unreviewed' | 'reviewing' | 'reviewed' | 'needsReview';
export type AnchorState = 'matched' | 'moved' | 'changed' | 'ambiguous' | 'missing' | 'unknown';

export interface Author {
    id: string;
    displayName: string;
}

export interface Annotation {
    id: string;
    version: number;
    target: AnnotationTarget;
    kind: AnnotationKind;
    body: string;
    tags: string[];
    status: AnnotationStatus;
    authorId: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface AnnotationReply {
    id: string;
    annotationId: string;
    version: number;
    body: string;
    authorId: string;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface SymbolHint {
    name: string;
    detail: string;
    container: string;
    kind: number;
}

export interface Anchor {
    id: string;
    version: number;
    baselineId: string;
    fileId: string;
    range: CodeRange;
    selectedTextHash: string;
    contextBeforeHash: string | null;
    contextAfterHash: string | null;
    /** 로컬 저장 및 코드 포함 공유에서만 존재한다. */
    selectedText: string | null;
    contextBefore: string | null;
    contextAfter: string | null;
    symbolHint: SymbolHint | null;
    state: AnchorState;
    currentRange: CodeRange | null;
    candidateIds: string[];
}

export interface BaselineFile {
    fileId: string;
    relPath: string;
    contentHash: string;
    textEncoding: 'utf-8';
}

export interface SourceBaseline {
    id: string;
    repositoryId: string | null;
    commit: string | null;
    dirty: boolean | null;
    capturedAt: string;
    files: BaselineFile[];
}

export interface ReviewRecord {
    id: string;
    target: AnnotationTarget;
    baselineId: string;
    state: ReviewState;
    authorId: string;
    evidenceIds: string[];
    version: number;
}

export interface WalkthroughStep {
    id: string;
    title: string;
    body: string;
    /** 단계가 직접 설명하는 기록이다. 위치 대상과 별도로 안정적인 내부 링크에 쓴다. */
    annotationId: string | null;
    target: AnnotationTarget | null;
    baselineId: string | null;
}

export interface Walkthrough {
    id: string;
    version: number;
    title: string;
    steps: WalkthroughStep[];
}

export interface ReviewGoal {
    id: string;
    title: string;
    targetIds: string[];
    evidenceIds: string[];
}

export interface ImportantLocation {
    id: string;
    title: string;
    target: AnnotationTarget;
}

export type HistoryKind =
    | 'created'
    | 'updated'
    | 'deleted'
    | 'restored'
    | 'replied'
    | 'reviewed'
    | 'rebound'
    | 'merged';

export interface AnalysisHistoryEntry {
    id: string;
    targetId: string;
    fromVersion: number;
    toVersion: number;
    kind: HistoryKind;
    actorId: string;
    at: string;
    /** 삭제·충돌 복구에 필요한 이전 값이다. 공유에서는 기본 제외한다. */
    previousBody: string | null;
    changedFields: string[];
}

export interface ProcessedCommand {
    commandId: string;
    fingerprint: string;
    resultId: string;
}

/** 가져온 공유 복사본을 회신할 때 원래 ID와 세 방향 비교 기준을 복원한다. */
export interface SourceShare {
    bundleId: string;
    sourceAnalysisId: string;
    baseContentHash: string;
    /** 로컬로 바꾼 ID → 송신 묶음의 원래 ID다. */
    originalIds: Record<string, string>;
    baseAnnotations: Annotation[];
    baseReplies: AnnotationReply[];
}

export interface AnalysisDocument {
    schemaVersion: typeof ANALYSIS_SCHEMA_VERSION;
    id: string;
    title: string;
    purpose: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
    trailIds: string[];
    authors: Author[];
    annotations: Annotation[];
    replies: AnnotationReply[];
    anchors: Anchor[];
    baselines: SourceBaseline[];
    reviews: ReviewRecord[];
    walkthroughs: Walkthrough[];
    goals: ReviewGoal[];
    importantLocations: ImportantLocation[];
    history: AnalysisHistoryEntry[];
    processedCommands: ProcessedCommand[];
    sourceShare: SourceShare | null;
}

export interface AnalysisSummary {
    id: string;
    title: string;
    purpose: string;
    revision: number;
    updatedAt: string;
    annotationCount: number;
    unresolvedCount: number;
    reviewedCount: number;
    reviewTargetCount: number;
    /**
     * 이 분석이 다루는 트레일.
     *
     * 트레일을 고르면 짝지은 분석이 따라오게 하려면 목록만 보고도 알 수 있어야
     * 한다. 이것이 없으면 분석마다 전체 문서를 읽어야 짝을 찾는다(U11).
     */
    trailIds: string[];
}

export function createAnalysis(args: {
    title?: string;
    purpose?: string;
    trailIds?: string[];
    author?: Author;
    id?: string;
    now?: string;
} = {}): AnalysisDocument {
    const now = args.now ?? new Date().toISOString();
    return {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        id: args.id ?? newEntityId(),
        title: args.title?.trim() || '새 분석',
        purpose: args.purpose?.trim() ?? '',
        revision: 0,
        createdAt: now,
        updatedAt: now,
        trailIds: [...new Set(args.trailIds ?? [])],
        authors: args.author ? [{ ...args.author }] : [],
        annotations: [],
        replies: [],
        anchors: [],
        baselines: [],
        reviews: [],
        walkthroughs: [],
        goals: [],
        importantLocations: [],
        history: [],
        processedCommands: [],
        sourceShare: null,
    };
}

export function summarizeAnalysis(value: AnalysisDocument): AnalysisSummary {
    const active = value.annotations.filter((item) => item.deletedAt === null);
    return {
        id: value.id,
        title: value.title,
        purpose: value.purpose,
        revision: value.revision,
        updatedAt: value.updatedAt,
        annotationCount: active.length,
        unresolvedCount: active.filter((item) =>
            (item.kind === 'question' || item.kind === 'concern') && item.status === 'open').length,
        reviewedCount: value.reviews.filter((item) => item.state === 'reviewed').length,
        reviewTargetCount: value.reviews.length,
        trailIds: [...value.trailIds],
    };
}

export function comparePosition(a: Position, b: Position): number {
    return a.line === b.line ? a.char - b.char : a.line - b.line;
}

export function isValidRange(range: CodeRange): boolean {
    return comparePosition(range.start, range.end) <= 0;
}

/** UTF-16 좌표로 원본 문자열의 범위를 꺼낸다. 줄바꿈과 탭을 바꾸지 않는다. */
export function textForRange(text: string, range: CodeRange): string | null {
    if (!isValidRange(range)) {
        return null;
    }
    const lines = text.split(/(?<=\n)/);
    if (range.start.line >= lines.length || range.end.line >= lines.length) {
        if (!(range.end.line === lines.length && range.end.char === 0)) {
            return null;
        }
    }
    const offsets: number[] = [];
    let total = 0;
    for (const line of lines) {
        offsets.push(total);
        total += line.length;
    }
    offsets.push(total);
    const startLine = lines[range.start.line] ?? '';
    const endLine = lines[range.end.line] ?? '';
    const startContentLength = startLine.replace(/\r?\n$/, '').length;
    const endContentLength = endLine.replace(/\r?\n$/, '').length;
    if (range.start.char > startContentLength || range.end.char > endContentLength) {
        return null;
    }
    const start = (offsets[range.start.line] ?? total) + range.start.char;
    const end = (offsets[range.end.line] ?? total) + range.end.char;
    return text.slice(start, end);
}

export function cloneAnalysis(value: AnalysisDocument): AnalysisDocument {
    return JSON.parse(JSON.stringify(value)) as AnalysisDocument;
}

export function stringifyAnalysis(value: AnalysisDocument): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}
