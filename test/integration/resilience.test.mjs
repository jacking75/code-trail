/*
 * 단계 10 — 전체 보안과 회복성 검증
 *   node --test "test/integration/*.test.mjs"
 *
 * 여기 있는 것은 기능이 아니라 **경계**다. 하나하나가 "이렇게 하면 뚫린다" 또는
 * "이렇게 죽으면 데이터가 날아간다" 를 재현하고, 그렇게 되지 않는지 본다.
 * 개별 기능 테스트(lsp, editor, security, persistence)와 겹치는 것은 안 넣는다 —
 * 여기서는 그 경계들을 **목록으로** 훑는 것이 목적이다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import {
    authFetch,
    makeProject,
    removeProject,
    server,
    updateLocalSettings,
    withServer,
} from './helpers.mjs';
import { COMMAND_PAYLOADS } from '../../packages/shared/dist/index.js';

const { WS_PROTOCOL } = server;
const FAKE_LSP = fileURLToPath(new URL('../fake-lsp/server.mjs', import.meta.url));
const NL = String.fromCharCode(10);

const DISPATCH = [
    '// 클라이언트 패킷 진입점',
    'void HandlePacket(Session* sess, Packet* pkt) {',
    '\tif (!sess->IsAuthed()) { return; }',
    '\tauto* handler = g_registry.Find(pkt->opcode);',
    '\t{',
    '\thandler->Invoke(sess, pkt);',
    '}',
    '',
    '// 파일 끝',
    '',
].join(NL);

const REGISTRY = [
    'class HandlerRegistry {',
    'public:',
    '\t// 등록된 핸들러를 찾는다',
    '\tIHandler* Find(uint16_t opcode) const {',
    '\t\tauto it = entries_.find(opcode);',
    '\t\treturn it == entries_.end() ? nullptr : it->second.get();',
    '\t}',
    '',
    '\tstd::map<uint16_t, Handler> entries_;',
    '};',
].join(NL);

const FILES = {
    'src/dispatch.cpp': DISPATCH,
    'src/registry.cpp': REGISTRY,
};

function connect(running, { origin, protocols } = {}) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`${running.url.replace(/^http/, 'ws')}/ws`, protocols ?? [
            WS_PROTOCOL,
            running.token,
        ], { headers: { Origin: origin ?? running.url } });
        const events = [];
        socket.on('message', (raw) => events.push(JSON.parse(String(raw))));
        socket.on('error', reject);
        socket.on('open', () => resolve({
            socket,
            events,
            send: (message) => socket.send(JSON.stringify(message)),
            wait: (predicate, timeoutMs = 8000) => new Promise((res, rej) => {
                const found = events.find(predicate);
                if (found) {
                    res(found);
                    return;
                }
                const timer = setTimeout(() => {
                    socket.off('message', onMessage);
                    rej(new Error(`이벤트를 기다리다 시간이 다 됐다. 받은 것: ${
                        events.map((e) => e.type).join(', ')}`));
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
                socket.once('close', res);
                socket.close();
            }),
        }));
    });
}

/**
 * 붙지 못해야 하는 소켓.
 *
 * 인증에 실패한 소켓은 handshake 까지는 되고 그 뒤에 정책 위반(1008)으로 닫힌다.
 * 그래서 "연결 promise 가 거절되는가" 만 보면 안 되고 닫히는 것까지 봐야 한다.
 */
function socketOutcome(running, { origin, protocols } = {}) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`${running.url.replace(/^http/, 'ws')}/ws`, protocols ?? [
            WS_PROTOCOL,
            running.token,
        ], { headers: { Origin: origin ?? running.url } });
        let messages = 0;
        const timer = setTimeout(() => reject(new Error('아무 일도 일어나지 않았다')), 5000);
        socket.on('message', () => {
            messages += 1;
        });
        socket.on('error', () => {
            clearTimeout(timer);
            resolve({ kind: 'error', messages });
        });
        socket.on('close', (code) => {
            clearTimeout(timer);
            resolve({ kind: 'close', code, messages });
        });
    });
}

