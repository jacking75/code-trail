/* 웹뷰 UI 스모크 테스트 — node test/ui.test.js */
const path = require('path');
const { chromium } = require('playwright');

const sample = {
    type: 'setState',
    // panel.ts 의 readConfig() 가 보내는 것과 같은 모양으로 둔다
    config: {
        clickTarget: 'allSymbols', maxCodeLines: 250, showAbsolutePath: false,
        fontSize: 0, childOrder: 'source', fitToWidth: true, minFontSize: 8,
    },
    roots: [
        {
            id: 'n1', parentId: null, origin: null, collapsed: false, recursive: false,
            symbol: {
                name: 'HandlePacket', detail: '(Session*, Packet*) -> void', kind: 11,
                container: '', kindName: 'function', uri: 'file:///w/src/net/dispatch.cpp',
                relPath: 'gameserver/src/net/dispatch.cpp', fsPath: '/w/src/net/dispatch.cpp',
                languageId: 'cpp', startLine: 118, anchorLine: 120, anchorChar: 5,
                approximate: false, callable: true, declarationOnly: false,
                code: [
                    '// 클라이언트 패킷 진입점',
                    '// (주석 안의 Dispatch 는 클릭 대상이 아니다)',
                    'void HandlePacket(Session* sess, Packet* pkt) {',
                    '    if (!sess->IsAuthed()) {',
                    '        sess->Close("unauthenticated");',
                    '        return;',
                    '    }',
                    '',
                    '    auto* handler = g_registry.Find(pkt->opcode);',
                    '    if (handler == nullptr) {',
                    '        LOG_WARN("unknown opcode {}", pkt->opcode);',
                    '        return;',
                    '    }',
                    '    handler->Invoke(sess, pkt);',
                    '}',
                ].join('\n'),
            },
            children: [
                {
                    id: 'n2', parentId: 'n1',
                    origin: { line: 126, char: 31, text: 'Find' },
                    collapsed: false, recursive: false,
                    symbol: {
                        name: 'Find', detail: '(uint16_t) -> IHandler*', kind: 5,
                        // 메서드에도 클래스 정보는 실려 오지만 헤더에 표시하지 않는다
                        container: 'HandlerRegistry',
                        kindName: 'method', uri: 'file:///w/src/net/registry.cpp',
                        relPath: 'gameserver/src/net/registry.cpp', fsPath: '/w/src/net/registry.cpp',
                        languageId: 'cpp', startLine: 40, anchorLine: 41, anchorChar: 20,
                        approximate: false, callable: true, declarationOnly: false,
                        code: [
                            'IHandler* HandlerRegistry::Find(uint16_t opcode) const {',
                            '    std::shared_lock lock(mutex_);',
                            '    auto it = map_.find(opcode);',
                            '    return it == map_.end() ? nullptr : it->second.get();',
                            '}',
                        ].join('\n'),
                    },
                    children: [
                        {
                            id: 'n3', parentId: 'n2',
                            origin: { line: 42, char: 19, text: 'find' },
                            collapsed: false, recursive: true,
                            symbol: {
                                name: 'find', detail: '', container: '', kind: 5, kindName: 'method',
                                uri: 'file:///w/src/base/map.h',
                                relPath: 'gameserver/src/base/map.h',
                                fsPath: '/w/src/base/map.h', languageId: 'cpp',
                                startLine: 88, anchorLine: 88, anchorChar: 12,
                                approximate: true, callable: true, declarationOnly: false,
                                code: 'iterator find(const Key& k) { return Lookup(Hash(k)); }',
                            },
                            children: [],
                        },
                    ],
                },
                {
                    id: 'n4', parentId: 'n1',
                    origin: { line: 131, char: 13, text: 'Invoke' },
                    collapsed: false, recursive: false,
                    symbol: {
                        name: 'Invoke', detail: '', container: 'LoginHandler',
                        kind: 5, kindName: 'method',
                        uri: 'file:///w/src/handlers/login.go',
                        relPath: 'gameserver/src/handlers/login.go',
                        fsPath: '/w/src/handlers/login.go', languageId: 'go',
                        startLine: 12, anchorLine: 12, anchorChar: 17,
                        approximate: false, callable: true, declarationOnly: false,
                        code: [
                            'func (h *LoginHandler) Invoke(s *Session, p *Packet) {',
                            '\tconst q = `SELECT id FROM users WHERE token = $1`',
                            '\trow := h.db.QueryRow(q, p.Token)',
                            '\tif err := row.Scan(&s.UserID); err != nil {',
                            '\t\ts.Close("bad token")',
                            '\t\treturn',
                            '\t}',
                            '}',
                        ].join('\n'),
                    },
                    children: [],
                },
            ],
        },
    ],
};

