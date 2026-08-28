import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { ProjectSettings } from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { languageIdFor, supportedLanguageFor, type SupportedLanguage } from '../workspace/languages.js';
import { adapterFor, SUPPORTED_LANGUAGES } from './adapters/index.js';
import type { DetectionResult, HealthCheck, WorkspaceInfo } from './adapters/types.js';
import { uriToPath } from './documents.js';
import { LspSession } from './session.js';
import { LspUnavailableError, type LspSessionInfo } from './types.js';

/**
 * 언어별 세션 관리 (구현서 5.1).
 *
 * - 언어 서버는 그 언어 파일을 **처음 열 때** 뜬다. 프로젝트를 열자마자 넷을
 *   전부 띄우면 쓰지도 않을 서버가 CPU 와 메모리를 먹는다.
 * - 언어마다 프로세스 하나를 유지한다. 같은 언어의 요청은 같은 세션을 쓴다.
 * - 실행 파일을 찾고 명령을 만드는 것은 **어댑터**가 한다. 여기에는 언어별
 *   분기가 없다 — `if (language === 'cpp')` 가 생기면 어댑터로 옮길 코드다.
 */

/** 진단 화면 한 줄. 세션 상태에 어댑터의 점검 결과를 얹은 것이다. */
export interface LspDiagnosticsEntry extends LspSessionInfo {
    displayName: string;
    detectionSource: DetectionResult['source'];
    healthChecks: HealthCheck[];
}

export interface LspManagerOptions {
    projectRoot: string;
    logger: Logger;
    /** 설정을 그때그때 읽는다. 사용자가 바꾸면 다음 기동부터 반영된다. */
    getSettings: () => ProjectSettings;
    onStateChange: (info: LspSessionInfo) => void;
    /** 테스트에서 짧게 줄인다. */
    requestTimeoutMs?: number;
    restartDelaysMs?: readonly number[];
}

export class LspManager {
    private readonly sessions = new Map<SupportedLanguage, LspSession>();
    private readonly detections = new Map<SupportedLanguage, DetectionResult>();
    private readonly logger: Logger;

    constructor(private readonly options: LspManagerOptions) {
        this.logger = options.logger.child('lsp');
    }

    /** 이 파일을 다룰 언어. 지원하지 않으면 `null`. */
    languageFor(fsPath: string): SupportedLanguage | null {
        const languageId = languageIdFor(path.basename(fsPath));
        return languageId === null ? null : supportedLanguageFor(languageId);
    }

    private workspace(): WorkspaceInfo {
        return { projectRoot: this.options.projectRoot, settings: this.options.getSettings() };
    }

    /**
     * 세션 하나를 얻는다. 없으면 만든다.
     *
     * 실행 파일 찾기는 어댑터가 한다 — 언어마다 볼 곳이 다르기 때문이다(구현서 12장).
     * **자동으로 내려받지는 않는다**(구현서 2).
     */
    private async sessionFor(language: SupportedLanguage): Promise<LspSession> {
        const existing = this.sessions.get(language);
        if (existing) {
            return existing;
        }

        const workspace = this.workspace();
        const settings = workspace.settings.languages[language];
        const adapter = adapterFor(language);
        if (!settings.enabled) {
            throw new LspUnavailableError(
                language,
                `${adapter.displayName} 가 설정에서 꺼져 있다.`,
            );
        }

        const detection = await this.detect(language);
        if (detection.executable === null) {
            throw new LspUnavailableError(
                language,
                detection.hint ?? `${adapter.displayName} 를 찾지 못했다.`,
            );
        }

        const session = new LspSession({
            language,
            command: adapter.buildCommand(detection.executable, workspace),
            projectRoot: this.options.projectRoot,
            logger: this.logger,
            readFile: (uri) => this.readDocument(uri),
            onStateChange: this.options.onStateChange,
            initializationOptions: adapter.initializationOptions(workspace),
            ...(this.options.requestTimeoutMs !== undefined
                ? { requestTimeoutMs: this.options.requestTimeoutMs }
                : {}),
            ...(this.options.restartDelaysMs !== undefined
                ? { restartDelaysMs: this.options.restartDelaysMs }
                : {}),
        });
        this.sessions.set(language, session);
        return session;
    }

    /**
     * 실행 파일 탐지 결과.
     *
     * 캐시한다. 진단 화면이 열릴 때마다 넷의 PATH 를 전부 훑으면 디스크 접근이
     * 수백 번이고 화면이 눈에 띄게 늦는다. 설정이 바뀌면 `invalidateDetection` 이
     * 비운다.
     */
    private async detect(language: SupportedLanguage): Promise<DetectionResult> {
        const cached = this.detections.get(language);
        if (cached) {
            return cached;
        }
        const result = await adapterFor(language).detectExecutable(this.workspace());
        this.detections.set(language, result);
        return result;
    }

