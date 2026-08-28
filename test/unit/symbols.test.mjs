/* 심볼 선택과 본문 범위 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

const flatten = await import(
    new URL('../../packages/server/dist/symbols/flatten.js', import.meta.url).href
);
const select = await import(
    new URL('../../packages/server/dist/symbols/select.js', import.meta.url).href
);
const body = await import(
    new URL('../../packages/server/dist/symbols/body.js', import.meta.url).href
);
const declaration = await import(
    new URL('../../packages/server/dist/symbols/declaration.js', import.meta.url).href
);
const locations = await import(
    new URL('../../packages/server/dist/symbols/locations.js', import.meta.url).href
);
const word = await import(
    new URL('../../packages/server/dist/symbols/word.js', import.meta.url).href
);

const at = (line, character) => ({ line, character });
const range = (sl, sc, el, ec) => ({ start: at(sl, sc), end: at(el, ec) });

// ── 평탄화 ──────────────────────────────────────────────────────────────────

test('DocumentSymbol 계층을 깊이와 부모 이름과 함께 편다', () => {
    const raw = [
        {
            name: 'HandlerRegistry',
            detail: 'class',
            kind: 5,
            range: range(0, 0, 9, 1),
            selectionRange: range(0, 6, 0, 21),
            children: [
                {
                    name: 'Find',
                    detail: '(uint16_t) -> IHandler*',
                    kind: 6,
                    range: range(3, 0, 7, 1),
                    selectionRange: range(3, 10, 3, 14),
                    children: [],
                },
            ],
        },
    ];
    const flat = flatten.flattenDocumentSymbols(raw, 20);
    assert.equal(flat.length, 2);
    assert.equal(flat[0].depth, 0);
    assert.equal(flat[1].depth, 1);
    assert.equal(flat[1].container, 'HandlerRegistry');
    assert.equal(flat[1].detail, '(uint16_t) -> IHandler*');
});

test('SymbolInformation 은 containerName 을 container 로 쓴다', () => {
    // 예전에는 이걸 detail 에 넣어서 함수 헤더에 클래스명이 딸려 나왔다.
    const raw = [
        {
            name: 'Find',
            kind: 6,
            containerName: 'HandlerRegistry',
            location: { uri: 'file:///a.cpp', range: range(3, 0, 7, 1) },
        },
    ];
    const flat = flatten.flattenDocumentSymbols(raw, 20);
    assert.equal(flat[0].container, 'HandlerRegistry');
    assert.equal(flat[0].detail, '');
    assert.equal(flat[0].depth, 0);
    // 이름 범위를 따로 안 주므로 전체 범위로 대신한다.
    assert.deepEqual(flat[0].selectionRange, flat[0].range);
});

test('selectionRange 가 없거나 이상하면 range 로 되돌린다', () => {
    const raw = [
        { name: 'A', kind: 12, range: range(1, 0, 3, 0) },
        { name: 'B', kind: 12, range: range(4, 0, 6, 0), selectionRange: { start: {} } },
    ];
    const flat = flatten.flattenDocumentSymbols(raw, 20);
    assert.deepEqual(flat[0].selectionRange, flat[0].range);
    assert.deepEqual(flat[1].selectionRange, flat[1].range);
});

test('문서 범위를 벗어난 심볼은 잘라 쓰지 않고 뺀다', () => {
    const raw = [
        { name: '정상', kind: 12, range: range(1, 0, 3, 0), children: [] },
        { name: '범위밖', kind: 12, range: range(900, 0, 999, 0), children: [] },
    ];
    const flat = flatten.flattenDocumentSymbols(raw, 20);
    assert.deepEqual(flat.map((s) => s.name), ['정상']);
});

test('범위가 없는 심볼은 후보가 못 된다', () => {
    const flat = flatten.flattenDocumentSymbols([{ name: 'A', kind: 12 }], 20);
    assert.deepEqual(flat, []);
});

test('배열이 아니면 빈 목록이다', () => {
    assert.deepEqual(flatten.flattenDocumentSymbols(null), []);
    assert.deepEqual(flatten.flattenDocumentSymbols(undefined), []);
    assert.deepEqual(flatten.flattenDocumentSymbols({ nope: 1 }), []);
});

// ── 선택 규칙 ───────────────────────────────────────────────────────────────

function symbol(overrides) {
    return {
        name: 'X',
        detail: '',
        container: '',
        kind: 12,
        range: range(0, 0, 10, 0),
        selectionRange: range(0, 0, 0, 1),
        depth: 0,
        ...overrides,
    };
}

test('narrower 는 줄 범위가 좁은 것을 앞에 둔다', () => {
    const wide = symbol({ name: '넓음', range: range(0, 0, 20, 0) });
    const narrow = symbol({ name: '좁음', range: range(5, 0, 8, 0) });
    assert.deepEqual([wide, narrow].sort(select.narrower).map((s) => s.name), ['좁음', '넓음']);
});

test('범위가 같으면 더 깊은 것을 앞에 둔다', () => {
    const shallow = symbol({ name: '얕음', depth: 0 });
    const deep = symbol({ name: '깊음', depth: 2 });
    assert.deepEqual([shallow, deep].sort(select.narrower).map((s) => s.name), ['깊음', '얕음']);
});

test('계층 없는 응답에서도 메서드가 클래스보다 먼저 걸린다', () => {
    // SymbolInformation 은 전부 depth 0 이다. depth 만으로 정렬하면 클래스가
    // 먼저 나와 클래스 코드가 통째로 펼쳐진다.
    const klass = symbol({ name: 'HandlerRegistry', kind: 5, range: range(0, 0, 9, 1) });
    const method = symbol({ name: 'Find', kind: 6, range: range(3, 0, 7, 1) });
    const picked = select.pickEnclosing([klass, method], at(5, 4));
    assert.equal(picked.name, 'Find');
});

test('pickEnclosing 은 감싸는 것 중 가장 좁은 것을 준다', () => {
    const klass = symbol({ name: 'C', kind: 5, range: range(0, 0, 20, 0) });
    const method = symbol({ name: 'm', kind: 6, range: range(5, 0, 10, 0), depth: 1 });
    const field = symbol({ name: 'f', kind: 8, range: range(2, 0, 2, 30), depth: 1 });

    assert.equal(select.pickEnclosing([klass, method, field], at(7, 0)).name, 'm');
    // 필드를 클릭하면 그 한 줄만 보여주는 게 맞다.
    assert.equal(select.pickEnclosing([klass, method, field], at(2, 5)).name, 'f');
    assert.equal(select.pickEnclosing([klass], at(99, 0)), undefined);
});

test('pickEnclosingBody 는 지역 변수 대신 감싸는 함수를 준다', () => {
    const fn = symbol({ name: 'f', kind: 12, range: range(0, 0, 20, 0) });
    const local = symbol({ name: 'x', kind: 13, range: range(5, 0, 5, 20), depth: 1 });

    assert.equal(select.pickEnclosingBody([fn, local], at(5, 4)).name, 'f');
    // 몸통 종류가 하나도 없으면 가장 좁은 것으로 되돌아간다.
    assert.equal(select.pickEnclosingBody([local], at(5, 4)).name, 'x');
});

test('pickByDeclaration 은 이름 범위를 먼저 본다', () => {
    const klass = symbol({ name: 'C', kind: 5, range: range(0, 0, 20, 0), selectionRange: range(0, 6, 0, 7) });
    const method = symbol({
        name: 'm',
        kind: 6,
        range: range(5, 0, 10, 0),
        selectionRange: range(5, 10, 5, 11),
        depth: 1,
    });
    assert.equal(select.pickByDeclaration([klass, method], at(5, 10)).name, 'm');
    // 이름 범위에 안 걸리면 전체 범위로 되돌아간다.
    assert.equal(select.pickByDeclaration([klass, method], at(7, 0)).name, 'm');
});

// ── 본문 범위 ───────────────────────────────────────────────────────────────

const lines40 = Array.from({ length: 40 }, (_, i) => `줄 ${i}`);

test('다중 행 range 는 그대로 쓰고 근사가 아니다', () => {
    const result = body.chooseBodyRange({
        symbol: symbol({ range: range(3, 0, 7, 1), kind: 12 }),
        fallbackLine: 3,
        allSymbols: [],
        lineCount: 40,
        contextLines: 40,
    });
    assert.deepEqual(result, { startLine: 3, endLine: 7, approximate: false });
});

test('한 줄 range 는 LocationLink 의 targetRange 로 보정한다', () => {
    const result = body.chooseBodyRange({
        symbol: symbol({ range: range(3, 0, 3, 60), kind: 12 }),
        fallbackLine: 3,
        allSymbols: [],
        hintRange: range(3, 0, 9, 1),
        lineCount: 40,
        contextLines: 40,
    });
    assert.deepEqual(result, { startLine: 3, endLine: 9, approximate: true });
});

test('힌트가 없으면 다음 심볼 바로 앞 줄까지', () => {
    const target = symbol({ name: 'f', range: range(3, 0, 3, 60), kind: 12, depth: 1 });
    const next = symbol({ name: 'g', range: range(12, 0, 20, 0), kind: 12, depth: 1 });
    // 이 심볼 안쪽(지역 변수)은 경계가 아니다.
    const inner = symbol({ name: 'x', range: range(5, 0, 5, 10), kind: 13, depth: 2 });

    const result = body.chooseBodyRange({
        symbol: target,
        fallbackLine: 3,
        allSymbols: [target, inner, next],
        lineCount: 40,
        contextLines: 40,
    });
    assert.deepEqual(result, { startLine: 3, endLine: 11, approximate: true });
});

test('다음 심볼도 없으면 contextLines 만큼', () => {
    const target = symbol({ range: range(3, 0, 3, 60), kind: 12 });
    const result = body.chooseBodyRange({
        symbol: target,
        fallbackLine: 3,
        allSymbols: [target],
        lineCount: 40,
        contextLines: 5,
    });
    assert.deepEqual(result, { startLine: 3, endLine: 8, approximate: true });
});

test('원래 한 줄인 필드는 근사가 아니다', () => {
    const result = body.chooseBodyRange({
        symbol: symbol({ range: range(8, 2, 8, 30), kind: 8 }),
        fallbackLine: 8,
        allSymbols: [],
        lineCount: 40,
        contextLines: 40,
    });
    assert.deepEqual(result, { startLine: 8, endLine: 8, approximate: false });
});

test('심볼이 아예 없으면 위치 주변 contextLines 만큼', () => {
    const result = body.chooseBodyRange({
        symbol: undefined,
        fallbackLine: 10,
        allSymbols: [],
        lineCount: 40,
        contextLines: 6,
    });
    assert.deepEqual(result, { startLine: 10, endLine: 16, approximate: true });
});

test('문서 끝을 넘어가지 않는다', () => {
    const result = body.chooseBodyRange({
        symbol: undefined,
        fallbackLine: 38,
        allSymbols: [],
        lineCount: 40,
        contextLines: 100,
    });
    assert.equal(result.endLine, 39);
});

test('노드당 4,000줄 하드 캡이 걸린다', () => {
    assert.equal(body.MAX_TOTAL_LINES_HARD_CAP, 4000);
    const huge = Array.from({ length: 6000 }, (_, i) => `줄 ${i}`);
    const sliced = body.sliceLines(huge, { startLine: 0, endLine: 5999, approximate: false });
    assert.equal(sliced.capped, true);
    assert.equal(sliced.code.split('\n').length, 4001);
});

test('본문을 자를 때 원본을 변형하지 않는다', () => {
    const source = '\tif (x) {\n\t\t// 탭 유지 🚀\n\t}';
    const sliced = body.sliceLines(body.splitLines(source), {
        startLine: 0,
        endLine: 2,
        approximate: false,
    });
    assert.equal(sliced.code, source);
});

test('CRLF 는 줄을 나눌 때만 떼고 줄 안은 건드리지 않는다', () => {
    const lines = body.splitLines('a\r\nb\r\nc');
    assert.deepEqual(lines, ['a', 'b', 'c']);
    // 줄 가운데의 \r 은 남긴다 — 원본에 있던 문자다.
    assert.deepEqual(body.splitLines('a\rb\nc'), ['a\rb', 'c']);
});

// ── 선언만 판정 ─────────────────────────────────────────────────────────────

test('몸통 표지가 없는 callable 만 선언으로 본다', () => {
    assert.equal(declaration.isDeclarationOnly({
        callable: true,
        approximate: false,
        code: '    Task<bool> SendAsync(Packet packet, CancellationToken ct);',
    }), true);

    assert.equal(declaration.isDeclarationOnly({
        callable: true,
        approximate: false,
        code: 'void f() { return; }',
    }), false);
});

test('근사 본문은 선언으로 보지 않는다', () => {
    // 근사 본문은 함수의 첫 줄만 담을 수 있다. 그 한 줄에 `{` 가 없다고
    // "선언뿐" 이라고 하면 몸통 있는 함수에 배지가 잘못 붙는다.
    assert.equal(declaration.isDeclarationOnly({
        callable: true,
        approximate: true,
        code: 'IHandler* HandlerRegistry::Find(uint16_t opcode) const',
    }), false);
});

test('callable 이 아니면 선언 판정을 하지 않는다', () => {
    assert.equal(declaration.isDeclarationOnly({
        callable: false,
        approximate: false,
        code: 'int x;',
    }), false);
});

// ── 위치 정규화 ─────────────────────────────────────────────────────────────

test('LocationLink 는 selection 과 본문 힌트를 함께 준다', () => {
    const result = locations.normalizeLocations([
        {
            targetUri: 'file:///w/a.cpp',
            targetRange: range(3, 0, 7, 1),
            targetSelectionRange: range(3, 10, 3, 14),
        },
    ]);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].selection, at(3, 10));
    assert.deepEqual(result[0].fullRange, range(3, 0, 7, 1));
});

test('Location 은 range 시작을 selection 으로 쓰고 힌트가 없다', () => {
    const result = locations.normalizeLocations([
        { uri: 'file:///w/a.cpp', range: range(3, 10, 3, 14) },
    ]);
    assert.deepEqual(result[0].selection, at(3, 10));
    assert.equal(result[0].fullRange, undefined);
});

test('배열이 아닌 단일 Location 도 받는다', () => {
    const result = locations.normalizeLocations({
        uri: 'file:///w/a.cpp',
        range: range(1, 0, 1, 4),
    });
    assert.equal(result.length, 1);
});

test('같은 위치의 중복을 지운다', () => {
    const one = { uri: 'file:///w/a.cpp', range: range(3, 10, 3, 14) };
    const result = locations.normalizeLocations([one, { ...one }, one]);
    assert.equal(result.length, 1);
});

test('원래 URI 를 표시용으로 보존한다', () => {
    const result = locations.normalizeLocations([
        { uri: 'file:///W/Proj/A.cpp', range: range(0, 0, 0, 1) },
    ]);
    // key 는 비교용이고 uri 는 원본 그대로다.
    assert.equal(result[0].uri, 'file:///W/Proj/A.cpp');
    assert.notEqual(result[0].key, undefined);
});

test('읽을 수 없는 스킴은 뺀다', () => {
    const all = locations.normalizeLocations([
        { uri: 'file:///w/a.cpp', range: range(0, 0, 0, 1) },
        { uri: 'jdt://contents/rt.jar', range: range(0, 0, 0, 1) },
    ]);
    assert.equal(all.length, 2);
    assert.equal(locations.onlyReadable(all).length, 1);
});

test('null 응답과 망가진 항목을 견딘다', () => {
    assert.deepEqual(locations.normalizeLocations(null), []);
    assert.deepEqual(locations.normalizeLocations([null, 3, {}, { uri: 5 }]), []);
});

// ── 식별자 꺼내기 ───────────────────────────────────────────────────────────

test('위치의 식별자를 꺼낸다', () => {
    const line = '    auto* handler = g_registry.Find(pkt->opcode);';
    assert.equal(word.wordAt(line, line.indexOf('Find')), 'Find');
    assert.equal(word.wordAt(line, line.indexOf('g_registry') + 3), 'g_registry');
    // 식별자 끝에 커서가 있으면 왼쪽 글자를 본다.
    assert.equal(word.wordAt(line, line.indexOf('Find') + 4), 'Find');
});

test('한글·이모지·surrogate pair 가 있는 줄에서도 UTF-16 컬럼으로 센다', () => {
    const line = '// 한글 🚀 주석 뒤 HandlePacket 호출';
    const column = line.indexOf('HandlePacket');
    assert.equal(word.wordAt(line, column), 'HandlePacket');
    // JavaScript 문자열 인덱스가 곧 UTF-16 코드 단위다 — LSP 에 그대로 넘길 수 있다.
    assert.equal(line.slice(column, column + 12), 'HandlePacket');
});

test('식별자가 아닌 자리에서는 빈 문자열', () => {
    assert.equal(word.wordAt('    ', 2), '');
    assert.equal(word.wordAt('a + b', 2), '');
    assert.equal(word.wordAt('', 0), '');
});
