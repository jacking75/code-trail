/* 웹뷰 UI 스모크 테스트 — node test/ui.test.js */
const path = require('path');
const { chromium } = require('playwright');

const sample = {
    type: 'setState',
    config: { clickTarget: 'allSymbols', maxCodeLines: 250, showAbsolutePath: false, fontSize: 0 },
    roots: [
        {
            id: 'n1', parentId: null, origin: null, collapsed: false, recursive: false,
            symbol: {
                name: 'HandlePacket', detail: '(Session*, Packet*) -> void', kind: 11,
                kindName: 'function', uri: 'file:///w/src/net/dispatch.cpp',
                relPath: 'src/net/dispatch.cpp', fsPath: '/w/src/net/dispatch.cpp',
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
                        kindName: 'method', uri: 'file:///w/src/net/registry.cpp',
                        relPath: 'src/net/registry.cpp', fsPath: '/w/src/net/registry.cpp',
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
                                name: 'find', detail: '', kind: 5, kindName: 'method',
                                uri: 'file:///w/src/base/map.h', relPath: 'src/base/map.h',
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
                        name: 'Invoke', detail: '', kind: 5, kindName: 'method',
                        uri: 'file:///w/src/handlers/login.go', relPath: 'src/handlers/login.go',
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

    // ---- 형제 관계: A 안의 B, C 는 나란히 ----
    console.log('\n  [형제 관계]');
    const siblingIds = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.node[data-id="n1"] > .kids > .node'))
            .map((n) => n.dataset.id));
    check('A의 자식이 2개이고 같은 레벨', siblingIds.length === 2, JSON.stringify(siblingIds));
    check('B(Find)와 C(Invoke)가 형제', siblingIds.includes('n2') && siblingIds.includes('n4'));
    check('C가 B의 자식이 아님',
        await page.locator('.node[data-id="n2"] .node[data-id="n4"]').count() === 0);

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
                name: 'Close', detail: '', kind: 5, kindName: 'method',
                uri: 'file:///w/src/net/session.cpp', relPath: 'src/net/session.cpp',
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
                name: nm, detail: '', kind: 5, kindName: 'method',
                uri: 'file:///w/Features/Challenges/ChallengeQueryService.cs',
                relPath: 'Features/Challenges/ChallengeQueryService.cs',
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
    check('헤더가 한 줄로 유지 (높이 < 34px)', hdBox.height < 34, String(hdBox.height));

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
                detail: '', kind: 5, kindName: 'method',
                uri: 'file:///w/Features/Challenges/ChallengeQueryService.cs',
                relPath: 'Features/Challenges/ChallengeQueryService.cs',
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
