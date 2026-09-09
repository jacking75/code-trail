import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const MAX_OUTPUT = 4 * 1024 * 1024;

export interface GitChange {
    relPath: string;
    oldRelPath: string | null;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
    area: 'staged' | 'unstaged' | 'untracked' | 'commit';
    addedLines: number | null;
    deletedLines: number | null;
}

const statusName = (letter: string): GitChange['status'] => {
    if (letter === 'A') return 'added';
    if (letter === 'D') return 'deleted';
    if (letter === 'R' || letter === 'C') return 'renamed';
    if (letter === '?') return 'untracked';
    return 'modified';
};

const cleanPath = (value: string): string => value.replace(/\\/g, '/');

interface NameStatus {
    relPath: string;
    oldRelPath: string | null;
    status: GitChange['status'];
}

/** `git diff --name-status -z`의 일반 경로와 rename/copy 두 경로 형식을 함께 읽는다. */
function parseNameStatus(raw: string): NameStatus[] {
    const fields = raw.split('\0');
    const result: NameStatus[] = [];
    for (let index = 0; index < fields.length;) {
        const field = fields[index++] ?? '';
        if (!field) continue;
        const tab = field.indexOf('\t');
        const code = (tab >= 0 ? field.slice(0, tab) : field).trim();
        let firstPath = tab >= 0 ? field.slice(tab + 1) : '';
        if (!firstPath) firstPath = fields[index++] ?? '';
        if (!code || !firstPath) continue;
        const renamed = code[0] === 'R' || code[0] === 'C';
        const secondPath = renamed ? (fields[index++] ?? '') : '';
        result.push({
            relPath: cleanPath(renamed ? secondPath : firstPath),
            oldRelPath: renamed ? cleanPath(firstPath) : null,
            status: statusName(code[0] ?? 'M'),
        });
    }
    return result;
}

export class GitService {
    constructor(private readonly projectRoot: string) {}

    private async run(args: string[]): Promise<string> {
        const result = await runFile('git', [
            '-c', 'core.quotepath=false',
            '-c', 'diff.external=',
            '-c', 'diff.trustExitCode=false',
            ...args,
        ], {
            cwd: this.projectRoot,
            encoding: 'utf8',
            windowsHide: true,
            maxBuffer: MAX_OUTPUT,
            shell: false,
            env: { ...process.env, GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat' },
        });
        return result.stdout;
    }

    async isRepository(): Promise<boolean> {
        return this.run(['rev-parse', '--is-inside-work-tree'])
            .then((value) => value.trim() === 'true', () => false);
    }

    async head(): Promise<string | null> {
        return this.run(['rev-parse', '--verify', 'HEAD^{commit}'])
            .then((value) => value.trim(), () => null);
    }

    async resolveRevision(input: string): Promise<string> {
        if (!/^[A-Za-z0-9._~^{}\/-]{1,200}$/.test(input) || input.startsWith('-')) {
            throw new Error('Git 기준 형식이 올바르지 않다.');
        }
        const resolved = (await this.run(['rev-parse', '--verify', `${input}^{commit}`])).trim();
        if (!/^[a-f0-9]{40,64}$/i.test(resolved)) throw new Error('Git 커밋을 확인하지 못했다.');
        return resolved;
    }

    async workingChanges(): Promise<GitChange[]> {
        const raw = await this.run(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
        const fields = raw.split('\0');
        const result: GitChange[] = [];
        for (let index = 0; index < fields.length; index += 1) {
            const entry = fields[index];
            if (!entry || entry.length < 4) continue;
            const x = entry[0] ?? ' ';
            const y = entry[1] ?? ' ';
            const relPath = entry.slice(3).replace(/\\/g, '/');
            let oldRelPath: string | null = null;
            if (x === 'R' || y === 'R') {
                index += 1;
                oldRelPath = cleanPath(fields[index] ?? '');
            }
            if (x === '?' && y === '?') {
                result.push({ relPath, oldRelPath: null, status: 'untracked', area: 'untracked', addedLines: null, deletedLines: null });
                continue;
            }
            if (x !== ' ') result.push({ relPath, oldRelPath, status: statusName(x), area: 'staged', addedLines: null, deletedLines: null });
            if (y !== ' ') result.push({ relPath, oldRelPath, status: statusName(y), area: 'unstaged', addedLines: null, deletedLines: null });
        }
        const [unstagedStats, stagedStats] = await Promise.all([
            this.numstat(['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '--']),
            this.numstat(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '--']),
        ]);
        for (const change of result) {
            const stats = change.area === 'staged' ? stagedStats.get(change.relPath)
                : change.area === 'unstaged' ? unstagedStats.get(change.relPath) : undefined;
            if (stats) {
                change.addedLines = stats.added;
                change.deletedLines = stats.deleted;
            }
        }
        return result.slice(0, 10_000);
    }

    private async numstat(args: string[]): Promise<Map<string, { added: number | null; deleted: number | null }>> {
        const raw = await this.run(args).catch(() => '');
        const result = new Map<string, { added: number | null; deleted: number | null }>();
        const parts = raw.split('\0');
        for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index] ?? '';
            if (!part) continue;
            const [added, deleted, ...pathParts] = part.split('\t');
            let relPath = pathParts.join('\t');
            if (!relPath) {
                // rename/copy는 `수치\t\t\0옛경로\0새경로\0` 형식이다.
                index += 1;
                index += 1;
                relPath = parts[index] ?? '';
            }
            relPath = cleanPath(relPath);
            if (!relPath) continue;
            result.set(relPath, {
                added: added === '-' ? null : Number.parseInt(added ?? '0', 10),
                deleted: deleted === '-' ? null : Number.parseInt(deleted ?? '0', 10),
            });
        }
        return result;
    }

    async changesBetween(fromInput: string, toInput = 'HEAD'): Promise<GitChange[]> {
        const from = await this.resolveRevision(fromInput);
        const to = await this.resolveRevision(toInput);
        const [names, stats] = await Promise.all([
            this.run(['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', from, to, '--']),
            this.numstat(['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '-M', from, to, '--']),
        ]);
        return parseNameStatus(names).map((item) => ({
            ...item,
            area: 'commit' as const,
            addedLines: stats.get(item.relPath)?.added ?? null,
            deletedLines: stats.get(item.relPath)?.deleted ?? null,
        }));
    }
}
