/* 언어별 어댑터 탐지와 진단 — node --test "test/integration/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { authFetch, makeProject, removeProject, withServer } from './helpers.mjs';

const adapters = await import(
    new URL('../../packages/server/dist/lsp/adapters/index.js', import.meta.url).href
);
const detect = await import(
    new URL('../../packages/server/dist/lsp/adapters/detect.js', import.meta.url).href
);

const FILES = { 'src/a.cpp': 'void a() {}\n' };
const LANGUAGES = ['cpp', 'csharp', 'go', 'rust'];

/**
 * 가짜 언어 서버 실행 파일.
 *
 * Windows 에서는 배치 shim 을 쓸 수 없다 — 우리가 `shell: false` 를 지키기 때문이다.
 * 그래서 어디서나 도는 실행 파일인 `node` 자신을 쓴다. `--version` 을 물으면
 * `vX.Y.Z` 를 뱉으므로 버전 점검 경로를 그대로 시험할 수 있다.
 */
function fakeTool() {
    return process.execPath;
}

/** Windows 에서만 만드는 배치 shim. 셸 없이 못 띄운다는 것을 보이는 데 쓴다. */
async function makeBatchShim(root, name) {
    const dir = path.join(root, 'tools');
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}.cmd`);
    await writeFile(file, '@echo off\r\necho shim\r\n', 'utf8');
    return file;
}

/** 설정을 고치고 서버를 새로 띄운다. */
async function withSettings(root, mutate, run) {
    await withServer(root, async () => {});
    const settingsPath = path.join(root, '.code-trail', 'settings.json');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    mutate(settings);
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await withServer(root, run);
}

const VERSION_LINE = /^v\d+\.\d+\.\d+/;

test('어댑터가 네 언어를 모두 맡고 이름을 갖는다', () => {
    for (const language of LANGUAGES) {
        const adapter = adapters.adapterFor(language);
        assert.equal(adapter.id, language);
        assert.ok(adapter.displayName.length > 0, language);
        assert.ok(adapter.languageIds.length > 0, language);
    }
    // C/C++ 은 어댑터 하나가 둘 다 맡는다.
    assert.deepEqual([...adapters.adapterFor('cpp').languageIds], ['c', 'cpp']);
});

test('설정에 적힌 경로를 가장 먼저 쓴다', async () => {
    const root = await makeProject(FILES);
    try {
        const tool = fakeTool();
        await withSettings(root, (settings) => {
            settings.languages.cpp.executable = tool;
        }, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            assert.equal(cpp.detectionSource, 'settings');
            assert.equal(cpp.executableName, path.basename(tool));
            const version = cpp.healthChecks.find((c) => c.label === 'clangd --version');
            assert.equal(version.level, 'ok');
            // node --version 이 `vX.Y.Z` 를 뱉는다. 버전 점검 경로가 실제로 돌았다.
            assert.match(version.detail, VERSION_LINE);
        });
    } finally {
        await removeProject(root);
    }
});

test('설정 경로가 잘못되면 그 사실을 알린다', async () => {
    const root = await makeProject(FILES);
    try {
        await withSettings(root, (settings) => {
            settings.languages.cpp.executable = path.join(root, 'tools', '없는것');
        }, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            assert.equal(cpp.detectionSource, 'notFound');
            const check = cpp.healthChecks[0];
            assert.equal(check.level, 'error');
            assert.match(check.detail, /설정에 적힌/);
        });
    } finally {
        await removeProject(root);
    }
});

test('실행 파일이 없으면 무엇을 해야 하는지 알려준다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            for (const info of diagnostics.languages) {
                if (info.executableName !== null) {
                    // 이 기계에 실제로 설치된 언어 서버다. 안내가 필요 없다.
                    continue;
                }
                const first = info.healthChecks[0];
                assert.equal(first.level, 'error', info.language);
                // 설치 명령이나 설정 위치 중 하나는 알려줘야 한다.
                assert.match(
                    first.detail,
                    /settings\.json|install|component add/,
                    `${info.language}: ${first.detail}`,
                );
            }
        });
    } finally {
        await removeProject(root);
    }
});

test('진단에 프로젝트 절대경로가 새지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        const tool = fakeTool();
        await withSettings(root, (settings) => {
            settings.languages.go.executable = tool;
        }, async (running) => {
            const raw = await (await authFetch(running, '/api/diagnostics')).text();
            assert.equal(raw.includes(root), false);
            const diagnostics = JSON.parse(raw);
            const go = diagnostics.languages.find((l) => l.language === 'go');
            assert.equal(go.executableName, path.basename(tool));
        });
    } finally {
        await removeProject(root);
    }
});

test('clangd 는 compile_commands.json 을 찾고 없으면 경고한다', async () => {
    const withDb = await makeProject({ ...FILES, 'compile_commands.json': '[]\n' });
    const without = await makeProject(FILES);
    try {
        await withServer(withDb, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            const check = cpp.healthChecks.find((c) => c.label === 'compile_commands.json');
            assert.equal(check.level, 'ok');
            assert.equal(check.detail, 'compile_commands.json');
        });

        await withServer(without, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            const check = cpp.healthChecks.find((c) => c.label === '컴파일 데이터베이스');
            assert.equal(check.level, 'warn');
            assert.match(check.detail, /헤더를 못 찾아/);
        });
    } finally {
        await removeProject(withDb);
        await removeProject(without);
    }
});

test('clangd 는 compile_flags.txt 를 폴백으로 인정한다', async () => {
    const root = await makeProject({ ...FILES, 'compile_flags.txt': '-std=c++20\n' });
    try {
        await withServer(root, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            const check = cpp.healthChecks.find((c) => c.label === 'compile_flags.txt');
            assert.equal(check.level, 'warn');
            assert.match(check.detail, /compile_commands\.json 이 있으면 더 정확/);
        });
    } finally {
        await removeProject(root);
    }
});

test('gopls 는 go.work 를 go.mod 보다 먼저 본다', async () => {
    const both = await makeProject({ ...FILES, 'go.work': 'go 1.22\n', 'go.mod': 'module x\n' });
    const modOnly = await makeProject({ ...FILES, 'go.mod': 'module x\n' });
    const neither = await makeProject(FILES);
    try {
        for (const [root, label, level] of [
            [both, 'go.work', 'ok'],
            [modOnly, 'go.mod', 'ok'],
            [neither, '모듈 표지', 'warn'],
        ]) {
            await withServer(root, async (running) => {
                const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
                const go = diagnostics.languages.find((l) => l.language === 'go');
                const check = go.healthChecks.find((c) => c.label === label);
                assert.ok(check, `${label} 점검이 없다`);
                assert.equal(check.level, level, label);
            });
        }
    } finally {
        await removeProject(both);
        await removeProject(modOnly);
        await removeProject(neither);
    }
});

test('rust-analyzer 는 고른 경로를 그대로 보여준다', async () => {
    // rustup proxy 와 따로 설치한 바이너리를 구분할 수 있어야 한다(구현서 12.4).
    const root = await makeProject({ ...FILES, 'Cargo.toml': '[package]\nname = "x"\n' });
    try {
        const tool = fakeTool();
        await withSettings(root, (settings) => {
            settings.languages.rust.executable = tool;
        }, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const rust = diagnostics.languages.find((l) => l.language === 'rust');
            const chosen = rust.healthChecks.find((c) => c.label === '고른 rust-analyzer');
            assert.ok(chosen, '고른 경로를 안 보여준다');
            assert.match(chosen.detail, /설정에 적힌 경로/);
            assert.equal(chosen.detail.includes(tool), true);

            const cargo = rust.healthChecks.find((c) => c.label === 'Cargo.toml');
            assert.equal(cargo.level, 'ok');
        });
    } finally {
        await removeProject(root);
    }
});

test('C# 솔루션 후보를 찾되 여럿이면 고르지 않는다', async () => {
    const root = await makeProject({
        ...FILES,
        'One.sln': '\n',
        'nested/Two.sln': '\n',
        'nested/Two.csproj': '\n',
    });
    try {
        await withServer(root, async (running) => {
            const solutions = await (
                await authFetch(running, '/api/diagnostics/csharp/solutions')
            ).json();
            assert.equal(solutions.candidates.includes('One.sln'), true);
            assert.equal(solutions.candidates.includes('nested/Two.sln'), true);
            // 둘이라 제안하지 않는다.
            assert.equal(solutions.suggested, null);
            assert.equal(solutions.selected, null);
            // 절대경로가 새지 않는다.
            assert.equal(JSON.stringify(solutions).includes(root), false);

            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const csharp = diagnostics.languages.find((l) => l.language === 'csharp');
            const check = csharp.healthChecks.find((c) => c.label === '솔루션 후보');
            assert.equal(check.level, 'warn');
            assert.match(check.detail, /solutionPath/);
        });
    } finally {
        await removeProject(root);
    }
});

test('C# 솔루션 후보가 하나면 제안한다', async () => {
    const root = await makeProject({ ...FILES, 'Only.sln': '\n' });
    try {
        await withServer(root, async (running) => {
            const solutions = await (
                await authFetch(running, '/api/diagnostics/csharp/solutions')
            ).json();
            assert.equal(solutions.suggested, 'Only.sln');
        });
    } finally {
        await removeProject(root);
    }
});

test('고른 C# 솔루션은 상대경로로 저장되고 initializationOptions 로 간다', async () => {
    const root = await makeProject({ ...FILES, 'One.sln': '\n' });
    try {
        await withSettings(root, (settings) => {
            settings.languages.csharp.solutionPath = 'One.sln';
        }, async (running) => {
            const solutions = await (
                await authFetch(running, '/api/diagnostics/csharp/solutions')
            ).json();
            assert.equal(solutions.selected, 'One.sln');

            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const csharp = diagnostics.languages.find((l) => l.language === 'csharp');
            const check = csharp.healthChecks.find((c) => c.label === '선택한 솔루션');
            assert.equal(check.level, 'ok');
            assert.equal(check.detail, 'One.sln');
        });

        // 어댑터가 그 값을 initializationOptions 로 넘긴다.
        const settings = JSON.parse(
            await readFile(path.join(root, '.code-trail', 'settings.json'), 'utf8'),
        );
        const options = adapters.adapterFor('csharp').initializationOptions({
            projectRoot: root,
            settings,
        });
        assert.deepEqual(options, { solution: 'One.sln' });
    } finally {
        await removeProject(root);
    }
});

test('절대경로 솔루션은 받지 않는다', () => {
    assert.equal(adapters.isProjectRelative('src/App.sln'), true);
    assert.equal(adapters.isProjectRelative('App.sln'), true);
    assert.equal(adapters.isProjectRelative('/etc/App.sln'), false);
    assert.equal(adapters.isProjectRelative('C:/App.sln'), false);
    assert.equal(adapters.isProjectRelative('../App.sln'), false);
    assert.equal(adapters.isProjectRelative('a/../../App.sln'), false);
    assert.equal(adapters.isProjectRelative(''), false);
});

test('꺼진 언어는 탐지도 점검도 하지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withSettings(root, (settings) => {
            settings.languages.rust.enabled = false;
        }, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const rust = diagnostics.languages.find((l) => l.language === 'rust');
            assert.equal(rust.enabled, false);
            assert.deepEqual(rust.healthChecks, []);
        });
    } finally {
        await removeProject(root);
    }
});

test('버전 확인은 셸을 거치지 않고 제한 시간 안에 끝난다', async () => {
    // 없는 명령을 불러도 던지지 않고 실패로 돌아온다.
    const missing = await detect.runCommand('code-trail-없는명령', ['--version'], {
        timeoutMs: 1500,
    });
    assert.equal(missing.ok, false);

    // 셸을 거쳤다면 `&&` 뒤의 진짜 실행 파일이 돌아 성공했을 것이다.
    const sneaky = await detect.runCommand(`code-trail-없는명령 && ${process.execPath}`, [], {
        timeoutMs: 1500,
    });
    assert.equal(sneaky.ok, false);

    // 진짜 실행 파일은 제대로 돈다 — 위 둘이 "아무것도 못 돌려서" 실패한 게 아니다.
    const real = await detect.runCommand(process.execPath, ['--version'], { timeoutMs: 5000 });
    assert.equal(real.ok, true);
    assert.match(real.output, VERSION_LINE);

    // 끝나지 않는 명령은 제한 시간에 끊는다.
    const started = Date.now();
    const hung = await detect.runCommand(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)'],
        { timeoutMs: 700 },
    );
    assert.equal(hung.ok, false);
    assert.equal(Date.now() - started < 5000, true, String(Date.now() - started));
});

test('Windows 배치 shim 은 쓰지 않고 이유를 알린다', async (t) => {
    if (process.platform !== 'win32') {
        t.skip('Windows 에서만 해당한다.');
        return;
    }
    const root = await makeProject(FILES);
    try {
        const shim = await makeBatchShim(root, 'clangd');
        await withSettings(root, (settings) => {
            settings.languages.cpp.executable = shim;
        }, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            assert.equal(cpp.detectionSource, 'notFound');
            // 무엇이 문제인지 말한다. "찾지 못했다" 한 줄로 뭉개지 않는다.
            assert.match(cpp.healthChecks[0].detail, /배치 파일/);
        });
    } finally {
        await removeProject(root);
    }
});

test('bootstrap 은 실행 파일을 찾은 언어만 알린다', async () => {
    const root = await makeProject(FILES);
    try {
        const tool = fakeTool();
        await withSettings(root, (settings) => {
            settings.languages.cpp.executable = tool;
            settings.languages.go.enabled = false;
        }, async (running) => {
            const boot = await (await authFetch(running, '/api/bootstrap')).json();
            assert.equal(boot.capabilities.languages.includes('cpp'), true);
            assert.equal(boot.capabilities.languages.includes('go'), false);
        });
    } finally {
        await removeProject(root);
    }
});
