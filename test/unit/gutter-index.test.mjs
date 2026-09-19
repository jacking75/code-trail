/* 코드 화면 여백 표식 색인 (V04) — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

const { buildGutterIndex, gutterLines } = await import(
    new URL('../../packages/web/lib/features/source/gutterIndex.js', import.meta.url).href
);

function node(id, relPath, anchorLine, children = []) {
    return { id, symbol: { relPath, anchorLine, name: id }, children };
}

test('노드는 anchorLine 한 줄에만, 같은 줄이면 함께 모인다', () => {
    // 본문 전체에 표식을 두면 hunk 색 띠와 섞여 무엇이 무엇인지 알 수 없다.
    const roots = [
        node('a', 'src/a.cpp', 10, [node('b', 'src/a.cpp', 10)]),
        node('c', 'src/b.cpp', 3),
    ];

    const index = buildGutterIndex(roots, new Map());

    assert.deepEqual(index.nodes.get('src/a.cpp').get(10), ['a', 'b']);
    assert.deepEqual(index.nodes.get('src/b.cpp').get(3), ['c']);
    assert.equal(index.nodes.get('src/a.cpp').get(11), undefined);
});

test('프로젝트 밖 노드는 색인에 들어가지 않는다', () => {
    // 경로가 없으면 코드 화면에서 열 수 없다. 표식만 남으면 누르고 아무 일도 안 난다.
    const index = buildGutterIndex([node('x', null, 5)], new Map());
    assert.equal(index.nodes.size, 0);
});

test('기록은 시작 줄에 붙고 노드와 한 줄에 함께 나온다', () => {
    const index = buildGutterIndex(
        [node('a', 'src/a.cpp', 10)],
        new Map([['src/a.cpp', [
            { annotationId: 'n1', kind: 'concern', startLine: 10 },
            { annotationId: 'n2', kind: 'explanation', startLine: 20 },
        ]]]),
    );

    const lines = gutterLines(index, 'src/a.cpp');
    assert.deepEqual(lines.map((line) => line.line), [10, 20]);
    assert.deepEqual(lines[0].nodeIds, ['a']);
    assert.deepEqual(lines[0].notes.map((note) => note.annotationId), ['n1']);
    assert.deepEqual(lines[1].nodeIds, []);
});

test('다른 파일의 표식은 나오지 않는다', () => {
    const index = buildGutterIndex([node('a', 'src/a.cpp', 10)], new Map());
    assert.deepEqual(gutterLines(index, 'src/b.cpp'), []);
    assert.deepEqual(gutterLines(index, null), []);
});
