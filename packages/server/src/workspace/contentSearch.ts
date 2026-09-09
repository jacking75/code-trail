import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { normalizeRelPath, resolveInsideProject, toPosixRelative } from '../security/paths.js';
import type { WorkspaceTree } from './tree.js';

export interface ContentSearchMatch {
    relPath: string;
    line: number;
    char: number;
    preview: string;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5_000;
const MAX_RESULTS = 500;

export async function searchContent(args: {
    tree: WorkspaceTree;
    query: string;
    scope?: string;
    caseSensitive?: boolean;
    signal?: AbortSignal;
}): Promise<{ matches: ContentSearchMatch[]; truncated: boolean; scannedFiles: number }> {
    if (args.query.length < 2 || args.query.length > 1_000) throw new Error('검색어는 2~1,000자여야 한다.');
    const scope = normalizeRelPath(args.scope ?? '');
    const root = await resolveInsideProject(args.tree.projectRoot, scope);
    const rootInfo = await stat(root).catch(() => undefined);
    const exactFile = rootInfo?.isFile() ? root : null;
    const needle = args.caseSensitive ? args.query : args.query.toLocaleLowerCase();
    const matches: ContentSearchMatch[] = [];
    let scannedFiles = 0;
    let truncated = false;
    const stack = [exactFile ? path.dirname(root) : root];
    while (stack.length > 0 && scannedFiles < MAX_FILES && matches.length < MAX_RESULTS) {
        if (args.signal?.aborted) break;
        const current = stack.pop();
        if (!current) break;
        const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (exactFile && full !== exactFile) continue;
            const rel = toPosixRelative(path.relative(args.tree.projectRoot, full));
            if (entry.isDirectory()) {
                if (!args.tree.isExcludedRelPath(rel)) stack.push(full);
                continue;
            }
            if (!entry.isFile()) continue;
            const info = await stat(full).catch(() => undefined);
            if (!info || info.size > MAX_FILE_BYTES) continue;
            const buffer = await readFile(full).catch(() => undefined);
            if (!buffer || buffer.includes(0)) continue;
            const text = buffer.toString('utf8');
            scannedFiles += 1;
            const lines = text.split(/\r?\n/);
            for (let line = 0; line < lines.length; line += 1) {
                const source = lines[line] ?? '';
                const haystack = args.caseSensitive ? source : source.toLocaleLowerCase();
                let from = 0;
                while (matches.length < MAX_RESULTS) {
                    const char = haystack.indexOf(needle, from);
                    if (char < 0) break;
                    matches.push({ relPath: rel, line, char, preview: source.slice(Math.max(0, char - 80), char + args.query.length + 80) });
                    from = char + Math.max(1, needle.length);
                }
                if (matches.length >= MAX_RESULTS) break;
            }
            if (scannedFiles >= MAX_FILES || matches.length >= MAX_RESULTS) break;
        }
    }
    if (stack.length > 0 || scannedFiles >= MAX_FILES || matches.length >= MAX_RESULTS) truncated = true;
    return { matches, truncated, scannedFiles };
}
