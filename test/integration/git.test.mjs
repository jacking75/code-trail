import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { makeProject, removeProject } from './helpers.mjs';

const runFile = promisify(execFile);
const { GitService } = await import('../../packages/server/dist/git/service.js');

async function git(root, ...args) {
    const result = await runFile('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
    return result.stdout;
}

test('Git 변경 목록은 이름 변경의 옛·새 경로와 staged·unstaged 상태를 정확히 나눈다', async () => {
    const original = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n') + '\n';
    const root = await makeProject({
        'src/old name.txt': original,
        'src/delete.txt': 'delete me\n',
    });
    try {
        await git(root, 'init');
        await git(root, 'config', 'user.name', 'Code Trail Test');
        await git(root, 'config', 'user.email', 'test@invalid.local');
        await git(root, 'add', '--', '.');
        await git(root, 'commit', '-m', 'base');
        const base = (await git(root, 'rev-parse', 'HEAD')).trim();
        await git(root, 'config', 'diff.external', 'must-not-run');

        await git(root, 'mv', '--', 'src/old name.txt', 'src/new name;and.txt');
        await appendFile(path.join(root, 'src', 'new name;and.txt'), 'added after rename\n', 'utf8');
        await unlink(path.join(root, 'src', 'delete.txt'));
        await writeFile(path.join(root, 'src', '[draft]&note.txt'), 'untracked\n', 'utf8');

        const before = await git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
        const service = new GitService(root);
        const changes = await service.workingChanges();
        const after = await git(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all');
        assert.equal(after, before, '읽기 시작점 조회가 저장소 상태를 바꾸면 안 된다');

        assert.deepEqual(changes.find((item) => item.area === 'staged' && item.status === 'renamed'), {
            relPath: 'src/new name;and.txt',
            oldRelPath: 'src/old name.txt',
            status: 'renamed',
            area: 'staged',
            addedLines: 0,
            deletedLines: 0,
        });
        assert.equal(changes.some((item) => item.area === 'unstaged' && item.relPath === 'src/new name;and.txt'), true);
        assert.equal(changes.some((item) => item.status === 'deleted' && item.relPath === 'src/delete.txt'), true);
        assert.equal(changes.some((item) => item.status === 'untracked' && item.relPath === 'src/[draft]&note.txt'), true);

        await git(root, 'add', '-A', '--');
        await git(root, 'commit', '-m', 'rename and edit');
        const committed = await service.changesBetween(base);
        const rename = committed.find((item) => item.status === 'renamed');
        assert.equal(rename?.relPath, 'src/new name;and.txt');
        assert.equal(rename?.oldRelPath, 'src/old name.txt');
        assert.equal(rename?.addedLines, 1);
        assert.equal(rename?.deletedLines, 0);
        assert.equal(committed.some((item) => item.status === 'deleted' && item.relPath === 'src/delete.txt'), true);
        assert.equal(committed.some((item) => item.status === 'added' && item.relPath === 'src/[draft]&note.txt'), true);
    } finally {
        await removeProject(root);
    }
});

test('hunk 는 바뀐 줄 덩어리만 주고, 추적되지 않는 파일은 전체가 하나다', async () => {
    // 리뷰의 시작점은 파일이 아니라 hunk 다(U14). 헤더만 읽으므로 본문이 커도
    // 결과 크기가 늘지 않는다.
    const original = Array.from({ length: 20 }, (_, index) => `line ${index}`).join('\n') + '\n';
    const root = await makeProject({ 'src/edit.txt': original });
    try {
        await git(root, 'init');
        await git(root, 'config', 'user.name', 'Code Trail Test');
        await git(root, 'config', 'user.email', 'test@invalid.local');
        await git(root, 'add', '--', '.');
        await git(root, 'commit', '-m', 'base');

        const lines = original.split('\n');
        lines[2] = 'line 2 — 고쳤다';
        lines[11] = 'line 11 — 고쳤다';
        await writeFile(path.join(root, 'src', 'edit.txt'), lines.join('\n'), 'utf8');
        await writeFile(path.join(root, 'src', 'brand new.txt'), 'a\nb\nc\n', 'utf8');

        const service = new GitService(root);
        const edited = await service.hunks('src/edit.txt');
        assert.deepEqual(edited.map((hunk) => hunk.newStart), [3, 12]);
        assert.equal(edited.every((hunk) => hunk.newCount === 1 && hunk.oldCount === 1), true);

        const untracked = await service.hunks('src/brand new.txt');
        assert.equal(untracked.length, 1, '추적되지 않는 파일도 "바뀐 곳" 이다');
        assert.equal(untracked[0].newStart, 1);
        assert.equal(untracked[0].oldCount, 0);
    } finally {
        await removeProject(root);
    }
});

test('원본 조회는 HEAD 와 커밋 해시만 받는다', async () => {
    // `ref` 가 옵션처럼 보이는 값이면 `git show` 가 그것을 옵션으로 읽는다.
    // 셸을 거치지 않아도 인자 해석은 git 이 한다.
    const root = await makeProject({ 'src/a.txt': '처음 내용\n' });
    try {
        await git(root, 'init');
        await git(root, 'config', 'user.name', 'Code Trail Test');
        await git(root, 'config', 'user.email', 'test@invalid.local');
        await git(root, 'add', '--', '.');
        await git(root, 'commit', '-m', 'base');
        await writeFile(path.join(root, 'src', 'a.txt'), '바꾼 내용\n', 'utf8');

        const service = new GitService(root);
        assert.equal((await service.originalText('HEAD', 'src/a.txt')).text, '처음 내용\n');

        await assert.rejects(() => service.originalText('--output=/tmp/x', 'src/a.txt'));
        await assert.rejects(() => service.originalText('-n', 'src/a.txt'));
        await assert.rejects(() => service.originalText('main', 'src/a.txt'));
    } finally {
        await removeProject(root);
    }
});

test('변경 기준을 고르면 브랜치·커밋 목록과 merge-base 범위가 나온다', async () => {
    // 브랜치 전체나 특정 커밋을 리뷰할 시작점이 없으면, 커밋한 뒤에는 변경
    // 목록이 비어 리뷰가 끊긴다(V01).
    const root = await makeProject({ 'src/a.txt': '처음\n' });
    try {
        await git(root, 'init', '-b', 'main');
        await git(root, 'config', 'user.name', 'Code Trail Test');
        await git(root, 'config', 'user.email', 'test@invalid.local');
        await git(root, 'add', '--', '.');
        await git(root, 'commit', '-m', 'base');
        const base = (await git(root, 'rev-parse', 'HEAD')).trim();

        await git(root, 'checkout', '-b', 'feature');
        await writeFile(path.join(root, 'src', 'b.txt'), '새 파일\n', 'utf8');
        await git(root, 'add', '--', '.');
        await git(root, 'commit', '-m', 'feature work');

        const service = new GitService(root);
        const refs = await service.recentRefs();
        assert.equal(refs.currentBranch, 'feature');
        assert.equal(refs.defaultBranch, 'main');
        assert.equal(refs.branches.includes('main'), true);
        assert.equal(refs.commits[0].subject, 'feature work');

        assert.equal(await service.mergeBase('main', 'feature'), base);

        // 커밋한 뒤에도 그 범위가 리뷰 대상으로 남는다.
        const between = await service.changesBetween('main', 'feature');
        assert.deepEqual(between.map((item) => item.relPath), ['src/b.txt']);
        assert.equal(between[0].area, 'commit');
    } finally {
        await removeProject(root);
    }
});

test('기준 커밋만 주면 작업 트리까지 비교한다', async () => {
    // `to` 를 `HEAD` 로 채워 넣으면 커밋한 뒤 고친 줄이 조용히 빠진다(V01).
    const original = Array.from({ length: 6 }, (_, index) => `line ${index}`).join('\n') + '\n';
    const root = await makeProject({ 'src/a.txt': original });
    try {
        await git(root, 'init');
        await git(root, 'config', 'user.name', 'Code Trail Test');
        await git(root, 'config', 'user.email', 'test@invalid.local');
        await git(root, 'add', '--', '.');
        await git(root, 'commit', '-m', 'base');
        const base = (await git(root, 'rev-parse', 'HEAD')).trim();

        const lines = original.split('\n');
        lines[1] = 'line 1 — 커밋한 변경';
        await writeFile(path.join(root, 'src', 'a.txt'), lines.join('\n'), 'utf8');
        await git(root, 'add', '--', '.');
        await git(root, 'commit', '-m', 'committed change');

        lines[4] = 'line 4 — 아직 커밋 안 한 변경';
        await writeFile(path.join(root, 'src', 'a.txt'), lines.join('\n'), 'utf8');

        const service = new GitService(root);
        const sinceBase = await service.hunks('src/a.txt', base);
        assert.deepEqual(sinceBase.map((hunk) => hunk.newStart), [2, 5]);

        // `to` 를 주면 커밋 사이만 본다.
        const committedOnly = await service.hunks('src/a.txt', base, 'HEAD');
        assert.deepEqual(committedOnly.map((hunk) => hunk.newStart), [2]);
    } finally {
        await removeProject(root);
    }
});
