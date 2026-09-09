import { createHash } from 'node:crypto';

import {
    MAX_ANALYSIS_ENTITIES,
    MAX_TAGS,
    cloneAnalysis,
    createAnalysis,
    newEntityId,
    summarizeAnalysis,
    type AnalysisDocument,
    type AnalysisSummary,
    type Annotation,
    type AnnotationKind,
    type AnnotationReply,
    type AnnotationStatus,
    type AnnotationTarget,
    type Author,
    type CodeRange,
    type CommandError,
    type ReviewState,
    type ReviewGoal,
    type ImportantLocation,
    type MergePlan,
    type SourceBaseline,
    type WalkthroughStep,
} from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import type { AnalysisStore } from '../persistence/analysisStore.js';

export type AnalysisResult<T> = { ok: true; value: T } | { ok: false; error: CommandError };

const fail = (code: CommandError['code'], message: string, retryable = false): AnalysisResult<never> => ({
    ok: false,
    error: { code, message, retryable },
});

const fingerprint = (value: unknown): string => createHash('sha256')
    .update(JSON.stringify(value), 'utf8').digest('hex');

export class AnalysisService {
    private readonly documents = new Map<string, AnalysisDocument>();
    private readonly queues = new Map<string, Promise<unknown>>();
    private readonly logger: Logger;

    constructor(private readonly store: AnalysisStore, logger: Logger) {
        this.logger = logger.child('analysis');
    }

    async load(): Promise<void> {
        for (const id of await this.store.listIds()) {
            const document = await this.store.load(id);
            if (document) this.documents.set(document.id, document);
        }
        this.logger.info('분석 문서를 불러왔다.', { count: this.documents.size });
    }

    list(): AnalysisSummary[] {
        return [...this.documents.values()].map(summarizeAnalysis)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }

    get(id: string): AnalysisDocument | undefined {
        const value = this.documents.get(id);
        return value ? cloneAnalysis(value) : undefined;
    }

    async create(args: {
        title?: string;
        purpose?: string;
        trailIds?: string[];
        author?: Author;
    }): Promise<AnalysisDocument> {
        const value = createAnalysis(args);
        await this.store.save(value);
        this.documents.set(value.id, value);
        return cloneAnalysis(value);
    }

