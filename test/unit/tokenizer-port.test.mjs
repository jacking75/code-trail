/* TS 토크나이저 이식 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

const { tokenizeLines, isClickable } = await import(
    new URL('../../packages/web/lib/tokenizer/tokenize.js', import.meta.url).href
);

function tokenize(code, languageId = 'cpp', options = {}) {
    return tokenizeLines(code, {
        languageId,
        startLine: options.startLine ?? 0,
        clickTarget: options.clickTarget ?? 'allSymbols',
    });
}

/** 클릭 가능한 토큰만. 확장 시절 테스트가 보던 것과 같은 대상이다. */
function clickable(code, languageId = 'cpp', options = {}) {
    return tokenize(code, languageId, options)
        .flat()
        .filter(isClickable)
        .map((token) => ({ text: token.text, line: token.line, char: token.char }));
}

/** 줄을 다시 이어 붙인다. 원본과 같아야 한다. */
function rejoin(lines) {
    return lines.map((tokens) => tokens.map((t) => t.text).join('')).join('\n');
}

test('입력 줄 수와 출력 줄 수가 같다', () => {
    const code = 'a\n\nb\n';
    assert.equal(tokenize(code).length, code.split('\n').length);
});

test('토큰을 이어 붙이면 원본이 그대로 나온다', () => {
    const samples = [
        '\tif (x) { return; }',
        '// 한글 주석 🚀',
        'auto* p = new Foo("문자열", 42);',
        'const char* s = "a\\"b";',
        '\t\treturn it == map_.end() ? nullptr : it->second.get();',
        '',
    ];
    for (const code of samples) {
        assert.equal(rejoin(tokenize(code)), code, JSON.stringify(code));
    }
});

test('주석 안의 단어는 클릭 대상이 아니다', () => {
    const words = clickable('// Dispatch 를 부른다\nDispatch();').map((t) => t.text);
    assert.deepEqual(words, ['Dispatch']);
});

test('여러 줄 블록 주석 전체가 빠진다', () => {
    const words = clickable([
        '/* Alpha',
        '   Beta */',
        'Gamma();',
    ].join('\n')).map((t) => t.text);
    assert.deepEqual(words, ['Gamma']);
});

test('문자열 안의 단어는 클릭 대상이 아니다', () => {
    const words = clickable('LOG("Dispatch failed", Handler);').map((t) => t.text);
    assert.deepEqual(words, ['LOG', 'Handler']);
});

test('예약어는 클릭 대상이 아니다', () => {
    const words = clickable('if (handler == nullptr) return;').map((t) => t.text);
    assert.deepEqual(words, ['handler']);
});

test('좌표가 원본 파일 기준이다', () => {
    const code = ['void f() {', '\tg();', '}'].join('\n');
    const found = clickable(code, 'cpp', { startLine: 120 });
    const g = found.find((t) => t.text === 'g');
    assert.equal(g.line, 121);
    // 탭이 한 칸이다. 원본을 변형하지 않았으므로 컬럼도 원본 기준이다.
    assert.equal(g.char, 1);
});

test('탭·한글·이모지가 섞인 줄에서 UTF-16 컬럼이 맞다', () => {
    const line = '\t// 한글 🚀\n\tHandlePacket(x);';
    const found = clickable(line);
    const target = found.find((t) => t.text === 'HandlePacket');
    assert.equal(target.line, 1);
    assert.equal(target.char, 1);

    // surrogate pair 뒤의 식별자도 UTF-16 코드 단위로 센다.
    // 이모지는 2 코드 단위라, 글자 수로 세면 컬럼이 하나 밀린다.
    const withEmoji = '\tint 값 = 🚀 Foo(1);';
    const foo = clickable(withEmoji).find((t) => t.text === 'Foo');
    assert.ok(foo, '식별자를 못 찾았다');
    assert.equal(withEmoji.slice(foo.char, foo.char + 3), 'Foo');
});

test('비ASCII 글자는 식별자의 일부로 본다', () => {
    // 한글 변수명을 쓰는 코드가 있다. 확장과 같은 규칙을 유지한다.
    const words = clickable('int 값 = 계산();').map((t) => t.text);
    assert.equal(words.includes('값'), true);
    assert.equal(words.includes('계산'), true);
});

test('C++ raw 문자열 안의 단어를 빼낸다', () => {
    const code = 'auto q = R"sql(SELECT Dispatch FROM t)sql"; Real();';
    const words = clickable(code).map((t) => t.text);
    assert.deepEqual(words, ['q', 'Real']);
});

test('Rust raw 문자열과 라이프타임을 다룬다', () => {
    const code = 'let q = r#"SELECT Dispatch"#; foo::<\'a>(bar);';
    const words = clickable(code, 'rust').map((t) => t.text);
    assert.equal(words.includes('Dispatch'), false);
    assert.equal(words.includes('foo'), true);
    assert.equal(words.includes('bar'), true);
});

test('C# verbatim 문자열을 다룬다', () => {
    const code = 'var s = @"C:\\Dispatch\\path"; Real();';
    const words = clickable(code, 'csharp').map((t) => t.text);
    assert.equal(words.includes('Dispatch'), false);
    assert.equal(words.includes('Real'), true);
});

test('Go 백틱 문자열을 다룬다', () => {
    const code = 'const q = `SELECT Dispatch FROM t`\nreal()';
    const words = clickable(code, 'go').map((t) => t.text);
    assert.equal(words.includes('Dispatch'), false);
    assert.equal(words.includes('real'), true);
});

test('callsOnly 는 호출부만 클릭 가능하게 한다', () => {
    const code = 'auto* handler = g_registry.Find(pkt->opcode);';
    const all = clickable(code, 'cpp').map((t) => t.text);
    const calls = clickable(code, 'cpp', { clickTarget: 'callsOnly' }).map((t) => t.text);

    assert.equal(all.includes('handler'), true);
    assert.equal(calls.includes('handler'), false);
    assert.equal(calls.includes('Find'), true);
});

test('토큰 종류를 구분한다', () => {
    const kinds = (code, lang = 'cpp') =>
        tokenize(code, lang).flat().map((t) => `${t.kind}:${t.text}`);

    assert.equal(kinds('return 42;').includes('kw:return'), true);
    assert.equal(kinds('return 42;').includes('nu:42'), true);
    assert.equal(kinds('#include <x>').includes('pp:#include'), true);
    assert.equal(kinds("let x = 'a; y", 'rust').includes("lt:'a"), true);
    assert.equal(kinds('Foo();').some((k) => k.startsWith('fn:Foo')), true);
    assert.equal(kinds('Foo bar;').some((k) => k.startsWith('ty:Foo')), true);
});

test('HTML 을 만들지 않는다 — 토큰 텍스트는 원문 그대로다', () => {
    // 확장은 문자열 HTML 을 만들어 이스케이프해야 했다. 이제는 React 가 그린다.
    const code = 'if (a < b && c > d) { x(); }';
    const rejoined = rejoin(tokenize(code));
    assert.equal(rejoined, code);
    assert.equal(rejoined.includes('&lt;'), false);
    assert.equal(rejoined.includes('&amp;'), false);
});
