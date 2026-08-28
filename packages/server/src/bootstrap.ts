import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp, defaultWebRoot, type CodeTrailApp } from './app.js';
import { createLogger, type LogLevel, type Logger } from './config/logger.js';
import type { ServerContext } from './context.js';
import { EditorService } from './editor/service.js';
import { pathToUri } from './lsp/documents.js';
import { LspManager } from './lsp/manager.js';
import { toPublicState, type LspSessionInfo } from './lsp/types.js';
import { ResolveFlow } from './trails/resolveFlow.js';
import { SymbolResolver } from './symbols/resolver.js';
import { removeLock, writeLock } from './persistence/lock.js';
import { SaveScheduler } from './persistence/scheduler.js';
import { ProjectStore } from './persistence/store.js';
import { resolveProjectRoot } from './security/paths.js';
import { createSessionToken } from './security/token.js';
import { TrailService } from './trails/service.js';
import { DocumentRegistry } from './workspace/documents.js';
import { WorkspaceTree } from './workspace/tree.js';
import { WorkspaceWatcher } from './workspace/watcher.js';

/**
 * 시작과 종료 (구현서 7.2, 7.3).
 *
 * 순서에 이유가 있다.
 *
 * - 프로젝트 루트를 **먼저** 고정한다. 이후 모든 경계 판정의 기준이라,
 *   심볼릭 링크를 여기서 풀지 않으면 프로젝트 안의 파일이 전부 "밖" 이 된다.
 * - 저장소를 열고 트레일을 **먼저** 불러온다. 포트를 열어놓고 로드하면 첫
 *   연결이 빈 트레일을 보고 사용자가 "사라졌다" 고 여긴다.
 * - 잠금 파일은 **마지막**에 쓴다. 포트를 실제로 잡은 뒤여야 그 값이 참이다.
 */

export interface StartServerOptions {
    projectDirectory: string;
    /** 0 이면 운영체제가 빈 포트를 고른다. */
    port?: number;
    logLevel?: LogLevel;
    /** 테스트와 특수 환경에서만 설정 파일 위치를 바꾼다. */
    settingsPath?: string;
    /** 빌드된 웹 자산 위치. 기본은 `packages/web/dist`. */
    webRoot?: string;
    dev?: boolean;
    /** 테스트에서 로그를 가로챈다. */
    logWrite?: (line: string) => void;
    /** 테스트에서 LSP 요청 timeout 과 재시작 간격을 줄인다. */
    lspRequestTimeoutMs?: number;
    lspRestartDelaysMs?: readonly number[];
    /** 언어 서버가 이만큼 버티면 재시도 횟수를 되돌린다. 테스트에서 줄인다. */
    lspStableAfterMs?: number;
}

export interface RunningServer {
    url: string;
    port: number;
    token: string;
    projectRoot: string;
    context: ServerContext;
    app: CodeTrailApp;
    close: () => Promise<void>;
}

