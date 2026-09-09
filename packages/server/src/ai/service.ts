import {
    newEntityId,
    type AiExplanationDraft,
    type Author,
    type CodeRange,
    type ExplanationProvider,
    type LocalSettings,
} from '@code-trail/shared';

import type { AnalysisService } from '../analysis/service.js';
import { contextForRange, createBaselineFile, sha256 } from '../analysis/baselines.js';
import type { DocumentRegistry } from '../workspace/documents.js';
import { OllamaExplanationProvider } from './ollama.js';

interface StoredDraft extends AiExplanationDraft {
    analysisId: string;
    anchorId: string;
    documentId: string;
    contentHash: string;
}

export interface AiDraftPreview {
    draft: AiExplanationDraft & { anchorId: string };
    inputBytes: number;
    languageId: string;
}

export class AiExplanationService {
    private readonly running = new Map<string, AbortController>();
    private readonly drafts = new Map<string, StoredDraft>();

    constructor(
        private readonly documents: DocumentRegistry,
        private readonly analyses: AnalysisService,
        private readonly getSettings: () => LocalSettings['ai'],
        private readonly createProvider: (settings: LocalSettings['ai']) => ExplanationProvider =
            (settings) => new OllamaExplanationProvider(settings),
    ) {}

    capability(): { enabled: boolean; provider: string; model: string; maxInputBytes: number } {
        const settings = this.getSettings();
        return {
            enabled: settings.enabled && settings.model.trim().length > 0,
            provider: settings.provider,
            model: settings.model,
            maxInputBytes: settings.maxInputBytes,
        };
    }

    async generate(args: {
        requestId: string;
        analysisId: string;
        documentId: string;
        range: CodeRange;
        purpose: string;
    }): Promise<AiDraftPreview> {
        if (this.running.size >= 1) throw new Error('다른 AI 설명 요청이 진행 중이다.');
        if (!this.analyses.get(args.analysisId)) throw new Error('분석 문서를 찾을 수 없다.');
        const settings = this.getSettings();
        if (!settings.enabled || !settings.model.trim()) throw new Error('로컬 AI 제공자가 꺼져 있거나 모델이 정해지지 않았다.');
        const before = await this.documents.read(args.documentId);
        const context = contextForRange(before.text, args.range);
        if (!context) throw new Error('선택한 코드 범위가 현재 문서와 맞지 않는다.');
        const inputBytes = Buffer.byteLength(context.selectedText, 'utf8');
        if (inputBytes > settings.maxInputBytes) throw new Error('선택한 코드가 AI 입력 제한을 넘었다.');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
        this.running.set(args.requestId, controller);
        try {
            const provider = this.createProvider(settings);
            const result = await provider.generate({
                code: context.selectedText,
                languageId: before.languageId,
                purpose: args.purpose,
                signal: controller.signal,
            });
            const after = await this.documents.read(args.documentId);
            if (after.contentHash !== before.contentHash) throw new Error('설명을 만드는 동안 코드가 바뀌었다. 다시 선택한다.');

            const { baseline, fileId } = createBaselineFile({
                relPath: before.relPath,
                contentHash: before.contentHash,
            });
            const baselineResult = await this.analyses.addBaseline({
                analysisId: args.analysisId,
                commandId: `ai:${args.requestId}:baseline`,
                baseline,
            });
            if (!baselineResult.ok) throw new Error(baselineResult.error.message);
            const anchorResult = await this.analyses.addAnchor({
                analysisId: args.analysisId,
                commandId: `ai:${args.requestId}:anchor`,
                baselineId: baseline.id,
                fileId,
                range: args.range,
                selectedText: context.selectedText,
                selectedTextHash: sha256(context.selectedText),
                contextBefore: context.before,
                contextBeforeHash: context.before ? sha256(context.before) : null,
                contextAfter: context.after,
                contextAfterHash: context.after ? sha256(context.after) : null,
            });
            if (!anchorResult.ok) throw new Error(anchorResult.error.message);
            const createdAt = new Date().toISOString();
            const draft: StoredDraft = {
                id: newEntityId(),
                analysisId: args.analysisId,
                anchorId: anchorResult.value.result,
                documentId: args.documentId,
                contentHash: before.contentHash,
                provider: provider.name,
                model: result.model,
                baselineId: baseline.id,
                range: args.range,
                body: result.body,
                questions: result.questions,
                evidence: result.evidence.map((item) => ({ ...item, anchorId: anchorResult.value.result })),
                createdAt,
                acceptedAt: null,
            };
            this.drafts.set(draft.id, draft);
            if (this.drafts.size > 32) this.drafts.delete(this.drafts.keys().next().value as string);
            return {
                draft: {
                    id: draft.id,
                    anchorId: draft.anchorId,
                    provider: draft.provider,
                    model: draft.model,
                    baselineId: draft.baselineId,
                    range: draft.range,
                    body: draft.body,
                    questions: draft.questions,
                    evidence: draft.evidence,
                    createdAt: draft.createdAt,
                    acceptedAt: draft.acceptedAt,
                },
                inputBytes,
                languageId: before.languageId,
            };
        } catch (error) {
            if (controller.signal.aborted) throw new Error('AI 설명 요청을 취소했거나 제한 시간을 넘었다.');
            throw error;
        } finally {
            clearTimeout(timeout);
            this.running.delete(args.requestId);
        }
    }

    cancel(requestId: string): boolean {
        const running = this.running.get(requestId);
        if (!running) return false;
        running.abort();
        return true;
    }

    async accept(args: { draftId: string; analysisId: string; commandId: string; author: Author }): Promise<{ annotationId: string; documentRevision: number }> {
        const draft = this.drafts.get(args.draftId);
        if (!draft || draft.analysisId !== args.analysisId || draft.acceptedAt !== null) {
            throw new Error('AI 초안이 없거나 이미 채택되었다.');
        }
        const current = await this.documents.read(draft.documentId);
        if (current.contentHash !== draft.contentHash) throw new Error('AI 초안을 만든 뒤 코드가 바뀌었다. 다시 검토한다.');
        const result = await this.analyses.createAnnotation({
            analysisId: args.analysisId,
            commandId: args.commandId,
            target: { kind: 'range', anchorId: draft.anchorId },
            body: draft.body,
            kind: 'explanation',
            tags: ['AI 채택'],
            author: args.author,
        });
        if (!result.ok) throw new Error(result.error.message);
        draft.acceptedAt = new Date().toISOString();
        return { annotationId: result.value.result, documentRevision: result.value.persistedRevision };
    }
}
