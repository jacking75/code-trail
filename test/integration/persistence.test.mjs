/* 프로젝트 저장소 — node --test "test/integration/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';

import { authFetch, makeProject, removeProject, server, waitForFile, withServer } from './helpers.mjs';

const { WS_PROTOCOL } = server;
const FILES = { 'src/a.cpp': 'void a() {}\n' };

function storePath(root, ...parts) {
    return path.join(root, '.code-trail', ...parts);
}

/** 트레일 하나를 만들고 그 ID 를 돌려준다. */
async function createTrail(running, title) {
    const socket = new WebSocket(`${running.url.replace(/^http/, 'ws')}/ws`, [
        WS_PROTOCOL,
        running.token,
    ], { headers: { Origin: running.url } });

    const trailId = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('시간이 다 됐다.')), 5000);
        socket.on('open', () => {
            socket.send(JSON.stringify({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: { title },
            }));
        });
        socket.on('message', (raw) => {
            const event = JSON.parse(String(raw));
            if (event.type === 'trail.snapshot') {
                clearTimeout(timer);
                resolve(event.trailId);
            }
        });
        socket.on('error', reject);
    });

    await new Promise((resolve) => {
        socket.once('close', resolve);
        socket.close();
    });
    return trailId;
}

test('처음 열면 .code-trail 구조를 만든다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async () => {
            const settings = JSON.parse(await readFile(storePath(root, 'settings.json'), 'utf8'));
            assert.equal(settings.schemaVersion, 1);
            assert.equal(settings.ui.maxCodeLines, 250);

            const trailsDir = await stat(storePath(root, 'trails'));
            assert.equal(trailsDir.isDirectory(), true);

            const ignore = await readFile(storePath(root, 'runtime', '.gitignore'), 'utf8');
            assert.match(ignore, /^\*$/m);
            const localIgnore = await readFile(storePath(root, 'local', '.gitignore'), 'utf8');
            assert.match(localIgnore, /^\*$/m);
            const local = JSON.parse(await readFile(storePath(root, 'local', 'settings.json'), 'utf8'));
            assert.equal(local.schemaVersion, 1);
        });
    } finally {
        await removeProject(root);
    }
});

test('기존 단일 설정의 기계 값을 백업 후 로컬 설정으로 이전한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async () => {});
        const settingsPath = storePath(root, 'settings.json');
        const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
        settings.editor = { executable: 'code', args: ['--goto', '{path}:{line}'] };
        settings.languages.cpp.executable = 'C:/tools/clangd.exe';
        settings.languages.cpp.env = { PRIVATE_VALUE: 'local-only' };
        await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        await (await import('node:fs/promises')).unlink(storePath(root, 'local', 'settings.json'));

        await withServer(root, async (running) => {
            const boot = await (await authFetch(running, '/api/bootstrap')).json();
            assert.equal(boot.settings.editor.executable, 'code');
            assert.equal(boot.settings.languages.cpp.env.PRIVATE_VALUE, 'local-only');
        });

        const sharedSettings = JSON.parse(await readFile(settingsPath, 'utf8'));
        const localSettings = JSON.parse(await readFile(storePath(root, 'local', 'settings.json'), 'utf8'));
        assert.equal(sharedSettings.editor.executable, null);
        assert.deepEqual(sharedSettings.languages.cpp.env, {});
        assert.equal(localSettings.editor.executable, 'code');
        assert.equal(localSettings.languages.cpp.env.PRIVATE_VALUE, 'local-only');
        assert.equal((await stat(`${settingsPath}.pre-local-settings.bak`)).isFile(), true);
    } finally {
        await removeProject(root);
    }
});

test('프로젝트 루트의 .gitignore 를 건드리지 않는다', async () => {
    const original = '# 내 규칙\nbuild/\n';
    const root = await makeProject({ ...FILES, '.gitignore': original });
    try {
        await withServer(root, async () => {});
        assert.equal(await readFile(path.join(root, '.gitignore'), 'utf8'), original);
    } finally {
        await removeProject(root);
    }
});

test('.gitignore 가 없으면 만들지도 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async () => {});
        const names = await readdir(root);
        assert.equal(names.includes('.gitignore'), false);
    } finally {
        await removeProject(root);
    }
});

test('잠금 파일에는 토큰이 없고 종료하면 사라진다', async () => {
    const root = await makeProject(FILES);
    try {
        let token = '';
        await withServer(root, async (running) => {
            token = running.token;
            const raw = await readFile(storePath(root, 'runtime', 'server.json'), 'utf8');
            const lock = JSON.parse(raw);
            assert.equal(lock.pid, process.pid);
            assert.equal(lock.port, running.port);
            assert.equal(raw.includes(token), false);
            assert.equal('token' in lock, false);
        });
        // 종료 절차가 지운다.
        const gone = await stat(storePath(root, 'runtime', 'server.json')).catch(() => null);
        assert.equal(gone, null);
    } finally {
        await removeProject(root);
    }
});

