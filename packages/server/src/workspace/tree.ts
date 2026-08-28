import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { PathDeniedError, isInside, normalizeRelPath, resolveInsideProject } from '../security/paths.js';
import { languageIdFor } from './languages.js';

/**
 * 파일 탐색기 (구현서 10.1).
 *
 * 전체를 미리 훑지 않는다. 펼칠 때 그 디렉터리 한 단계만 읽는다 — 큰 저장소에서
 * 시작이 몇 초씩 걸리는 것을 막고, 읽지 않은 파일에 대해서는 권한도 발급하지 않는다.
 */

export interface WorkspaceEntry {
    /** 프로젝트 루트 기준 `/` 구분 상대경로. 루트 자신은 빈 문자열. */
    id: string;
    name: string;
    kind: 'file' | 'directory';
    hasChildren?: boolean;
    languageId?: string | null;
}

/**
 * 기본 제외 디렉터리.
 *
 * 설정에서 **추가**할 수는 있어도 보안 허용 범위를 넓히지는 못한다(구현서 10.1).
 * 즉 이 목록은 "안 보여줄 것" 이지 "못 읽을 것" 의 정의가 아니다. 경계는
 * `security/paths.ts` 가 정한다.
 */
export const DEFAULT_EXCLUDED_DIRS: readonly string[] = [
    '.git',
    'node_modules',
    'out',
    'dist',
    'target',
    'bin',
    'obj',
];

/** 한 디렉터리에서 돌려줄 최대 항목 수. 넘으면 잘리고 검색을 쓰라고 알린다. */
export const MAX_ENTRIES_PER_DIRECTORY = 500;

export interface WorkspaceTreeOptions {
    projectRoot: string;
    /** 기본 목록에 더할 제외 디렉터리 이름. */
    extraExcludes?: readonly string[];
}

export class WorkspaceTree {
    private readonly excluded: Set<string>;

    constructor(private readonly options: WorkspaceTreeOptions) {
        this.excluded = new Set([...DEFAULT_EXCLUDED_DIRS, ...(options.extraExcludes ?? [])]);
    }

    get projectRoot(): string {
        return this.options.projectRoot;
    }

    /** 디렉터리 이름이 제외 대상인지. `.code-trail/runtime` 은 경로로 따로 본다. */
    isExcludedDirName(name: string): boolean {
        return this.excluded.has(name);
    }

    isExcludedRelPath(relPath: string): boolean {
        if (relPath === '') {
            return false;
        }
        // `.code-trail/runtime` 만 감춘다. settings·trails 는 사용자가 볼 수 있어야 한다.
        if (relPath === '.code-trail/runtime' || relPath.startsWith('.code-trail/runtime/')) {
            return true;
        }
        return relPath.split('/').some((segment) => this.excluded.has(segment));
    }

    /**
     * 한 디렉터리의 하위 항목. 디렉터리 먼저, 그다음 파일, 각각 이름순이다.
     *
     * 순서를 고정하는 이유는 화면이 흔들리지 않게 하기 위해서다. `readdir` 의
     * 순서는 파일 시스템마다 다르다.
     */
    async children(relPath: string): Promise<{ entries: WorkspaceEntry[]; truncated: boolean }> {
        const normalized = normalizeRelPath(relPath);
        if (this.isExcludedRelPath(normalized)) {
            throw new PathDeniedError('outsideProject');
        }
        const dir = await resolveInsideProject(this.projectRoot, normalized);

        const raw = await readdir(dir, { withFileTypes: true }).catch(() => {
            throw new PathDeniedError('notFound');
        });

        const directories: WorkspaceEntry[] = [];
        const files: WorkspaceEntry[] = [];

        for (const entry of raw) {
            const childRel = normalized === '' ? entry.name : `${normalized}/${entry.name}`;

            // 심볼릭 링크는 가리키는 곳이 프로젝트 안일 때만 보여준다.
            let isDirectory = entry.isDirectory();
            if (entry.isSymbolicLink()) {
                const target = await resolveInsideProject(this.projectRoot, childRel).catch(
                    () => undefined,
                );
                if (!target) {
                    continue;
                }
                isDirectory = await isDirectoryPath(target);
            }

            if (isDirectory) {
                if (this.excluded.has(entry.name) || this.isExcludedRelPath(childRel)) {
                    continue;
                }
                directories.push({
                    id: childRel,
                    name: entry.name,
                    kind: 'directory',
                    hasChildren: true,
                });
            } else if (entry.isFile() || entry.isSymbolicLink()) {
                files.push({
                    id: childRel,
                    name: entry.name,
                    kind: 'file',
                    languageId: languageIdFor(entry.name),
                });
            }
        }

        const byName = (a: WorkspaceEntry, b: WorkspaceEntry): number =>
            a.name.localeCompare(b.name, 'en');
        directories.sort(byName);
        files.sort(byName);

        const all = [...directories, ...files];
        return {
            entries: all.slice(0, MAX_ENTRIES_PER_DIRECTORY),
            truncated: all.length > MAX_ENTRIES_PER_DIRECTORY,
        };
    }
}

async function isDirectoryPath(absolute: string): Promise<boolean> {
    const info = await stat(absolute).catch(() => undefined);
    return info?.isDirectory() ?? false;
}

/** 경로가 프로젝트 안인지 문자열로만 확인한다. 트리 밖에서도 쓴다. */
export function isInsideProject(projectRoot: string, absolute: string): boolean {
    return isInside(projectRoot, path.resolve(absolute));
}
