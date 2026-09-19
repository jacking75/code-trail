/* 기록 색인 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    buildAnnotationIndex,
    countForNode,
    marksInRange,
} = await import(
    new URL('../../packages/web/lib/features/trail/annotationIndex.js', import.meta.url).href
);

const NODE = '11111111-1111-4111-8111-111111111111';

/** 범위 기록 하나가 달린 분석 문서. 색인이 보는 것만 채운다. */
function analysis(overrides = {}) {
    return {
        annotations: [],
        anchors: [],
        baselines: [],
        ...overrides,
    };
}

function anchor(id, fileId, startLine, endLine, currentRange = null) {
    return {
        id,
        fileId,
        range: { start: { line: startLine, char: 0 }, end: { line: endLine, char: 0 } },
        currentRange,
    };
}

function annotation(id, target, overrides = {}) {
    return {
        id,
        target,
        kind: 'explanation',
        body: '설명',
        status: 'open',
        deletedAt: null,
        ...overrides,
    };
}

test('범위 기록은 기준 파일의 상대경로로 묶인다', () => {
    // `fileId → relPath` 를 잘못 풀면 다른 파일의 노드에 띠가 붙는다.
    const index = buildAnnotationIndex(analysis({
        baselines: [{ files: [{ fileId: 'f1', relPath: 'src/a.cpp' }, { fileId: 'f2', relPath: 'src/b.cpp' }] }],
        anchors: [anchor('a1', 'f1', 10, 12), anchor('a2', 'f2', 3, 3)],
        annotations: [
            annotation('n1', { kind: 'range', anchorId: 'a1' }),
            annotation('n2', { kind: 'range', anchorId: 'a2' }),
        ],
    }));

    assert.deepEqual(index.byFile.get('src/a.cpp').map((m) => m.annotationId), ['n1']);
    assert.deepEqual(index.byFile.get('src/b.cpp').map((m) => m.annotationId), ['n2']);
});

test('위치가 다시 잡혔으면 그 자리를 쓴다', () => {
    // 기록 당시의 줄이 아니라 지금의 줄에 띠가 붙어야 한다.
    const index = buildAnnotationIndex(analysis({
        baselines: [{ files: [{ fileId: 'f1', relPath: 'src/a.cpp' }] }],
        anchors: [anchor('a1', 'f1', 10, 12, {
            start: { line: 40, char: 0 }, end: { line: 42, char: 0 },
        })],
        annotations: [annotation('n1', { kind: 'range', anchorId: 'a1' })],
    }));

    assert.deepEqual(marksInRange(index, 'src/a.cpp', 0, 20), []);
    assert.equal(marksInRange(index, 'src/a.cpp', 38, 45).length, 1);
});

test('본문과 부분만 겹쳐도 그 노드의 기록이다', () => {
    // 노드 본문은 파일의 일부만 보여준다. 겹침을 파일 단위로 보면 전혀 상관없는
    // 노드에도 배지가 붙는다.
    const index = buildAnnotationIndex(analysis({
        baselines: [{ files: [{ fileId: 'f1', relPath: 'src/a.cpp' }] }],
        anchors: [anchor('a1', 'f1', 18, 24)],
        annotations: [annotation('n1', { kind: 'range', anchorId: 'a1' })],
    }));

    assert.equal(marksInRange(index, 'src/a.cpp', 20, 30).length, 1, '아래로 걸침');
    assert.equal(marksInRange(index, 'src/a.cpp', 10, 19).length, 1, '위로 걸침');
    assert.equal(marksInRange(index, 'src/a.cpp', 25, 40).length, 0, '겹치지 않음');
});

test('지운 기록은 세지 않고 미해결만 따로 센다', () => {
    const index = buildAnnotationIndex(analysis({
        annotations: [
            annotation('n1', { kind: 'node', nodeId: NODE }),
            annotation('n2', { kind: 'node', nodeId: NODE }, { kind: 'question', status: 'open' }),
            annotation('n3', { kind: 'node', nodeId: NODE }, { kind: 'concern', status: 'resolved' }),
            annotation('n4', { kind: 'node', nodeId: NODE }, { deletedAt: '2026-01-01T00:00:00.000Z' }),
        ],
    }));

    const count = countForNode(index, NODE, null, 0, 0);
    assert.equal(count.total, 3);
    assert.equal(count.open, 1);
    assert.equal(count.byKind.explanation, 1);
    assert.equal(index.total, 3);
});