test('설정과 빈 트레일이 서버를 다시 띄워도 남는다', async () => {
    const root = await makeProject(FILES);
    try {
        let trailId = '';
        await withServer(root, async (running) => {
            trailId = await createTrail(running, '되살아날 트레일');
            await waitForFile(storePath(root, 'trails', `${trailId}.json`));
        });

        // 설정을 손으로 바꾼 뒤 다시 띄운다.
        const settingsPath = storePath(root, 'settings.json');
        const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
        settings.ui.maxCodeLines = 77;
        settings.ui.theme = 'dark';
        await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

        await withServer(root, async (running) => {
            const boot = await (await authFetch(running, '/api/bootstrap')).json();
            assert.equal(boot.settings.ui.maxCodeLines, 77);
            assert.equal(boot.settings.ui.theme, 'dark');

            assert.equal(boot.trails.length, 1);
            assert.equal(boot.trails[0].id, trailId);
            assert.equal(boot.trails[0].title, '되살아날 트레일');
            assert.equal(boot.trails[0].nodeCount, 0);
            assert.equal(boot.activeTrailId, trailId);
        });
    } finally {
        await removeProject(root);
    }
});

test('망가진 settings.json 은 덮어쓰지 않고 기본값으로 돈다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async () => {});
        const broken = '{ 이건 JSON 이 아니다 ';
        await writeFile(storePath(root, 'settings.json'), broken, 'utf8');

        await withServer(root, async (running) => {
            const boot = await (await authFetch(running, '/api/bootstrap')).json();
            assert.equal(boot.settings.ui.maxCodeLines, 250);
        });

        // 사용자가 고칠 수 있게 파일은 그대로 둔다.
        assert.equal(await readFile(storePath(root, 'settings.json'), 'utf8'), broken);
    } finally {
        await removeProject(root);
    }
});

test('트레일 파일이 결정적이라 다시 저장해도 바이트가 같다', async () => {
    const root = await makeProject(FILES);
    try {
        let first = '';
        let trailId = '';
        await withServer(root, async (running) => {
            trailId = await createTrail(running, '같은 바이트');
            await waitForFile(storePath(root, 'trails', `${trailId}.json`));
            first = await readFile(storePath(root, 'trails', `${trailId}.json`), 'utf8');
        });

        // 다시 띄우면 읽고, 종료할 때 다시 쓴다.
        await withServer(root, async () => {});
        const second = await readFile(storePath(root, 'trails', `${trailId}.json`), 'utf8');
        assert.equal(second, first);
    } finally {
        await removeProject(root);
    }
});

test('저장 중 죽어 남은 .tmp 를 복구 후보로 알린다', async () => {
    const root = await makeProject(FILES);
    try {
        let trailId = '';
        await withServer(root, async (running) => {
            trailId = await createTrail(running, '복구 대상');
            await waitForFile(storePath(root, 'trails', `${trailId}.json`));
        });

        // 저장 도중 프로세스가 죽은 상황을 만든다.
        const target = storePath(root, 'trails', `${trailId}.json`);
        const temp = `${target}.tmp`;
        await writeFile(temp, await readFile(target, 'utf8'), 'utf8');
        const future = new Date(Date.now() + 60_000);
        await utimes(temp, future, future);

        await withServer(root, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            assert.equal(diagnostics.recoveryCandidates.length, 1);
            assert.equal(diagnostics.recoveryCandidates[0].trailId, trailId);

            // 최종 파일은 멀쩡하다. 남은 .tmp 가 트레일을 가리지 않는다.
            const boot = await (await authFetch(running, '/api/bootstrap')).json();
            assert.ok(boot.trails.some((t) => t.id === trailId), '트레일이 안 열렸다');
        });

        // 조용히 지우지 않는다. 최신 내용이 들어 있을 수 있다.
        assert.ok(await stat(temp));
    } finally {
        await removeProject(root);
    }
});

test('최종 파일이 더 새로우면 복구 후보가 아니다', async () => {
    const root = await makeProject(FILES);
    try {
        let trailId = '';
        await withServer(root, async (running) => {
            trailId = await createTrail(running, '멀쩡함');
            await waitForFile(storePath(root, 'trails', `${trailId}.json`));
        });

        const target = storePath(root, 'trails', `${trailId}.json`);
        const temp = `${target}.tmp`;
        await writeFile(temp, 'old', 'utf8');
        const past = new Date(Date.now() - 60_000);
        await utimes(temp, past, past);

        await withServer(root, async (running) => {
            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            assert.deepEqual(diagnostics.recoveryCandidates, []);
        });
    } finally {
        await removeProject(root);
    }
});

