import { spawn } from 'node:child_process';
import { access, constants, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * 실행 파일 찾기와 버전 확인.
 *
 * 어댑터 넷이 공통으로 쓴다. **셸을 거치지 않는다** — 설정에서 온 문자열이
 * 셸 문법으로 해석되면 프로젝트 설정 파일 하나로 임의 명령이 돈다(구현서 8.1).
 */

/**
 * Windows 에서 셸 없이 띄울 수 있는 확장자.
 *
 * `.cmd` 와 `.bat` 는 **일부러 뺐다.** Node 는 보안 문제(CVE-2024-27980) 때문에
 * `shell: false` 로는 배치 파일을 띄우지 않는다. 우리가 그걸 우회하려면 `cmd /c`
 * 를 거쳐야 하는데, 그 순간 인자가 셸 문법으로 해석되어 "셸을 거치지 않는다"는
 * 규칙(구현서 8.1)이 무너진다. 배치 shim 대신 진짜 실행 파일을 가리키게 안내한다.
 */
const WINDOWS_EXTENSIONS = ['.exe', '.com'];

/** 셸이 있어야만 도는 확장자. 찾더라도 쓰지 않고 이유를 알린다. */
const WINDOWS_SHIM_EXTENSIONS = ['.cmd', '.bat'];

export function executableCandidates(name: string): string[] {
    if (process.platform !== 'win32') {
        return [name];
    }
    const lower = name.toLowerCase();
    // 이미 확장자가 있으면 그대로 쓴다.
    if ([...WINDOWS_EXTENSIONS, ...WINDOWS_SHIM_EXTENSIONS].some((ext) => lower.endsWith(ext))) {
        return [name];
    }
    return WINDOWS_EXTENSIONS.map((ext) => name + ext);
}

export function isWindowsShim(candidate: string): boolean {
    return process.platform === 'win32'
        && WINDOWS_SHIM_EXTENSIONS.some((ext) => candidate.toLowerCase().endsWith(ext));
}

/** 실행 가능한 파일인지. 디렉터리는 아니어야 한다. */
export async function isExecutableFile(candidate: string): Promise<boolean> {
    const info = await stat(candidate).catch(() => undefined);
    if (!info?.isFile()) {
        return false;
    }
    if (process.platform === 'win32') {
        // Windows 에는 실행 비트가 없다. 확장자로 판단한다.
        return WINDOWS_EXTENSIONS.some((ext) => candidate.toLowerCase().endsWith(ext));
    }
    return access(candidate, constants.X_OK).then(() => true).catch(() => false);
}

export type ConfiguredCheck =
    | { ok: true; executable: string }
    | { ok: false; hint: string };

/**
 * 설정에 적힌 경로를 확인한다. 네 어댑터가 똑같이 쓰는 첫 단계다.
 *
 * 왜 못 쓰는지를 구분해서 알린다. "찾지 못했다" 한 줄만 주면 사용자가 오타를
 * 의심할지 배치 shim 을 의심할지 알 수 없다.
 */
export async function checkConfiguredExecutable(
    configured: string,
    displayName: string,
): Promise<ConfiguredCheck> {
    if (isWindowsShim(configured)) {
        return {
            ok: false,
            hint: `설정에 적힌 ${displayName} 경로가 .cmd/.bat 배치 파일이다. `
                + '셸 없이 띄울 수 없으니 같은 폴더의 .exe 를 가리킨다.',
        };
    }
    if (await isExecutableFile(configured)) {
        return { ok: true, executable: configured };
    }
    return {
        ok: false,
        hint: `설정에 적힌 ${displayName} 경로에 실행 파일이 없다.`,
    };
}

/** `PATH` 에서 이름을 찾는다. 없으면 `null`. */
export async function findOnPath(name: string): Promise<string | null> {
    const raw = process.env['PATH'] ?? process.env['Path'] ?? '';
    const dirs = raw.split(path.delimiter).filter((d) => d !== '');
    for (const dir of dirs) {
        for (const candidate of executableCandidates(name)) {
            const full = path.join(dir, candidate);
            if (await isExecutableFile(full)) {
                return full;
            }
        }
    }
    return null;
}

/** 여러 후보 경로를 차례로 본다. 첫 번째로 실행 가능한 것을 준다. */
export async function firstExecutable(candidates: readonly string[]): Promise<string | null> {
    for (const candidate of candidates) {
        if (candidate === '') {
            continue;
        }
        for (const withExt of executableCandidates(candidate)) {
            if (await isExecutableFile(withExt)) {
                return withExt;
            }
        }
    }
    return null;
}

export interface RunResult {
    ok: boolean;
    /** stdout + stderr 의 첫 줄. 버전 문자열은 대개 한 줄이다. */
    output: string;
}

/**
 * 버전 확인처럼 짧게 끝나는 명령을 돌린다.
 *
 * 제한 시간을 둔다. 잘못된 실행 파일을 가리키면 대화형 프롬프트로 멈추는 경우가
 * 있는데, 그러면 진단 화면이 영영 안 뜬다.
 */
export function runCommand(
    command: string,
    args: readonly string[],
    options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
    return new Promise((resolve) => {
        let done = false;
        const finish = (ok: boolean, output: string): void => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            child.kill('SIGKILL');
            resolve({ ok, output: firstLine(output) });
        };

        let child: ReturnType<typeof spawn>;
        try {
            child = spawn(command, [...args], {
                shell: false,
                ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
        } catch (error) {
            resolve({ ok: false, output: error instanceof Error ? error.message : String(error) });
            return;
        }

        const timer = setTimeout(() => finish(false, '응답이 없다.'), options.timeoutMs ?? 5000);
        if (typeof timer.unref === 'function') {
            timer.unref();
        }

        let text = '';
        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            text += chunk;
        });
        child.stderr?.on('data', (chunk: string) => {
            text += chunk;
        });
        child.on('error', (error) => finish(false, error.message));
        child.on('close', (code) => finish(code === 0, text));
    });
}