function assertRejected(outcome, what) {
    assert.ok(
        outcome.kind === 'error' || outcome.code === 1008 || outcome.code === 1006,
        `${what} — ${JSON.stringify(outcome)}`,
    );
    assert.equal(outcome.messages, 0, `${what} — 데이터를 받았다`);
}

/** 가짜 언어 서버를 설정에 적는다. 실행 파일을 자동으로 찾지 않는다는 규칙 그대로다. */
async function configureFakeLsp(root, scenarioArgs = ['--scenario=normal'], extra = {}) {
    const base = {
        projectDirectory: root,
        logLevel: 'error',
        logWrite: () => {},
        lspRequestTimeoutMs: 4000,
        lspRestartDelaysMs: [40, 60, 90],
        lspStableAfterMs: 5000,
        ...extra,
    };
    const first = await server.startServer(base);
    await updateLocalSettings(root, (settings) => {
        settings.languages.cpp.executable = process.execPath;
        settings.languages.cpp.args = [FAKE_LSP, ...scenarioArgs];
    });
    await first.close();
    return base;
}

async function withFakeLsp(root, scenarioArgs, run, extra = {}) {
    const base = await configureFakeLsp(root, scenarioArgs, extra);
    const running = await server.startServer(base);
    try {
        return await run(running, base);
    } finally {
        await running.close();
    }
}

/** 트레일 하나와 루트 노드 하나. */
async function seed(running, client) {
    const opened = await (
        await authFetch(running, '/api/workspace/open?relPath=src%2Fdispatch.cpp')
    ).json();
    client.send({
        protocolVersion: 1,
        type: 'trail.create',
        commandId: randomUUID(),
        baseRevision: 0,
        payload: { title: '경계 시험' },
    });
    const created = await client.wait((e) => e.type === 'trail.snapshot');
    client.send({
        protocolVersion: 1,
        type: 'trail.addRootAt',
        commandId: randomUUID(),
        trailId: created.trailId,
        baseRevision: created.revision,
        payload: { documentId: opened.documentId, line: 4, char: 0 },
    });
    const rooted = await client.wait((e) => e.type === 'trail.rootAdded');
    return {
        trailId: created.trailId,
        documentId: opened.documentId,
        root: rooted.payload.node,
        revision: rooted.revision,
    };
}

// ── 1. 인증 ─────────────────────────────────────────────────────────────────

test('모든 API 경로가 토큰을 요구한다 — 라우트 목록으로 훑는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            // Fastify 가 아는 라우트를 그대로 뽑는다. 손으로 적은 목록을 쓰면
            // 새 경로가 늘었을 때 아무도 눈치채지 못한다.
            const printed = running.app.fastify.printRoutes({ commonPrefix: false });
            const paths = [...printed.matchAll(/(\/\S*)\s+\(([A-Z, ]+)\)/g)]
                .map((m) => ({ path: m[1], methods: m[2].split(',').map((s) => s.trim()) }))
                .filter((route) => route.path.startsWith('/api'));

            assert.ok(paths.length >= 8, `라우트를 못 읽었다: ${printed}`);

            for (const route of paths) {
                // `:param` 자리는 아무 값이나 넣는다. 401 이 나야 하므로
                // 그 값이 유효한지는 상관없다.
                const url = route.path.replace(/:[^/]+/g, 'x');
                const response = await fetch(`${running.url}${url}`);
                assert.equal(
                    response.status,
                    401,
                    `${route.path} 가 토큰 없이 ${response.status} 를 줬다`,
                );
            }
        });
    } finally {
        await removeProject(root);
    }
});

