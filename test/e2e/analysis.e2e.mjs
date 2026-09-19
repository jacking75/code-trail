/*
 * 분석 기록 E2E — node test/e2e/analysis.e2e.mjs
 *
 * 작성·답글·삭제 복구·코드 비교·내부 링크·검색·공유 미리보기·재시작 복원에 더해
 * 기록을 코드 옆에 붙이는 흐름을 확인한다 — 선택 칩(U04), 노드 헤더의 기록
 * 배지(U10), 분석 자동 생성(U11), 기록 열(U12), 인라인 편집(U13).
 *
 * 가짜 언어 서버를 붙여야 노드가 생긴다. 기록은 노드 옆에 붙는 것이 요점이라
 * 노드 없는 화면으로는 그 흐름을 시험할 수 없다.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const server = await import('../../packages/server/dist/index.js');
const { contextForRange, createBaselineFile, sha256 } = await import('../../packages/server/dist/analysis/baselines.js');
const FAKE_LSP = fileURLToPath(new URL('../fake-lsp/server.mjs', import.meta.url));

// 가짜 서버가 돌려주는 심볼 범위(3..7)에 맞춰 10줄로 둔다.
const SAMPLE = [
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

const root = await mkdtemp(path.join(os.tmpdir(), 'code-trail-analysis-e2e-'));
await mkdir(path.join(root, 'src'), { recursive: true });
// clangd 자리에 가짜 서버를 끼운다. TypeScript 어댑터는 `--stdio` 를 앞에
// 붙이므로 Node 를 그대로 띄울 수 없다.
await writeFile(path.join(root, 'src', 'sample.cpp'), SAMPLE, 'utf8');

let running = await server.startServer({ projectDirectory: root, logLevel: 'error', logWrite: () => {} });
{
    const localPath = path.join(root, '.code-trail', 'local', 'settings.json');
    const local = JSON.parse(await readFile(localPath, 'utf8'));
    local.languages.cpp.executable = process.execPath;
    local.languages.cpp.args = [FAKE_LSP, '--scenario=normal'];
    await writeFile(localPath, `${JSON.stringify(local, null, 2)}\n`, 'utf8');
    await running.close();
    running = await server.startServer({ projectDirectory: root, logLevel: 'error', logWrite: () => {} });
}

const browser = await chromium.launch({
    executablePath: process.env.CT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
});

try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    const dialogs = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    // `window.prompt` 가 남아 있으면 여기서 잡힌다(U13).
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });

    await page.goto(`${running.url}/#token=${running.token}`);
    await page.waitForSelector('.app-bar');

    console.log('\n[루트 만들기]');
    await page.locator('.tree-row', { hasText: 'src' }).first().click();
    await page.waitForSelector('button:has-text("sample.cpp")');
    await page.locator('button:has-text("sample.cpp")').click();
    await page.waitForSelector('.code-view .monaco-editor', { timeout: 15000 });
    await page.locator('.view-line').nth(4).click();
    await page.keyboard.press('Control+Alt+KeyT');
    await page.waitForSelector('.node', { timeout: 15000 });
    check('노드가 하나 생겼다', (await page.locator('.node').count()) === 1);

    console.log('\n[분석 없이 첫 기록]');
    // "분석을 먼저 만드세요" 단계를 없앴다(U11). 작성 칸은 분석이 없어도 보인다.
    await page.getByRole('button', { name: /^분석 기록/ }).click();
    await page.waitForSelector('.annotation-composer');
    check(
        '분석이 없어도 작성 칸이 보인다',
        (await page.locator('.analysis-head .save-state').textContent()).includes('분석 없음'),
    );

    await page.locator('.annotation-composer select').nth(1).selectOption('question');
    const composer = page.getByPlaceholder('설명·질문·우려·결론을 남긴다. Ctrl+Enter로 저장한다.');
    await composer.fill('재시작 뒤에도 이 질문이 남는가?');
    await composer.press('Control+Enter');
    await page.waitForFunction(() => document.querySelectorAll('.annotation-item').length === 1,
        undefined, { timeout: 15000 });
    check('저장하면 분석이 따라 만들어진다', (await page.locator('.annotation-item').count()) === 1);
    await page.waitForFunction(
        () => document.querySelector('.analysis-purpose strong')?.textContent === 'Find',
        undefined,
        { timeout: 8000 },
    );
    check('분석 제목이 트레일 이름이다', true);
    await page.waitForFunction(
        () => document.querySelector('.analysis-head .save-state')
            ?.textContent?.includes('디스크 저장됨') === true,
        undefined,
        { timeout: 8000 },
    );

    await page.getByRole('button', { name: '답글' }).click();
    await page.locator('.reply-form textarea').fill('디스크 정본을 다시 읽어 확인한다.');
    await page.getByRole('button', { name: '답글 저장' }).press('Enter');
    await page.waitForSelector('.annotation-item blockquote');

    await composer.fill('지워질 초안');
    await composer.press('Escape');
    check('Esc 가 작성 입력을 비운다', (await composer.inputValue()) === '');

    console.log('\n[선택 칩]');
    // 본문에서 글자를 끌어도 탭이 바뀌지 않는다(U04). 코드 한 줄을 복사하려던
    // 것일 수 있다.
    await page.locator('.pane-tabs .tab', { hasText: '트레일' }).click();
    await page.waitForSelector('.node .code .cl .ct', { timeout: 8000 });
    const line = page.locator('.node .code .cl').first().locator('.ct');
    const box = await line.boundingBox();
    await page.mouse.move(box.x + 3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForSelector('.selection-chip', { timeout: 8000 });
    check('끌면 칩이 뜬다', (await page.locator('.selection-chip').count()) === 1);
    check(
        '끌어도 탭이 그대로다',
        (await page.locator('.pane-tabs .tab.active').textContent()).includes('트레일'),
    );

    // `＋ 기록` 은 탭을 바꾸지 않고 그 자리에 기록 열을 연다(V16).
    // 코드를 떠나야 기록할 수 있으면 읽던 흐름이 끊긴다.
    await page.locator('.selection-chip button', { hasText: '＋ 기록' }).click();
    await page.waitForSelector('.annotation-column', { timeout: 8000 });
    check(
        '기록 열이 열려도 탭은 그대로다',
        (await page.locator('.pane-tabs .tab.active').textContent()).includes('트레일'),
    );
    const targetValue = await page.locator('.annotation-column .annotation-composer select').first().inputValue();
    check('대상이 선택한 코드 범위로 잡힌다', targetValue === 'range', targetValue);
    check(
        '어느 줄인지 보여준다',
        /src\/sample\.cpp:\d+/.test(await page.locator('.composer-target').first().textContent()),
        await page.locator('.composer-target').first().textContent(),
    );

    await composer.fill('이 줄의 범위를 기록한다.');
    await composer.press('Control+Enter');
    await page.locator('.pane-tabs .tab', { hasText: '분석 기록' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.annotation-item').length === 2,
        undefined, { timeout: 15000 });
    check('범위 기록이 저장된다', (await page.locator('.annotation-item').count()) === 2);

    console.log('\n[노드에 붙는 기록 표시]');
    await page.locator('.pane-tabs .tab', { hasText: '트레일' }).click();
    // 기록 열은 열려 있다. 배지 확인은 헤더 쪽이므로 그대로 둔다.

    await page.waitForSelector('.node .hd .badge.notes', { timeout: 8000 });
    check('헤더에 기록 수 배지가 붙는다',
        (await page.locator('.node .hd .badge.notes').textContent()).includes('1'));
    check('그 줄에 색 띠가 생긴다', (await page.locator('.node .code .cl.noted').count()) >= 1);
    check('툴바가 기록 수를 센다',
        (await page.locator('#toolbar').textContent()).includes('기록'));

    console.log('\n[기록 열]');
    // 노드를 보면서 바로 옆에서 기록을 읽고 쓴다(U12).
    // 배지는 열을 여는 것만이 아니라 활성 노드를 그 노드로 옮긴다.
    await page.locator('.node .hd .badge.notes').click();
    await page.waitForSelector('.annotation-column', { timeout: 8000 });
    check('배지를 누르면 열이 열린다', (await page.locator('.annotation-column').count()) === 1);
    // 활성 노드는 서버가 정한다. 명령을 보내고 이벤트를 받아서 바뀌므로 기다린다.
    await page.waitForFunction(
        () => document.querySelectorAll('.annotation-column .annotation-item').length >= 1,
        undefined,
        { timeout: 8000 },
    );
    check('그 노드의 기록이 보인다',
        (await page.locator('.annotation-column .annotation-item').count()) >= 1);
    await page.locator('.annotation-column-head button').click();
    await page.waitForFunction(
        () => document.querySelector('.annotation-column') === null,
        undefined,
        { timeout: 8000 },
    );
    check('닫으면 트리가 폭을 되찾는다', (await page.locator('.annotation-column').count()) === 0);

    console.log('\n[인라인 편집]');
    await page.locator('.pane-tabs .tab', { hasText: '분석 기록' }).click();
    await page.waitForSelector('.annotation-item');
    const edited = page.locator('.annotation-item').filter({ hasText: '이 줄의 범위를 기록한다.' });
    await edited.getByRole('button', { name: '수정' }).click();
    await page.waitForSelector('.annotation-item.editing textarea', { timeout: 8000 });
    const multiline = '첫 줄\n둘째 줄\n셋째 줄';
    await page.locator('.annotation-item.editing textarea').fill(multiline);
    await page.locator('.annotation-item.editing textarea').press('Control+Enter');
    await page.waitForFunction(
        () => document.querySelector('.annotation-item.editing') === null,
        undefined,
        { timeout: 8000 },
    );
    const savedBody = await page.locator('.annotation-item p').filter({ hasText: '셋째 줄' }).textContent();
    check('여러 줄 기록이 줄바꿈을 잃지 않는다', savedBody === multiline, JSON.stringify(savedBody));
    check('window.prompt 를 쓰지 않는다', dialogs.length === 0, dialogs.join(' | '));

    console.log('\n[코드 비교와 내부 링크]');
    const analysisId = running.context.analyses.list()[0].id;
    const grant = await running.context.documents.grantInsideProject('src/sample.cpp');
    const source = await running.context.documents.read(grant.documentId);
    const range = { start: { line: 0, char: 0 }, end: { line: 0, char: 'class HandlerRegistry {'.length } };
    const selected = contextForRange(source.text, range);
    const { baseline, fileId } = createBaselineFile({ relPath: 'src/sample.cpp', contentHash: source.contentHash });
    await running.context.analyses.addBaseline({ analysisId, commandId: crypto.randomUUID(), baseline });
    const anchor = await running.context.analyses.addAnchor({
        analysisId, commandId: crypto.randomUUID(), baselineId: baseline.id, fileId, range,
        selectedText: selected.selectedText, selectedTextHash: sha256(selected.selectedText),
        contextBefore: selected.before, contextBeforeHash: selected.before ? sha256(selected.before) : null,
        contextAfter: selected.after, contextAfterHash: selected.after ? sha256(selected.after) : null,
    });
    await running.context.analyses.createAnnotation({
        analysisId, commandId: crypto.randomUUID(), target: { kind: 'range', anchorId: anchor.value.result },
        body: '클래스 선언 범위를 확인한다.', kind: 'explanation', tags: ['범위'],
        author: { id: crypto.randomUUID(), displayName: '범위 검토자' },
    });
    await page.reload();
    await page.waitForSelector('.app-bar');
    await page.getByRole('button', { name: /^분석 기록/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.annotation-item').length === 3,
        undefined, { timeout: 15000 });

    const rangeRecord = page.locator('.annotation-item').filter({ hasText: '클래스 선언 범위' });
    await rangeRecord.getByRole('button', { name: '코드 비교' }).click();
    await page.waitForSelector('.anchor-comparison');
    const compared = await page.locator('.anchor-comparison pre').allTextContents();
    check(
        '이전·현재 코드가 같게 보인다',
        compared.length === 2 && compared.every((value) => value === 'class HandlerRegistry {'),
        JSON.stringify(compared),
    );
    await rangeRecord.getByRole('link', { name: '기록 링크' }).click();
    check(
        '기록 링크가 ID 는 담고 토큰은 안 담는다',
        page.url().includes('analysis=') && page.url().includes('annotation=')
            && !page.url().includes('token='),
        page.url(),
    );

    console.log('\n[기록에서 코드로]');
    // 헤더의 대상이 링크다. 예전에는 "코드 범위" 라는 글자뿐이었다(U13).
    await rangeRecord.locator('.target-link').first().click();
    await page.waitForFunction(
        () => document.querySelector('.pane-tabs .tab.active')?.textContent === '코드',
        undefined,
        { timeout: 8000 },
    );
    check('대상 링크가 코드 화면으로 데려간다', true);
    await page.getByRole('button', { name: /^분석 기록/ }).click();

    await page.getByRole('button', { name: '현재 기록 순서로 만들기' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.walkthrough-row').length === 3,
        undefined, { timeout: 8000 });
    check('안내 단계 링크가 만들어진다',
        (await page.getByRole('link', { name: '단계 링크' }).count()) === 3);

    console.log('\n[기록 거르기 (V15)]');
    await page.locator('.pane-tabs .tab', { hasText: '분석 기록' }).click();
    await page.waitForSelector('.annotation-item', { timeout: 8000 });
    const allItems = await page.locator('.annotation-item').count();
    await page.locator('.annotation-tools select[aria-label="대상 거르기"]').selectOption('range');
    await page.waitForTimeout(250);
    const rangeOnly = await page.locator('.annotation-item').count();
    check('대상으로 거른다', rangeOnly < allItems && rangeOnly >= 1, `${allItems} → ${rangeOnly}`);
    await page.locator('.annotation-tools select[aria-label="대상 거르기"]').selectOption('all');
    await page.waitForTimeout(250);

    await page.locator('.annotation-tools select[aria-label="정렬"]').selectOption('location');
    await page.waitForTimeout(250);
    check('위치순으로 세운다', (await page.locator('.annotation-item').count()) === allItems);
    await page.locator('.annotation-tools label', { hasText: '파일별 묶기' }).locator('input').check();
    await page.waitForSelector('.annotation-group-head', { timeout: 8000 });
    check('파일별로 묶인다', (await page.locator('.annotation-group-head').count()) >= 1);
    await page.locator('.annotation-tools label', { hasText: '파일별 묶기' }).locator('input').uncheck();
    await page.locator('.annotation-tools select[aria-label="정렬"]').selectOption('recent');
    await page.waitForTimeout(250);

    // 다른 분석의 기록까지 찾는다.
    await page.locator('.annotation-global input').fill('범위를 기록한다');
    await page.locator('.annotation-global button[type="submit"]').click();
    await page.waitForSelector('.annotation-global-results li', { timeout: 8000 });
    check('모든 분석에서 찾는다',
        (await page.locator('.annotation-global-results li').count()) >= 1);
    await page.locator('.annotation-global button', { hasText: '닫기' }).click();

    console.log('\n[안내 순서 다듬기와 따라 읽기 (V13 · V14)]');
    await page.locator('.walkthrough-section button', { hasText: '현재 기록 순서로 만들기' }).click();
    await page.waitForSelector('.walkthrough-row', { timeout: 8000 });
    const steps = await page.locator('.walkthrough-row').count();
    check('기록 순서로 단계가 만들어진다', steps >= 2, String(steps));

    // 제목을 고친다. 설명하기 좋은 순서로 다듬을 수 있어야 한다.
    await page.locator('.walkthrough-row button[aria-label="단계 수정"]').first().click();
    await page.waitForSelector('.walkthrough-row .inline-edit input', { timeout: 8000 });
    await page.locator('.walkthrough-row .inline-edit input').fill('여기서부터 읽는다');
    await page.locator('.walkthrough-row .inline-edit button[type="submit"]').click();
    await page.waitForFunction(
        () => (document.querySelector('.walkthrough-row')?.textContent ?? '').includes('여기서부터 읽는다'),
        undefined,
        { timeout: 8000 },
    );
    check('단계 제목을 고칠 수 있다', true);

    // 단계를 지운다. 확인 없이 지우고 되돌리기로 되살린다.
    await page.locator('.walkthrough-row button[aria-label="단계 지우기"]').first().click();
    await page.waitForFunction(
        (before) => document.querySelectorAll('.walkthrough-row').length === before - 1,
        steps,
        { timeout: 12000 },
    );
    check('단계를 지운다', (await page.locator('.walkthrough-row').count()) === steps - 1);

    await page.locator('.walkthrough-section button', { hasText: '따라 읽기' }).first().click();
    await page.waitForSelector('.walkthrough-player', { timeout: 8000 });
    const first = await page.locator('.walkthrough-count').textContent();
    check('막대가 몇 번째인지 보여준다', /^1\//.test(first), first);
    if (steps - 1 >= 2) {
        await page.locator('.walkthrough-player button', { hasText: '다음' }).click();
        await page.waitForFunction(
            () => document.querySelector('.walkthrough-count')?.textContent?.startsWith('2/') === true,
            undefined,
            { timeout: 8000 },
        );
        check('다음 으로 단계가 넘어간다', true);
    }
    await page.locator('.walkthrough-player button[aria-label="따라 읽기 끝내기"]').click();
    await page.waitForFunction(
        () => document.querySelector('.walkthrough-player') === null,
        undefined,
        { timeout: 8000 },
    );
    check('× 로 끝낸다', (await page.locator('.walkthrough-player').count()) === 0);

    console.log('\n[검색과 공유]');
    // 따라 읽기가 단계의 대상으로 데려갔다. 분석 화면으로 돌아온다.
    await page.locator('.pane-tabs .tab', { hasText: '분석 기록' }).click();
    await page.waitForSelector('.annotation-tools', { timeout: 8000 });
    const search = page.getByPlaceholder('기록 본문·태그 검색');
    await search.fill('없는 내용');
    await page.waitForSelector('.annotation-list .muted');
    await search.fill('재시작');
    await page.waitForSelector('.annotation-item');
    await search.fill('');

    await page.getByRole('button', { name: '공유 내용 확인' }).click();
    await page.waitForSelector('.share-preview');
    check('공유 미리보기가 기록 수를 센다',
        (await page.locator('.share-preview').textContent()).includes('기록 3'));
    check(
        '분석 화면에 가로 오버플로가 없다',
        !(await page.evaluate(() =>
            document.documentElement.scrollWidth > document.documentElement.clientWidth)),
    );

    console.log('\n[재시작 복원]');
    await page.goto('about:blank');
    await running.close();
    running = await server.startServer({ projectDirectory: root, logLevel: 'error', logWrite: () => {} });
    await page.goto(`${running.url}/#token=${running.token}`);
    await page.waitForSelector('.app-bar');
    await page.getByRole('button', { name: /^분석 기록/ }).click();
    await page.waitForSelector('.annotation-item');
    check(
        '재시작 뒤에도 기록이 남는다',
        (await page.locator('.annotation-item').allTextContents())
            .some((text) => text.includes('재시작 뒤에도')),
    );

    check('페이지 에러 없음', errors.length === 0, errors.join(' | '));
    console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`);
} finally {
    await browser.close();
    await running.close();
    await rm(root, { recursive: true, force: true });
}

process.exit(failures === 0 ? 0 : 1);
