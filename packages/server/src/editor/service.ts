import { spawn, type SpawnOptions } from 'node:child_process';
import path from 'node:path';

import type { ProjectSettings } from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { checkConfiguredExecutable, findOnPath } from '../lsp/adapters/detect.js';
import type { DocumentRegistry } from '../workspace/documents.js';
import { defaultArgsFor, findEditorCandidates, type EditorCandidate } from './detect.js';

/**
 * 외부 에디터에서 열기 (구현서 17).
 *
 * 지켜야 할 것이 넷이다.
 *
 * 1. **경로는 서버가 정한다.** 브라우저는 `documentId` 만 보내고, 실제 경로는
 *    문서 권한 목록에서 역조회한다. 브라우저가 보낸 path 는 쓰지 않는다 —
 *    쓰는 순간 "임의의 파일을 임의의 프로그램으로 열어라" 가 된다.
 * 2. **셸을 거치지 않는다.** `shell: false` 로 실행 파일과 argv 배열을 그대로
 *    넘긴다. 파일 이름에 `;` 나 `&&` 가 들어 있어도 한 개의 인자로만 간다.
 * 3. **자리표시자는 넷뿐이다.** `{path}`, `{line}`, `{column}`, `{project}`.
 *    모르는 자리표시자가 있으면 실행하지 않고 이유를 알린다.
 * 4. **사용자가 정하기 전에는 실행하지 않는다.** 탐지 결과는 제안일 뿐이다.
 *
 * 실행에 실패하면 경로와 줄을 돌려준다. 화면이 그걸 복사할 수 있게 해서,
 * 에디터를 못 띄워도 사용자가 손으로 찾아갈 수 있다.
 */

export type EditorDenyReason =
    | 'notConfigured'
    | 'unknownDocument'
    | 'badPlaceholder'
    | 'executableMissing'
    | 'spawnFailed';

export interface EditorOpenResult {
    /** 화면에 찍는 경로. 절대경로가 아니다. */
    displayPath: string;
    /** 외부 에디터 관례에 맞춘 1-based 줄. */
    line: number;
    /** 외부 에디터 관례에 맞춘 1-based 컬럼. */
    column: number;
    launched: boolean;
    /** 못 열었으면 왜 못 열었는지 한 줄. 열렸으면 `null`. */
    reason: string | null;
    denyReason: EditorDenyReason | null;
}

export class EditorDeniedError extends Error {
    constructor(readonly reason: EditorDenyReason, message: string) {
        super(message);
        this.name = 'EditorDeniedError';
    }
}

/** 자리표시자로 인정하는 것. 이 넷 말고는 실행을 거부한다. */
const PLACEHOLDERS = ['path', 'line', 'column', 'project'] as const;
const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

export interface EditorServiceOptions {
    projectRoot: string;
    documents: DocumentRegistry;
    getSettings: () => ProjectSettings;
    logger: Logger;
    /** 테스트에서 실제 실행을 가로챈다. */
    spawnImpl?: (command: string, args: string[], options: SpawnOptions) => { unref: () => void };
}

/**
 * 인자 하나에 자리표시자를 채운다.
 *
 * 값을 따옴표로 감싸거나 escape 하지 않는다. 셸을 거치지 않으므로 그럴 이유가
 * 없고, 감싸면 오히려 따옴표가 파일 이름의 일부로 들어간다.
 */
export function fillPlaceholders(
    arg: string,
    values: { path: string; line: number; column: number; project: string },
): string {
    return arg.replace(PLACEHOLDER_PATTERN, (_whole, name: string) => {
        switch (name) {
            case 'path':
                return values.path;
            case 'line':
                return String(values.line);
            case 'column':
                return String(values.column);
            case 'project':
                return values.project;
            default:
                // 여기까지 오지 않는다. 미리 검사한다.
                return '';
        }
    });
}

/** 모르는 자리표시자를 찾는다. 하나라도 있으면 실행하지 않는다. */
export function unknownPlaceholders(args: readonly string[]): string[] {
    const bad = new Set<string>();
    for (const arg of args) {
        for (const match of arg.matchAll(PLACEHOLDER_PATTERN)) {
            const name = match[1] as string;
            if (!(PLACEHOLDERS as readonly string[]).includes(name)) {
                bad.add(name);
            }
        }
    }
    return [...bad];
}

export class EditorService {
    private readonly logger: Logger;

    constructor(private readonly options: EditorServiceOptions) {
        this.logger = options.logger.child('editor');
    }

