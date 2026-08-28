import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    Trail,
    defaultSettings,
    fromStoredTrail,
    isUuid,
    parseWith,
    projectSettingsSchema,
    storedTrailSchema,
    stringifyStoredTrail,
    toStoredTrail,
    toTrailSummary,
    type ProjectSettings,
    type TrailSummary,
} from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { isTempFile, targetPathForTemp, tempPathFor, writeFileAtomic } from './atomic.js';

/**
 * 프로젝트 안의 `.code-trail/` (구현서 9).
 *
 * ```text
 * .code-trail/
 * ├─ settings.json      사용자가 형상 관리해도 되는 설정
 * ├─ index.json         트레일 목록 요약
 * ├─ trails/<id>.json   트레일 하나
 * └─ runtime/           실행 부산물. .gitignore 로 통째로 제외한다
 * ```
 *
 * **프로젝트 루트의 `.gitignore` 는 건드리지 않는다.** 남의 저장소 설정이다.
 * 대신 `runtime/.gitignore` 를 우리가 만들어 실행 부산물만 스스로 감춘다.
 */

export const STORE_DIR = '.code-trail';
export const SETTINGS_FILE = 'settings.json';
export const INDEX_FILE = 'index.json';
export const TRAILS_DIR = 'trails';
export const RUNTIME_DIR = 'runtime';

export interface RecoveryCandidate {
    trailId: string;
    /** 남은 임시 파일의 수정 시각. */
    savedAt: string;
}

export interface StoredIndex {
    schemaVersion: 1;
    activeTrailId: string | null;
    trails: TrailSummary[];
}

export interface ProjectStoreOptions {
    projectRoot: string;
    logger: Logger;
    /** 테스트와 특수 환경에서 설정 파일을 다른 곳에서 읽을 때만 쓴다. */
    settingsPath?: string;
}

export class ProjectStore {
    readonly root: string;
    readonly dir: string;
    readonly trailsDir: string;
    readonly runtimeDir: string;

    private readonly logger: Logger;
    private readonly settingsPath: string;
    private settings: ProjectSettings = defaultSettings();
    private recovery: RecoveryCandidate[] = [];
    private readonly settingsListeners: Array<(settings: ProjectSettings) => void> = [];

    constructor(options: ProjectStoreOptions) {
        this.root = options.projectRoot;
        this.dir = path.join(this.root, STORE_DIR);
        this.trailsDir = path.join(this.dir, TRAILS_DIR);
        this.runtimeDir = path.join(this.dir, RUNTIME_DIR);
        this.logger = options.logger.child('store');
        this.settingsPath = options.settingsPath ?? path.join(this.dir, SETTINGS_FILE);
    }

    /** 디렉터리를 만들고 설정을 읽는다. 서버가 뜨기 전에 한 번 부른다. */
    async initialize(): Promise<void> {
        await mkdir(this.trailsDir, { recursive: true });
        await mkdir(path.join(this.runtimeDir, 'lsp'), { recursive: true });
        await this.ensureRuntimeGitignore();
        this.settings = await this.loadSettings();
        this.recovery = await this.findRecoveryCandidates();
    }

    // ── 설정 ────────────────────────────────────────────────────────────────

    getSettings(): ProjectSettings {
        return this.settings;
    }

    private async loadSettings(): Promise<ProjectSettings> {
        let text: string;
        try {
            text = await readFile(this.settingsPath, 'utf8');
        } catch {
            // 처음 여는 프로젝트다. 기본값을 그대로 써 두면 사용자가 무엇을 바꿀 수
            // 있는지 파일만 열어 봐도 안다.
            const fresh = defaultSettings();
            await writeFileAtomic(this.settingsPath, `${JSON.stringify(fresh, null, 2)}\n`);
            return fresh;
        }

        let raw: unknown;
        try {
            raw = JSON.parse(text);
        } catch {
            this.logger.warn('settings.json 을 읽을 수 없어 기본값을 쓴다. 파일은 그대로 둔다.');
            return defaultSettings();
        }

        const parsed = parseWith(projectSettingsSchema, raw);
        if (!parsed.ok) {
            // 사용자가 손으로 고친 파일일 수 있다. 덮어쓰지 않고 기본값으로 돈다.
            this.logger.warn('settings.json 형식이 맞지 않아 기본값을 쓴다. 파일은 그대로 둔다.');
            return defaultSettings();
        }
        return parsed.value;
    }

    async saveSettings(next: ProjectSettings): Promise<void> {
        this.settings = next;
        await writeFileAtomic(this.settingsPath, `${JSON.stringify(next, null, 2)}\n`);
        for (const listener of this.settingsListeners) {
            listener(next);
        }
    }

    /**
     * 설정이 바뀌면 알린다.
     *
     * 언어 서버 탐지 캐시를 비우는 쪽이 듣는다. 이게 없으면 사용자가 실행 파일
     * 경로를 고쳐도 서버를 다시 띄우기 전까지 예전 탐지 결과가 남는다.
     */
    onSettingsChanged(listener: (settings: ProjectSettings) => void): void {
        this.settingsListeners.push(listener);
    }

    // ── 트레일 ──────────────────────────────────────────────────────────────

    trailPath(trailId: string): string {
        if (!isUuid(trailId)) {
            // 트레일 ID 는 그대로 파일 이름이 된다. UUID 가 아닌 값이 여기까지 오면
            // 경로 조작이다 — 스키마에서 이미 막지만 파일을 만들기 직전에 한 번 더 본다.
            throw new Error('트레일 ID 가 UUID 가 아니다.');
        }
        return path.join(this.trailsDir, `${trailId}.json`);
    }

