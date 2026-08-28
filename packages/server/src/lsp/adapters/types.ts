import type { LanguageServerSettings, ProjectSettings } from '@code-trail/shared';

import type { SupportedLanguage } from '../../workspace/languages.js';
import type { SpawnCommand } from '../types.js';

/**
 * 언어별 어댑터 (구현서 11.3, 12장).
 *
 * 공통 LSP 계층은 언어를 모른다. 언어마다 다른 것은 셋뿐이고, 그 셋만 여기 담는다.
 *
 * 1. **실행 파일을 어디서 찾는가** — clangd 는 LLVM 설치 위치, gopls 는 `GOBIN`,
 *    rust-analyzer 는 rustup proxy 를 각각 봐야 한다.
 * 2. **무엇이 있어야 제대로 도는가** — clangd 는 `compile_commands.json`,
 *    gopls 는 `go.mod`, rust-analyzer 는 `Cargo.toml` 이 없으면 정확도가 떨어진다.
 * 3. **어떤 인자와 initializationOptions 를 주는가.**
 *
 * **실행 파일을 자동으로 내려받지 않는다**(구현서 2). 사용자가 설치한 것을 찾거나,
 * 설정에 적힌 경로를 쓴다. 설치 명령은 안내만 하고 우리가 실행하지 않는다.
 */

export interface WorkspaceInfo {
    projectRoot: string;
    settings: ProjectSettings;
}

/** 실행 파일을 어떻게 찾았는지. 진단 화면이 이걸 그대로 보여준다. */
export type DetectionSource =
    | 'settings'
    | 'path'
    | 'platform'
    | 'goBin'
    | 'goPath'
    | 'rustup'
    | 'notFound';

export interface DetectionResult {
    /** 찾은 실행 파일의 절대경로. 못 찾았으면 `null`. */
    executable: string | null;
    source: DetectionSource;
    /** 못 찾았을 때 사용자에게 보여줄 안내. 설치 명령을 우리가 실행하지 않는다. */
    hint: string | null;
}

export type HealthLevel = 'ok' | 'warn' | 'error';

export interface HealthCheck {
    /** 화면에 찍는 항목 이름. 예: `clangd --version` */
    label: string;
    level: HealthLevel;
    /** 한 줄 결과. 절대경로와 코드 본문을 담지 않는다. */
    detail: string;
}

export interface LspAdapter {
    id: SupportedLanguage;
    /** 이 어댑터가 맡는 `languageId` 들. */
    languageIds: readonly string[];
    /** 사람에게 보여줄 서버 이름. */
    displayName: string;

    detectExecutable(workspace: WorkspaceInfo): Promise<DetectionResult>;

    /**
     * 실행 명령을 만든다. 인자와 initializationOptions 는 **여기서만** 정한다 —
     * 공통 코드에 언어별 인자를 박으면 서버 배포 규약이 바뀔 때 공통 계층이 흔들린다.
     */
    buildCommand(executable: string, workspace: WorkspaceInfo): SpawnCommand;

    /** `initialize` 에 실어 보낼 언어별 옵션. */
    initializationOptions(workspace: WorkspaceInfo): unknown;

    /** 진단 화면이 보여줄 점검 목록. 실행 파일이 없어도 부를 수 있어야 한다. */
    healthChecks(
        workspace: WorkspaceInfo,
        detection: DetectionResult,
    ): Promise<HealthCheck[]>;
}

/** 설정에서 이 언어의 항목만 꺼낸다. */
export function settingsFor(
    workspace: WorkspaceInfo,
    language: SupportedLanguage,
): LanguageServerSettings {
    return workspace.settings.languages[language];
}
