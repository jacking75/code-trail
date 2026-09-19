import { useEffect, useRef, useState, type JSX } from 'react';

import type { ProjectSettingsView } from '../../api/http.js';

/**
 * 설정 화면 (U15).
 *
 * 테마 하나 바꾸려고 `.code-trail/settings.json` 을 열지 않게 한다.
 *
 * **실행 파일 경로는 여기서 받지 않는다.** 언어 서버 실행 파일·인자·환경 변수는
 * 로컬 설정(`.code-trail/local/settings.json`)이고, 임의 실행 파일 경로를 웹
 * 입력으로 받는 통로를 만들지 않는다. 탐지 결과를 보고 고르는 것은 진단 화면이 한다.
 */

const LANGUAGE_LABEL: Record<string, string> = {
    cpp: 'C/C++ (clangd)',
    csharp: 'C# (roslyn)',
    go: 'Go (gopls)',
    rust: 'Rust (rust-analyzer)',
    typescript: 'TypeScript/JavaScript',
};

export interface SettingsViewProps {
    settings: ProjectSettingsView | null;
    readOnly: boolean;
    author: { id: string; displayName: string };
    aiCapability: { enabled: boolean; provider: string; model: string; maxInputBytes: number };
    onUpdate: (settings: ProjectSettingsView) => void;
    onAuthorName: (name: string) => void;
    onOpenDiagnostics: () => void;
}

/** 바뀔 때마다 보내지 않고 이만큼 모은다. 슬라이더를 끌 때 명령이 쏟아지지 않게. */
const SAVE_DELAY_MS = 400;

