import path from 'node:path';

import type { Logger } from '../config/logger.js';
import type { SupportedLanguage } from '../workspace/languages.js';
import { INITIALIZE_TIMEOUT_MS, LspClient } from './client.js';
import { DocumentSync, pathToUri } from './documents.js';
import {
    LspUnavailableError,
    type LspSessionInfo,
    type LspState,
    type ServerCapabilitySummary,
    type SpawnCommand,
} from './types.js';

/**
 * 언어 하나의 서버 세션 (구현서 11.6).
 *
 * 상태 머신과 재시작을 맡는다. 프로토콜은 `LspClient` 가, 문서는 `DocumentSync` 가
 * 한다. 여기서 결정하는 것은 **언제 다시 띄울지**다.
 *
 * ```text
 * stopped → starting → initializing → ready
 *              │            │           │
 *              └────────────┴───────────┤
 *                                       ↓
 *                 failed ← backoff ← crashed
 * ```
 *
 * 예상 밖 종료는 1초·2초·5초 간격으로 최대 세 번만 다시 띄운다. 그 뒤로는
 * 사용자가 진단 화면에서 직접 시작하게 한다 — 계속 되살리면 시작에 실패하는
 * 서버가 CPU 를 갉아먹고, 사용자는 무엇이 잘못됐는지 볼 기회를 잃는다.
 */

export const RESTART_DELAYS_MS = [1_000, 2_000, 5_000] as const;

/**
 * 뜬 뒤 이만큼 버티면 "쓸 만하다" 고 본다.
 *
 * 이 값이 없으면 뜨자마자 죽는 서버가 매번 initialize 에 성공하면서 재시도
 * 횟수를 되돌려, 자동 재시작이 영원히 멈추지 않는다.
 */
export const STABLE_AFTER_MS = 10_000;

export interface LspSessionOptions {
    language: SupportedLanguage;
    command: SpawnCommand;
    projectRoot: string;
    logger: Logger;
    /** 문서 원문을 읽는다. 경로 권한 검사를 이미 통과한 파일만 온다. */
    readFile: (uri: string) => Promise<{ text: string; languageId: string }>;
    /** 상태가 바뀔 때마다. 진단 화면과 브라우저 이벤트가 쓴다. */
    onStateChange: (info: LspSessionInfo) => void;
    /** 테스트에서 짧게 줄인다. */
    requestTimeoutMs?: number;
    restartDelaysMs?: readonly number[];
    /** 뜬 뒤 이만큼 살아 있으면 재시도 횟수를 되돌린다. 테스트에서 줄인다. */
    stableAfterMs?: number;
    /** `initialize` 에 실어 보낼 언어별 옵션. */
    initializationOptions?: unknown;
}

export class LspSession {
    private client: LspClient | undefined;
    private documents: DocumentSync | undefined;
    private state: LspState = 'stopped';
    private lastError: string | null = null;
    /** backoff 일정에 쓰는 시도 횟수. 뜨는 데 성공하면 0 으로 돌린다. */
    private backoffAttempt = 0;
    /** 이 세션이 살아 있는 동안 다시 띄운 총 횟수. 진단 화면이 쓴다. */
    private restartCount = 0;
    private restartTimer: NodeJS.Timeout | undefined;
    /** 뜬 뒤 이만큼 살아 있으면 backoff 를 되돌린다. */
    private stableTimer: NodeJS.Timeout | undefined;
    private startPromise: Promise<void> | undefined;
    private disposed = false;
    private serverName: string | null = null;
    /** `initialize` 왕복 시간. 진단 화면이 쓴다. */
    private initializeMs: number | null = null;
    private lastRequest: { method: string; durationMs: number; at: string } | null = null;
    private lastExit: { code: number | null; signal: string | null; at: string } | null = null;
    /** 실제 응답을 받아본 메서드. `지원됨` 표시의 근거다. */
    private readonly verifiedMethods = new Set<string>();

    private readonly logger: Logger;
    private readonly restartDelays: readonly number[];
    private readonly stableAfterMs: number;

    constructor(private readonly options: LspSessionOptions) {
        this.logger = options.logger.child(`lsp:${options.language}`);
        this.restartDelays = options.restartDelaysMs ?? RESTART_DELAYS_MS;
        this.stableAfterMs = options.stableAfterMs ?? STABLE_AFTER_MS;
    }

