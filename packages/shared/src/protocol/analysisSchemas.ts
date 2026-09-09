import { z } from 'zod';

import {
    ANALYSIS_SCHEMA_VERSION,
    MAX_ANALYSIS_ENTITIES,
    MAX_ANNOTATION_BYTES,
    MAX_REPLY_BYTES,
    MAX_TAG_LENGTH,
    MAX_TAGS,
    type AnalysisDocument,
    type AnalysisSummary,
    type Anchor,
    type Annotation,
    type AnnotationReply,
    type AnnotationTarget,
    type Author,
    type CodeRange,
    type ReviewRecord,
    type SourceBaseline,
    type Walkthrough,
} from '../domain/analysis.js';
import {
    MAX_SHARE_TREE_DEPTH,
    SHARE_FORMAT,
    SHARE_SCHEMA_VERSION,
    type ShareBundle,
    type ShareExportPolicy,
    type SharePreview,
} from '../domain/share.js';
import { storedTrailSchema, uuidSchema } from './schemas.js';

const utf8Length = (value: string): number => {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code <= 0x7f) bytes += 1;
        else if (code <= 0x7ff) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
            bytes += 4;
            index += 1;
        } else bytes += 3;
    }
    return bytes;
};

const boundedUtf8 = (bytes: number) => z.string().refine(
    (value) => utf8Length(value) <= bytes,
    { message: 'UTF-8 바이트 제한을 넘었다.' },
);

export const positionSchema = z.object({
    line: z.int().min(0),
    char: z.int().min(0),
});

export const codeRangeSchema = z.object({
    start: positionSchema,
    end: positionSchema,
}).refine((range) =>
    range.start.line < range.end.line
    || (range.start.line === range.end.line && range.start.char <= range.end.char),
{ message: '범위 끝이 시작보다 앞설 수 없다.' }) satisfies z.ZodType<CodeRange>;

export const annotationTargetSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('trail'), trailId: uuidSchema }),
    z.object({ kind: z.literal('node'), trailId: uuidSchema, nodeId: uuidSchema }),
    z.object({ kind: z.literal('range'), anchorId: uuidSchema }),
]) satisfies z.ZodType<AnnotationTarget>;

export const authorSchema = z.object({
    id: uuidSchema,
    displayName: z.string().trim().min(1).max(100),
}) satisfies z.ZodType<Author>;

export const annotationSchema = z.object({
    id: uuidSchema,
    version: z.int().min(1),
    target: annotationTargetSchema,
    kind: z.enum(['explanation', 'question', 'concern', 'conclusion']),
    body: boundedUtf8(MAX_ANNOTATION_BYTES).refine((body) => body.trim().length > 0),
    tags: z.array(z.string().trim().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS),
    status: z.enum(['open', 'resolved']),
    authorId: uuidSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
}) satisfies z.ZodType<Annotation>;

export const annotationReplySchema = z.object({
    id: uuidSchema,
    annotationId: uuidSchema,
    version: z.int().min(1),
    body: boundedUtf8(MAX_REPLY_BYTES).refine((body) => body.trim().length > 0),
    authorId: uuidSchema,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable(),
}) satisfies z.ZodType<AnnotationReply>;

export const anchorSchema = z.object({
    id: uuidSchema,
    version: z.int().min(1),
    baselineId: uuidSchema,
    fileId: uuidSchema,
    range: codeRangeSchema,
    selectedTextHash: z.string().regex(/^[a-f0-9]{64}$/),
    contextBeforeHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    contextAfterHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    selectedText: z.string().nullable(),
    contextBefore: z.string().nullable(),
    contextAfter: z.string().nullable(),
    symbolHint: z.object({
        name: z.string(),
        detail: z.string(),
        container: z.string(),
        kind: z.int(),
    }).nullable(),
    state: z.enum(['matched', 'moved', 'changed', 'ambiguous', 'missing', 'unknown']),
    currentRange: codeRangeSchema.nullable(),
    candidateIds: z.array(z.string().min(1)).max(100),
}) satisfies z.ZodType<Anchor>;

const baselineFileSchema = z.object({
    fileId: uuidSchema,
    relPath: z.string().min(1).refine((path) =>
        !path.includes('\\') && !path.startsWith('/') && !path.split('/').includes('..')),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    textEncoding: z.literal('utf-8'),
});

export const sourceBaselineSchema = z.object({
    id: uuidSchema,
    repositoryId: z.string().nullable(),
    commit: z.string().regex(/^[a-f0-9]{40,64}$/i).nullable(),
    dirty: z.boolean().nullable(),
    capturedAt: z.iso.datetime(),
    files: z.array(baselineFileSchema).max(MAX_ANALYSIS_ENTITIES),
}) satisfies z.ZodType<SourceBaseline>;

