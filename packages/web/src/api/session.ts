/**
 * 세션 토큰 부트스트랩 (구현서 7.2, 11단계).
 *
 * CLI 가 브라우저를 `http://127.0.0.1:<port>/#token=<token>` 으로 연다.
 * fragment 를 쓰는 이유는 그 부분이 **서버로 전송되지 않기** 때문이다 —
 * query 에 넣으면 접근 로그, Referer, 브라우저 방문 기록에 남는다.
 *
 * 화면이 뜨자마자 fragment 를 `sessionStorage` 로 옮기고 **토큰만** 주소에서
 * 지운다. `sessionStorage` 는 탭 하나에 묶이고 탭을 닫으면 사라진다 —
 * 새로고침은 견디고, 다른 탭이나 다음 세션으로는 새지 않는다.
 *
 * 나머지 fragment 는 남긴다. 노드 링크(`#trail=…&node=…`, V08)와 기록 링크가
 * 그 자리를 쓰기 때문이다 — 통째로 지우면 링크를 열어도 아무 데도 가지 않는다.
 */

const TOKEN_KEY = 'codeTrail.token';
const TRAIL_KEY = 'codeTrail.trailId';

export interface Session {
    token: string | null;
    /** CLI 의 `--trail` 로 지정된 트레일. */
    trailId: string | null;
}

function readFragment(): { token?: string; trail?: string } {
    const hash = window.location.hash.replace(/^#/, '');
    if (hash === '') {
        return {};
    }
    const params = new URLSearchParams(hash);
    const out: { token?: string; trail?: string } = {};
    const token = params.get('token');
    const trail = params.get('trail');
    if (token) {
        out.token = token;
    }
    if (trail) {
        out.trail = trail;
    }
    return out;
}

/**
 * 한 번만 부른다. fragment 에 토큰이 있으면 저장하고 주소를 지운다.
 * 새로고침 뒤에는 fragment 가 없고 `sessionStorage` 에서 읽는다.
 */
export function bootstrapSession(): Session {
    const fragment = readFragment();

    if (fragment.token) {
        sessionStorage.setItem(TOKEN_KEY, fragment.token);
    }
    if (fragment.trail) {
        sessionStorage.setItem(TRAIL_KEY, fragment.trail);
    }
    if (fragment.token) {
        // 토큰만 주소창과 방문 기록에서 즉시 지운다. `replaceState` 라
        // 뒤로 가기로도 토큰이 있던 주소로 돌아갈 수 없다.
        const rest = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        rest.delete('token');
        const remaining = rest.toString();
        window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search
                + (remaining === '' ? '' : `#${remaining}`),
        );
    }

    return {
        token: sessionStorage.getItem(TOKEN_KEY),
        trailId: sessionStorage.getItem(TRAIL_KEY),
    };
}

export function currentToken(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
}

/** 서버가 토큰을 거부했다. 남은 값이 계속 401 을 만들지 않게 지운다. */
export function clearSession(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TRAIL_KEY);
}
