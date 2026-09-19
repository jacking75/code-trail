/* 트레일 도메인 불변식 — node --test test/unit */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeOrigin, makeSymbol, makeTrail, shared } from './helpers.mjs';

const { Trail, symbolKey } = shared;

test('구조를 바꾼 만큼만 revision 이 오른다', () => {
    const trail = makeTrail();
    assert.equal(trail.revision, 0);

    const root = trail.addRoot(makeSymbol());
    assert.equal(trail.revision, 1);

    const child = trail.addChild(root.id, makeSymbol(), makeOrigin());
    assert.equal(trail.revision, 2);

    trail.remove(child.id);
    assert.equal(trail.revision, 3);

    // 없는 노드에 대한 명령은 아무 일도 하지 않는다
    assert.equal(trail.remove('00000000-0000-4000-8000-000000000000'), undefined);
    assert.equal(trail.revision, 3);
});

test('화면 상태는 revision 을 올리지 않는다', () => {
    // revision 은 "내가 본 트리가 아직 그대로인가" 를 재는 값이다. 접기·배치·
    // 활성 노드까지 올리면, 노드 하나를 누른 것만으로 그 순간 날아가던 정의
    // 요청이 거절된다. 저장은 해야 하므로 updatedAt 은 갱신한다.
    let clock = 0;
    const trail = new Trail({
        title: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        now: () => `2026-01-01T00:00:${String(clock++).padStart(2, '0')}.000Z`,
    });
    const root = trail.addRoot(makeSymbol());
    const structural = trail.revision;
    const before = trail.updatedAt;

    assert.equal(trail.setCollapsed(root.id, true), true);
    assert.equal(trail.setMode('board'), true);
    assert.equal(trail.setNodeUi(root.id, { boardX: 10 }), true);
    assert.equal(trail.setActiveNode(root.id), true);

    assert.equal(trail.revision, structural);
    assert.notEqual(trail.updatedAt, before);

    // 이미 그 상태면 아무것도 하지 않는다.
    assert.equal(trail.setCollapsed(root.id, true), false);
    assert.equal(trail.setMode('board'), false);
    assert.equal(trail.setActiveNode(root.id), false);
});

test('부모는 클릭한 코드가 속한 노드다 — A 안에서 클릭한 둘은 형제다', () => {
    const trail = makeTrail();
    const a = trail.addRoot(makeSymbol({ name: 'A' }));
    const b = trail.addChild(a.id, makeSymbol({ name: 'B' }), makeOrigin({ line: 5 }));
    const c = trail.addChild(a.id, makeSymbol({ name: 'C' }), makeOrigin({ line: 9 }));

    assert.equal(b.parentId, a.id);
    assert.equal(c.parentId, a.id);
    assert.deepEqual(a.children.map((n) => n.symbol.name), ['B', 'C']);
    assert.equal(trail.size, 3);
});

test('없는 부모에는 자식을 못 붙이고 revision 도 안 오른다', () => {
    const trail = makeTrail();
    trail.addRoot(makeSymbol());
    const before = trail.revision;
    const orphan = trail.addChild('00000000-0000-4000-8000-000000000000', makeSymbol(), makeOrigin());
    assert.equal(orphan, undefined);
    assert.equal(trail.revision, before);
});

test('조상에 같은 심볼이 있으면 재귀로 표시한다', () => {
    const trail = makeTrail();
    const target = makeSymbol({ name: 'Recurse', relPath: 'src/a.cpp', anchorLine: 42 });
    const root = trail.addRoot(target);
    const mid = trail.addChild(root.id, makeSymbol({ name: 'Mid' }), makeOrigin());
    const back = trail.addChild(mid.id, { ...target }, makeOrigin());

    assert.equal(root.recursive, false);
    assert.equal(mid.recursive, false);
    assert.equal(back.recursive, true);
});

test('재귀 판정은 파일과 이름 줄만 본다 — 본문이 달라도 같은 심볼이다', () => {
    const a = makeSymbol({ relPath: 'src/a.cpp', anchorLine: 7, code: 'void f() {}' });
    const b = makeSymbol({ relPath: 'src/a.cpp', anchorLine: 7, code: '// 다시 읽은 본문' });
    assert.equal(symbolKey(a), symbolKey(b));

    const trail = makeTrail();
    const root = trail.addRoot(a);
    const child = trail.addChild(root.id, b, makeOrigin());
    assert.equal(child.recursive, true);
});

