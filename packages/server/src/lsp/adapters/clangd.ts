import path from 'node:path';

import type { SpawnCommand } from '../types.js';
import {
    directoryExists,
    findOnPath,
    findUpwards,
    firstExecutable,
    checkConfiguredExecutable,
    runCommand,
} from './detect.js';
import { settingsFor, type DetectionResult, type HealthCheck, type LspAdapter, type WorkspaceInfo } from './types.js';

/**
 * C/C++ — clangd (구현서 12.1).
 *
 * **Code Trail 은 C++ 빌드 플래그를 추측하지 않는다.** 헤더 탐색 경로를 우리가
 * 계산하기 시작하면 그 계산이 틀릴 때마다 사용자가 우리를 의심하게 되고,
 * 정확도의 책임이 언어 서버에서 우리에게 넘어온다. `compile_commands.json` 이
 * 있는지 알려주는 것까지가 우리 몫이다.
 */

/** 플랫폼별 흔한 LLVM 설치 위치. 읽기만 한다. */
function platformCandidates(): string[] {
    switch (process.platform) {
        case 'win32':
            return [
                'C:\\Program Files\\LLVM\\bin\\clangd.exe',
                'C:\\Program Files (x86)\\LLVM\\bin\\clangd.exe',
            ];
        case 'darwin':
            return [
                '/opt/homebrew/opt/llvm/bin/clangd',
                '/usr/local/opt/llvm/bin/clangd',
                '/Library/Developer/CommandLineTools/usr/bin/clangd',
            ];
        default:
            return [
                '/usr/bin/clangd',
                '/usr/local/bin/clangd',
                '/usr/lib/llvm/bin/clangd',
            ];
    }
}

export const clangdAdapter: LspAdapter = {
    id: 'cpp',
    languageIds: ['c', 'cpp'],
    displayName: 'clangd',

    async detectExecutable(workspace: WorkspaceInfo): Promise<DetectionResult> {
        const configured = settingsFor(workspace, 'cpp').executable;
        if (configured !== null && configured.trim() !== '') {
            const checked = await checkConfiguredExecutable(configured, 'clangd');
            return checked.ok
                ? { executable: checked.executable, source: 'settings', hint: null }
                : { executable: null, source: 'notFound', hint: checked.hint };
        }

        const onPath = await findOnPath('clangd');
        if (onPath !== null) {
            return { executable: onPath, source: 'path', hint: null };
        }

        const platform = await firstExecutable(platformCandidates());
        if (platform !== null) {
            return { executable: platform, source: 'platform', hint: null };
        }

        return {
            executable: null,
            source: 'notFound',
            hint: 'clangd 를 찾지 못했다. LLVM 을 설치하거나 '
                + '`.code-trail/settings.json` 의 `languages.cpp.executable` 에 경로를 적는다.',
        };
    },

    buildCommand(executable: string, workspace: WorkspaceInfo): SpawnCommand {
        const settings = settingsFor(workspace, 'cpp');
        return {
            command: executable,
            // 사용자가 준 `--compile-commands-dir` 나 `--query-driver` 는 argv 로만
            // 전달한다. 우리가 값을 만들어 넣지 않는다.
            args: [...settings.args],
            env: { ...settings.env },
            cwd: workspace.projectRoot,
        };
    },

    initializationOptions(workspace: WorkspaceInfo): unknown {
        return settingsFor(workspace, 'cpp').initializationOptions ?? null;
    },

    async healthChecks(
        workspace: WorkspaceInfo,
        detection: DetectionResult,
    ): Promise<HealthCheck[]> {
        const checks: HealthCheck[] = [];

        if (detection.executable === null) {
            checks.push({
                label: 'clangd 실행 파일',
                level: 'error',
                detail: detection.hint ?? '찾지 못했다.',
            });
        } else {
            const version = await runCommand(detection.executable, ['--version']);
            checks.push({
                label: 'clangd --version',
                level: version.ok ? 'ok' : 'error',
                detail: version.ok ? version.output : `실행하지 못했다: ${version.output}`,
            });
        }

        const database = await findUpwards(workspace.projectRoot, 'compile_commands.json')
            ?? (await directoryExists(path.join(workspace.projectRoot, 'build'))
                ? await findUpwards(path.join(workspace.projectRoot, 'build'), 'compile_commands.json', 0)
                : null);

        if (database !== null) {
            checks.push({
                label: 'compile_commands.json',
                level: 'ok',
                // 프로젝트 기준 상대경로만 보여준다. 절대경로는 내보내지 않는다.
                detail: relativeOrName(workspace.projectRoot, database),
            });
        } else {
            const flags = await findUpwards(workspace.projectRoot, 'compile_flags.txt');
            checks.push(flags !== null
                ? {
                    label: 'compile_flags.txt',
                    level: 'warn',
                    detail: `${relativeOrName(workspace.projectRoot, flags)} — `
                        + 'compile_commands.json 이 있으면 더 정확하다.',
                }
                : {
                    label: '컴파일 데이터베이스',
                    level: 'warn',
                    detail: 'compile_commands.json 도 compile_flags.txt 도 없다. '
                        + '헤더를 못 찾아 정의로 못 가는 경우가 생긴다.',
                });
        }

        return checks;
    },
};

/** 프로젝트 안이면 상대경로, 밖이면 파일 이름만. 절대경로를 내보내지 않는다. */
export function relativeOrName(projectRoot: string, target: string): string {
    const rel = path.relative(projectRoot, target);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        return path.basename(target);
    }
    return rel.split(path.sep).join('/');
}
