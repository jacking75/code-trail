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
    /** 자식 프로세스 PID. 안 떠 있으면 `null`. */
    pid: number | null;
    /** 서버가 광고한 네 capability. 광고와 실제는 다를 수 있다. */
    capabilities: ServerCapabilitySummary;
    /** `initialize` 왕복에 걸린 시간(ms). 아직 안 떴으면 `null`. */
    initializeMs: number | null;
    /** 마지막으로 **성공한** 요청. 서버가 실제로 답하고 있다는 증거다. */
    lastRequest: { method: string; durationMs: number; at: string } | null;
    /** 마지막 비정상 종료. 정상 종료는 남기지 않는다. */
    lastExit: { code: number | null; signal: string | null; at: string } | null;
    /**
     * 실제 샘플 문서에서 응답을 받아본 메서드.
     *
     * 진단 화면의 `지원됨` 은 이 목록을 근거로 한다. 프로세스가 떴다는 것과
     * 요청이 응답한다는 것은 다른 말이다(구현서 18).
     */
    verifiedMethods: string[];
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
