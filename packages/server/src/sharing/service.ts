import { createHash } from 'node:crypto';

import {
    MAX_SHARE_BYTES,
    SHARE_FORMAT,
    SHARE_SCHEMA_VERSION,
    canonicalJson,
    cloneAnalysis,
    createAnalysis,
    newEntityId,
    parseWith,
    planShareMerge,
    shareBundleSchema,
    sharePayloadWithoutIntegrity,
    fromStoredTrail,
    toStoredTrail,
    trailToMarkdown,
    type AnalysisDocument,
    type AnnotationTarget,
    type ShareBundle,
    type ShareExportPolicy,
    type SharePreview,
    type MergePlan,
    type Author,
    type StoredTrail,
    type StoredTrailNode,
    type Trail,
} from '@code-trail/shared';

import type { AnalysisService } from '../analysis/service.js';
import type { TrailService } from '../trails/service.js';

const hash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const DEFAULT_POLICY: ShareExportPolicy = {
    includeCode: false,
    includeAuthors: true,
    includeReplies: true,
    includeBoardLayout: false,
};

interface Prepared {
    preview: SharePreview;
    bundle: ShareBundle;
}

function walkCount(nodes: readonly StoredTrailNode[]): number {
    let count = 0;
    const stack = [...nodes];
    while (stack.length > 0) {
        const node = stack.pop();
        if (!node) break;
        count += 1;
        stack.push(...node.children);
    }
    return count;
}

function shareTrail(trail: Trail, policy: ShareExportPolicy, restoreId: (id: string) => string): StoredTrail {
    const stored = toStoredTrail(trail);
    const cleanNode = (node: StoredTrailNode): StoredTrailNode => ({
        ...node,
        id: restoreId(node.id),
        parentId: node.parentId ? restoreId(node.parentId) : null,
        symbol: {
            ...node.symbol,
            displayPath: node.symbol.external ? '[프로젝트 외부]' : (node.symbol.relPath ?? '[경로 없음]'),
            relPath: node.symbol.external ? null : node.symbol.relPath,
            code: policy.includeCode ? node.symbol.code : '',
        },
        children: node.children.map(cleanNode),
    });
    return {
        ...stored,
        id: restoreId(stored.id),
        roots: stored.roots.map(cleanNode),
        nodeUi: policy.includeBoardLayout ? Object.fromEntries(Object.entries(stored.nodeUi).map(([id, value]) => [restoreId(id), value])) : {},
        activeNodeId: null,
    };
}

function sharedAnalysis(source: AnalysisDocument, policy: ShareExportPolicy): ShareBundle['analysis'] {
    const restoreId = (id: string): string => source.sourceShare?.originalIds[id] ?? id;
    const restoreTarget = (target: AnnotationTarget): AnnotationTarget => target.kind === 'trail'
        ? { kind: 'trail', trailId: restoreId(target.trailId) }
        : target.kind === 'node'
            ? { kind: 'node', trailId: restoreId(target.trailId), nodeId: restoreId(target.nodeId) }
            : { kind: 'range', anchorId: restoreId(target.anchorId) };
    const annotations = source.annotations.filter((item) => item.deletedAt === null);
    const annotationIds = new Set(annotations.map((item) => item.id));
    return {
        id: source.sourceShare?.sourceAnalysisId ?? source.id,
        title: source.title,
        purpose: source.purpose,
        revision: source.revision,
        authors: source.authors.map((item) => ({
            id: restoreId(item.id), displayName: policy.includeAuthors ? item.displayName : '익명',
        })),
        annotations: annotations.map((item) => ({
            ...item, id: restoreId(item.id), authorId: restoreId(item.authorId),
            target: restoreTarget(item.target), tags: [...item.tags],
        })),
        replies: policy.includeReplies
            ? source.replies.filter((item) => item.deletedAt === null && annotationIds.has(item.annotationId))
                .map((item) => ({
                    ...item, id: restoreId(item.id), annotationId: restoreId(item.annotationId),
                    authorId: restoreId(item.authorId),
                }))
            : [],
        reviews: source.reviews.map((item) => ({
            ...item, id: restoreId(item.id), target: restoreTarget(item.target),
            baselineId: restoreId(item.baselineId), authorId: restoreId(item.authorId),
            evidenceIds: item.evidenceIds.map(restoreId),
        })),
        anchors: source.anchors.map((item) => ({
            ...item, id: restoreId(item.id), baselineId: restoreId(item.baselineId), fileId: restoreId(item.fileId),
            selectedText: policy.includeCode ? item.selectedText : null,
            contextBefore: policy.includeCode ? item.contextBefore : null,
            contextAfter: policy.includeCode ? item.contextAfter : null,
            candidateIds: [],
        })),
        walkthroughs: source.walkthroughs.map((item) => ({
            ...item, id: restoreId(item.id),
            steps: item.steps.map((step) => ({
                ...step, id: restoreId(step.id), target: step.target ? restoreTarget(step.target) : null,
                annotationId: step.annotationId ? restoreId(step.annotationId) : null,
                baselineId: step.baselineId ? restoreId(step.baselineId) : null,
            })),
        })),
        goals: source.goals.map((item) => ({
            ...item, id: restoreId(item.id), targetIds: item.targetIds.map(restoreId), evidenceIds: item.evidenceIds.map(restoreId),
        })),
        importantLocations: source.importantLocations.map((item) => ({ ...item, id: restoreId(item.id), target: restoreTarget(item.target) })),
    };
}

