/* 기록 목록 거르기·세우기·묶기 (V15) — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

const {
    EMPTY_FILTERS,
    filterAnnotations,
    groupByFile,
    sortAnnotations,
    tagSuggestions,
} = await import(
    new URL('../../packages/web/lib/features/annotations/annotationList.js', import.meta.url).href
);

function item(id, overrides = {}) {
    return {
        id,
        target: { kind: 'trail', trailId: 't1' },
        kind: 'explanation',
        body: `기록 ${id}`,
        tags: [],
        status: 'open',
        authorId: 'u1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
        ...overrides,
    };
}

const CONTEXT = {
    anchorPlace: new Map([
        ['a1', { relPath: 'src/b.cpp', line: 5 }],
        ['a2', { relPath: 'src/a.cpp', line: 90 }],
        ['a3', { relPath: 'src/a.cpp', line: 10 }],
    ]),
    nodeOrder: new Map([['n2', 0], ['n1', 1]]),
};

test('상태·작성자·대상으로 거른다', () => {
    const items = [
        item('1', { status: 'resolved' }),
        item('2', { authorId: 'u2' }),
        item('3', { target: { kind: 'range', anchorId: 'a1' } }),
    ];

    assert.deepEqual(
        filterAnnotations(items, { ...EMPTY_FILTERS, status: 'resolved' }).map((x) => x.id),
        ['1'],
    );
    assert.deepEqual(
        filterAnnotations(items, { ...EMPTY_FILTERS, authorId: 'u2' }).map((x) => x.id),
        ['2'],
    );
    assert.deepEqual(
        filterAnnotations(items, { ...EMPTY_FILTERS, targetKind: 'range' }).map((x) => x.id),
        ['3'],
    );
});

test('지운 기록은 기본으로 빠진다', () => {
    const items = [item('1'), item('2', { deletedAt: '2026-01-02T00:00:00.000Z' })];
    assert.deepEqual(filterAnnotations(items, EMPTY_FILTERS).map((x) => x.id), ['1']);
    assert.deepEqual(
        filterAnnotations(items, { ...EMPTY_FILTERS, showDeleted: true }).map((x) => x.id),
        ['1', '2'],
    );
});

test('위치순은 트레일 → 노드 → 파일·줄이다', () => {
    // 트레일 전체 대상은 그 문서에서 가장 넓은 말이라 맨 위다.
    const items = [
        item('range-a90', { target: { kind: 'range', anchorId: 'a2' } }),
        item('node-1', { target: { kind: 'node', trailId: 't1', nodeId: 'n1' } }),
        item('trail', { target: { kind: 'trail', trailId: 't1' } }),
        item('range-a10', { target: { kind: 'range', anchorId: 'a3' } }),
        item('range-b5', { target: { kind: 'range', anchorId: 'a1' } }),
        item('node-2', { target: { kind: 'node', trailId: 't1', nodeId: 'n2' } }),
    ];

    assert.deepEqual(
        sortAnnotations(items, 'location', CONTEXT).map((x) => x.id),
        ['trail', 'node-2', 'node-1', 'range-a10', 'range-a90', 'range-b5'],
    );
});

test('파일별 묶기는 파일에 붙지 않은 기록을 맨 앞 한 무리로 모은다', () => {
    const items = [
        item('r1', { target: { kind: 'range', anchorId: 'a1' } }),
        item('t1'),
        item('r2', { target: { kind: 'range', anchorId: 'a3' } }),
    ];

    const groups = groupByFile(items, CONTEXT);
    assert.deepEqual(groups.map((g) => g.relPath), [null, 'src/a.cpp', 'src/b.cpp']);
    assert.deepEqual(groups[0].items.map((x) => x.id), ['t1']);
    assert.deepEqual(groups[1].items.map((x) => x.id), ['r2']);
});

test('태그 제안은 지운 기록을 빼고 정렬한다', () => {
    const items = [
        item('1', { tags: ['lock', 'net'] }),
        item('2', { tags: ['lock'] }),
        item('3', { tags: ['gone'], deletedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    assert.deepEqual(tagSuggestions(items), ['lock', 'net']);
});
