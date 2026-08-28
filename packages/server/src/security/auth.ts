import { bearerToken, isSameToken } from './token.js';

/**
 * 요청이 이 서버로 온 것이 맞는지, 그리고 토큰을 가지고 있는지.
 *
 * 로컬 서버라도 브라우저는 신뢰 경계 밖이다. 인터넷의 아무 페이지나 우리
 * `127.0.0.1:<port>` 로 요청을 보낼 수 있고, DNS rebinding 을 쓰면 자기 도메인이
 * 우리 주소로 해석되게 만들 수도 있다. 그래서 두 겹으로 막는다.
 *
 * 1. **Host** — 우리가 아는 로컬 이름이어야 한다. rebinding 은 공격자 도메인을
 *    Host 로 싣고 오므로 여기서 걸린다.
 * 2. **Bearer 토큰** — 남의 페이지는 우리 토큰을 모른다. 토큰은 fragment 로만
 *    전달되고 브라우저는 fragment 를 서버로 보내지 않는다.
 *
 * WebSocket 은 여기에 **Origin** 확인을 더한다. 브라우저가 WebSocket 요청에
 * Origin 을 반드시 붙이기 때문에, HTTP 보다 한 겹 더 볼 수 있다.
 */

/** DNS rebinding 을 막기 위해 허용하는 Host 이름. 포트는 따로 본다. */
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export type AuthFailure = 'badHost' | 'badOrigin' | 'noToken';

export interface AuthContext {
    token: string;
    /** 서버가 실제로 듣고 있는 포트. */
    port: number;
}

function hostnameOf(host: string): string {
    // `[::1]:1234` 와 `127.0.0.1:1234` 를 모두 다룬다.
    if (host.startsWith('[')) {
        const close = host.indexOf(']');
        return close === -1 ? host : host.slice(0, close + 1);
    }
    const colon = host.lastIndexOf(':');
    return colon === -1 ? host : host.slice(0, colon);
}

function portOf(host: string): string | undefined {
    const after = host.startsWith('[') ? host.slice(host.indexOf(']') + 1) : host;
    const colon = after.lastIndexOf(':');
    return colon === -1 ? undefined : after.slice(colon + 1);
}

export function isAllowedHost(host: string | undefined, port: number): boolean {
    if (typeof host !== 'string' || host === '') {
        return false;
    }
    if (!ALLOWED_HOSTNAMES.has(hostnameOf(host))) {
        return false;
    }
    const hostPort = portOf(host);
    // 포트가 없으면 80/443 이라는 뜻이다. 우리는 그 포트로 듣지 않는다.
    return hostPort === String(port);
}

/** 이 서버가 스스로를 부르는 이름들. WebSocket Origin 은 이 중 하나여야 한다. */
export function allowedOrigins(port: number): string[] {
    return [
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
        `http://[::1]:${port}`,
    ];
}

export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
    if (typeof origin !== 'string') {
        // 브라우저는 WebSocket 요청에 Origin 을 반드시 붙인다. 없다는 것은
        // 브라우저가 아니라는 뜻이고, 그런 요청은 받지 않는다.
        return false;
    }
    return allowedOrigins(port).includes(origin);
}

export interface HttpAuthInput {
    host: string | undefined;
    authorization: string | undefined;
}

export function checkHttpAuth(context: AuthContext, input: HttpAuthInput): AuthFailure | null {
    if (!isAllowedHost(input.host, context.port)) {
        return 'badHost';
    }
    if (!isSameToken(context.token, bearerToken(input.authorization))) {
        return 'noToken';
    }
    return null;
}

export interface SocketAuthInput {
    host: string | undefined;
    origin: string | undefined;
    /**
     * 브라우저 WebSocket 은 헤더를 붙일 수 없다. 대신 표준 하위 프로토콜 자리에
     * 토큰을 싣는다 — query 에 넣으면 서버 접근 로그에 남기 때문이다(구현서 8.1).
     */
    protocols: string | undefined;
}

/** `Sec-WebSocket-Protocol: code-trail, <token>` 에서 토큰만 꺼낸다. */
export const WS_PROTOCOL = 'code-trail';

export function socketToken(protocols: string | undefined): string | undefined {
    if (typeof protocols !== 'string') {
        return undefined;
    }
    const parts = protocols.split(',').map((p) => p.trim());
    if (parts[0] !== WS_PROTOCOL) {
        return undefined;
    }
    return parts[1];
}

export function checkSocketAuth(context: AuthContext, input: SocketAuthInput): AuthFailure | null {
    if (!isAllowedHost(input.host, context.port)) {
        return 'badHost';
    }
    if (!isAllowedOrigin(input.origin, context.port)) {
        return 'badOrigin';
    }
    if (!isSameToken(context.token, socketToken(input.protocols))) {
        return 'noToken';
    }
    return null;
}
