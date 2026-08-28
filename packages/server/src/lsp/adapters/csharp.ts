import path from 'node:path';

import type { SpawnCommand } from '../types.js';
import { relativeOrName } from './clangd.js';
import { checkConfiguredExecutable, findByExtension, findOnPath, runCommand } from './detect.js';
import { settingsFor, type DetectionResult, type HealthCheck, type LspAdapter, type WorkspaceInfo } from './types.js';

/**
 * C# — roslyn-language-server (구현서 12.2).
 *
 * **이 어댑터는 전환 전체의 선행 위험 항목이다.** 공식 서버는 있지만 명령줄과
 * 배포 방식이 아직 실험적이다. 그래서 지키는 것이 넷이다.
 *
 * 1. 실행 파일을 **자동으로 내려받지 않는다.** VS Code 확장 디렉터리를 뒤져
 *    거기 있는 것을 몰래 쓰지도 않는다 — 남의 확장이 관리하는 파일이다.
 * 2. 설정의 명시 경로를 먼저 보고, 그다음 `PATH` 만 본다.
 * 3. 실행 인자와 `initializationOptions` 를 **여기 안에만** 둔다. 공통 계층에
 *    박아두면 서버 배포 규약이 바뀔 때마다 공통 계층을 고쳐야 한다.
 * 4. 솔루션 후보가 둘 이상이면 **고르지 않는다.** 사용자가 정한 값을
 *    `languages.csharp.solutionPath` 에 상대경로로 저장한다.
 */

/** 진단 화면에 보여줄 솔루션 후보의 최대 개수. */
export const MAX_SOLUTION_CANDIDATES = 20;

export interface SolutionCandidates {
    /** 프로젝트 상대경로. 얕은 것부터. */
    paths: string[];
    /** 후보가 하나뿐이라 기본값으로 제안할 수 있는지. */
    suggested: string | null;
}

/** `.sln`, `.slnx`, `.csproj` 후보를 찾는다 (구현서 12.2 5단계). */
export async function findSolutionCandidates(projectRoot: string): Promise<SolutionCandidates> {
    const found = await findByExtension(projectRoot, ['.sln', '.slnx', '.csproj'], {
        maxResults: MAX_SOLUTION_CANDIDATES,
    });
    const paths = found.map((full) => relativeOrName(projectRoot, full));

    // 솔루션이 있으면 그것을 먼저 본다. csproj 는 솔루션이 없을 때의 대안이다.
    const solutions = paths.filter((p) => p.endsWith('.sln') || p.endsWith('.slnx'));
    const pool = solutions.length > 0 ? solutions : paths;

    return {
        paths,
        // 후보가 하나면 제안한다. 여럿이면 우리가 고르지 않는다.
        suggested: pool.length === 1 ? (pool[0] as string) : null,
    };
}

