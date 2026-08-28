import { realpath } from 'node:fs/promises';
import path from 'node:path';

/**
 * 경로 경계 검사.
 *
 * 브라우저는 신뢰 경계 밖이다. 클라이언트가 보낸 문자열이 파일 경로로 쓰이는
 * 지점은 전부 여기를 지나야 한다. 규칙은 셋이다.
 *
 * 1. 절대경로와 `..` 를 받지 않는다.
 * 2. 정규화한 뒤에도 프로젝트 루트 아래인지 다시 본다.
 * 3. 심볼릭 링크는 매 요청마다 실제 경로를 확인한다(구현서 8.2).
 *
 * 2번과 3번을 둘 다 하는 이유는 순서가 다르기 때문이다. 2번은 문자열을 보고,
 * 3번은 파일 시스템에 실제로 물어본다. 링크는 문자열만으로는 보이지 않는다.
 */

export type PathDenyReason =
    | 'absolute'
    | 'traversal'
    | 'outsideProject'
    | 'notFound'
    | 'empty';

export class PathDeniedError extends Error {
    constructor(readonly reason: PathDenyReason) {
        super('허용되지 않은 경로다.');
        this.name = 'PathDeniedError';
    }
}

/** 저장·전송에 쓰는 표준형: OS 와 무관하게 `/` 로 나눈 상대경로. */
export function toPosixRelative(value: string): string {
    return value.split(path.sep).join('/');
}

/**
 * 클라이언트가 보낸 상대경로를 검사한다. 파일 시스템은 건드리지 않는다.
 *
 * 통과하면 정규화된 `/` 구분 상대경로를 준다. 루트 자신은 빈 문자열이다.
 */
export function normalizeRelPath(raw: string): string {
    if (typeof raw !== 'string') {
        throw new PathDeniedError('empty');
    }
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '.' || trimmed === './') {
        return '';
    }
    // 백슬래시도 구분자로 본다. Windows 클라이언트가 섞어 보내도 같은 판정을 해야 한다.
    const unified = trimmed.replace(/\\/g, '/');

    if (path.isAbsolute(unified) || /^[a-zA-Z]:/.test(unified) || unified.startsWith('/')) {
        throw new PathDeniedError('absolute');
    }
    // UNC 경로(\\server\share)는 위에서 `//server/share` 가 되어 걸린다.

    const segments = unified.split('/').filter((s) => s !== '' && s !== '.');
    for (const segment of segments) {
        if (segment === '..') {
            throw new PathDeniedError('traversal');
        }
        // NUL 은 파일 시스템 호출에서 경로를 잘라버린다.
        if (segment.includes('\0')) {
            throw new PathDeniedError('traversal');
        }
    }
    return segments.join('/');
}

/** `child` 가 `root` 이거나 그 아래인지. 둘 다 이미 정규화된 절대경로여야 한다. */
export function isInside(root: string, child: string): boolean {
    const rel = path.relative(root, child);
    if (rel === '') {
        return true;
    }
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * 상대경로를 실제 절대경로로 바꾼다.
 *
 * 문자열 검사를 통과했더라도 심볼릭 링크가 프로젝트 밖을 가리킬 수 있다.
 * 실제 경로를 확인해 다시 한 번 경계 안인지 본다.
 */
export async function resolveInsideProject(
    projectRoot: string,
    relPath: string,
): Promise<string> {
    const normalized = normalizeRelPath(relPath);
    const candidate = path.resolve(projectRoot, normalized);

    // 문자열 단계 확인. 링크가 없어도 여기서 대부분 걸린다.
    if (!isInside(projectRoot, candidate)) {
        throw new PathDeniedError('outsideProject');
    }

    let real: string;
    try {
        real = await realpath(candidate);
    } catch {
        throw new PathDeniedError('notFound');
    }
    if (!isInside(projectRoot, real)) {
        throw new PathDeniedError('outsideProject');
    }
    return real;
}

/**
 * 프로젝트 루트를 고정한다.
 *
 * 시작할 때 한 번만 부른다. 이후의 모든 경계 판정이 이 값을 기준으로 하므로,
 * 여기서 심볼릭 링크를 미리 풀어두지 않으면 링크로 열었을 때 프로젝트 안의
 * 파일이 전부 "밖" 으로 판정된다.
 */
export async function resolveProjectRoot(input: string): Promise<string> {
    const absolute = path.resolve(input);
    return realpath(absolute);
}
