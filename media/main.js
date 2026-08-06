/* Code Trail — 웹뷰 클라이언트 */
(function () {
    'use strict';

    var vscode = acquireVsCodeApi();
    var rootEl = document.getElementById('root');
    var emptyEl = document.getElementById('empty');
    var crumbEl = document.getElementById('breadcrumb');
    var toastEl = document.getElementById('toast');
    var filterEl = document.getElementById('filter');

    var config = {
        clickTarget: 'allSymbols', maxCodeLines: 250, showAbsolutePath: false,
        fontSize: 0, childOrder: 'source',
    };
    var nodes = Object.create(null); // id -> node data
    var activeId = null;
    var orderMode = 'source'; // 'source' = 코드에 나온 순서, 'click' = 내가 클릭한 순서

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
        box.dataset.depth = String(depth);
        if (node.collapsed) { box.classList.add('collapsed'); }

        // 헤더
        var hd = el('div', 'hd');
        hd.appendChild(el('span', 'chev', '▾'));
        hd.appendChild(el('span', 'idx', ''));   // 형제 중 몇 번째인지
        hd.appendChild(el('span', 'kind k-' + (node.symbol.kindName || 'symbol'), node.symbol.kindName || 'symbol'));

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
        body.appendChild(renderCode(node.symbol));
        box.appendChild(body);

        // 자식
        var kids = el('div', 'kids');
        (node.children || []).forEach(function (c) {
            kids.appendChild(renderNode(c, depth + 1));
        });
        box.appendChild(kids);

        return box;
    }

    function rebuild(roots) {
        nodes = Object.create(null);
        rootEl.textContent = '';
        roots.forEach(function (r) {
            rootEl.appendChild(renderNode(r, 0));
        });
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

    function childBoxes(parentBox) {
        var kids = parentBox.querySelector(':scope > .kids');
        if (!kids) { return []; }
        return Array.prototype.filter.call(kids.children, function (c) {
            return c.classList && c.classList.contains('node');
        });
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
        list.forEach(function (c) { kids.appendChild(c); });

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
        return rootEl.querySelector('.node[data-id="' + id + '"]');
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
            } else if (t.dataset.act === 'del') {
                vscode.postMessage({ type: 'remove', nodeId: id });
                var owner = nbox.parentElement && nbox.parentElement.closest('.node');
                nbox.remove();
                delete nodes[id];
                if (owner) { refreshChildren(owner); }
                updateEmpty();
            }
            ev.stopPropagation();
            return;
        }

        // 헤더 클릭 → 접기/펼치기
        var hd = t.closest('.hd');
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
    });
    document.getElementById('btn-collapse').addEventListener('click', function () {
        rootEl.querySelectorAll('.node').forEach(function (n) {
            if (n.parentElement !== rootEl) { n.classList.add('collapsed'); }
        });
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
                config = m.config || config;
                orderMode = config.childOrder || orderMode;
                syncOrderBtn();
                applyFontSize();
                rebuild(m.roots || []);
                break;

            case 'config':
                config = m.config || config;
                if (config.childOrder && config.childOrder !== orderMode) {
                    orderMode = config.childOrder;
                    syncOrderBtn();
                    refreshAll();
                }
                applyFontSize();
                break;

            case 'addRoot': {
                var box = renderNode(m.node, 0);
                rootEl.appendChild(box);
                updateEmpty();
                focusNode(m.node.id);
                break;
            }

            case 'addChild': {
                var parentBox = boxOf(m.parentId);
                if (!parentBox) { break; }
                var kids = parentBox.querySelector(':scope > .kids');
                var depth = parseInt(parentBox.dataset.depth, 10) + 1;
                kids.appendChild(renderNode(m.node, depth));
                parentBox.classList.remove('collapsed');
                refreshChildren(parentBox);
                focusNode(m.node.id);
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

    function applyFontSize() {
        if (config.fontSize && config.fontSize > 0) {
            document.body.style.setProperty('--ct-font-size', config.fontSize + 'px');
        } else {
            document.body.style.removeProperty('--ct-font-size');
        }
    }

    vscode.postMessage({ type: 'ready' });
})();
