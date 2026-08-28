/* 로컬 서버 보안 경계 — node --test "test/integration/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { authFetch, makeProject, removeProject, withServer } from './helpers.mjs';

const FILES = {
    'src/net/dispatch.cpp': 'void HandlePacket() {\n\treturn;\n}\n',
    'src/README.md': '# 안내\n',
    'node_modules/junk/index.js': 'module.exports = 1;\n',
    '.git/config': '[core]\n',
};

test('토큰이 없으면 API 를 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            for (const url of [
                '/api/bootstrap',
                '/api/workspace/children?id=',
                '/api/workspace/search?q=x',
                '/api/diagnostics',
                '/api/health',
            ]) {
                const response = await fetch(`${running.url}${url}`);
                assert.equal(response.status, 401, url);
                const body = await response.json();
                assert.equal(body.code, 'UNAUTHORIZED');
                // 무엇이 틀렸는지 알려주지 않는다.
                assert.equal(JSON.stringify(body).includes('Host'), false);
            }
        });
    } finally {
        await removeProject(root);
    }
});

test('틀린 토큰도 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const response = await fetch(`${running.url}/api/bootstrap`, {
                headers: { Authorization: `Bearer ${'x'.repeat(running.token.length)}` },
            });
            assert.equal(response.status, 401);
        });
    } finally {
        await removeProject(root);
    }
});

/**
 * `fetch` 는 Host 를 금지 헤더로 취급해 우리가 준 값을 지운다.
 * 그래서 이 검사만 원시 HTTP 요청을 쓴다.
 */
function rawRequest(port, { host, headers = {}, path: pathname = '/api/bootstrap' }) {
    return new Promise((resolve, reject) => {
        void import('node:http').then(({ request }) => {
            const req = request(
                { host: '127.0.0.1', port, path: pathname, method: 'GET', headers },
                (res) => {
                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => {
                        body += chunk;
                    });
                    res.on('end', () => resolve({ status: res.statusCode, body }));
                },
            );
            req.on('error', reject);
            if (host !== undefined) {
                req.setHeader('Host', host);
            }
            req.end();
        });
    });
}

test('모르는 Host 로 온 요청을 거부한다 — DNS rebinding 차단', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const auth = { Authorization: `Bearer ${running.token}` };

            // 공격자 도메인이 127.0.0.1 로 해석되게 만든 상황이다.
            const evil = await rawRequest(running.port, {
                host: `evil.example.com:${running.port}`,
                headers: auth,
            });
            assert.equal(evil.status, 401);

            // 포트가 다른 Host 도 거부한다.
            const wrongPort = await rawRequest(running.port, {
                host: `127.0.0.1:${running.port + 1}`,
                headers: auth,
            });
            assert.equal(wrongPort.status, 401);

            // 진짜 Host 는 통과한다 — 위 둘이 다른 이유로 막힌 것이 아님을 보인다.
            const good = await rawRequest(running.port, {
                host: `127.0.0.1:${running.port}`,
                headers: auth,
            });
            assert.equal(good.status, 200);
        });
    } finally {
        await removeProject(root);
    }
});

test('정적 셸은 토큰 없이 열리고 데이터는 담지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const response = await fetch(`${running.url}/`);
            assert.equal(response.status, 200);
            const html = await response.text();
            // 껍데기와 번들뿐이다. 프로젝트 정보도 토큰도 없다.
            assert.equal(html.includes(running.token), false);
            assert.equal(html.includes(root), false);
        });
    } finally {
        await removeProject(root);
    }
});

test('CSP 가 외부 CDN 과 인라인 스크립트를 막는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const response = await fetch(`${running.url}/`);
            const csp = response.headers.get('content-security-policy');
            assert.ok(csp);
            assert.match(csp, /default-src 'none'/);
            assert.match(csp, /script-src 'self'/);
            // 스크립트에는 unsafe-inline 도 unsafe-eval 도 없다.
            const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
            assert.equal(scriptSrc.includes('unsafe-inline'), false);
            assert.equal(scriptSrc.includes('unsafe-eval'), false);
            assert.equal(csp.includes('https://'), false);

            assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
            assert.equal(response.headers.get('x-frame-options'), 'DENY');
            assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
        });
    } finally {
        await removeProject(root);
    }
});

