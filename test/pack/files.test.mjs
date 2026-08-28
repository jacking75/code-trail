/*
 * 배포물에 들어갈 파일 목록 검사 — node test/pack/files.test.mjs
 *
 * `npm pack --dry-run` 이 실제로 담을 파일을 그대로 받아 본다.
 * 여기서 보려는 것은 둘이다.
 *
 * 1. **있어야 할 것이 있는가** — CLI 진입점, 서버·shared 의 dist, 웹 정적 자산.
 *    하나라도 빠지면 설치한 사람은 빈 화면이나 "모듈을 찾을 수 없다" 를 본다.
 * 2. **없어야 할 것이 없는가** — 소스맵, fixture, 테스트, 로그, 토큰, 그리고
 *    **언어 서버 바이너리**. 우리가 남의 기계에 실행 파일을 실어 나르지 않는다.
 *
 * `npm pack` 은 느리므로 단위 테스트 묶음에 넣지 않고 따로 돌린다.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * npm 을 셸 없이 부르는 방법.
 *
 * Windows 의 `npm.cmd` 는 배치 파일이라 `shell: false` 로 못 띄운다(Node 의
 * CVE-2024-27980 대응). 그래서 `node <npm-cli.js>` 로 부른다.
 * `npm run` 으로 들어오면 npm 이 자기 진입점을 `npm_execpath` 에 넣어 준다.
 */
function npmCli() {
    const fromEnv = process.env['npm_execpath'];
    if (fromEnv !== undefined && fromEnv.endsWith('.js')) {
        return fromEnv;
    }
    const nodeDir = path.dirname(process.execPath);
    return path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

let failures = 0;
const check = (name, condition, extra) => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${!condition && extra ? ` — ${extra}` : ''}`);
    if (!condition) {
        failures++;
    }
};

/** `npm pack --dry-run --json` 이 담겠다고 한 파일 목록. */
function packedFiles(workspace) {
    const raw = execFileSync(process.execPath, [
        npmCli(), 'pack', '--dry-run', '--json', '-w', workspace,
    ], {
        cwd: ROOT,
        encoding: 'utf8',
        // npm 이 진행 상황을 stderr 로 뱉는다. 결과는 stdout 이다.
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false,
    });
    const parsed = JSON.parse(raw);
    const entry = Array.isArray(parsed) ? parsed[0] : parsed;
    return {
        name: entry.name,
        version: entry.version,
        files: entry.files.map((f) => f.path.split('\\').join('/')),
        bytes: entry.unpackedSize,
    };
}

/** 배포물에 절대 들어가면 안 되는 것. */
const FORBIDDEN = [
    { label: '소스맵', test: (f) => f.endsWith('.map') },
    { label: 'TypeScript 원본', test: (f) => f.endsWith('.ts') && !f.endsWith('.d.ts') },
    { label: '테스트', test: (f) => f.startsWith('test/') || f.includes('/test/') },
    { label: 'fixture', test: (f) => f.includes('fixtures/') },
    { label: '로그', test: (f) => f.endsWith('.log') },
    { label: '환경 파일', test: (f) => f === '.env' || f.startsWith('.env.') },
    { label: '잠금·런타임 부산물', test: (f) => f.includes('.code-trail/') },
    { label: '언어 서버 바이너리', test: (f) => /(^|\/)(clangd|gopls|rust-analyzer|roslyn-language-server)(\.exe)?$/.test(f) },
    { label: 'node_modules', test: (f) => f.includes('node_modules/') },
];

const PACKAGES = [
    {
        workspace: 'code-trail',
        expectedName: 'code-trail',
        required: ['package.json', 'dist/main.js', 'dist/args.js', 'dist/reuse.js', 'dist/openBrowser.js'],
    },
    {
        workspace: '@code-trail/server',
        expectedName: '@code-trail/server',
        required: ['package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/bootstrap.js'],
    },
    {
        workspace: '@code-trail/shared',
        expectedName: '@code-trail/shared',
        required: ['package.json', 'dist/index.js', 'dist/index.d.ts'],
    },
    {
        workspace: '@code-trail/web',
        expectedName: '@code-trail/web',
        required: ['package.json', 'dist/index.html'],
    },
];

console.log('\n[배포물 파일 목록]');

for (const target of PACKAGES) {
    const packed = packedFiles(target.workspace);
    console.log(`\n  ${packed.name}@${packed.version} — ${packed.files.length}개 파일, ${Math.round(packed.bytes / 1024)}KB`);

    check(`${packed.name} 이름이 맞다`, packed.name === target.expectedName, packed.name);
    check(`${packed.name} 버전이 1.0.0 이다`, packed.version === '1.0.0', packed.version);

    for (const required of target.required) {
        check(
            `${packed.name} 에 ${required} 가 있다`,
            packed.files.includes(required),
            packed.files.slice(0, 8).join(', '),
        );
    }

    for (const rule of FORBIDDEN) {
        const hit = packed.files.filter(rule.test);
        check(`${packed.name} 에 ${rule.label} 이 없다`, hit.length === 0, hit.slice(0, 5).join(', '));
    }
}

// 웹 정적 자산은 서버가 찾아 쓴다. 번들이 통째로 들어가야 한다.
{
    const web = packedFiles('@code-trail/web');
    const assets = web.files.filter((f) => f.startsWith('dist/assets/'));
    check('웹 번들 자산이 들어 있다', assets.length >= 2, String(assets.length));
    check('웹 자산에 .js 가 있다', assets.some((f) => f.endsWith('.js')));
    check('웹 자산에 .css 가 있다', assets.some((f) => f.endsWith('.css')));
}

// CLI 는 `bin` 으로 노출된다. 진입점에 shebang 이 있어야 유닉스에서 바로 돈다.
{
    const { readFileSync } = await import('node:fs');
    const entry = readFileSync(path.join(ROOT, 'packages', 'cli', 'dist', 'main.js'), 'utf8');
    check('CLI 진입점에 shebang 이 있다', entry.startsWith('#!/usr/bin/env node'));
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