export function SettingsView(props: SettingsViewProps): JSX.Element {
    const [draft, setDraft] = useState<ProjectSettingsView | null>(props.settings);
    const [saving, setSaving] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const dirty = useRef(false);

    // 서버가 돌려준 값이 정본이다. 내가 보낸 것이 돌아오면 저장 표시를 끈다.
    useEffect(() => {
        if (!dirty.current) {
            setDraft(props.settings);
        }
    }, [props.settings]);

    useEffect(() => () => {
        if (timer.current !== undefined) clearTimeout(timer.current);
    }, []);

    const change = (next: ProjectSettingsView): void => {
        dirty.current = true;
        setDraft(next);
        setSaving(true);
        if (timer.current !== undefined) {
            clearTimeout(timer.current);
        }
        timer.current = setTimeout(() => {
            props.onUpdate(next);
            dirty.current = false;
            setSaving(false);
        }, SAVE_DELAY_MS);
    };

    if (draft === null) {
        return <div className="settings" id="settings"><p className="muted">설정을 읽는 중이다.</p></div>;
    }

    const ui = draft.ui;
    const setUi = (patch: Partial<ProjectSettingsView['ui']>): void =>
        change({ ...draft, ui: { ...ui, ...patch } });

    return (
        <div className="settings" id="settings">
            <div className="toolbar">
                <span className="muted">
                    프로젝트 설정은 <code>.code-trail/settings.json</code> 에 저장된다.
                </span>
                <span className="spacer" />
                <span className="save-state" role="status">{saving ? '저장 중…' : '저장됨'}</span>
            </div>

            <section className="settings-card">
                <h2>화면</h2>
                <fieldset>
                    <legend>테마</legend>
                    {(['system', 'light', 'dark'] as const).map((value) => (
                        <label key={value}>
                            <input
                                type="radio"
                                name="ct-theme"
                                value={value}
                                checked={ui.theme === value}
                                disabled={props.readOnly}
                                onChange={() => setUi({ theme: value })}
                            />
                            {value === 'system' ? '브라우저 설정' : value === 'light' ? '밝게' : '어둡게'}
                        </label>
                    ))}
                </fieldset>
                <label>
                    코드 글자 크기 (0 = 자동)
                    <input
                        type="number"
                        min={0}
                        max={40}
                        value={ui.fontSize}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({ fontSize: Number(event.target.value) })}
                    />
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={ui.fitToWidth}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({ fitToWidth: event.target.checked })}
                    />
                    폭 맞춤 — 가장 빠듯한 노드에 맞춰 코드 본문 글자를 줄인다
                </label>
                <label>
                    최소 글자 크기
                    <input
                        type="number"
                        min={1}
                        max={30}
                        value={ui.minFontSize}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({ minFontSize: Number(event.target.value) })}
                    />
                </label>
                <label>
                    노드당 최대 줄 수
                    <input
                        type="number"
                        min={1}
                        max={5000}
                        value={ui.maxCodeLines}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({ maxCodeLines: Number(event.target.value) })}
                    />
                </label>
                <label>
                    탭 폭
                    <input
                        type="number"
                        min={1}
                        max={16}
                        value={ui.tabSize}
                        disabled={props.readOnly}
                        title="코드 화면과 노드 본문이 같은 값을 쓴다. 원본 문자열은 바뀌지 않는다."
                        onChange={(event) => setUi({ tabSize: Number(event.target.value) })}
                    />
                </label>
            </section>

            <section className="settings-card">
                <h2>탐색</h2>
                <label>
                    클릭 대상
                    <select
                        value={ui.clickTarget}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({
                            clickTarget: event.target.value as 'allSymbols' | 'callsOnly',
                        })}
                    >
                        <option value="allSymbols">모든 식별자</option>
                        <option value="callsOnly">호출처럼 보이는 것만</option>
                    </select>
                </label>
                <label>
                    형제 정렬 기본값
                    <select
                        value={ui.childOrder}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({
                            childOrder: event.target.value as 'source' | 'click',
                        })}
                    >
                        <option value="source">코드 순서</option>
                        <option value="click">클릭 순서</option>
                    </select>
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={ui.autoFollowSingleImplementation}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({
                            autoFollowSingleImplementation: event.target.checked,
                        })}
                    />
                    구현이 하나뿐이면 자동으로 따라가기
                </label>
                <label>
                    <input
                        type="checkbox"
                        checked={ui.revealInExternalEditorOnAdd}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({
                            revealInExternalEditorOnAdd: event.target.checked,
                        })}
                    />
                    노드를 붙일 때 외부 에디터도 함께 열기
                </label>
                <label>
                    문맥 줄 수 — 언어 서버가 범위를 한 줄만 줄 때 보정하는 양
                    <input
                        type="number"
                        min={1}
                        max={200}
                        value={ui.contextLines}
                        disabled={props.readOnly}
                        onChange={(event) => setUi({ contextLines: Number(event.target.value) })}
                    />
                </label>
            </section>

            <section className="settings-card">
                <h2>언어 서버</h2>
                <p className="muted">
                    실행 파일·인자·환경 변수는 기계마다 다르므로
                    {' '}<code>.code-trail/local/settings.json</code> 에 둔다. 탐지 결과를 보고
                    고르는 것은 진단 화면에서 한다.
                </p>
                {(Object.keys(LANGUAGE_LABEL) as Array<keyof ProjectSettingsView['languages']>)
                    .map((language) => (
                        <label key={language}>
                            <input
                                type="checkbox"
                                checked={draft.languages[language].enabled}
                                disabled={props.readOnly}
                                onChange={(event) => change({
                                    ...draft,
                                    languages: {
                                        ...draft.languages,
                                        [language]: {
                                            ...draft.languages[language],
                                            enabled: event.target.checked,
                                        },
                                    },
                                })}
                            />
                            {LANGUAGE_LABEL[language]}
                        </label>
                    ))}
                <button type="button" onClick={props.onOpenDiagnostics}>진단 화면 열기</button>
            </section>

            {props.readOnly ? null : (
                <section className="settings-card">
                    <h2>작성자와 AI</h2>
                    <label>
                        표시 이름
                        <input
                            value={props.author.displayName}
                            onChange={(event) => props.onAuthorName(event.target.value)}
                        />
                    </label>
                    <small className="muted">로컬 표시일 뿐 인증된 신원이 아니다.</small>
                    <p className="muted">
                        {props.aiCapability.enabled
                            ? `AI 설명 초안: ${props.aiCapability.provider} · ${props.aiCapability.model}`
                            : 'AI 설명 초안이 꺼져 있다.'}
                        {' '}제공자와 모델은 <code>.code-trail/local/settings.json</code> 에서
                        명시적으로 켠다 — loopback 주소만 허용한다.
                    </p>
                </section>
            )}
        </div>
    );
}