    /**
     * "이 서버는 쓸 만하다" 고 인정하고 재시도 횟수를 되돌린다.
     *
     * `initialize` 에 성공했다는 것만으로는 부족하다. 뜨자마자 죽는 서버는
     * 매번 initialize 에 성공하므로, 성공할 때마다 횟수를 되돌리면 영원히
     * 다시 띄운다. 요청 하나가 실제로 응답했거나, 뜬 채로 일정 시간을 버텼을
     * 때만 인정한다.
     */
    private markStable(): void {
        this.backoffAttempt = 0;
    }

    private clearStableTimer(): void {
        if (this.stableTimer) {
            clearTimeout(this.stableTimer);
            this.stableTimer = undefined;
        }
    }

    get language(): SupportedLanguage {
        return this.options.language;
    }

    get currentState(): LspState {
        return this.state;
    }

    get capabilities(): ServerCapabilitySummary {
        return this.client?.capabilities ?? {
            definition: false,
            documentSymbol: false,
            implementation: false,
            typeDefinition: false,
        };
    }

    info(): LspSessionInfo {
        const capabilities = this.capabilities;
        const missing: string[] = [];
        // 이 둘이 없으면 Code Trail 이 할 수 있는 일이 거의 없다(구현서 11.3).
        if (this.state === 'ready' || this.state === 'degraded') {
            if (!capabilities.definition) {
                missing.push('definition');
            }
            if (!capabilities.documentSymbol) {
                missing.push('documentSymbol');
            }
            if (!capabilities.implementation) {
                missing.push('implementation');
            }
        }
        return {
            language: this.options.language,
            enabled: true,
            state: this.state,
            // 실행 파일 **이름**만. 전체 경로는 브라우저로 내보내지 않는다.
            executableName: this.serverName ?? path.basename(this.options.command.command),
            lastError: this.lastError,
            restartCount: this.restartCount,
            missingCapabilities: missing,
            pid: this.client?.pid ?? null,
            capabilities,
            initializeMs: this.initializeMs,
            lastRequest: this.lastRequest,
            lastExit: this.lastExit,
            verifiedMethods: [...this.verifiedMethods],
        };
    }

    /** 최근 stderr. 진단 화면에서 토큰 인증을 거쳐 본다. */
    recentLog(lines = 100): string[] {
        return this.client?.stderr.tail(lines) ?? [];
    }

    // ── 시작과 종료 ─────────────────────────────────────────────────────────

    /**
     * 필요할 때 띄운다 (구현서 5.1 — 그 언어 파일을 처음 열 때 지연 기동).
     * 이미 뜨고 있으면 그 약속을 그대로 돌려준다 — 동시에 두 번 띄우지 않는다.
     */
    async ensureReady(): Promise<void> {
        if (this.disposed) {
            throw new LspUnavailableError(this.options.language, '서버가 닫혔다.');
        }
        if (this.state === 'ready' || this.state === 'degraded') {
            return;
        }
        if (this.state === 'failed' || this.state === 'protocolError') {
            throw new LspUnavailableError(
                this.options.language,
                this.lastError ?? '언어 서버를 쓸 수 없다.',
            );
        }
        if (!this.startPromise) {
            this.startPromise = this.start().finally(() => {
                this.startPromise = undefined;
            });
        }
        await this.startPromise;
    }

    private setState(next: LspState, error?: string): void {
        if (this.state === next && error === undefined) {
            return;
        }
        this.state = next;
        if (error !== undefined) {
            this.lastError = error;
        }
        this.logger.debug('상태가 바뀌었다.', { state: next });
        this.options.onStateChange(this.info());
    }

