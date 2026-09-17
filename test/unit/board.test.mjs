/* 보드 배치 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const board = await import(
    new URL('../../packages/web/lib/features/trail/board.js', import.meta.url).href
);

const {
    BOARD_EDGE,
    BOARD_GAP_X,
    BOARD_GAP_Y,
    BOARD_DEFAULT_HEIGHT,
    BOARD_DEFAULT_WIDTH,
    autoPlace,
    boardExtent,
    connectorPath,
    connectors,
    flattenTree,
    placeNear,
    sortChildren,
} = board;

let seq = 0;

/** 화면이 받는 모양의 노드. 배치에 필요한 것만 채운다. */
function node(name, options = {}) {
    seq += 1;
    return {
        id: options.id ?? `n${seq}`,
        parentId: options.parentId ?? null,
        symbol: {
            name,
            detail: '',
            container: '',
            kind: 12,
            relPath: 'src/a.cpp',
            displayPath: 'src/a.cpp',
            external: false,
            languageId: 'cpp',
            code: '',
            startLine: 0,
            anchorLine: 0,
            anchorChar: 0,
            approximate: false,
            callable: true,
            declarationOnly: false,
            contentHash: null,
            modifiedAt: null,
            documentId: null,
        },
        origin: options.origin ?? null,
        collapsed: false,
        recursive: false,
        children: options.children ?? [],
    };
}

function origin(line, char) {
    return { line, char, text: 'x' };
}

/** 부모-자식을 이어 붙인다. `parentId` 는 모델이 들고 있는 그대로다. */
function withChildren(parent, children) {
    children.forEach((child) => {
        child.parentId = parent.id;
    });
    parent.children = children;
    return parent;
}

test('형제를 코드 순서로 정렬한다', () => {
    const a = node('A', { origin: origin(9, 2) });
    const b = node('B', { origin: origin(3, 8) });
    const c = node('C', { origin: origin(3, 2) });
    const sorted = sortChildren([a, b, c], 'source').map((n) => n.symbol.name);
    assert.deepEqual(sorted, ['C', 'B', 'A']);
});

test('클릭 순서는 서버가 붙인 순서 그대로다', () => {
    const a = node('A', { origin: origin(9, 2) });
    const b = node('B', { origin: origin(3, 8) });
    const sorted = sortChildren([a, b], 'click').map((n) => n.symbol.name);
    assert.deepEqual(sorted, ['A', 'B']);
});

test('트리를 깊이 우선으로 편다 — 부모가 자식보다 앞이다', () => {
    const grand = node('Grand', { origin: origin(1, 0) });
    const child = withChildren(node('Child', { origin: origin(2, 0) }), [grand]);
    const root = withChildren(node('Root'), [child]);
    const flat = flattenTree([root], 'source');

    assert.deepEqual(flat.map((f) => f.node.symbol.name), ['Root', 'Child', 'Grand']);
    assert.deepEqual(flat.map((f) => f.depth), [0, 1, 2]);
    // 루트는 순번이 없고, 자식은 1부터다.
    assert.deepEqual(flat.map((f) => f.ordinal), [0, 1, 1]);
    // 진입 링크에 찍을 부모 이름.
    assert.deepEqual(flat.map((f) => f.parentName), ['', 'Root', 'Child']);
});

test('저장된 좌표를 그대로 쓴다', () => {
    const root = node('Root');
    const flat = flattenTree([root], 'source');
    const placed = autoPlace(flat, { [root.id]: { boardX: 700, boardY: 220 } }, {});
    assert.deepEqual(placed[root.id], { x: 700, y: 220 });
});

test('좌표가 반쪽이면 저장된 것으로 보지 않는다', () => {
    const root = node('Root');
    const flat = flattenTree([root], 'source');
    const placed = autoPlace(flat, { [root.id]: { boardX: 700 } }, {});
    assert.deepEqual(placed[root.id], { x: BOARD_EDGE, y: BOARD_EDGE });
});

test('루트는 왼쪽 열에 위에서 아래로 쌓인다', () => {
    const a = node('A');
    const b = node('B');
    const flat = flattenTree([a, b], 'source');
    const sizes = {
        [a.id]: { width: 500, height: 100 },
        [b.id]: { width: 500, height: 100 },
    };
    const placed = autoPlace(flat, {}, sizes);
    assert.deepEqual(placed[a.id], { x: BOARD_EDGE, y: BOARD_EDGE });
    assert.deepEqual(placed[b.id], { x: BOARD_EDGE, y: BOARD_EDGE + 100 + BOARD_GAP_Y });
});

test('새 자식은 부모 오른쪽에 놓인다', () => {
    const child = node('Child', { origin: origin(1, 0) });
    const root = withChildren(node('Root'), [child]);
    const flat = flattenTree([root], 'source');
    const sizes = {
        [root.id]: { width: 400, height: 120 },
        [child.id]: { width: 400, height: 120 },
    };
    const placed = autoPlace(flat, {}, sizes);
    assert.equal(placed[child.id].x, placed[root.id].x + 400 + BOARD_GAP_X);
    assert.equal(placed[child.id].y, placed[root.id].y);
});

