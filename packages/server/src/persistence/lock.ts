import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { writeFileAtomic } from './atomic.js';

/**
 * 런타임 잠금 파일 `.code-trail/runtime/server.json` (구현서 7.2).
 *
 * 같은 프로젝트를 두 번 열었을 때 서버를 또 띄우는 대신 이미 떠 있는 것을 쓰기
 * 위한 표시다. 담는 것은 PID, 포트, 시작 시간뿐이다 — **세션 토큰은 넣지 않는다.**
 * 이 파일은 같은 기계의 다른 프로그램이 읽을 수 있고, 토큰이 새면 그 프로그램이
 * 우리 API 를 그대로 부를 수 있다.
 *
 * 토큰이 없으므로 재사용은 "브라우저를 그 주소로 다시 연다" 까지다. 새 탭은
 * 토큰이 없어 부팅에 실패하고, 사용자는 원래 창을 쓰거나 서버를 다시 띄우면 된다.
 */

export const LOCK_FILE = 'server.json';

export interface ServerLock {
    schemaVersion: 1;
    pid: number;
    port: number;
    startedAt: string;
}

export function lockPathFor(runtimeDir: string): string {
    return path.join(runtimeDir, LOCK_FILE);
}

export async function writeLock(runtimeDir: string, lock: ServerLock): Promise<void> {
    await writeFileAtomic(lockPathFor(runtimeDir), `${JSON.stringify(lock, null, 2)}\n`);
}

export async function removeLock(runtimeDir: string): Promise<void> {
    await unlink(lockPathFor(runtimeDir)).catch(() => undefined);
}

export async function readLock(runtimeDir: string): Promise<ServerLock | undefined> {
    let raw: unknown;
    try {
        raw = JSON.parse(await readFile(lockPathFor(runtimeDir), 'utf8'));
    } catch {
        return undefined;
    }
    const lock = raw as Partial<ServerLock>;
    if (
        typeof lock.pid !== 'number'
        || typeof lock.port !== 'number'
        || typeof lock.startedAt !== 'string'
    ) {
        return undefined;
    }
    return { schemaVersion: 1, pid: lock.pid, port: lock.port, startedAt: lock.startedAt };
}

/**
 * 잠금 파일이 가리키는 프로세스가 아직 사는지.
 *
 * `kill(pid, 0)` 은 신호를 보내지 않고 존재만 확인한다. PID 는 재사용되므로
 * "살아 있다" 가 "우리 서버다" 를 뜻하지는 않는다. 그래서 부르는 쪽에서
 * `/api/health` 로 한 번 더 확인한다.
 */
export function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM 이면 남의 프로세스지만 살아는 있다.
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}