function firstLine(text: string): string {
    const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
    return line.trim().slice(0, 200);
}

/** 파일이 있는지. 진단에서 프로젝트 표지 파일을 찾을 때 쓴다. */
export async function fileExists(target: string): Promise<boolean> {
    return stat(target).then((info) => info.isFile()).catch(() => false);
}

export async function directoryExists(target: string): Promise<boolean> {
    return stat(target).then((info) => info.isDirectory()).catch(() => false);
}

/**
 * 프로젝트 루트에서 시작해 위로 올라가며 파일을 찾는다.
 *
 * clangd 의 `compile_commands.json` 은 `build/` 같은 하위나 상위에 있을 수 있다.
 * 올라가는 깊이를 제한한다 — 무한정 올라가면 프로젝트 밖 파일을 근거로 삼게 된다.
 */
export async function findUpwards(
    startDir: string,
    fileName: string,
    maxLevels = 3,
): Promise<string | null> {
    let dir = startDir;
    for (let level = 0; level <= maxLevels; level++) {
        const candidate = path.join(dir, fileName);
        if (await fileExists(candidate)) {
            return candidate;
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
    return null;
}

/**
 * 프로젝트 안에서 확장자로 파일을 찾는다.
 *
 * C# 솔루션 후보(`.sln`, `.csproj`)를 찾는 데 쓴다. 깊이와 개수를 제한한다 —
 * 큰 저장소에서 전체를 훑으면 진단 화면이 몇 초씩 멈춘다.
 */
export async function findByExtension(
    root: string,
    extensions: readonly string[],
    options: { maxDepth?: number; maxResults?: number; excludeDirs?: readonly string[] } = {},
): Promise<string[]> {
    const maxDepth = options.maxDepth ?? 3;
    const maxResults = options.maxResults ?? 20;
    const excluded = new Set(options.excludeDirs ?? [
        '.git', 'node_modules', 'bin', 'obj', 'out', 'dist', 'target', '.code-trail',
    ]);

    const found: string[] = [];
    const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > maxDepth || found.length >= maxResults) {
            return;
        }
        const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (found.length >= maxResults) {
                return;
            }
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!excluded.has(entry.name)) {
                    await walk(full, depth + 1);
                }
                continue;
            }
            if (extensions.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
                found.push(full);
            }
        }
    };
    await walk(root, 0);
    // 얕은 것부터. 저장소 루트의 솔루션이 대개 정답이다.
    return found.sort((a, b) => {
        const depthDiff = a.split(path.sep).length - b.split(path.sep).length;
        return depthDiff !== 0 ? depthDiff : a.localeCompare(b);
    });
}