export class SharingService {
    private readonly plans = new Map<string, Prepared>();
    private readonly importedBundles = new Map<string, string>();
    private readonly uploads = new Map<string, {
        byteLength: number; sha256: string; chunks: Map<number, Buffer>; createdAt: number; text?: string;
    }>();
    private readonly mergePlans = new Map<string, { plan: MergePlan; bundle: ShareBundle; localRevision: number }>();

    constructor(
        private readonly analyses: AnalysisService,
        private readonly trails: TrailService,
        private readonly projectName: string,
        private readonly producerVersion: string,
    ) {}

    prepare(analysisId: string, requested: Partial<ShareExportPolicy> = {}): SharePreview | undefined {
        const analysis = this.analyses.get(analysisId);
        if (!analysis) return undefined;
        const policy = { ...DEFAULT_POLICY, ...requested };
        const restoreId = (id: string): string => analysis.sourceShare?.originalIds[id] ?? id;
        const trails = analysis.trailIds
            .map((id) => this.trails.get(id))
            .filter((value): value is Trail => value !== undefined)
            .map((trail) => shareTrail(trail, policy, restoreId));
        const safeAnalysis = sharedAnalysis(analysis, policy);
        const withoutIntegrity = {
            format: SHARE_FORMAT,
            schemaVersion: SHARE_SCHEMA_VERSION,
            bundleId: newEntityId(),
            createdAt: new Date().toISOString(),
            producerVersion: this.producerVersion,
            lineage: {
                sourceAnalysisId: analysis.sourceShare?.sourceAnalysisId ?? analysis.id,
                baseContentHash: analysis.sourceShare?.baseContentHash ?? hash(canonicalJson(safeAnalysis)),
                previousBundleId: analysis.sourceShare?.bundleId ?? null,
            },
            project: { name: this.projectName, repositoryId: null },
            baselines: analysis.baselines.map((item) => ({
                ...item, id: restoreId(item.id),
                files: item.files.map((file) => ({ ...file, fileId: restoreId(file.fileId) })),
            })),
            trails,
            analysis: safeAnalysis,
            mergeBase: analysis.sourceShare ? {
                annotations: analysis.sourceShare.baseAnnotations.map((item) => ({ ...item, tags: [...item.tags] })),
                replies: analysis.sourceShare.baseReplies.map((item) => ({ ...item })),
            } : {
                annotations: safeAnalysis.annotations.map((item) => ({ ...item, tags: [...item.tags] })),
                replies: safeAnalysis.replies.map((item) => ({ ...item })),
            },
            snapshots: [],
            exportPolicy: policy,
        } satisfies Omit<ShareBundle, 'integrity'>;
        const bundle: ShareBundle = {
            ...withoutIntegrity,
            integrity: hash(canonicalJson(withoutIntegrity)),
        };
        const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
        const planId = newEntityId();
        const warnings = [
            '자유 입력 기록에는 사용자가 붙여 넣은 코드나 비밀값이 포함될 수 있다.',
            ...(policy.includeCode ? ['선택한 코드 본문을 포함한다.'] : ['코드 본문과 위치 문맥을 포함하지 않는다.']),
        ];
        const preview: SharePreview = {
            planId,
            analysisId,
            analysisRevision: analysis.revision,
            trailCount: trails.length,
            nodeCount: trails.reduce((sum, trail) => sum + walkCount(trail.roots), 0),
            annotationCount: safeAnalysis.annotations.length,
            replyCount: safeAnalysis.replies.length,
            snapshotCount: bundle.snapshots.length,
            approximateBytes: Buffer.byteLength(serialized, 'utf8'),
            warnings,
            policy,
        };
        if (preview.approximateBytes > MAX_SHARE_BYTES) throw new Error('공유 묶음 크기 제한을 넘었다.');
        this.plans.set(planId, { preview, bundle });
        if (this.plans.size > 32) this.plans.delete(this.plans.keys().next().value as string);
        return preview;
    }