    async saveTrail(trail: Trail): Promise<void> {
        await writeFileAtomic(this.trailPath(trail.id), stringifyStoredTrail(toStoredTrail(trail)));
    }

    async loadTrail(trailId: string): Promise<Trail | undefined> {
        let text: string;
        try {
            text = await readFile(this.trailPath(trailId), 'utf8');
        } catch {
            return undefined;
        }
        let raw: unknown;
        try {
            raw = JSON.parse(text);
        } catch {
            this.logger.warn('트레일 파일을 읽을 수 없다.', { trailId });
            return undefined;
        }
        const parsed = parseWith(storedTrailSchema, raw);
        if (!parsed.ok) {
            this.logger.warn('트레일 파일 형식이 맞지 않는다.', { trailId });
            return undefined;
        }
        return fromStoredTrail(parsed.value);
    }

    async deleteTrail(trailId: string): Promise<void> {
        const target = this.trailPath(trailId);
        await unlink(target).catch(() => undefined);
        await unlink(tempPathFor(target)).catch(() => undefined);
    }

    /** 저장된 트레일 ID 전부. 파일 이름이 UUID 인 것만 센다. */
    async listTrailIds(): Promise<string[]> {
        let entries: string[];
        try {
            entries = await readdir(this.trailsDir);
        } catch {
            return [];
        }
        return entries
            .filter((name) => name.endsWith('.json'))
            .map((name) => name.slice(0, -'.json'.length))
            .filter(isUuid)
            .sort();
    }

    // ── 목록 ────────────────────────────────────────────────────────────────

    private get indexPath(): string {
        return path.join(this.dir, INDEX_FILE);
    }

    async loadIndex(): Promise<StoredIndex> {
        try {
            const raw = JSON.parse(await readFile(this.indexPath, 'utf8')) as Partial<StoredIndex>;
            if (Array.isArray(raw.trails)) {
                return {
                    schemaVersion: 1,
                    activeTrailId: typeof raw.activeTrailId === 'string' ? raw.activeTrailId : null,
                    trails: raw.trails,
                };
            }
        } catch {
            // 없거나 깨졌으면 트레일 파일에서 다시 만든다. index.json 은 캐시일 뿐이다.
        }
        return { schemaVersion: 1, activeTrailId: null, trails: [] };
    }

    async saveIndex(trails: Trail[], activeTrailId: string | null): Promise<void> {
        const index: StoredIndex = {
            schemaVersion: 1,
            activeTrailId,
            // 파일 순서를 ID 로 고정한다. 목록 순서가 흔들리면 diff 가 흔들린다.
            trails: trails.map(toTrailSummary).sort((a, b) => (a.id < b.id ? -1 : 1)),
        };
        await writeFileAtomic(this.indexPath, `${JSON.stringify(index, null, 2)}\n`);
    }

    // ── 복구 후보 ───────────────────────────────────────────────────────────

    getRecoveryCandidates(): RecoveryCandidate[] {
        return this.recovery;
    }

    /**
     * 남은 `.tmp` 중 최종 파일보다 새 것을 찾는다 (구현서 9.5).
     *
     * 지우지 않는다. 저장 도중 죽었다면 그 안에 최신 내용이 들어 있을 수 있다.
     * 어떻게 할지는 사용자가 진단 화면에서 정한다.
     */
    private async findRecoveryCandidates(): Promise<RecoveryCandidate[]> {
        let entries: string[];
        try {
            entries = await readdir(this.trailsDir);
        } catch {
            return [];
        }

        const out: RecoveryCandidate[] = [];
        for (const name of entries) {
            if (!isTempFile(name)) {
                continue;
            }
            const tempFull = path.join(this.trailsDir, name);
            const finalFull = targetPathForTemp(tempFull);
            const trailId = path.basename(finalFull, '.json');
            if (!isUuid(trailId)) {
                continue;
            }

            const tempStat = await stat(tempFull).catch(() => undefined);
            if (!tempStat) {
                continue;
            }
            const finalStat = await stat(finalFull).catch(() => undefined);
            if (finalStat && finalStat.mtimeMs >= tempStat.mtimeMs) {
                continue;
            }
            out.push({ trailId, savedAt: tempStat.mtime.toISOString() });
        }
        return out.sort((a, b) => (a.trailId < b.trailId ? -1 : 1));
    }

    // ── runtime ─────────────────────────────────────────────────────────────

    /**
     * `runtime/.gitignore` 에 `*` 를 둔다.
     *
     * 프로젝트 루트의 `.gitignore` 는 자동으로 고치지 않는다(구현서 9.1).
     * 남의 저장소 설정을 우리가 편집하는 것은 그 자체로 놀랄 일이고,
     * 우리가 만든 디렉터리 안에서 스스로 감추면 충분하다.
     */
    private async ensureRuntimeGitignore(): Promise<void> {
        const target = path.join(this.runtimeDir, '.gitignore');
        const contents = '# Code Trail 실행 부산물. 형상 관리 대상이 아니다.\n*\n';
        try {
            const existing = await readFile(target, 'utf8');
            if (existing === contents) {
                return;
            }
        } catch {
            // 없으면 만든다
        }
        await writeFile(target, contents, 'utf8');
    }
}