    updatePlan(args: {
        analysisId: string; commandId: string; baseRevision: number; purpose: string;
        goals: ReviewGoal[]; importantLocations: ImportantLocation[]; actorId: string;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            if (document.revision !== args.baseRevision) {
                return fail('ANNOTATION_CONFLICT', '분석 계획이 다른 곳에서 먼저 바뀌었다.', true);
            }
            document.purpose = args.purpose;
            document.goals = args.goals.map((goal) => ({
                ...goal, targetIds: [...new Set(goal.targetIds)], evidenceIds: [...new Set(goal.evidenceIds)],
            }));
            document.importantLocations = args.importantLocations.map((item) => ({ ...item }));
            return { ok: true, value: document.id };
        });
    }

    applyMerge(args: {
        analysisId: string; commandId: string; plan: MergePlan; authors: Author[]; actorId: string;
        expectedRevision: number;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            if (document.revision !== args.expectedRevision) {
                return fail('ANNOTATION_CONFLICT', '병합 내용을 확인한 뒤 원본 분석이 바뀌었다. 다시 비교한다.', true);
            }
            for (const author of args.authors) {
                if (!document.authors.some((item) => item.id === author.id)) document.authors.push({ ...author });
            }
            const now = new Date().toISOString();
            for (const value of args.plan.additions) {
                if ('annotationId' in value) document.replies.push({ ...value, version: 1 });
                else document.annotations.push({ ...value, tags: [...value.tags], version: 1 });
            }
            for (const value of args.plan.updates) {
                if ('annotationId' in value) {
                    const current = document.replies.find((item) => item.id === value.id);
                    if (current) Object.assign(current, value, { version: current.version + 1, updatedAt: now });
                } else {
                    const current = document.annotations.find((item) => item.id === value.id);
                    if (current) Object.assign(current, value, { tags: [...value.tags], version: current.version + 1, updatedAt: now });
                }
            }
            for (const deletion of args.plan.deletions) {
                const current = deletion.entity === 'annotation'
                    ? document.annotations.find((item) => item.id === deletion.id)
                    : document.replies.find((item) => item.id === deletion.id);
                if (current) { current.deletedAt = now; current.version += 1; current.updatedAt = now; }
            }
            for (const entity of [...args.plan.additions, ...args.plan.updates]) {
                document.history.push({
                    id: newEntityId(), targetId: entity.id, fromVersion: Math.max(0, entity.version - 1),
                    toVersion: entity.version, kind: 'merged', actorId: args.actorId, at: now,
                    previousBody: null, changedFields: ['body'],
                });
            }
            return { ok: true, value: args.plan.id };
        });
    }

    async import(document: AnalysisDocument): Promise<AnalysisDocument> {
        await this.store.save(document);
        this.documents.set(document.id, cloneAnalysis(document));
        return cloneAnalysis(document);
    }

    async reload(id: string): Promise<AnalysisDocument | undefined> {
        const document = await this.store.load(id);
        if (!document) return undefined;
        this.documents.set(id, document);
        return cloneAnalysis(document);
    }

    async remove(id: string): Promise<AnalysisResult<null>> {
        if (!this.documents.has(id)) return fail('NOT_FOUND', '분석 문서를 찾을 수 없다.');
        this.documents.delete(id);
        await this.store.remove(id);
        return { ok: true, value: null };
    }

    private enqueue<T>(id: string, work: () => Promise<T>): Promise<T> {
        const previous = this.queues.get(id) ?? Promise.resolve();
        const next = previous.then(work, work);
        this.queues.set(id, next.catch(() => undefined));
        return next;
    }

    private async change<T>(
        id: string,
        commandId: string,
        input: unknown,
        apply: (document: AnalysisDocument) => AnalysisResult<T>,
    ): Promise<AnalysisResult<{ document: AnalysisDocument; result: T; persistedRevision: number }>> {
        return this.enqueue(id, async () => {
            const current = this.documents.get(id);
            if (!current) return fail('NOT_FOUND', '분석 문서를 찾을 수 없다.');
            const hash = fingerprint(input);
            const duplicate = current.processedCommands.find((item) => item.commandId === commandId);
            if (duplicate) {
                if (duplicate.fingerprint !== hash) return fail('INVALID_COMMAND', '같은 명령 ID의 내용이 다르다.');
                return { ok: true as const, value: {
                    document: cloneAnalysis(current),
                    result: duplicate.resultId as T,
                    persistedRevision: current.revision,
                } };
            }
            const draft = cloneAnalysis(current);
            const result = apply(draft);
            if (!result.ok) return result;
            draft.revision += 1;
            draft.updatedAt = new Date().toISOString();
            const resultId = typeof result.value === 'string' ? result.value : newEntityId();
            draft.processedCommands.push({ commandId, fingerprint: hash, resultId });
            if (draft.processedCommands.length > 1_024) draft.processedCommands.splice(0, 256);
            try {
                await this.store.save(draft);
            } catch {
                return fail('PERSISTENCE_FAILED', '분석 기록을 디스크에 저장하지 못했다.', true);
            }
            this.documents.set(id, draft);
            return { ok: true as const, value: {
                document: cloneAnalysis(draft),
                result: result.value,
                persistedRevision: draft.revision,
            } };
        });
    }

    createAnnotation(args: {
        analysisId: string;
        commandId: string;
        target: AnnotationTarget;
        body: string;
        kind: AnnotationKind;
        tags?: string[];
        author: Author;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            if (!args.body.trim()) return fail('INVALID_COMMAND', '기록 본문이 비어 있다.');
            if ((args.tags?.length ?? 0) > MAX_TAGS) return fail('INVALID_COMMAND', '태그가 너무 많다.');
            if (document.annotations.length >= MAX_ANALYSIS_ENTITIES) return fail('INVALID_COMMAND', '기록 개수 제한을 넘었다.');
            if (!document.authors.some((author) => author.id === args.author.id)) {
                document.authors.push({ ...args.author });
            }
            const now = new Date().toISOString();
            const annotation: Annotation = {
                id: newEntityId(), version: 1, target: args.target, body: args.body,
                kind: args.kind, tags: [...new Set(args.tags ?? [])], status: 'open',
                authorId: args.author.id, createdAt: now, updatedAt: now, deletedAt: null,
            };
            document.annotations.push(annotation);
            document.history.push({
                id: newEntityId(), targetId: annotation.id, fromVersion: 0, toVersion: 1,
                kind: 'created', actorId: args.author.id, at: now, previousBody: null,
                changedFields: ['body', 'kind', 'tags', 'target'],
            });
            return { ok: true, value: annotation.id };
        });
    }

    updateAnnotation(args: {
        analysisId: string; commandId: string; annotationId: string; baseVersion: number;
        actorId: string; patch: Partial<Pick<Annotation, 'body' | 'kind' | 'tags' | 'status'>>;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            const annotation = document.annotations.find((item) => item.id === args.annotationId);
            if (!annotation) return fail('NOT_FOUND', '분석 기록을 찾을 수 없다.');
            if (annotation.version !== args.baseVersion) return fail('ANNOTATION_CONFLICT', '다른 곳에서 같은 기록을 먼저 수정했다.', true);
            if (annotation.deletedAt !== null) return fail('INVALID_COMMAND', '삭제된 기록은 먼저 복원해야 한다.');
            const previousBody = annotation.body;
            const changedFields = Object.keys(args.patch);
            Object.assign(annotation, args.patch);
            annotation.tags = [...new Set(annotation.tags)];
            annotation.version += 1;
            annotation.updatedAt = new Date().toISOString();
            document.history.push({
                id: newEntityId(), targetId: annotation.id, fromVersion: args.baseVersion,
                toVersion: annotation.version, kind: 'updated', actorId: args.actorId,
                at: annotation.updatedAt, previousBody, changedFields,
            });
            return { ok: true, value: annotation.id };
        });
    }

    setDeleted(args: {
        analysisId: string; commandId: string; annotationId: string; baseVersion: number;
        actorId: string; deleted: boolean;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            const item = document.annotations.find((value) => value.id === args.annotationId);
            if (!item) return fail('NOT_FOUND', '분석 기록을 찾을 수 없다.');
            if (item.version !== args.baseVersion) return fail('ANNOTATION_CONFLICT', '기록 버전이 달라졌다.', true);
            const now = new Date().toISOString();
            item.deletedAt = args.deleted ? now : null;
            item.version += 1;
            item.updatedAt = now;
            document.history.push({
                id: newEntityId(), targetId: item.id, fromVersion: args.baseVersion,
                toVersion: item.version, kind: args.deleted ? 'deleted' : 'restored',
                actorId: args.actorId, at: now, previousBody: null, changedFields: ['deletedAt'],
            });
            return { ok: true, value: item.id };
        });
    }

    reply(args: {
        analysisId: string; commandId: string; annotationId: string; body: string; author: Author;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            const annotation = document.annotations.find((item) => item.id === args.annotationId);
            if (!annotation || annotation.deletedAt !== null) return fail('NOT_FOUND', '답글을 달 기록이 없다.');
            if (!document.authors.some((author) => author.id === args.author.id)) document.authors.push(args.author);
            const now = new Date().toISOString();
            const reply: AnnotationReply = {
                id: newEntityId(), annotationId: annotation.id, version: 1, body: args.body,
                authorId: args.author.id, createdAt: now, updatedAt: now, deletedAt: null,
            };
            document.replies.push(reply);
            document.history.push({
                id: newEntityId(), targetId: reply.id, fromVersion: 0, toVersion: 1,
                kind: 'replied', actorId: args.author.id, at: now, previousBody: null,
                changedFields: ['body'],
            });
            return { ok: true, value: reply.id };
        });
    }

    setReview(args: {
        analysisId: string; commandId: string; target: AnnotationTarget; baselineId: string;
        state: ReviewState; authorId: string; evidenceIds: string[];
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            const key = JSON.stringify(args.target);
            let review = document.reviews.find((item) => JSON.stringify(item.target) === key);
            const now = new Date().toISOString();
            if (!review) {
                review = { id: newEntityId(), target: args.target, baselineId: args.baselineId,
                    state: args.state, authorId: args.authorId, evidenceIds: args.evidenceIds, version: 1 };
                document.reviews.push(review);
            } else {
                review.state = args.state;
                review.baselineId = args.baselineId;
                review.evidenceIds = [...new Set(args.evidenceIds)];
                review.version += 1;
            }
            document.history.push({
                id: newEntityId(), targetId: review.id, fromVersion: review.version - 1,
                toVersion: review.version, kind: 'reviewed', actorId: args.authorId, at: now,
                previousBody: null, changedFields: ['state', 'baselineId', 'evidenceIds'],
            });
            return { ok: true, value: review.id };
        });
    }

    updateWalkthrough(args: {
        analysisId: string; commandId: string; walkthroughId?: string;
        baseVersion?: number; title: string; steps: WalkthroughStep[]; actorId: string;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            const stepIds = new Set<string>();
            for (const step of args.steps) {
                if (stepIds.has(step.id)) return fail('INVALID_COMMAND', '안내 단계 ID가 중복됐다.');
                stepIds.add(step.id);
                if (step.annotationId && !document.annotations.some((item) => item.id === step.annotationId)) {
                    return fail('NOT_FOUND', '안내 단계가 가리키는 기록이 없다.');
                }
            }
            let walkthrough = args.walkthroughId
                ? document.walkthroughs.find((item) => item.id === args.walkthroughId)
                : undefined;
            if (walkthrough && walkthrough.version !== args.baseVersion) {
                return fail('ANNOTATION_CONFLICT', '안내 순서가 다른 곳에서 바뀌었다.', true);
            }
            if (!walkthrough) {
                walkthrough = { id: newEntityId(), version: 1, title: args.title, steps: args.steps };
                document.walkthroughs.push(walkthrough);
            } else {
                walkthrough.version += 1;
                walkthrough.title = args.title;
                walkthrough.steps = args.steps;
            }
            return { ok: true, value: walkthrough.id };
        });
    }

    search(query: string, filters: {
        kind?: AnnotationKind; status?: AnnotationStatus; authorId?: string;
        reviewState?: ReviewState; tag?: string;
    } = {}): Array<{ analysisId: string; annotation: Annotation }> {
        const needle = query.trim().toLocaleLowerCase('ko');
        const out: Array<{ analysisId: string; annotation: Annotation }> = [];
        for (const document of this.documents.values()) {
            const reviewByTarget = new Map(document.reviews.map((item) => [JSON.stringify(item.target), item]));
            for (const annotation of document.annotations) {
                if (annotation.deletedAt !== null) continue;
                if (filters.kind && annotation.kind !== filters.kind) continue;
                if (filters.status && annotation.status !== filters.status) continue;
                if (filters.authorId && annotation.authorId !== filters.authorId) continue;
                if (filters.tag && !annotation.tags.includes(filters.tag)) continue;
                if (filters.reviewState && reviewByTarget.get(JSON.stringify(annotation.target))?.state !== filters.reviewState) continue;
                const haystack = `${annotation.body}\n${annotation.kind}\n${annotation.tags.join(' ')}`.toLocaleLowerCase('ko');
                if (!needle || haystack.includes(needle)) out.push({ analysisId: document.id, annotation: { ...annotation } });
            }
        }
        return out.slice(0, 10_000);
    }

    /** 기준이 달라진 범위의 완료 상태를 재검토 필요로 낮춘다. */
    async invalidateReviews(analysisId: string, anchorIds: ReadonlySet<string>): Promise<void> {
        const document = this.documents.get(analysisId);
        if (!document) return;
        let changed = false;
        for (const review of document.reviews) {
            if (review.target.kind === 'range' && anchorIds.has(review.target.anchorId)
                && review.state === 'reviewed') {
                review.state = 'needsReview';
                review.version += 1;
                changed = true;
            }
        }
        if (changed) {
            document.revision += 1;
            document.updatedAt = new Date().toISOString();
            await this.store.save(document);
        }
    }

    async addAnchor(args: {
        analysisId: string; commandId: string; baselineId: string; fileId: string;
        range: CodeRange; selectedText: string; selectedTextHash: string;
        contextBefore: string | null; contextBeforeHash: string | null;
        contextAfter: string | null; contextAfterHash: string | null;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            const anchorId = newEntityId();
            document.anchors.push({
                id: anchorId, version: 1, baselineId: args.baselineId, fileId: args.fileId,
                range: args.range, selectedTextHash: args.selectedTextHash,
                contextBeforeHash: args.contextBeforeHash, contextAfterHash: args.contextAfterHash,
                selectedText: args.selectedText, contextBefore: args.contextBefore,
                contextAfter: args.contextAfter, symbolHint: null, state: 'matched',
                currentRange: args.range, candidateIds: [],
            });
            return { ok: true, value: anchorId };
        });
    }

    async addBaseline(args: {
        analysisId: string; commandId: string; baseline: SourceBaseline;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            if (!document.baselines.some((item) => item.id === args.baseline.id)) {
                document.baselines.push(args.baseline);
            }
            return { ok: true, value: args.baseline.id };
        });
    }

    async setAnchorCheck(args: {
        analysisId: string; commandId: string; anchorId: string;
        state: 'matched' | 'moved' | 'changed' | 'ambiguous' | 'missing' | 'unknown';
        currentRange: CodeRange | null; candidateIds: string[]; actorId: string;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            const anchor = document.anchors.find((item) => item.id === args.anchorId);
            if (!anchor) return fail('NOT_FOUND', '기록 위치를 찾을 수 없다.');
            anchor.version += 1;
            anchor.state = args.state;
            anchor.currentRange = args.currentRange;
            anchor.candidateIds = args.candidateIds;
            if (args.state !== 'matched') {
                for (const review of document.reviews) {
                    if (review.target.kind === 'range' && review.target.anchorId === anchor.id
                        && review.state === 'reviewed') {
                        review.state = 'needsReview';
                        review.version += 1;
                    }
                }
            }
            return { ok: true, value: anchor.id };
        });
    }

    async rebindAnchor(args: {
        analysisId: string; commandId: string; anchorId: string; baseVersion: number;
        baselineId: string; range: CodeRange; selectedTextHash: string; actorId: string;
    }): Promise<AnalysisResult<{ document: AnalysisDocument; result: string; persistedRevision: number }>> {
        return this.change(args.analysisId, args.commandId, args, (document) => {
            const anchor = document.anchors.find((item) => item.id === args.anchorId);
            if (!anchor) return fail('NOT_FOUND', '기록 위치를 찾을 수 없다.');
            if (anchor.version !== args.baseVersion) return fail('ANNOTATION_CONFLICT', '기록 위치가 달라졌다.', true);
            const previous = anchor.version;
            anchor.version += 1;
            anchor.baselineId = args.baselineId;
            anchor.range = args.range;
            anchor.currentRange = args.range;
            anchor.selectedTextHash = args.selectedTextHash;
            anchor.state = 'matched';
            anchor.candidateIds = [];
            document.history.push({
                id: newEntityId(), targetId: anchor.id, fromVersion: previous,
                toVersion: anchor.version, kind: 'rebound', actorId: args.actorId,
                at: new Date().toISOString(), previousBody: null,
                changedFields: ['baselineId', 'range', 'selectedTextHash'],
            });
            return { ok: true, value: anchor.id };
        });
    }
}