    export(planId: string): { bundle: ShareBundle; text: string } | undefined {
        const prepared = this.plans.get(planId);
        if (!prepared) return undefined;
        const current = this.analyses.get(prepared.preview.analysisId);
        if (!current || current.revision !== prepared.preview.analysisRevision) return undefined;
        const parsed = parseWith(shareBundleSchema, prepared.bundle);
        if (!parsed.ok) throw new Error('공유 묶음을 검증하지 못했다.');
        return { bundle: parsed.value, text: `${JSON.stringify(parsed.value, null, 2)}\n` };
    }

    uploadStart(byteLength: number, expectedHash: string): string {
        this.pruneUploads();
        if (this.uploads.size >= 1) throw new Error('진행 중인 공유 업로드를 먼저 끝내야 한다.');
        const uploadId = newEntityId();
        this.uploads.set(uploadId, { byteLength, sha256: expectedHash, chunks: new Map(), createdAt: Date.now() });
        return uploadId;
    }

    uploadChunk(uploadId: string, index: number, base64: string): void {
        const upload = this.uploads.get(uploadId);
        if (!upload) throw new Error('공유 업로드를 찾을 수 없다.');
        if (upload.text !== undefined) throw new Error('이미 끝난 공유 업로드다.');
        const chunk = Buffer.from(base64, 'base64');
        if (chunk.byteLength > 256 * 1024) throw new Error('공유 청크가 너무 크다.');
        const existing = upload.chunks.get(index);
        if (existing && !existing.equals(chunk)) throw new Error('같은 청크 번호의 내용이 다르다.');
        upload.chunks.set(index, chunk);
    }

    uploadFinish(uploadId: string): ShareBundle {
        const upload = this.uploads.get(uploadId);
        if (!upload) throw new Error('공유 업로드를 찾을 수 없다.');
        const indexes = [...upload.chunks.keys()].sort((a, b) => a - b);
        if (indexes.some((value, index) => value !== index)) throw new Error('공유 청크 순서가 이어지지 않는다.');
        const bytes = Buffer.concat(indexes.map((index) => upload.chunks.get(index) as Buffer));
        if (bytes.byteLength !== upload.byteLength) throw new Error('공유 업로드 길이가 맞지 않는다.');
        const rawHash = createHash('sha256').update(bytes).digest('hex');
        if (rawHash !== upload.sha256) throw new Error('공유 업로드 해시가 맞지 않는다.');
        upload.text = bytes.toString('utf8');
        return this.parse(upload.text);
    }

    uploadedText(uploadId: string): string | undefined {
        return this.uploads.get(uploadId)?.text;
    }

    finishUpload(uploadId: string): void {
        this.uploads.delete(uploadId);
    }

    prepareMerge(bundle: ShareBundle): MergePlan | null {
        const local = this.analyses.get(bundle.lineage.sourceAnalysisId);
        if (!local || bundle.lineage.previousBundleId === null) return null;
        const plan = planShareMerge(local, bundle);
        this.mergePlans.set(plan.id, { plan, bundle, localRevision: local.revision });
        if (this.mergePlans.size > 32) this.mergePlans.delete(this.mergePlans.keys().next().value as string);
        return plan;
    }

    getMergePlan(planId: string): MergePlan | undefined {
        const value = this.mergePlans.get(planId)?.plan;
        return value ? JSON.parse(JSON.stringify(value)) as MergePlan : undefined;
    }