test('부모 오른쪽이 이미 차 있으면 아래로 민다', () => {
    const first = node('First', { origin: origin(1, 0) });
    const second = node('Second', { origin: origin(2, 0) });
    const root = withChildren(node('Root'), [first, second]);
    const flat = flattenTree([root], 'source');
    const sizes = {
        [root.id]: { width: 400, height: 120 },
        [first.id]: { width: 400, height: 120 },
        [second.id]: { width: 400, height: 120 },
    };
    const placed = autoPlace(flat, {}, sizes);
    assert.equal(placed[first.id].x, placed[second.id].x);
    assert.ok(placed[second.id].y >= placed[first.id].y + 120);
});

test('크기를 못 잰 노드는 기본 크기로 자리를 잡는다', () => {
    const a = node('A');
    const b = node('B');
    const flat = flattenTree([a, b], 'source');
    const placed = autoPlace(flat, {}, {});
    assert.deepEqual(placed[b.id], {
        x: BOARD_EDGE,
        y: BOARD_EDGE + BOARD_DEFAULT_HEIGHT + BOARD_GAP_Y,
    });
});

test('placeNear 는 겹치지 않는 자리를 준다', () => {
    const parent = { x: 0, y: 0, width: 100, height: 50 };
    const taken = [{ x: 100 + BOARD_GAP_X, y: 0, width: 100, height: 50 }];
    const point = placeNear(parent, taken);
    assert.equal(point.x, 100 + BOARD_GAP_X);
    assert.equal(point.y, 50 + BOARD_GAP_Y);
});

test('연결선은 부모 오른쪽에서 시작해 자식 왼쪽에서 끝난다', () => {
    const d = connectorPath(
        { x: 0, y: 0, width: 100, height: 60 },
        { x: 300, y: 200, width: 100, height: 60 },
    );
    assert.match(d, /^M100 16 C/);
    assert.ok(d.endsWith(',300 216'));
});

test('연결선은 모델의 부모-자식만 잇는다', () => {
    const child = node('Child', { origin: origin(1, 0) });
    const root = withChildren(node('Root'), [child]);
    const other = node('Other');
    const flat = flattenTree([root, other], 'source');
    const rects = {
        [root.id]: { x: 0, y: 0, width: 100, height: 60 },
        [child.id]: { x: 300, y: 0, width: 100, height: 60 },
        [other.id]: { x: 0, y: 300, width: 100, height: 60 },
    };
    const lines = connectors(flat, rects);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, child.id);
});

test('좌표가 없는 노드는 선을 그리지 않는다', () => {
    const child = node('Child', { origin: origin(1, 0) });
    const root = withChildren(node('Root'), [child]);
    const flat = flattenTree([root], 'source');
    assert.equal(connectors(flat, { [root.id]: { x: 0, y: 0, width: 1, height: 1 } }).length, 0);
});

test('캔버스는 가장 먼 노드보다 가장자리만큼 크다', () => {
    const extent = boardExtent([
        { x: 0, y: 0, width: 100, height: 60 },
        { x: 400, y: 300, width: 120, height: 80 },
    ]);
    assert.deepEqual(extent, {
        width: 520 + BOARD_EDGE * 2,
        height: 380 + BOARD_EDGE * 2,
    });
});

test('보드 배치는 부모-자식 관계를 건드리지 않는다', () => {
    const child = node('Child', { origin: origin(1, 0) });
    const root = withChildren(node('Root'), [child]);
    const flat = flattenTree([root], 'source');

    // 자식을 부모보다 훨씬 왼쪽 위로 끌어다 놓는다.
    autoPlace(flat, { [child.id]: { boardX: 0, boardY: 0 } }, {});

    assert.equal(child.parentId, root.id);
    assert.deepEqual(root.children, [child]);
    // 다시 펴도 같은 계층이다.
    const again = flattenTree([root], 'source');
    assert.deepEqual(again.map((f) => f.depth), [0, 1]);
});

test('기본 폭은 CSS 의 보드 폭과 같다', () => {
    // 자리 계산은 BOARD_DEFAULT_WIDTH 로, 그리기는 --ct-board-width 로 한다.
    // 둘이 어긋나면 아직 크기를 못 잰 노드가 그려진 자리와 다른 곳을 차지한다.
    const css = fs.readFileSync(
        fileURLToPath(new URL('../../packages/web/src/styles/app.css', import.meta.url)),
        'utf8',
    );
    const declared = /--ct-board-width:\s*(\d+)px/.exec(css);
    assert.ok(declared, 'app.css 에 --ct-board-width 가 없다');
    assert.equal(BOARD_DEFAULT_WIDTH, Number(declared[1]));
});
