/*
 * 트레일 화면 E2E — node test/e2e/trail.e2e.mjs
 *
 * 가짜 언어 서버를 붙인 진짜 서버를 띄우고 진짜 브라우저로 연다.
 * 확장 시절 `test/ui.test.js` 가 보던 것들을 새 화면에서 다시 확인한다 —
 * 헤더 구성, 배지, 진입 링크, 순번 짝, 트리 배치, 접기·삭제·승격, 필터.
 *
 * 브라우저는 `CT_CHROME` 우선. 없으면 컨테이너의 프리설치 크로미움.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const server = await import(
    new URL('../../packages/server/dist/index.js', import.meta.url).href
);
const FAKE_LSP = fileURLToPath(new URL('../fake-lsp/server.mjs', import.meta.url));

// 가짜 서버가 돌려주는 심볼 범위(0..9, 3..7)에 맞춰 두 파일 모두 10줄로 둔다.
const DISPATCH = [
    '// 클라이언트 패킷 진입점',                       // 0
    'void HandlePacket(Session* sess, Packet* pkt) {', // 1
    '\tif (!sess->IsAuthed()) { return; }',            // 2
    '\tauto* handler = g_registry.Find(pkt->opcode);', // 3 — `Find` 가 28열
    '\t{',                                             // 4
    '\thandler->Invoke(sess, pkt);',                   // 5
    '}',                                              // 6
    '',                                               // 7
    '// 파일 끝',                                      // 8
    '',                                               // 9
].join('\n');

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
].join('\n');

let failures = 0;
const check = (name, condition, extra) => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${!condition && extra ? ` — ${extra}` : ''}`);
    if (!condition) {
        failures++;
    }
};

async function makeProject() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'code-trail-trail-e2e-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'dispatch.cpp'), DISPATCH, 'utf8');
    for (const name of ['registry.cpp', 'registry.impl.cpp', 'registry.h']) {
        await writeFile(path.join(root, 'src', name), REGISTRY, 'utf8');
    }
    return root;
}

const root = await makeProject();

// 가짜 LSP 를 C# 아닌 C++ 서버로 등록한다. 설정은 첫 기동 때 만들어진다.
let running = await server.startServer({
    projectDirectory: root,
    logLevel: 'error',
    logWrite: () => {},
});
const settingsPath = path.join(root, '.code-trail', 'settings.json');
const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
settings.languages.cpp.executable = process.execPath;
settings.languages.cpp.args = [FAKE_LSP, '--scenario=normal'];
await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
await running.close();

running = await server.startServer({
    projectDirectory: root,
    logLevel: 'error',
    logWrite: () => {},
});

const browser = await chromium.launch({
    executablePath: process.env.CT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
});

try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
        if (m.type() === 'error') {
            errors.push(m.text());
        }
    });

    await page.goto(`${running.url}/#token=${running.token}`);
    await page.waitForSelector('.app-bar');
    await page.waitForFunction(
        () => document.querySelector('.conn')?.textContent === '연결됨',
        undefined,
        { timeout: 10000 },
    );

    console.log('\n[트레일 만들기]');
    await page.getByRole('button', { name: '＋ 새 트레일' }).click();
    await page.waitForFunction(
        () => document.querySelectorAll('.trail-pick option').length === 1,
        undefined,
        { timeout: 8000 },
    );
    check('트레일이 목록에 생겼다', (await page.locator('.trail-pick option').count()) === 1);

    console.log('\n[루트 만들기]');
    await page.locator('.tree-row', { hasText: 'src' }).first().click();
    await page.waitForSelector('button:has-text("dispatch.cpp")');
    await page.locator('button:has-text("dispatch.cpp")').click();
    await page.waitForSelector('.code-view .monaco-editor', { timeout: 15000 });

    // 식별자가 없는 줄에 커서를 두고 Ctrl+Alt+T — 감싸는 심볼이 루트가 된다.
    await page.locator('.view-line').nth(4).click();
    await page.keyboard.press('Control+Alt+KeyT');
    await page.waitForSelector('.node', { timeout: 15000 });
    check('트레일 탭으로 넘어갔다', (await page.locator('.pane-tabs .tab.active').textContent()).includes('트레일'));
    check('루트 노드가 하나 생겼다', (await page.locator('.node').count()) === 1);

    console.log('\n[헤더 구성]');
    const header = page.locator('.node > .hd').first();
    check('종류 배지', (await header.locator('.kind').textContent()) === 'method');
    check('이름', (await header.locator('.name').textContent()) === 'Find');
    check('시그니처', (await header.locator('.sig').textContent()).includes('uint16_t'));
    check('경로:줄', (await header.locator('.loc').textContent()) === 'src/dispatch.cpp:4');
    check('감싸는 클래스는 함수 노드에 안 붙는다', (await header.locator('.container').count()) === 0);
    check('⚑ 버튼이 있다', (await header.locator('[data-act="impl"]').count()) === 1);
    check('루트에는 ⇱ 가 없다', (await header.locator('[data-act="root"]').count()) === 0);

    console.log('\n[본문]');
    const NBSP = String.fromCharCode(0x00a0);
    const codeLines = async () =>
        (await page.locator('.node .code .cl .ct').allTextContents())
            .map((line) => line.split(NBSP).join(' '));
    const gutters = async () =>
        (await page.locator('.node .code .cl .no').allTextContents()).map((n) => n.trim());

    const lines = await codeLines();
    // 본문은 가짜 서버가 준 심볼 범위(3..7)다. 파일 첫 줄이 아니다.
    check('본문이 심볼 범위다', lines[0].includes('g_registry.Find'), JSON.stringify(lines[0]));
    check('들여쓰기가 살아 있다', lines.some((l) => /^\s+\S/.test(l)), JSON.stringify(lines));

    const numbers = await gutters();
    // 심볼 range 가 3..7 이므로 줄 번호는 원본 기준 4부터다.
    check('줄 번호가 원본 파일 기준이다', numbers[0] === '4', numbers.join(','));

    console.log('\n[식별자 클릭]');
    await page.locator('.node .code .tok.clickable', { hasText: 'Find' }).first().click();
    try {
        await page.waitForFunction(() => document.querySelectorAll('.node').length >= 2, undefined, {
            timeout: 15000,
        });
    } catch {
        const toast = await page.locator('.toast').count() > 0
            ? await page.locator('.toast').textContent()
            : '(토스트 없음)';
        check('자식 노드가 붙었다', false, `토스트: ${toast}`);
    }
    check('자식 노드가 붙었다', (await page.locator('.node').count()) >= 2);

    const child = page.locator('.node .kids .node').first();
    check('자식이 부모 안에 중첩됐다', (await child.count()) === 1);
    check('자식 이름', (await child.locator('> .hd .name').textContent()) === 'Find');
    check('자식 경로가 다른 파일', (await child.locator('> .hd .loc').textContent()).includes('registry.cpp'));

    console.log('\n[진입 링크와 순번]');
    const origin = await child.locator('> .origin').textContent();
    check('진입 링크가 부모 이름과 줄을 보여준다', origin.includes('Find 의') && origin.includes('4번째 줄'), origin);
    check('자식 헤더에 순번', (await child.locator('> .hd .idx').textContent()) === '①');
    const visited = page.locator('.node > .body .tok.clickable.visited').first();
    check('부모 호출부에 방문 표시', (await visited.count()) === 1);
    check('호출부 순번이 자식과 짝', (await visited.locator('.idx-mark').textContent()) === '①');

    // 부모 위·자식 아래 트리 배치를 남긴다. 승격·삭제 전 모습이다.
    const outDir = fileURLToPath(new URL('../../docs/baseline/', import.meta.url));
    await page.screenshot({ path: path.join(outDir, 'standalone-trail.png') });
    console.log('  wrote docs/baseline/standalone-trail.png');

    console.log('\n[브레드크럼]');
    await child.locator('> .hd .name').click();
    await page.waitForTimeout(300);
    const crumbs = await page.locator('#breadcrumb .crumb').allTextContents();
    check('브레드크럼에 경로가 나온다', crumbs.length >= 1, crumbs.join(' > '));

    console.log('\n[필터]');
    await page.locator('#filter').fill('registry');
    await page.waitForTimeout(200);
    check('필터가 걸려도 조상은 남는다', (await page.locator('.node').count()) === 2);
    await page.locator('#filter').fill('없는이름xyz');
    await page.waitForTimeout(200);
    check('안 걸리면 다 사라진다', (await page.locator('.node').count()) === 0);
    await page.locator('#filter').fill('');
    await page.waitForTimeout(200);

    console.log('\n[접기·펼치기]');
    await page.getByRole('button', { name: '⤡ 전체 접기' }).click();
    // 노드 하나가 아니라 전부 접혀야 한다. "전체 접기" 가 노드마다 명령을 보내는데,
    // 그중 하나라도 거절되면 여기서 걸린다.
    await page.waitForFunction(
        () => document.querySelectorAll('.node:not(.collapsed)').length === 0
            && document.querySelectorAll('.node').length > 0,
        undefined,
        { timeout: 8000 },
    );
    check('접히면 본문이 안 보인다', !(await page.locator('.node > .body').first().isVisible()));
    await page.getByRole('button', { name: '⤢ 전체 펼치기' }).click();
    await page.waitForFunction(
        () => document.querySelectorAll('.node.collapsed').length === 0,
        undefined,
        { timeout: 8000 },
    );
    check('다시 펼쳐진다', await page.locator('.node > .body').first().isVisible());

    console.log('\n[새 루트로 떼어내기]');
    await page.locator('.node .kids .node > .hd [data-act="root"]').first().click();
    await page.waitForFunction(
        () => document.querySelectorAll('#root > .node').length === 2,
        undefined,
        { timeout: 8000 },
    );
    check('루트가 둘이 됐다', (await page.locator('#root > .node').count()) === 2);
    check('떼어낸 노드에 진입 링크가 없다', (await page.locator('#root > .node').nth(1).locator('> .origin').count()) === 0);

    console.log('\n[새로고침 복원]');
    await page.reload();
    await page.waitForSelector('.app-bar');
    await page.locator('.pane-tabs .tab').nth(1).click();
    await page.waitForSelector('#root > .node', { timeout: 15000 });
    check('새로고침 후에도 노드가 남는다', (await page.locator('#root > .node').count()) === 2);

    console.log('\n[여러 탭 동기화]');
    // 두 번째 탭이 같은 서버를 본다. 한쪽에서 바꾼 것이 다른 쪽에도 즉시 와야 한다.
    const second = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await second.goto(`${running.url}/#token=${running.token}`);
    await second.waitForSelector('.app-bar');
    await second.locator('.pane-tabs .tab').nth(1).click();
    await second.waitForSelector('#root > .node', { timeout: 15000 });
    check('두 번째 탭도 같은 트리를 본다', (await second.locator('#root > .node').count()) === 2);

    // 첫 탭에서 이름을 바꾸면 두 번째 탭의 목록도 따라 바뀐다.
    await page.getByRole('button', { name: '✎ 이름' }).click();
    await page.locator('.rename input').fill('바뀐 이름');
    await page.locator('.rename button[type="submit"]').click();
    await second.waitForFunction(
        () => document.querySelector('.trail-pick option')?.textContent?.includes('바뀐 이름') === true,
        undefined,
        { timeout: 8000 },
    );
    check('이름 변경이 두 번째 탭에도 온다', true);
    await second.close();

    console.log('\n[노드 삭제]');
    await page.locator('#root > .node').nth(1).locator('> .hd [data-act="del"]').click();
    await page.waitForFunction(
        () => document.querySelectorAll('#root > .node').length === 1,
        undefined,
        { timeout: 8000 },
    );
    check('노드가 지워졌다', (await page.locator('#root > .node').count()) === 1);

    check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
} finally {
    await browser.close();
    await running.close();
    await rm(root, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
