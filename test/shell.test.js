/* 웹뷰 셸 동기화 검증 — node test/shell.test.js
 *
 * panel.ts 의 HTML 셸과 test/preview.html 은 손으로 맞춰 둔 쌍이다.
 * 한쪽만 고치면 main.js 가 getElementById 에서 null 을 잡고 죽는데,
 * 그건 확장을 띄워봐야 알 수 있다. 그 전에 여기서 걸리게 한다.
 * 브라우저가 필요 없으므로 playwright 없이 그냥 돈다.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

const panelTs = read('src', 'panel.ts');
const previewHtml = read('test', 'preview.html');
const mainJs = read('media', 'main.js');

let failures = 0;
function check(name, cond, extra) {
    if (cond) {
        console.log(`  ok   ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name}${extra ? '\n       ' + extra : ''}`);
    }
}

function matchAll(text, re) {
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push(m[1]);
    }
    return out;
}

/** panel.ts 의 html() 이 돌려주는 템플릿 문자열만 잘라낸다. */
function panelShell(src) {
    const from = src.indexOf('<!DOCTYPE html>');
    const to = src.indexOf('</html>', from);
    if (from < 0 || to < 0) {
        console.log('  FAIL panel.ts 에서 HTML 셸을 찾지 못했다 (html() 이 바뀌었나)');
        process.exit(1);
    }
    return src.slice(from, to);
}

const shell = panelShell(panelTs);

const ID_RE = /id="([\w-]+)"/g;
const panelIds = matchAll(shell, ID_RE).sort();
const previewIds = matchAll(previewHtml, ID_RE).sort();
// main.js 가 실제로 집어 드는 것들. 여기 있는데 셸에 없으면 그 자리에서 죽는다.
const usedIds = [...new Set(matchAll(mainJs, /getElementById\(['"]([\w-]+)['"]\)/g))].sort();

const missing = (want, have) => want.filter((x) => have.indexOf(x) === -1);

// ---------------------------------------------------------------- id 집합
console.log('[셸 id 동기화]');
{
    const onlyPanel = missing(panelIds, previewIds);
    const onlyPreview = missing(previewIds, panelIds);
    check(
        'panel.ts 에 있는 id 가 preview.html 에도 있다',
        onlyPanel.length === 0,
        `preview.html 에 없는 것: ${onlyPanel.join(', ')}`,
    );
    check(
        'preview.html 에 있는 id 가 panel.ts 에도 있다',
        onlyPreview.length === 0,
        `panel.ts 에 없는 것: ${onlyPreview.join(', ')}`,
    );
    check('셸에 id 가 하나 이상 잡혔다', panelIds.length > 0, `panelIds=${panelIds.length}`);
}

// ---------------------------------------------------------------- main.js 가 찾는 id
console.log('\n[main.js 가 찾는 id]');
{
    const notInPanel = missing(usedIds, panelIds);
    const notInPreview = missing(usedIds, previewIds);
    check(
        'getElementById 대상이 panel.ts 셸에 전부 있다',
        notInPanel.length === 0,
        `없는 것: ${notInPanel.join(', ')} — 확장에서 null 을 잡고 죽는다`,
    );
    check(
        'getElementById 대상이 preview.html 에도 전부 있다',
        notInPreview.length === 0,
        `없는 것: ${notInPreview.join(', ')} — preview.html 이 열리자마자 죽는다`,
    );
}

// ---------------------------------------------------------------- media 리소스
console.log('\n[media 리소스]');
{
    // panel.ts:  media('main.js') → asWebviewUri
    // preview.html: ../media/main.js
    const panelAssets = [...new Set(matchAll(shell, /\$\{media\('([^']+)'\)\}/g))].sort();
    const previewAssets = [...new Set(matchAll(previewHtml, /(?:src|href)="\.\.\/media\/([^"]+)"/g))].sort();
    const notLoaded = missing(panelAssets, previewAssets);

    check('셸이 media 리소스를 참조한다', panelAssets.length > 0, `panelAssets=${panelAssets.length}`);
    check(
        'panel.ts 가 쓰는 media 파일을 preview.html 도 로드한다',
        notLoaded.length === 0,
        `preview.html 이 안 읽는 것: ${notLoaded.join(', ')}`,
    );
    const absent = panelAssets.filter((a) => !fs.existsSync(path.join(root, 'media', a)));
    check('참조하는 media 파일이 실제로 있다', absent.length === 0, `없는 파일: ${absent.join(', ')}`);
}

console.log(`\n${failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
