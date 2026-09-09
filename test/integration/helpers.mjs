/**
 * 통합 테스트 공용 도구.
 *
 * 진짜 서버를 진짜 포트에 띄운다. 가짜 Fastify 나 요청 스텁을 쓰지 않는다 —
 * 여기서 확인하려는 것 대부분(Host 검사, Origin 검사, CSP 헤더, 원자적 저장)이
 * 실제 소켓과 실제 파일 시스템에서만 드러나기 때문이다.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const server = await import(
    new URL('../../packages/server/dist/index.js', import.meta.url).href
);

/** 테스트마다 새 임시 프로젝트를 만든다. */
export async function makeProject(files = {}) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'code-trail-test-'));
    for (const [relPath, contents] of Object.entries(files)) {
        const full = path.join(root, ...relPath.split('/'));
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, contents, 'utf8');
    }
    return root;
}

export async function removeProject(root) {
    await rm(root, { recursive: true, force: true });
}

/** 기계·개인 설정은 프로젝트 설정이 아니라 local/settings.json에 쓴다. */
export async function updateLocalSettings(root, mutate) {
    const target = path.join(root, '.code-trail', 'local', 'settings.json');
    const settings = JSON.parse(await readFile(target, 'utf8'));
    mutate(settings);
    await writeFile(target, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

/** 서버를 띄우고 끝나면 반드시 닫는다. */
export async function withServer(projectRoot, run, options = {}) {
    const running = await server.startServer({
        projectDirectory: projectRoot,
        logLevel: 'error',
        // 테스트 출력에 로그가 섞이지 않게 삼킨다.
        logWrite: () => {},
        ...options,
    });
    try {
        return await run(running);
    } finally {
        await running.close();
    }
}

/** 인증 헤더를 붙인 fetch. */
export function authFetch(running, pathname, init = {}) {
    return fetch(`${running.url}${pathname}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${running.token}`,
            ...(init.headers ?? {}),
        },
    });
}

/** 저장 debounce 가 끝날 때까지 파일을 기다린다. */
export async function waitForFile(target, timeoutMs = 3000) {
    const { stat } = await import('node:fs/promises');
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const info = await stat(target).catch(() => undefined);
        if (info) {
            return info;
        }
        if (Date.now() > deadline) {
            throw new Error(`파일이 생기지 않았다: ${target}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
}
