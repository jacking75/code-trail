/*
 * 빈 웹 셸 E2E — node test/e2e/shell.e2e.mjs
 *
 * 진짜 서버를 띄우고 진짜 브라우저로 연다. 여기서만 확인할 수 있는 것들이 있다.
 *
 * - fragment 토큰이 `sessionStorage` 로 옮겨지고 주소에서 사라지는가
 * - CSP 아래에서 번들과 Monaco 워커가 실제로 도는가
 * - 파일을 열면 원본 문자열이 한 글자도 안 바뀐 채 화면에 오는가
 *
 * 브라우저는 `test/ui.test.js` 와 같은 규칙으로 고른다: `CT_CHROME` 우선.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const server = await import(
    new URL('../../packages/server/dist/index.js', import.meta.url).href
);

const SAMPLE = [
    '// 클라이언트 패킷 진입점',
    'void HandlePacket(Session* sess, Packet* pkt) {',
    '\tif (!sess->IsAuthed()) {',
    '\t\treturn;',
    '\t}',
    '\tauto* handler = g_registry.Find(pkt->opcode);',
    '\thandler->Invoke(sess, pkt);',
    '}',
].join('\n');

async function makeProject() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'code-trail-e2e-'));
    await mkdir(path.join(root, 'src', 'net'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'junk'), { recursive: true });
    await writeFile(path.join(root, 'src', 'net', 'dispatch.cpp'), SAMPLE, 'utf8');
    await writeFile(path.join(root, 'src', 'README.md'), '# 안내\n', 'utf8');
    await writeFile(path.join(root, 'node_modules', 'junk', 'x.js'), 'nope\n', 'utf8');
    return root;
}

let failures = 0;
const check = (name, condition, extra) => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${!condition && extra ? ` — ${extra}` : ''}`);
    if (!condition) {
        failures++;
    }
};

const root = await makeProject();
const running = await server.startServer({
    projectDirectory: root,
    logLevel: 'error',
    logWrite: () => {},
});

const browser = await chromium.launch({
    executablePath: process.env.CT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
});

try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
        if (m.type() === 'error') {
            errors.push(m.text());
        }
    });

    console.log('\n[부트스트랩]');
    await page.goto(`${running.url}/#token=${running.token}`);
    await page.waitForSelector('.app-bar', { timeout: 15000 });

    check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
    check('프로젝트 이름 표시', (await page.locator('.project').textContent()) === path.basename(root));

    const url = page.url();
    check('토큰이 주소에서 사라짐', !url.includes('token'), url);
    check('fragment 가 비었음', !url.includes('#'), url);

    const stored = await page.evaluate(() => sessionStorage.getItem('codeTrail.token'));
    check('토큰이 sessionStorage 에 있음', stored === running.token);

    const historyLength = await page.evaluate(() => history.length);
    check('replaceState 라 방문 기록이 안 늘어남', historyLength <= 2, String(historyLength));

    console.log('\n[WebSocket]');
    await page.waitForFunction(
        () => document.querySelector('.conn')?.textContent === '연결됨',
        undefined,
        { timeout: 10000 },
    );
    check('연결됨 표시', (await page.locator('.conn').textContent()) === '연결됨');

    console.log('\n[파일 탐색기]');
    await page.waitForSelector('.tree-root .tree-row');
    const names = await page.locator('.tree-root > li > .tree-row').allTextContents();
    check('src 가 보임', names.some((n) => n.includes('src')), names.join(','));
    check('node_modules 는 안 보임', !names.some((n) => n.includes('node_modules')), names.join(','));

    await page.getByRole('button', { name: /src/ }).first().click();
    await page.waitForSelector('.tree-file');
    await page.getByRole('button', { name: /net/ }).first().click();
    await page.waitForSelector('button:has-text("dispatch.cpp")');

    console.log('\n[코드 화면]');
    await page.locator('button:has-text("dispatch.cpp")').click();
    await page.waitForSelector('.code-view .monaco-editor', { timeout: 15000 });

    check('경로 표시', (await page.locator('.doc-path').textContent()) === 'src/net/dispatch.cpp');
    check('언어 표시', (await page.locator('.doc-bar .muted').textContent()) === 'cpp');

    // Monaco 는 화면에 그릴 때 공백을 non-breaking space 로 바꾼다.
    // 원본과 비교하려면 되돌려야 한다 — 이건 표시 방식일 뿐 모델은 원본 그대로다.
    const NBSP = String.fromCharCode(0x00a0);
    const renderedLines = async () =>
        (await page.locator('.view-line').allTextContents()).map((line) =>
            line.split(NBSP).join(' '));

    const lines = await renderedLines();
    check('첫 줄이 원본 주석', lines[0] === '// 클라이언트 패킷 진입점', JSON.stringify(lines[0]));
    // 탭은 화면에서 공백 폭으로 그려진다. 들여쓰기가 사라지지 않았는지만 본다.
    check('들여쓰기가 살아 있음', /^\s+if \(!sess/.test(lines[2]), JSON.stringify(lines[2]));
    check('마지막 줄까지 옴', lines.some((l) => l === '}'), String(lines.length));

    const themed = await page.evaluate(() =>
        document.querySelector('.code-view .monaco-editor')?.classList.contains('vs-dark'));
    check('테마가 적용됨', themed === true);

    // 코드가 열린 상태를 남긴다. 트레일 화면이 붙기 전 기준 화면이다.
    const outDir = fileURLToPath(new URL('../../docs/baseline/', import.meta.url));
    await page.screenshot({ path: path.join(outDir, 'standalone-shell.png') });
    console.log('  wrote docs/baseline/standalone-shell.png');

    // 읽기 전용인지 — 코드 위를 눌러 커서를 둔 뒤 타자를 쳐도 내용이 안 바뀐다.
    await page.locator('.view-line').first().click();
    await page.keyboard.type('XXXX');
    await page.waitForTimeout(200);
    const afterTyping = await renderedLines();
    check('타자를 쳐도 안 바뀜', !afterTyping.join(' ').includes('XXXX'), afterTyping[0]);

    console.log('\n[파일 변경 알림]');
    check('처음에는 다시 읽기 버튼이 없음', (await page.locator('.stale').count()) === 0);

    // 다른 편집기가 파일을 고친 상황이다.
    await writeFile(
        path.join(root, 'src', 'net', 'dispatch.cpp'),
        `${SAMPLE}\n// 밖에서 고친 줄\n`,
        'utf8',
    );
    await page.waitForSelector('.stale', { timeout: 10000 });
    check('바뀌면 다시 읽기 버튼이 나옴', (await page.locator('.stale').count()) === 1);

    // 자동으로 다시 읽지 않는다 — 사용자가 누르기 전까지 화면은 그대로다.
    const beforeReload = await renderedLines();
    check('누르기 전에는 안 바뀜', !beforeReload.join(' ').includes('밖에서 고친 줄'));

    await page.locator('.stale').click();
    await page.waitForFunction(
        () => document.querySelectorAll('.view-line').length > 8,
        undefined,
        { timeout: 10000 },
    );
    const afterReload = await renderedLines();
    check('누르면 새 내용이 옴', afterReload.join(' ').includes('밖에서 고친 줄'));
    check('버튼이 사라짐', (await page.locator('.stale').count()) === 0);

    console.log('\n[탭 스크립트 차단]');
    const cspBlocked = await page.evaluate(() => {
        try {
            // CSP 가 인라인 스크립트를 막는다. 막히면 스크립트가 실행되지 않는다.
            const s = document.createElement('script');
            s.textContent = 'window.__ctInlineRan = true;';
            document.head.appendChild(s);
            return window.__ctInlineRan !== true;
        } catch {
            return true;
        }
    });
    check('인라인 스크립트가 막힘', cspBlocked);

    console.log('\n[새로고침]');
    await page.reload();
    await page.waitForSelector('.app-bar');
    await page.waitForFunction(
        () => document.querySelector('.conn')?.textContent === '연결됨',
        undefined,
        { timeout: 10000 },
    );
    check('토큰 없이도 새로고침이 살아남음', (await page.locator('.conn').textContent()) === '연결됨');

    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
} finally {
    await browser.close();
    await running.close();
    await rm(root, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
