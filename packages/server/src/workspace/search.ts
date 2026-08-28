import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { toPosixRelative } from '../security/paths.js';
import { languageIdFor } from './languages.js';
import type { WorkspaceEntry, WorkspaceTree } from './tree.js';

/**
 * 파일 이름 검색 (구현서 10.1).
 *
 * 서버에서 훑고 결과에는 상대경로와 파일 ID 만 담는다. 절대경로는 나가지 않는다.
 * 내용 검색이 아니라 **이름 검색**이다 — 코드 본문 grep 은 비목표다(구현서 3.2).
 */

export const MAX_SEARCH_RESULTS = 200;
/** 훑을 최대 디렉터리 수. 큰 저장소에서 한 번의 검색이 끝없이 도는 것을 막는다. */
const MAX_VISITED_DIRECTORIES = 5000;

export interface SearchResult {
    query: string;
    truncated: boolean;
    entries: WorkspaceEntry[];
}

/**
 * 이름에 질의가 순서대로 들어 있으면 맞다고 본다 (`fzf` 식 부분 일치).
 * 점수를 매기지 않는다 — 정렬은 "경로가 짧은 것 먼저" 하나로 충분하다.
 */
function matches(name: string, needle: string): boolean {
    if (needle === '') {
        return true;
    }
    let i = 0;
    for (const ch of name) {
        if (ch === needle[i]) {
            i += 1;
            if (i === needle.length) {
                return true;
            }
        }
    }
    return false;
}

export async function searchFiles(tree: WorkspaceTree, rawQuery: string): Promise<SearchResult> {
    const query = rawQuery.trim();
    if (query === '') {
        return { query, truncated: false, entries: [] };
    }
    const needle = query.toLowerCase();

    const found: WorkspaceEntry[] = [];
    const queue: string[] = [''];
    let visited = 0;
    let truncated = false;

    while (queue.length > 0) {
        const relDir = queue.shift() as string;
        visited += 1;
        if (visited > MAX_VISITED_DIRECTORIES) {
            truncated = true;
            break;
        }

        const absolute = relDir === ''
            ? tree.projectRoot
            : path.join(tree.projectRoot, ...relDir.split('/'));
        const entries = await readdir(absolute, { withFileTypes: true }).catch(() => []);

        for (const entry of entries) {
            const childRel = relDir === '' ? entry.name : `${relDir}/${entry.name}`;
            if (entry.isDirectory()) {
                if (tree.isExcludedDirName(entry.name) || tree.isExcludedRelPath(childRel)) {
                    continue;
                }
                queue.push(childRel);
                continue;
            }
            // 심볼릭 링크는 따라가지 않는다. 순환과 경계 탈출을 한꺼번에 피한다.
            if (!entry.isFile()) {
                continue;
            }
            if (!matches(entry.name.toLowerCase(), needle)) {
                continue;
            }
            if (found.length >= MAX_SEARCH_RESULTS) {
                truncated = true;
                continue;
            }
            found.push({
                id: toPosixRelative(childRel),
                name: entry.name,
                kind: 'file',
                languageId: languageIdFor(entry.name),
            });
        }
    }

    found.sort((a, b) => {
        const byDepth = a.id.split('/').length - b.id.split('/').length;
        if (byDepth !== 0) {
            return byDepth;
        }
        return a.id.localeCompare(b.id, 'en');
    });

    return { query, truncated, entries: found };
}
