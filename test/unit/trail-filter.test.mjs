/* 트레일 필터 (V09) — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

const { filterTrail } = await import(
    new URL('../../packages/web/lib/features/trail/filter.js', import.meta.url).href
);
const { buildAnnotationIndex } = await import(
    new URL('../../packages/web/lib/features/trail/annotationIndex.js', import.meta.url).href
);

const EMPTY = buildAnnotationIndex(null);

function node(id, name, code = '', children = []) {
    return {
        id,
        symbol: {
            name,
            displayPath: `proj/src/${name}.cpp`,
            relPath: `src/${name}.cpp`,
            startLine: 10,
            code,
        },
        children,
    };
}

test('걸린 노드의 조상을 함께 남긴다', () => {
    // 걸린 노드만 남기면 부모가 사라져 어디서 갈라진 것인지 알 수 없다.
    const leaf = node('c', 'Target');
    const roots = [node('a', 'Root', '', [node('b', 'Mid', '', [leaf])])];

    const result = filterTrail(roots, 'target', 'name', EMPTY);

    assert.deepEqual([...result.visibleIds].sort(), ['a', 'b', 'c']);
    // 매치는 걸린 노드뿐이다. 조상은 모양을 지키려고 남긴 것이다.
    assert.deepEqual([...result.hitIds], ['c']);
});

test('본문 대상은 코드 줄에서 찾고 그 줄 번호를 돌려준다', () => {
    const roots = [
        node('a', 'Alpha', 'void Alpha() {\n    lock(mutex);\n}'),
        node('b', 'Beta', 'void Beta() {}'),
    ];

    const result = filterTrail(roots, 'mutex', 'body', EMPTY);

    assert.deepEqual([...result.hitIds], ['a']);
    // 원본 파일 기준 줄이어야 한다. 본문 안 인덱스를 그대로 쓰면 강조가 어긋난다.
    assert.deepEqual(result.hitLines.get('a'), [11]);
    assert.equal(result.visibleIds.has('b'), false);
});

test('기록 대상은 종류와 미해결 낱말을 받는다', () => {
    const index = buildAnnotationIndex({
        annotations: [{
            id: 'n1',
            target: { kind: 'node', nodeId: 'a' },
            kind: 'concern',
            body: '여기서 경합이 난다',
            status: 'open',
            deletedAt: null,
        }],
        anchors: [],
        baselines: [],
    });
    const roots = [node('a', 'Alpha'), node('b', 'Beta')];

    assert.deepEqual([...filterTrail(roots, '우려', 'notes', index).hitIds], ['a']);
    assert.deepEqual([...filterTrail(roots, '미해결', 'notes', index).hitIds], ['a']);
    assert.deepEqual([...filterTrail(roots, '결론', 'notes', index).hitIds], []);
});

test('빈 질의는 필터를 끈 것이다', () => {
    const result = filterTrail([node('a', 'Alpha')], '   ', 'name', EMPTY);
    assert.equal(result.visibleIds, null);
});
