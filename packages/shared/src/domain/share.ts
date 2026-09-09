import type {
    AnalysisDocument,
    Annotation,
    AnnotationReply,
    SourceBaseline,
    Walkthrough,
} from './analysis.js';
import type { StoredTrail } from './storage.js';
import { newEntityId } from './ids.js';

export const SHARE_SCHEMA_VERSION = 1 as const;
export const SHARE_FORMAT = 'code-trail-share' as const;
export const MAX_SHARE_BYTES = 32 * 1024 * 1024;
export const MAX_SHARE_CHUNK_BYTES = 256 * 1024;
export const MAX_SHARE_TREE_DEPTH = 128;

export interface ShareExportPolicy {
    includeCode: boolean;
    includeAuthors: boolean;
    includeReplies: boolean;
    includeBoardLayout: boolean;
}

export interface SharedSnapshot {
    id: string;
    fileId: string;
    range: { start: { line: number; char: number }; end: { line: number; char: number } };
    contentHash: string;
    languageId: string;
    code: string;
}

export interface ShareLineage {
    sourceAnalysisId: string;
    baseContentHash: string;
    previousBundleId: string | null;
}

export interface SharedAnalysis {
    id: string;
    title: string;
    purpose: string;
    revision: number;
    authors: Array<{ id: string; displayName: string }>;
    annotations: Annotation[];
    replies: AnnotationReply[];
    reviews: AnalysisDocument['reviews'];
    anchors: AnalysisDocument['anchors'];
    walkthroughs: Walkthrough[];
    goals: AnalysisDocument['goals'];
    importantLocations: AnalysisDocument['importantLocations'];
}

export interface ShareBundle {
    format: typeof SHARE_FORMAT;
    schemaVersion: typeof SHARE_SCHEMA_VERSION;
    bundleId: string;
    createdAt: string;
    producerVersion: string;
    lineage: ShareLineage;
    project: { name: string; repositoryId: string | null };
    baselines: SourceBaseline[];
    trails: StoredTrail[];
    analysis: SharedAnalysis;
    /** 왕복 병합을 위한 송신 시점의 기록·답글 기준이다. */
    mergeBase: { annotations: Annotation[]; replies: AnnotationReply[] };
    snapshots: SharedSnapshot[];
    exportPolicy: ShareExportPolicy;
    /** SHA-256. 이 필드를 제외한 정규 JSON의 해시다. */
    integrity: string;
}

export interface SharePreview {
    planId: string;
    analysisId: string;
    analysisRevision: number;
    trailCount: number;
    nodeCount: number;
    annotationCount: number;
    replyCount: number;
    snapshotCount: number;
    approximateBytes: number;
    warnings: string[];
    policy: ShareExportPolicy;
}

export interface MergeConflict {
    entity: 'annotation' | 'reply';
    id: string;
    reason: 'bothChanged' | 'deleteUpdate' | 'missingBase';
    localBody: string | null;
    incomingBody: string | null;
}

export interface MergePlan {
    id: string;
    additions: Array<Annotation | AnnotationReply>;
    updates: Array<Annotation | AnnotationReply>;
    deletions: Array<{ entity: 'annotation' | 'reply'; id: string }>;
    conflicts: MergeConflict[];
}

export function sharePayloadWithoutIntegrity(bundle: ShareBundle): Omit<ShareBundle, 'integrity'> {
    const { integrity: _integrity, ...rest } = bundle;
    return rest;
}

/** 객체 키를 정렬해 무결성 계산과 반복 내보내기를 결정적으로 만든다. */
export function canonicalJson(value: unknown): string {
    const normalize = (input: unknown): unknown => {
        if (Array.isArray(input)) {
            return input.map(normalize);
        }
        if (input !== null && typeof input === 'object') {
            const source = input as Record<string, unknown>;
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(source).sort()) {
                out[key] = normalize(source[key]);
            }
            return out;
        }
        return input;
    };
    return JSON.stringify(normalize(value));
}

export function currentAnnotations(annotations: readonly Annotation[]): Annotation[] {
    return annotations.filter((item) => item.deletedAt === null).map((item) => ({ ...item }));
}

/** 기록·답글만 보수적으로 세 방향 비교한다. 충돌한 본문은 계획에 그대로 남긴다. */
export function planShareMerge(local: AnalysisDocument, incoming: ShareBundle): MergePlan {
    const additions: MergePlan['additions'] = [];
    const updates: MergePlan['updates'] = [];
    const deletions: MergePlan['deletions'] = [];
    const conflicts: MergePlan['conflicts'] = [];
    const compare = <T extends Annotation | AnnotationReply>(
        entity: 'annotation' | 'reply',
        localItems: readonly T[],
        baseItems: readonly T[],
        incomingItems: readonly T[],
    ): void => {
        const localById = new Map(localItems.map((item) => [item.id, item]));
        const baseById = new Map(baseItems.map((item) => [item.id, item]));
        const incomingById = new Map(incomingItems.map((item) => [item.id, item]));
        const body = (item: T | undefined): string | null => item?.body ?? null;
        // 병합 판단은 벽시계나 각 복사본의 로컬 버전 번호에 기대지 않는다.
        // 적용 과정에서 이 둘은 달라지므로 의미 필드가 같은 회신을 다시 받아도
        // 새 충돌이나 중복 변경으로 보이면 안 된다.
        const comparable = (item: T | undefined): unknown => {
            if (!item) return null;
            const { version: _version, updatedAt: _updatedAt, ...meaning } = item;
            return meaning;
        };
        const same = (a: T | undefined, b: T | undefined): boolean =>
            canonicalJson(comparable(a)) === canonicalJson(comparable(b));

        for (const [id, next] of incomingById) {
            const base = baseById.get(id);
            const current = localById.get(id);
            if (!base) {
                if (!current) additions.push(JSON.parse(JSON.stringify(next)) as T);
                else if (!same(current, next)) conflicts.push({ entity, id, reason: 'missingBase', localBody: body(current), incomingBody: body(next) });
                continue;
            }
            if (same(next, base) || same(current, next)) continue;
            if (!current) {
                conflicts.push({ entity, id, reason: 'deleteUpdate', localBody: null, incomingBody: body(next) });
            } else if (same(current, base)) {
                updates.push(JSON.parse(JSON.stringify(next)) as T);
            } else {
                conflicts.push({ entity, id, reason: 'bothChanged', localBody: body(current), incomingBody: body(next) });
            }
        }
        for (const [id, base] of baseById) {
            if (incomingById.has(id)) continue;
            const current = localById.get(id);
            if (!current) continue;
            if (same(current, base)) deletions.push({ entity, id });
            else conflicts.push({ entity, id, reason: 'deleteUpdate', localBody: body(current), incomingBody: null });
        }
    };

    if (incoming.lineage.sourceAnalysisId !== local.id) {
        return { id: newEntityId(), additions, updates, deletions, conflicts: [{
            entity: 'annotation', id: incoming.analysis.id, reason: 'missingBase',
            localBody: null, incomingBody: null,
        }] };
    }
    compare('annotation', local.annotations, incoming.mergeBase.annotations, incoming.analysis.annotations);
    compare('reply', local.replies, incoming.mergeBase.replies, incoming.analysis.replies);
    return { id: newEntityId(), additions, updates, deletions, conflicts };
}