export async function startServer(options: StartServerOptions): Promise<RunningServer> {
    const logger: Logger = createLogger({
        level: options.logLevel ?? 'info',
        ...(options.logWrite ? { write: options.logWrite } : {}),
    });

    // 1~3. 프로젝트 루트를 고정한다.
    const projectRoot = await resolveProjectRoot(options.projectDirectory);
    const projectName = path.basename(projectRoot) || projectRoot;

    // 4. `.code-trail/` 을 만들고 설정을 읽는다.
    const store = new ProjectStore({
        projectRoot,
        logger,
        ...(options.settingsPath ? { settingsPath: options.settingsPath } : {}),
    });
    await store.initialize();

    const scheduler = new SaveScheduler({ logger });
    const trails = new TrailService({ store, scheduler, logger });
    await trails.load();

    const tree = new WorkspaceTree({ projectRoot });
    const documents = new DocumentRegistry(projectRoot);

    // 앱이 만들어진 뒤에야 게이트웨이가 생긴다. 상태 변화는 그때부터 뿌린다.
    let broadcastLspState: (info: LspSessionInfo) => void = () => undefined;

    const lsp = new LspManager({
        projectRoot,
        logger,
        getSettings: () => store.getSettings(),
        onStateChange: (info) => broadcastLspState(info),
        ...(options.lspRequestTimeoutMs !== undefined
            ? { requestTimeoutMs: options.lspRequestTimeoutMs }
            : {}),
        ...(options.lspRestartDelaysMs !== undefined
            ? { restartDelaysMs: options.lspRestartDelaysMs }
            : {}),
        ...(options.lspStableAfterMs !== undefined
            ? { stableAfterMs: options.lspStableAfterMs }
            : {}),
    });

    const resolver = new SymbolResolver({
        lsp,
        documents,
        logger,
        getContextLines: () => store.getSettings().ui.contextLines,
    });

    const resolveFlow = new ResolveFlow({
        trails,
        resolver,
        documents,
        logger,
        getSettings: () => store.getSettings(),
    });

    const editor = new EditorService({
        projectRoot,
        documents,
        logger,
        getSettings: () => store.getSettings(),
    });

    const context: ServerContext = {
        projectRoot,
        projectName,
        logger,
        store,
        trails,
        tree,
        documents,
        lsp,
        resolveFlow,
        editor,
    };

    // 설정을 바꾸면 실행 파일을 다시 찾는다. 안 그러면 경로를 고쳐도
    // 다음 재시작까지 예전 결과가 남는다.
    store.onSettingsChanged(() => lsp.invalidateDetection());

    // 7. 세션 토큰. 프로세스가 사는 동안만 유효하고 디스크에 남기지 않는다.
    const token = createSessionToken();

    // 8. 빈 포트에 바인딩한다. **127.0.0.1 만.**
    //    외부 인터페이스로 여는 옵션은 제공하지 않는다(구현서 7.1).
    const requestedPort = options.port ?? 0;
    const webRoot = options.webRoot ?? defaultWebRoot(path.dirname(fileURLToPath(import.meta.url)));

    // 포트가 정해지기 전에는 Host·Origin 검사가 쓸 값을 모른다. 그래서
    // 임시 포트 0 으로 앱을 만들지 않고, 먼저 듣기만 하는 서버를 띄운 뒤
    // 실제 포트를 알아내는 방식 대신 Fastify 에게 포트를 받아 앱을 다시 만든다.
    const port = requestedPort === 0 ? await findFreePort() : requestedPort;

    const app = await createApp({
        context,
        token,
        port,
        webRoot,
        ...(options.dev !== undefined ? { dev: options.dev } : {}),
    });

    await app.fastify.listen({ host: '127.0.0.1', port });

    broadcastLspState = (info) => {
        app.gateway.broadcast('lsp.stateChanged', {
            language: info.language,
            state: toPublicState(info.state),
            lastError: info.lastError,
        }, {});
    };

    const watcher = new WorkspaceWatcher({
        tree,
        logger,
        onChange: (relPaths) => {
            logger.debug('파일이 바뀌었다.', { count: relPaths.length });
            // 서버가 대신 다시 읽지 않는다. 무엇이 바뀌었는지만 알린다 —
            // 갱신 시점은 화면(과 사용자)이 정한다.
            app.gateway.broadcast('workspace.filesChanged', { relPaths }, {});
            // 언어 서버에는 알린다. 그쪽은 낡은 내용으로 답하면 안 된다.
            for (const relPath of relPaths) {
                void lsp.notifyFileChanged(
                    pathToUri(path.join(projectRoot, ...relPath.split('/'))),
                );
            }
        },
    });
    watcher.start();

    // 9. 잠금 파일. **토큰은 넣지 않는다.**
    await writeLock(store.runtimeDir, {
        schemaVersion: 1,
        pid: process.pid,
        port,
        startedAt: new Date().toISOString(),
    });

    const url = `http://127.0.0.1:${port}`;
    logger.info('서버가 떴다.', { port, project: projectName });

    let closed = false;
    const close = async (): Promise<void> => {
        if (closed) {
            return;
        }
        closed = true;
        // 1~2. 새 연결을 받지 않고 화면에 알린다.
        app.gateway.closeAll();
        watcher.stop();
        // 3. 대기 중인 저장을 끝낸다.
        await trails.flush();
        await scheduler.stop();
        // 4~6. 언어 서버에 shutdown/exit 를 보내고, 제한 시간을 넘긴 것만 끝낸다.
        await lsp.stopAll();
        await app.fastify.close();
        // 7. 잠금 파일을 지운다.
        await removeLock(store.runtimeDir);
        logger.info('서버를 닫았다.');
    };

    return { url, port, token, projectRoot, context, app, close };
}

/**
 * 빈 포트 하나를 얻는다.
 *
 * 포트 0 으로 바인딩하면 운영체제가 골라주지만, 그 값을 알기 전에는 Host·Origin
 * 검사가 쓸 기준을 정할 수 없다. 그래서 잠깐 열었다 닫아 번호만 받아온다.
 * 그 틈에 다른 프로세스가 채갈 수 있지만, 그때는 `listen` 이 실패하고 사용자가
 * 다시 시도한다 — 로컬 개발 도구에서 감수할 만한 좁은 창이다.
 */
async function findFreePort(): Promise<number> {
    const { createServer } = await import('node:net');
    return new Promise((resolve, reject) => {
        const probe = createServer();
        probe.on('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            if (address === null || typeof address === 'string') {
                probe.close(() => reject(new Error('포트를 정할 수 없다.')));
                return;
            }
            const { port } = address;
            probe.close(() => resolve(port));
        });
    });
}
