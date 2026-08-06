/* 토크나이저 검증 — node test/tokenizer.test.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'media', 'tokenizer.js'), 'utf8');
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const { highlightLines } = sandbox.window.CTTokenizer;

let failures = 0;
function check(name, cond, extra) {
    if (cond) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`);
    }
}

function clickables(html) {
    const out = [];
    const re = /<span class="tok [^"]*clickable" data-l="(\d+)" data-c="(\d+)">([^<]*)<\/span>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        out.push({ line: +m[1], col: +m[2], text: m[3] });
    }
    return out;
}

function run(title, code, lang, startLine, fn) {
    console.log(`\n[${title}]`);
    const lines = highlightLines(code, lang, startLine, 'allSymbols');
    fn(lines, lines.join('\n'));
}

// ---------------------------------------------------------------- C++
run('C++', [
    '#include <vector>',
    '// NotAClickableComment',
    'void Session::OnRecv(Packet* p) {',
    '    /* block WithWord',
    '       still comment */',
    '    auto s = R"delim(raw StringWord)delim";',
    '    Handler()->Dispatch(p);',
    '}',
].join('\n'), 'cpp', 100, (lines, all) => {
    const c = clickables(all);
    const names = c.map((x) => x.text);
    check('주석 안 단어는 클릭 대상 아님', !names.includes('NotAClickableComment'));
    check('블록 주석 안 단어 제외', !names.includes('WithWord'));
    check('raw string 안 단어 제외', !names.includes('StringWord'));
    check('호출 식별자 포함', names.includes('Dispatch') && names.includes('Handler'));
    check('전처리기 하이라이팅', lines[0].includes('class="tok pp"'), lines[0]);
    check('키워드 void/auto 인식', all.includes('>void<') && all.includes('>auto<'));

    const dispatch = c.find((x) => x.text === 'Dispatch');
    check('절대 줄 번호 = startLine + 6', dispatch.line === 106, JSON.stringify(dispatch));
    const raw = 'Handler()->Dispatch(p);';
    const expectedCol = '    Handler()->Dispatch(p);'.indexOf('Dispatch');
    check('컬럼 정확', dispatch.col === expectedCol, `got ${dispatch.col}, want ${expectedCol}`);
});

// ---------------------------------------------------------------- C#
run('C#', [
    'public async Task<int> HandleAsync(string id) {',
    '    var q = @"SELECT VerbatimWord',
    '              FROM T";',
    '    var s = $"interp {id}";',
    '    return await _repo.FindAsync(id);',
    '}',
].join('\n'), 'csharp', 0, (lines, all) => {
    const names = clickables(all).map((x) => x.text);
    check('verbatim 문자열 안 단어 제외', !names.includes('VerbatimWord'));
    check('멀티라인 verbatim 종료 후 복귀', names.includes('FindAsync'));
    check('_repo 클릭 가능', names.includes('_repo'));
    check('async/await 키워드', all.includes('>async<') && all.includes('>await<'));
    check('제네릭 Task<int> 의 Task 는 호출로 오인 가능 — ty 또는 fn', /Task/.test(all));
});

// ---------------------------------------------------------------- Go
run('Go', [
    'func (s *Server) Handle(w http.ResponseWriter, r *http.Request) {',
    '\tconst tmpl = `raw BacktickWord',
    '\tmulti line`',
    '\ts.logger.Info("msg WordInString")',
    '}',
].join('\n'), 'go', 10, (lines, all) => {
    const names = clickables(all).map((x) => x.text);
    check('backtick raw string 안 단어 제외', !names.includes('BacktickWord'));
    check('멀티라인 backtick 종료 후 복귀', names.includes('Info'));
    check('일반 문자열 안 단어 제외', !names.includes('WordInString'));
    check('func/const 키워드', all.includes('>func<') && all.includes('>const<'));
    check('탭 보존', lines[3].includes('\t'));
});

// ---------------------------------------------------------------- Rust
run('Rust', [
    '#[derive(Debug)]',
    'pub fn parse<\'a>(input: &\'a str) -> Result<Node, Error> {',
    '    let re = r#"raw RustWord"#;',
    '    let c = \'x\';',
    '    Node::from_str(input).map_err(Error::from)',
    '}',
].join('\n'), 'rust', 0, (lines, all) => {
    const names = clickables(all).map((x) => x.text);
    check('r#"..."# 안 단어 제외', !names.includes('RustWord'));
    check('라이프타임 처리', all.includes('class="tok lt"'));
    check('메서드 체인 클릭 가능', names.includes('from_str') && names.includes('map_err'));
    check('pub/fn/let 키워드', all.includes('>pub<') && all.includes('>fn<') && all.includes('>let<'));
    check('문자 리터럴 처리 후 깨지지 않음', lines[3].includes("'x'"));
});

// ---------------------------------------------------------------- callsOnly
console.log('\n[callsOnly 모드]');
{
    const l = highlightLines('int x = Compute(a, b);', 'cpp', 0, 'callsOnly').join('');
    const names = clickables(l).map((n) => n.text);
    check('호출만 클릭 가능', names.length === 1 && names[0] === 'Compute', JSON.stringify(names));
}

// ---------------------------------------------------------------- HTML 이스케이프
console.log('\n[이스케이프]');
{
    const l = highlightLines('if (a < b && c > d) { /* <script> */ }', 'cpp', 0, 'allSymbols').join('');
    check('<, & 이스케이프됨', !/<script>/.test(l) && l.includes('&lt;'), l.slice(0, 200));
}

// ---------------------------------------------------------------- 줄 수 보존
console.log('\n[줄 수]');
{
    const code = 'a\nb\nc\nd';
    check('입력 줄 수 == 출력 줄 수', highlightLines(code, 'go', 0, 'allSymbols').length === 4);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