test('형제 중복은 붙이기 전에 찾아낸다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol({ name: 'Root' }));
    const target = makeSymbol({ name: 'Find', relPath: 'src/reg.cpp', anchorLine: 41 });
    const first = trail.addChild(root.id, target, makeOrigin({ line: 3 }));

    const again = trail.findExistingChild(root.id, { ...target, code: '다른 스냅샷' });
    assert.equal(again?.id, first.id);

    // 다른 부모 아래에서는 중복이 아니다
    const other = trail.addRoot(makeSymbol({ name: 'Other' }));
    assert.equal(trail.findExistingChild(other.id, target), undefined);
});

test('노드를 지우면 하위와 화면 상태까지 함께 사라진다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol());
    const mid = trail.addChild(root.id, makeSymbol(), makeOrigin());
    const leaf = trail.addChild(mid.id, makeSymbol(), makeOrigin());
    trail.setNodeUi(leaf.id, { boardX: 10, boardY: 20 });
    trail.setActiveNode(leaf.id);

    assert.equal(trail.size, 3);
    const removed = trail.remove(mid.id);
    assert.equal(removed.count, 2);

    assert.equal(trail.size, 1);
    assert.equal(trail.get(mid.id), undefined);
    assert.equal(trail.get(leaf.id), undefined);
    assert.equal(trail.getNodeUi(leaf.id), undefined);
    assert.equal(trail.activeNodeId, null);
    assert.deepEqual(root.children, []);
});

test('루트를 지우면 roots 에서도 빠진다', () => {
    const trail = makeTrail();
    const a = trail.addRoot(makeSymbol());
    const b = trail.addRoot(makeSymbol());
    assert.equal(trail.remove(a.id).index, 0);
    assert.deepEqual(trail.roots.map((n) => n.id), [b.id]);
});

test('promoteToRoot 는 하위를 데려가고 진입 링크를 지운다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol({ name: 'Root' }));
    const mid = trail.addChild(root.id, makeSymbol({ name: 'Mid' }), makeOrigin());
    const leaf = trail.addChild(mid.id, makeSymbol({ name: 'Leaf' }), makeOrigin());

    const promoted = trail.promoteToRoot(mid.id);

    assert.equal(promoted?.node.id, mid.id);
    assert.equal(promoted?.previousParentId, root.id);
    assert.equal(mid.parentId, null);
    assert.equal(mid.origin, null);
    assert.deepEqual(root.children, []);
    assert.deepEqual(trail.roots.map((n) => n.id), [root.id, mid.id]);
    // 하위는 그대로 따라온다
    assert.deepEqual(mid.children.map((n) => n.id), [leaf.id]);
    assert.equal(leaf.parentId, mid.id);
});

test('promoteToRoot 는 새 조상 사슬로 재귀 표시를 다시 계산한다', () => {
    const trail = makeTrail();
    const shared1 = makeSymbol({ name: 'Shared', relPath: 'src/s.cpp', anchorLine: 3 });

    const root = trail.addRoot(shared1);
    const mid = trail.addChild(root.id, makeSymbol({ name: 'Mid' }), makeOrigin());
    const back = trail.addChild(mid.id, { ...shared1 }, makeOrigin());
    assert.equal(back.recursive, true);

    // Mid 를 새 루트로 떼어내면 Shared 조상이 사라지므로 재귀가 아니게 된다
    trail.promoteToRoot(mid.id);
    assert.equal(back.recursive, false);
});

test('루트는 승격할 수 없다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol());
    const before = trail.revision;
    assert.equal(trail.promoteToRoot(root.id), undefined);
    assert.equal(trail.revision, before);
});