test('127.0.0.1 에만 바인딩한다 — 외부 인터페이스로는 안 뜬다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const { createConnection } = await import('node:net');
            const addresses = Object.values(os.networkInterfaces())
                .flat()
                .filter((info) => info && info.family === 'IPv4' && !info.internal)
                .map((info) => info.address);

            for (const address of addresses) {
                const reachable = await new Promise((resolve) => {
                    const socket = createConnection({ host: address, port: running.port });
                    socket.setTimeout(700);
                    const done = (value) => {
                        socket.removeAllListeners();
                        socket.destroy();
                        resolve(value);
                    };
                    socket.once('connect', () => done(true));
                    socket.once('timeout', () => done(false));
                    socket.once('error', () => done(false));
                });
                assert.equal(reachable, false, `${address}:${running.port} 로 붙어졌다`);
            }

            // 루프백으로는 붙어야 한다 — 위 검사가 "서버가 아예 안 떠서" 통과한
            // 것이 아님을 보장한다.
            const loopback = await fetch(`${running.url}/api/health`, {
                headers: { Authorization: `Bearer ${running.token}` },
            });
            assert.equal(loopback.status, 200);
        });
    } finally {
        await removeProject(root);
    }
});

test('프로젝트 밖 경로와 .. 를 거부한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const denied = [
                '../..',
                '../../etc/passwd',
                'src/../../outside',
                '/etc/passwd',
                'C:/Windows/System32/config/SAM',
                '\\\\server\\share',
                'src\\..\\..\\outside',
            ];
            for (const relPath of denied) {
                const response = await authFetch(
                    running,
                    `/api/workspace/open?relPath=${encodeURIComponent(relPath)}`,
                );
                assert.ok(
                    response.status === 403 || response.status === 404,
                    `${relPath} → ${response.status}`,
                );
                const body = await response.json();
                // 오류에 절대경로가 새지 않는다.
                assert.equal(JSON.stringify(body).includes(root), false);
            }
        });
    } finally {
        await removeProject(root);
    }
});

test('심볼릭 링크로 프로젝트 밖을 가리켜도 거부한다', async () => {
    const outside = await makeProject({ 'secret.txt': '비밀\n' });
    const root = await makeProject(FILES);
    try {
        let linked = true;
        try {
            await symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'), 'file');
            await symlink(outside, path.join(root, 'escape-dir'), 'junction');
        } catch {
            // Windows 에서 권한이 없으면 링크를 못 만든다. 그때는 이 검사를 건너뛴다.
            linked = false;
        }

        await withServer(root, async (running) => {
            if (!linked) {
                return;
            }
            const file = await authFetch(running, '/api/workspace/open?relPath=escape.txt');
            assert.ok(file.status === 403 || file.status === 404, `파일 링크 → ${file.status}`);

            const dir = await authFetch(running, '/api/workspace/children?id=escape-dir');
            assert.ok(dir.status === 403 || dir.status === 404, `디렉터리 링크 → ${dir.status}`);

            // 트리 목록에도 나오지 않는다.
            const listing = await (await authFetch(running, '/api/workspace/children?id=')).json();
            const names = listing.entries.map((e) => e.name);
            assert.equal(names.includes('escape-dir'), false);
        });
    } finally {
        await removeProject(root);
        await removeProject(outside);
    }
});

test('문서 본문은 발급된 documentId 로만 읽는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const opened = await (
                await authFetch(running, '/api/workspace/open?relPath=src/net/dispatch.cpp')
            ).json();
            assert.match(opened.documentId, /^doc_/);
            // 응답 어디에도 절대경로가 없다.
            assert.equal(JSON.stringify(opened).includes(root), false);

            const again = await authFetch(running, `/api/documents/${opened.documentId}`);
            assert.equal(again.status, 200);

            // 지어낸 ID 는 통하지 않는다.
            for (const fake of ['doc_없는것', '../../etc/passwd', 'src/net/dispatch.cpp']) {
                const response = await authFetch(
                    running,
                    `/api/documents/${encodeURIComponent(fake)}`,
                );
                assert.ok(response.status >= 400, `${fake} → ${response.status}`);
            }
        });
    } finally {
        await removeProject(root);
    }
});

