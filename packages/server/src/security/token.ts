import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 세션 토큰.
 *
 * 서버가 시작할 때 한 번 만들고 그 프로세스가 사는 동안만 유효하다. 디스크에
 * 남기지 않는다 — `.code-trail/` 은 사용자가 형상 관리할 수 있는 곳이고,
 * 잠금 파일에 토큰이 들어가면 같은 기계의 다른 사용자가 읽을 수 있다(구현서 8.1).
 */

/** 구현서 7.2 가 요구하는 256비트. */
const TOKEN_BYTES = 32;

export function createSessionToken(): string {
    return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * 토큰 비교.
 *
 * 길이가 다르면 바로 거짓이고, 같으면 `timingSafeEqual` 로 본다. 로컬 서버라
 * 원격 타이밍 공격은 비현실적이지만, 같은 기계에서 도는 다른 프로그램은
 * 신뢰 경계 밖이다. 비교 한 줄을 아껴서 얻을 것이 없다.
 */
export function isSameToken(expected: string, received: string | undefined): boolean {
    if (typeof received !== 'string' || received.length !== expected.length) {
        return false;
    }
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(received, 'utf8');
    if (a.length !== b.length) {
        return false;
    }
    return timingSafeEqual(a, b);
}

/**
 * `Authorization: Bearer <token>` 에서 토큰만 꺼낸다.
 * 형식이 아니면 `undefined` 를 준다 — 어디가 틀렸는지는 알려주지 않는다.
 */
export function bearerToken(header: string | undefined): string | undefined {
    if (typeof header !== 'string') {
        return undefined;
    }
    const match = /^Bearer (.+)$/.exec(header);
    return match ? match[1] : undefined;
}
