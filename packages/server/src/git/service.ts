import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const MAX_OUTPUT = 4 * 1024 * 1024;

/**
 * 바뀐 줄 덩어리 하나.
 *
 * 리뷰의 시작점은 파일이 아니라 hunk 다. 파일 첫 줄로 열면 바뀐 곳을 다시
 * 찾아 내려가야 한다.
 */
export interface GitHunk {
    /** 이전 쪽 시작 줄(1-based). 새로 생긴 줄만 있으면 0 일 수 있다. */
    oldStart: number;
    oldCount: number;
    /** 현재 쪽 시작 줄(1-based). */
    newStart: number;
    newCount: number;
}

/** `git show` 에 넘길 수 있는 기준. `HEAD` 와 커밋 해시만 받는다. */
function assertRef(ref: string): void {
    if (ref !== 'HEAD' && !/^[a-f0-9]{7,64}$/i.test(ref)) {
        throw new Error('Git 기준은 HEAD 또는 커밋 해시만 받는다.');
    }
}

/** `@@ -a,b +c,d @@` 만 읽는다. 본문 줄은 보지 않는다 — 코드가 필요 없다. */
function parseHunkHeaders(raw: string): GitHunk[] {
    const out: GitHunk[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!match) continue;
        out.push({
            oldStart: Number.parseInt(match[1] ?? '0', 10),
            oldCount: match[2] === undefined ? 1 : Number.parseInt(match[2], 10),
            newStart: Number.parseInt(match[3] ?? '0', 10),
            newCount: match[4] === undefined ? 1 : Number.parseInt(match[4], 10),
        });
    }
    return out;
}

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

    /**
     * 이 파일에서 바뀐 줄 덩어리 (U14).
     *
     * `-U0` 로 문맥 없이 받아 헤더만 읽는다. 추적되지 않는 파일은 diff 가 없으므로
     * 파일 전체를 hunk 하나로 본다 — 리뷰하는 쪽에서는 새 파일도 "바뀐 곳" 이다.
     */
    async hunks(relPath: string, from?: string, to?: string): Promise<GitHunk[]> {
        // `to` 가 없으면 기준 커밋 → **작업 트리** 다. `HEAD` 를 채워 넣으면
        // 커밋한 뒤 고친 줄이 사라져 리뷰 중에 조용히 빠진다(V01).
        const range = from === undefined
            ? []
            : to === undefined
                ? [await this.resolveRevision(from)]
                : [await this.resolveRevision(from), await this.resolveRevision(to)];
        const tracked = await this.run(['ls-files', '--error-unmatch', '--', relPath])
            .then(() => true, () => false);
        if (!tracked) {
            const text = await readFile(
                path.join(this.projectRoot, ...relPath.split('/')),
                'utf8',
            ).catch(() => '');
            const lines = text === '' ? 0 : text.split(/\r?\n/).length;
            return [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: lines }];
        }
        const raw = await this.run([
            'diff', '-U0', '--no-ext-diff', '--no-textconv', '--no-color',
            ...range, '--', relPath,
        ]);
        const hunks = parseHunkHeaders(raw);
        if (hunks.length > 0 || range.length > 0) {
            return hunks;
        }
        // 작업 트리에는 차이가 없고 스테이지에만 있는 경우다.
        return parseHunkHeaders(await this.run([
            'diff', '--cached', '-U0', '--no-ext-diff', '--no-textconv', '--no-color',
            '--', relPath,
        ]).catch(() => ''));
    }

    /**
     * 그 기준에서의 원본 본문 (U14 — 변경 보기).
     *
     * 절대경로를 돌려주지 않는다. 바이너리는 거부한다 — 좌우 비교 편집기에
     * 넣을 수 없고, 넣으면 브라우저가 멈춘다.
     */
    async originalText(ref: string, relPath: string): Promise<{ ref: string; text: string }> {
        assertRef(ref);
        const text = await this.run(['show', `${ref}:./${relPath}`]);
        if (text.includes('\0')) {
            throw new Error('바이너리 파일은 비교할 수 없다.');
        }
        return { ref, text };
    }

    /**
     * 두 지점 사이, 또는 한 지점과 작업 트리 사이의 변경 (V01).
     *
     * `toInput` 이 없으면 기준 커밋과 **작업 트리**를 비교한다. 커밋을 만든 뒤에도
     * 리뷰가 이어지려면 이쪽이 기본 동선이다.
     */
    async changesBetween(fromInput: string, toInput?: string): Promise<GitChange[]> {
        const from = await this.resolveRevision(fromInput);
        const to = toInput === undefined ? null : await this.resolveRevision(toInput);
        const range = to === null ? [from] : [from, to];
        const [names, stats] = await Promise.all([
            this.run(['diff', '--no-ext-diff', '--no-textconv', '--name-status', '-z', '-M', ...range, '--']),
            this.numstat(['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '-M', ...range, '--']),
        ]);
        return parseNameStatus(names).map((item) => ({
            ...item,
            area: 'commit' as const,
            addedLines: stats.get(item.relPath)?.added ?? null,
            deletedLines: stats.get(item.relPath)?.deleted ?? null,
        }));
    }

    /** 두 지점이 갈라진 자리. 브랜치 전체를 리뷰할 때의 기준이다. */
    async mergeBase(a: string, b: string): Promise<string> {
        const left = await this.resolveRevision(a);
        const right = await this.resolveRevision(b);
        const found = (await this.run(['merge-base', left, right])).trim();
        if (!/^[a-f0-9]{40,64}$/i.test(found)) {
            throw new Error('공통 조상을 찾지 못했다.');
        }
        return found;
    }

    /**
     * 변경 기준으로 고를 수 있는 것들 (V01).
     *
     * 브랜치와 최근 커밋만 준다. 이름은 화면에 그대로 보이므로 사람이 읽는 값이고,
     * 실제 git 인자로 쓰기 전에는 `resolveRevision` 을 다시 지난다.
     */
    async recentRefs(): Promise<GitRefs> {
        const currentBranch = (await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])
            .then((value) => value.trim(), () => '')) || null;
        const rawBranches = await this.run([
            'for-each-ref', '--sort=-committerdate', '--count=30',
            '--format=%(refname:short)', 'refs/heads', 'refs/remotes',
        ]).catch(() => '');
        const branches = rawBranches.split(/\r?\n/).map((line) => line.trim())
            .filter((line) => line !== '' && !line.endsWith('/HEAD'));
        const rawCommits = await this.run(['log', '-n', '20', '--format=%H%x00%s']).catch(() => '');
        const commits = rawCommits.split(/\r?\n/).flatMap((line) => {
            const [hash, subject] = line.split('\0');
            if (!hash || !/^[a-f0-9]{40,64}$/i.test(hash)) return [];
            return [{ hash, shortHash: hash.slice(0, 8), subject: subject ?? '' }];
        });
        // 기본 브랜치 추측. `origin/HEAD` 가 있으면 그것이 정답이고, 없으면
        // 흔한 이름을 찾는다. 못 찾아도 나머지 목록은 그대로 쓸 수 있다.
        const originHead = await this.run(['rev-parse', '--abbrev-ref', 'origin/HEAD'])
            .then((value) => value.trim(), () => '');
        const defaultBranch = originHead !== '' && branches.includes(originHead)
            ? originHead
            : ['main', 'master', 'origin/main', 'origin/master']
                .find((name) => branches.includes(name)) ?? null;
        return { currentBranch, defaultBranch, branches, commits };
    }
}

export interface GitRefs {
    /** 지금 체크아웃된 브랜치 이름. 분리 HEAD 면 `HEAD` 가 온다. */
    currentBranch: string | null;
    /** 추천 기준. `현재 브랜치 ← 기본 브랜치` 를 만들 때 쓴다. */
    defaultBranch: string | null;
    branches: string[];
    commits: Array<{ hash: string; shortHash: string; subject: string }>;
}
