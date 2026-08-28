/* 저장 스키마 round trip — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeOrigin, makeSymbol, makeTrail, shared } from './helpers.mjs';

const {
    TRAIL_SCHEMA_VERSION,
    fromStoredTrail,
    parseWith,
    storedTrailSchema,
    stringifyStoredTrail,
    toStoredTrail,
    toTrailSummary,
} = shared;

/** 재귀·근사·선언만·보드 좌표·외부 심볼이 모두 섞인 트레일. */
function buildSampleTrail() {
    const trail = makeTrail({ title: '샘플 트레일' });

    const rootSymbol = makeSymbol({
        name: 'HandlePacket',
        detail: '(Session*, Packet*) -> void',
        relPath: 'src/net/dispatch.cpp',
        displayPath: 'gameserver/src/net/dispatch.cpp',
        anchorLine: 120,
        startLine: 118,
        code: 'void HandlePacket(Session* sess, Packet* pkt) {\n\treturn;\n}',
        contentHash: 'a'.repeat(64),
        modifiedAt: '2026-01-01T00:00:00.000Z',
        documentId: 'doc-1',
    });
    const root = trail.addRoot(rootSymbol);

    const child = trail.addChild(
        root.id,
        makeSymbol({
            name: 'Find',
            container: 'HandlerRegistry',
            kind: 6,
            relPath: 'src/net/registry.cpp',
            displayPath: 'gameserver/src/net/registry.cpp',
            anchorLine: 41,
            declarationOnly: true,
            approximate: true,
            documentId: 'doc-2',
        }),
        makeOrigin({ line: 121, char: 31, text: 'Find' }),
    );

    // 재귀 노드
    trail.addChild(child.id, { ...rootSymbol }, makeOrigin({ line: 43, char: 8, text: 'HandlePacket' }));

    // 프로젝트 밖 심볼
    trail.addChild(
        root.id,
        makeSymbol({
            name: 'shared_lock',
            relPath: null,
            displayPath: '/usr/include/c++/13/shared_mutex',
            external: true,
            documentId: 'doc-3',
        }),
        makeOrigin({ line: 122, char: 4, text: 'shared_lock' }),
    );

    trail.setCollapsed(child.id, true);
    trail.setMode('board');
    trail.setNodeUi(child.id, { boardX: 640, boardY: 80, bodyHeight: 300 });
    trail.setNodeUi(root.id, { codeFontSize: 11 });
    trail.setActiveNode(child.id);

    return trail;
}

test('저장 → 불러오기 → 저장이 같은 바이트를 만든다', () => {
    const trail = buildSampleTrail();

    const first = stringifyStoredTrail(toStoredTrail(trail));
    const reloaded = fromStoredTrail(JSON.parse(first), () => '2026-01-01T00:00:00.000Z');
    const second = stringifyStoredTrail(toStoredTrail(reloaded));

    assert.equal(second, first);
});

test('round trip 이 트리 모양과 화면 상태를 그대로 되살린다', () => {
    const trail = buildSampleTrail();
    const reloaded = fromStoredTrail(toStoredTrail(trail));

    assert.equal(reloaded.id, trail.id);
    assert.equal(reloaded.title, trail.title);
    assert.equal(reloaded.revision, trail.revision);
    assert.equal(reloaded.mode, trail.mode);
    assert.equal(reloaded.activeNodeId, trail.activeNodeId);
    assert.equal(reloaded.size, trail.size);

    const before = trail.walk();
    const after = reloaded.walk();
    assert.deepEqual(
        after.map((n) => [n.id, n.parentId, n.collapsed, n.recursive, n.symbol.name]),
        before.map((n) => [n.id, n.parentId, n.collapsed, n.recursive, n.symbol.name]),
    );
    assert.deepEqual(reloaded.nodeUiEntries(), trail.nodeUiEntries());
});

test('본문 코드는 한 글자도 바뀌지 않는다', () => {
    const code = '\tif (x) {\n\t\t// 탭·한글·이모지 🚀\n\t}\n\r\n끝';
    const trail = makeTrail();
    trail.addRoot(makeSymbol({ code }));

    const reloaded = fromStoredTrail(toStoredTrail(trail));
    assert.equal(reloaded.roots[0].symbol.code, code);
});