test('index.json 이 목록을 담고 활성 트레일을 기억한다', async () => {
    const root = await makeProject(FILES);
    try {
        let trailId = '';
        await withServer(root, async (running) => {
            trailId = await createTrail(running, '목록 확인');
            await waitForFile(storePath(root, 'trails', `${trailId}.json`));
        });

        const index = JSON.parse(await readFile(storePath(root, 'index.json'), 'utf8'));
        assert.equal(index.schemaVersion, 1);
        assert.equal(index.activeTrailId, trailId);
        assert.equal(index.trails.length, 1);
        assert.equal(index.trails[0].title, '목록 확인');
        // 요약에는 코드 본문이 없다.
        assert.equal(JSON.stringify(index).includes('void a()'), false);
    } finally {
        await removeProject(root);
    }
});

test('Markdown 내보내기가 다운로드로 나온다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const trailId = await createTrail(running, '내보내기');
            const response = await authFetch(running, `/api/trails/${trailId}/export.md`);
            assert.equal(response.status, 200);
            assert.match(response.headers.get('content-type'), /text\/markdown/);
            assert.match(response.headers.get('content-disposition'), /attachment/);
            assert.match(await response.text(), /^# 내보내기/);
        });
    } finally {
        await removeProject(root);
    }
});

test('트레일 파일 이름은 UUID 뿐이다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const trailId = await createTrail(running, 'UUID 확인');
            // 저장은 debounce 뒤에 일어난다. 파일이 생길 때까지 기다린다.
            await waitForFile(storePath(root, 'trails', `${trailId}.json`));
            const names = await readdir(storePath(root, 'trails'));
            assert.deepEqual(names, [`${trailId}.json`]);
            assert.match(trailId, /^[0-9a-f-]{36}$/);
        });
    } finally {
        await removeProject(root);
    }
});

test('개인 화면 상태는 서버를 다시 띄워도 남고 절대경로를 담지 않는다', async () => {
    // `localStorage` 는 origin 이 포트에 묶여 재시작을 못 견딘다. 저장한 줄
    // 알았던 값이 매번 초기화되면 안 된다(V18).
    const root = await makeProject({ 'src/a.cpp': 'void a() {}\n' });
    const state = {
        schemaVersion: 1,
        layout: 'split',
        sidebar: { width: 340, collapsed: true },
        annotationColumn: { open: true, width: 380 },
        lastPane: 'trail',
        lastDocument: { relPath: 'src/a.cpp', line: 3, char: 2 },
        navigation: [{ pane: 'code', relPath: 'src/a.cpp', line: 3, char: 2 }],
        navigationIndex: 0,
        changeBase: { mode: 'since', from: 'main', to: null, mergeBase: false, label: 'main 이후' },
    };
    try {
        await withServer(root, async (running) => {
            running.context.localUiState.save(state);
            await running.context.localUiState.flush();
        });

        const target = path.join(root, '.code-trail', 'local', 'ui-state.json');
        const raw = await readFile(target, 'utf8');
        assert.equal(raw.includes(root), false, '절대경로를 담지 않는다');
        assert.equal(raw.includes('documentId'), false);

        await withServer(root, async (running) => {
            const bootstrap = await (await authFetch(running, '/api/bootstrap')).json();
            assert.deepEqual(bootstrap.localUiState, state);
        });
    } finally {
        await removeProject(root);
    }
});

test('공유 읽기 모드에서는 개인 화면 상태를 쓰지 않는다', async () => {
    // 임시 디렉터리라 남길 자리가 아니다.
    const root = await makeProject({ 'src/a.cpp': 'void a() {}\n' });
    try {
        await withServer(root, async (running) => {
            running.context.localUiState.save({
                schemaVersion: 1,
                layout: 'tabs',
                sidebar: { width: 280, collapsed: false },
                annotationColumn: { open: false, width: 320 },
                lastPane: 'code',
                lastDocument: null,
                navigation: [],
                navigationIndex: -1,
                changeBase: null,
            });
            await running.context.localUiState.flush();
        }, { readOnlyShare: true });

        const target = path.join(root, '.code-trail', 'local', 'ui-state.json');
        await assert.rejects(() => readFile(target, 'utf8'));
    } finally {
        await removeProject(root);
    }
});
