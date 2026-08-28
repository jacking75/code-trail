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

const NL = String.fromCharCode(10);

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
// 폭 맞춤 하한을 눈에 띄게 올려 둔다. 아래에서 이 값에서 멈추는지 본다.
settings.ui.minFontSize = 11;
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

    console.log('\n[보드 모드]');
    const rootId = await page.locator('#root > .node').first().getAttribute('data-id');
    const childId = await page.locator('.node .kids .node').first().getAttribute('data-id');

    await page.locator('#board-toggle').click();
    await page.waitForFunction(
        () => document.querySelectorAll('#root.board > .node').length === 2,
        undefined,
        { timeout: 8000 },
    );
    // 모든 노드가 캔버스 바로 아래에 평평하게 놓인다. 중첩된 채로 절대 배치를
    // 하면 자식 좌표가 부모 기준이 되어 엉킨다.
    check('노드가 캔버스 바로 아래에 평평하게 놓인다', (await page.locator('#root.board > .node').count()) === 2);
    check('보드에서는 자식이 부모 안에 없다', (await page.locator('.kids .node').count()) === 0);
    check('부모 오른쪽 → 자식 왼쪽 연결선', (await page.locator('.board-lines path').count()) === 1);
    check(
        '보드에서도 부모-자식 관계는 그대로다',
        (await page.locator(`[data-id="${childId}"]`).getAttribute('data-parent')) === rootId,
    );

    // 자동으로 정한 자리가 서버에 저장될 때까지 기다린다.
    await page.waitForFunction(
        (id) => {
            const box = document.querySelector(`[data-id="${id}"]`);
            return box !== null && box.style.left !== '' && box.style.top !== '';
        },
        childId,
        { timeout: 8000 },
    );
    const autoPlaced = await page.locator(`[data-id="${childId}"]`).evaluate((el) => ({
        left: el.offsetLeft, top: el.offsetTop,
    }));
    const parentPlaced = await page.locator(`[data-id="${rootId}"]`).evaluate((el) => ({
        left: el.offsetLeft, width: el.offsetWidth,
    }));
    check(
        '새 자식은 부모 오른쪽에 놓인다',
        autoPlaced.left >= parentPlaced.left + parentPlaced.width,
        `자식 ${autoPlaced.left} vs 부모 오른쪽 ${parentPlaced.left + parentPlaced.width}`,
    );

    console.log('\n[헤더 끌어 옮기기]');
    const hdBox = await page.locator(`[data-id="${childId}"] > .hd`).boundingBox();
    await page.mouse.move(hdBox.x + 40, hdBox.y + hdBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(hdBox.x + 40 + 180, hdBox.y + hdBox.height / 2 + 120, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
        (args) => {
            const box = document.querySelector(`[data-id="${args.id}"]`);
            return box !== null && Math.abs(box.offsetLeft - args.left) > 100;
        },
        { id: childId, left: autoPlaced.left },
        { timeout: 8000 },
    );
    const dragged = await page.locator(`[data-id="${childId}"]`).evaluate((el) => ({
        left: el.offsetLeft, top: el.offsetTop,
    }));
    check('끌면 자리가 바뀐다', dragged.left !== autoPlaced.left && dragged.top !== autoPlaced.top);
    check('끌고 나서 접히지 않는다', (await page.locator(`[data-id="${childId}"].collapsed`).count()) === 0);
    check(
        '끌어다 놓아도 부모-자식 관계는 안 바뀐다',
        (await page.locator(`[data-id="${childId}"]`).getAttribute('data-parent')) === rootId,
    );
    check('연결선은 그대로 하나다', (await page.locator('.board-lines path').count()) === 1);

    console.log('\n[트리 복귀와 보드 재진입]');
    await page.locator('#board-toggle').click();
    await page.waitForFunction(
        () => document.querySelectorAll('#root > .node').length === 1,
        undefined,
        { timeout: 8000 },
    );
    check('트리로 돌아오면 자식이 부모 안에 다시 들어간다', (await page.locator('.node .kids .node').count()) === 1);
    check('트리 모드에는 연결선 svg 가 없다', (await page.locator('.board-lines').count()) === 0);

    await page.locator('#board-toggle').click();
    await page.waitForFunction(
        () => document.querySelectorAll('#root.board > .node').length === 2,
        undefined,
        { timeout: 8000 },
    );
    const reentered = await page.locator(`[data-id="${childId}"]`).evaluate((el) => ({
        left: el.offsetLeft, top: el.offsetTop,
    }));
    check(
        '보드에 다시 들어와도 좌표가 그대로다',
        Math.abs(reentered.left - dragged.left) <= 2 && Math.abs(reentered.top - dragged.top) <= 2,
        `${JSON.stringify(reentered)} vs ${JSON.stringify(dragged)}`,
    );

    console.log('\n[노드별 손조절]');
    // 사용자가 본문 모서리를 끌면 브라우저가 inline height 를 박는다. 그것과 같다.
    await page.locator(`[data-id="${rootId}"] > .body`).evaluate((el) => {
        el.style.height = '90px';
    });
    await page.waitForTimeout(600);

    // Ctrl+휠 — 그 노드의 코드 글자 크기만 바꾼다.
    const otherFontBefore = await page
        .locator(`[data-id="${childId}"] .code`)
        .evaluate((el) => getComputedStyle(el).fontSize);
    // 지금 크기는 폭 맞춤이 정한 값이다. 12px 이라고 가정하면 안 된다.
    const rootFontBefore = await page
        .locator(`[data-id="${rootId}"] .code`)
        .evaluate((el) => getComputedStyle(el).fontSize);
    await page.locator(`[data-id="${rootId}"] .code`).hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.waitForFunction(
        (id) => {
            const code = document.querySelector(`[data-id="${id}"] .code`);
            return code !== null && code.style.fontSize !== '';
        },
        rootId,
        { timeout: 8000 },
    );
    const bumped = await page
        .locator(`[data-id="${rootId}"] .code`)
        .evaluate((el) => el.style.fontSize);
    check(
        'Ctrl+휠 로 그 노드의 코드 글자가 한 단계 커진다',
        parseFloat(bumped) === Math.round(parseFloat(rootFontBefore)) + 1,
        `${rootFontBefore} → ${bumped}`,
    );
    check(
        '다른 노드는 그대로다',
        (await page.locator(`[data-id="${childId}"] .code`)
            .evaluate((el) => getComputedStyle(el).fontSize)) === otherFontBefore,
    );

    console.log('\n[서버 재시작 후 좌표 복원]');
    const beforeRestart = await page.locator(`[data-id="${childId}"]`).evaluate((el) => ({
        left: el.offsetLeft, top: el.offsetTop,
    }));
    // 서버를 닫기 전에 페이지를 비운다. 안 그러면 날아가던 요청이 끊기고
    // 콘솔에 네트워크 오류가 남는다 — 그건 우리가 보려는 오류가 아니다.
    await page.goto('about:blank');
    await running.close();
    running = await server.startServer({
        projectDirectory: root,
        logLevel: 'error',
        logWrite: () => {},
    });
    await page.goto(`${running.url}/#token=${running.token}`);
    await page.waitForSelector('.app-bar');
    await page.locator('.pane-tabs .tab').nth(1).click();
    await page.waitForSelector('#root.board > .node', { timeout: 15000 });
    check('서버를 다시 띄워도 보드 모드가 유지된다', (await page.locator('#root.board').count()) === 1);
    const afterRestart = await page.locator(`[data-id="${childId}"]`).evaluate((el) => ({
        left: el.offsetLeft, top: el.offsetTop,
    }));
    check(
        '서버를 다시 띄워도 보드 좌표가 그대로다',
        Math.abs(afterRestart.left - beforeRestart.left) <= 2
            && Math.abs(afterRestart.top - beforeRestart.top) <= 2,
        `${JSON.stringify(afterRestart)} vs ${JSON.stringify(beforeRestart)}`,
    );
    check(
        '본문 높이도 남는다',
        (await page.locator(`[data-id="${rootId}"] > .body`).evaluate((el) => el.style.height)) === '90px',
    );
    check(
        '노드별 코드 글자 크기도 남는다',
        (await page.locator(`[data-id="${rootId}"] .code`).evaluate((el) => el.style.fontSize)) === bumped,
    );

    console.log('\n[줄 번호 더블클릭 초기화]');
    await page.locator(`[data-id="${rootId}"] .code .cl .no`).first().dblclick();
    await page.waitForFunction(
        (id) => {
            const box = document.querySelector(`[data-id="${id}"]`);
            const code = box?.querySelector('.code');
            const body = box?.querySelector(':scope > .body');
            return code !== null && body !== null
                && code.style.fontSize === '' && body.style.height === '';
        },
        rootId,
        { timeout: 8000 },
    );
    check('더블클릭하면 높이와 글자 크기가 원래대로 돌아온다', true);

    // 트리 모드로 돌려놓는다. 아래 검사들은 부모 안에 중첩된 자식을 본다.
    await page.locator('#board-toggle').click();
    await page.waitForFunction(
        () => document.querySelectorAll('#root > .node').length === 1
            && document.querySelectorAll('.node .kids .node').length === 1,
        undefined,
        { timeout: 8000 },
    );

    console.log('\n[코드 폭 맞춤]');
    const measure = () => page.evaluate(() => ({
        code: getComputedStyle(document.querySelector('.node .code')).fontSize,
        header: getComputedStyle(document.querySelector('.node .hd .name')).fontSize,
    }));
    const wide = await measure();
    await page.setViewportSize({ width: 520, height: 950 });
    await page.waitForTimeout(500);
    const narrow = await measure();
    check(
        '폭이 좁아지면 코드 글자가 줄어든다',
        parseFloat(narrow.code) < parseFloat(wide.code),
        `${wide.code} → ${narrow.code}`,
    );
    check(
        '폭 맞춤이 헤더 글자는 줄이지 않는다',
        narrow.header === wide.header,
        `${wide.header} → ${narrow.header}`,
    );
    check(
        'minFontSize 아래로는 줄이지 않는다',
        parseFloat(narrow.code) >= 11,
        `${narrow.code} (하한 11px)`,
    );
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.waitForTimeout(500);
    const backWide = await measure();
    check('넓히면 원래 크기로 돌아온다', backWide.code === wide.code, `${narrow.code} → ${backWide.code}`);

    console.log(`${NL}[fontSize 를 지정하면 폭 맞춤보다 우선]`);
    await page.goto('about:blank');
    await running.close();
    {
        const raw = JSON.parse(await readFile(settingsPath, 'utf8'));
        raw.ui.fontSize = 20;
        await writeFile(settingsPath, `${JSON.stringify(raw, null, 2)}${NL}`, 'utf8');
    }
    running = await server.startServer({
        projectDirectory: root,
        logLevel: 'error',
        logWrite: () => {},
    });
    await page.goto(`${running.url}/#token=${running.token}`);
    await page.waitForSelector('.app-bar');
    await page.locator('.pane-tabs .tab').nth(1).click();
    await page.waitForSelector('#root > .node', { timeout: 15000 });
    await page.waitForFunction(
        () => getComputedStyle(document.querySelector('.node .code')).fontSize === '20px',
        undefined,
        { timeout: 8000 },
    );
    const forced = await measure();
    check('수동 지정이 폭 맞춤을 이긴다', forced.code === '20px', forced.code);
    check('수동 지정도 헤더 글자는 건드리지 않는다', forced.header === wide.header,
        `${wide.header} → ${forced.header}`);

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

    console.log(`${NL}[진단 화면]`);
    await page.locator('.pane-tabs .tab', { hasText: '진단' }).click();
    await page.waitForFunction(
        () => document.querySelectorAll('.diag-card[data-language]').length === 4,
        undefined,
        { timeout: 10000 },
    );
    check('네 언어 카드가 다 나온다', (await page.locator('.diag-card[data-language]').count()) === 4);

    const cpp = page.locator('.diag-card[data-language="cpp"]');
    const cppText = await cpp.textContent();
    check('실행 파일과 프로세스 상태를 보여준다', cppText.includes('실행 파일') && cppText.includes('프로세스'));
    check('초기화 시간과 capability 를 보여준다', cppText.includes('초기화') && cppText.includes('capability'));
    check('확인 전에는 지원됨이 아니다', (await cpp.locator('.badge.decl').count()) >= 1);

    // `지원됨` 은 프로세스가 떴다는 뜻이 아니라 실제 요청이 응답했다는 뜻이다.
    await cpp.getByRole('button', { name: '✓ 확인' }).click();
    await page.waitForFunction(
        () => document.querySelector('.diag-card[data-language="cpp"] .badge.ok')?.textContent
            === '지원됨',
        undefined,
        { timeout: 15000 },
    );
    check('샘플 요청이 응답하면 지원됨이 된다', true);
    check('PID 가 찍힌다', (await cpp.textContent()).includes('PID'));

    await cpp.getByRole('button', { name: '로그 보기' }).click();
    await page.waitForSelector('.diag-card[data-language="cpp"] .diag-log', { timeout: 8000 });
    const logText = await cpp.locator('.diag-log').textContent();
    check('로그에 세션 토큰이 안 섞인다', !logText.includes(running.token));

    const editorCard = page.locator('#diag-editor');
    check('외부 에디터 카드가 있다', (await editorCard.count()) === 1);
    check(
        '에디터를 정하기 전에는 설정 없음이다',
        (await editorCard.locator('.badge.decl').textContent()) === '설정 없음',
    );

    console.log(`${NL}[외부 에디터 실패 폴백]`);
    await page.locator('.pane-tabs .tab').nth(1).click();
    await page.waitForSelector('#root > .node', { timeout: 8000 });
    await page.locator('#root > .node > .hd [data-act="open"]').first().click();
    await page.waitForSelector('.editor-fallback', { timeout: 8000 });
    const fallback = await page.locator('.editor-fallback').textContent();
    check('못 열면 이유와 경로·줄을 보여준다', fallback.includes('설정되지 않았다')
        && /registry|dispatch/.test(fallback), fallback);
    check('복사 버튼이 있다', (await page.locator('.editor-fallback button', { hasText: '경로·줄 복사' }).count()) === 1);
    await page.locator('.editor-fallback button.danger').click();

    check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
} finally {
    await browser.close();
    await running.close();
    await rm(root, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