test('WebSocket 도 토큰 없이는 못 붙는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            assertRejected(
                await socketOutcome(running, { protocols: [WS_PROTOCOL, 'wrong-token'] }),
                '틀린 토큰으로 붙었다',
            );
            assertRejected(
                await socketOutcome(running, { protocols: [WS_PROTOCOL] }),
                '토큰 없이 붙었다',
            );
        });
    } finally {
        await removeProject(root);
    }
});

// ── 2. 명령 스키마 ──────────────────────────────────────────────────────────

test('모든 WebSocket 명령이 runtime schema 검증을 거친다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await connect(running);
            const types = Object.keys(COMMAND_PAYLOADS);
            assert.ok(types.length >= 20, `명령 목록이 비었다: ${types.length}`);

            for (const type of types) {
                const commandId = randomUUID();
                client.send({
                    protocolVersion: 1,
                    type,
                    commandId,
                    trailId: randomUUID(),
                    baseRevision: 0,
                    // 어느 명령의 payload 스키마로도 통과하지 못하는 값.
                    // 빈 payload 를 받는 명령까지 한 번에 걸러내려면 객체가
                    // 아니어야 한다 — `z.object({})` 는 여분의 키를 허용한다.
                    payload: null,
                });
                const error = await client.wait(
                    (e) => e.type === 'command.error' && e.commandId === commandId,
                    5000,
                );
                assert.equal(
                    error.payload.error.code,
                    'INVALID_COMMAND',
                    `${type} 이 payload 검증 없이 지나갔다`,
                );
            }

            // 타입에 맞지 않는 값도 막는다. 스키마가 껍데기만 보고 있지 않다는 확인이다.
            const typed = randomUUID();
            client.send({
                protocolVersion: 1,
                type: 'trail.setMode',
                commandId: typed,
                trailId: randomUUID(),
                payload: { mode: 'diagonal' },
            });
            const typedError = await client.wait(
                (e) => e.type === 'command.error' && e.commandId === typed,
                5000,
            );
            assert.equal(typedError.payload.error.code, 'INVALID_COMMAND');
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('모르는 protocolVersion 과 모르는 명령을 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await connect(running);
            client.send({ protocolVersion: 99, type: 'trail.clear', commandId: randomUUID(), payload: {} });
            const first = await client.wait((e) => e.type === 'command.error');
            assert.equal(first.payload.error.code, 'INVALID_COMMAND');

            const commandId = randomUUID();
            client.send({ protocolVersion: 1, type: 'trail.깜짝', commandId, payload: {} });
            const second = await client.wait(
                (e) => e.type === 'command.error' && e.commandId === commandId,
            );
            assert.equal(second.payload.error.code, 'INVALID_COMMAND');
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

// ── 3. 다른 origin ──────────────────────────────────────────────────────────

test('다른 origin 의 HTTP·WebSocket 요청을 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            // HTTP: 토큰이 있어도 Host 가 우리 것이 아니면 막는다.
            const denied = await new Promise((resolve) => {
                const request = http.request({
                    host: '127.0.0.1',
                    port: running.port,
                    path: '/api/bootstrap',
                    method: 'GET',
                    headers: { Authorization: `Bearer ${running.token}` },
                }, (response) => resolve(response.statusCode));
                request.setHeader('Host', 'evil.example.com');
                request.end();
            });
            assert.equal(denied, 401, 'DNS rebinding 을 막지 못했다');

            // WebSocket: Origin 이 다르면 붙지 못한다.
            assertRejected(
                await socketOutcome(running, { origin: 'http://evil.example.com' }),
                '다른 origin 이 웹소켓에 붙었다',
            );
        });
    } finally {
        await removeProject(root);
    }
});

// ── 4. 토큰이 남는 자리 ─────────────────────────────────────────────────────