test('저장 파일에 세션 documentId 가 남지 않는다', () => {
    const trail = buildSampleTrail();
    const json = stringifyStoredTrail(toStoredTrail(trail));

    assert.equal(json.includes('documentId'), false);
    assert.equal(json.includes('doc-1'), false);

    // 다시 읽으면 null 로 채워진다 — 서버가 세션마다 새로 발급한다
    const reloaded = fromStoredTrail(JSON.parse(json));
    for (const node of reloaded.walk()) {
        assert.equal(node.symbol.documentId, null);
    }
});

test('프로젝트 밖 심볼은 표시용 경로만 남는다', () => {
    const trail = buildSampleTrail();
    const stored = toStoredTrail(trail);
    const external = stored.roots[0].children.find((n) => n.symbol.external);

    assert.ok(external);
    assert.equal(external.symbol.relPath, null);
    assert.equal(external.symbol.displayPath, '/usr/include/c++/13/shared_mutex');
});

test('nodeUi 는 노드 ID 순서로 쓴다 — 옮긴 순서가 diff 를 흔들지 않는다', () => {
    const trail = makeTrail();
    const a = trail.addRoot(makeSymbol());
    const b = trail.addRoot(makeSymbol());
    const c = trail.addRoot(makeSymbol());

    // 일부러 뒤섞인 순서로 좌표를 준다
    trail.setNodeUi(c.id, { boardX: 3 });
    trail.setNodeUi(a.id, { boardX: 1 });
    trail.setNodeUi(b.id, { boardX: 2 });

    const keys = Object.keys(toStoredTrail(trail).nodeUi);
    assert.deepEqual(keys, [...keys].sort());
});

test('심볼 키 순서는 입력 객체의 순서와 무관하다', () => {
    const normal = makeSymbol({ name: 'Same', relPath: 'src/a.cpp', anchorLine: 1 });
    // 같은 값이지만 키 순서를 뒤집어 만든 객체
    const shuffled = Object.fromEntries(Object.entries(normal).reverse());

    const a = makeTrail();
    a.addRoot(normal);
    const b = makeTrail({ id: a.id });
    b.addRoot(shuffled);

    const ja = JSON.stringify(toStoredTrail(a).roots[0].symbol);
    const jb = JSON.stringify(toStoredTrail(b).roots[0].symbol);
    assert.equal(jb, ja);
});

test('저장 결과가 스키마를 통과한다', () => {
    const stored = toStoredTrail(buildSampleTrail());
    const parsed = parseWith(storedTrailSchema, stored);
    assert.equal(parsed.ok, true, JSON.stringify(parsed.error ?? {}, null, 2));
    assert.equal(stored.schemaVersion, TRAIL_SCHEMA_VERSION);
});

test('스키마는 UUID 가 아닌 노드 ID 를 막는다', () => {
    const stored = toStoredTrail(buildSampleTrail());
    stored.roots[0].id = '../../etc/passwd';

    const parsed = parseWith(storedTrailSchema, stored);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, 'INVALID_COMMAND');
});

test('확장의 version:1 파일은 새 스키마를 통과하지 못한다', () => {
    // 새 프로그램은 옛 형식을 읽지 않는다(구현서 3.2). 조용히 반쯤 읽히는 대신
    // 스키마에서 확실히 막히는지 확인한다.
    const legacy = JSON.parse(
        JSON.stringify({ version: 1, roots: [{ id: 'n1', parentId: null, children: [] }] }),
    );
    const parsed = parseWith(storedTrailSchema, legacy);
    assert.equal(parsed.ok, false);
});

test('저장 파일은 줄바꿈으로 끝난다', () => {
    const json = stringifyStoredTrail(toStoredTrail(buildSampleTrail()));
    assert.equal(json.endsWith('\n'), true);
    assert.equal(json.endsWith('\n\n'), false);
});

test('요약에는 본문 코드가 들어가지 않는다', () => {
    const trail = buildSampleTrail();
    const summary = toTrailSummary(trail);

    assert.equal(summary.id, trail.id);
    assert.equal(summary.nodeCount, 4);
    assert.equal(summary.rootCount, 1);
    assert.equal(JSON.stringify(summary).includes('HandlePacket'), false);
});
