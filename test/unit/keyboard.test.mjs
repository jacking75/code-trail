/* 키보드 이동 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

const { firstChild, nextVisible, parentOf, prevVisible, visibleOrder } = await import(
    new URL('../../packages/web/lib/features/trail/keyboard.js', import.meta.url).href
);

let seq = 0;

/** 화면이 받는 모양의 노드. 이동 계산에 필요한 것만 채운다. */
function node(name, options = {}) {
    seq += 1;
    return {
        id: name,
        parentId: options.parentId ?? null,
        collapsed: options.collapsed ?? false,
        children: options.children ?? [],
        origin: { line: options.line ?? seq, char: 0, text: name },
        recursive: false,
        symbol: {
            name, detail: '', container: '', kind: 12,
            relPath: `src/${name}.cpp`, displayPath: `src/${name}.cpp`, external: false,
            languageId: 'cpp', code: '', startLine: 0, anchorLine: 0, anchorChar: 0,
            approximate: false, callable: true, declarationOnly: false,
            contentHash: null, modifiedAt: null, documentId: null,
        },
    };
}

/**
 * ```text
 * root
 *  ├ a   (자식 a1, a2)
 *  └ b
 * ```
 */
function tree({ collapseA = false } = {}) {
    const a1 = node('a1', { parentId: 'a', line: 1 });
    const a2 = node('a2', { parentId: 'a', line: 2 });
    const a = node('a', { parentId: 'root', line: 1, children: [a1, a2], collapsed: collapseA });
    const b = node('b', { parentId: 'root', line: 2 });
    return [node('root', { children: [a, b] })];
}

test('접힌 서브트리 안으로는 커서가 들어가지 않는다', () => {
    // 화면에 없는 노드로 데려가면 사용자 눈에는 커서가 사라진 것이다.
    const open = visibleOrder(tree(), 'source', null).map((item) => item.id);
    assert.deepEqual(open, ['root', 'a', 'a1', 'a2', 'b']);

    const folded = visibleOrder(tree({ collapseA: true }), 'source', null);
    assert.deepEqual(folded.map((item) => item.id), ['root', 'a', 'b']);
    assert.equal(nextVisible(folded, 'a'), 'b');
    assert.equal(prevVisible(folded, 'b'), 'a');
});

test('필터에 걸러진 노드도 건너뛴다', () => {
    const list = visibleOrder(tree(), 'source', new Set(['root', 'a', 'a2']));
    assert.deepEqual(list.map((item) => item.id), ['root', 'a', 'a2']);
    assert.equal(nextVisible(list, 'a'), 'a2');
});

test('끝에서는 그대로 머문다', () => {
    // 끝에서 처음으로 돌아가면 어디에 있었는지 잃는다.
    const list = visibleOrder(tree(), 'source', null);
    assert.equal(nextVisible(list, 'b'), 'b');
    assert.equal(prevVisible(list, 'root'), 'root');
    assert.equal(nextVisible([], 'root'), null);
});

test('첫 자식과 부모는 보이는 목록 안에서만 찾는다', () => {
    const open = visibleOrder(tree(), 'source', null);
    assert.equal(firstChild(open, 'a'), 'a1');
    assert.equal(parentOf(open, 'a1'), 'a');
    assert.equal(parentOf(open, 'root'), null);

    const folded = visibleOrder(tree({ collapseA: true }), 'source', null);
    assert.equal(firstChild(folded, 'a'), null, '접혀 있으면 자식으로 못 간다');
});
