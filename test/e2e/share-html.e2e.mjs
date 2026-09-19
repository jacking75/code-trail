/* 정적 HTML 공유 산출물을 설치·서버·네트워크 없이 실제 브라우저에서 읽는다. */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const { SharingService } = await import('../../packages/server/dist/sharing/service.js');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'code-trail-static-share-'));
const output = path.join(temporary, '공유 검토.html');
const exists = (file) => stat(file).then(() => true, () => false);

const candidates = [
    ['Chrome', process.env.CT_CHROME || (process.platform === 'win32'
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')],
    ['Edge', process.env.CT_EDGE || (process.platform === 'win32'
        ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        : '')],
];

try {
    const service = new SharingService(undefined, undefined, '정적 검사', '1.1.0');
    const text = await readFile(new URL('../../examples/first-review.ctshare.json', import.meta.url), 'utf8');
    const bundle = service.parse(text);
    bundle.analysis.title = '<script>정적 공유 제목</script>';
    bundle.analysis.annotations[0].body = `<img src=x onerror="globalThis.__executed=true">${'긴 본문 '.repeat(2_000)}`;
    await writeFile(output, service.staticHtml(bundle), 'utf8');

    let checked = 0;
    for (const [name, executablePath] of candidates) {
        if (!executablePath || !(await exists(executablePath))) {
            console.log(`  건너뜀 — ${name} 실행 파일이 없다.`);
            continue;
        }
        const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
        try {
            const page = await browser.newPage();
            const externalRequests = [];
            const consoleErrors = [];
            page.on('request', (request) => {
                if (/^https?:/i.test(request.url())) externalRequests.push(request.url());
            });
            page.on('pageerror', (error) => consoleErrors.push(String(error)));
            await page.goto(pathToFileURL(output).href);
            if ((await page.locator('article').count()) !== 1) throw new Error(`${name}: 분석 기록이 보이지 않는다.`);
            if ((await page.locator('ol li').count()) !== 1) throw new Error(`${name}: 안내 순서가 보이지 않는다.`);
            const recordLink = page.getByRole('link', { name: '연결된 기록' });
            if ((await recordLink.count()) !== 1) throw new Error(`${name}: 안내 단계의 기록 링크가 없다.`);
            await recordLink.click();
            if (!page.url().includes(`bundle=${bundle.bundleId}`) || !page.url().includes('annotation=')) {
                throw new Error(`${name}: 묶음·기록 ID 내부 링크가 아니다.`);
            }
            if ((await page.locator('article:target').count()) !== 1) throw new Error(`${name}: 링크가 기록으로 이동하지 않았다.`);
            if ((await page.locator('script').count()) !== 0 || await page.evaluate(() => globalThis.__executed === true)) {
                throw new Error(`${name}: 공유 본문의 코드가 실행됐다.`);
            }
            // 코드는 트리 구조를 지킨다(V23). 평평하게 늘어놓으면 "무엇에서
            // 무엇으로 들어갔는지" 가 사라져 코드 조각 목록이 된다.
            const nested = await page.locator('details details').count();
            const total = await page.locator('details').count();
            if (total > 1 && nested === 0) throw new Error(`${name}: 코드가 평평하게 나열됐다.`);
            if (nested > 0) {
                const ordinal = await page.locator('details details > summary').first().textContent();
                if (!/^[①-⑳(]/.test(ordinal.trim())) {
                    throw new Error(`${name}: 자식 코드에 순번이 없다 — ${ordinal}`);
                }
            }
            if (externalRequests.length > 0) throw new Error(`${name}: 외부 통신이 발생했다.`);
            if (consoleErrors.length > 0) throw new Error(`${name}: 페이지 오류가 발생했다.`);
            console.log(`  ok   ${name}에서 독립 정적 HTML·긴 본문·안내 순서·실행 차단을 확인했다.`);
            checked += 1;
        } finally {
            await browser.close();
        }
    }
    if (checked === 0) throw new Error('정적 HTML을 확인할 브라우저가 없다.');
    console.log(checked > 1 ? 'ALL PASS (여러 브라우저)' : 'ALL PASS (브라우저 1개, 나머지는 건너뜀)');
} finally {
    await rm(temporary, { recursive: true, force: true });
}
