/* Code Trail — 가벼운 C계열 토크나이저.
 *
 * 목적이 두 가지다.
 *   1) 신택스 하이라이팅
 *   2) 식별자마다 원본 파일 기준 (줄, 컬럼)을 심어서 클릭 가능하게 만들기
 *
 * 정확한 심볼 해석은 언어 서버가 한다. 여기서는 "클릭 후보"만 찾으면 되므로
 * 완벽한 파서가 필요 없다. 다만 문자열/주석 안의 단어를 클릭 대상으로 만들면
 * 거슬리므로 그 둘은 제대로 걸러낸다.
 */
(function () {
    'use strict';

    var KEYWORDS = {
        cpp: 'alignas alignof and and_eq asm atomic_cancel atomic_commit atomic_noexcept auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor xor_eq override final int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t size_t',
        c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while bool true false NULL size_t',
        csharp: 'abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double dynamic else enum event explicit extern false finally fixed float for foreach get goto if implicit in init int interface internal is lock long nameof namespace new nint nuint null object operator out override params partial private protected public readonly record ref return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using value var virtual void volatile when where while yield with global required scoped file',
        go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any make new len cap append copy delete panic recover close',
        rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type union unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Some None Ok Err Box Rc Arc',
        typescript: 'abstract any as asserts async await boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of package private protected public readonly require return set static string super switch symbol this throw true try type typeof undefined union unique unknown var void while with yield',
        javascript: 'async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield',
        python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
        java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try var void volatile while record sealed permits yield',
    };

    var KEYWORD_SETS = {};
    Object.keys(KEYWORDS).forEach(function (lang) {
        var set = Object.create(null);
        KEYWORDS[lang].split(/\s+/).forEach(function (w) {
            if (w) { set[w] = true; }
        });
        KEYWORD_SETS[lang] = set;
    });

    function keywordSet(lang) {
        if (KEYWORD_SETS[lang]) { return KEYWORD_SETS[lang]; }
        if (lang === 'cuda-cpp' || lang === 'objective-cpp') { return KEYWORD_SETS.cpp; }
        if (lang === 'objective-c') { return KEYWORD_SETS.c; }
        if (lang === 'typescriptreact') { return KEYWORD_SETS.typescript; }
        if (lang === 'javascriptreact') { return KEYWORD_SETS.javascript; }
        return KEYWORD_SETS.cpp; // 무난한 기본값
    }

    function esc(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function isIdentStart(ch) {
        return /[A-Za-z_$]/.test(ch) || ch.charCodeAt(0) > 127;
    }
    function isIdentPart(ch) {
        return /[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) > 127;
    }
    function isDigit(ch) {
        return ch >= '0' && ch <= '9';
    }

    /**
     * @param {string} code       표시할 코드 (원본 그대로)
     * @param {string} lang       vscode languageId
     * @param {number} startLine  code의 첫 줄이 원본 파일에서 몇 번째 줄인지 (0-based)
     * @param {string} clickTarget 'allSymbols' | 'callsOnly'
     * @returns {string[]}        줄 단위 HTML 배열
     */
    function highlightLines(code, lang, startLine, clickTarget) {
        var kw = keywordSet(lang);
        var callsOnly = clickTarget === 'callsOnly';
        var rawLines = code.split('\n');
        var out = [];

        // 여러 줄에 걸치는 상태
        var inBlockComment = false;
        var rawTerminator = null; // 멀티라인 raw/verbatim 문자열의 종료 토큰

        for (var li = 0; li < rawLines.length; li++) {
            var line = rawLines[li];
            var absLine = startLine + li;
            var html = '';
            var i = 0;
            var n = line.length;

            while (i < n) {
                // --- 블록 주석 계속 ---
                if (inBlockComment) {
                    var endIdx = line.indexOf('*/', i);
                    if (endIdx === -1) {
                        html += span('cm', line.slice(i));
                        i = n;
                    } else {
                        html += span('cm', line.slice(i, endIdx + 2));
                        i = endIdx + 2;
                        inBlockComment = false;
                    }
                    continue;
                }

                // --- 멀티라인 raw 문자열 계속 ---
                if (rawTerminator !== null) {
                    var rEnd = line.indexOf(rawTerminator, i);
                    if (rEnd === -1) {
                        html += span('st', line.slice(i));
                        i = n;
                    } else {
                        html += span('st', line.slice(i, rEnd + rawTerminator.length));
                        i = rEnd + rawTerminator.length;
                        rawTerminator = null;
                    }
                    continue;
                }

                var ch = line[i];

                // --- 공백 ---
                if (ch === ' ' || ch === '\t') {
                    var ws = i;
                    while (i < n && (line[i] === ' ' || line[i] === '\t')) { i++; }
                    html += esc(line.slice(ws, i));
                    continue;
                }

                // --- 주석 ---
                if (ch === '/' && line[i + 1] === '/') {
                    html += span('cm', line.slice(i));
                    i = n;
                    continue;
                }
                if (ch === '/' && line[i + 1] === '*') {
                    var be = line.indexOf('*/', i + 2);
                    if (be === -1) {
                        html += span('cm', line.slice(i));
                        i = n;
                        inBlockComment = true;
                    } else {
                        html += span('cm', line.slice(i, be + 2));
                        i = be + 2;
                    }
                    continue;
                }
                if (lang === 'python' && ch === '#') {
                    html += span('cm', line.slice(i));
                    i = n;
                    continue;
                }

                // --- 전처리기 / 어트리뷰트 ---
                if (ch === '#' && (lang === 'cpp' || lang === 'c' || lang === 'csharp')) {
                    var onlyWsBefore = /^[ \t]*$/.test(line.slice(0, i));
                    if (onlyWsBefore) {
                        var pe = i + 1;
                        while (pe < n && /[A-Za-z_]/.test(line[pe] || '')) { pe++; }
                        html += span('pp', line.slice(i, pe));
                        i = pe;
                        continue;
                    }
                }

                // --- C++ raw string: R"delim( ... )delim" ---
                if ((lang === 'cpp' || lang === 'c') && (ch === 'R' || ch === 'u' || ch === 'L') ) {
                    var rm = /^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/.exec(line.slice(i));
                    if (rm) {
                        var delim = ')' + rm[1] + '"';
                        var closeAt = line.indexOf(delim, i + rm[0].length);
                        if (closeAt === -1) {
                            html += span('st', line.slice(i));
                            i = n;
                            rawTerminator = delim;
                        } else {
                            html += span('st', line.slice(i, closeAt + delim.length));
                            i = closeAt + delim.length;
                        }
                        continue;
                    }
                }

                // --- Rust raw string: r#"..."# ---
                if (lang === 'rust' && (ch === 'r' || ch === 'b')) {
                    var rr = /^b?r(#*)"/.exec(line.slice(i));
                    if (rr) {
                        var rdelim = '"' + rr[1];
                        var rc = line.indexOf(rdelim, i + rr[0].length);
                        if (rc === -1) {
                            html += span('st', line.slice(i));
                            i = n;
                            rawTerminator = rdelim;
                        } else {
                            html += span('st', line.slice(i, rc + rdelim.length));
                            i = rc + rdelim.length;
                        }
                        continue;
                    }
                }

                // --- C# verbatim string: @"..."  ("" 가 이스케이프) ---
                if (lang === 'csharp' && (ch === '@' || (ch === '$' && line[i + 1] === '@'))) {
                    var vm = /^[$@]{1,2}"/.exec(line.slice(i));
                    if (vm) {
                        var j = i + vm[0].length;
                        var closed = false;
                        while (j < n) {
                            if (line[j] === '"') {
                                if (line[j + 1] === '"') { j += 2; continue; }
                                j++; closed = true; break;
                            }
                            j++;
                        }
                        html += span('st', line.slice(i, closed ? j : n));
                        if (!closed) { rawTerminator = '"'; }
                        i = closed ? j : n;
                        continue;
                    }
                }

                // --- Go raw string: `...` ---
                if (ch === '`') {
                    var bt = line.indexOf('`', i + 1);
                    if (bt === -1) {
                        html += span('st', line.slice(i));
                        i = n;
                        rawTerminator = '`';
                    } else {
                        html += span('st', line.slice(i, bt + 1));
                        i = bt + 1;
                    }
                    continue;
                }

                // --- 일반 문자열 ---
                if (ch === '"') {
                    var k = i + 1;
                    while (k < n) {
                        if (line[k] === '\\') { k += 2; continue; }
                        if (line[k] === '"') { k++; break; }
                        k++;
                    }
                    html += span('st', line.slice(i, Math.min(k, n)));
                    i = Math.min(k, n);
                    continue;
                }

                // --- 문자 리터럴 / Rust 라이프타임 ---
                if (ch === "'") {
                    var cm = /^'(\\.|[^'\\])'/.exec(line.slice(i));
                    if (cm) {
                        html += span('st', cm[0]);
                        i += cm[0].length;
                        continue;
                    }
                    if (lang === 'rust') {
                        var lm = /^'[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
                        if (lm) {
                            html += span('lt', lm[0]);
                            i += lm[0].length;
                            continue;
                        }
                    }
                    if (lang === 'python' || lang === 'javascript' || lang === 'typescript') {
                        var q = i + 1;
                        while (q < n) {
                            if (line[q] === '\\') { q += 2; continue; }
                            if (line[q] === "'") { q++; break; }
                            q++;
                        }
                        html += span('st', line.slice(i, Math.min(q, n)));
                        i = Math.min(q, n);
                        continue;
                    }
                    html += span('pu', "'");
                    i++;
                    continue;
                }

                // --- 숫자 ---
                if (isDigit(ch) || (ch === '.' && isDigit(line[i + 1] || ''))) {
                    var nm = /^(?:0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9]+)?)[uUlLfFdDmM]*(?:i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|f32|f64)?/.exec(line.slice(i));
                    if (nm) {
                        html += span('nu', nm[0]);
                        i += nm[0].length;
                        continue;
                    }
                }

                // --- 식별자 ---
                if (isIdentStart(ch)) {
                    var s = i;
                    i++;
                    while (i < n && isIdentPart(line[i])) { i++; }
                    var word = line.slice(s, i);

                    if (kw[word]) {
                        html += span('kw', word);
                        continue;
                    }

                    // 뒤에 여는 괄호가 오면 호출로 본다
                    var after = line.slice(i);
                    var isCall = /^\s*[(<]/.test(after) && !/^\s*<[<=]/.test(after);
                    var clickable = callsOnly ? isCall : true;

                    var cls = isCall ? 'fn' : (/^[A-Z]/.test(word) ? 'ty' : 'id');
                    if (clickable) {
                        html +=
                            '<span class="tok ' + cls + ' clickable" data-l="' + absLine +
                            '" data-c="' + s + '">' + esc(word) + '</span>';
                    } else {
                        html += span(cls, word);
                    }
                    continue;
                }

                // --- 그 외 기호 ---
                var ps = i;
                while (i < n && !isIdentStart(line[i]) && !isDigit(line[i]) &&
                       line[i] !== ' ' && line[i] !== '\t' && line[i] !== '"' &&
                       line[i] !== "'" && line[i] !== '`' && line[i] !== '/' &&
                       line[i] !== '#') {
                    i++;
                }
                if (i === ps) { i++; }
                html += span('pu', line.slice(ps, i));
            }

            out.push(html);
        }

        return out;
    }

    function span(cls, text) {
        return '<span class="tok ' + cls + '">' + esc(text) + '</span>';
    }

    window.CTTokenizer = { highlightLines: highlightLines };
})();
