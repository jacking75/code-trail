/**
 * 프로젝트 설정. `.code-trail/settings.json` 에 그대로 저장한다.
 *
 * 확장의 `codeTrail.*` 설정 중 옮길 것을 `ui` 아래로 모으고, 호스트가 대신 해주던
 * 일(에디터 열기, 언어 서버 기동)을 `editor` 와 `languages` 로 드러냈다.
 * 대응 관계는 `docs/e2e-port-checklist.md` 9절에 있다.
 */

export interface LanguageServerSettings {
    enabled: boolean;
    /** 실행 파일 경로. `null` 이면 PATH 에서 자동 탐지한다. */
    executable: string | null;
    args: string[];
    /**
     * 자식 프로세스 환경에 **덮어쓸 키만** 담는다. 전체 환경을 대체하지 않는다.
     * 비밀값을 넣지 않는다 — 로그에서는 값을 가리지만 파일에는 평문으로 남는다.
     */
    env: Record<string, string>;
    /** LSP `initialize` 의 `initializationOptions` 로 그대로 넘어간다. */
    initializationOptions: unknown;
}

export type ThemeSetting = 'system' | 'light' | 'dark';
export type ClickTargetSetting = 'allSymbols' | 'callsOnly';
export type ChildOrderSetting = 'source' | 'click';

export interface UiSettings {
    theme: ThemeSetting;
    /** 코드 본문에서 클릭 가능한 대상. */
    clickTarget: ClickTargetSetting;
    /** 같은 부모 아래 형제 노드 정렬 순서. */
    childOrder: ChildOrderSetting;
    /** 노드 하나에 표시할 코드의 최대 줄 수. 초과분은 접힌다. */
    maxCodeLines: number;
    /** 본문 범위를 못 구했을 때 정의 위치 기준으로 보여줄 줄 수. */
    contextLines: number;
    /** 폭에 맞춰 코드 본문 글자 크기를 자동으로 줄인다. 헤더는 줄이지 않는다. */
    fitToWidth: boolean;
    /** 폭 맞춤으로 줄일 수 있는 하한(px). */
    minFontSize: number;
    /** 코드 글자 크기(px). 0 보다 크면 `fitToWidth` 보다 우선한다. */
    fontSize: number;
    /** 몸통 없는 선언의 구현이 정확히 하나뿐일 때 거기까지 바로 펼친다. */
    autoFollowSingleImplementation: boolean;
    /** 노드를 추가할 때 외부 에디터에서도 그 위치를 연다. */
    revealInExternalEditorOnAdd: boolean;
}

export interface EditorSettings {
    /** 외부 에디터 실행 파일. `null` 이면 열기 기능을 끈다. */
    executable: string | null;
    /** 실행 인자. `{path}`, `{line}`, `{column}`, `{project}` 자리표시자만 허용한다. */
    args: string[];
}

export interface LanguageSettings {
    cpp: LanguageServerSettings;
    csharp: LanguageServerSettings;
    go: LanguageServerSettings;
    rust: LanguageServerSettings;
}

export interface ProjectSettings {
    schemaVersion: 1;
    ui: UiSettings;
    editor: EditorSettings;
    languages: LanguageSettings;
}

export const SETTINGS_SCHEMA_VERSION = 1;

/**
 * 노드 하나가 읽을 수 있는 코드의 절대 상한.
 *
 * `ui.maxCodeLines` 는 "보여줄 줄 수" 이고 이 값은 "읽어들일 줄 수" 다.
 * 언어 서버가 파일 전체를 한 심볼의 범위로 주는 사고를 막는 마지막 방어선이라
 * 설정으로 열지 않는다. 확장의 값(4,000)을 그대로 유지한다.
 */
export const MAX_TOTAL_LINES_HARD_CAP = 4000;

function defaultLanguageServer(): LanguageServerSettings {
    return {
        enabled: true,
        executable: null,
        args: [],
        env: {},
        initializationOptions: null,
    };
}

/** 설정 파일이 없을 때 쓰는 값. 확장의 기본값을 그대로 옮겼다. */
export function defaultSettings(): ProjectSettings {
    return {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        ui: {
            theme: 'system',
            clickTarget: 'allSymbols',
            childOrder: 'source',
            maxCodeLines: 250,
            contextLines: 40,
            fitToWidth: true,
            minFontSize: 8,
            fontSize: 0,
            autoFollowSingleImplementation: true,
            revealInExternalEditorOnAdd: false,
        },
        editor: {
            executable: null,
            args: [],
        },
        languages: {
            cpp: defaultLanguageServer(),
            csharp: defaultLanguageServer(),
            go: defaultLanguageServer(),
            rust: defaultLanguageServer(),
        },
    };
}