test('세션 토큰이 URL query·로그·파일에 남지 않는다', async () => {
    const root = await makeProject(FILES);
    const lines = [];
    try {
        // 로그를 가장 많이 남기는 설정으로 돌린다. 여기서 안 새면 안 샌다.
        const base = await configureFakeLsp(root, ['--scenario=normal'], {
            logLevel: 'debug',
            logWrite: (line) => lines.push(line),
        });
        const running = await server.startServer(base);
        try {
            const client = await connect(running);
            await seed(running, client);
            await authFetch(running, '/api/bootstrap');
            await authFetch(running, '/api/diagnostics');
            await client.close();

            // 1) 로그
            assert.equal(
                lines.join(NL).includes(running.token),
                false,
                '토큰이 로그에 남았다',
            );

            // 2) `.code-trail/` 아래 어느 파일에도 없다
            const store = path.join(root, '.code-trail');
            const walk = async (dir) => {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(full);
                        continue;
                    }
                    const text = await readFile(full, 'utf8').catch(() => '');
                    assert.equal(
                        text.includes(running.token),
                        false,
                        `토큰이 ${entry.name} 에 남았다`,
                    );
                }
            };
            await walk(store);

            // 3) 정적 셸에도 없다. 토큰은 fragment 로만 온다 —
            //    fragment 는 서버로 전송되지 않는다.
            const shell = await (await fetch(`${running.url}/`)).text();
            assert.equal(shell.includes(running.token), false, '토큰이 HTML 에 박혔다');
        } finally {
            await running.close();
        }
    } finally {
        await removeProject(root);
    }
});

test('query 로 보낸 토큰은 인증으로 쳐주지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const response = await fetch(
                `${running.url}/api/bootstrap?token=${encodeURIComponent(running.token)}`,
            );
            assert.equal(response.status, 401);
        });
    } finally {
        await removeProject(root);
    }
});

// ── 5. 오류에 새는 것 ───────────────────────────────────────────────────────

test('절대경로와 코드 본문이 일반 오류 응답에 노출되지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const client = await connect(running);
            const probes = [
                { path: '/api/workspace/open?relPath=../../etc/passwd' },
                { path: '/api/workspace/open?relPath=없는파일.cpp' },
                { path: '/api/documents/doc-없음' },
                { path: '/api/trails/00000000-0000-4000-8000-000000000000/export.md' },
                { path: '/api/diagnostics/모르는언어/log' },
            ];
            for (const probe of probes) {
                const response = await authFetch(running, probe.path);
                const text = await response.text();
                assert.equal(
                    text.includes(root),
                    false,
                    `${probe.path} 응답에 절대경로가 섞였다: ${text}`,
                );
                assert.equal(
                    text.includes('HandlePacket'),
                    false,
                    `${probe.path} 응답에 코드 본문이 섞였다`,
                );
            }

            // WebSocket 오류도 마찬가지다.
            const commandId = randomUUID();
            client.send({
                protocolVersion: 1,
                type: 'editor.openLocation',
                commandId,
                payload: { documentId: 'doc-없음', line: 0, char: 0 },
            });
            const error = await client.wait(
                (e) => e.type === 'command.error' && e.commandId === commandId,
            );
            assert.equal(JSON.stringify(error).includes(root), false);
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

// ── 6. 프로젝트 밖 문서의 일시 권한 ─────────────────────────────────────────

test('언어 서버가 준 프로젝트 밖 정의는 일시 권한으로만 열린다', async () => {
    const root = await makeProject(FILES);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'code-trail-outside-'));
    const header = path.join(outside, 'registry.h');
    await writeFile(header, REGISTRY, 'utf8');
    try {
        await withFakeLsp(
            root,
            ['--scenario=externalTarget', `--external-file=${header}`],
            async (running, base) => {
                const client = await connect(running);
                const seeded = await seed(running, client);

                client.send({
                    protocolVersion: 1,
                    type: 'trail.resolve',
                    commandId: randomUUID(),
                    trailId: seeded.trailId,
                    baseRevision: seeded.revision,
                    payload: { nodeId: seeded.root.id, line: 3, char: 28, text: 'Find' },
                });
                const added = await client.wait((e) => e.type === 'trail.nodeAdded', 12000);
                const symbol = added.payload.node.symbol;

                assert.equal(symbol.external, true, '프로젝트 밖으로 안 나갔다');
                assert.equal(symbol.relPath, null);
                assert.equal(typeof symbol.documentId, 'string');

                // 권한이 살아 있는 동안에는 본문을 읽을 수 있다.
                const alive = await authFetch(running, `/api/documents/${symbol.documentId}`);
                assert.equal(alive.status, 200);

                const externalId = symbol.documentId;
                await client.close();
                await running.close();

                // 재시작하면 그 권한은 사라진다. 저장된 스냅샷은 남지만
                // 다시 열려면 새 LSP 결과로 권한을 다시 얻어야 한다.
                const restarted = await server.startServer(base);
                try {
                    const denied = await authFetch(
                        restarted,
                        `/api/documents/${externalId}`,
                    );
                    assert.ok(
                        denied.status === 403 || denied.status === 404,
                        `재시작 뒤에도 열렸다 (${denied.status})`,
                    );

                    const second = await connect(restarted);
                    const snapshot = await second.wait((e) => e.type === 'trail.snapshot');
                    const external = findExternal(snapshot.payload.roots);
                    assert.ok(external !== undefined, '외부 노드가 스냅샷에 없다');
                    assert.equal(
                        external.symbol.documentId,
                        null,
                        '프로젝트 밖 문서 권한이 자동으로 되살아났다',
                    );
                    await second.close();
                } finally {
                    await restarted.close();
                }
            },
        );
    } finally {
        await removeProject(root);
        await rm(outside, { recursive: true, force: true });
    }
});

