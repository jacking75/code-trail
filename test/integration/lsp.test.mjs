/* 가짜 LSP 를 붙인 심볼 해석 — node --test "test/integration/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import { authFetch, makeProject, removeProject, server } from './helpers.mjs';

const { WS_PROTOCOL } = server;
const FAKE_LSP = fileURLToPath(new URL('../fake-lsp/server.mjs', import.meta.url));

/**
 * `dispatch.cpp` 에서 `Find` 를 클릭하면 `registry.cpp` 의 `Find` 로 간다.
 * 가짜 서버가 그렇게 답하도록 좌표를 맞춰 뒀다.
 */
// 가짜 서버는 어느 파일이든 아래 `REGISTRY` 모양의 심볼을 돌려준다. 그래서 두
// 파일 모두 10줄로 맞춘다 — 심볼 range 가 문서 범위를 벗어나면 후보에서 빠진다.
const DISPATCH = [
    '// 클라이언트 패킷 진입점',                       // 0
    'void HandlePacket(Session* sess, Packet* pkt) {', // 1
    '\tif (!sess->IsAuthed()) { return; }',            // 2
    '\tauto* handler = g_registry.Find(pkt->opcode);', // 3 — `Find` 가 28열
    '\t{',                                             // 4 — 식별자가 없는 줄
    '\thandler->Invoke(sess, pkt);',                   // 5
    '}',                                              // 6
    '',                                               // 7
    '// 파일 끝',                                      // 8
    '',                                               // 9
].join('\n');

const REGISTRY = [
    'class HandlerRegistry {',                                       // 0
    'public:',                                                       // 1
    '\t// 등록된 핸들러를 찾는다',                                    // 2
    '\tIHandler* Find(uint16_t opcode) const {',                      // 3
    '\t\tauto it = entries_.find(opcode);',                            // 4
    '\t\treturn it == entries_.end() ? nullptr : it->second.get();',   // 5
    '\t}',                                                            // 6
    '',                                                              // 7
    '\tstd::map<uint16_t, Handler> entries_;',                        // 8
    '};',                                                            // 9
].join('\n');

const FILES = {
    'src/dispatch.cpp': DISPATCH,
    'src/registry.cpp': REGISTRY,
    'src/registry.impl.cpp': REGISTRY,
    'src/registry.impl2.cpp': REGISTRY,
    'src/registry.h': REGISTRY,
};

/** 가짜 LSP 를 C++ 서버로 지정한 프로젝트를 만든다. */
async function makeLspProject(scenario = 'normal', extraArgs = []) {
    const root = await makeProject(FILES);
    return { root, scenario, extraArgs };
}

async function startWithFakeLsp({ root, scenario, extraArgs }, run, serverOptions = {}) {
    const base = {
        projectDirectory: root,
        logLevel: 'error',
        logWrite: () => {},
        lspRequestTimeoutMs: 4000,
        lspRestartDelaysMs: [50, 80, 120],
        ...serverOptions,
    };
    const running = await server.startServer(base);
    try {
        // 설정에 가짜 서버를 적는다. 실행 파일을 자동으로 찾지 않는다는 규칙 그대로다.
        const settingsPath = path.join(root, '.code-trail', 'settings.json');
        const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
        settings.languages.cpp.executable = process.execPath;
        settings.languages.cpp.args = [FAKE_LSP, `--scenario=${scenario}`, ...extraArgs];
        await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
        // 서버는 시작할 때 설정을 읽었다. 다시 읽히려면 새로 띄워야 한다.
        await running.close();

        const second = await server.startServer(base);
        try {
            return await run(second);
        } finally {
            await second.close();
        }
    } catch (error) {
        await running.close().catch(() => undefined);
        throw error;
    }
}