    async applyMerge(planId: string, commandId: string, actorId: string): Promise<AnalysisDocument> {
        const prepared = this.mergePlans.get(planId);
        if (!prepared) throw new Error('병합 계획이 없거나 만료되었다.');
        if (prepared.plan.conflicts.length > 0) throw new Error('충돌을 먼저 검토해야 한다.');
        const result = await this.analyses.applyMerge({
            analysisId: prepared.bundle.lineage.sourceAnalysisId,
            commandId,
            plan: prepared.plan,
            authors: prepared.bundle.analysis.authors as Author[],
            actorId,
            expectedRevision: prepared.localRevision,
        });
        if (!result.ok) throw new Error(result.error.message);
        this.mergePlans.delete(planId);
        return result.value.document;
    }

    private pruneUploads(): void {
        const cutoff = Date.now() - 15 * 60_000;
        for (const [id, upload] of this.uploads) {
            if (upload.createdAt < cutoff) this.uploads.delete(id);
        }
    }

    parse(text: string): ShareBundle {
        if (Buffer.byteLength(text, 'utf8') > MAX_SHARE_BYTES) throw new Error('공유 묶음이 너무 크다.');
        let raw: unknown;
        try { raw = JSON.parse(text); } catch { throw new Error('공유 묶음 JSON을 읽을 수 없다.'); }
        const parsed = parseWith(shareBundleSchema, raw);
        if (!parsed.ok) throw new Error('공유 묶음 형식이 맞지 않는다.');
        const expected = hash(canonicalJson(sharePayloadWithoutIntegrity(parsed.value)));
        if (expected !== parsed.value.integrity) throw new Error('공유 묶음 무결성 검사가 실패했다.');
        return parsed.value;
    }

