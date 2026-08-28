import path from 'node:path';

import type { SpawnCommand } from '../types.js';
import { relativeOrName } from './clangd.js';
import { fileExists, checkConfiguredExecutable, findOnPath, firstExecutable, runCommand } from './detect.js';
import { settingsFor, type DetectionResult, type HealthCheck, type LspAdapter, type WorkspaceInfo } from './types.js';

/**
 * Go — gopls (구현서 12.3).
 *
 * `go install` 로 받은 도구는 `PATH` 가 아니라 `GOBIN` 또는 `GOPATH/bin` 에 있는
 * 경우가 많다. 그 둘을 직접 본다.
 *
 * **자동으로 설치하지 않는다.** 설치 명령은 안내만 한다 — 우리가 사용자 기계에
 * 도구를 내려받아 설치하는 것은 그 자체로 놀랄 일이다.
 */

function goBinCandidates(): string[] {
    const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
    const candidates: string[] = [];

    const goBin = process.env['GOBIN'];
    if (goBin) {
        candidates.push(path.join(goBin, 'gopls'));
    }
    const goPath = process.env['GOPATH'];
    if (goPath) {
        // GOPATH 는 여러 경로일 수 있다.
        for (const entry of goPath.split(path.delimiter)) {
            if (entry !== '') {
                candidates.push(path.join(entry, 'bin', 'gopls'));
            }
        }
    }
    if (home !== '') {
        candidates.push(path.join(home, 'go', 'bin', 'gopls'));
    }
    return candidates;
}

export const goplsAdapter: LspAdapter = {
    id: 'go',
    languageIds: ['go'],
    displayName: 'gopls',

    async detectExecutable(workspace: WorkspaceInfo): Promise<DetectionResult> {
        const configured = settingsFor(workspace, 'go').executable;
        if (configured !== null && configured.trim() !== '') {
            const checked = await checkConfiguredExecutable(configured, 'gopls');
            return checked.ok
                ? { executable: checked.executable, source: 'settings', hint: null }
                : { executable: null, source: 'notFound', hint: checked.hint };
        }

        const onPath = await findOnPath('gopls');
        if (onPath !== null) {
            return { executable: onPath, source: 'path', hint: null };
        }

        const fromGoBin = await firstExecutable(goBinCandidates());
        if (fromGoBin !== null) {
            return {
                executable: fromGoBin,
                source: process.env['GOBIN'] ? 'goBin' : 'goPath',
                hint: null,
            };
        }

        return {
            executable: null,
            source: 'notFound',
            hint: 'gopls 를 찾지 못했다. `go install golang.org/x/tools/gopls@latest` 로 '
                + '설치하거나 설정에 경로를 적는다. (Code Trail 이 대신 설치하지 않는다.)',
        };
    },

    buildCommand(executable: string, workspace: WorkspaceInfo): SpawnCommand {
        const settings = settingsFor(workspace, 'go');
        return {
            command: executable,
            args: [...settings.args],
            env: { ...settings.env },
            cwd: workspace.projectRoot,
        };
    },

    initializationOptions(workspace: WorkspaceInfo): unknown {
        return settingsFor(workspace, 'go').initializationOptions ?? null;
    },

    async healthChecks(
        workspace: WorkspaceInfo,
        detection: DetectionResult,
    ): Promise<HealthCheck[]> {
        const checks: HealthCheck[] = [];

        if (detection.executable === null) {
            checks.push({
                label: 'gopls 실행 파일',
                level: 'error',
                detail: detection.hint ?? '찾지 못했다.',
            });
        } else {
            const version = await runCommand(detection.executable, ['version']);
            checks.push({
                label: 'gopls version',
                level: version.ok ? 'ok' : 'error',
                detail: version.ok ? version.output : `실행하지 못했다: ${version.output}`,
            });
        }

        const go = await findOnPath('go');
        if (go !== null) {
            const goVersion = await runCommand(go, ['version']);
            checks.push({
                label: 'go version',
                level: goVersion.ok ? 'ok' : 'warn',
                detail: goVersion.ok ? goVersion.output : 'go 를 실행하지 못했다.',
            });
        } else {
            checks.push({
                label: 'go 도구 모음',
                level: 'warn',
                detail: 'go 를 PATH 에서 찾지 못했다. gopls 가 표준 라이브러리를 못 읽을 수 있다.',
            });
        }

        const work = path.join(workspace.projectRoot, 'go.work');
        const mod = path.join(workspace.projectRoot, 'go.mod');
        if (await fileExists(work)) {
            checks.push({
                label: 'go.work',
                level: 'ok',
                detail: relativeOrName(workspace.projectRoot, work),
            });
        } else if (await fileExists(mod)) {
            checks.push({
                label: 'go.mod',
                level: 'ok',
                detail: relativeOrName(workspace.projectRoot, mod),
            });
        } else {
            checks.push({
                label: '모듈 표지',
                level: 'warn',
                detail: 'go.work 도 go.mod 도 없다. gopls 가 프로젝트를 못 잡는다.',
            });
        }

        return checks;
    },
};