export const reviewRecordSchema = z.object({
    id: uuidSchema,
    target: annotationTargetSchema,
    baselineId: uuidSchema,
    state: z.enum(['unreviewed', 'reviewing', 'reviewed', 'needsReview']),
    authorId: uuidSchema,
    evidenceIds: z.array(uuidSchema).max(MAX_ANALYSIS_ENTITIES),
    version: z.int().min(1),
}) satisfies z.ZodType<ReviewRecord>;

const walkthroughStepSchema = z.object({
    id: uuidSchema,
    title: z.string().min(1).max(200),
    body: boundedUtf8(MAX_ANNOTATION_BYTES),
    annotationId: uuidSchema.nullable().default(null),
    target: annotationTargetSchema.nullable(),
    baselineId: uuidSchema.nullable(),
});

export const walkthroughSchema = z.object({
    id: uuidSchema,
    version: z.int().min(1),
    title: z.string().min(1).max(200),
    steps: z.array(walkthroughStepSchema).max(MAX_ANALYSIS_ENTITIES),
}) satisfies z.ZodType<Walkthrough>;

const goalSchema = z.object({
    id: uuidSchema,
    title: z.string().min(1).max(500),
    targetIds: z.array(uuidSchema).max(MAX_ANALYSIS_ENTITIES),
    evidenceIds: z.array(uuidSchema).max(MAX_ANALYSIS_ENTITIES),
});

const importantLocationSchema = z.object({
    id: uuidSchema,
    title: z.string().min(1).max(200),
    target: annotationTargetSchema,
});

const historySchema = z.object({
    id: uuidSchema,
    targetId: uuidSchema,
    fromVersion: z.int().min(0),
    toVersion: z.int().min(1),
    kind: z.enum(['created', 'updated', 'deleted', 'restored', 'replied', 'reviewed', 'rebound', 'merged']),
    actorId: uuidSchema,
    at: z.iso.datetime(),
    previousBody: boundedUtf8(MAX_ANNOTATION_BYTES).nullable(),
    changedFields: z.array(z.string().max(100)).max(100),
});

const processedCommandSchema = z.object({
    commandId: z.string().min(1).max(200),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    resultId: uuidSchema,
});

export const analysisDocumentSchema = z.object({
    schemaVersion: z.literal(ANALYSIS_SCHEMA_VERSION),
    id: uuidSchema,
    title: z.string().min(1).max(200),
    purpose: boundedUtf8(MAX_ANNOTATION_BYTES),
    revision: z.int().min(0),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    trailIds: z.array(uuidSchema).max(MAX_ANALYSIS_ENTITIES),
    authors: z.array(authorSchema).max(MAX_ANALYSIS_ENTITIES),
    annotations: z.array(annotationSchema).max(MAX_ANALYSIS_ENTITIES),
    replies: z.array(annotationReplySchema).max(MAX_ANALYSIS_ENTITIES),
    anchors: z.array(anchorSchema).max(MAX_ANALYSIS_ENTITIES),
    baselines: z.array(sourceBaselineSchema).max(MAX_ANALYSIS_ENTITIES),
    reviews: z.array(reviewRecordSchema).max(MAX_ANALYSIS_ENTITIES),
    walkthroughs: z.array(walkthroughSchema).max(1_000),
    goals: z.array(goalSchema).max(1_000),
    importantLocations: z.array(importantLocationSchema).max(MAX_ANALYSIS_ENTITIES),
    history: z.array(historySchema).max(MAX_ANALYSIS_ENTITIES),
    processedCommands: z.array(processedCommandSchema).max(1_024),
    sourceShare: z.object({
        bundleId: uuidSchema,
        sourceAnalysisId: uuidSchema,
        baseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
        originalIds: z.record(uuidSchema, uuidSchema),
        baseAnnotations: z.array(annotationSchema).max(MAX_ANALYSIS_ENTITIES),
        baseReplies: z.array(annotationReplySchema).max(MAX_ANALYSIS_ENTITIES),
    }).nullable(),
}) satisfies z.ZodType<AnalysisDocument>;

export const analysisSummarySchema = z.object({
    id: uuidSchema,
    title: z.string(),
    purpose: z.string(),
    revision: z.int().min(0),
    updatedAt: z.iso.datetime(),
    annotationCount: z.int().min(0),
    unresolvedCount: z.int().min(0),
    reviewedCount: z.int().min(0),
    reviewTargetCount: z.int().min(0),
}) satisfies z.ZodType<AnalysisSummary>;