    async import(text: string, forceCopy = false): Promise<{ analysis: AnalysisDocument; duplicate: boolean }> {
        const bundle = this.parse(text);
        const existingId = this.importedBundles.get(bundle.bundleId);
        if (existingId && !forceCopy) {
            const existing = this.analyses.get(existingId);
            if (existing) return { analysis: existing, duplicate: true };
        }
        const trailMap = new Map<string, string>();
        const nodeMap = new Map<string, string>();
        const importedTrails: StoredTrail[] = bundle.trails.map((trail) => {
            const trailId = newEntityId();
            trailMap.set(trail.id, trailId);
            const mapNode = (node: StoredTrailNode, parentId: string | null): StoredTrailNode => {
                const id = newEntityId();
                nodeMap.set(node.id, id);
                const mapped: StoredTrailNode = { ...node, id, parentId, children: [] };
                mapped.children = node.children.map((child) => mapNode(child, id));
                return mapped;
            };
            return { ...trail, id: trailId, roots: trail.roots.map((node) => mapNode(node, null)), nodeUi: {}, activeNodeId: null };
        });
        const committedTrailIds: string[] = [];
        try {
            for (const trail of importedTrails) {
                await this.trails.importStored(trail);
                committedTrailIds.push(trail.id);
            }

        const authorMap = new Map(bundle.analysis.authors.map((value) => [value.id, newEntityId()]));
        const anchorMap = new Map(bundle.analysis.anchors.map((value) => [value.id, newEntityId()]));
        const annotationMap = new Map(bundle.analysis.annotations.map((value) => [value.id, newEntityId()]));
        const replyMap = new Map(bundle.analysis.replies.map((value) => [value.id, newEntityId()]));
        const reviewMap = new Map(bundle.analysis.reviews.map((value) => [value.id, newEntityId()]));
        const walkthroughMap = new Map(bundle.analysis.walkthroughs.map((value) => [value.id, newEntityId()]));
        const stepMap = new Map(bundle.analysis.walkthroughs.flatMap((value) => value.steps.map((step) => [step.id, newEntityId()] as const)));
        const goalMap = new Map(bundle.analysis.goals.map((value) => [value.id, newEntityId()]));
        const importantMap = new Map(bundle.analysis.importantLocations.map((value) => [value.id, newEntityId()]));
        const baselineMap = new Map(bundle.baselines.map((value) => [value.id, newEntityId()]));
        const fileMap = new Map(bundle.baselines.flatMap((value) => value.files.map((file) => [file.fileId, newEntityId()] as const)));
        const allMaps = [trailMap, nodeMap, authorMap, anchorMap, annotationMap, replyMap,
            reviewMap, walkthroughMap, stepMap, goalMap, importantMap, baselineMap, fileMap];
        const localId = (id: string): string => {
            for (const map of allMaps) {
                const found = map.get(id);
                if (found) return found;
            }
            return id;
        };
        const mapTarget = (target: AnnotationTarget): AnnotationTarget => {
            if (target.kind === 'trail') return { kind: 'trail', trailId: trailMap.get(target.trailId) ?? target.trailId };
            if (target.kind === 'node') return {
                kind: 'node', trailId: trailMap.get(target.trailId) ?? target.trailId,
                nodeId: nodeMap.get(target.nodeId) ?? target.nodeId,
            };
            return { kind: 'range', anchorId: anchorMap.get(target.anchorId) ?? target.anchorId };
        };
        const now = new Date().toISOString();
        const analysis = createAnalysis({
            id: newEntityId(), title: bundle.analysis.title, purpose: bundle.analysis.purpose,
            trailIds: importedTrails.map((trail) => trail.id), now,
        });
        analysis.authors = bundle.analysis.authors.map((item) => ({ ...item, id: authorMap.get(item.id) as string }));
        analysis.baselines = bundle.baselines.map((item) => ({
            ...item, id: baselineMap.get(item.id) as string,
            files: item.files.map((file) => ({ ...file, fileId: fileMap.get(file.fileId) as string })),
        }));
        analysis.anchors = bundle.analysis.anchors.map((item) => ({
            ...item, id: anchorMap.get(item.id) as string,
            baselineId: baselineMap.get(item.baselineId) ?? item.baselineId,
            fileId: fileMap.get(item.fileId) ?? item.fileId,
            version: 1, state: 'unknown', currentRange: null, candidateIds: [],
        }));
        analysis.annotations = bundle.analysis.annotations.map((item) => ({
            ...item, id: annotationMap.get(item.id) as string, target: mapTarget(item.target),
            authorId: authorMap.get(item.authorId) ?? item.authorId, version: 1,
        }));
        analysis.replies = bundle.analysis.replies.map((item) => ({
            ...item, id: replyMap.get(item.id) as string, annotationId: annotationMap.get(item.annotationId) ?? item.annotationId,
            authorId: authorMap.get(item.authorId) ?? item.authorId, version: 1,
        }));
        analysis.reviews = bundle.analysis.reviews.map((item) => ({
            ...item, id: reviewMap.get(item.id) as string, target: mapTarget(item.target),
            baselineId: baselineMap.get(item.baselineId) ?? item.baselineId,
            authorId: authorMap.get(item.authorId) ?? item.authorId,
            evidenceIds: item.evidenceIds.map(localId), version: 1,
        }));
        analysis.walkthroughs = bundle.analysis.walkthroughs.map((item) => ({
            ...item, id: walkthroughMap.get(item.id) as string, version: 1,
            steps: item.steps.map((step) => ({
                ...step, id: stepMap.get(step.id) as string,
                annotationId: step.annotationId ? annotationMap.get(step.annotationId) ?? step.annotationId : null,
                target: step.target ? mapTarget(step.target) : null,
                baselineId: step.baselineId ? localId(step.baselineId) : null,
            })),
        }));
        analysis.goals = bundle.analysis.goals.map((item) => ({
            ...item, id: goalMap.get(item.id) as string,
            targetIds: item.targetIds.map(localId), evidenceIds: item.evidenceIds.map(localId),
        }));
        analysis.importantLocations = bundle.analysis.importantLocations.map((item) => ({
            ...item, id: importantMap.get(item.id) as string, target: mapTarget(item.target),
        }));
        analysis.sourceShare = {
            bundleId: bundle.bundleId,
            sourceAnalysisId: bundle.lineage.sourceAnalysisId,
            baseContentHash: bundle.lineage.baseContentHash,
            originalIds: Object.fromEntries(allMaps.flatMap((map) => [...map].map(([original, local]) => [local, original]))),
            baseAnnotations: bundle.mergeBase.annotations.map((item) => ({ ...item, tags: [...item.tags] })),
            baseReplies: bundle.mergeBase.replies.map((item) => ({ ...item })),
        };
            await this.analyses.import(analysis);
            this.importedBundles.set(bundle.bundleId, analysis.id);
            return { analysis: cloneAnalysis(analysis), duplicate: false };
        } catch (error) {
            for (const trailId of committedTrailIds.reverse()) {
                await this.trails.remove(trailId).catch(() => undefined);
            }
            throw error;
        }
    }

