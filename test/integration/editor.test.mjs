/* 외부 에디터 열기 — node --test "test/integration/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WebSocket } from 'ws';

import { authFetch, makeProject, removeProject, server, updateLocalSettings, waitForFile, withServer } from './helpers.mjs';

const { WS_PROTOCOL } = server;

/**
 * 실행된 argv 를 그대로 파일에 적는 가짜 에디터.
 *
 * 셸을 거쳤는지 아닌지가 여기서 드러난다. `shell: false` 면 인자가 우리가 준
 * 배열 그대로 오고, 셸을 거쳤다면 `;` 나 `&&` 에서 잘리거나 다른 명령이 돈다.
 */
const RECORDER = `import { writeFileSync } from 'node:fs';
const out = process.argv[2];
writeFileSync(out, JSON.stringify(process.argv.slice(3)), 'utf8');
`;

/** 파일 이름에 셸 특수문자를 넣는다. 셸을 거치면 여기서 사고가 난다. */
const NASTY = 'src/a; touch pwned && echo x.cpp';

const FILES = {
    'src/a.cpp': 'void a() {}\n',
    'recorder.mjs': RECORDER,
};

function openSocket(running) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`${running.url.replace(/^http/, 'ws')}/ws`, [
            WS_PROTOCOL,
            running.token,
        ], { headers: { Origin: running.url } });
        const events = [];
        socket.on('message', (raw) => events.push(JSON.parse(String(raw))));
        socket.on('error', reject);
        socket.on('open', () => resolve({
            send: (message) => socket.send(JSON.stringify(message)),
            wait: (predicate, timeoutMs = 5000) => new Promise((res, rej) => {
                const found = events.find(predicate);
                if (found) {
                    res(found);
                    return;
                }
                const timer = setTimeout(() => {
                    socket.off('message', onMessage);
                    rej(new Error('이벤트를 기다리다 시간이 다 됐다.'));
                }, timeoutMs);
                const onMessage = (raw) => {
                    const event = JSON.parse(String(raw));
                    if (predicate(event)) {
                        clearTimeout(timer);
                        socket.off('message', onMessage);
                        res(event);
                    }
                };
                socket.on('message', onMessage);
            }),
            close: () => new Promise((res) => {
                socket.on('close', res);
                socket.close();
            }),
        }));
    });
}

/** 첫 기동으로 설정 파일을 만들고, 에디터 설정을 적은 뒤 다시 띄운다. */
async function withEditor(root, editorSettings, run) {
    await withServer(root, async () => undefined);
    await updateLocalSettings(root, (settings) => { settings.editor = editorSettings; });
    return withServer(root, run);
}

/** 문서 권한을 얻는다. 이 ID 로만 에디터를 열 수 있다. */
async function grant(running, relPath) {
    const response = await authFetch(
        running,
        `/api/workspace/open?relPath=${encodeURIComponent(relPath)}`,
    );
    assert.equal(response.status, 200, `${relPath} 를 열지 못했다`);
    return (await response.json()).documentId;
}

