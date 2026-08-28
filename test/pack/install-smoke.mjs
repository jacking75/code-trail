/*
 * 배포물 설치 스모크 — node test/pack/install-smoke.mjs
 *
 * `npm pack` 으로 만든 tarball 을 **워크스페이스 밖 깨끗한 폴더**에 실제로 설치하고
 * `code-trail` 을 띄워 본다. 여기서 보려는 것은 하나다 —
 * **워크스페이스 링크에 기대고 있지 않은가.**
 *
 * 저장소 안에서는 `node_modules/@code-trail/*` 이 심볼릭 링크라 무엇이든 잘 보인다.
 * 진짜로 설치했을 때도 그런지는 이렇게 해봐야만 안다. 웹 정적 자산을 못 찾으면
 * 사용자는 빈 화면을 보고, 그건 우리 테스트가 하나도 못 잡던 실패다.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

let failures = 0;
const check = (name, condition, extra) => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${!condition && extra ? ` — ${extra}` : ''}`);
    if (!condition) {
        failures++;
    }
};

/**
 * npm 을 셸 없이 부른다.
 *
 * Windows 의 `npm.cmd` 는 배치 파일이라 `shell: false` 로 못 띄운다.
 * `npm run` 으로 들어오면 npm 이 자기 진입점을 `npm_execpath` 에 넣어 준다.
 */
function npmCli() {
    const fromEnv = process.env['npm_execpath'];
    if (fromEnv !== undefined && fromEnv.endsWith('.js')) {
        return fromEnv;
    }
    return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

function npm(args, cwd) {
    return execFileSync(process.execPath, [npmCli(), ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        shell: false,
    });
}

const WORKSPACES = ['@code-trail/shared', '@code-trail/web', '@code-trail/server', 'code-trail'];

const stage = await mkdtemp(path.join(os.tmpdir(), 'code-trail-pack-'));
const home = await mkdtemp(path.join(os.tmpdir(), 'code-trail-install-'));
const project = path.join(home, 'sample-project');

try {
    console.log('\n[tarball 만들기]');
    const tarballs = [];
    for (const workspace of WORKSPACES) {
        const out = npm(['pack', '--pack-destination', stage, '-w', workspace], ROOT).trim();
        const name = out.split(/\r?\n/).filter(Boolean).pop();
        tarballs.push(path.join(stage, name));
        console.log(`  ${workspace} → ${name}`);
    }
    check('네 패키지를 다 만들었다', tarballs.length === 4);

    console.log('\n[깨끗한 폴더에 설치]');
    await mkdir(project, { recursive: true });
    await writeFile(path.join(project, 'main.cpp'), 'int main() { return 0; }\n', 'utf8');
    await writeFile(
        path.join(home, 'package.json'),
        `${JSON.stringify({ name: 'install-smoke', private: true, version: '1.0.0' }, null, 2)}\n`,
        'utf8',
    );
    // tarball 끼리의 의존성도 tarball 로 풀어야 한다. 네 개를 한 번에 넣는다.
    npm(['install', '--no-audit', '--no-fund', ...tarballs], home);
    check('설치가 끝났다', true);

    console.log('\n[설치된 것으로 실행]');
    const cli = path.join(home, 'node_modules', 'code-trail', 'dist', 'main.js');
    const version = execFileSync(process.execPath, [cli, '--version'], {
        encoding: 'utf8',
        shell: false,
    }).trim();
    check('버전을 찍는다', version === '1.0.0', version);

    // 서버를 실제로 띄우고 정적 화면과 API 가 사는지 본다.
    const child = spawn(process.execPath, [cli, project, '--no-open', '--log-level', 'info'], {
        cwd: home,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
        output += chunk;
    });
    child.stderr.on('data', (chunk) => {
        output += chunk;
    });

    const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(
            () => reject(new Error(`주소를 못 찾았다:\n${output}`)),
            30000,
        );
        const poll = setInterval(() => {
            // 주소는 두 번 찍힌다 — 요약 줄과 토큰이 붙은 실제 주소.
            // 토큰이 붙은 쪽을 기다린다.
            const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[^\s]+/);
            if (match) {
                clearTimeout(timer);
                clearInterval(poll);
                resolve(match[0]);
            }
        }, 100);
    });

    try {
        // `http://127.0.0.1:PORT/` 로 끝나므로 그대로 이어 붙이면 `//api/...` 가 된다.
        const base = url.split('#')[0].replace(/\/+$/, '');
        const shell = await fetch(base);
        check('정적 셸이 뜬다', shell.status === 200, String(shell.status));
        const html = await shell.text();
        // 웹 자산을 못 찾으면 서버가 503 과 안내 문구를 준다. 그 상태를 잡는다.
        check('웹 자산을 찾았다', html.includes('<div id="root"'), html.slice(0, 160));

        // 토큰 없이는 API 가 안 열린다.
        const denied = await fetch(`${base}/api/bootstrap`);
        check('토큰 없이는 API 가 막힌다', denied.status === 401, String(denied.status));

        const token = url.includes('#token=') ? url.split('#token=')[1] : null;
        check('주소에 토큰이 fragment 로 붙는다', token !== null && token.length >= 32);
        if (token !== null) {
            const ok = await fetch(`${base}/api/bootstrap`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            const raw = await ok.text();
            check('토큰이 있으면 열린다', ok.status === 200, `${ok.status} ${raw.slice(0, 200)}`);
            const body = ok.status === 200 ? JSON.parse(raw) : { project: {} };
            check('연 프로젝트 이름이 맞다', body.project?.name === 'sample-project', String(body.project?.name));
        }
    } finally {
        child.kill();
    }
} finally {
    await rm(stage, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
