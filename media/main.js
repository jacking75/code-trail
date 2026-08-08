/* Code Trail — 웹뷰 클라이언트 */
(function () {
    'use strict';

    var vscode = acquireVsCodeApi();
    var rootEl = document.getElementById('root');
    var emptyEl = document.getElementById('empty');
    var crumbEl = document.getElementById('breadcrumb');
    var toastEl = document.getElementById('toast');
    var filterEl = document.getElementById('filter');

    var DEFAULTS = {
        clickTarget: 'allSymbols', maxCodeLines: 250, showAbsolutePath: false,
        fontSize: 0, childOrder: 'source', fitToWidth: true, minFontSize: 8,
    };

    /**
     * 확장이 보낸 설정에서 빠진 키를 기본값으로 채운다.
     * 통째로 갈아끼우면 확장에 새 설정이 생겼는데 옛 메시지가 오는 경우
     * (또는 test/preview.html 처럼 일부만 보내는 하네스)에서 undefined 가 된다.
     */
    function mergeConfig(next) {
        var out = {}, k;
        for (k in DEFAULTS) {
            if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) { out[k] = DEFAULTS[k]; }
        }
        if (next) {
            for (k in next) {
                if (Object.prototype.hasOwnProperty.call(next, k) && next[k] !== undefined) {
                    out[k] = next[k];
                }
            }
        }
        return out;
    }

    var config = mergeConfig(null);
    var nodes = Object.create(null); // id -> node data
    /**
     * 노드별로 사용자가 마우스로 맞춰 둔 것. `{ h: 본문 높이 px, fs: 코드 글자 px }`.
     * 노드 id 는 확장이 매기므로 setState 로 트리를 다시 그려도 같은 노드에 다시 붙는다.
     * 다만 JSON 으로 저장·복원하면 id 가 새로 매겨지므로 따라가지 않는다.
     */
    var uiState = Object.create(null);
    var activeId = null;
    var orderMode = 'source'; // 'source' = 코드에 나온 순서, 'click' = 내가 클릭한 순서
    var rootNodes = [];       // 루트 노드 데이터. 모드를 바꿔도 이걸로 다시 그린다
    var boardMode = false;    // true = 캔버스에 자유 배치, false = 중첩 트리
    var boardLines = null;    // 보드 모드의 부모-자식 연결선 <svg>

    // ---------------------------------------------------------------- 렌더링

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) { e.className = cls; }
        if (text !== undefined) { e.textContent = text; }
        return e;
    }

    function locLabel(sym) {
        var p = config.showAbsolutePath ? sym.fsPath : sym.relPath;
        return p + ':' + (sym.anchorLine + 1);
    }

    /**
     * 클래스 정보(감싸는 클래스·네임스페이스 이름)를 헤더에 띄울 노드인지.
     * 함수 노드에는 붙이지 않는다 — 클래스를 직접 펼쳤을 때만 보여준다.
     */
    var CLASS_LIKE = {
        'class': 1, 'struct': 1, 'interface': 1, 'enum': 1,
        'namespace': 1, 'module': 1, 'package': 1,
    };
    function showsContainer(sym) {
        return CLASS_LIKE[sym.kindName] === 1 && !!sym.container;
    }

    /**
     * 언어 서버마다 심볼 이름 형식이 다르다.
     * Roslyn(C#)은 "Foo(string, int) : Task<T>" 처럼 시그니처를 통째로 넣어 준다.
     * 헤더가 네 줄로 깨지지 않게 이름과 시그니처를 분리한다.
     */
    function splitName(sym) {
        var n = String(sym.name || '');
        var cut = n.indexOf('(');
        if (cut > 0) {
            return { name: n.slice(0, cut).trim(), sig: n.slice(cut).trim() };
        }
        return { name: n, sig: String(sym.detail || '').trim() };
    }

    function renderCode(sym) {
        var wrap = el('div', 'code');
        var lines = window.CTTokenizer.highlightLines(
            sym.code, sym.languageId, sym.startLine, config.clickTarget
        );
        var limit = config.maxCodeLines > 0 ? config.maxCodeLines : lines.length;
        var shown = Math.min(lines.length, limit);
        var gutterWidth = String(sym.startLine + lines.length).length;

        function appendRange(from, to) {
            var frag = document.createDocumentFragment();
            for (var i = from; i < to; i++) {
                var row = el('div', 'cl');
                var no = el('span', 'no', pad(sym.startLine + i + 1, gutterWidth));
                var tx = el('span', 'tx');
                tx.innerHTML = lines[i];
                row.appendChild(no);
                row.appendChild(tx);
                frag.appendChild(row);
            }
            wrap.appendChild(frag);
        }

        appendRange(0, shown);

        if (shown < lines.length) {
            var more = el('button', 'more', '… 나머지 ' + (lines.length - shown) + '줄 더 보기');
            more.addEventListener('click', function () {
                more.remove();
                appendRange(shown, lines.length);
                // 나중에 그려진 줄에도 방문 표시를 다시 입힌다
                refreshChildren(wrap.closest('.node'));
                // 더 긴 줄이 나왔을 수 있다
                scheduleFit();
            });
            wrap.appendChild(more);
        }
        return wrap;
    }

    function pad(n, w) {
        var s = String(n);
        while (s.length < w) { s = ' ' + s; }
        return s;
    }

    function renderNode(node, depth) {
        nodes[node.id] = node;

        var box = el('div', 'node');
        box.dataset.id = node.id;
        box.dataset.parent = node.parentId || '';
        box.dataset.depth = String(depth);
        if (node.collapsed) { box.classList.add('collapsed'); }

        // 헤더
        var hd = el('div', 'hd');
        hd.appendChild(el('span', 'chev', '▾'));
        hd.appendChild(el('span', 'idx', ''));   // 형제 중 몇 번째인지
        hd.appendChild(el('span', 'kind k-' + (node.symbol.kindName || 'symbol'), node.symbol.kindName || 'symbol'));

        if (showsContainer(node.symbol)) {
            var ctEl = el('span', 'container', node.symbol.container + ' ·');
            ctEl.title = '이 ' + node.symbol.kindName + ' 를 감싸는 ' + node.symbol.container;
            hd.appendChild(ctEl);
        }

        var parts = splitName(node.symbol);
        var nameEl = el('span', 'name', parts.name);
        nameEl.title = node.symbol.name;
        hd.appendChild(nameEl);
        hd.appendChild(el('span', 'cnt', ''));   // 이 노드에서 갈라진 자식 수
        if (parts.sig) {
            var sigEl = el('span', 'sig', parts.sig);
            sigEl.title = parts.sig;
            hd.appendChild(sigEl);
        }
        hd.appendChild(el('span', 'loc', locLabel(node.symbol)));
        if (node.recursive) {
            hd.appendChild(el('span', 'badge rec', '재귀'));
        }
        if (node.symbol.declarationOnly) {
            var dc = el('span', 'badge decl', '선언만');
            dc.title = '몸통이 없는 선언이다. ⚑ 를 눌러 실제 구현을 펼친다.';
            hd.appendChild(dc);
        }
        if (node.symbol.approximate) {
            var ap = el('span', 'badge approx', '근사');
            ap.title = '언어 서버가 이 심볼의 전체 범위를 알려주지 않아 주변 몇 줄만 보여준다.';
            hd.appendChild(ap);
        }
        hd.appendChild(el('span', 'spacer'));

        if (node.symbol.callable) {
            var implBtn = el('button', 'act impl' + (node.symbol.declarationOnly ? ' hot' : ''), '⚑');
            implBtn.title = node.symbol.declarationOnly
                ? '구현 보기 — 이 선언을 실제로 구현한 곳들을 자식으로 붙인다'
                : '구현/재정의 보기';
            implBtn.dataset.act = 'impl';
            hd.appendChild(implBtn);
        }

        if (node.parentId) {
            var rootBtn = el('button', 'act', '⇱');
            rootBtn.title = '새 루트로 떼어내기 — 이 노드를 트리 맨 위로 올린다 (하위 노드도 함께)';
            rootBtn.dataset.act = 'root';
            hd.appendChild(rootBtn);
        }

        var openBtn = el('button', 'act', '↗');
        openBtn.title = '에디터에서 열기';
        openBtn.dataset.act = 'open';
        hd.appendChild(openBtn);

        var delBtn = el('button', 'act', '✕');
        delBtn.title = '이 노드와 하위 노드 삭제';
        delBtn.dataset.act = 'del';
        hd.appendChild(delBtn);

        box.appendChild(hd);

        // 어디서 들어왔는지
        if (node.origin) {
            var parentName = nodes[node.parentId]
                ? splitName(nodes[node.parentId].symbol).name
                : '부모';
            var o = el('div', 'origin');
            var link = el('span', 'origin-link');
            link.appendChild(document.createTextNode('↑ ' + parentName + ' 의 '));
            link.appendChild(el('code', '', node.origin.line + 1 + '번째 줄 ' + node.origin.text));
            link.title = '부모의 해당 호출 지점으로 이동';
            link.addEventListener('click', function (ev) {
                ev.stopPropagation();
                jumpToCallSite(node.parentId, node.origin);
            });
            o.appendChild(link);
            box.appendChild(o);
        }

        // 본문
        var body = el('div', 'body');
        var codeEl = renderCode(node.symbol);
        applyNodeUi(node.id, codeEl);
        if (codeObserver) { codeObserver.observe(codeEl); }
        body.appendChild(codeEl);
        box.appendChild(body);

        // 자식. 보드 모드에서는 노드를 캔버스에 하나씩 늘어놓으므로 여기서 중첩하지 않는다.
        var kids = el('div', 'kids');
        if (!boardMode) {
            (node.children || []).forEach(function (c) {
                kids.appendChild(renderNode(c, depth + 1));
            });
        }
        box.appendChild(kids);

        return box;
    }

    /** 확장이 준 트리를 웹뷰 쪽 모델(nodes/rootNodes)에 등록한다. */
    function registerTree(node, parentId) {
        node.parentId = parentId;
        node.children = node.children || [];
        nodes[node.id] = node;
        node.children.forEach(function (c) { registerTree(c, node.id); });
    }

    function rebuild(roots) {
        nodes = Object.create(null);
        rootNodes = roots || [];
        rootNodes.forEach(function (r) { registerTree(r, null); });
        render();
    }

    /** 지금 모드에 맞게 트리 전체를 다시 그린다. 모델은 건드리지 않는다. */
    function render() {
        rootEl.textContent = '';
        boardLines = null;
        if (boardMode) {
            renderBoard();
        } else {
            rootEl.removeAttribute('style');
            rootNodes.forEach(function (r) { rootEl.appendChild(renderNode(r, 0)); });
        }
        refreshAll();
        updateEmpty();
        applyFilter();
    }

    // ------------------------------------------------- 형제 정렬 · 순번 · 방문 표시

    function seqOf(id) {
        return parseInt(String(id).slice(1), 10) || 0;
    }

    /** 1 → ①. 코드 안에 끼워 넣어도 한눈에 읽히도록. */
    function circled(n) {
        return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : '(' + n + ')';
    }

    /**
     * 그 노드의 자식 상자들. DOM 이 아니라 모델에서 찾는다 —
     * 보드 모드에서는 자식이 부모 안에 중첩돼 있지 않고 캔버스에 따로 놓이기 때문이다.
     */
    function childBoxes(parentBox) {
        var d = nodes[parentBox.dataset.id];
        if (!d || !d.children) { return []; }
        var out = [];
        d.children.forEach(function (c) {
            var b = boxOf(c.id);
            if (b) { out.push(b); }
        });
        return out;
    }

    /**
     * 한 부모의 자식들을 정렬하고, 순번을 매기고,
     * 부모 코드 본문의 해당 호출 지점에 "펼쳐봄" 표시를 입힌다.
     *
     * A 안에서 B와 C를 클릭했다면 둘 다 A의 자식(형제)이 되고,
     * A 본문의 B 호출부에는 ①, C 호출부에는 ② 가 붙는다.
     */
    function refreshChildren(parentBox) {
        if (!parentBox) { return; }
        var kids = parentBox.querySelector(':scope > .kids');
        if (!kids) { return; }

        var list = childBoxes(parentBox);
        if (list.length === 0 && boardMode) {
            var cnt0 = parentBox.querySelector(':scope > .hd > .cnt');
            if (cnt0) { cnt0.textContent = ''; }
            return;
        }

        list.sort(function (a, b) {
            var da = nodes[a.dataset.id];
            var db = nodes[b.dataset.id];
            if (!da || !db) { return 0; }
            if (orderMode === 'source' && da.origin && db.origin) {
                if (da.origin.line !== db.origin.line) {
                    return da.origin.line - db.origin.line;
                }
                return da.origin.char - db.origin.char;
            }
            return seqOf(da.id) - seqOf(db.id);
        });
        // 보드 모드에서는 자식이 캔버스에 따로 놓여 있으므로 DOM 순서를 건드리지 않는다.
        if (!boardMode) {
            list.forEach(function (c) { kids.appendChild(c); });
        }

        // 부모 코드의 기존 방문 표시 제거
        var body = parentBox.querySelector(':scope > .body');
        if (body) {
            body.querySelectorAll('.clickable.visited').forEach(function (t) {
                t.classList.remove('visited');
                t.removeAttribute('data-idx');
            });
        }

        list.forEach(function (c, i) {
            var d = nodes[c.dataset.id];
            var idxEl = c.querySelector(':scope > .hd > .idx');
            if (idxEl) { idxEl.textContent = String(i + 1); }
            if (body && d && d.origin) {
                var tok = body.querySelector(
                    '.clickable[data-l="' + d.origin.line + '"][data-c="' + d.origin.char + '"]'
                );
                if (tok) {
                    tok.classList.add('visited');
                    tok.setAttribute('data-idx', circled(i + 1));
                    tok.title = '펼쳐본 지점 ' + circled(i + 1) + ' — 아래 ' +
                        d.symbol.name + ' 노드와 짝. 다시 누르면 그 노드로 이동한다.';
                }
            }
        });

        var cnt = parentBox.querySelector(':scope > .hd > .cnt');
        if (cnt) {
            cnt.textContent = list.length ? '↳ ' + list.length : '';
            cnt.title = list.length ? '이 함수 안에서 ' + list.length + '군데를 펼쳐봤다' : '';
        }
    }

    function refreshAll() {
        rootEl.querySelectorAll('.node').forEach(refreshChildren);
    }

    function updateEmpty() {
        var has = rootEl.children.length > 0;
        emptyEl.style.display = has ? 'none' : 'block';
        crumbEl.style.display = has ? 'flex' : 'none';
    }

    function boxOf(id) {
        return id ? rootEl.querySelector('.node[data-id="' + id + '"]') : null;
    }

    /**
     * 노드와 그 하위 노드를 모델·DOM 양쪽에서 지운다.
     *
     * 트리 모드에서는 부모 상자를 지우면 자식도 딸려 가지만, 보드 모드에서는
     * 자식이 캔버스에 따로 놓여 있어 하나씩 지워야 한다. 확장 쪽 모델은
     * `remove` 메시지가 같은 일을 한다.
     */
    function removeSubtree(id) {
        var data = nodes[id];
        if (data) {
            (data.children || []).slice().forEach(function (c) { removeSubtree(c.id); });
            var parent = data.parentId ? nodes[data.parentId] : null;
            var list = parent ? parent.children : rootNodes;
            var i = list.indexOf(data);
            if (i >= 0) { list.splice(i, 1); }
        }
        var box = boxOf(id);
        if (box) { box.remove(); }
        delete nodes[id];
        delete uiState[id];
    }

    // ---------------------------------------------------------------- 상호작용

    document.addEventListener('click', function (ev) {
        var t = ev.target;
        if (!(t instanceof HTMLElement)) { return; }

        // 코드 안 식별자
        if (t.classList.contains('clickable')) {
            var box = t.closest('.node');
            if (!box) { return; }
            var nodeId = box.dataset.id;
            var line = parseInt(t.dataset.l, 10);
            var char = parseInt(t.dataset.c, 10);
            var text = t.textContent || '';

            if (ev.ctrlKey || ev.metaKey) {
                var sym = nodes[nodeId].symbol;
                vscode.postMessage({ type: 'openInEditor', uri: sym.uri, line: line, char: char });
            } else {
                setActive(nodeId);
                vscode.postMessage({
                    type: 'resolve',
                    nodeId: nodeId,
                    line: line,
                    char: char,
                    text: text,
                    mode: ev.altKey ? 'implementation' : 'definition',
                });
            }
            ev.preventDefault();
            return;
        }

        // 헤더 버튼
        if (t.dataset && t.dataset.act) {
            var nbox = t.closest('.node');
            if (!nbox) { return; }
            var id = nbox.dataset.id;
            if (t.dataset.act === 'open') {
                var s = nodes[id].symbol;
                vscode.postMessage({
                    type: 'openInEditor', uri: s.uri, line: s.anchorLine, char: s.anchorChar,
                });
            } else if (t.dataset.act === 'impl') {
                setActive(id);
                vscode.postMessage({ type: 'resolveImplementations', nodeId: id });
            } else if (t.dataset.act === 'root') {
                vscode.postMessage({ type: 'promoteToRoot', nodeId: id });
            } else if (t.dataset.act === 'del') {
                vscode.postMessage({ type: 'remove', nodeId: id });
                var ownerId = nbox.dataset.parent;
                removeSubtree(id);
                if (ownerId) { refreshChildren(boxOf(ownerId)); }
                updateEmpty();
                drawBoardLines();
            }
            ev.stopPropagation();
            return;
        }

        // 헤더 클릭 → 접기/펼치기 (보드에서 끌어 옮긴 직후의 click 은 무시)
        var hd = justDragged ? null : t.closest('.hd');
        if (hd) {
            var hbox = hd.closest('.node');
            if (!hbox) { return; }
            hbox.classList.toggle('collapsed');
            vscode.postMessage({
                type: 'toggle',
                nodeId: hbox.dataset.id,
                collapsed: hbox.classList.contains('collapsed'),
            });
            setActive(hbox.dataset.id);
            scheduleFit();   // 펼쳐진 본문이 달라졌다
            drawBoardLines();
            return;
        }

        // 코드 영역 아무데나 클릭 → 활성 노드 갱신
        var anyBox = t.closest('.node');
        if (anyBox) { setActive(anyBox.dataset.id); }
    });

    function setActive(id) {
        if (activeId === id) { return; }
        var prev = activeId && boxOf(activeId);
        if (prev) { prev.classList.remove('active'); }
        activeId = id;
        var cur = boxOf(id);
        if (cur) { cur.classList.add('active'); }
        renderBreadcrumb(id);
    }

    function renderBreadcrumb(id) {
        crumbEl.textContent = '';
        var chain = [];
        var cur = nodes[id];
        while (cur) {
            chain.unshift(cur);
            cur = cur.parentId ? nodes[cur.parentId] : null;
        }
        chain.forEach(function (n, i) {
            if (i > 0) { crumbEl.appendChild(el('span', 'sepc', '›')); }
            var b = el('span', 'crumb', splitName(n.symbol).name);
            b.title = n.symbol.name + '\n' + locLabel(n.symbol);
            b.addEventListener('click', function () { focusNode(n.id); });
            crumbEl.appendChild(b);
        });
    }

    function jumpToCallSite(parentId, origin) {
        var pbox = boxOf(parentId);
        if (!pbox || !origin) { return; }
        pbox.classList.remove('collapsed');
        var tok = pbox.querySelector(
            ':scope > .body .clickable[data-l="' + origin.line + '"][data-c="' + origin.char + '"]'
        );
        var target = tok || pbox;
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (tok) {
            tok.classList.add('flash-tok');
            setTimeout(function () { tok.classList.remove('flash-tok'); }, 1200);
        }
        setActive(parentId);
    }

    function focusNode(id) {
        var box = boxOf(id);
        if (!box) { return; }
        // 조상 전부 펼치기
        var p = box.parentElement;
        while (p && p !== rootEl) {
            if (p.classList && p.classList.contains('node')) { p.classList.remove('collapsed'); }
            p = p.parentElement;
        }
        box.classList.remove('collapsed');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
        box.classList.add('flash');
        setTimeout(function () { box.classList.remove('flash'); }, 900);
        setActive(id);
    }

    // ---------------------------------------------------------------- 툴바

    document.getElementById('btn-expand').addEventListener('click', function () {
        rootEl.querySelectorAll('.node').forEach(function (n) { n.classList.remove('collapsed'); });
        scheduleFit();
    });
    document.getElementById('btn-collapse').addEventListener('click', function () {
        rootEl.querySelectorAll('.node').forEach(function (n) {
            if (n.parentElement !== rootEl) { n.classList.add('collapsed'); }
        });
        scheduleFit();
    });
    var orderBtn = document.getElementById('btn-order');
    function syncOrderBtn() {
        orderBtn.textContent = orderMode === 'source' ? '⇅ 코드 순서' : '⇅ 클릭 순서';
        orderBtn.title = orderMode === 'source'
            ? '형제 노드를 부모 코드에 나온 순서로 정렬 중. 누르면 내가 클릭한 순서로 바뀐다.'
            : '형제 노드를 내가 클릭한 순서로 정렬 중. 누르면 코드에 나온 순서로 바뀐다.';
    }
    orderBtn.addEventListener('click', function () {
        orderMode = orderMode === 'source' ? 'click' : 'source';
        syncOrderBtn();
        refreshAll();
    });
    syncOrderBtn();

    var boardBtn = document.getElementById('btn-board');
    function syncBoardBtn() {
        boardBtn.textContent = boardMode ? '▤ 트리' : '⬚ 보드';
        boardBtn.title = boardMode
            ? '트리로 돌아간다. 보드에서 옮긴 자리는 그대로 기억한다.'
            : '보드 — 노드를 캔버스에 자유롭게 늘어놓는다. 헤더를 끌어 옮기고, 부모-자식은 선으로 잇는다.';
    }
    boardBtn.addEventListener('click', function () { setBoardMode(!boardMode); });
    syncBoardBtn();

    document.getElementById('btn-window').addEventListener('click', function () {
        vscode.postMessage({ type: 'moveToNewWindow' });
    });
    document.getElementById('btn-clear').addEventListener('click', function () {
        vscode.postMessage({ type: 'clear' });
    });
    document.getElementById('btn-md').addEventListener('click', function () {
        vscode.postMessage({ type: 'exportMarkdown' });
    });
    document.getElementById('btn-save').addEventListener('click', function () {
        vscode.postMessage({ type: 'exportJson' });
    });
    document.getElementById('btn-load').addEventListener('click', function () {
        vscode.postMessage({ type: 'importJson' });
    });
    filterEl.addEventListener('input', applyFilter);

    function applyFilter() {
        var q = (filterEl.value || '').trim().toLowerCase();
        var all = rootEl.querySelectorAll('.node');
        if (!q) {
            all.forEach(function (n) { n.classList.remove('dim', 'hit'); });
            return;
        }
        all.forEach(function (n) {
            var d = nodes[n.dataset.id];
            var hay = (d.symbol.name + ' ' + d.symbol.relPath).toLowerCase();
            var hit = hay.indexOf(q) !== -1;
            n.classList.toggle('hit', hit);
            n.classList.toggle('dim', !hit);
        });
        // 히트의 조상은 다시 살린다
        rootEl.querySelectorAll('.node.hit').forEach(function (n) {
            var p = n.parentElement;
            while (p && p !== rootEl) {
                if (p.classList && p.classList.contains('node')) {
                    p.classList.remove('dim', 'collapsed');
                }
                p = p.parentElement;
            }
        });
    }

    // ---------------------------------------------------------------- 토스트

    var toastTimer = null;
    function toast(message, level) {
        toastEl.textContent = message;
        toastEl.className = 'show ' + (level || 'info');
        if (toastTimer) { clearTimeout(toastTimer); }
        toastTimer = setTimeout(function () { toastEl.className = ''; }, 4000);
    }

    // ---------------------------------------------------------------- 메시지

    window.addEventListener('message', function (ev) {
        var m = ev.data;
        switch (m.type) {
            case 'setState':
                config = mergeConfig(m.config);
                orderMode = config.childOrder || orderMode;
                syncOrderBtn();
                rebuild(m.roots || []);
                scheduleFit();
                break;

            case 'config':
                config = mergeConfig(m.config);
                if (config.childOrder && config.childOrder !== orderMode) {
                    orderMode = config.childOrder;
                    syncOrderBtn();
                    refreshAll();
                }
                scheduleFit();
                break;

            case 'addRoot': {
                registerTree(m.node, null);
                rootNodes.push(m.node);
                var box = renderNode(m.node, 0);
                rootEl.appendChild(box);
                if (boardMode) {
                    var st = uiOf(m.node.id);
                    if (st.x === undefined) {
                        st.x = BOARD_EDGE;
                        st.y = boardBottom();
                    }
                    placeNode(box, st.x, st.y);
                    drawBoardLines();
                }
                updateEmpty();
                focusNode(m.node.id);
                scheduleFit();
                break;
            }

            case 'addChild': {
                var parentBox = boxOf(m.parentId);
                var parentData = nodes[m.parentId];
                if (!parentBox || !parentData) { break; }
                registerTree(m.node, m.parentId);
                parentData.children.push(m.node);
                var depth = parseInt(parentBox.dataset.depth, 10) + 1;
                var childBox = renderNode(m.node, depth);
                if (boardMode) {
                    rootEl.appendChild(childBox);
                    placeNear(parentBox, childBox);
                } else {
                    parentBox.querySelector(':scope > .kids').appendChild(childBox);
                }
                parentBox.classList.remove('collapsed');
                refreshChildren(parentBox);
                focusNode(m.node.id);
                scheduleFit();
                drawBoardLines();
                break;
            }

            case 'focus':
                focusNode(m.nodeId);
                if (!m.quiet) { toast('이미 열려 있는 노드로 이동했다.', 'info'); }
                break;

            case 'busy': {
                var b = boxOf(m.nodeId);
                if (b) { b.classList.toggle('busy', !!m.on); }
                break;
            }

            case 'toast':
                toast(m.message, m.level);
                break;
        }
    });

    // ---------------------------------------------------------------- 폰트 · 폭 맞춤

    function setCodeFontSize(px) {
        document.body.style.setProperty('--ct-code-font-size', px + 'px');
    }

    function baseFontSize() {
        var v = parseFloat(
            getComputedStyle(document.body).getPropertyValue('--vscode-editor-font-size')
        );
        return v > 0 ? v : 13;
    }

    /**
     * 한 줄에서 글자 크기를 따라 줄지 않는 부분(줄 번호 칸 좌우 여백 + 본문 오른쪽 여백)의 px 합.
     * 폰트만 줄여서는 이 부분이 남으므로, 배율을 구할 때 빼고 계산해야 실제로 들어간다.
     */
    function fixedRowPx(codeEl) {
        var row = codeEl.querySelector('.cl');
        if (!row) { return 0; }
        var px = 0;
        ['.no', '.tx'].forEach(function (sel) {
            var e = row.querySelector(sel);
            if (!e) { return; }
            var cs = getComputedStyle(e);
            px += (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
        });
        return px;
    }

    /**
     * 코드 본문의 글자 크기를 정한다.
     *
     * 1) `codeTrail.fontSize` 가 0보다 크면 그 값을 그대로 쓴다. 수동 지정이 우선이다.
     * 2) `fitToWidth` 가 켜져 있으면 지금 보이는 노드 중 **가장 빠듯한 것**에 맞춰 줄인다.
     *    `minFontSize` 아래로는 줄이지 않고, 거기서도 안 들어가면 그 노드만 가로 스크롤이 생긴다.
     *
     * 노드마다 다른 크기를 쓰지 않는다. 트리 안에서 글자 크기가 들쭉날쭉하면 읽기 나쁘다.
     * 헤더 글자는 건드리지 않는다 — 헤더까지 작아지면 트리 구조가 눈에 안 들어온다.
     */
    function applyFontSize() {
        if (config.fontSize && config.fontSize > 0) {
            // 수동 지정은 예전처럼 헤더 이름까지 함께 키운다.
            document.body.style.setProperty('--ct-font-size', config.fontSize + 'px');
            document.body.style.removeProperty('--ct-code-font-size');
            return;
        }
        document.body.style.removeProperty('--ct-font-size');
        var base = baseFontSize();
        // 언제나 기준 크기로 되돌린 뒤 잰다. 그래야 패널을 다시 넓혔을 때 원래 크기로 돌아온다.
        setCodeFontSize(base);
        if (!config.fitToWidth) { return; }

        var boxes = rootEl.querySelectorAll('.code');
        var ratio = 1;
        for (var i = 0; i < boxes.length; i++) {
            var b = boxes[i];
            if (b.dataset.fs) { continue; }       // 사용자가 직접 맞춘 노드는 건드리지 않는다
            var c = b.clientWidth;
            var s = b.scrollWidth;
            if (c <= 0 || s <= c) { continue; }   // 접혀 있거나 이미 들어간다
            var fixed = fixedRowPx(b);
            if (c - fixed <= 0 || s - fixed <= 0) { continue; }
            var r = (c - fixed) / (s - fixed);
            if (r < ratio) { ratio = r; }
        }
        if (ratio >= 1) { return; }

        var min = config.minFontSize > 0 ? config.minFontSize : 8;
        setCodeFontSize(Math.max(min, Math.floor(base * ratio * 10) / 10));
    }

    var fitPending = false;
    var lastFitWidth = -1;
    /** 레이아웃이 끝난 뒤 한 번만 다시 맞춘다. 연달아 불러도 프레임당 한 번이다. */
    function scheduleFit() {
        if (fitPending) { return; }
        fitPending = true;
        requestAnimationFrame(function () {
            fitPending = false;
            applyFontSize();
            lastFitWidth = rootEl.clientWidth;
        });
    }

    // ---------------------------------------------------------------- 보드 모드

    /*
     * 노드를 캔버스 위에 자유롭게 늘어놓는 모드.
     *
     * 트리 모드에서는 자식이 부모 DOM 안에 중첩돼 있지만, 보드 모드에서는 모든 노드를
     * `#root` 바로 아래에 두고 `left/top` 으로 배치한다. 중첩된 채로 절대 배치를 하면
     * 자식 좌표가 부모 기준이 되어 계산이 엉킨다.
     * 부모-자식 관계는 없어지지 않는다 — 모델은 그대로고, 화면에는 곡선으로 잇는다.
     */
    var BOARD_GAP_X = 90;
    var BOARD_GAP_Y = 26;
    var BOARD_EDGE = 14;

    function ensureBoardLines() {
        if (boardLines && boardLines.parentNode === rootEl) { return boardLines; }
        boardLines = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        boardLines.setAttribute('class', 'board-lines');
        rootEl.insertBefore(boardLines, rootEl.firstChild);
        return boardLines;
    }

    function renderBoard() {
        ensureBoardLines();
        var walk = function (node, depth) {
            var box = renderNode(node, depth);
            rootEl.appendChild(box);
            (node.children || []).forEach(function (c) { walk(c, depth + 1); });
        };
        rootNodes.forEach(function (r) { walk(r, 0); });
        boardLayout();
        drawBoardLines();
    }

    function placeNode(box, x, y) {
        box.style.left = Math.round(x) + 'px';
        box.style.top = Math.round(y) + 'px';
    }

    /** 아직 자리를 안 정한 노드에 자동으로 자리를 준다. 깊이 = 열, 형제 = 아래로. */
    function boardLayout() {
        var columnBottom = [];
        var walk = function (node, depth) {
            var box = boxOf(node.id);
            if (!box) { return; }
            var st = uiOf(node.id);
            if (columnBottom[depth] === undefined) { columnBottom[depth] = BOARD_EDGE; }
            if (st.x === undefined || st.y === undefined) {
                st.x = BOARD_EDGE + depth * (boardWidth() + BOARD_GAP_X);
                st.y = columnBottom[depth];
            }
            placeNode(box, st.x, st.y);
            columnBottom[depth] = Math.max(columnBottom[depth], st.y + box.offsetHeight + BOARD_GAP_Y);
            (node.children || []).forEach(function (c) { walk(c, depth + 1); });
        };
        rootNodes.forEach(function (r) { walk(r, 0); });
    }

    /** 지금 놓인 노드들 아래의 빈 자리 y */
    function boardBottom() {
        var y = BOARD_EDGE;
        rootEl.querySelectorAll('.node').forEach(function (b) {
            y = Math.max(y, b.offsetTop + b.offsetHeight + BOARD_GAP_Y);
        });
        return y;
    }

    function boardWidth() {
        var v = parseFloat(getComputedStyle(rootEl).getPropertyValue('--ct-board-width'));
        return v > 0 ? v : 520;
    }

    /** 부모 오른쪽에서 자식 왼쪽으로 곡선을 긋고, 캔버스 크기를 내용에 맞춘다. */
    function drawBoardLines() {
        if (!boardMode) { return; }
        ensureBoardLines();
        var d = [];
        var maxX = 0;
        var maxY = 0;
        rootEl.querySelectorAll('.node').forEach(function (box) {
            maxX = Math.max(maxX, box.offsetLeft + box.offsetWidth);
            maxY = Math.max(maxY, box.offsetTop + box.offsetHeight);
            var p = box.dataset.parent ? boxOf(box.dataset.parent) : null;
            if (!p) { return; }
            var x1 = p.offsetLeft + p.offsetWidth;
            var y1 = p.offsetTop + 16;
            var x2 = box.offsetLeft;
            var y2 = box.offsetTop + 16;
            var bend = Math.max(30, Math.abs(x2 - x1) / 2);
            d.push('M' + x1 + ' ' + y1
                + ' C' + (x1 + bend) + ' ' + y1 + ',' + (x2 - bend) + ' ' + y2
                + ',' + x2 + ' ' + y2);
        });
        boardLines.setAttribute('width', String(maxX + BOARD_EDGE * 2));
        boardLines.setAttribute('height', String(maxY + BOARD_EDGE * 2));
        boardLines.innerHTML = d.map(function (p) { return '<path d="' + p + '"/>'; }).join('');
        // 캔버스가 내용을 담도록 늘려야 스크롤이 생긴다.
        rootEl.style.width = (maxX + BOARD_EDGE * 2) + 'px';
        rootEl.style.height = (maxY + BOARD_EDGE * 2) + 'px';
    }

    /** 새로 붙은 자식을 부모 오른쪽 빈자리에 놓는다. */
    function placeNear(parentBox, box) {
        var st = uiOf(box.dataset.id);
        if (st.x === undefined) {
            st.x = parentBox.offsetLeft + parentBox.offsetWidth + BOARD_GAP_X;
            st.y = parentBox.offsetTop;
            // 그 자리에 이미 뭔가 있으면 아래로 민다
            var mine = box.dataset.id;
            rootEl.querySelectorAll('.node').forEach(function (other) {
                if (other.dataset.id === mine) { return; }
                if (Math.abs(other.offsetLeft - st.x) < 40
                    && Math.abs(other.offsetTop - st.y) < 40) {
                    st.y = other.offsetTop + other.offsetHeight + BOARD_GAP_Y;
                }
            });
        }
        placeNode(box, st.x, st.y);
    }

    // 노드 끌어 옮기기 (헤더를 잡는다)
    var drag = null;
    var justDragged = false;

    rootEl.addEventListener('pointerdown', function (ev) {
        if (!boardMode || ev.button !== 0) { return; }
        var t = ev.target;
        if (!t || !t.closest || t.closest('.act') || t.closest('.clickable')) { return; }
        var hd = t.closest('.hd');
        if (!hd) { return; }
        var box = hd.closest('.node');
        if (!box) { return; }
        drag = {
            box: box, hd: hd, pointerId: ev.pointerId, moved: false,
            dx: ev.clientX - box.offsetLeft, dy: ev.clientY - box.offsetTop,
        };
        box.classList.add('dragging');
        hd.setPointerCapture(ev.pointerId);
    });

    rootEl.addEventListener('pointermove', function (ev) {
        if (!drag) { return; }
        drag.moved = true;
        var st = uiOf(drag.box.dataset.id);
        st.x = Math.max(0, ev.clientX - drag.dx);
        st.y = Math.max(0, ev.clientY - drag.dy);
        placeNode(drag.box, st.x, st.y);
        drawBoardLines();
    });

    function endDrag() {
        if (!drag) { return; }
        drag.box.classList.remove('dragging');
        try { drag.hd.releasePointerCapture(drag.pointerId); } catch (e) { /* 이미 놓였다 */ }
        // 끌고 나서 올라오는 click 이 헤더 접기로 이어지지 않게 한 번 막는다.
        justDragged = drag.moved;
        drag = null;
        setTimeout(function () { justDragged = false; }, 0);
        drawBoardLines();
    }
    rootEl.addEventListener('pointerup', endDrag);
    rootEl.addEventListener('pointercancel', endDrag);

    function setBoardMode(on) {
        if (boardMode === on) { return; }
        boardMode = on;
        rootEl.classList.toggle('board', on);
        syncBoardBtn();
        render();
        scheduleFit();
    }

    // ---------------------------------------------------------------- 노드별 손조절

    function uiOf(id) {
        if (!uiState[id]) { uiState[id] = {}; }
        return uiState[id];
    }

    /** 저장해 둔 높이·글자 크기를 다시 입힌다. 트리를 다시 그릴 때마다 불린다. */
    function applyNodeUi(id, codeEl) {
        var st = uiState[id];
        if (!st) { return; }
        if (st.h) { codeEl.style.height = st.h + 'px'; }
        if (st.fs) {
            codeEl.style.fontSize = st.fs + 'px';
            codeEl.dataset.fs = '1';   // 폭 맞춤이 이 노드는 건너뛴다
        }
    }

    /**
     * 본문 상자 모서리를 끌어 높이를 바꾸면(CSS `resize`) 그 값을 기억한다.
     *
     * resize 에는 이벤트가 없어서 관찰자로 잡는다. 사용자가 끌었을 때만 브라우저가
     * `style.height` 를 직접 박으므로, 그게 있을 때만 기억한다.
     * 폭 맞춤이 글자 크기를 바꿔 높이가 달라진 경우와 이렇게 구분된다.
     */
    var codeObserver = window.ResizeObserver ? new ResizeObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
            var t = entries[i].target;
            if (!t.style.height) { continue; }
            var box = t.closest('.node');
            if (box) { uiOf(box.dataset.id).h = parseFloat(t.style.height); }
        }
    }) : null;

    /** Ctrl+휠 = 그 노드의 코드 글자 크기만 조절. 다른 노드는 그대로 둔다. */
    rootEl.addEventListener('wheel', function (ev) {
        if (!ev.ctrlKey) { return; }
        var codeEl = ev.target && ev.target.closest ? ev.target.closest('.code') : null;
        if (!codeEl) { return; }
        var box = codeEl.closest('.node');
        if (!box) { return; }
        ev.preventDefault();
        var cur = parseFloat(codeEl.style.fontSize)
            || parseFloat(getComputedStyle(codeEl).fontSize) || 13;
        var next = Math.max(6, Math.min(40, cur + (ev.deltaY < 0 ? 1 : -1)));
        codeEl.style.fontSize = next + 'px';
        codeEl.dataset.fs = '1';
        uiOf(box.dataset.id).fs = next;
    }, { passive: false });

    /** 줄 번호 칸 더블클릭 = 그 노드에 손댄 높이·글자 크기를 원래대로. */
    rootEl.addEventListener('dblclick', function (ev) {
        var no = ev.target && ev.target.closest ? ev.target.closest('.cl > .no') : null;
        if (!no) { return; }
        var codeEl = no.closest('.code');
        var box = no.closest('.node');
        if (!codeEl || !box) { return; }
        codeEl.style.removeProperty('height');
        codeEl.style.removeProperty('font-size');
        delete codeEl.dataset.fs;
        delete uiState[box.dataset.id];
        scheduleFit();
    });

    // 관찰자를 변수에 붙들어 둔다. 참조가 없으면 수거될 수 있다.
    var widthObserver = null;
    if (window.ResizeObserver) {
        widthObserver = new ResizeObserver(function () {
            // 노드가 늘어 세로만 길어진 경우까지 다시 재지는 않는다.
            if (rootEl.clientWidth === lastFitWidth) { return; }
            scheduleFit();
        });
        widthObserver.observe(rootEl);
    }

    vscode.postMessage({ type: 'ready' });
})();