    markdown(bundle: ShareBundle): string {
        const plain = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const oneLine = (value: string): string => plain(value.replace(/[\r\n]+/g, ' '));
        const lines: string[] = [`# ${oneLine(bundle.analysis.title)}`, ''];
        if (bundle.analysis.purpose) lines.push(plain(bundle.analysis.purpose), '');
        lines.push('## 목차', '', '- [코드 기준](#코드-기준)', '- [안내 순서](#안내-순서)', '- [분석 기록](#분석-기록)');
        if (bundle.exportPolicy.includeCode) lines.push('- [포함된 코드](#포함된-코드)');
        lines.push('## 코드 기준', '');
        for (const baseline of bundle.baselines) {
            lines.push(`- ${baseline.commit ?? '커밋 미확인'} · ${baseline.capturedAt} · 파일 ${baseline.files.length}개`);
        }
        lines.push('', '## 안내 순서', '');
        for (const walkthrough of bundle.analysis.walkthroughs) {
            lines.push(`### ${oneLine(walkthrough.title)}`, '');
            walkthrough.steps.forEach((step, index) => lines.push(`${index + 1}. **${oneLine(step.title)}** — ${plain(step.body)}`));
        }
        lines.push('', '## 분석 기록', '');
        for (const item of bundle.analysis.annotations) {
            const author = bundle.analysis.authors.find((value) => value.id === item.authorId)?.displayName ?? '익명';
            const review = bundle.analysis.reviews.find((value) => JSON.stringify(value.target) === JSON.stringify(item.target));
            lines.push(`### ${kindLabel(item.kind)} · ${oneLine(author)}`, '', plain(item.body), '', `- 처리: ${item.status === 'resolved' ? '해결됨' : '열림'}`);
            lines.push(`- 검토: ${reviewLabel(review?.state ?? 'unreviewed')}`);
            if (item.target.kind === 'range') {
                const anchorId = item.target.anchorId;
                const anchor = bundle.analysis.anchors.find((value) => value.id === anchorId);
                const file = bundle.baselines.find((value) => value.id === anchor?.baselineId)?.files.find((value) => value.fileId === anchor?.fileId);
                if (anchor && file) lines.push(`- 범위: ${oneLine(file.relPath)}:${anchor.range.start.line + 1}:${anchor.range.start.char + 1}`);
            }
            if (item.tags.length > 0) lines.push(`- 태그: ${item.tags.join(', ')}`);
            for (const reply of bundle.analysis.replies.filter((value) => value.annotationId === item.id)) {
                const replyAuthor = bundle.analysis.authors.find((value) => value.id === reply.authorId)?.displayName ?? '익명';
                lines.push('', `> ${oneLine(replyAuthor)}: ${plain(reply.body).replace(/\n/g, '\n> ')}`);
            }
            lines.push('');
        }
        const unresolved = bundle.analysis.annotations.filter((item) =>
            (item.kind === 'question' || item.kind === 'concern') && item.status === 'open');
        lines.push('', '## 미해결 사항', '');
        if (unresolved.length === 0) lines.push('- 없다.');
        else unresolved.forEach((item) => lines.push(`- ${plain(item.body).replace(/\n/g, ' ')}`));
        if (bundle.exportPolicy.includeCode) {
            lines.push('## 포함된 코드', '');
            // 트레일 Markdown 과 같은 함수를 쓴다(V23). 두 내보내기가 다른 문서를
            // 만들면 같은 이름의 내보내기 둘이 다른 문서가 된다.
            for (const stored of bundle.trails) {
                lines.push(trailToMarkdown(fromStoredTrail(stored), {
                    title: oneLine(stored.title),
                    trailId: stored.id,
                    annotations: bundle.analysis.annotations,
                    reviews: bundle.analysis.reviews,
                }).replace(/^# /, '### '), '');
            }
        }
        return `${lines.join('\n').trimEnd()}\n`;
    }

    staticHtml(bundle: ShareBundle): string {
        const escape = (value: string): string => value
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        const reference = (target: Record<string, string>): string => {
            const params = new URLSearchParams({
                bundle: bundle.bundleId,
                analysis: bundle.analysis.id,
                ...target,
            });
            return params.toString();
        };
        const annotations = bundle.analysis.annotations.map((item) =>
            `<article id="${escape(reference({ annotation: item.id }))}"><h3>${escape(kindLabel(item.kind))}</h3><p>${escape(item.body).replace(/\n/g, '<br>')}</p><small>${escape(item.tags.join(', '))}</small><a href="#${escape(reference({ annotation: item.id }))}">기록 링크</a></article>`).join('');
        const flatSteps = bundle.analysis.walkthroughs.flatMap((walkthrough) =>
            walkthrough.steps.map((step) => ({ walkthrough, step })));
        const steps = flatSteps
            .map(({ walkthrough, step }, index) => {
                const stepReference = reference({ walkthrough: walkthrough.id, step: step.id });
                const annotationLink = step.annotationId
                    ? `<a href="#${escape(reference({ annotation: step.annotationId }))}">연결된 기록</a>`
                    : '';
                const nodeLink = !step.annotationId && step.target?.kind === 'node'
                    ? `<a href="#${escape(reference({ trail: step.target.trailId, node: step.target.nodeId }))}">연결된 노드</a>`
                    : '';
                // 스크립트가 없으므로 앵커 링크로만 따라 읽는다(V13). `:target` 이
                // 지금 단계를 표시하고, 이전·다음이 그 자리를 옮긴다.
                const neighbour = (offset: -1 | 1, label: string): string => {
                    const other = flatSteps[index + offset];
                    if (!other) return '';
                    const href = reference({ walkthrough: other.walkthrough.id, step: other.step.id });
                    return `<a class="walk-nav" href="#${escape(href)}">${label}</a>`;
                };
                return `<li id="${escape(stepReference)}"><strong>${index + 1}. ${escape(step.title)}</strong><p>${escape(step.body)}</p>${annotationLink}${nodeLink}${neighbour(-1, '← 이전')}${neighbour(1, '다음 →')}<a href="#${escape(stepReference)}">단계 링크</a></li>`;
            }).join('');
        // 트리 구조를 지킨다(V23). 평평하게 늘어놓으면 "무엇에서 무엇으로
        // 들어갔는지" 가 사라져 코드 조각 목록이 된다.
        const renderNode = (trailId: string, node: StoredTrailNode, ordinal: number): string => {
            const id = escape(reference({ trail: trailId, node: node.id }));
            const index = ordinal > 0 ? `${circledOrdinal(ordinal)} ` : '';
            const children = node.children
                .map((child, position) => renderNode(trailId, child, position + 1)).join('');
            const origin = node.origin
                ? `<small>↑ 부모의 ${node.origin.line + 1}번째 줄 ${escape(node.origin.text)}</small>`
                : '';
            return `<details id="${id}" open><summary>${index}${escape(node.symbol.name)} · ${escape(node.symbol.displayPath)}</summary>${origin}<pre><code>${escape(node.symbol.code || '코드가 포함되지 않았다.')}</code></pre>${children}</details>`;
        };
        const code = bundle.trails.map((trail) => trail.roots
            .map((root, index) => renderNode(trail.id, root, trail.roots.length > 1 ? index + 1 : 0))
            .join('')).join('');
        return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${escape(bundle.analysis.title)}</title><style>body{font:16px/1.6 system-ui;max-width:1100px;margin:auto;padding:2rem;color:#18212b}main{display:grid;grid-template-columns:minmax(0,2fr) minmax(18rem,1fr);gap:2rem}article,details{border:1px solid #ccd5df;border-radius:8px;padding:.8rem;margin:.7rem 0}article:target,details:target,li:target{outline:3px solid #4f72d8;outline-offset:3px}pre{overflow:auto;background:#f4f6f8;padding:1rem}small{color:#526170}a{color:#315fbd;margin-right:.8rem}@media(max-width:760px){main{display:block}}</style><body><header><h1>${escape(bundle.analysis.title)}</h1><p>${escape(bundle.analysis.purpose)}</p><p>읽기 전용 공유 자료 · ${escape(bundle.createdAt)}</p></header><main><section><h2>코드</h2>${code}</section><aside><h2>안내 순서</h2><ol>${steps}</ol><h2>분석 기록</h2>${annotations}</aside></main></body></html>`;
    }
}

/** 형제 순번. 트레일 패널의 ①과 같은 글자다. */
function circledOrdinal(index: number): string {
    return index >= 1 && index <= 20
        ? String.fromCharCode(0x2460 + index - 1)
        : `(${index})`;
}

function kindLabel(kind: string): string {
    return ({ explanation: '설명', question: '질문', concern: '우려', conclusion: '결론' } as Record<string, string>)[kind] ?? kind;
}

function reviewLabel(state: string): string {
    return ({ unreviewed: '미검토', reviewing: '확인 중', reviewed: '확인함', needsReview: '재검토 필요' } as Record<string, string>)[state] ?? state;
}
