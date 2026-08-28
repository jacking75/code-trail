/* WebSocket 인증과 명령 — node --test "test/integration/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';

import { makeProject, removeProject, server, withServer } from './helpers.mjs';

const { WS_PROTOCOL } = server;

const FILES = { 'src/a.cpp': 'void a() {}\n' };

/** 소켓 하나를 열고 이벤트를 모은다. */
function openSocket(running, { protocols, origin, expectFail = false } = {}) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`${running.url.replace(/^http/, 'ws')}/ws`, protocols ?? [
            WS_PROTOCOL,
            running.token,
        ], {
            headers: { Origin: origin ?? running.url },
        });

        const events = [];
        let settled = false;

        socket.on('message', (raw) => {
            events.push(JSON.parse(String(raw)));
        });
        socket.on('open', () => {
            if (expectFail) {
                return;
            }
            settled = true;
            resolve({
                socket,
                events,
                send: (message) => socket.send(JSON.stringify(message)),
                /** 조건을 만족하는 이벤트가 올 때까지 기다린다. */
                wait: (predicate, timeoutMs = 3000) =>
                    new Promise((res, rej) => {
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
                close: () =>
                    new Promise((res) => {
                        socket.once('close', res);
                        socket.close();
                    }),
            });
        });
        socket.on('close', (code) => {
            if (!settled) {
                settled = true;
                if (expectFail) {
                    resolve({ closed: true, code });
                } else {
                    reject(new Error(`소켓이 닫혔다: ${code}`));
                }
            }
        });
        socket.on('error', (error) => {
            if (!settled) {
                settled = true;
                if (expectFail) {
                    resolve({ closed: true, code: 0, error });
                } else {
                    reject(error);
                }
            }
        });
    });
}

test('토큰 없는 WebSocket 을 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const result = await openSocket(running, {
                protocols: [WS_PROTOCOL],
                expectFail: true,
            });
            assert.equal(result.closed, true);
        });
    } finally {
        await removeProject(root);
    }
});

test('틀린 토큰의 WebSocket 을 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const result = await openSocket(running, {
                protocols: [WS_PROTOCOL, 'x'.repeat(running.token.length)],
                expectFail: true,
            });
            assert.equal(result.closed, true);
        });
    } finally {
        await removeProject(root);
    }
});

test('잘못된 Origin 의 WebSocket 을 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            for (const origin of [
                'https://evil.example.com',
                'http://127.0.0.1:1',
                'null',
            ]) {
                const result = await openSocket(running, { origin, expectFail: true });
                assert.equal(result.closed, true, origin);
            }
        });
    } finally {
        await removeProject(root);
    }
});

