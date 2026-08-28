import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import {
    CancellationTokenSource,
    createMessageConnection,
    StreamMessageReader,
    StreamMessageWriter,
    type MessageConnection,
} from 'vscode-jsonrpc/node';

import type { Logger } from '../config/logger.js';
import { LineRingBuffer } from './ringBuffer.js';
import { LspTimeoutError, type ServerCapabilitySummary, type SpawnCommand } from './types.js';

/**
 * 언어 서버 하나와의 JSON-RPC 연결 (구현서 11.2).
 *
 * `vscode-jsonrpc` 가 `Content-Length` 프레이밍, 요청 ID, pending map,
 * `$/cancelRequest` 를 맡는다. 그 위에 우리가 얹는 것은 셋이다.
 *
 * - **요청별 timeout** — 언어 서버가 대답하지 않아도 화면이 영원히 기다리지 않는다.
 *   시간이 다 되면 취소를 보내고 pending 을 정리한다.
 * - **stdout/stderr 분리** — stdout 은 JSON-RPC 전용이다. 여기에 다른 것이 섞이면
 *   프로토콜 오류로 본다. 진단은 stderr 에서만 모은다.
 * - **수명주기** — initialize → initialized → (사용) → shutdown → exit.
 *   제한 시간을 넘긴 자식만 강제로 끝낸다.
 *
 * 이 클래스는 **언어를 모른다.** clangd 인지 gopls 인지는 위(`session.ts`)가 정한다.
 */

/** 요청 종류별 기본 timeout. 문서 심볼은 큰 파일에서 오래 걸린다. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
/** `initialize` 는 프로젝트 로드를 겸하는 서버가 있어 넉넉히 준다. */
export const INITIALIZE_TIMEOUT_MS = 60_000;
/** `shutdown` 을 기다리는 시간. 넘으면 프로세스를 끝낸다. */
export const SHUTDOWN_TIMEOUT_MS = 3_000;

export interface LspClientEvents {
    /** 서버가 예상 밖으로 끝났다. 정상 종료 절차를 거쳤으면 부르지 않는다. */
    onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
    /** stdout 에 JSON-RPC 가 아닌 것이 섞였다. */
    onProtocolError: (message: string) => void;
    /** `window/logMessage`, `window/showMessage`. */
    onServerMessage: (level: number, message: string) => void;
    /** 동적 capability 등록·해제. */
    onCapabilityChange: () => void;
}

export interface LspClientOptions {
    command: SpawnCommand;
    logger: Logger;
    events: LspClientEvents;
    /** 테스트에서 짧게 줄인다. */
    requestTimeoutMs?: number;
}

export interface InitializeResult {
    capabilities: ServerCapabilitySummary;
    /** 서버가 알려준 이름. 진단 화면에 쓴다. */
    serverName: string | null;
}

interface JsonRpcServerCapabilities {
    definitionProvider?: unknown;
    documentSymbolProvider?: unknown;
    implementationProvider?: unknown;
    typeDefinitionProvider?: unknown;
}

/** capability 는 `true` 이거나 옵션 객체다. `false`·`undefined` 만 없는 것이다. */
function hasProvider(value: unknown): boolean {
    return value !== undefined && value !== null && value !== false;
}

export class LspClient {
    private child: ChildProcessWithoutNullStreams | undefined;
    private connection: MessageConnection | undefined;
    private readonly logger: Logger;
    private readonly options: LspClientOptions;
    private readonly requestTimeoutMs: number;

    /** 정상 종료 절차를 시작했는지. 그 뒤의 exit 는 사고가 아니다. */
    private stopping = false;
    private disposed = false;

    readonly stderr = new LineRingBuffer();

    /**
     * 동적으로 등록된 capability. 서버가 `client/registerCapability` 로 나중에
     * 켜는 경우가 있어 `initialize` 응답만 믿으면 기능이 있는데 없다고 판단한다.
     */
    private readonly dynamicCapabilities = new Set<string>();
    private staticCapabilities: ServerCapabilitySummary = {
        definition: false,
        documentSymbol: false,
        implementation: false,
        typeDefinition: false,
    };

    constructor(options: LspClientOptions) {
        this.options = options;
        this.logger = options.logger.child('lsp');
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    }

    get isRunning(): boolean {
        return this.child !== undefined && this.connection !== undefined && !this.disposed;
    }