test('트레일 대상 기록은 노드에 붙지 않는다', () => {
    const index = buildAnnotationIndex(analysis({
        annotations: [annotation('n1', { kind: 'trail', trailId: NODE })],
    }));

    assert.equal(index.trailTotal, 1);
    assert.equal(index.byNode.size, 0);
    assert.equal(countForNode(index, NODE, null, 0, 0).total, 0);
});

// ── 검토 표시 (V02 · V03) ─────────────────────────────────────────────────

const { reviewForRange, subtreeSummary } = await import(
    new URL('../../packages/web/lib/features/trail/annotationIndex.js', import.meta.url).href
);

test('노드 검토와 범위 검토는 섞이지 않는다', () => {
    // 같은 목록에서 나오지만 붙는 자리가 다르다. 섞이면 노드 헤더에 남의
    // hunk 검토가 뜨고, hunk 줄에 노드 검토가 뜬다.
    const index = buildAnnotationIndex(analysis({
        baselines: [{ files: [{ fileId: 'f1', relPath: 'src/a.cpp' }] }],
        anchors: [anchor('a1', 'f1', 10, 12)],
        reviews: [
            { target: { kind: 'node', nodeId: NODE }, state: 'reviewed' },
            { target: { kind: 'range', anchorId: 'a1' }, state: 'needsReview' },
        ],
    }));

    assert.equal(index.reviewByNode.get(NODE), 'reviewed');
    assert.equal(index.reviewsByFile.get('src/a.cpp').length, 1);
    assert.deepEqual(index.reviewCounts, { reviewed: 1, needsReview: 1 });
});

test('확인함 범위가 hunk 를 덮으면 확인한 것이고, 재검토가 이긴다', () => {
    // 함수 하나를 통째로 확인하면 그 안의 hunk 도 본 것이다. 다시 봐야 한다는
    // 신호는 놓치면 안 되므로 겹치면 재검토가 이긴다.
    const index = buildAnnotationIndex(analysis({
        baselines: [{ files: [{ fileId: 'f1', relPath: 'src/a.cpp' }] }],
        anchors: [anchor('a1', 'f1', 10, 40), anchor('a2', 'f1', 100, 120)],
        reviews: [
            { target: { kind: 'range', anchorId: 'a1' }, state: 'reviewed' },
            { target: { kind: 'range', anchorId: 'a2' }, state: 'needsReview' },
        ],
    }));

    assert.equal(reviewForRange(index, 'src/a.cpp', 20, 25), 'reviewed');
    assert.equal(reviewForRange(index, 'src/a.cpp', 105, 110), 'needsReview');
    // 범위 밖은 아직 안 본 것이다. 덮지 않은 곳까지 확인함이 되면 안 된다.
    assert.equal(reviewForRange(index, 'src/a.cpp', 60, 70), 'unreviewed');
});

test('하위 요약은 자기 아래만 센다', () => {
    const child = { id: 'c1', symbol: { relPath: null, startLine: 0, code: '' }, children: [] };
    const grand = { id: 'g1', symbol: { relPath: null, startLine: 0, code: '' }, children: [] };
    child.children = [grand];
    const sibling = { id: 's1', symbol: { relPath: null, startLine: 0, code: '' }, children: [] };
    const root = { id: NODE, symbol: { relPath: null, startLine: 0, code: '' }, children: [child] };

    const index = buildAnnotationIndex(analysis({
        annotations: [
            annotation('n1', { kind: 'node', nodeId: 'g1' }, { kind: 'concern' }),
            annotation('n2', { kind: 'node', nodeId: 's1' }),
        ],
        reviews: [{ target: { kind: 'node', nodeId: 'c1' }, state: 'needsReview' }],
    }));
    const summary = subtreeSummary([root, sibling], index);

    assert.deepEqual(summary.get(NODE), { nodes: 2, notes: 1, open: 1, needsReview: 1 });
    assert.deepEqual(summary.get('g1'), { nodes: 0, notes: 1, open: 1, needsReview: 0 });
    // 형제 것이 섞이면 접힌 노드를 보고 엉뚱한 곳을 펼친다.
    assert.deepEqual(summary.get('s1'), { nodes: 0, notes: 1, open: 0, needsReview: 0 });
});