    /** 설정에 실행 파일이 적혀 있는지. bootstrap 의 `capabilities` 가 쓴다. */
    isConfigured(): boolean {
        const configured = this.options.getSettings().editor.executable;
        return configured !== null && configured.trim() !== '';
    }

    /** PATH 에서 찾은 후보. 제안만 하고 자동으로 쓰지 않는다. */
    candidates(): Promise<EditorCandidate[]> {
        return findEditorCandidates();
    }

    /**
     * 문서 ID 가 가리키는 자리를 외부 에디터에서 연다.
     *
     * `line`, `char` 는 화면과 같은 0-based 로 받아서 1-based 로 바꿔 넘긴다.
     * 외부 에디터는 전부 1-based 를 쓴다.
     */
    async open(documentId: string, line: number, char: number): Promise<EditorOpenResult> {
        const grant = this.options.documents.get(documentId);
        if (grant === undefined) {
            // 브라우저가 만들어낸 ID 이거나, 서버를 다시 띄워 권한이 사라진 것이다.
            // 어느 쪽이든 경로를 알려주지 않는다.
            throw new EditorDeniedError(
                'unknownDocument',
                '권한이 없는 문서다. 파일을 먼저 연 다음 다시 시도한다.',
            );
        }

        const oneBasedLine = Math.max(1, Math.floor(line) + 1);
        const oneBasedColumn = Math.max(1, Math.floor(char) + 1);
        const base: Omit<EditorOpenResult, 'launched' | 'reason' | 'denyReason'> = {
            displayPath: grant.displayPath,
            line: oneBasedLine,
            column: oneBasedColumn,
        };

        const settings = this.options.getSettings().editor;
        const configured = settings.executable;
        if (configured === null || configured.trim() === '') {
            return {
                ...base,
                launched: false,
                reason: '외부 에디터가 설정되지 않았다. 진단 화면에서 하나 고른다.',
                denyReason: 'notConfigured',
            };
        }

        const args = settings.args.length > 0
            ? settings.args
            : defaultArgsFor(configured) ?? ['{path}'];

        const bad = unknownPlaceholders(args);
        if (bad.length > 0) {
            return {
                ...base,
                launched: false,
                reason: `모르는 자리표시자다: ${bad.map((name) => `{${name}}`).join(', ')}. `
                    + '{path}, {line}, {column}, {project} 만 쓸 수 있다.',
                denyReason: 'badPlaceholder',
            };
        }

        const executable = await this.resolveExecutable(configured);
        if (executable === null) {
            return {
                ...base,
                launched: false,
                reason: '설정에 적힌 에디터 실행 파일을 찾지 못했다.',
                denyReason: 'executableMissing',
            };
        }

        const filled = args.map((arg) => fillPlaceholders(arg, {
            path: grant.realPath,
            line: oneBasedLine,
            column: oneBasedColumn,
            project: this.options.projectRoot,
        }));

        try {
            const launch = this.options.spawnImpl ?? defaultSpawn;
            const child = launch(executable, filled, {
                cwd: this.options.projectRoot,
                // **셸을 거치지 않는다.** 파일 이름에 셸 특수문자가 있어도
                // 한 개의 인자로만 간다.
                shell: false,
                detached: true,
                stdio: 'ignore',
            });
            // 우리가 죽어도 에디터는 살아 있어야 한다.
            child.unref();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            // 절대경로가 섞여 나가지 않게 이름만 남긴다.
            this.logger.warn('외부 에디터를 띄우지 못했다.', {
                executable: path.basename(executable),
            });
            return {
                ...base,
                launched: false,
                reason: `에디터를 띄우지 못했다: ${message.slice(0, 200)}`,
                denyReason: 'spawnFailed',
            };
        }

        this.logger.debug('외부 에디터를 띄웠다.', {
            executable: path.basename(executable),
            displayPath: grant.displayPath,
        });
        return { ...base, launched: true, reason: null, denyReason: null };
    }

    /**
     * 설정 값이 경로면 그대로, 이름이면 PATH 에서 찾는다.
     * Windows 의 `.cmd`/`.bat` shim 은 셸 없이 띄울 수 없어 여기서 걸린다.
     */
    private async resolveExecutable(configured: string): Promise<string | null> {
        if (configured.includes('/') || configured.includes('\\')) {
            const checked = await checkConfiguredExecutable(configured, '에디터');
            return checked.ok ? checked.executable : null;
        }
        return findOnPath(configured);
    }
}

function defaultSpawn(
    command: string,
    args: string[],
    options: SpawnOptions,
): { unref: () => void } {
    return spawn(command, args, options);
}