test('붙자마자 트레일 목록을 받는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            const listed = await client.wait((e) => e.type === 'trail.listChanged');
            assert.equal(listed.protocolVersion, 1);
            assert.deepEqual(listed.payload.trails, []);
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('트레일을 만들고 이름을 바꾼다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            await client.wait((e) => e.type === 'trail.listChanged');

            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: { title: '첫 트레일' },
            });
            const snapshot = await client.wait((e) => e.type === 'trail.snapshot');
            assert.equal(snapshot.payload.title, '첫 트레일');
            assert.equal(snapshot.revision, 0);

            const trailId = snapshot.trailId;
            client.send({
                protocolVersion: 1,
                type: 'trail.rename',
                commandId: randomUUID(),
                trailId,
                baseRevision: 0,
                payload: { title: '이름 바꿈' },
            });
            const renamed = await client.wait((e) => e.type === 'trail.renamed');
            assert.equal(renamed.payload.title, '이름 바꿈');
            assert.equal(renamed.revision, 1);

            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('오래된 baseRevision 은 거부하고 최신 snapshot 을 보낸다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: {},
            });
            const created = await client.wait((e) => e.type === 'trail.snapshot');
            const trailId = created.trailId;

            client.send({
                protocolVersion: 1,
                type: 'trail.rename',
                commandId: randomUUID(),
                trailId,
                baseRevision: 0,
                payload: { title: '한 번' },
            });
            await client.wait((e) => e.type === 'trail.renamed');

            // 같은 baseRevision 으로 다시 보낸다 — 이미 1 이 됐으므로 낡았다.
            client.send({
                protocolVersion: 1,
                type: 'trail.rename',
                commandId: randomUUID(),
                trailId,
                baseRevision: 0,
                payload: { title: '두 번' },
            });
            const error = await client.wait((e) => e.type === 'command.error');
            assert.equal(error.payload.error.code, 'STALE_REVISION');
            assert.equal(error.payload.error.retryable, true);

            // 따라잡을 수 있게 최신 상태를 함께 보낸다.
            const recovery = await client.wait(
                (e) => e.type === 'trail.snapshot' && e.revision === 1,
            );
            assert.equal(recovery.payload.title, '한 번');

            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('같은 commandId 재전송은 한 번만 처리한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            const commandId = randomUUID();

            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId,
                baseRevision: 0,
                payload: { title: '한 번만' },
            });
            await client.wait((e) => e.type === 'trail.snapshot');

            // 재연결 뒤 클라이언트가 처리 중이던 명령을 다시 보낸 상황이다.
            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId,
                baseRevision: 0,
                payload: { title: '한 번만' },
            });
            await new Promise((resolve) => setTimeout(resolve, 300));

            const created = client.events.filter((e) => e.type === 'trail.snapshot');
            assert.equal(created.length, 1);

            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('구조 명령에 baseRevision 이 없으면 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                payload: {},
            });
            const error = await client.wait((e) => e.type === 'command.error');
            assert.equal(error.payload.error.code, 'INVALID_COMMAND');
            assert.match(error.payload.error.message, /baseRevision/);
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('여러 탭이 같은 이벤트를 받는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const first = await openSocket(running);
            const second = await openSocket(running);

            first.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: { title: '공유' },
            });

            // 명령을 보내지 않은 탭도 같은 변화를 본다.
            const seen = await second.wait(
                (e) => e.type === 'trail.snapshot' && e.payload.title === '공유',
            );
            assert.equal(seen.payload.title, '공유');

            await first.close();
            await second.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('없는 트레일을 대상으로 한 해석은 이유를 알린다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId: randomUUID(),
                baseRevision: 0,
                payload: { nodeId: randomUUID(), line: 0, char: 0, text: 'x' },
            });
            const error = await client.wait((e) => e.type === 'command.error');
            assert.equal(error.payload.error.code, 'NOT_FOUND');
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('권한 없는 문서 ID 로는 에디터를 열지 못한다', async () => {
    // 브라우저가 만들어낸 ID 로는 아무 파일도 열 수 없다. 실제 경로는 서버가
    // 문서 권한 목록에서만 역조회한다(구현서 17.2 5단계).
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            client.send({
                protocolVersion: 1,
                type: 'editor.openLocation',
                commandId: randomUUID(),
                payload: { documentId: 'doc-1', line: 0, char: 0 },
            });
            const error = await client.wait((e) => e.type === 'command.error');
            assert.equal(error.payload.error.code, 'PATH_DENIED');
            assert.match(error.payload.error.message, /권한이 없는 문서/);
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('경로 모양의 문서 ID 도 그냥 거부한다', async () => {
    // "프로젝트 밖 임의 경로를 열어라" 를 문서 ID 자리에 넣어봐도 통하지 않는다.
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            for (const documentId of ['../../etc/passwd', 'C:\Windows\win.ini', '/etc/hosts']) {
                client.send({
                    protocolVersion: 1,
                    type: 'editor.openLocation',
                    commandId: randomUUID(),
                    payload: { documentId, line: 0, char: 0 },
                });
                const error = await client.wait((e) => e.type === 'command.error');
                assert.equal(error.payload.error.code, 'PATH_DENIED');
            }
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('오류에 코드 본문이나 절대경로가 섞이지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await openSocket(running);
            const secret = 'void 비밀함수() { /* 코드 본문 */ }';
            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId: randomUUID(),
                baseRevision: 0,
                payload: { nodeId: secret, line: 0, char: 0, text: secret },
            });
            const error = await client.wait((e) => e.type === 'command.error');
            const dumped = JSON.stringify(error);
            assert.equal(dumped.includes(secret), false);
            assert.equal(dumped.includes(root), false);
            assert.equal(dumped.includes('stack'), false);
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});
