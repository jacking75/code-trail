/*
 * 외부 의존성 고지 검사 — node test/pack/third-party-notices.mjs [--write]
 *
 * 배포물 네 패키지의 `dependencies` 를 재귀로 훑어 `THIRD-PARTY-NOTICES.md` 의 표를
 * 다시 만들고, 지금 파일과 같은지 본다. 의존성을 올리고 고지를 안 고치면 공개 뒤에
 * 조용히 틀어지므로 `npm run test:pack` 이 이것을 부른다.
 *
 * 허용 목록 밖의 라이선스가 끼면 실패한다 — 재배포를 막는 라이선스를 공개 뒤에
 * 알면 늦다.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const NOTICES = path.join(ROOT, 'THIRD-PARTY-NOTICES.md');
const WORKSPACES = ['code-trail', '@code-trail/server', '@code-trail/shared', '@code-trail/web'];
const ALLOWED = new Set([
    'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'BlueOak-1.0.0', '0BSD', 'Python-2.0', 'CC0-1.0',
]);

/** Windows 의 `npm.cmd` 는 셸 없이 못 띄우므로 `node <npm-cli.js>` 로 부른다. */
function npmCli() {
    const fromEnv = process.env['npm_execpath'];
    if (fromEnv !== undefined && fromEnv.endsWith('.js')) {
        return fromEnv;
    }
    return path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

/** `npm ls --omit=dev --all --long --json` 트리에서 이름 → 설치 폴더를 모은다(내부 워크스페이스 제외). */
function collect(node, found) {
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
        if (!WORKSPACES.includes(name) && child.version !== undefined && child.path !== undefined) {
            found.set(`${name}@${child.version}`, { name, dir: child.path });
        }
        collect(child, found);
    }
}

function licenseOf(dir) {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const lic = manifest.license ?? manifest.licenses?.[0]?.type;
    return { version: manifest.version, license: typeof lic === 'string' ? lic : 'UNKNOWN' };
}

const found = new Map();
for (const workspace of WORKSPACES) {
    const raw = execFileSync(process.execPath, [npmCli(), 'ls', '--omit=dev', '--all', '--long', '--json', '-w', workspace], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false,
    });
    collect(JSON.parse(raw), found);
}

const rows = [];
const counts = new Map();
const problems = [];
const entries = [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
const seen = new Set();
for (const { name, dir } of entries) {
    const { version, license } = licenseOf(dir);
    if (seen.has(`${name}@${version}`)) {
        continue;
    }
    seen.add(`${name}@${version}`);
    if (!ALLOWED.has(license)) {
        problems.push(`${name}@${version}: 허용 목록 밖의 라이선스 ${license}`);
    }
    rows.push(`| ${name} | ${version} | ${license} |`);
    counts.set(license, (counts.get(license) ?? 0) + 1);
}

const current = readFileSync(NOTICES, 'utf8');
const head = current.slice(0, current.indexOf('| 패키지 | 버전 | 라이선스 |'));
const summary = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([license, n]) => `${license} ${n}`).join(', ');
const next = `${head}| 패키지 | 버전 | 라이선스 |\n| --- | --- | --- |\n${rows.join('\n')}\n\n`
    + `라이선스 종류별 수: ${summary}.\n전부 배포와 재배포를 허용하는 라이선스다.\n`;

if (process.argv.includes('--write')) {
    writeFileSync(NOTICES, next);
    console.log(`wrote THIRD-PARTY-NOTICES.md (${rows.length}개)`);
} else {
    const same = current.replace(/\r\n/g, '\n') === next;
    for (const p of problems) {
        console.log(`  FAIL ${p}`);
    }
    console.log(`  ${same ? 'ok  ' : 'FAIL'} 외부 의존성 고지가 설치된 버전과 같다${same ? '' : ' — node test/pack/third-party-notices.mjs --write'}`);
    process.exit(same && problems.length === 0 ? 0 : 1);
}