export const shareExportPolicySchema = z.object({
    includeCode: z.boolean(),
    includeAuthors: z.boolean(),
    includeReplies: z.boolean(),
    includeBoardLayout: z.boolean(),
}) satisfies z.ZodType<ShareExportPolicy>;

const sharedSnapshotSchema = z.object({
    id: uuidSchema,
    fileId: uuidSchema,
    range: codeRangeSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    languageId: z.string(),
    code: z.string(),
});

export const shareBundleSchema = z.object({
    format: z.literal(SHARE_FORMAT),
    schemaVersion: z.literal(SHARE_SCHEMA_VERSION),
    bundleId: uuidSchema,
    createdAt: z.iso.datetime(),
    producerVersion: z.string().min(1),
    lineage: z.object({
        sourceAnalysisId: uuidSchema,
        baseContentHash: z.string().regex(/^[a-f0-9]{64}$/),
        previousBundleId: uuidSchema.nullable(),
    }),
    project: z.object({ name: z.string().max(200), repositoryId: z.string().nullable() }),
    baselines: z.array(sourceBaselineSchema).max(MAX_ANALYSIS_ENTITIES),
    trails: z.array(storedTrailSchema).max(MAX_ANALYSIS_ENTITIES),
    analysis: z.object({
        id: uuidSchema,
        title: z.string().min(1).max(200),
        purpose: boundedUtf8(MAX_ANNOTATION_BYTES),
        revision: z.int().min(0),
        authors: z.array(authorSchema).max(MAX_ANALYSIS_ENTITIES),
        annotations: z.array(annotationSchema).max(MAX_ANALYSIS_ENTITIES),
        replies: z.array(annotationReplySchema).max(MAX_ANALYSIS_ENTITIES),
        reviews: z.array(reviewRecordSchema).max(MAX_ANALYSIS_ENTITIES),
        anchors: z.array(anchorSchema).max(MAX_ANALYSIS_ENTITIES),
        walkthroughs: z.array(walkthroughSchema).max(1_000),
        goals: z.array(goalSchema).max(1_000),
        importantLocations: z.array(importantLocationSchema).max(MAX_ANALYSIS_ENTITIES),
    }),
    mergeBase: z.object({
        annotations: z.array(annotationSchema).max(MAX_ANALYSIS_ENTITIES),
        replies: z.array(annotationReplySchema).max(MAX_ANALYSIS_ENTITIES),
    }),
    snapshots: z.array(sharedSnapshotSchema).max(MAX_ANALYSIS_ENTITIES),
    exportPolicy: shareExportPolicySchema,
    integrity: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((bundle, context) => {
    const ids = new Set<string>();
    const add = (id: string, path: Array<string | number>): void => {
        if (ids.has(id)) context.addIssue({ code: 'custom', path, message: '중복 ID다.' });
        ids.add(id);
    };
    bundle.analysis.authors.forEach((value, index) => add(value.id, ['analysis', 'authors', index, 'id']));
    bundle.analysis.annotations.forEach((value, index) => add(value.id, ['analysis', 'annotations', index, 'id']));
    bundle.analysis.replies.forEach((value, index) => add(value.id, ['analysis', 'replies', index, 'id']));
    bundle.analysis.anchors.forEach((value, index) => add(value.id, ['analysis', 'anchors', index, 'id']));
    bundle.baselines.forEach((value, index) => {
        add(value.id, ['baselines', index, 'id']);
        value.files.forEach((file, fileIndex) => add(file.fileId, ['baselines', index, 'files', fileIndex, 'fileId']));
    });
    bundle.analysis.reviews.forEach((value, index) => add(value.id, ['analysis', 'reviews', index, 'id']));
    bundle.analysis.walkthroughs.forEach((value, index) => {
        add(value.id, ['analysis', 'walkthroughs', index, 'id']);
        value.steps.forEach((step, stepIndex) => add(step.id, ['analysis', 'walkthroughs', index, 'steps', stepIndex, 'id']));
    });
    bundle.analysis.goals.forEach((value, index) => add(value.id, ['analysis', 'goals', index, 'id']));
    bundle.analysis.importantLocations.forEach((value, index) => add(value.id, ['analysis', 'importantLocations', index, 'id']));
    bundle.snapshots.forEach((value, index) => add(value.id, ['snapshots', index, 'id']));

    const trailIds = new Set(bundle.trails.map((trail) => trail.id));
    const nodesByTrail = new Map<string, Set<string>>();
    bundle.trails.forEach((trail, trailIndex) => {
        add(trail.id, ['trails', trailIndex, 'id']);
        const nodeIds = new Set<string>();
        const stack = [...trail.roots];
        while (stack.length > 0) {
            const node = stack.pop();
            if (!node) break;
            add(node.id, ['trails', trailIndex, 'roots']);
            nodeIds.add(node.id);
            stack.push(...node.children);
        }
        nodesByTrail.set(trail.id, nodeIds);
    });
    const annotations = new Set(bundle.analysis.annotations.map((value) => value.id));
    const authors = new Set(bundle.analysis.authors.map((value) => value.id));
    const anchors = new Set(bundle.analysis.anchors.map((value) => value.id));
    const baselines = new Set(bundle.baselines.map((value) => value.id));
    const filesByBaseline = new Map(bundle.baselines.map((value) => [value.id, new Set(value.files.map((file) => file.fileId))]));
    const validTarget = (target: AnnotationTarget): boolean => {
        if (target.kind === 'trail') return trailIds.has(target.trailId);
        if (target.kind === 'node') return trailIds.has(target.trailId)
            && (nodesByTrail.get(target.trailId)?.has(target.nodeId) ?? false);
        return anchors.has(target.anchorId);
    };
    bundle.analysis.annotations.forEach((value, index) => {
        if (!authors.has(value.authorId)) context.addIssue({ code: 'custom', path: ['analysis', 'annotations', index, 'authorId'], message: '작성자 참조가 없다.' });
        if (!validTarget(value.target)) context.addIssue({ code: 'custom', path: ['analysis', 'annotations', index, 'target'], message: '대상 참조가 없다.' });
    });
    bundle.analysis.replies.forEach((value, index) => {
        if (!annotations.has(value.annotationId)) context.addIssue({
            code: 'custom', path: ['analysis', 'replies', index, 'annotationId'], message: '기록 참조가 없다.',
        });
        if (!authors.has(value.authorId)) context.addIssue({ code: 'custom', path: ['analysis', 'replies', index, 'authorId'], message: '작성자 참조가 없다.' });
    });
    bundle.analysis.anchors.forEach((value, index) => {
        if (!baselines.has(value.baselineId) || !(filesByBaseline.get(value.baselineId)?.has(value.fileId) ?? false)) {
            context.addIssue({ code: 'custom', path: ['analysis', 'anchors', index], message: '코드 기준 참조가 없다.' });
        }
    });
    bundle.analysis.reviews.forEach((value, index) => {
        if (!validTarget(value.target) || !baselines.has(value.baselineId) || !authors.has(value.authorId)
            || value.evidenceIds.some((id) => !annotations.has(id))) {
            context.addIssue({ code: 'custom', path: ['analysis', 'reviews', index], message: '검토 참조가 없다.' });
        }
    });
    bundle.analysis.walkthroughs.forEach((value, index) => value.steps.forEach((step, stepIndex) => {
        if ((step.annotationId && !annotations.has(step.annotationId))
            || (step.target && !validTarget(step.target))
            || (step.baselineId && !baselines.has(step.baselineId))) {
            context.addIssue({ code: 'custom', path: ['analysis', 'walkthroughs', index, 'steps', stepIndex], message: '안내 단계 참조가 없다.' });
        }
    }));
    bundle.analysis.importantLocations.forEach((value, index) => {
        if (!validTarget(value.target)) context.addIssue({ code: 'custom', path: ['analysis', 'importantLocations', index, 'target'], message: '중요 위치 참조가 없다.' });
    });
    const depth = (roots: ShareBundle['trails'][number]['roots']): number => {
        let maximum = 0;
        const stack = roots.map((node) => ({ node, level: 1 }));
        while (stack.length > 0) {
            const item = stack.pop();
            if (!item) break;
            maximum = Math.max(maximum, item.level);
            if (maximum > MAX_SHARE_TREE_DEPTH) return maximum;
            item.node.children.forEach((node) => stack.push({ node, level: item.level + 1 }));
        }
        return maximum;
    };
    bundle.trails.forEach((trail, index) => {
        if (depth(trail.roots) > MAX_SHARE_TREE_DEPTH) context.addIssue({
            code: 'custom', path: ['trails', index, 'roots'], message: '트리 깊이 제한을 넘었다.',
        });
    });
}) satisfies z.ZodType<ShareBundle>;

export const sharePreviewSchema = z.object({
    planId: uuidSchema,
    analysisId: uuidSchema,
    analysisRevision: z.int().min(0),
    trailCount: z.int().min(0),
    nodeCount: z.int().min(0),
    annotationCount: z.int().min(0),
    replyCount: z.int().min(0),
    snapshotCount: z.int().min(0),
    approximateBytes: z.int().min(0),
    warnings: z.array(z.string()),
    policy: shareExportPolicySchema,
}) satisfies z.ZodType<SharePreview>;