    private async start(): Promise<void> {
        this.setState('starting');

        const client = new LspClient({
            command: this.options.command,
            logger: this.logger,
            ...(this.options.requestTimeoutMs !== undefined
                ? { requestTimeoutMs: this.options.requestTimeoutMs }
                : {}),
            events: {
                onExit: (code, signal) => this.onUnexpectedExit(code, signal),
                onProtocolError: (message) => this.onProtocolError(message),
                onServerMessage: (level, message) => {
                    // 코드 본문이 섞여 올 수 있어 로그 수준에서만 남긴다.
                    this.logger.debug('언어 서버 메시지', { level, length: message.length });
                },
                onCapabilityChange: () => {
                    // 동적 등록으로 기능이 생기거나 사라졌다. 진단 화면을 갱신한다.
                    this.options.onStateChange(this.info());
                },
            },
        });

        try {
            client.start();
        } catch (error) {
            this.client = undefined;
            this.setState('failed', describe(error));
            throw new LspUnavailableError(this.options.language, describe(error));
        }

        this.client = client;
        this.documents = new DocumentSync({ client, readFile: this.options.readFile });
        this.setState('initializing');

        const startedAt = Date.now();
        try {
            const result = await client.initialize(this.buildInitializeParams());
            this.initializeMs = Date.now() - startedAt;
            this.serverName = result.serverName;
            this.lastError = null;
            // 여기서 backoffAttempt 를 되돌리지 않는다. 뜨자마자 죽는 서버는
            // 매번 여기까지 오므로, 그러면 자동 재시작이 영원히 멈추지 않는다.
            this.clearStableTimer();
            this.stableTimer = setTimeout(() => {
                this.stableTimer = undefined;
                if (this.state === 'ready' || this.state === 'degraded') {
                    this.markStable();
                }
            }, this.stableAfterMs);
            if (typeof this.stableTimer.unref === 'function') {
                this.stableTimer.unref();
            }
            // 필수 capability 가 없으면 실행 중이어도 기능이 줄어든다(구현서 11.3).
            const usable = result.capabilities.definition || result.capabilities.documentSymbol;
            this.setState(usable ? 'ready' : 'degraded');
            this.options.onStateChange(this.info());
        } catch (error) {
            const message = describe(error);
            client.dispose();
            this.client = undefined;
            this.documents = undefined;
            this.setState('failed', message);
            throw new LspUnavailableError(this.options.language, message);
        }
    }

