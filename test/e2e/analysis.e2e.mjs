/* 분석 기록의 작성·복구·공유 핵심 흐름을 진짜 서버와 브라우저로 확인한다. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const server = await import('../../packages/server/dist/index.js');
const { contextForRange, createBaselineFile, sha256 } = await import('../../packages/server/dist/analysis/baselines.js');
const root = await mkdtemp(path.join(os.tmpdir(), 'code-trail-analysis-e2e-'));
await writeFile(path.join(root, 'sample.ts'), 'const value = 42;\n', 'utf8');
let running = await server.startServer({ projectDirectory: root, logLevel: 'error', logWrite: () => {} });
const browser = await chromium.launch({
    executablePath: process.env.CT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
});

try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${running.url}/#token=${running.token}`);
    await page.waitForSelector('.app-bar');
    await page.getByRole('button', { name: '＋ 새 트레일' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.trail-pick option').length === 1);

    await page.getByRole('button', { name: /^분석 기록/ }).click();
    await page.getByPlaceholder('분석 제목').fill('키보드 검토');
    await page.getByPlaceholder('읽기 목표와 확인할 질문').fill('저장과 공유 흐름을 확인한다.');
    await page.getByRole('button', { name: '새 분석 만들기' }).click();
    await page.waitForSelector('.annotation-composer');

    await page.locator('.annotation-composer select').nth(1).selectOption('question');
    const composer = page.getByPlaceholder('설명·질문·우려·결론을 남긴다. Ctrl+Enter로 저장한다.');
    await composer.fill('재시작 뒤에도 이 질문이 남는가?');
    await composer.press('Control+Enter');
    await page.waitForFunction(() => document.querySelectorAll('.annotation-item').length === 1);
    await page.waitForFunction(() => document.querySelector('.save-state')?.textContent?.includes('디스크 저장됨'));

    await page.getByRole('button', { name: '답글' }).click();
    await page.locator('.reply-form textarea').fill('디스크 정본을 다시 읽어 확인한다.');
    await page.getByRole('button', { name: '답글 저장' }).press('Enter');
    await page.waitForSelector('.annotation-item blockquote');

    await composer.fill('지워질 초안');
    await composer.press('Escape');
    if (await composer.inputValue() !== '') throw new Error('Esc가 작성 입력을 취소하지 못했다.');

    await page.getByRole('button', { name: '삭제' }).click();
    await page.getByRole('checkbox', { name: '삭제 포함' }).check();
    await page.waitForSelector('.annotation-item.deleted');
    await page.getByRole('button', { name: '복원' }).click();
    await page.waitForSelector('.annotation-item:not(.deleted)');

    const analysisId = running.context.analyses.list()[0].id;
    const grant = await running.context.documents.grantInsideProject('sample.ts');
    const source = await running.context.documents.read(grant.documentId);
    const range = { start: { line: 0, char: 0 }, end: { line: 0, char: 'const value = 42;'.length } };
    const selected = contextForRange(source.text, range);
    const { baseline, fileId } = createBaselineFile({ relPath: 'sample.ts', contentHash: source.contentHash });
    await running.context.analyses.addBaseline({ analysisId, commandId: crypto.randomUUID(), baseline });
    const anchor = await running.context.analyses.addAnchor({
        analysisId, commandId: crypto.randomUUID(), baselineId: baseline.id, fileId, range,
        selectedText: selected.selectedText, selectedTextHash: sha256(selected.selectedText),
        contextBefore: selected.before, contextBeforeHash: selected.before ? sha256(selected.before) : null,
        contextAfter: selected.after, contextAfterHash: selected.after ? sha256(selected.after) : null,
    });
    await running.context.analyses.createAnnotation({
        analysisId, commandId: crypto.randomUUID(), target: { kind: 'range', anchorId: anchor.value.result },
        body: '상수 반환 범위를 확인한다.', kind: 'explanation', tags: ['범위'],
        author: { id: crypto.randomUUID(), displayName: '범위 검토자' },
    });
    await page.reload();
    await page.waitForSelector('.app-bar');
    await page.getByRole('button', { name: /^분석 기록/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.annotation-item').length === 2);
    await page.getByRole('button', { name: '코드 비교' }).click();
    await page.waitForSelector('.anchor-comparison');
    const compared = await page.locator('.anchor-comparison pre').allTextContents();
    if (compared.length !== 2 || compared.some((value) => value !== 'const value = 42;')) {
        throw new Error(`이전·현재 코드 비교가 다르다: ${JSON.stringify(compared)}`);
    }
    const rangeRecord = page.locator('.annotation-item').filter({ hasText: '상수 반환 범위' });
    await rangeRecord.getByRole('link', { name: '기록 링크' }).click();
    if (!page.url().includes('analysis=') || !page.url().includes('annotation=') || page.url().includes('token=')) {
        throw new Error('기록 내부 링크의 ID 또는 토큰 경계가 잘못됐다.');
    }
    await page.getByRole('button', { name: '현재 기록 순서로 만들기' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.walkthrough-row').length === 2);
    if ((await page.getByRole('link', { name: '단계 링크' }).count()) !== 2) {
        throw new Error('안내 단계 내부 링크가 만들어지지 않았다.');
    }

    const search = page.getByPlaceholder('기록 본문·태그 검색');
    await search.fill('없는 내용');
    await page.waitForSelector('.annotation-list .muted');
    await search.fill('재시작');
    await page.waitForSelector('.annotation-item');

    await page.getByRole('button', { name: '공유 내용 확인' }).click();
    await page.waitForSelector('.share-preview');
    if (!(await page.locator('.share-preview').textContent()).includes('기록 2')) throw new Error('공유 미리보기의 기록 수가 다르다.');
    if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) {
        throw new Error('분석 화면에 가로 오버플로가 생겼다.');
    }

    await page.goto('about:blank');
    await running.close();
    running = await server.startServer({ projectDirectory: root, logLevel: 'error', logWrite: () => {} });
    await page.goto(`${running.url}/#token=${running.token}`);
    await page.waitForSelector('.app-bar');
    await page.getByRole('button', { name: /^분석 기록/ }).click();
    await page.waitForSelector('.annotation-item');
    if ((await page.locator('.annotation-item').allTextContents()).every((text) => !text.includes('재시작 뒤에도'))) {
        throw new Error('재시작 뒤 분석 기록이 복원되지 않았다.');
    }
    if (errors.length > 0) throw new Error(`브라우저 오류: ${errors.join(' | ')}`);
    console.log('ALL PASS — 키보드 저장·답글·삭제 복구·코드 비교·내부 링크·검색·공유 미리보기·재시작 복원');
} finally {
    await browser.close();
    await running.close();
    await rm(root, { recursive: true, force: true });
}