(async () => {
    const browser = await chromium.launch({
        executablePath: process.env.CT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
        args: ['--no-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); } });

    await page.goto('file://' + path.join(__dirname, 'preview.html'));
    await page.evaluate((msg) => window.postMessage(msg, '*'), sample);
    await page.waitForTimeout(400);

    let failures = 0;
    const check = (name, cond, extra) => {
        console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${!cond && extra ? ' — ' + extra : ''}`);
        if (!cond) { failures++; }
    };

    check('페이지 에러 없음', errors.length === 0, errors.join(' | '));

    const nodeCount = await page.locator('.node').count();
    check('노드 4개 렌더링', nodeCount === 4, String(nodeCount));

    const depth2 = await page.locator('.node .kids .node .kids .node').count();
    check('3단계 중첩 구조', depth2 === 1, String(depth2));

    check('재귀 배지 표시', await page.locator('.badge.rec').count() === 1);
    check('근사 배지 표시', await page.locator('.badge.approx').count() === 1);
    check('진입 경로 표시', await page.locator('.origin').count() === 3);

    // 줄 번호가 원본 파일 기준인지
    const firstLineNo = (await page.locator('.node[data-id="n1"] .code .cl .no').first().innerText()).trim();
    check('줄 번호가 원본 기준(119)', firstLineNo === '119', firstLineNo);

    // 클릭 → 메시지 발신
    await page.locator('.node[data-id="n1"] .clickable', { hasText: 'IsAuthed' }).first().click();
    await page.waitForTimeout(150);
    const posted = await page.evaluate(() => window.__posted);
    const resolveMsg = posted.filter((p) => p.type === 'resolve').pop();
    check('클릭 시 resolve 메시지 발신', !!resolveMsg, JSON.stringify(posted.slice(-3)));
    check('resolve에 올바른 nodeId', resolveMsg && resolveMsg.nodeId === 'n1');
    check('resolve에 원본 줄 번호', resolveMsg && resolveMsg.line === 121, resolveMsg && String(resolveMsg.line));
    check('resolve 텍스트', resolveMsg && resolveMsg.text === 'IsAuthed', resolveMsg && resolveMsg.text);

    // 브레드크럼
    const crumbs = await page.locator('#breadcrumb .crumb').count();
    check('브레드크럼 생성', crumbs >= 1, String(crumbs));

    // ---- 경로: 저장소 루트부터 끝까지, 생략 없이 ----
    console.log('\n  [파일 경로 표시]');
    const locText = (await page.locator('.node[data-id="n2"] > .hd > .loc').innerText()).trim();
    check('경로가 저장소 루트부터 시작',
        locText === 'gameserver/src/net/registry.cpp:42', locText);
    const locClipped = await page.locator('.node[data-id="n2"] > .hd > .loc').evaluate(
        (e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis');
    check('경로가 잘리지 않음', locClipped === false);

    // ---- 클래스 정보는 클래스류 노드에서만 ----
    console.log('\n  [클래스 정보 표시]');
    check('메서드 노드에는 클래스 정보 없음',
        await page.locator('.node[data-id="n2"] > .hd > .container').count() === 0);
    check('함수 노드에도 없음',
        await page.locator('.node[data-id="n1"] > .hd > .container').count() === 0);

    await page.evaluate(() => window.postMessage({
        type: 'addRoot',
        node: {
            id: 'n30', parentId: null, origin: null, collapsed: false, recursive: false,
            symbol: {
                name: 'HandlerRegistry', detail: '', container: 'net', kind: 4,
                kindName: 'class', uri: 'file:///w/src/net/registry.h',
                relPath: 'gameserver/src/net/registry.h', fsPath: '/w/src/net/registry.h',
                languageId: 'cpp', startLine: 10, anchorLine: 10, anchorChar: 6,
                approximate: false, callable: true, declarationOnly: false,
                code: ['class HandlerRegistry {', 'public:', '    IHandler* Find(uint16_t) const;', '};'].join('\n'),
            },
            children: [],
        },
    }, '*'));
    await page.waitForTimeout(250);
    const containerText = (await page.locator('.node[data-id="n30"] > .hd > .container').innerText()).trim();
    check('클래스 노드에는 감싸는 이름 표시', containerText.indexOf('net') === 0, containerText);

    // ---- 형제 관계: A 안의 B, C 는 나란히 ----
    console.log('\n  [형제 관계]');
    const siblingIds = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.node[data-id="n1"] > .kids > .node'))
            .map((n) => n.dataset.id));
    check('A의 자식이 2개이고 같은 레벨', siblingIds.length === 2, JSON.stringify(siblingIds));
    check('B(Find)와 C(Invoke)가 형제', siblingIds.includes('n2') && siblingIds.includes('n4'));
    check('C가 B의 자식이 아님',
        await page.locator('.node[data-id="n2"] .node[data-id="n4"]').count() === 0);

    const treeLayout = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const parent = box('.node[data-id="n1"] > .hd');
        const leftChild = box('.node[data-id="n2"] > .hd');
        const rightChild = box('.node[data-id="n4"] > .hd');
        const root = document.querySelector('#root');
        return {
            parentAbove: parent.bottom < leftChild.top && parent.bottom < rightChild.top,
            childrenSameRow: Math.abs(leftChild.top - rightChild.top) < 2,
            childrenLeftToRight: leftChild.left < rightChild.left,
            horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
        };
    });
    check('부모가 자식보다 위에 배치됨', treeLayout.parentAbove, JSON.stringify(treeLayout));
    check('형제 자식이 같은 행에 배치됨', treeLayout.childrenSameRow, JSON.stringify(treeLayout));
    check('형제 자식이 좌우로 나란히 배치됨', treeLayout.childrenLeftToRight, JSON.stringify(treeLayout));
    check('넓어진 트리에 패널 수평 스크롤 영역이 생김',
        treeLayout.horizontalOverflow, JSON.stringify(treeLayout));
    check('트리 부모-자식 연결선이 그려짐', await page.locator('.tree-lines path').count() === 3);

    check('형제 순번 ①② 부여',
        (await page.locator('.node[data-id="n2"] > .hd > .idx').innerText()).trim() === '1' &&
        (await page.locator('.node[data-id="n4"] > .hd > .idx').innerText()).trim() === '2');

    check('부모 헤더에 분기 수 표시',
        (await page.locator('.node[data-id="n1"] > .hd > .cnt').innerText()).indexOf('2') !== -1);

    const visited = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.node[data-id="n1"] > .body .clickable.visited'))
            .map((t) => t.textContent + '#' + t.getAttribute('data-idx')));
    check('부모 코드의 호출부에 방문 표시', visited.length === 2, JSON.stringify(visited));
    check('방문 표시 순번이 자식 순번과 일치',
        visited.includes('Find#①') && visited.includes('Invoke#②'), JSON.stringify(visited));

    // 세 번째 형제를 코드상 더 앞줄(122)에 추가 → 코드 순서 정렬이면 맨 앞으로 와야 한다
    await page.evaluate(() => window.postMessage({
        type: 'addChild', parentId: 'n1',
        node: {
            id: 'n9', parentId: 'n1',
            origin: { line: 122, char: 14, text: 'Close' },
            collapsed: false, recursive: false,
            symbol: {
                name: 'Close', detail: '', container: 'Session', kind: 5, kindName: 'method',
                uri: 'file:///w/src/net/session.cpp',
                relPath: 'gameserver/src/net/session.cpp',
                fsPath: '/w/src/net/session.cpp', languageId: 'cpp',
                startLine: 200, anchorLine: 200, anchorChar: 14, approximate: false,
                callable: true, declarationOnly: false,
                code: 'void Session::Close(const char* reason) { socket_.Shutdown(); }',
            },
            children: [],
        },
    }, '*'));
    await page.waitForTimeout(300);

    const orderSource = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.node[data-id="n1"] > .kids > .node'))
            .map((n) => n.dataset.id));
    check('코드 순서 정렬: Close(122) → Find(126) → Invoke(131)',
        JSON.stringify(orderSource) === JSON.stringify(['n9', 'n2', 'n4']), JSON.stringify(orderSource));
    check('세 번째 추가 후 순번 재계산',
        (await page.locator('.node[data-id="n9"] > .hd > .idx').innerText()).trim() === '1' &&
        (await page.locator('.node[data-id="n2"] > .hd > .idx').innerText()).trim() === '2');

    await page.click('#btn-order');
    await page.waitForTimeout(250);
    const orderClick = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.node[data-id="n1"] > .kids > .node'))
            .map((n) => n.dataset.id));
    check('클릭 순서 정렬로 전환',
        JSON.stringify(orderClick) === JSON.stringify(['n2', 'n4', 'n9']), JSON.stringify(orderClick));
    await page.click('#btn-order');
    await page.waitForTimeout(250);

    // 진입 경로 링크 → 부모 호출부로 이동
    await page.locator('.node[data-id="n4"] .origin-link').click();
    await page.waitForTimeout(200);
    check('진입 경로 링크가 부모 호출부를 강조',
        await page.locator('.node[data-id="n1"] .clickable.flash-tok').count() === 1);

    // 형제 삭제 후 순번 재계산
    await page.locator('.node[data-id="n9"] > .hd [data-act="del"]').click();
    await page.waitForTimeout(250);
    check('삭제 후 순번 재계산',
        (await page.locator('.node[data-id="n2"] > .hd > .idx').innerText()).trim() === '1');
    const visitedAfter = await page.evaluate(() =>
        document.querySelectorAll('.node[data-id="n1"] > .body .clickable.visited').length);
    check('삭제된 호출부의 방문 표시 제거', visitedAfter === 2, String(visitedAfter));

    // Alt+클릭 → implementation
    await page.locator('.node[data-id="n4"] .clickable', { hasText: 'QueryRow' }).first().click({ modifiers: ['Alt'] });
    await page.waitForTimeout(150);
    const implMsg = (await page.evaluate(() => window.__posted)).filter((p) => p.type === 'resolve').pop();
    check('Alt+클릭 = implementation', implMsg && implMsg.mode === 'implementation', implMsg && implMsg.mode);

    // 접기
    await page.locator('.node[data-id="n2"] > .hd').click();
    await page.waitForTimeout(150);
    check('헤더 클릭으로 접힘', await page.locator('.node[data-id="n2"].collapsed').count() === 1);
    const n3visible = await page.locator('.node[data-id="n3"]').isVisible();
    check('접히면 자식도 숨겨짐', n3visible === false);
    await page.locator('.node[data-id="n2"] > .hd').click();
    await page.waitForTimeout(150);

    // 필터
    await page.fill('#filter', 'login');
    await page.waitForTimeout(200);
    check('필터로 hit 표시', await page.locator('.node.hit').count() === 1);
    check('필터로 dim 표시', await page.locator('.node.dim').count() >= 1);
    await page.fill('#filter', '');
    await page.waitForTimeout(200);

    // 전체 접기/펼치기
    await page.click('#btn-collapse');
    await page.waitForTimeout(150);
    check('전체 접기 (루트는 유지)', await page.locator('.node.collapsed').count() === 3);
    await page.click('#btn-expand');
    await page.waitForTimeout(200);
    check('전체 펼치기', await page.locator('.node.collapsed').count() === 0);

    // ---- C# 인터페이스 선언 케이스 (Roslyn이 이름에 시그니처를 통째로 넣는다) ----
    console.log('\n  [C# 인터페이스 선언]');
    const csharpName =
        'GetPublishedDetailAsync(string, string, CancellationToken, bool) : Task<ChallengeDetailDto?>';
    await page.evaluate((nm) => window.postMessage({
        type: 'addRoot',
        node: {
            id: 'n20', parentId: null, origin: null, collapsed: false, recursive: false,
            symbol: {
                name: nm, detail: '', container: 'IChallengeQueryService',
                kind: 5, kindName: 'method',
                uri: 'file:///w/Features/Challenges/ChallengeQueryService.cs',
                relPath: 'WorkWay/Features/Challenges/ChallengeQueryService.cs',
                fsPath: '/w/Features/Challenges/ChallengeQueryService.cs',
                languageId: 'csharp', startLine: 11, anchorLine: 11, anchorChar: 30,
                approximate: false, callable: true, declarationOnly: true,
                code: [
                    '    Task<ChallengeDetailDto?> GetPublishedDetailAsync(',
                    '        string id,',
                    '        string memberId,',
                    '        CancellationToken cancellationToken,',
                    '        bool applyPulseSurveyGate = true);',
                ].join('\n'),
            },
            children: [],
        },
    }, '*'), csharpName);
    await page.waitForTimeout(300);

    const nameText = (await page.locator('.node[data-id="n20"] > .hd > .name').innerText()).trim();
    check('긴 Roslyn 이름에서 메서드명만 추출',
        nameText === 'GetPublishedDetailAsync', nameText);
    const sigText = (await page.locator('.node[data-id="n20"] > .hd > .sig').innerText()).trim();
    check('시그니처는 별도 표시', sigText.startsWith('(string, string'), sigText);

    const hdBox = await page.locator('.node[data-id="n20"] > .hd').boundingBox();
    check('긴 이름에도 헤더가 부풀지 않음 (높이 < 34px)', hdBox.height < 34, String(hdBox.height));

    check('선언만 배지 표시', await page.locator('.node[data-id="n20"] .badge.decl').count() === 1);
    const implBtn = page.locator('.node[data-id="n20"] > .hd .act.impl');
    check('구현 보기 버튼 존재', await implBtn.count() === 1);
    check('선언 노드에서는 버튼이 항상 보임', await implBtn.evaluate(
        (b) => parseFloat(getComputedStyle(b).opacity) === 1));
    check('몸통 있는 노드는 hot 아님',
        await page.locator('.node[data-id="n1"] > .hd .act.impl.hot').count() === 0);

    await implBtn.click();
    await page.waitForTimeout(200);
    const implMsg2 = (await page.evaluate(() => window.__posted))
        .filter((p) => p.type === 'resolveImplementations').pop();
    check('구현 찾기 메시지 발신', implMsg2 && implMsg2.nodeId === 'n20',
        JSON.stringify(implMsg2));

    // 구현이 붙으면 자식으로 들어간다
    await page.evaluate(() => window.postMessage({
        type: 'addChild', parentId: 'n20',
        node: {
            id: 'n21', parentId: 'n20',
            origin: { line: 11, char: 30, text: 'GetPublishedDetailAsync' },
            collapsed: false, recursive: false,
            symbol: {
                name: 'GetPublishedDetailAsync(string, string, CancellationToken, bool) : Task<ChallengeDetailDto?>',
                detail: '', container: 'ChallengeQueryService', kind: 5, kindName: 'method',
                uri: 'file:///w/Features/Challenges/ChallengeQueryService.cs',
                relPath: 'WorkWay/Features/Challenges/ChallengeQueryService.cs',
                fsPath: '/w/Features/Challenges/ChallengeQueryService.cs',
                languageId: 'csharp', startLine: 47, anchorLine: 47, anchorChar: 40,
                approximate: false, callable: true, declarationOnly: false,
                code: [
                    '    public async Task<ChallengeDetailDto?> GetPublishedDetailAsync(',
                    '        string id, string memberId, CancellationToken ct, bool gate = true)',
                    '    {',
                    '        var challenge = await _repository.FindPublishedAsync(id, ct);',
                    '        if (challenge is null) return null;',
                    '        return challenge.ToDetailDto(gate);',
                    '    }',
                ].join('\n'),
            },
            children: [],
        },
    }, '*'));
    await page.waitForTimeout(250);
    check('구현이 선언의 자식으로 붙음',
        await page.locator('.node[data-id="n20"] > .kids > .node[data-id="n21"]').count() === 1);
    check('구현 노드는 선언만 배지 없음',
        await page.locator('.node[data-id="n21"] .badge.decl').count() === 0);

    // ---- 폭에 맞춰 코드 폰트 자동 축소 ----
    console.log('\n  [폭 맞춤]');
    const codeFont = () => page.evaluate(
        () => parseFloat(getComputedStyle(document.querySelector('.code')).fontSize));
    const overflowing = () => page.evaluate(() => Array.prototype.filter.call(
        document.querySelectorAll('.code'),
        (e) => e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1).length);
    const headerFont = () => page.evaluate(
        () => parseFloat(getComputedStyle(document.querySelector('.hd .name')).fontSize));

    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.waitForTimeout(250);
    const wideFont = await codeFont();
    const wideHeader = await headerFont();
    check('넓을 때는 가로로 넘치지 않음', await overflowing() === 0);

    await page.setViewportSize({ width: 430, height: 1000 });
    await page.waitForTimeout(250);
    const narrowFont = await codeFont();
    check('창을 좁히면 코드 글자가 작아진다', narrowFont < wideFont, `${wideFont} → ${narrowFont}`);
    check('좁혀도 코드가 가로로 넘치지 않는다 (하한에 걸린 경우는 예외)',
        await overflowing() === 0 || narrowFont <= 8.01, `font=${narrowFont}`);
    check('헤더 이름 글자는 그대로', Math.abs(await headerFont() - wideHeader) < 0.01,
        `${wideHeader} → ${await headerFont()}`);

    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.waitForTimeout(250);
    const backFont = await codeFont();
    check('다시 넓히면 원래 크기로 돌아온다', Math.abs(backFont - wideFont) < 0.2,
        `${wideFont} → ${backFont}`);

    // 수동 지정이 자동 맞춤보다 우선인지 (설정 일부만 보내도 나머지는 기본값으로 채워진다)
    await page.setViewportSize({ width: 430, height: 1000 });
    await page.evaluate(() => window.postMessage(
        { type: 'config', config: { fontSize: 20 } }, '*'));
    await page.waitForTimeout(250);
    check('codeTrail.fontSize 가 폭 맞춤보다 우선', Math.abs(await codeFont() - 20) < 0.01,
        String(await codeFont()));
    await page.evaluate(() => window.postMessage(
        { type: 'config', config: { fontSize: 0 } }, '*'));
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.waitForTimeout(250);
    check('수동 지정을 풀면 자동 맞춤으로 돌아온다', Math.abs(await codeFont() - wideFont) < 0.2,
        String(await codeFont()));

    // ---- 보드 모드: 자유 배치 ----
    console.log('\n  [보드 모드]');
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.waitForTimeout(150);
    await page.click('#btn-board');
    await page.waitForTimeout(300);

    check('보드 모드로 전환', await page.locator('#root.board').count() === 1);
    const allNodes = await page.locator('.node').count();
    const flatNodes = await page.locator('#root > .node').count();
    check('모든 노드가 캔버스 직속으로 펼쳐짐', allNodes === flatNodes, `${flatNodes}/${allNodes}`);
    check('부모-자식 연결선이 그려짐', await page.locator('.board-lines path').count() >= 1);

    const childId = await page.evaluate(() => {
        const el = Array.prototype.find.call(
            document.querySelectorAll('.node'), (n) => n.dataset.parent);
        return el ? el.dataset.id : null;
    });
    check('자식 노드를 찾음', !!childId, String(childId));

    const posOf = () => page.locator(`.node[data-id="${childId}"]`)
        .evaluate((e) => [e.offsetLeft, e.offsetTop]);
    const before = await posOf();
    const bb = await page.locator(`.node[data-id="${childId}"] > .hd`).boundingBox();
    await page.mouse.move(bb.x + 60, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + 60 + 180, bb.y + bb.height / 2 + 140, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await posOf();
    check('헤더를 끌면 노드가 따라온다',
        after[0] - before[0] > 120 && after[1] - before[1] > 90,
        `${before} → ${after}`);
    check('끌어 옮긴 뒤 접히지 않는다',
        await page.locator(`.node[data-id="${childId}"].collapsed`).count() === 0);
    check('옮긴 뒤에도 연결선 유지', await page.locator('.board-lines path').count() >= 1);

    await page.click('#btn-board');
    await page.waitForTimeout(300);
    check('트리 모드로 복귀', await page.locator('#root.board').count() === 0);
    check('부모 위·자식 아래 트리 구조가 되돌아옴',
        await page.locator('.node .kids .node').count() >= 1 &&
        await page.locator('.tree-lines path').count() >= 1);
    check('보드에서 돌아와도 노드 수 그대로', await page.locator('.node').count() === allNodes);

    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.waitForTimeout(250);

    await page.screenshot({ path: path.join(__dirname, '..', 'preview-dark.png'), fullPage: true });

    // 라이트 테마
    await page.evaluate(() => {
        document.body.classList.add('vscode-light');
        document.body.style.setProperty('--vscode-editor-background', '#ffffff');
        document.body.style.setProperty('--vscode-foreground', '#1f1f1f');
        document.body.style.setProperty('--vscode-editor-foreground', '#1f1f1f');
        document.body.style.setProperty('--vscode-textCodeBlock-background', '#f5f5f5');
        document.body.style.setProperty('--vscode-editorWidget-background', '#f3f3f3');
        document.body.style.setProperty('--vscode-input-background', '#ffffff');
        document.body.style.setProperty('--vscode-input-foreground', '#1f1f1f');
    });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(__dirname, '..', 'preview-light.png'), fullPage: true });

    console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
    await browser.close();
    process.exit(failures === 0 ? 0 : 1);
})();