    private buildInitializeParams(): unknown {
        const rootUri = pathToUri(this.options.projectRoot);
        return {
            processId: process.pid,
            clientInfo: { name: 'Code Trail', version: '0.0.0' },
            locale: 'ko',
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: path.basename(this.options.projectRoot) }],
            initializationOptions: this.options.initializationOptions ?? null,
            capabilities: {
                general: {
                    // 브라우저와 JavaScript 가 UTF-16 이다. 여기서 명시하지 않으면
                    // 서버가 UTF-8 오프셋을 보내 한글·이모지 줄의 컬럼이 어긋난다.
                    positionEncodings: ['utf-16'],
                },
                workspace: {
                    workspaceFolders: true,
                    configuration: true,
                    didChangeWatchedFiles: { dynamicRegistration: true },
                },
                window: {
                    workDoneProgress: true,
                    showMessage: { messageActionItem: { additionalPropertiesSupport: false } },
                },
                textDocument: {
                    synchronization: {
                        dynamicRegistration: false,
                        willSave: false,
                        willSaveWaitUntil: false,
                        didSave: false,
                    },
                    // 넷 다 LocationLink 를 받는다. targetRange 가 본문 범위 힌트라
                    // 문서 심볼이 없는 서버에서도 함수 전체를 보여줄 수 있다.
                    definition: { dynamicRegistration: true, linkSupport: true },
                    typeDefinition: { dynamicRegistration: true, linkSupport: true },
                    implementation: { dynamicRegistration: true, linkSupport: true },
                    documentSymbol: {
                        dynamicRegistration: true,
                        hierarchicalDocumentSymbolSupport: true,
                    },
                },
            },
        };
    }

    // ── 사고 처리 ───────────────────────────────────────────────────────────

    private onUnexpectedExit(code: number | null, signal: NodeJS.Signals | null): void {
        if (this.disposed) {
            return;
        }
        const tail = this.client?.stderr.tail(3).join(' ') ?? '';
        this.lastExit = { code, signal, at: new Date().toISOString() };
        this.clearStableTimer();
        this.client?.dispose();
        this.client = undefined;
        this.documents?.forgetAll();

        this.setState('crashed', `종료 코드 ${code ?? '없음'}${signal ? ` (${signal})` : ''}${tail ? ` — ${tail}` : ''}`);
        this.scheduleRestart();
    }

    private onProtocolError(message: string): void {
        if (this.disposed) {
            return;
        }
        // 다시 띄워도 같은 일이 반복된다. 대개 언어 서버가 stdout 에 진단을
        // 찍도록 설정된 것이고, 사용자가 고쳐야 한다.
        this.client?.dispose();
        this.client = undefined;
        this.documents?.forgetAll();
        this.setState(
            'protocolError',
            `stdout 에 JSON-RPC 가 아닌 것이 섞였다: ${message.slice(0, 200)}`,
        );
    }

    private scheduleRestart(): void {
        const delay = this.restartDelays[this.backoffAttempt];
        if (delay === undefined) {
            this.setState('failed', `${this.backoffAttempt}번 다시 띄웠지만 계속 죽는다.`);
            return;
        }
        this.backoffAttempt += 1;
        this.restartCount += 1;
        this.setState('backoff');
        this.restartTimer = setTimeout(() => {
            this.restartTimer = undefined;
            void this.start()
                .then(() => this.documents?.reopenAll())
                .catch(() => {
                    // start 안에서 이미 상태를 세웠다.
                });
        }, delay);
        if (typeof this.restartTimer.unref === 'function') {
            this.restartTimer.unref();
        }
    }

    /** 사용자가 진단 화면에서 다시 시작한다. 재시도 횟수를 되돌린다. */
    async restart(): Promise<void> {
        this.clearRestartTimer();
        await this.stop();
        this.backoffAttempt = 0;
        this.lastError = null;
        this.disposed = false;
        this.initializeMs = null;
        // 다시 띄웠으면 확인도 다시 해야 한다. 예전 서버가 답했던 것을
        // 새 서버의 증거로 쓰면 안 된다.
        this.verifiedMethods.clear();
        this.lastRequest = null;
        this.setState('stopped');
        await this.ensureReady();
    }

    // ── 문서와 요청 ─────────────────────────────────────────────────────────

    /** 요청 전에 문서를 연다. 서버가 없으면 띄운다. */
    async openDocument(uri: string): Promise<void> {
        await this.ensureReady();
        await this.documents?.ensureOpen(uri);
    }

    async refreshDocument(uri: string): Promise<void> {
        await this.documents?.refresh(uri);
    }

    closeDocument(uri: string): void {
        this.documents?.close(uri);
    }

    /** LSP 요청 하나. 서버가 준비되지 않았으면 먼저 띄운다. */
    async request<T>(method: string, params: unknown, timeoutMs?: number, signal?: AbortSignal): Promise<T> {
        await this.ensureReady();
        const client = this.client;
        if (!client) {
            throw new LspUnavailableError(this.options.language, '언어 서버 연결이 없다.');
        }
        const startedAt = Date.now();
        try {
            const result = await client.request<T>(method, params, timeoutMs, signal);
            // 성공한 요청만 남긴다. 실패한 요청은 서버가 답하고 있다는 증거가 아니다.
            this.lastRequest = {
                method,
                durationMs: Date.now() - startedAt,
                at: new Date().toISOString(),
            };
            this.verifiedMethods.add(method);
            // 요청 하나가 실제로 응답했다. 이 서버는 쓸 만하다.
            this.markStable();
            return result;
        } catch (error) {
            // 요청 도중 서버가 죽으면 JSON-RPC 연결 오류가 온다. 그대로 위로
            // 올리면 화면에 "알 수 없는 오류" 가 뜬다. 무슨 일이 있었는지 말한다.
            if (this.state !== 'ready' && this.state !== 'degraded') {
                throw new LspUnavailableError(
                    this.options.language,
                    this.lastError ?? '요청 도중 언어 서버가 끊겼다.',
                );
            }
            throw error;
        }
    }

    private clearRestartTimer(): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = undefined;
        }
    }

    async stop(): Promise<void> {
        this.disposed = true;
        this.clearRestartTimer();
        this.clearStableTimer();
        const client = this.client;
        this.client = undefined;
        this.documents = undefined;
        if (client) {
            await client.stop();
        }
        this.state = 'stopped';
    }
}

function describe(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export { INITIALIZE_TIMEOUT_MS };