export const csharpAdapter: LspAdapter = {
    id: 'csharp',
    languageIds: ['csharp'],
    displayName: 'roslyn-language-server',

    async detectExecutable(workspace: WorkspaceInfo): Promise<DetectionResult> {
        const configured = settingsFor(workspace, 'csharp').executable;
        if (configured !== null && configured.trim() !== '') {
            const checked = await checkConfiguredExecutable(configured, 'C# 언어 서버');
            return checked.ok
                ? { executable: checked.executable, source: 'settings', hint: null }
                : { executable: null, source: 'notFound', hint: checked.hint };
        }

        const onPath = await findOnPath('roslyn-language-server');
        if (onPath !== null) {
            return { executable: onPath, source: 'path', hint: null };
        }

        return {
            executable: null,
            source: 'notFound',
            hint: 'roslyn-language-server 를 찾지 못했다. C# 독립 언어 서버는 배포 규약이 '
                + '아직 안정되지 않아 자동으로 내려받지 않는다. 직접 설치한 뒤 '
                + '`.code-trail/settings.json` 의 `languages.csharp.executable` 에 경로를 적는다.',
        };
    },

    buildCommand(executable: string, workspace: WorkspaceInfo): SpawnCommand {
        const settings = settingsFor(workspace, 'csharp');
        return {
            command: executable,
            // 인자를 우리가 만들어 넣지 않는다. 설정에 적힌 것만 그대로 넘긴다 —
            // 서버 배포 규약이 바뀌면 사용자가 설정만 고치면 된다.
            args: [...settings.args],
            env: { ...settings.env },
            cwd: workspace.projectRoot,
        };
    },

    initializationOptions(workspace: WorkspaceInfo): unknown {
        const settings = workspace.settings.languages.csharp;
        if (settings.initializationOptions !== null
            && settings.initializationOptions !== undefined) {
            return settings.initializationOptions;
        }
        // 솔루션을 골랐으면 알려준다. 형식은 서버마다 다를 수 있어 사용자가
        // `initializationOptions` 로 통째로 덮어쓸 수 있게 뒀다.
        if (settings.solutionPath !== null) {
            return { solution: settings.solutionPath };
        }
        return null;
    },

    async healthChecks(
        workspace: WorkspaceInfo,
        detection: DetectionResult,
    ): Promise<HealthCheck[]> {
        const checks: HealthCheck[] = [];

        if (detection.executable === null) {
            checks.push({
                label: 'C# 언어 서버',
                level: 'error',
                detail: detection.hint ?? '찾지 못했다.',
            });
        } else {
            const version = await runCommand(detection.executable, ['--version']);
            checks.push({
                label: 'roslyn-language-server --version',
                // 버전 옵션을 지원하지 않는 배포본이 있다. 없다고 못 쓰는 건 아니다.
                level: version.ok ? 'ok' : 'warn',
                detail: version.ok
                    ? version.output
                    : '버전을 확인하지 못했다. 이 배포본이 --version 을 지원하지 않을 수 있다.',
            });
        }

        const dotnet = await findOnPath('dotnet');
        checks.push(dotnet !== null
            ? await (async () => {
                const result = await runCommand(dotnet, ['--version']);
                return {
                    label: 'dotnet --version',
                    level: result.ok ? ('ok' as const) : ('warn' as const),
                    detail: result.ok ? result.output : '실행하지 못했다.',
                };
            })()
            : {
                label: '.NET SDK',
                level: 'warn',
                detail: 'dotnet 을 PATH 에서 찾지 못했다.',
            });

        const settings = workspace.settings.languages.csharp;
        const candidates = await findSolutionCandidates(workspace.projectRoot);

        if (settings.solutionPath !== null) {
            const known = candidates.paths.includes(settings.solutionPath);
            checks.push({
                label: '선택한 솔루션',
                level: known ? 'ok' : 'warn',
                detail: known
                    ? settings.solutionPath
                    : `${settings.solutionPath} — 설정에 적힌 파일을 찾지 못했다.`,
            });
        } else if (candidates.suggested !== null) {
            checks.push({
                label: '솔루션 후보',
                level: 'warn',
                detail: `${candidates.suggested} 하나뿐이다. `
                    + '`languages.csharp.solutionPath` 에 적으면 그것을 연다.',
            });
        } else if (candidates.paths.length > 1) {
            // **우리가 고르지 않는다.** 어느 솔루션인지는 사용자만 안다.
            checks.push({
                label: '솔루션 후보',
                level: 'warn',
                detail: `${candidates.paths.length}개다 (${candidates.paths.slice(0, 3).join(', ')}`
                    + `${candidates.paths.length > 3 ? ' …' : ''}). `
                    + '`languages.csharp.solutionPath` 에 하나를 적는다.',
            });
        } else {
            checks.push({
                label: '솔루션 후보',
                level: 'warn',
                detail: '.sln 도 .csproj 도 찾지 못했다.',
            });
        }

        return checks;
    },
};

/** 솔루션 경로가 프로젝트 안의 상대경로인지. 설정을 저장하기 전에 본다. */
export function isProjectRelative(value: string): boolean {
    if (value.trim() === '' || path.isAbsolute(value) || /^[a-zA-Z]:/.test(value)) {
        return false;
    }
    return !value.split(/[\\/]/).includes('..');
}
