/*
 * 기준선 스크린샷 — node test/screenshot.js
 *
 * test/preview.html 에 test/fixtures/preview-state.json 을 넣고
 * 트리 모드와 보드 모드를 docs/baseline/ 에 저장한다.
 * 독립 프로그램으로 옮긴 뒤 화면을 눈으로 대조하기 위한 자료다.
 *
 * 브라우저는 ui.test.js 와 같은 규칙으로 고른다: CT_CHROME 환경변수 우선.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'docs', 'baseline');
const state = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'preview-state.json'), 'utf8'),
);

(async () => {
    fs.mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch({
        executablePath: process.env.CT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage({
        viewport: { width: 1600, height: 1100 },
        deviceScaleFactor: 2,
    });

    await page.goto('file://' + path.join(__dirname, 'preview.html'));
    await page.evaluate((msg) => window.postMessage(msg, '*'), state);
    await page.waitForTimeout(500);

    await page.screenshot({ path: path.join(OUT, 'tree-mode.png'), fullPage: true });
    console.log('  wrote docs/baseline/tree-mode.png');

    await page.click('#btn-board');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, 'board-mode.png'), fullPage: true });
    console.log('  wrote docs/baseline/board-mode.png');

    await browser.close();
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
