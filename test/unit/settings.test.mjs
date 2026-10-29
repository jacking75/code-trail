/* 확장 설정이 새 ProjectSettings 로 옮겨졌는지 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, shared } from './helpers.mjs';

/**
 * 확장 `codeTrail.*` → 새 `ui.*`.
 *
 * 대응표는 `docs/design-history.md` 9절과 같아야 한다. 여기서 검사하는 것은
 * "이름이 바뀌었어도 기본값이 그대로인가" 다 — 기본값이 조용히 달라지면 같은
 * 프로젝트를 열었을 때 화면이 다르게 보인다.
 */
const PORTED = {
    contextLines: 'contextLines',
    maxCodeLines: 'maxCodeLines',
    clickTarget: 'clickTarget',
    autoFollowSingleImplementation: 'autoFollowSingleImplementation',
    childOrder: 'childOrder',
    revealInEditorOnAdd: 'revealInExternalEditorOnAdd',
    fontSize: 'fontSize',
    fitToWidth: 'fitToWidth',
    minFontSize: 'minFontSize',
};

/** 옮기지 않기로 한 것. 이유는 체크리스트 9절에 적혀 있다. */
const DROPPED = ['showAbsolutePath', 'autoCollapseSiblings'];

/**
 * 확장의 `codeTrail.*` 기본값.
 *
 * 단계 11 에서 확장 매니페스트를 지웠으므로 더는 `package.json` 에서 읽을 수 없다.
 * 그 시점의 값을 `test/fixtures/extension-settings.json` 에 굳혀 두고 여기서 읽는다 —
 * 대조할 상대가 사라졌다고 검사를 지우면, 기본값이 조용히 달라져도 아무도 모른다.
 */
function extensionDefaults() {
    const { properties } = fixture('extension-settings.json');
    const out = {};
    for (const [key, value] of Object.entries(properties)) {
        out[key] = value.default;
    }
    return out;
}

test('확장 설정이 하나도 빠짐없이 분류돼 있다', () => {
    const legacy = Object.keys(extensionDefaults()).sort();
    const accounted = [...Object.keys(PORTED), ...DROPPED].sort();
    assert.deepEqual(legacy, accounted);
});

test('옮긴 설정은 기본값이 그대로다', () => {
    const legacy = extensionDefaults();
    const { ui } = shared.defaultSettings();

    for (const [before, after] of Object.entries(PORTED)) {
        assert.equal(ui[after], legacy[before], `${before} → ui.${after}`);
    }
});

test('실행 파일 경로를 기본 설정에 박아두지 않는다', () => {
    // 언어 서버도 외부 에디터도 탐지해서 찾는다(설정 → PATH → 플랫폼별). 기본값에
    // 경로가 하나라도 박혀 있으면 그 기계에만 맞는 값이 모두에게 나간다.
    const settings = shared.defaultSettings();

    assert.equal(settings.editor.executable, null);
    assert.deepEqual(settings.editor.args, []);

    for (const language of ['cpp', 'csharp', 'go', 'rust', 'typescript']) {
        const ls = settings.languages[language];
        assert.equal(ls.enabled, true, language);
        assert.equal(ls.executable, null, language);
        assert.deepEqual(ls.args, [], language);
        assert.deepEqual(ls.env, {}, language);
    }
});

test('본문 줄 수 상한은 설정으로 열지 않는다', () => {
    // maxCodeLines 는 "보여줄 줄 수", 하드 캡은 "읽어들일 줄 수" 다.
    // 언어 서버가 파일 전체를 한 심볼의 범위로 주는 사고를 막는 마지막 방어선이라
    // 설정보다 항상 크고 설정 스키마에도 없다.
    assert.equal(shared.MAX_TOTAL_LINES_HARD_CAP, 4000);
    assert.ok(shared.MAX_TOTAL_LINES_HARD_CAP > shared.defaultSettings().ui.maxCodeLines);
    assert.equal(JSON.stringify(shared.defaultSettings()).includes('4000'), false);
});

test('defaultSettings 는 호출할 때마다 새 객체를 준다', () => {
    // 하나를 고치면 다른 프로젝트 설정까지 따라 바뀌는 사고를 막는다
    const a = shared.defaultSettings();
    const b = shared.defaultSettings();
    a.ui.fontSize = 99;
    a.languages.cpp.args.push('--깨짐');

    assert.equal(b.ui.fontSize, 0);
    assert.deepEqual(b.languages.cpp.args, []);
});

test('탭 폭은 기본 4 이고 옛 설정 파일에도 채워진다', () => {
    // 표시 설정이다. 두 화면이 같은 값을 써야 같은 함수가 같게 보인다(V20).
    assert.equal(shared.defaultSettings().ui.tabSize, 4);

    const legacy = shared.defaultSettings();
    delete legacy.ui.tabSize;
    const parsed = shared.parseWith(shared.projectSettingsSchema, legacy);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.ui.tabSize, 4);

    assert.equal(
        shared.parseWith(shared.projectSettingsSchema, {
            ...shared.defaultSettings(),
            ui: { ...shared.defaultSettings().ui, tabSize: 0 },
        }).ok,
        false,
    );
});