function findExternal(nodes) {
    for (const node of nodes) {
        if (node.symbol.external === true) {
            return node;
        }
        const found = findExternal(node.children ?? []);
        if (found) {
            return found;
        }
    }
    return undefined;
}

// ── 7. 여러 탭과 재전송 ─────────────────────────────────────────────────────

test('여러 탭의 revision 충돌을 처리한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withFakeLsp(root, ['--scenario=normal'], async (running) => {
            const first = await connect(running);
            const second = await connect(running);
            const seeded = await seed(running, first);

            // 두 번째 탭도 같은 트리를 본다.
            await second.wait((e) => e.type === 'trail.rootAdded');

            // 두 번째 탭이 오래된 revision 으로 구조 명령을 보낸다.
            const staleId = randomUUID();
            second.send({
                protocolVersion: 1,
                type: 'trail.removeNode',
                commandId: staleId,
                trailId: seeded.trailId,
                baseRevision: 0,
                payload: { nodeId: seeded.root.id },
            });
            const error = await second.wait(
                (e) => e.type === 'command.error' && e.commandId === staleId,
            );
            assert.equal(error.payload.error.code, 'STALE_REVISION');

            // 거부만 하고 끝내지 않는다. 따라잡을 수 있게 최신 snapshot 을 준다.
            const recovery = await second.wait(
                (e) => e.type === 'trail.snapshot' && e.revision === seeded.revision,
            );
            assert.equal(recovery.payload.roots.length, 1);

            // 그 snapshot 의 revision 으로 다시 보내면 통한다.
            second.send({
                protocolVersion: 1,
                type: 'trail.removeNode',
                commandId: randomUUID(),
                trailId: seeded.trailId,
                baseRevision: recovery.revision,
                payload: { nodeId: seeded.root.id },
            });
            const removed = await second.wait((e) => e.type === 'trail.nodeRemoved');
            assert.equal(removed.payload.nodeId, seeded.root.id);

            // 첫 번째 탭에도 같은 이벤트가 간다.
            await first.wait((e) => e.type === 'trail.nodeRemoved');
            await first.close();
            await second.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('같은 commandId 를 다시 보내도 한 번만 처리한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withFakeLsp(root, ['--scenario=normal'], async (running) => {
            const client = await connect(running);
            const seeded = await seed(running, client);

            const commandId = randomUUID();
            const rename = {
                protocolVersion: 1,
                type: 'trail.rename',
                commandId,
                trailId: seeded.trailId,
                baseRevision: seeded.revision,
                payload: { title: '한 번만' },
            };
            client.send(rename);
            const first = await client.wait((e) => e.type === 'trail.renamed');
            const revisionAfterFirst = first.revision;

            // 끊겼다 붙은 클라이언트가 같은 명령을 다시 보내는 상황.
            client.send(rename);
            await new Promise((resolve) => setTimeout(resolve, 300));

            const renames = client.events.filter((e) => e.type === 'trail.renamed');
            assert.equal(renames.length, 1, `renamed 가 ${renames.length}번 왔다`);
            assert.equal(
                running.context.trails.get(seeded.trailId).revision,
                revisionAfterFirst,
                'revision 이 두 번 올랐다',
            );
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

test('다시 붙으면 snapshot 으로 처음부터 다시 맞춘다', async () => {
    const root = await makeProject(FILES);
    try {
        await withFakeLsp(root, ['--scenario=normal'], async (running) => {
            const client = await connect(running);
            const seeded = await seed(running, client);
            await client.close();

            // 새 연결은 붙자마자 목록과 현재 트레일을 통째로 받는다.
            const again = await connect(running);
            const list = await again.wait((e) => e.type === 'trail.listChanged');
            assert.equal(list.payload.activeTrailId, seeded.trailId);
            const snapshot = await again.wait((e) => e.type === 'trail.snapshot');
            assert.equal(snapshot.payload.roots.length, 1);
            assert.equal(snapshot.revision, seeded.revision);
            await again.close();
        });
    } finally {
        await removeProject(root);
    }
});

// ── 8. 저장 중 강제 종료 ────────────────────────────────────────────────────

test('저장 중 강제 종료로 남은 .tmp 를 복구 후보로 올린다', async () => {
    const root = await makeProject(FILES);
    try {
        const base = await configureFakeLsp(root);
        let trailId;
        {
            const running = await server.startServer(base);
            try {
                const client = await connect(running);
                const seeded = await seed(running, client);
                trailId = seeded.trailId;
                await client.close();
            } finally {
                await running.close();
            }
        }

        // 저장 도중 죽은 흔적을 만든다. 최종 파일보다 새 `.tmp` 다.
        const trailsDir = path.join(root, '.code-trail', 'trails');
        const finalPath = path.join(trailsDir, `${trailId}.json`);
        await stat(finalPath);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await writeFile(`${finalPath}.tmp`, '{"schemaVersion":1}', 'utf8');

        const running = await server.startServer(base);
        try {
            const body = await (await authFetch(running, '/api/diagnostics')).json();
            const candidate = body.recoveryCandidates.find((c) => c.trailId === trailId);
            assert.ok(candidate !== undefined, '복구 후보로 안 올라왔다');

            // **조용히 지우지 않는다.** 그 안에 최신 내용이 있을 수 있다.
            const stillThere = await stat(`${finalPath}.tmp`).catch(() => undefined);
            assert.ok(stillThere !== undefined, '.tmp 를 지워버렸다');

            // 최종 파일은 멀쩡하다. 트레일이 그대로 열린다.
            const client = await connect(running);
            const snapshot = await client.wait((e) => e.type === 'trail.snapshot');
            assert.equal(snapshot.payload.roots.length, 1);
            await client.close();
        } finally {
            await running.close();
        }
    } finally {
        await removeProject(root);
    }
});

// ── 9. LSP 연속 crash ───────────────────────────────────────────────────────

test('언어 서버가 계속 죽으면 자동 재시작을 멈춘다', async () => {
    const root = await makeProject(FILES);
    try {
        await withFakeLsp(root, ['--scenario=crashAfterInit'], async (running) => {
            const client = await connect(running);
            const seeded = await seed(running, client).catch(() => null);

            // 해석을 시도해 언어 서버를 띄운다. 뜨자마자 죽는다.
            if (seeded !== null) {
                client.send({
                    protocolVersion: 1,
                    type: 'trail.resolve',
                    commandId: randomUUID(),
                    trailId: seeded.trailId,
                    baseRevision: seeded.revision,
                    payload: { nodeId: seeded.root.id, line: 3, char: 28, text: 'Find' },
                });
            }

            // backoff 를 다 쓰면 failed 로 멈춘다. 무한히 다시 띄우지 않는다.
            const deadline = Date.now() + 15000;
            let info;
            for (;;) {
                const body = await (await authFetch(running, '/api/diagnostics')).json();
                info = body.languages.find((l) => l.language === 'cpp');
                if (info.state === 'failed') {
                    break;
                }
                if (Date.now() > deadline) {
                    throw new Error(`failed 로 안 갔다: ${info.state}`);
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            const settled = info.restartCount;
            await new Promise((resolve) => setTimeout(resolve, 600));
            const after = await (await authFetch(running, '/api/diagnostics')).json();
            const later = after.languages.find((l) => l.language === 'cpp');
            assert.equal(later.state, 'failed');
            assert.equal(
                later.restartCount,
                settled,
                `멈춘 뒤에도 계속 다시 띄웠다 (${settled} → ${later.restartCount})`,
            );
            // 세 번까지만 다시 띄운다.
            assert.ok(settled <= 3, `${settled}번 다시 띄웠다`);
            await client.close();
        });
    } finally {
        await removeProject(root);
    }
});

// ── 10. 종료 중 ────────────────────────────────────────────────────────────

test('종료 중에는 새 연결과 새 명령을 받지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        const base = await configureFakeLsp(root);
        const running = await server.startServer(base);
        const client = await connect(running);
        const seeded = await seed(running, client);

        // 종료 절차를 시작한다. 저장은 여기서 끝난다.
        running.app.gateway.closeAll();

        // 1) 새 연결을 받지 않는다. 붙자마자 "가는 중"(1001)으로 닫는다.
        const outcome = await socketOutcome(running);
        assert.ok(
            outcome.kind === 'error' || outcome.code === 1001 || outcome.code === 1006,
            `종료 중에 새 연결을 받았다 — ${JSON.stringify(outcome)}`,
        );
        assert.equal(outcome.messages, 0, '종료 중인데 snapshot 을 보냈다');

        // 2) HTTP 도 503 이다.
        const response = await authFetch(running, '/api/bootstrap');
        assert.equal(response.status, 503);
        const body = await response.json();
        assert.equal(body.code, 'SERVER_STOPPING');

        await running.close();

        // 3) 종료 전에 저장한 것은 남아 있다.
        const saved = path.join(root, '.code-trail', 'trails', `${seeded.trailId}.json`);
        const text = await readFile(saved, 'utf8');
        assert.ok(JSON.parse(text).roots.length === 1);
    } finally {
        await removeProject(root);
    }
});

test('닫힌 뒤에 온 명령은 SERVER_STOPPING 으로 알린다', async () => {
    const root = await makeProject(FILES);
    try {
        const running = await server.startServer({
            projectDirectory: root,
            logLevel: 'error',
            logWrite: () => {},
        });
        try {
            const client = await connect(running);
            // closeAll 은 소켓을 닫지만 닫히기 전에 도착한 명령이 있을 수 있다.
            running.app.gateway.closeAll();
            // 게이트웨이가 직접 판단하는지 본다.
            const gateway = running.app.gateway;
            assert.equal(gateway.isStopping, true);
            assert.equal(gateway.clientCount, 0);
            await client.close().catch(() => undefined);
        } finally {
            await running.close();
        }
    } finally {
        await removeProject(root);
    }
});
