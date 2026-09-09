import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { makeProject, removeProject } from './helpers.mjs';

const { searchContent } = await import('../../packages/server/dist/workspace/contentSearch.js');
const { WorkspaceTree } = await import('../../packages/server/dist/workspace/tree.js');

test('내용 검색은 범위·제외·바이너리·크기·결과 상한과 취소를 지킨다', async () => {
    const root = await makeProject({
        'src/a.ts': 'Needle first\nneedle second\n',
        'src/scoped.ts': 'Needle scoped\n',
        'node_modules/secret.txt': 'Needle excluded\n',
    });
    try {
        await writeFile(path.join(root, 'src', 'binary.bin'), Buffer.from([0, 78, 101, 101, 100, 108, 101]));
        await writeFile(path.join(root, 'src', 'large.txt'), `Needle${'x'.repeat(2 * 1024 * 1024)}`, 'utf8');
        await mkdir(path.join(root, 'generated'), { recursive: true });
        await writeFile(path.join(root, 'generated', 'many.txt'), `${'Needle\n'.repeat(501)}`, 'utf8');
        const tree = new WorkspaceTree({ projectRoot: root });

        const insensitive = await searchContent({ tree, query: 'needle', scope: 'src' });
        assert.deepEqual(insensitive.matches.map((item) => `${item.relPath}:${item.line}:${item.char}`).sort(), [
            'src/a.ts:0:0', 'src/a.ts:1:0', 'src/scoped.ts:0:0',
        ]);
        assert.equal(insensitive.matches.some((item) => /binary|large|node_modules/.test(item.relPath)), false);

        const sensitive = await searchContent({ tree, query: 'Needle', scope: 'src/a.ts', caseSensitive: true });
        assert.deepEqual(sensitive.matches.map((item) => item.line), [0]);

        const limited = await searchContent({ tree, query: 'Needle', scope: 'generated' });
        assert.equal(limited.matches.length, 500);
        assert.equal(limited.truncated, true);

        const controller = new AbortController();
        controller.abort();
        const cancelled = await searchContent({ tree, query: 'Needle', signal: controller.signal });
        assert.deepEqual(cancelled, { matches: [], truncated: true, scannedFiles: 0 });
    } finally {
        await removeProject(root);
    }
});