    get capabilities(): ServerCapabilitySummary {
        return {
            definition: this.staticCapabilities.definition
                || this.dynamicCapabilities.has('textDocument/definition'),
            documentSymbol: this.staticCapabilities.documentSymbol
                || this.dynamicCapabilities.has('textDocument/documentSymbol'),
            implementation: this.staticCapabilities.implementation
                || this.dynamicCapabilities.has('textDocument/implementation'),
            typeDefinition: this.staticCapabilities.typeDefinition
                || this.dynamicCapabilities.has('textDocument/typeDefinition'),
        };
    }

    // ── 수명주기 ────────────────────────────────────────────────────────────

    /**
     * 자식 프로세스를 띄우고 연결을 연다. `initialize` 는 아직 보내지 않는다.
     *
     * **`shell: false` 로 부른다.** 설정에서 온 실행 파일 경로와 인자가 셸 문법으로
     * 해석되면, 프로젝트 설정 파일 하나로 임의 명령이 돌게 된다(구현서 8.1).
     */
    /** 자식 프로세스 PID. 안 떠 있으면 `null`. 진단 화면이 쓴다. */
    get pid(): number | null {
        return this.child?.pid ?? null;
    }

    start(): void {
        if (this.child) {
            throw new Error('이미 시작한 클라이언트다.');
        }
        const { command } = this.options;

        this.child = spawn(command.command, command.args, {
            shell: false,
            cwd: command.cwd,
            // 명시한 키만 덮어쓴다. 전체 환경을 대체하지 않는다.
            env: { ...process.env, ...command.env },
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        this.child.stderr.setEncoding('utf8');
        this.child.stderr.on('data', (chunk: string) => {
            this.stderr.append(chunk);
        });

        this.child.on('error', (error) => {
            this.stderr.append(`[spawn] ${error.message}`);
            if (!this.stopping) {
                this.options.events.onExit(null, null);
            }
        });

        this.child.on('exit', (code, signal) => {
            if (!this.stopping) {
                this.options.events.onExit(code, signal);
            }
        });

        const reader = new StreamMessageReader(this.child.stdout);
        const writer = new StreamMessageWriter(this.child.stdin);

        // stdout 에 프로토콜이 아닌 것이 섞이면 여기로 온다.
        reader.onError((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.options.events.onProtocolError(message);
        });
        writer.onError(([error]) => {
            this.logger.debug('언어 서버에 쓰지 못했다.', {
                reason: error instanceof Error ? error.message : String(error),
            });
        });

        this.connection = createMessageConnection(reader, writer, {
            error: (message) => this.logger.debug('jsonrpc error', { message }),
            warn: (message) => this.logger.debug('jsonrpc warn', { message }),
            info: () => undefined,
            log: () => undefined,
        });

        this.registerHandlers(this.connection);
        this.connection.listen();
    }

    private registerHandlers(connection: MessageConnection): void {
        // 서버가 사용자에게 보여달라고 보내는 것들. 진단 화면 재료로만 쓴다.
        connection.onNotification('window/logMessage', (params: { type: number; message: string }) => {
            this.options.events.onServerMessage(params?.type ?? 4, params?.message ?? '');
        });
        connection.onNotification('window/showMessage', (params: { type: number; message: string }) => {
            this.options.events.onServerMessage(params?.type ?? 3, params?.message ?? '');
        });
        connection.onNotification('$/progress', () => {
            // 진행률은 화면에 노드 단위 busy 표시로 이미 나온다. 여기서는 버린다.
        });

        // 동적 capability 등록·해제 (구현서 11.2).
        connection.onRequest(
            'client/registerCapability',
            (params: { registrations?: Array<{ method?: string }> }) => {
                for (const registration of params?.registrations ?? []) {
                    if (registration.method) {
                        this.dynamicCapabilities.add(registration.method);
                    }
                }
                this.options.events.onCapabilityChange();
                return null;
            },
        );
        connection.onRequest(
            'client/unregisterCapability',
            (params: { unregisterations?: Array<{ method?: string }> }) => {
                for (const registration of params?.unregisterations ?? []) {
                    if (registration.method) {
                        this.dynamicCapabilities.delete(registration.method);
                    }
                }
                this.options.events.onCapabilityChange();
                return null;
            },
        );

        // 서버가 진행률 토큰을 만들어 달라고 한다. 거절하면 일부 서버가 멈춘다.
        connection.onRequest('window/workDoneProgress/create', () => null);
        // 설정을 물으면 빈 값을 준다. 우리는 언어별 설정을 initializationOptions 로만 준다.
        connection.onRequest('workspace/configuration', (params: { items?: unknown[] }) =>
            (params?.items ?? []).map(() => null));
        connection.onRequest('workspace/workspaceFolders', () => null);
    }

    /** `initialize` → capability 저장 → `initialized`. */
    async initialize(params: unknown): Promise<InitializeResult> {
        const raw = await this.request<{
            capabilities?: JsonRpcServerCapabilities;
            serverInfo?: { name?: string };
        }>('initialize', params, INITIALIZE_TIMEOUT_MS);

        const capabilities = raw?.capabilities ?? {};
        this.staticCapabilities = {
            definition: hasProvider(capabilities.definitionProvider),
            documentSymbol: hasProvider(capabilities.documentSymbolProvider),
            implementation: hasProvider(capabilities.implementationProvider),
            typeDefinition: hasProvider(capabilities.typeDefinitionProvider),
        };

        this.notify('initialized', {});
        return {
            capabilities: this.capabilities,
            serverName: raw?.serverInfo?.name ?? null,
        };
    }

    /**
     * 정상 종료 (구현서 7.3).
     *
     * `shutdown` 요청 → 응답 → `exit` 알림 순서를 지킨다. 제한 시간을 넘기면
     * 그때만 프로세스를 끝낸다 — 언어 서버가 인덱스를 쓰는 중일 수 있어서
     * 처음부터 죽이지 않는다.
     */
    async stop(): Promise<void> {
        if (this.disposed) {
            return;
        }
        this.stopping = true;

        const child = this.child;
        const connection = this.connection;

        if (connection && child && child.exitCode === null) {
            try {
                await this.request('shutdown', null, SHUTDOWN_TIMEOUT_MS);
                this.notify('exit', null);
            } catch {
                // 응답이 없으면 아래에서 끝낸다.
            }
            await this.waitForExit(child, SHUTDOWN_TIMEOUT_MS);
        }

        this.dispose();
    }

    private waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
        if (child.exitCode !== null || child.signalCode !== null) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                child.removeListener('exit', onExit);
                // 제한 시간을 넘겼다. 여기서만 강제로 끝낸다.
                child.kill('SIGKILL');
                resolve();
            }, timeoutMs);
            const onExit = (): void => {
                clearTimeout(timer);
                resolve();
            };
            child.once('exit', onExit);
        });
    }

    /** 연결과 프로세스를 즉시 정리한다. crash 뒤에도 부른다. */
    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.stopping = true;

        try {
            this.connection?.dispose();
        } catch {
            // 이미 닫힌 연결이다.
        }
        this.connection = undefined;

        const child = this.child;
        this.child = undefined;
        if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
        }
    }

    // ── 요청 ────────────────────────────────────────────────────────────────

    /**
     * 요청 하나. 시간이 다 되면 `$/cancelRequest` 를 보내고 던진다.
     *
     * 취소를 보내는 이유는 pending 정리만이 아니다. 언어 서버는 취소 신호를
     * 받아야 그 작업을 멈춘다 — 안 그러면 이미 아무도 안 기다리는 계산에
     * CPU 를 계속 쓴다.
     */
    async request<T>(method: string, params: unknown, timeoutMs?: number): Promise<T> {
        const connection = this.connection;
        if (!connection) {
            throw new Error('언어 서버 연결이 없다.');
        }
        const limit = timeoutMs ?? this.requestTimeoutMs;
        const source = new CancellationTokenSource();

        let timer: NodeJS.Timeout | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                source.cancel();
                reject(new LspTimeoutError(method, limit));
            }, limit);
        });

        try {
            return (await Promise.race([
                connection.sendRequest<T>(method, params ?? undefined, source.token),
                timeout,
            ])) as T;
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
            source.dispose();
        }
    }

    notify(method: string, params: unknown): void {
        const connection = this.connection;
        if (!connection) {
            return;
        }
        try {
            void connection.sendNotification(method, params ?? undefined);
        } catch (error) {
            this.logger.debug('알림을 보내지 못했다.', {
                method,
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
