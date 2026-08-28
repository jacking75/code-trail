import { readFile } from 'node:fs/promises';

import type { LanguageServerSettings, ProjectSettings } from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { languageIdFor, supportedLanguageFor, type SupportedLanguage } from '../workspace/languages.js';
import { uriToPath } from './documents.js';
import { LspSession } from './session.js';
import { LspUnavailableError, type LspSessionInfo, type SpawnCommand } from './types.js';
import path from 'node:path';

/**
 * 언어별 세션 관리 (구현서 5.1).
 *
 * - 언어 서버는 그 언어 파일을 **처음 열 때** 뜬다. 프로젝트를 열자마자 넷을
 *   전부 띄우면 쓰지도 않을 서버가 CPU 와 메모리를 먹는다.
 * - 언어마다 프로세스 하나를 유지한다. 같은 언어의 요청은 같은 세션을 쓴다.
 * - 실행 명령은 **설정에서만** 온다. 언어별 탐지와 진단은 단계 6의 어댑터가 맡고,
 *   여기서는 언어별 분기를 하지 않는다.
 */

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
    private readonly logger: Logger;

    constructor(private readonly options: LspManagerOptions) {
        this.logger = options.logger.child('lsp');
    }

    /** 이 파일을 다룰 언어. 지원하지 않으면 `null`. */
    languageFor(fsPath: string): SupportedLanguage | null {
        const languageId = languageIdFor(path.basename(fsPath));
        return languageId === null ? null : supportedLanguageFor(languageId);
    }

    /**
     * 세션 하나를 얻는다. 없으면 만든다. 설정이 없거나 꺼져 있으면 던진다.
     *
     * **실행 파일을 자동으로 내려받지 않는다**(구현서 2, 12.2). 사용자가 설치한
     * 것을 쓰거나, 설정에 경로를 적어야 한다.
     */
    private sessionFor(language: SupportedLanguage): LspSession {
        const existing = this.sessions.get(language);
        if (existing) {
            return existing;
        }

        const settings = this.options.getSettings().languages[language];
        if (!settings.enabled) {
            throw new LspUnavailableError(language, `${language} 언어 서버가 설정에서 꺼져 있다.`);
        }
        const command = this.buildCommand(language, settings);

        const session = new LspSession({
            language,
            command,
            projectRoot: this.options.projectRoot,
            logger: this.logger,
            readFile: (uri) => this.readDocument(uri),
            onStateChange: this.options.onStateChange,
            initializationOptions: settings.initializationOptions,
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

    private buildCommand(
        language: SupportedLanguage,
        settings: LanguageServerSettings,
    ): SpawnCommand {
        if (settings.executable === null || settings.executable.trim() === '') {
            // 단계 6에서 어댑터가 PATH 와 플랫폼별 위치를 뒤진다.
            // 지금은 설정에 적힌 것만 쓴다.
            throw new LspUnavailableError(
                language,
                `${language} 언어 서버 실행 파일이 설정에 없다. `
                + '`.code-trail/settings.json` 의 `languages.'
                + `${language}.executable\` 에 경로를 적는다.`,
            );
        }
        return {
            command: settings.executable,
            args: [...settings.args],
            env: { ...settings.env },
            // 언어 서버는 프로젝트 루트를 cwd 로 받는다. clangd 의
            // compile_commands.json 탐색이 여기서 시작한다.
            cwd: this.options.projectRoot,
        };
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
        const session = this.sessionFor(language);
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
    diagnostics(): LspSessionInfo[] {
        const settings = this.options.getSettings();
        const languages: SupportedLanguage[] = ['cpp', 'csharp', 'go', 'rust'];
        return languages.map((language) => {
            const session = this.sessions.get(language);
            if (session) {
                return session.info();
            }
            const config = settings.languages[language];
            return {
                language,
                enabled: config.enabled,
                state: 'stopped' as const,
                executableName: config.executable === null
                    ? null
                    : path.basename(config.executable),
                lastError: null,
                restartCount: 0,
                missingCapabilities: [],
            };
        });
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
        // 설정이 바뀌었을 수 있다. 새 명령으로 다시 만든다(구현서 11.6).
        await this.sessionFor(language).ensureReady();
    }

    /** 종료 절차. 자식 프로세스를 남기지 않는다. */
    async stopAll(): Promise<void> {
        const sessions = [...this.sessions.values()];
        this.sessions.clear();
        await Promise.all(sessions.map((session) => session.stop().catch(() => undefined)));
    }
}
