/*
 * 1,000개 노드 성능 측정 — node test/perf/board-1000.mjs
 *
 * 구현서 19의 목표치("저장된 트레일 열기 — 1,000개 노드에서 1초 이내 첫 화면")를
 * 실제로 재 본다. 언어 서버를 1,000번 부르는 대신 저장 파일을 직접 만들어 넣는다 —
 * 여기서 재려는 것은 심볼 해석이 아니라 **불러오기와 그리기**다.
 *
 * 브라우저는 `CT_CHROME` 우선. 없으면 컨테이너의 프리설치 크로미움.
 * 브라우저를 못 찾으면 배치 계산만 재고 그 사실을 밝힌다.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const server = await import(
    new URL('../../packages/server/dist/index.js', import.meta.url).href
);
const board = await import(
    new URL('../../packages/web/lib/features/trail/board.js', import.meta.url).href
);

const NODE_COUNT = Number(process.env.CT_PERF_NODES ?? 1000);
/** 한 부모가 갖는 자식 수. 깊이가 아니라 폭으로 늘려야 실제 트레일과 비슷하다. */
const FANOUT = 4;

const CODE = [
    'IHandler* Find(uint16_t opcode) const {',
    '\tauto it = entries_.find(opcode);',
    '\treturn it == entries_.end() ? nullptr : it->second.get();',
    '}',
].join('\n');

function symbol(index) {
    return {
        name: `Find${index}`,
        detail: '(uint16_t) const',
        container: 'HandlerRegistry',
        kind: 6,
        relPath: 'src/registry.cpp',
        displayPath: 'src/registry.cpp',
        external: false,
        languageId: 'cpp',
        startLine: 3,
        anchorLine: 3,
        anchorChar: 11,
        approximate: false,
        callable: true,
        declarationOnly: false,
        contentHash: null,
        modifiedAt: null,
        code: CODE,
    };
}

/** 폭 우선으로 노드를 늘린다. 부모가 자식보다 먼저 만들어진다. */
function buildTree(count) {
    const root = {
        id: randomUUID(),
        parentId: null,
        symbol: symbol(0),
        origin: null,
        collapsed: false,
        recursive: false,
        children: [],
    };
    const queue = [root];
    let made = 1;
    while (made < count) {
        const parent = queue.shift();
        for (let i = 0; i < FANOUT && made < count; i++) {
            const child = {
                id: randomUUID(),
                parentId: parent.id,
                symbol: symbol(made),
                origin: { line: 3 + i, char: 4, text: `Find${made}` },
                collapsed: false,
                recursive: false,
                children: [],
            };
            parent.children.push(child);
            queue.push(child);
            made += 1;
        }
    }
    return root;
}

function countNodes(node) {
    return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

const results = [];
const record = (label, ms, note) => {
    results.push({ label, ms: Math.round(ms * 10) / 10, note: note ?? '' });
    console.log(`  ${label}: ${ms.toFixed(1)}ms${note ? ` — ${note}` : ''}`);
};

// ── 1. 배치 계산만 ──────────────────────────────────────────────────────────

console.log(`\n[배치 계산 — ${NODE_COUNT}개 노드]`);
const root = buildTree(NODE_COUNT);
console.log(`  만든 노드: ${countNodes(root)}`);

let t0 = performance.now();
const flat = board.flattenTree([root], 'source');
record('flattenTree', performance.now() - t0);

const sizes = {};
for (const item of flat) {
    sizes[item.node.id] = { width: 520, height: 180 };
}

t0 = performance.now();
const placed = board.autoPlace(flat, {}, sizes);
record('autoPlace (좌표 없음 — 전부 자동 배치)', performance.now() - t0);

const storedUi = {};
for (const item of flat) {
    const point = placed[item.node.id];
    storedUi[item.node.id] = { boardX: Math.round(point.x), boardY: Math.round(point.y) };
}

t0 = performance.now();
board.autoPlace(flat, storedUi, sizes);
record('autoPlace (좌표 있음 — 저장된 자리 그대로)', performance.now() - t0);

const rects = {};
for (const item of flat) {
    rects[item.node.id] = { ...placed[item.node.id], ...sizes[item.node.id] };
}
t0 = performance.now();
board.connectors(flat, rects);
record('connectors', performance.now() - t0);

// ── 2. 진짜 서버 + 진짜 브라우저 ────────────────────────────────────────────

const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'code-trail-perf-'));
await mkdir(path.join(projectRoot, 'src'), { recursive: true });
await writeFile(path.join(projectRoot, 'src', 'registry.cpp'), `${CODE}\n`, 'utf8');

