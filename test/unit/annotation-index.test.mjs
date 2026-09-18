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