test('원본 문자열을 한 글자도 바꾸지 않는다', async () => {
    // 탭, CRLF, 비ASCII, surrogate pair, 끝 줄바꿈 없음까지 한 파일에 담는다.
    const original = '\tvoid f() {\r\n\t\t// 한글 🚀 주석\r\n\t}\n\n마지막 줄';
    const root = await makeProject({ 'odd.cpp': original });
    try {
        await withServer(root, async (running) => {
            const opened = await (
                await authFetch(running, '/api/workspace/open?relPath=odd.cpp')
            ).json();
            assert.equal(opened.text, original);
            // 해시도 원문 기준이다.
            const { createHash } = await import('node:crypto');
            assert.equal(
                opened.contentHash,
                createHash('sha256').update(original, 'utf8').digest('hex'),
            );
        });
    } finally {
        await removeProject(root);
    }
});

test('기본 제외 디렉터리는 트리에 안 나온다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const listing = await (await authFetch(running, '/api/workspace/children?id=')).json();
            const names = listing.entries.map((e) => e.name);
            assert.equal(names.includes('node_modules'), false);
            assert.equal(names.includes('.git'), false);
            assert.equal(names.includes('src'), true);

            // 이름을 직접 찍어도 안 열린다.
            const direct = await authFetch(running, '/api/workspace/children?id=node_modules');
            assert.equal(direct.status, 403);

            // 검색 결과에도 안 나온다.
            const search = await (await authFetch(running, '/api/workspace/search?q=index')).json();
            assert.equal(search.entries.some((e) => e.id.startsWith('node_modules/')), false);
        });
    } finally {
        await removeProject(root);
    }
});

test('.code-trail/runtime 은 감추고 settings 는 보여준다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const listing = await (
                await authFetch(running, '/api/workspace/children?id=.code-trail')
            ).json();
            const names = listing.entries.map((e) => e.name);
            assert.equal(names.includes('runtime'), false);
            assert.equal(names.includes('settings.json'), true);

            const runtime = await authFetch(running, '/api/workspace/children?id=.code-trail/runtime');
            assert.equal(runtime.status, 403);
        });
    } finally {
        await removeProject(root);
    }
});

test('파일 이름 검색은 상대경로만 돌려준다', async () => {
    const root = await makeProject({
        ...FILES,
        'src/handlers/login.go': 'package handlers\n',
    });
    try {
        await withServer(root, async (running) => {
            const result = await (
                await authFetch(running, '/api/workspace/search?q=dispatch')
            ).json();
            assert.equal(result.entries.length >= 1, true);
            assert.equal(result.entries[0].id, 'src/net/dispatch.cpp');
            assert.equal(JSON.stringify(result).includes(root), false);
            assert.equal(JSON.stringify(result).includes(path.sep === '\\' ? 'C:\\' : '/tmp/'), false);
        });
    } finally {
        await removeProject(root);
    }
});

test('없는 API 경로는 404 를 준다 — 정적 폴백으로 새지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const response = await authFetch(running, '/api/없는것');
            assert.equal(response.status, 404);
            const body = await response.json();
            assert.equal(body.code, 'NOT_FOUND');
        });
    } finally {
        await removeProject(root);
    }
});

test('큰 파일은 열지 않는다', async () => {
    const root = await makeProject(FILES);
    try {
        // 9MB. 상한은 8MB 다.
        await writeFile(path.join(root, 'huge.txt'), 'x'.repeat(9 * 1024 * 1024), 'utf8');
        await withServer(root, async (running) => {
            const response = await authFetch(running, '/api/workspace/open?relPath=huge.txt');
            assert.equal(response.status, 413);
        });
    } finally {
        await removeProject(root);
    }
});