test('에디터 설정이 없으면 실행하지 않고 경로와 줄을 돌려준다', async () => {
    // 실행 실패가 막다른 길이 되면 안 된다. 화면이 복사할 수 있게 준다.
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const documentId = await grant(running, 'src/a.cpp');
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'editor.openLocation',
                commandId: randomUUID(),
                payload: { documentId, line: 4, char: 2 },
            });
            const opened = await client.wait((e) => e.type === 'editor.opened');
            assert.equal(opened.payload.launched, false);
            assert.match(opened.payload.reason, /설정되지 않았다/);
            // 외부 에디터 관례대로 1-based 다.
            assert.equal(opened.payload.line, 5);
            assert.equal(opened.payload.column, 3);
            assert.equal(opened.payload.displayPath, 'src/a.cpp');
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('설정한 에디터를 shell 없이 argv 배열 그대로 실행한다', async () => {
    const root = await makeProject(FILES);
    const outPath = path.join(root, 'argv.json');
    try {
        await withEditor(root, {
            executable: process.execPath,
            args: [
                path.join(root, 'recorder.mjs'),
                outPath,
                '--goto',
                '{path}:{line}:{column}',
                '{project}',
            ],
        }, async (running) => {
            const documentId = await grant(running, 'src/a.cpp');
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'editor.openLocation',
                commandId: randomUUID(),
                payload: { documentId, line: 0, char: 0 },
            });
            const opened = await client.wait((e) => e.type === 'editor.opened');
            assert.equal(opened.payload.launched, true);
            assert.equal(opened.payload.reason, null);

            await waitForFile(outPath, 20000);
            const argv = JSON.parse(await readFile(outPath, 'utf8'));
            assert.equal(argv.length, 3, JSON.stringify(argv));
            assert.equal(argv[0], '--goto');
            assert.equal(argv[1], `${path.join(root, 'src', 'a.cpp')}:1:1`);
            assert.equal(argv[2], root);
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('파일 이름에 셸 특수문자가 있어도 인자 하나로만 간다', async () => {
    // 셸을 거쳤다면 `;` 에서 잘려 `touch pwned` 가 돌았을 것이다.
    const root = await makeProject({ ...FILES, [NASTY]: 'void nasty() {}\n' });
    const outPath = path.join(root, 'argv.json');
    try {
        await withEditor(root, {
            executable: process.execPath,
            args: [path.join(root, 'recorder.mjs'), outPath, '{path}'],
        }, async (running) => {
            const documentId = await grant(running, NASTY);
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'editor.openLocation',
                commandId: randomUUID(),
                payload: { documentId, line: 0, char: 0 },
            });
            const opened = await client.wait((e) => e.type === 'editor.opened');
            assert.equal(opened.payload.launched, true);

            await waitForFile(outPath, 20000);
            const argv = JSON.parse(await readFile(outPath, 'utf8'));
            assert.equal(argv.length, 1, JSON.stringify(argv));
            assert.equal(argv[0], path.join(root, ...NASTY.split('/')));

            // 셸이 돌았다면 여기에 파일이 생겼을 것이다.
            const pwned = await readFile(path.join(root, 'pwned'), 'utf8').catch(() => null);
            assert.equal(pwned, null, 'shell 을 거쳐 다른 명령이 돌았다');
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('모르는 자리표시자가 있으면 실행하지 않는다', async () => {
    const root = await makeProject(FILES);
    const outPath = path.join(root, 'argv.json');
    try {
        await withEditor(root, {
            executable: process.execPath,
            args: [path.join(root, 'recorder.mjs'), outPath, '{path}', '{home}'],
        }, async (running) => {
            const documentId = await grant(running, 'src/a.cpp');
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'editor.openLocation',
                commandId: randomUUID(),
                payload: { documentId, line: 0, char: 0 },
            });
            const opened = await client.wait((e) => e.type === 'editor.opened');
            assert.equal(opened.payload.launched, false);
            assert.match(opened.payload.reason, /\{home\}/);
            const wrote = await readFile(outPath, 'utf8').catch(() => null);
            assert.equal(wrote, null, '실행하지 말았어야 한다');
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('찾을 수 없는 실행 파일이면 이유를 알린다', async () => {
    const root = await makeProject(FILES);
    try {
        await withEditor(root, {
            executable: path.join(root, 'no-such-editor'),
            args: ['{path}'],
        }, async (running) => {
            const documentId = await grant(running, 'src/a.cpp');
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'editor.openLocation',
                commandId: randomUUID(),
                payload: { documentId, line: 0, char: 0 },
            });
            const opened = await client.wait((e) => e.type === 'editor.opened');
            assert.equal(opened.payload.launched, false);
            assert.match(opened.payload.reason, /찾지 못했다/);
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('에디터 후보에 절대경로가 섞이지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const response = await authFetch(running, '/api/diagnostics/editor');
            assert.equal(response.status, 200);
            const body = await response.json();
            assert.ok(Array.isArray(body.candidates));
            for (const candidate of body.candidates) {
                assert.ok(
                    !candidate.name.includes('/') && !candidate.name.includes('\\'),
                    `실행 파일 이름에 경로가 섞였다: ${candidate.name}`,
                );
            }
        });
    } finally {
        await removeProject(root);
    }
});

test('진단에 PID·capability·확인 여부가 들어 있다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const response = await authFetch(running, '/api/diagnostics');
            const body = await response.json();
            assert.equal(body.languages.length, 5);
            for (const info of body.languages) {
                assert.ok('pid' in info, 'pid 가 없다');
                assert.ok('initializeMs' in info, 'initializeMs 가 없다');
                assert.ok('lastRequest' in info, 'lastRequest 가 없다');
                assert.ok('lastExit' in info, 'lastExit 가 없다');
                assert.deepEqual(Object.keys(info.capabilities).sort(), [
                    'definition', 'documentSymbol', 'implementation', 'typeDefinition',
                ]);
                // 아직 아무 요청도 안 했다. `지원됨` 이 되면 안 된다.
                assert.equal(info.verified, false);
                assert.deepEqual(info.verifiedMethods, []);
            }
        });
    } finally {
        await removeProject(root);
    }
});
