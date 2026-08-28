/* Markdown 내보내기 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makeOrigin, makeSymbol, makeTrail, shared } from './helpers.mjs';

const { trailToMarkdown } = shared;

test('루트는 ##, 깊이가 늘면 제목도 한 단계씩 내려간다', () => {
    const trail = makeTrail();
    const a = trail.addRoot(makeSymbol({ name: 'A' }));
    const b = trail.addChild(a.id, makeSymbol({ name: 'B' }), makeOrigin());
    trail.addChild(b.id, makeSymbol({ name: 'C' }), makeOrigin());

    const md = trailToMarkdown(trail);
    assert.match(md, /^## A `function`$/m);
    assert.match(md, /^### B `function`$/m);
    assert.match(md, /^#### C `function`$/m);
});

test('제목 수준은 6 에서 멈춘다', () => {
    const trail = makeTrail();
    let parent = trail.addRoot(makeSymbol({ name: 'D0' }));
    for (let i = 1; i <= 8; i++) {
        parent = trail.addChild(parent.id, makeSymbol({ name: `D${i}` }), makeOrigin());
    }

    const md = trailToMarkdown(trail);
    assert.match(md, /^###### D8 /m);
    assert.equal(md.includes('####### '), false);
});

test('진입 링크와 경로:줄 이 1-based 로 나온다', () => {
    const trail = makeTrail();
    const root = trail.addRoot(makeSymbol({ name: 'Root' }));
    trail.addChild(
        root.id,
        makeSymbol({ name: 'Find', displayPath: 'proj/src/reg.cpp', anchorLine: 41 }),
        makeOrigin({ line: 126, text: 'Find' }),
    );

    const md = trailToMarkdown(trail);
    assert.match(md, /> 진입: 부모의 127번째 줄 `Find` 에서/);
    assert.match(md, /`proj\/src\/reg\.cpp:42`/);
});

test('재귀·선언만·근사가 배지로 나온다', () => {
    const trail = makeTrail();
    const symbol = makeSymbol({ name: 'Loop', relPath: 'src/a.cpp', anchorLine: 3 });
    const root = trail.addRoot(symbol);
    trail.addChild(
        root.id,
        { ...symbol, declarationOnly: true, approximate: true },
        makeOrigin(),
    );

    const md = trailToMarkdown(trail);
    assert.match(md, /^### Loop `function` _\(재귀, 선언만, 근사\)_$/m);
});

test('코드 블록 언어가 매핑된다', () => {
    const trail = makeTrail();
    trail.addRoot(makeSymbol({ languageId: 'csharp' }));
    trail.addRoot(makeSymbol({ languageId: 'typescript' }));
    trail.addRoot(makeSymbol({ languageId: '이상한언어' }));

    const md = trailToMarkdown(trail);
    assert.match(md, /^```csharp$/m);
    assert.match(md, /^```ts$/m);
    assert.match(md, /^```이상한언어$/m);
});

test('코드 안의 백틱 세 개가 펜스를 깨지 않는다', () => {
    const code = 'const doc = `\n```\n예시\n```\n`;';
    const trail = makeTrail();
    trail.addRoot(makeSymbol({ code, languageId: 'javascript' }));

    const md = trailToMarkdown(trail);
    assert.match(md, /^````js$/m);
    assert.equal(md.includes(code), true);
});

test('본문 코드를 변형하지 않는다', () => {
    const code = '\tvoid f() {\n\t\t// 탭 유지 🚀\n\t}';
    const trail = makeTrail();
    trail.addRoot(makeSymbol({ code }));

    assert.equal(trailToMarkdown(trail).includes(code), true);
});

test('문서 제목은 트레일 제목이고 인자로 덮어쓸 수 있다', () => {
    const trail = makeTrail({ title: '패킷 처리 흐름' });
    trail.addRoot(makeSymbol());

    assert.match(trailToMarkdown(trail), /^# 패킷 처리 흐름$/m);
    assert.match(trailToMarkdown(trail, { title: '다른 제목' }), /^# 다른 제목$/m);
});

test('빈 트레일도 제목만 있는 문서가 된다', () => {
    const md = trailToMarkdown(makeTrail({ title: '빈 것' }));
    assert.equal(md, '# 빈 것\n');
});
