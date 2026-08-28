import { connect } from 'node:net';
import path from 'node:path';

import { RUNTIME_DIR, STORE_DIR, isProcessAlive, readLock, type ServerLock } from '@code-trail/server';

/**
 * 같은 프로젝트에 이미 떠 있는 서버 찾기 (구현서 7.2, 5~6단계).
 *
 * 한 프로세스는 프로젝트 하나만 연다. 같은 프로젝트를 두 번 열면 서버를 또
 * 띄우는 대신 이미 있는 것을 알린다 — 두 서버가 같은 `.code-trail/` 에 쓰면
 * 저장이 서로를 덮어쓴다.
 *
 * 판정은 두 단계다. **PID 가 살아 있는가**(재사용된 PID 일 수 있다) 그리고
 * **그 포트가 실제로 받는가**. 둘 다여야 살아 있다고 본다.
 *
 * 잠금 파일에는 토큰이 없으므로(구현서 7.2 9단계) 새 프로세스가 그 서버의
 * 화면을 열어줄 수는 없다. 사용자에게 원래 창을 쓰라고 알리는 것까지가 할 일이다.
 */

export interface ReuseCheck {
    /** 살아 있는 같은 프로젝트 서버. 없으면 `null`. */
    lock: ServerLock | null;
}

function canConnect(port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = connect({ host: '127.0.0.1', port });
        const done = (result: boolean): void => {
            socket.removeAllListeners();
            socket.destroy();
            resolve(result);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}

export async function findLiveServer(
    projectRoot: string,
    timeoutMs = 500,
): Promise<ReuseCheck> {
    const runtimeDir = path.join(projectRoot, STORE_DIR, RUNTIME_DIR);
    const lock = await readLock(runtimeDir);
    if (!lock) {
        return { lock: null };
    }
    if (lock.pid === process.pid) {
        // 우리 자신이다. 잠금 파일을 지우지 않고 죽은 앞선 실행일 수도 있으니
        // 여기서는 살아 있지 않다고 본다.
        return { lock: null };
    }
    if (!isProcessAlive(lock.pid)) {
        return { lock: null };
    }
    if (!(await canConnect(lock.port, timeoutMs))) {
        // PID 는 재사용됐고 포트는 안 열려 있다. 남은 잠금 파일이다.
        return { lock: null };
    }
    return { lock };
}
