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
