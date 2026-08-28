import path from 'node:path';

import { findOnPath } from '../lsp/adapters/detect.js';

/**
 * 외부 에디터 CLI 탐지 (구현서 17.2).
 *
 * **후보를 찾아 제안만 한다.** 사용자가 설정으로 확정하기 전에는 아무것도 실행하지
 * 않는다 — 파일을 눌렀더니 모르는 프로그램이 뜨는 것은 그 자체로 놀랄 일이다.
 *
 * 인자 틀은 에디터마다 다르다. "이 파일의 이 줄을 열어라" 라는 뜻을 각 CLI 가
 * 저마다의 문법으로 받기 때문에, 여기서 그 문법을 한 곳에 모아 둔다.
 * 자리표시자는 `{path}`, `{line}`, `{column}`, `{project}` 넷뿐이다.
 */

export interface EditorCandidate {
    /** PATH 에서 찾은 실행 파일 **이름**. 절대경로는 브라우저로 내보내지 않는다. */
    name: string;
    /** 사람에게 보여줄 이름. */
    displayName: string;
    /** 설정에 그대로 넣을 수 있는 인자 틀. */
    args: string[];
    /** 설정에 적을 실행 파일. PATH 에 있으면 이름만으로 충분하다. */
    executable: string;
}

interface KnownEditor {
    command: string;
    displayName: string;
    args: string[];
}

/**
 * 알려진 에디터 CLI.
 *
 * 위에 있는 것부터 본다. 코드 편집기를 먼저, 터미널 편집기를 나중에 둔다 —
 * 개발 PC 에는 `vim` 이 거의 항상 있어서 먼저 두면 늘 그것만 잡힌다.
 */
const KNOWN_EDITORS: readonly KnownEditor[] = [
    { command: 'code', displayName: 'Visual Studio Code', args: ['--goto', '{path}:{line}:{column}'] },
    { command: 'cursor', displayName: 'Cursor', args: ['--goto', '{path}:{line}:{column}'] },
    { command: 'codium', displayName: 'VSCodium', args: ['--goto', '{path}:{line}:{column}'] },
    { command: 'zed', displayName: 'Zed', args: ['{path}:{line}:{column}'] },
    { command: 'subl', displayName: 'Sublime Text', args: ['{path}:{line}:{column}'] },
    { command: 'idea', displayName: 'IntelliJ IDEA', args: ['--line', '{line}', '--column', '{column}', '{path}'] },
    { command: 'rider', displayName: 'JetBrains Rider', args: ['--line', '{line}', '--column', '{column}', '{path}'] },
    { command: 'clion', displayName: 'CLion', args: ['--line', '{line}', '--column', '{column}', '{path}'] },
    { command: 'goland', displayName: 'GoLand', args: ['--line', '{line}', '--column', '{column}', '{path}'] },
    { command: 'hx', displayName: 'Helix', args: ['{path}:{line}:{column}'] },
    { command: 'emacsclient', displayName: 'Emacs', args: ['+{line}:{column}', '{path}'] },
    { command: 'nvim', displayName: 'Neovim', args: ['+{line}', '{path}'] },
    { command: 'vim', displayName: 'Vim', args: ['+{line}', '{path}'] },
];

/** PATH 에서 찾은 에디터 후보. 못 찾으면 빈 목록이다. */
export async function findEditorCandidates(): Promise<EditorCandidate[]> {
    const found: EditorCandidate[] = [];
    for (const editor of KNOWN_EDITORS) {
        const executable = await findOnPath(editor.command);
        if (executable === null) {
            continue;
        }
        found.push({
            // 이름만 내보낸다. 전체 경로는 브라우저로 나가지 않는다(구현서 8.1).
            name: path.basename(executable),
            displayName: editor.displayName,
            args: [...editor.args],
            executable: editor.command,
        });
    }
    return found;
}

/** 설정에 실행 파일만 적었을 때 채워 줄 기본 인자. 모르는 에디터면 `null`. */
export function defaultArgsFor(executable: string): string[] | null {
    const base = path.basename(executable).toLowerCase().replace(/\.(exe|com)$/, '');
    const known = KNOWN_EDITORS.find((editor) => editor.command === base);
    return known === undefined ? null : [...known.args];
}