    /** 설정이 바뀌었다. 다음 탐지를 다시 하게 한다. */
    invalidateDetection(): void {
        this.detections.clear();
    }

    /**
     * 언어 서버에 넘길 원문.
     *
     * BOM 은 디코딩에서만 처리하고 본문 문자열에는 넣지 않는다(구현서 11.4).
     * BOM 이 남으면 첫 줄의 컬럼이 하나씩 밀린다.
     */
    private async readDocument(uri: string): Promise<{ text: string; languageId: string }> {
        const fsPath = uriToPath(uri);
        if (fsPath === null) {
            throw new Error('file: URI 가 아니다.');
        }
        let text = await readFile(fsPath, 'utf8');
        if (text.charCodeAt(0) === 0xfeff) {
            text = text.slice(1);
        }
        return { text, languageId: languageIdFor(path.basename(fsPath)) ?? 'plaintext' };
    }

    /** 이 파일을 다루는 세션을 준비하고 문서를 연다. */
    async openFor(fsPath: string, uri: string): Promise<LspSession> {
        const language = this.languageFor(fsPath);
        if (language === null) {
            throw new LspUnavailableError(
                'cpp',
                '이 언어는 심볼 해석을 지원하지 않는다. C/C++, C#, Go, Rust 만 된다.',
            );
        }
        const session = await this.sessionFor(language);
        await session.openDocument(uri);
        return session;
    }

    /** 파일 감시가 알려준 변경을 열려 있는 세션에 전달한다. */
    async notifyFileChanged(uri: string): Promise<void> {
        await Promise.all(
            [...this.sessions.values()].map((session) =>
                session.refreshDocument(uri).catch(() => undefined)),
        );
    }

    /** 진단 화면이 쓰는 목록. 아직 안 뜬 언어도 보여준다. */
    async diagnostics(): Promise<LspDiagnosticsEntry[]> {
        const workspace = this.workspace();
        return Promise.all(SUPPORTED_LANGUAGES.map(async (language) => {
            const adapter = adapterFor(language);
            const config = workspace.settings.languages[language];
            const detection: DetectionResult = config.enabled
                ? await this.detect(language)
                : { executable: null, source: 'notFound', hint: null };
            const healthChecks = config.enabled
                ? await adapter.healthChecks(workspace, detection)
                : [];

            const detectedName = detection.executable === null
                ? null
                : path.basename(detection.executable);
            const base: LspSessionInfo = this.sessions.get(language)?.info() ?? {
                language,
                enabled: config.enabled,
                state: 'stopped',
                executableName: detectedName,
                lastError: null,
                restartCount: 0,
                missingCapabilities: [],
            };

            return {
                ...base,
                enabled: config.enabled,
                displayName: adapter.displayName,
                executableName: base.executableName ?? detectedName,
                detectionSource: detection.source,
                healthChecks,
            };
        }));
    }

    /** 설정에 실행 파일이 있거나 탐지된 언어. bootstrap 이 쓴다. */
    async availableLanguages(): Promise<SupportedLanguage[]> {
        const settings = this.options.getSettings();
        const found: SupportedLanguage[] = [];
        for (const language of SUPPORTED_LANGUAGES) {
            if (!settings.languages[language].enabled) {
                continue;
            }
            const detection = await this.detect(language);
            if (detection.executable !== null) {
                found.push(language);
            }
        }
        return found;
    }

    recentLog(language: SupportedLanguage, lines = 100): string[] {
        return this.sessions.get(language)?.recentLog(lines) ?? [];
    }

    /** 사용자가 진단 화면에서 다시 시작한다. */
    async restart(language: SupportedLanguage): Promise<void> {
        const existing = this.sessions.get(language);
        if (existing) {
            await existing.stop();
            this.sessions.delete(language);
        }
        // 설정이 바뀌었을 수 있다. 탐지부터 다시 하고 새 명령으로 만든다(구현서 11.6).
        this.invalidateDetection();
        const session = await this.sessionFor(language);
        await session.ensureReady();
    }

    /** 종료 절차. 자식 프로세스를 남기지 않는다. */
    async stopAll(): Promise<void> {
        const sessions = [...this.sessions.values()];
        this.sessions.clear();
        await Promise.all(sessions.map((session) => session.stop().catch(() => undefined)));
    }
}
