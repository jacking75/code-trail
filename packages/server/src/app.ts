import { existsSync } from 'node:fs';
import path from 'node:path';

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';

import type { ServerContext } from './context.js';
import { registerRoutes } from './http/routes.js';
import { WS_PROTOCOL, checkHttpAuth, checkSocketAuth } from './security/auth.js';
import { securityHeaders } from './security/csp.js';
import { WebSocketGateway } from './ws/gateway.js';

/**
 * Fastify 앱 조립.
 *
 * 요청이 지나는 순서가 곧 보안 경계다.
 *
 * ```text
 * 요청 → 보안 헤더 → (정적이면 통과)
 *                  → Host 확인 → Bearer 토큰 → 라우트
 * ```
 *
 * 정적 자산만 토큰 없이 통과한다. 브라우저는 첫 문서를 받기 전에는 토큰을
 * 붙일 방법이 없기 때문이다. 대신 그 문서에는 데이터가 없다 — 빈 껍데기와
 * 번들뿐이고, 토큰은 fragment 로 따로 온다(구현서 7.2).
 */

export interface AppOptions {
    context: ServerContext;
    token: string;
    /** 실제로 듣는 포트. Host 검사가 이 값을 쓴다. */
    port: number;
    /** 빌드된 웹 자산 디렉터리. 없으면 정적 제공을 건너뛴다. */
    webRoot?: string;
    /** Vite 개발 서버와 함께 쓸 때 CSP 를 느슨하게 한다. */
    dev?: boolean;
}

export interface CodeTrailApp {
    fastify: FastifyInstance;
    gateway: WebSocketGateway;
}

/** 토큰 없이 지나갈 수 있는 경로. 데이터가 없는 껍데기뿐이다. */
function isPublicPath(url: string): boolean {
    const pathname = url.split('?')[0] ?? '';
    if (pathname === '/' || pathname === '/index.html' || pathname === '/favicon.ico') {
        return true;
    }
    // Vite 빌드 산출물. 해시가 붙은 정적 파일이다.
    return pathname.startsWith('/assets/');
}

export async function createApp(options: AppOptions): Promise<CodeTrailApp> {
    const { context, token, port } = options;
    const app = Fastify({
        // Fastify 자체 로거를 끈다. 요청 URL 이 그대로 찍히면 경로가 로그에 남는다.
        logger: false,
        // 프록시 헤더를 믿지 않는다. 로컬 전용 서버다.
        trustProxy: false,
        // 종료할 때 살아 있는 연결을 기다리지 않는다. WebSocket 은 끊기 전까지
        // 계속 열려 있으므로, 기다리면 Ctrl+C 가 먹지 않는다.
        forceCloseConnections: true,
    });

    const origin = `http://127.0.0.1:${port}`;
    const headers = securityHeaders({ origin, dev: options.dev ?? false });

    app.addHook('onSend', async (_request, reply, payload) => {
        for (const [name, value] of Object.entries(headers)) {
            reply.header(name, value);
        }
        return payload;
    });

    app.addHook('onRequest', async (request, reply) => {
        // WebSocket 업그레이드는 아래 `/ws` 라우트가 직접 인증한다.
        // `request.ws` 는 라우트 안에서만 세워지므로 여기서는 헤더를 본다 —
        // 이걸 놓치면 업그레이드가 이 훅에서 401 로 막혀 라우트까지 못 간다.
        if (request.headers.upgrade?.toLowerCase() === 'websocket') {
            return;
        }
        if (isPublicPath(request.url)) {
            return;
        }
        const failure = checkHttpAuth({ token, port }, {
            host: request.headers.host,
            authorization: request.headers.authorization,
        });
        if (failure) {
            context.logger.debug('요청을 거부했다.', { reason: failure });
            // 무엇이 틀렸는지 알려주지 않는다. 탐색에 도움이 될 뿐이다.
            await reply.code(401).send({
                code: 'UNAUTHORIZED',
                message: '인증이 필요하다.',
                retryable: false,
            });
        }
    });

    await app.register(fastifyWebsocket, {
        options: {
            // 브라우저가 보낸 하위 프로토콜 중 우리 것만 골라 되돌려준다.
            // 토큰을 그대로 돌려보내지 않는다.
            handleProtocols: (protocols: Set<string>) =>
                protocols.has(WS_PROTOCOL) ? WS_PROTOCOL : false,
        },
    });

    const gateway = new WebSocketGateway(context);

    app.get('/ws', { websocket: true }, (socket, request) => {
        const failure = checkSocketAuth({ token, port }, {
            host: request.headers.host,
            origin: request.headers.origin,
            protocols: request.headers['sec-websocket-protocol'],
        });
        if (failure) {
            context.logger.debug('웹소켓을 거부했다.', { reason: failure });
            // 1008 = policy violation
            socket.close(1008, 'unauthorized');
            return;
        }
        gateway.accept(socket);
    });

    await registerRoutes(app, context);

    if (options.webRoot && existsSync(options.webRoot)) {
        await app.register(fastifyStatic, {
            root: options.webRoot,
            index: ['index.html'],
            // 디렉터리 목록을 노출하지 않는다.
            list: false,
            // 점으로 시작하는 파일을 내보내지 않는다.
            dotfiles: 'deny',
        });

        // 클라이언트 라우팅용 폴백. `/api` 와 `/ws` 는 여기 오지 않는다.
        app.setNotFoundHandler(async (request, reply) => {
            if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
                return reply.code(404).send({
                    code: 'NOT_FOUND',
                    message: '없는 경로다.',
                    retryable: false,
                });
            }
            return reply.sendFile('index.html');
        });
    } else {
        app.get('/', async (_request, reply) =>
            reply
                .code(503)
                .type('text/plain; charset=utf-8')
                .send('웹 자산이 없다. `npm run build -w @code-trail/web` 을 먼저 돌린다.\n'));
    }

    return { fastify: app, gateway };
}

/** 빌드된 웹 자산의 기본 위치. `packages/web/dist` 다. */
export function defaultWebRoot(serverDistDir: string): string {
    // dist/ 기준으로 packages/server/dist → packages/web/dist
    return path.resolve(serverDistDir, '..', '..', 'web', 'dist');
}