let running = await server.startServer({
    projectDirectory: projectRoot,
    logLevel: 'error',
    logWrite: () => {},
});
await running.close();

// 저장 파일을 직접 만든다. 언어 서버를 1,000번 부르지 않는다.
const trailId = randomUUID();
const now = new Date().toISOString();
const stored = {
    schemaVersion: 1,
    id: trailId,
    title: `성능 시험 ${NODE_COUNT}`,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    activeNodeId: null,
    mode: 'tree',
    roots: [root],
    nodeUi: storedUi,
};
await mkdir(path.join(projectRoot, '.code-trail', 'trails'), { recursive: true });
await writeFile(
    path.join(projectRoot, '.code-trail', 'trails', `${trailId}.json`),
    `${JSON.stringify(stored, null, 2)}\n`,
    'utf8',
);

console.log('\n[서버 불러오기]');
t0 = performance.now();
running = await server.startServer({
    projectDirectory: projectRoot,
    logLevel: 'error',
    logWrite: () => {},
});
record('startServer (저장된 트레일 포함)', performance.now() - t0);

let browser = null;
try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
        executablePath: process.env.CT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox'],
    });
} catch (error) {
    console.log(`\n[브라우저] 띄우지 못해 화면 측정은 건너뛴다 — ${String(error).slice(0, 120)}`);
}

if (browser !== null) {
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        await page.goto(`${running.url}/#token=${running.token}`);
        await page.waitForSelector('.app-bar');

        console.log('\n[트리 모드]');
        t0 = performance.now();
        await page.locator('.pane-tabs .tab').nth(1).click();
        await page.waitForFunction(
            (count) => document.querySelectorAll('.node').length >= count,
            NODE_COUNT,
            { timeout: 60000 },
        );
        record('트레일 탭 첫 화면', performance.now() - t0, `${NODE_COUNT}개 노드`);

        console.log('\n[보드 모드]');
        t0 = performance.now();
        await page.locator('#board-toggle').click();
        await page.waitForFunction(
            (count) => document.querySelectorAll('#root.board > .node').length >= count,
            NODE_COUNT,
            { timeout: 60000 },
        );
        record('보드 전환', performance.now() - t0);

        const lines = await page.locator('.board-lines path').count();
        console.log(`  연결선: ${lines}개`);

        console.log('\n[스크롤]');
        t0 = performance.now();
        await page.evaluate(() => {
            const host = document.getElementById('root');
            for (let i = 0; i < 20; i++) {
                host.scrollTop = i * 400;
            }
        });
        record('스크롤 20회', performance.now() - t0);
    } finally {
        await browser.close();
    }
}

await running.close();
await rm(projectRoot, { recursive: true, force: true });

const outPath = fileURLToPath(new URL('../../docs/perf-1000-nodes.md', import.meta.url));
const table = results.map((r) => `| ${r.label} | ${r.ms}ms | ${r.note} |`).join('\n');
const existing = await readFile(outPath, 'utf8').catch(() => null);
console.log(`\n측정 끝. 결과를 ${path.relative(process.cwd(), outPath)} 에 적는다.`);
console.log(`\n| 항목 | 시간 | 비고 |\n| --- | --- | --- |\n${table}`);
if (existing === null) {
    console.log('(문서가 없다. 사람이 만들어 넣는다.)');
}
