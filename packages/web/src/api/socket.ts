import { currentToken } from './session.js';

/**
 * WebSocket 연결 (구현서 16.4).
 *
 * 브라우저 WebSocket 은 헤더를 붙일 수 없다. 토큰을 query 에 넣으면 서버
 * 접근 로그에 남으므로, 표준 하위 프로토콜 자리에 싣는다 —
 * `Sec-WebSocket-Protocol: code-trail, <token>`.
 *
 * 끊기면 지수 backoff 로 다시 붙는다. 다시 붙으면 서버가 snapshot 을 새로
 * 보내주므로 클라이언트가 따로 따라잡을 필요가 없다.
 */

export const WS_PROTOCOL = 'code-trail';

export type ConnectionState = 'connecting' | 'open' | 'closed';

export interface ServerEventMessage {
    protocolVersion: number;
    type: string;
    eventId: string;
    commandId?: string;
    trailId?: string;
    revision?: number;
    payload: unknown;
}

export interface TrailSocketOptions {
    onEvent: (event: ServerEventMessage) => void;
    onState: (state: ConnectionState) => void;
}

const MIN_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

export class TrailSocket {
    private socket: WebSocket | null = null;
    private retryMs = MIN_RETRY_MS;
    private timer: number | undefined;
    private stopped = false;

    constructor(private readonly options: TrailSocketOptions) {}

    connect(): void {
        const token = currentToken();
        if (token === null) {
            this.options.onState('closed');
            return;
        }
        this.stopped = false;
        this.options.onState('connecting');

        const url = `${window.location.origin.replace(/^http/, 'ws')}/ws`;
        const socket = new WebSocket(url, [WS_PROTOCOL, token]);
        this.socket = socket;

        socket.addEventListener('open', () => {
            this.retryMs = MIN_RETRY_MS;
            this.options.onState('open');
        });

        socket.addEventListener('message', (event) => {
            let parsed: unknown;
            try {
                parsed = JSON.parse(String(event.data));
            } catch {
                return;
            }
            this.options.onEvent(parsed as ServerEventMessage);
        });

        socket.addEventListener('close', () => {
            this.socket = null;
            this.options.onState('closed');
            if (!this.stopped) {
                this.scheduleRetry();
            }
        });

        socket.addEventListener('error', () => {
            // close 가 따라온다. 여기서는 아무것도 하지 않는다.
        });
    }

    send(message: unknown): boolean {
        if (this.socket === null || this.socket.readyState !== WebSocket.OPEN) {
            return false;
        }
        this.socket.send(JSON.stringify(message));
        return true;
    }

    close(): void {
        this.stopped = true;
        if (this.timer !== undefined) {
            window.clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.socket?.close();
        this.socket = null;
    }

    private scheduleRetry(): void {
        const delay = this.retryMs;
        this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
        this.timer = window.setTimeout(() => this.connect(), delay);
    }
}
