import type { SupportedLanguage } from '../workspace/languages.js';

/**
 * 언어 서버 세션의 상태 (구현서 11.6).
 *
 * ```text
 * stopped → detecting → starting → initializing → ready
 *                         │             │          │
 *                         └─────────────┴──────────┤
 *                                                  ↓
 *                          failed ← backoff ← crashed
 * ```
 *
 * `protocolError` 는 stdout 에 JSON-RPC 가 아닌 것이 섞였을 때다. 재시작해도
 * 같은 일이 반복될 가능성이 높아 crash 와 구분한다 — 대개 언어 서버가 stdout 에
 * 진단을 찍는 설정 문제이고, 사용자가 고쳐야 한다.
 */
export type LspState =
    | 'stopped'
    | 'detecting'
    | 'starting'
    | 'initializing'
    | 'ready'
    | 'degraded'
    | 'backoff'
    | 'crashed'
    | 'protocolError'
    | 'failed';

/** 브라우저로 나가는 상태. 내부 단계를 그대로 노출하지 않는다. */
export type PublicLspState = 'notStarted' | 'starting' | 'ready' | 'failed' | 'stopped';

export function toPublicState(state: LspState): PublicLspState {
    switch (state) {
        case 'stopped':
            return 'stopped';
        case 'detecting':
        case 'starting':
        case 'initializing':
        case 'backoff':
            return 'starting';
        case 'ready':
        case 'degraded':
            return 'ready';
        case 'crashed':
        case 'protocolError':
        case 'failed':
            return 'failed';
        default:
            return 'notStarted';
    }
}

export interface LspSessionInfo {
    language: SupportedLanguage;
    enabled: boolean;
    state: LspState;
    /**
     * 탐지된 실행 파일 **이름**. 전체 경로는 브라우저로 내보내지 않는다
     * (구현서 8.1 — 로그와 오류에 절대경로를 남기지 않는다).
     */
    executableName: string | null;
    lastError: string | null;
    restartCount: number;
    /** 필수 capability 가 없어 기능이 줄어든 상태인지. */
    missingCapabilities: string[];
}

/** 실행할 명령. shell 을 거치지 않는다. */
export interface SpawnCommand {
    command: string;
    args: string[];
    /** 덮어쓸 환경 변수만. 전체 환경을 대체하지 않는다. */
    env: Record<string, string>;
    cwd: string;
}

/** 우리가 실제로 쓰는 capability 만 추린 것. */
export interface ServerCapabilitySummary {
    definition: boolean;
    documentSymbol: boolean;
    implementation: boolean;
    typeDefinition: boolean;
}

export class LspUnavailableError extends Error {
    constructor(readonly language: SupportedLanguage, message: string) {
        super(message);
        this.name = 'LspUnavailableError';
    }
}

export class LspTimeoutError extends Error {
    constructor(readonly method: string, readonly timeoutMs: number) {
        super(`${method} 응답이 ${timeoutMs}ms 안에 오지 않았다.`);
        this.name = 'LspTimeoutError';
    }
}