test('setNodeUi 는 준 키만 바꾸고 null 이면 지운다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol());

    trail.setNodeUi(root.id, { boardX: 10, boardY: 20 });
    assert.deepEqual(trail.getNodeUi(root.id), { boardX: 10, boardY: 20 });

    trail.setNodeUi(root.id, { codeFontSize: 11 });
    assert.deepEqual(trail.getNodeUi(root.id), { boardX: 10, boardY: 20, codeFontSize: 11 });

    // 같은 값을 다시 주면 revision 이 오르지 않는다
    const before = trail.revision;
    assert.equal(trail.setNodeUi(root.id, { boardX: 10 }), false);
    assert.equal(trail.revision, before);

    // null 은 "이 노드만 크게" 를 되돌린다
    trail.setNodeUi(root.id, { codeFontSize: null });
    assert.deepEqual(trail.getNodeUi(root.id), { boardX: 10, boardY: 20 });

    trail.setNodeUi(root.id, { boardX: null, boardY: null });
    assert.equal(trail.getNodeUi(root.id), undefined);
});

test('보드 모드로 바꿔도 부모-자식 관계는 그대로다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol());
    const child = trail.addChild(root.id, makeSymbol(), makeOrigin());

    trail.setMode('board');
    trail.setNodeUi(child.id, { boardX: 900, boardY: 40 });

    assert.equal(child.parentId, root.id);
    assert.deepEqual(root.children.map((n) => n.id), [child.id]);

    trail.setMode('tree');
    assert.equal(child.parentId, root.id);
});

test('활성 노드는 트리에 있는 노드만 될 수 있다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol());
    assert.equal(trail.setActiveNode('00000000-0000-4000-8000-000000000000'), false);
    assert.equal(trail.activeNodeId, null);
    assert.equal(trail.setActiveNode(root.id), true);
    assert.equal(trail.activeNodeId, root.id);
});

test('ancestorsOf 는 루트부터 그 노드까지 준다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol({ name: 'A' }));
    const mid = trail.addChild(root.id, makeSymbol({ name: 'B' }), makeOrigin());
    const leaf = trail.addChild(mid.id, makeSymbol({ name: 'C' }), makeOrigin());

    assert.deepEqual(trail.ancestorsOf(leaf.id).map((n) => n.symbol.name), ['A', 'B', 'C']);
    assert.deepEqual(trail.ancestorsOf(root.id).map((n) => n.symbol.name), ['A']);
    assert.deepEqual(trail.ancestorsOf('없는-id'), []);
});

test('walk 는 부모 다음에 자식이 오는 순서다', () => {
    const trail = makeTrail();
    const a = trail.addRoot(makeSymbol({ name: 'A' }));
    const b = trail.addChild(a.id, makeSymbol({ name: 'B' }), makeOrigin());
    trail.addChild(b.id, makeSymbol({ name: 'C' }), makeOrigin());
    trail.addChild(a.id, makeSymbol({ name: 'D' }), makeOrigin());

    assert.deepEqual(trail.walk().map((n) => n.symbol.name), ['A', 'B', 'C', 'D']);
});

test('clear 는 전부 비우고, 이미 비어 있으면 revision 을 올리지 않는다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol());
    trail.setNodeUi(root.id, { boardX: 1 });

    assert.equal(trail.clear(), true);
    assert.equal(trail.isEmpty, true);
    assert.equal(trail.size, 0);
    assert.equal(trail.getNodeUi(root.id), undefined);

    const after = trail.revision;
    assert.equal(trail.clear(), false);
    assert.equal(trail.revision, after);
});

