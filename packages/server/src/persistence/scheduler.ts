import type { Logger } from '../config/logger.js';

/**
 * revision 기반 debounce 저장 (구현서 9.5).
 *
 * 사용자 입력을 막지 않는 것이 목적이다. mutation 마다 디스크를 때리는 대신
 * 잠깐 모았다가 한 번 쓴다. 저장하는 도중에 또 바뀌면, 쓰기가 끝난 뒤 최신
 * revision 으로 한 번 더 쓴다 — 마지막 상태가 반드시 파일에 남아야 한다.
 *
 * 값이 아니라 **revision 번호**로 판단한다. "지금 저장한 것이 최신인가" 를
 * 내용 비교 없이 숫자 하나로 알 수 있고, 트레일 도메인이 이미 그 번호를 관리한다.
 */

export interface SaveTask {
    /** 저장 단위 키. 트레일 하나가 키 하나다. */
    key: string;
    /** 지금 저장하려는 상태의 revision. */
    revision: number;
    /** 실제 쓰기. 같은 키에 대해 동시에 두 번 불리지 않는다. */
    write: () => Promise<void>;
}

export interface SaveSchedulerOptions {
    logger: Logger;
    /** 구현서가 정한 300~500ms 범위. */
    delayMs?: number;
    /** 테스트에서 타이머를 갈아끼우기 위한 구멍. */
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}

interface Pending {
    revision: number;
    write: () => Promise<void>;
    timer: unknown;
}

export class SaveScheduler {
    private readonly logger: Logger;
    private readonly delayMs: number;
    private readonly setTimer: (fn: () => void, ms: number) => unknown;
    private readonly clearTimer: (handle: unknown) => void;

    private readonly pending = new Map<string, Pending>();
    private readonly running = new Map<string, Promise<void>>();
    /** 마지막으로 디스크에 쓴 revision. */
    private readonly saved = new Map<string, number>();
    private stopped = false;

    constructor(options: SaveSchedulerOptions) {
        this.logger = options.logger.child('save');
        this.delayMs = options.delayMs ?? 400;
        this.setTimer = options.setTimer
            ?? ((fn, ms) => {
                const handle = setTimeout(fn, ms);
                // 저장 하나 때문에 프로세스가 안 끝나면 안 된다.
                if (typeof handle.unref === 'function') {
                    handle.unref();
                }
                return handle;
            });
        this.clearTimer = options.clearTimer
            ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    }

    /** 저장을 예약한다. 같은 키의 앞선 예약은 최신 것으로 덮인다. */
    schedule(task: SaveTask): void {
        if (this.stopped) {
            return;
        }
        const existing = this.pending.get(task.key);
        if (existing) {
            this.clearTimer(existing.timer);
        }
        const timer = this.setTimer(() => {
            void this.run(task.key);
        }, this.delayMs);
        this.pending.set(task.key, { revision: task.revision, write: task.write, timer });
    }

    /** 예약을 기다리지 않고 지금 전부 쓴다. 종료 절차가 부른다. */
    async flush(): Promise<void> {
        const keys = new Set([...this.pending.keys(), ...this.running.keys()]);
        await Promise.all([...keys].map((key) => this.run(key)));
    }

    /** 더 받지 않고 남은 것만 마저 쓴다. */
    async stop(): Promise<void> {
        this.stopped = true;
        await this.flush();
    }

    /** 이 키가 마지막으로 디스크에 쓴 revision. 테스트와 진단이 쓴다. */
    savedRevision(key: string): number | undefined {
        return this.saved.get(key);
    }

    private async run(key: string): Promise<void> {
        const inFlight = this.running.get(key);
        if (inFlight) {
            // 쓰는 중이다. 끝난 뒤 다시 본다 — 그 사이 들어온 최신 revision 이 남는다.
            await inFlight;
            if (this.pending.has(key)) {
                await this.run(key);
            }
            return;
        }

        const task = this.pending.get(key);
        if (!task) {
            return;
        }
        this.clearTimer(task.timer);
        this.pending.delete(key);

        const promise = (async () => {
            try {
                await task.write();
                this.saved.set(key, task.revision);
            } catch (error) {
                this.logger.error('저장에 실패했다.', {
                    key,
                    revision: task.revision,
                    reason: error instanceof Error ? error.message : String(error),
                });
            }
        })();

        this.running.set(key, promise);
        try {
            await promise;
        } finally {
            this.running.delete(key);
        }

        // 쓰는 동안 또 바뀌었으면 한 번 더 쓴다.
        if (this.pending.has(key)) {
            await this.run(key);
        }
    }
}
