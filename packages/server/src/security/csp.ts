/**
 * 정적 화면의 보안 헤더.
 *
 * 확장 시절 웹뷰 CSP 가 하던 일을 그대로 옮겼다. 외부 CDN, 인라인 스크립트,
 * 임의 `connect-src` 를 허용하지 않는다(구현서 8.1). 이 서버는 로컬 파일과
 * 프로세스에 닿을 수 있으므로 화면에 남의 스크립트가 끼어들 자리를 두지 않는다.
 */

export interface CspOptions {
    /** 이 서버의 정확한 origin. 예: `http://127.0.0.1:5173` */
    origin: string;
    /** 개발 모드에서는 Vite HMR 이 인라인 스크립트와 ws 를 쓴다. */
    dev: boolean;
}

export function contentSecurityPolicy(options: CspOptions): string {
    const wsOrigin = options.origin.replace(/^http/, 'ws');

    const directives: Array<[string, string[]]> = [
        ["default-src", ["'none'"]],
        // 번들은 자기 자신에서만 온다. CDN 없음.
        ['script-src', ["'self'"]],
        // Monaco 는 스타일을 런타임에 만들어 넣는다. style-src 만 unsafe-inline 을 준다.
        ['style-src', ["'self'", "'unsafe-inline'"]],
        ['img-src', ["'self'", 'data:']],
        ['font-src', ["'self'", 'data:']],
        // Monaco 워커. blob: 없이는 워커가 안 뜬다.
        ['worker-src', ["'self'", 'blob:']],
        ['connect-src', ["'self'", wsOrigin]],
        ['form-action', ["'none'"]],
        ['frame-ancestors', ["'none'"]],
        ['base-uri', ["'none'"]],
        ['object-src', ["'none'"]],
    ];

    if (options.dev) {
        // Vite 개발 서버만. 빌드된 자산에는 붙지 않는다.
        directives[1]?.[1].push("'unsafe-inline'", "'unsafe-eval'");
        directives[6]?.[1].push('ws://127.0.0.1:*', 'ws://localhost:*');
    }

    return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** CSP 와 함께 붙이는 나머지 헤더. */
export function securityHeaders(options: CspOptions): Record<string, string> {
    return {
        'Content-Security-Policy': contentSecurityPolicy(options),
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        // 토큰이 주소창 fragment 로 잠깐 지나간다. 캐시에 남기지 않는다.
        'Cache-Control': 'no-store',
    };
}
