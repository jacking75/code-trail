import path from 'node:path';

import type { SpawnCommand } from '../types.js';
import { relativeOrName } from './clangd.js';
import { fileExists, checkConfiguredExecutable, findOnPath, firstExecutable, runCommand } from './detect.js';
import { settingsFor, type DetectionResult, type HealthCheck, type LspAdapter, type WorkspaceInfo } from './types.js';

/**
 * Rust — rust-analyzer (구현서 12.4).
 *
 * rustup proxy 와 따로 설치한 바이너리가 충돌할 수 있다. `PATH` 의
 * `rust-analyzer` 가 rustup proxy 인데 그 toolchain 에는 실제 서버가 없는 경우가
 * 흔하고, 그때 오류 메시지만으로는 무엇을 고쳐야 할지 알 수 없다.
 *
 * 그래서 **실제로 고른 경로를 진단 화면에 항상 표시한다.** 이건 "절대경로를
 * 브라우저로 내보내지 않는다" 규칙의 의도된 예외다 — 감추려는 것은 프로젝트의
 * 파일 구조이지 사용자가 직접 설치한 도구의 위치가 아니고, 이 화면의 존재
 * 이유가 바로 그 구분이다.
 */

function rustupCandidates(): string[] {
    const home = process.env['HOME'] ?? process.env['USERPROFILE'] ?? '';
    const cargoHome = process.env['CARGO_HOME']
        ?? (home !== '' ? path.join(home, '.cargo') : '');
    return cargoHome !== '' ? [path.join(cargoHome, 'bin', 'rust-analyzer')] : [];
}

export const rustAnalyzerAdapter: LspAdapter = {
    id: 'rust',
    languageIds: ['rust'],
    displayName: 'rust-analyzer',

    async detectExecutable(workspace: WorkspaceInfo): Promise<DetectionResult> {
        const configured = settingsFor(workspace, 'rust').executable;
        if (configured !== null && configured.trim() !== '') {
            const checked = await checkConfiguredExecutable(configured, 'rust-analyzer');
            return checked.ok
                ? { executable: checked.executable, source: 'settings', hint: null }
                : { executable: null, source: 'notFound', hint: checked.hint };
        }

        const onPath = await findOnPath('rust-analyzer');
        if (onPath !== null) {
            return { executable: onPath, source: 'path', hint: null };
        }

        const fromRustup = await firstExecutable(rustupCandidates());
        if (fromRustup !== null) {
            return { executable: fromRustup, source: 'rustup', hint: null };
        }

        return {
            executable: null,
            source: 'notFound',
            hint: 'rust-analyzer 를 찾지 못했다. `rustup component add rust-analyzer` 로 '
                + '설치하거나 설정에 경로를 적는다.',
        };
    },

    buildCommand(executable: string, workspace: WorkspaceInfo): SpawnCommand {
        const settings = settingsFor(workspace, 'rust');
        return {
            command: executable,
            args: [...settings.args],
            env: { ...settings.env },
            cwd: workspace.projectRoot,
        };
    },

    initializationOptions(workspace: WorkspaceInfo): unknown {
        return settingsFor(workspace, 'rust').initializationOptions ?? null;
    },

    async healthChecks(
        workspace: WorkspaceInfo,
        detection: DetectionResult,
    ): Promise<HealthCheck[]> {
        const checks: HealthCheck[] = [];

        if (detection.executable === null) {
            checks.push({
                label: 'rust-analyzer 실행 파일',
                level: 'error',
                detail: detection.hint ?? '찾지 못했다.',
            });
        } else {
            // rustup proxy 와 별도 설치를 구분할 수 있게 고른 경로를 그대로 보여준다.
            checks.push({
                label: '고른 rust-analyzer',
                level: 'ok',
                detail: `${detection.executable} (${describeSource(detection.source)})`,
            });
            const version = await runCommand(detection.executable, ['--version']);
            checks.push({
                label: 'rust-analyzer --version',
                level: version.ok ? 'ok' : 'error',
                detail: version.ok
                    ? version.output
                    : `실행하지 못했다: ${version.output} — rustup proxy 가 가리키는 `
                        + 'toolchain 에 rust-analyzer 가 없을 수 있다.',
            });
        }

        for (const [name, args] of [['rustc', ['--version']], ['cargo', ['--version']]] as const) {
            const found = await findOnPath(name);
            if (found === null) {
                checks.push({
                    label: `${name} --version`,
                    level: 'warn',
                    detail: `${name} 을 PATH 에서 찾지 못했다.`,
                });
                continue;
            }
            const result = await runCommand(found, args);
            checks.push({
                label: `${name} --version`,
                level: result.ok ? 'ok' : 'warn',
                detail: result.ok ? result.output : '실행하지 못했다.',
            });
        }

        const cargoToml = path.join(workspace.projectRoot, 'Cargo.toml');
        const rustProject = path.join(workspace.projectRoot, 'rust-project.json');
        if (await fileExists(cargoToml)) {
            checks.push({
                label: 'Cargo.toml',
                level: 'ok',
                detail: relativeOrName(workspace.projectRoot, cargoToml),
            });
        } else if (await fileExists(rustProject)) {
            checks.push({
                label: 'rust-project.json',
                level: 'ok',
                detail: relativeOrName(workspace.projectRoot, rustProject),
            });
        } else {
            checks.push({
                label: '프로젝트 표지',
                level: 'warn',
                detail: 'Cargo.toml 도 rust-project.json 도 없다. rust-analyzer 가 '
                    + '프로젝트를 못 잡는다.',
            });
        }

        // 표준 라이브러리 소스가 없으면 std 안으로 정의를 따라갈 수 없다.
        const rustup = await findOnPath('rustup');
        if (rustup !== null) {
            const components = await runCommand(rustup, ['component', 'list', '--installed']);
            checks.push({
                label: 'rust-src',
                level: components.output.includes('rust-src') ? 'ok' : 'warn',
                detail: components.output.includes('rust-src')
                    ? '설치돼 있다.'
                    : '없다. `rustup component add rust-src` 를 하면 표준 라이브러리 '
                        + '정의까지 따라갈 수 있다.',
            });
        }

        return checks;
    },
};

function describeSource(source: DetectionResult['source']): string {
    switch (source) {
        case 'settings':
            return '설정에 적힌 경로';
        case 'path':
            return 'PATH';
        case 'rustup':
            return 'rustup(CARGO_HOME)';
        case 'platform':
            return '플랫폼 기본 위치';
        default:
            return String(source);
    }
}
