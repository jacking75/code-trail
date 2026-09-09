import path from 'node:path';

import type { SpawnCommand } from '../types.js';
import {
    checkConfiguredExecutable,
    fileExists,
    findOnPath,
    runCommand,
} from './detect.js';
import { settingsFor, type DetectionResult, type HealthCheck, type LspAdapter, type WorkspaceInfo } from './types.js';

/** npm의 Windows `.cmd` shim을 거치지 않고 Node로 직접 띄울 수 있는 CLI 진입점이다. */
function globalCliCandidates(): string[] {
    const candidates: string[] = [];
    const appData = process.env['APPDATA'];
    if (appData) candidates.push(path.join(appData, 'npm', 'node_modules', 'typescript-language-server', 'lib', 'cli.mjs'));
    candidates.push(
        '/usr/local/lib/node_modules/typescript-language-server/lib/cli.mjs',
        '/opt/homebrew/lib/node_modules/typescript-language-server/lib/cli.mjs',
        '/usr/lib/node_modules/typescript-language-server/lib/cli.mjs',
    );
    return candidates;
}

function isNodeEntry(value: string): boolean {
    return /\.(?:mjs|cjs|js)$/i.test(value);
}

async function findNodeEntry(candidates: readonly string[]): Promise<string | null> {
    for (const candidate of candidates) if (await fileExists(candidate)) return candidate;
    return null;
}

function commandFor(executable: string, args: readonly string[], cwd: string, env: Record<string, string>): SpawnCommand {
    return isNodeEntry(executable)
        ? { command: process.execPath, args: [executable, '--stdio', ...args], env, cwd }
        : { command: executable, args: ['--stdio', ...args], env, cwd };
}

/** TypeScript/JavaScript — typescript-language-server. 언어별 예외는 이 파일에만 둔다. */
export const typescriptAdapter: LspAdapter = {
    id: 'typescript',
    languageIds: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    displayName: 'typescript-language-server',

    async detectExecutable(workspace: WorkspaceInfo): Promise<DetectionResult> {
        const configured = settingsFor(workspace, 'typescript').executable;
        if (configured !== null && configured.trim() !== '') {
            if (isNodeEntry(configured) && await fileExists(configured)) {
                return { executable: configured, source: 'settings', hint: null };
            }
            const checked = await checkConfiguredExecutable(configured, 'typescript-language-server');
            return checked.ok
                ? { executable: checked.executable, source: 'settings', hint: null }
                : { executable: null, source: 'notFound', hint: checked.hint };
        }

        const onPath = await findOnPath('typescript-language-server');
        if (onPath) return { executable: onPath, source: 'path', hint: null };
        const nodeEntry = await findNodeEntry(globalCliCandidates());
        if (nodeEntry) return { executable: nodeEntry, source: 'platform', hint: null };
        return {
            executable: null,
            source: 'notFound',
            hint: 'typescript-language-server 를 찾지 못했다. `npm install -g typescript-language-server typescript`로 설치한다. '
                + 'Windows에서는 .cmd shim 대신 전역 패키지의 lib/cli.mjs를 Node로 직접 실행한다.',
        };
    },

    buildCommand(executable: string, workspace: WorkspaceInfo): SpawnCommand {
        const settings = settingsFor(workspace, 'typescript');
        return commandFor(executable, settings.args, workspace.projectRoot, { ...settings.env });
    },

    initializationOptions(workspace: WorkspaceInfo): unknown {
        return settingsFor(workspace, 'typescript').initializationOptions ?? null;
    },

    async healthChecks(workspace: WorkspaceInfo, detection: DetectionResult): Promise<HealthCheck[]> {
        const checks: HealthCheck[] = [];
        if (!detection.executable) {
            checks.push({ label: 'typescript-language-server 실행 파일', level: 'error', detail: detection.hint ?? '찾지 못했다.' });
        } else {
            const version = isNodeEntry(detection.executable)
                ? await runCommand(process.execPath, [detection.executable, '--version'])
                : await runCommand(detection.executable, ['--version']);
            checks.push({
                label: 'typescript-language-server --version',
                level: version.ok ? 'ok' : 'error',
                detail: version.ok ? version.output : `실행하지 못했다: ${version.output}`,
            });
        }
        const packageJson = await fileExists(path.join(workspace.projectRoot, 'package.json'));
        const tsconfig = await fileExists(path.join(workspace.projectRoot, 'tsconfig.json'));
        checks.push({
            label: 'TypeScript 프로젝트 표지',
            level: packageJson || tsconfig ? 'ok' : 'warn',
            detail: tsconfig ? 'tsconfig.json' : packageJson ? 'package.json' : 'tsconfig.json 과 package.json 이 없다.',
        });
        return checks;
    },
};
