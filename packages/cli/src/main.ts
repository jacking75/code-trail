#!/usr/bin/env node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveProjectRoot, startServer, type RunningServer } from '@code-trail/server';
import { MAX_SHARE_BYTES } from '@code-trail/shared';

import { CliArgsError, USAGE, parseArgs, type CliArgs } from './args.js';
import { openBrowser } from './openBrowser.js';
import { findLiveServer } from './reuse.js';

/**
 * `code-trail` 진입점 (구현서 7.2, 7.3).
 *
 * CLI 는 인자를 읽고, 프로젝트를 확인하고, 서버를 띄우고, 브라우저를 열고,
 * 종료 신호를 받는다. 심볼 해석과 트레일 변경은 하지 않는다(구현서 5.2).
 */

/**
 * `-v` 가 찍는 버전.
 *
 * 자기 `package.json` 에서 읽는다. 여기 상수로 적어두면 배포할 때마다 두 곳을
 * 고쳐야 하고, 한쪽만 고치면 `npm ls` 와 `code-trail -v` 가 다른 말을 한다.
 */
function readVersion(): string {
    try {
        const require = createRequire(import.meta.url);
        return (require('../package.json') as { version?: string }).version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
}

function fail(message: string): never {
    process.stderr.write(`code-trail: ${message}\n`);
    process.exit(1);
}

async function assertDirectory(input: string): Promise<string> {
    // 2~3. 절대경로로 정규화하고 심볼릭 링크를 푼 실제 경로를 고정한다.
    let root: string;
    try {
        root = await resolveProjectRoot(input);
    } catch {
        return fail(`프로젝트 경로를 찾을 수 없다: ${input}`);
    }
    const info = await stat(root).catch(() => undefined);
    if (!info?.isDirectory()) {
        return fail(`프로젝트 경로가 디렉터리가 아니다: ${input}`);
    }
    return root;
}

async function run(args: CliArgs): Promise<void> {
    let temporaryShareRoot: string | null = null;
    let shareText: string | null = null;
    let projectRoot: string;
    if (args.readSharePath) {
        const info = await stat(args.readSharePath).catch(() => undefined);
        if (!info?.isFile()) return fail('공유 묶음 파일을 찾을 수 없다.');
        if (info.size > MAX_SHARE_BYTES) return fail('공유 묶음 크기 제한을 넘었다.');
        try {
            shareText = await readFile(args.readSharePath, 'utf8');
            temporaryShareRoot = await mkdtemp(path.join(tmpdir(), 'code-trail-share-'));
            projectRoot = temporaryShareRoot;
        } catch {
            return fail('공유 묶음 파일을 읽을 수 없다.');
        }
    } else {
        projectRoot = await assertDirectory(args.projectDirectory);
    }

    // 5~6. 같은 프로젝트에 이미 서버가 떠 있으면 새로 띄우지 않는다.
    const { lock } = args.readSharePath ? { lock: null } : await findLiveServer(projectRoot);
    if (lock) {
        process.stderr.write(
            `code-trail: 이 프로젝트는 이미 열려 있다 (pid ${lock.pid}, http://127.0.0.1:${lock.port}).\n`
            + '           그 창을 쓰거나, 먼저 그 서버를 끄고 다시 실행한다.\n',
        );
        process.exit(0);
    }

    let server: RunningServer;
    try {
        server = await startServer({
            projectDirectory: projectRoot,
            port: args.port,
            logLevel: args.logLevel,
            ...(args.configPath ? { settingsPath: args.configPath } : {}),
            ...(args.readSharePath ? { readOnlyShare: true } : {}),
        });
    } catch (error) {
        if (temporaryShareRoot) {
            await rm(temporaryShareRoot, { recursive: true, force: true }).catch(() => undefined);
        }
        return fail(error instanceof Error ? error.message : String(error));
    }

    if (shareText !== null) {
        try {
            await server.context.sharing.import(shareText);
        } catch (error) {
            await server.close().catch(() => undefined);
            if (temporaryShareRoot) {
                await rm(temporaryShareRoot, { recursive: true, force: true }).catch(() => undefined);
            }
            return fail(error instanceof Error ? error.message : '공유 묶음을 열 수 없다.');
        }
    }

    // 10~11. 토큰은 fragment 로만 넘긴다. query 에 넣으면 서버 접근 로그,
    // 브라우저 방문 기록, Referer 헤더에 남는다. fragment 는 서버로 가지 않는다.
    const url = `${server.url}/#token=${server.token}`
        + (args.trailId ? `&trail=${encodeURIComponent(args.trailId)}` : '');

    process.stdout.write(`Code Trail  ${server.url}\n`);
    process.stdout.write(args.readSharePath ? '읽기 전용 공유 묶음\n' : `프로젝트    ${server.projectRoot}\n`);

    if (args.open) {
        const opened = openBrowser(url);
        if (!opened.ok) {
            process.stdout.write('브라우저를 열지 못했다. 아래 주소를 직접 연다:\n');
            process.stdout.write(`${url}\n`);
        }
    } else {
        process.stdout.write(`${url}\n`);
    }
    process.stdout.write('종료하려면 Ctrl+C\n');

    // 12. 종료 신호. 두 번 누르면 기다리지 않고 끝낸다 —
    // 저장이 걸려 있어도 사용자가 정말 끄고 싶을 때가 있다.
    let closing = false;
    const shutdown = (signal: string): void => {
        if (closing) {
            process.stderr.write('\n강제로 끝낸다.\n');
            process.exit(130);
        }
        closing = true;
        process.stderr.write(`\n${signal} 을 받았다. 저장을 끝내고 닫는다…\n`);
        server
            .close()
            .then(async () => {
                if (temporaryShareRoot) {
                    await rm(temporaryShareRoot, { recursive: true, force: true });
                }
            })
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // Windows 콘솔 닫기·로그오프. 지원하지 않는 플랫폼에서는 그냥 안 온다.
    process.on('SIGHUP', () => shutdown('SIGHUP'));
    if (process.platform === 'win32') {
        process.on('SIGBREAK', () => shutdown('SIGBREAK'));
    }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
    let args: CliArgs;
    try {
        args = parseArgs(argv);
    } catch (error) {
        if (error instanceof CliArgsError) {
            process.stderr.write(`code-trail: ${error.message}\n\n${USAGE}`);
            process.exit(2);
        }
        throw error;
    }

    if (args.mode === 'help') {
        process.stdout.write(USAGE);
        return;
    }
    if (args.mode === 'version') {
        process.stdout.write(`${readVersion()}\n`);
        return;
    }
    await run(args);
}

// 이 파일이 직접 실행됐을 때만 돈다. 테스트가 import 할 때는 돌지 않는다.
// Windows 경로(`C:\...`)를 문자열로 이으면 드라이브 문자가 호스트로 잡힌다.
// `pathToFileURL` 이 플랫폼별 규칙을 대신 처리한다.
const invokedDirectly = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
    main().catch((error: unknown) => {
        process.stderr.write(`code-trail: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    });
}
