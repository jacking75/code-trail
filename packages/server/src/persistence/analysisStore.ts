import { copyFile, mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
    MAX_SHARE_BYTES,
    analysisDocumentSchema,
    isUuid,
    parseWith,
    stringifyAnalysis,
    type AnalysisDocument,
} from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { tempPathFor, writeFileAtomic } from './atomic.js';

const ANALYSIS_FILE_LIMIT = MAX_SHARE_BYTES;

export interface AnalysisRecoveryCandidate {
    analysisId: string;
    kind: 'temporary' | 'backup';
    savedAt: string;
}

export class AnalysisStore {
    readonly analysisDir: string;
    readonly snapshotsDir: string;
    readonly draftsDir: string;
    private readonly logger: Logger;
    private recovery: AnalysisRecoveryCandidate[] = [];

    constructor(rootDir: string, logger: Logger) {
        this.analysisDir = path.join(rootDir, 'analysis');
        this.snapshotsDir = path.join(rootDir, 'snapshots');
        this.draftsDir = path.join(rootDir, 'local', 'drafts');
        this.logger = logger.child('analysis-store');
    }

    async initialize(): Promise<void> {
        await Promise.all([
            mkdir(this.analysisDir, { recursive: true }),
            mkdir(this.snapshotsDir, { recursive: true }),
            mkdir(this.draftsDir, { recursive: true }),
        ]);
        this.recovery = await this.findRecoveryCandidates();
    }

    private filePath(id: string): string {
        if (!isUuid(id)) throw new Error('분석 ID가 UUID가 아니다.');
        return path.join(this.analysisDir, `${id}.json`);
    }

    private backupPath(id: string): string {
        return `${this.filePath(id)}.bak`;
    }

    async listIds(): Promise<string[]> {
        const entries = await readdir(this.analysisDir).catch(() => [] as string[]);
        return entries
            .filter((name) => name.endsWith('.json'))
            .map((name) => name.slice(0, -5))
            .filter(isUuid)
            .sort();
    }

    async load(id: string): Promise<AnalysisDocument | undefined> {
        return this.readValidated(this.filePath(id), id);
    }

    async save(document: AnalysisDocument): Promise<void> {
        const parsed = parseWith(analysisDocumentSchema, document);
        if (!parsed.ok) throw new Error('분석 문서 형식이 맞지 않는다.');
        const target = this.filePath(document.id);
        const exists = await stat(target).then(() => true, () => false);
        if (exists) await copyFile(target, this.backupPath(document.id));
        const serialized = stringifyAnalysis(parsed.value);
        if (Buffer.byteLength(serialized, 'utf8') > ANALYSIS_FILE_LIMIT) {
            throw new Error('분석 문서 크기 제한을 넘었다.');
        }
        await writeFileAtomic(target, serialized);
        // 원자적 교체 뒤 다시 읽어 검증한다. 실패하면 백업을 그대로 남긴다.
        const verified = await this.readValidated(target, document.id);
        if (!verified || verified.revision !== document.revision) {
            throw new Error('저장한 분석 문서를 다시 검증하지 못했다.');
        }
    }

    async remove(id: string): Promise<void> {
        const target = this.filePath(id);
        await Promise.all([
            unlink(target).catch(() => undefined),
            unlink(tempPathFor(target)).catch(() => undefined),
        ]);
    }

    async saveDraft(analysisId: string, draftId: string, value: unknown): Promise<void> {
        if (!isUuid(analysisId) || !isUuid(draftId)) throw new Error('초안 ID가 UUID가 아니다.');
        const directory = path.join(this.draftsDir, analysisId);
        await mkdir(directory, { recursive: true });
        const text = `${JSON.stringify(value, null, 2)}\n`;
        if (Buffer.byteLength(text, 'utf8') > 128 * 1024) throw new Error('초안이 너무 크다.');
        await writeFileAtomic(path.join(directory, `${draftId}.json`), text);
    }

    async loadDraft(analysisId: string, draftId: string): Promise<unknown | undefined> {
        if (!isUuid(analysisId) || !isUuid(draftId)) return undefined;
        try {
            return JSON.parse(await readFile(path.join(this.draftsDir, analysisId, `${draftId}.json`), 'utf8'));
        } catch {
            return undefined;
        }
    }

    getRecoveryCandidates(): AnalysisRecoveryCandidate[] {
        return [...this.recovery];
    }

    async recover(analysisId: string, kind: AnalysisRecoveryCandidate['kind']): Promise<AnalysisDocument> {
        const target = this.filePath(analysisId);
        const source = kind === 'backup' ? this.backupPath(analysisId) : tempPathFor(target);
        const recovered = await this.readValidated(source, analysisId);
        if (!recovered) throw new Error('복구 후보를 검증하지 못했다.');
        const current = await stat(target).then(() => true, () => false);
        if (current) await copyFile(target, `${target}.before-recovery.bak`);
        await writeFileAtomic(target, stringifyAnalysis(recovered));
        const verified = await this.readValidated(target, analysisId);
        if (!verified) throw new Error('복구한 분석 문서를 다시 검증하지 못했다.');
        this.recovery = this.recovery.filter((item) => !(item.analysisId === analysisId && item.kind === kind));
        return verified;
    }

    private async readValidated(file: string, id: string): Promise<AnalysisDocument | undefined> {
        const info = await stat(file).catch(() => undefined);
        if (!info || info.size > ANALYSIS_FILE_LIMIT) {
            if (info) this.logger.warn('분석 문서가 너무 커서 읽지 않았다.', { analysisId: id });
            return undefined;
        }
        let raw: unknown;
        try {
            raw = JSON.parse(await readFile(file, 'utf8'));
        } catch {
            this.logger.warn('분석 문서를 읽을 수 없다.', { analysisId: id });
            return undefined;
        }
        const version = (raw as { schemaVersion?: unknown }).schemaVersion;
        if (version !== 1) {
            this.logger.warn('지원하지 않는 분석 문서 버전이다.', { analysisId: id });
            return undefined;
        }
        if (raw && typeof raw === 'object' && !('sourceShare' in raw)) {
            // 1.1 개발 이전의 schemaVersion 1에는 회신 계보가 없었다.
            (raw as Record<string, unknown>).sourceShare = null;
        }
        const parsed = parseWith(analysisDocumentSchema, raw);
        if (!parsed.ok || parsed.value.id !== id) {
            this.logger.warn('분석 문서 형식이 맞지 않는다.', { analysisId: id });
            return undefined;
        }
        return parsed.value;
    }

    private async findRecoveryCandidates(): Promise<AnalysisRecoveryCandidate[]> {
        const entries = await readdir(this.analysisDir).catch(() => [] as string[]);
        const result: AnalysisRecoveryCandidate[] = [];
        for (const name of entries) {
            const temporary = name.endsWith('.json.tmp');
            const backup = name.endsWith('.json.bak');
            if (!temporary && !backup) continue;
            const suffix = temporary ? '.json.tmp' : '.json.bak';
            const id = name.slice(0, -suffix.length);
            if (!isUuid(id)) continue;
            const info = await stat(path.join(this.analysisDir, name)).catch(() => undefined);
            if (info) result.push({
                analysisId: id,
                kind: temporary ? 'temporary' : 'backup',
                savedAt: info.mtime.toISOString(),
            });
        }
        return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    }
}