test('fromStructure 는 노드 ID 를 유지하고 부모 사슬을 다시 잇는다', () => {
    const rootId = '11111111-1111-4111-8111-111111111111';
    const childId = '22222222-2222-4222-8222-222222222222';
    const symbol = makeSymbol({ relPath: 'src/a.cpp', anchorLine: 1 });

    const trail = Trail.fromStructure({
        id: '33333333-3333-4333-8333-333333333333',
        title: '불러온 트레일',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        revision: 7,
        mode: 'board',
        activeNodeId: childId,
        roots: [
            {
                id: rootId,
                parentId: null,
                symbol,
                origin: null,
                collapsed: false,
                // 저장값이 틀려 있어도 다시 계산해 바로잡는다
                recursive: true,
                children: [
                    {
                        id: childId,
                        parentId: null,
                        symbol: { ...symbol },
                        origin: makeOrigin(),
                        collapsed: true,
                        recursive: false,
                        children: [],
                    },
                ],
            },
        ],
        nodeUi: {
            [childId]: { boardX: 5 },
            '99999999-9999-4999-8999-999999999999': { boardX: 1 },
        },
    });

    assert.equal(trail.revision, 7);
    assert.equal(trail.mode, 'board');
    assert.equal(trail.size, 2);
    assert.equal(trail.get(childId)?.parentId, rootId);
    assert.equal(trail.roots[0].recursive, false);
    assert.equal(trail.get(childId)?.recursive, true);
    assert.equal(trail.activeNodeId, childId);
    // 트리에 없는 노드의 화면 상태는 버린다
    assert.deepEqual(trail.nodeUiEntries(), [[childId, { boardX: 5 }]]);
});

test('fromStructure 는 트리에 없는 활성 노드를 버린다', () => {
    const trail = Trail.fromStructure({
        id: '33333333-3333-4333-8333-333333333333',
        title: 't',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        revision: 1,
        mode: 'tree',
        activeNodeId: '99999999-9999-4999-8999-999999999999',
        roots: [],
        nodeUi: {},
    });
    assert.equal(trail.activeNodeId, null);
});

test('지운 서브트리를 되돌리면 ID·자리·화면 상태가 그대로다', () => {
    // 되돌리기의 값은 "지우기 전과 똑같이" 돌아오는 것이다. 노드 ID 가 바뀌면
    // 보드 좌표와 분석 기록 대상이 끊기고, 형제 순서가 바뀌면 부모 호출부의
    // ①②③ 이 다른 자식을 가리킨다.
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol({ name: 'Root' }));
    const first = trail.addChild(root.id, makeSymbol({ name: 'First' }), makeOrigin({ line: 1 }));
    const mid = trail.addChild(root.id, makeSymbol({ name: 'Mid' }), makeOrigin({ line: 2 }));
    const last = trail.addChild(root.id, makeSymbol({ name: 'Last' }), makeOrigin({ line: 3 }));
    const leaf = trail.addChild(mid.id, makeSymbol({ name: 'Leaf' }), makeOrigin({ line: 9 }));
    trail.setNodeUi(mid.id, { boardX: 40, boardY: 80 });
    trail.setCollapsed(leaf.id, true);
    const before = trail.walk().map((node) => [node.id, node.parentId, node.collapsed]);

    const removed = trail.remove(mid.id);
    assert.equal(removed.index, 1);
    assert.equal(removed.count, 2);
    assert.deepEqual(trail.roots[0].children.map((n) => n.id), [first.id, last.id]);

    const restored = trail.insertSubtree(
        removed.parentId, removed.root, removed.index, removed.nodeUi,
    );
    assert.equal(restored.id, mid.id);
    assert.deepEqual(trail.walk().map((node) => [node.id, node.parentId, node.collapsed]), before);
    assert.deepEqual(trail.roots[0].children.map((n) => n.id), [first.id, mid.id, last.id]);
    assert.deepEqual(trail.getNodeUi(mid.id), { boardX: 40, boardY: 80 });
    assert.equal(trail.get(leaf.id).origin.line, 9);
});

test('부모가 사라진 뒤에는 되돌릴 자리가 없다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol());
    const mid = trail.addChild(root.id, makeSymbol(), makeOrigin());
    const leaf = trail.addChild(mid.id, makeSymbol(), makeOrigin());

    const removed = trail.remove(leaf.id);
    trail.remove(mid.id);

    assert.equal(
        trail.insertSubtree(removed.parentId, removed.root, removed.index, removed.nodeUi),
        undefined,
    );
});