/** 소켓 하나를 열고 이벤트를 모은다. */
function connect(running) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`${running.url.replace(/^http/, 'ws')}/ws`, [
            WS_PROTOCOL,
            running.token,
        ], { headers: { Origin: running.url } });

        const events = [];
        socket.on('message', (raw) => events.push(JSON.parse(String(raw))));
        socket.on('error', reject);
        socket.on('open', () => resolve({
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
                    // 무엇이 왔는지 함께 남긴다. 이게 없으면 실패했을 때
                    // "안 왔다" 말고는 알 수 있는 것이 없다.
                    rej(new Error(
                        `이벤트를 기다리다 시간이 다 됐다. 받은 것: ${
                            events.map((e) => (e.type === 'command.error'
                                ? `command.error(${e.payload.error.code}: ${e.payload.error.message})`
                                : e.type)).join(', ')}`,
                    ));
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

/** 조건이 참이 될 때까지 기다린다. 이벤트가 아니라 상태를 볼 때 쓴다. */
async function waitFor(check, what, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (await check()) {
            return;
        }
        if (Date.now() > deadline) {
            throw new Error(`${what} 을 기다리다 시간이 다 됐다.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

/** 트레일 하나와 그 안의 루트 노드 하나를 만든다. */
async function seedTrailWithRoot(running, client) {
    const opened = await (
        await authFetch(running, '/api/workspace/open?relPath=src%2Fdispatch.cpp')
    ).json();

    client.send({
        protocolVersion: 1,
        type: 'trail.create',
        commandId: randomUUID(),
        baseRevision: 0,
        payload: { title: '해석 시험' },
    });
    const created = await client.wait((e) => e.type === 'trail.snapshot');
    const trailId = created.trailId;

    client.send({
        protocolVersion: 1,
        type: 'trail.addRootAt',
        commandId: randomUUID(),
        trailId,
        baseRevision: created.revision,
        // 식별자가 없는 줄. 정의로 가지 않고 감싸는 심볼을 루트로 만든다.
        payload: { documentId: opened.documentId, line: 4, char: 0 },
    });
    const rooted = await client.wait((e) => e.type === 'trail.rootAdded');
    return { trailId, documentId: opened.documentId, root: rooted.payload.node, revision: rooted.revision };
}

test('커서 위치에서 감싸는 심볼을 루트로 만든다', async () => {
    const project = await makeLspProject('normal');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { root } = await seedTrailWithRoot(running, client);

            assert.equal(root.symbol.relPath, 'src/dispatch.cpp');
            assert.equal(root.symbol.external, false);
            assert.equal(root.symbol.languageId, 'cpp');
            // 원본을 변형하지 않는다.
            assert.equal(root.symbol.code.includes('\t'), true);
            assert.equal(root.parentId, null);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('식별자를 클릭하면 정의가 자식으로 붙는다', async () => {
    const project = await makeLspProject('normal');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });

            const added = await client.wait((e) => e.type === 'trail.nodeAdded');
            const node = added.payload.node;
            assert.equal(added.payload.parentId, root.id);
            assert.equal(node.symbol.name, 'Find');
            assert.equal(node.symbol.relPath, 'src/registry.cpp');
            assert.equal(node.symbol.container, 'HandlerRegistry');
            assert.equal(node.symbol.detail, '(uint16_t) -> IHandler*');
            // 다중 행 range 를 그대로 썼다.
            assert.equal(node.symbol.approximate, false);
            assert.equal(node.symbol.startLine, 3);
            assert.equal(node.symbol.code.includes('entries_.find'), true);
            // 진입 링크에 클릭 지점이 남는다.
            assert.deepEqual(node.origin, { line: 3, char: 28, text: 'Find' });

            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('해석 중에는 노드에 진행 표시가 켜졌다 꺼진다', async () => {
    const project = await makeLspProject('normal');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });
            await client.wait((e) => e.type === 'trail.nodeBusy' && e.payload.on === true);
            await client.wait((e) => e.type === 'trail.nodeBusy' && e.payload.on === false);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('계층 없는 SymbolInformation 응답도 다룬다', async () => {
    const project = await makeLspProject('symbolInformation');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });
            const added = await client.wait((e) => e.type === 'trail.nodeAdded');
            // 클래스가 아니라 메서드가 걸려야 한다.
            assert.equal(added.payload.node.symbol.name, 'Find');
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('LocationLink 대신 Location 만 줘도 붙는다', async () => {
    const project = await makeLspProject('plainLocation');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });
            const added = await client.wait((e) => e.type === 'trail.nodeAdded');
            assert.equal(added.payload.node.symbol.name, 'Find');
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('한 줄 range 는 보정하고 근사 표시를 세운다', async () => {
    const project = await makeLspProject('oneLineRange');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });
            const added = await client.wait((e) => e.type === 'trail.nodeAdded');
            const symbol = added.payload.node.symbol;
            assert.equal(symbol.approximate, true);
            // 한 줄이 아니라 여러 줄이 왔다.
            assert.equal(symbol.code.split('\n').length > 1, true);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('정의를 못 찾으면 typeDefinition 으로 넘어간다', async () => {
    const project = await makeLspProject('noDefinitionResult');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });
            const added = await client.wait((e) => e.type === 'trail.nodeAdded');
            assert.equal(added.payload.node.symbol.name, 'Find');
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('정의 후보가 여럿이면 고르지 않고 사용자에게 넘긴다', async () => {
    const project = await makeLspProject('multiDefinition');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });

            const choice = await client.wait((e) => e.type === 'trail.definitionChoice');
            assert.equal(choice.payload.candidates.length, 2);
            assert.equal(choice.payload.nodeId, root.id);
            // 아무것도 안 붙었다.
            assert.equal(client.events.some((e) => e.type === 'trail.nodeAdded'), false);
            // 후보에 절대경로가 없다.
            assert.equal(JSON.stringify(choice).includes(project.root), false);

            // 사용자가 고르면 그때 붙는다.
            client.send({
                protocolVersion: 1,
                type: 'trail.chooseCandidate',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: {
                    choiceId: choice.payload.choiceId,
                    candidateId: choice.payload.candidates[1].candidateId,
                },
            });
            const added = await client.wait((e) => e.type === 'trail.nodeAdded');
            assert.equal(added.payload.parentId, root.id);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('같은 부모에 같은 심볼을 두 번 붙이지 않는다', async () => {
    const project = await makeLspProject('normal');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });
            const first = await client.wait((e) => e.type === 'trail.nodeAdded');

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: first.revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });
            // 새로 붙는 대신 그 노드로 보낸다.
            const focused = await client.wait((e) => e.type === 'trail.activeNodeChanged');
            assert.equal(focused.payload.nodeId, first.payload.node.id);
            assert.equal(client.events.filter((e) => e.type === 'trail.nodeAdded').length, 1);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('구현 찾기가 여러 개를 형제 자식으로 붙인다', async () => {
    const project = await makeLspProject('multiImplementation');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolveImplementations',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id },
            });

            const added = [];
            for (let i = 0; i < 2; i++) {
                added.push(await client.wait(
                    (e) => e.type === 'trail.nodeAdded'
                        && !added.some((prev) => prev.eventId === e.eventId),
                ));
            }
            assert.equal(added.length, 2);
            for (const event of added) {
                assert.equal(event.payload.parentId, root.id);
            }
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('구현 찾기는 참조 검색으로 되돌아가지 않는다', async () => {
    const project = await makeLspProject('noImplementationResult');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolveImplementations',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id },
            });
            const error = await client.wait((e) => e.type === 'command.error');
            assert.equal(error.payload.error.code, 'NOT_FOUND');

            // 가짜 서버는 references 요청을 받으면 stderr 에 표시를 남긴다.
            const log = await (await authFetch(running, '/api/diagnostics/cpp/log')).json();
            assert.equal(
                log.lines.some((line) => line.includes('REFERENCES_REQUESTED')),
                false,
                '참조 검색으로 되돌아갔다',
            );
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('구현 capability 가 없으면 그렇다고 알린다', async () => {
    const project = await makeLspProject('noImplementation');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolveImplementations',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id },
            });
            const error = await client.wait((e) => e.type === 'command.error');
            assert.equal(error.payload.error.code, 'LSP_UNAVAILABLE');

            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            assert.equal(cpp.missingCapabilities.includes('implementation'), true);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('동적으로 등록된 capability 를 반영한다', async () => {
    const project = await makeLspProject('dynamicCapability');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            // initialize 응답에는 implementation 이 없었다.
            // 서버가 `client/registerCapability` 로 뒤늦게 켜면 그것이 반영돼야 한다.
            await waitFor(async () => {
                const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
                const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
                return cpp !== undefined && !cpp.missingCapabilities.includes('implementation');
            }, '동적 capability 등록');

            client.send({
                protocolVersion: 1,
                type: 'trail.resolveImplementations',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id },
            });
            const added = await client.wait((e) => e.type === 'trail.nodeAdded');
            assert.equal(added.payload.parentId, root.id);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('응답이 오래 걸리면 timeout 으로 끊고 알린다', async () => {
    // 서버가 20초를 끄는데 우리 timeout 은 600ms 다.
    const project = await makeLspProject('slow', ['--slow-ms=20000']);
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);

            const opened = await (
                await authFetch(running, '/api/workspace/open?relPath=src%2Fdispatch.cpp')
            ).json();
            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: {},
            });
            const created = await client.wait((e) => e.type === 'trail.snapshot');

            // 루트는 만들어진다. 문서 심볼이 시간 안에 안 오면 근사 본문으로
            // 되돌아가기 때문이다 — 아무것도 못 보여주는 것보다 낫다.
            client.send({
                protocolVersion: 1,
                type: 'trail.addRootAt',
                commandId: randomUUID(),
                trailId: created.trailId,
                baseRevision: created.revision,
                payload: { documentId: opened.documentId, line: 4, char: 0 },
            });
            const rooted = await client.wait((e) => e.type === 'trail.rootAdded', 15000);
            assert.equal(rooted.payload.node.symbol.approximate, true);

            // 정의 클릭은 답이 없으면 붙일 것이 없다. 영원히 기다리지 않고 끝난다.
            const started = Date.now();
            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId: created.trailId,
                baseRevision: rooted.revision,
                payload: { nodeId: rooted.payload.node.id, line: 3, char: 28, text: 'Find' },
            });
            const error = await client.wait((e) => e.type === 'command.error', 15000);
            assert.equal(error.payload.error.code, 'NOT_FOUND');
            // definition·typeDefinition 두 번의 timeout 안에 끝난다.
            assert.equal(Date.now() - started < 12000, true, String(Date.now() - started));
            // 진행 표시도 꺼진다 — 실패한 노드가 도는 표시를 달고 남지 않는다.
            await client.wait((e) => e.type === 'trail.nodeBusy' && e.payload.on === false);
            await client.close();
        }, { lspRequestTimeoutMs: 600 });
    } finally {
        await removeProject(project.root);
    }
});

test('stdout 이 오염되면 protocolError 로 보고 재시작하지 않는다', async () => {
    const project = await makeLspProject('pollute');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const opened = await (
                await authFetch(running, '/api/workspace/open?relPath=src%2Fdispatch.cpp')
            ).json();
            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: {},
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
            await client.wait((e) => e.type === 'command.error', 12000);

            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            assert.equal(cpp.state, 'failed');
            // 다시 띄워도 같은 일이 반복된다. 재시작 횟수를 쌓지 않는다.
            assert.equal(cpp.restartCount, 0);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('언어 서버가 죽으면 다시 띄우고 열린 문서를 복원한다', async () => {
    // `--crash-once` 는 처음 뜬 프로세스만 죽인다. 계속 죽으면 재시작 뒤에
    // 제대로 도는지를 볼 수 없다.
    const marker = path.join(os.tmpdir(), `ct-crash-${randomUUID()}`);
    const project = await makeLspProject('crashOnRequest', [`--crash-once=${marker}`]);
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const opened = await (
                await authFetch(running, '/api/workspace/open?relPath=src%2Fdispatch.cpp')
            ).json();
            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: {},
            });
            const created = await client.wait((e) => e.type === 'trail.snapshot');

            // 첫 요청에서 서버가 죽는다. 문서 심볼을 못 받아도 근사 본문으로
            // 루트는 만들어진다 — 아무것도 못 보여주는 것보다 낫다.
            client.send({
                protocolVersion: 1,
                type: 'trail.addRootAt',
                commandId: randomUUID(),
                trailId: created.trailId,
                baseRevision: created.revision,
                payload: { documentId: opened.documentId, line: 4, char: 0 },
            });
            const rooted = await client.wait((e) => e.type === 'trail.rootAdded', 12000);
            assert.equal(rooted.payload.node.symbol.approximate, true);

            // 죽었다는 것이 화면으로 나가고,
            await client.wait(
                (e) => e.type === 'lsp.stateChanged'
                    && e.payload.language === 'cpp'
                    && e.payload.state === 'failed',
                8000,
            );
            // 다시 떠서 준비 상태로 돌아온다.
            await waitFor(async () => {
                const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
                const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
                return cpp?.state === 'ready';
            }, '언어 서버 재기동');

            const diagnostics = await (await authFetch(running, '/api/diagnostics')).json();
            const cpp = diagnostics.languages.find((l) => l.language === 'cpp');
            // 다시 뜬 횟수는 성공해도 되돌아가지 않는다 — 진단 화면이 쓰는 값이다.
            assert.equal(cpp.restartCount >= 1, true, `restartCount=${cpp.restartCount}`);

            // 새 프로세스는 우리가 무엇을 열었는지 모른다. 복원하지 않으면 여기서
            // "문서를 모른다" 로 실패한다.
            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId: created.trailId,
                baseRevision: rooted.revision,
                payload: {
                    nodeId: rooted.payload.node.id,
                    line: 3,
                    char: 28,
                    text: 'Find',
                },
            });
            const added = await client.wait((e) => e.type === 'trail.nodeAdded', 12000);
            assert.equal(added.payload.node.symbol.name, 'Find');
            await client.close();
        });
    } finally {
        await removeProject(project.root);
        await rm(marker, { force: true });
    }
});

test('언어 서버 실행 파일이 없으면 이유를 알린다', async () => {
    const root = await makeProject(FILES);
    try {
        const running = await server.startServer({
            projectDirectory: root,
            logLevel: 'error',
            logWrite: () => {},
        });
        try {
            const client = await connect(running);
            const opened = await (
                await authFetch(running, '/api/workspace/open?relPath=src%2Fdispatch.cpp')
            ).json();
            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: {},
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
            const error = await client.wait((e) => e.type === 'command.error');
            assert.equal(error.payload.error.code, 'LSP_UNAVAILABLE');
            // 무엇을 고쳐야 하는지 말해준다.
            assert.match(error.payload.error.message, /settings\.json/);
            // 절대경로가 새지 않는다.
            assert.equal(JSON.stringify(error).includes(root), false);
            await client.close();
        } finally {
            await running.close();
        }
    } finally {
        await removeProject(root);
    }
});

test('stderr 로그는 크기 제한 안에서만 남는다', async () => {
    const project = await makeLspProject('noisyStderr');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const opened = await (
                await authFetch(running, '/api/workspace/open?relPath=src%2Fdispatch.cpp')
            ).json();
            client.send({
                protocolVersion: 1,
                type: 'trail.create',
                commandId: randomUUID(),
                baseRevision: 0,
                payload: {},
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
            await client.wait((e) => e.type === 'trail.rootAdded' || e.type === 'command.error', 12000);

            const log = await (await authFetch(running, '/api/diagnostics/cpp/log')).json();
            // 2,000줄을 뱉었지만 전부 들고 있지 않다.
            assert.equal(log.lines.length <= 500, true, String(log.lines.length));
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('종료하면 언어 서버 자식 프로세스가 남지 않는다', async () => {
    const project = await makeLspProject('normal');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            await seedTrailWithRoot(running, client);
            await client.close();
        });
        // startWithFakeLsp 가 close 까지 했다. 남은 프로세스가 있으면 이 테스트
        // 파일이 안 끝나고 러너가 시간 초과로 잡아낸다.
        assert.ok(true);
    } finally {
        await removeProject(project.root);
    }
});

test('선언만인 정의는 배지가 붙고 구현이 하나면 자동으로 이어 붙는다', async () => {
    const project = await makeLspProject('declarationTarget');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });

            const declaration = await client.wait(
                (e) => e.type === 'trail.nodeAdded' && e.payload.parentId === root.id,
            );
            assert.equal(declaration.payload.node.symbol.declarationOnly, true);

            // 몸통 있는 구현이 정확히 하나다. 한 단계 더 붙는다.
            const implementation = await client.wait(
                (e) => e.type === 'trail.nodeAdded'
                    && e.payload.parentId === declaration.payload.node.id,
            );
            assert.equal(implementation.payload.node.symbol.declarationOnly, false);

            // **선언 노드는 지우지 않는다.** "인터페이스를 거쳐 갔다" 도 경로의 일부다.
            const snapshot = await (await authFetch(running, '/api/bootstrap')).json();
            assert.equal(snapshot.trails[0].nodeCount, 3);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('구현이 둘 이상이면 자동으로 고르지 않는다', async () => {
    const project = await makeLspProject('declarationTarget,multiImplementation');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });

            const declaration = await client.wait(
                (e) => e.type === 'trail.nodeAdded' && e.payload.parentId === root.id,
            );
            assert.equal(declaration.payload.node.symbol.declarationOnly, true);

            // 여러 개라는 사실만 알린다. 하나를 골라 붙이지 않는다 —
            // 호출부의 정적 타입만으로는 어느 구현이 도는지 알 수 없다.
            await client.wait((e) => e.type === 'trail.implementationChoice');
            assert.equal(
                client.events.some(
                    (e) => e.type === 'trail.nodeAdded'
                        && e.payload.parentId === declaration.payload.node.id,
                ),
                false,
                '자동으로 하나를 골라 붙였다',
            );

            const snapshot = await (await authFetch(running, '/api/bootstrap')).json();
            assert.equal(snapshot.trails[0].nodeCount, 2);
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});

test('자동 추적을 끄면 선언 노드에서 멈춘다', async () => {
    const project = await makeLspProject('declarationTarget');
    try {
        await startWithFakeLsp(project, async (running) => {
            const client = await connect(running);
            const { trailId, root, revision } = await seedTrailWithRoot(running, client);

            client.send({
                protocolVersion: 1,
                type: 'settings.update',
                commandId: randomUUID(),
                payload: {
                    settings: {
                        ...(await (await authFetch(running, '/api/bootstrap')).json()).settings,
                        ui: {
                            ...(await (await authFetch(running, '/api/bootstrap')).json())
                                .settings.ui,
                            autoFollowSingleImplementation: false,
                        },
                    },
                },
            });
            await client.wait((e) => e.type === 'settings.changed');

            client.send({
                protocolVersion: 1,
                type: 'trail.resolve',
                commandId: randomUUID(),
                trailId,
                baseRevision: revision,
                payload: { nodeId: root.id, line: 3, char: 28, text: 'Find' },
            });
            const declaration = await client.wait(
                (e) => e.type === 'trail.nodeAdded' && e.payload.parentId === root.id,
            );
            assert.equal(declaration.payload.node.symbol.declarationOnly, true);

            await new Promise((resolve) => setTimeout(resolve, 700));
            assert.equal(
                client.events.some(
                    (e) => e.type === 'trail.nodeAdded'
                        && e.payload.parentId === declaration.payload.node.id,
                ),
                false,
            );
            await client.close();
        });
    } finally {
        await removeProject(project.root);
    }
});