test('replaceSymbol 은 자식·진입 링크·접힘을 그대로 두고 재귀를 다시 센다', () => {
    // 파일이 바뀌어 본문을 다시 읽은 것이지 다른 심볼로 간 것이 아니다.
    // 자식을 버리면 그 아래 탐색이 통째로 사라진다.
    const trail = makeTrail();
    const outer = makeSymbol({ name: 'Loop', relPath: 'src/a.cpp', anchorLine: 4 });
    const root = trail.addRoot(outer);
    const mid = trail.addChild(root.id, makeSymbol({ name: 'Mid' }), makeOrigin({ line: 5 }));
    const leaf = trail.addChild(mid.id, makeSymbol({ name: 'Leaf' }), makeOrigin({ line: 6 }));
    trail.setCollapsed(mid.id, true);

    const replaced = trail.replaceSymbol(mid.id, { ...outer, code: 'void Loop() { /* new */ }' });
    assert.equal(replaced.id, mid.id);
    assert.equal(replaced.collapsed, true);
    assert.equal(replaced.origin.line, 5);
    assert.deepEqual(replaced.children.map((n) => n.id), [leaf.id]);
    // 루트와 같은 심볼이 되었으니 재귀다.
    assert.equal(symbolKey(replaced.symbol), symbolKey(root.symbol));
    assert.equal(trail.get(mid.id).recursive, true);
});

test('형제 정렬은 트레일에 남되 revision 을 올리지 않는다', () => {
    const trail = makeTrail();
    trail.addRoot(makeSymbol());
    const before = trail.revision;

    assert.equal(trail.setChildOrder('click'), true);
    assert.equal(trail.childOrder, 'click');
    assert.equal(trail.revision, before);
    // 같은 값은 아무 일도 하지 않는다.
    assert.equal(trail.setChildOrder('click'), false);
});

test('승격을 되돌리면 부모·인덱스·진입 링크·재귀 표시가 그대로다', () => {
    // `⇱` 는 관계를 바꾸는 유일한 동작이다. 되돌릴 수 없으면 잘못 떼어낸
    // 서브트리를 원래 자리로 되돌릴 길이 없다(V10).
    const trail = makeTrail();
    const shared1 = makeSymbol({ name: 'Shared', relPath: 'src/s.cpp', anchorLine: 3 });
    const root = trail.addRoot(shared1);
    trail.addChild(root.id, makeSymbol({ name: 'First' }), makeOrigin());
    const mid = trail.addChild(root.id, makeSymbol({ name: 'Mid' }), makeOrigin({ text: 'Mid' }));
    const leaf = trail.addChild(mid.id, shared1, makeOrigin());

    assert.equal(leaf.recursive, true);
    const record = trail.promoteToRoot(mid.id);
    assert.equal(leaf.recursive, false);

    assert.equal(trail.undoPromote(record), true);
    assert.equal(mid.parentId, root.id);
    assert.equal(root.children.indexOf(mid), 1);
    assert.deepEqual(mid.origin, makeOrigin({ text: 'Mid' }));
    assert.deepEqual(trail.roots.map((n) => n.id), [root.id]);
    // 조상 사슬이 되돌아왔으니 재귀 표시도 되돌아와야 한다.
    assert.equal(leaf.recursive, true);
});

test('승격 되돌리기는 부모가 사라졌으면 거절한다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol({ name: 'Root' }));
    const mid = trail.addChild(root.id, makeSymbol({ name: 'Mid' }), makeOrigin());
    const record = trail.promoteToRoot(mid.id);
    trail.remove(root.id);

    assert.equal(trail.undoPromote(record), false);
});

test('보드 배치 초기화는 좌표만 지우고 revision 을 올리지 않는다', () => {
    // 좌표는 화면 상태다. revision 을 올리면 배치를 정리한 것만으로 날아가던
    // 구조 명령이 거절된다(V11).
    const trail = makeTrail();
    const node = trail.addRoot(makeSymbol({ name: 'A' }));
    trail.setNodeUi(node.id, { boardX: 40, boardY: 60, bodyHeight: 200 });
    const before = trail.revision;

    assert.equal(trail.placedNodeCount(), 1);
    assert.equal(trail.resetBoardLayout(), 1);

    assert.equal(trail.revision, before);
    assert.equal(trail.placedNodeCount(), 0);
    // 본문 높이는 배치와 상관없는 값이라 남는다.
    assert.equal(trail.getNodeUi(node.id)?.bodyHeight, 200);
    assert.equal(trail.resetBoardLayout(), 0);
});
