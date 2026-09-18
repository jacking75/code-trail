import { useCallback, useRef, useState } from 'react';

/**
 * 알림 하나 (U02).
 *
 * 화면에 무언가를 알리는 통로는 이것 하나다. 예전에는 `.panel-error`(닫을 수
 * 없고 다음 파일을 열 때까지 남는다) 와 `.toast`(덮어쓴다) 가 따로 있었고,
 * 같은 `command.error` 를 두 곳에서 다르게 다뤘다.
 */
export interface NoticeAction {
    label: string;
    run: () => void;
}

export interface Notice {
    id: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    actions: NoticeAction[];
    /**
     * 사용자가 닫을 때까지 남는다.
     *
     * `error` 는 늘 sticky 다 — 사라진 오류는 없던 일이 되고, 사용자는 방금
     * 무엇이 잘못됐는지 다시 알 방법이 없다.
     */
    sticky: boolean;
    /** 같은 키의 알림은 하나만 남긴다. 연결 끊김처럼 반복되는 것에 쓴다. */
    key?: string;
}

export interface NoticeInput {
    level?: Notice['level'];
    message: string;
    actions?: NoticeAction[];
    sticky?: boolean;
    key?: string;
}

/** 수준별 자동 사라짐 시간. `error` 는 사라지지 않는다. */
const TIMEOUT_MS: Record<Notice['level'], number> = {
    info: 6_000,
    warn: 10_000,
    error: 0,
};

/** 한 번에 쌓아 두는 최대 개수. 넘치면 가장 오래된 것부터 뺀다. */
const MAX_NOTICES = 3;

export interface NoticeApi {
    notices: Notice[];
    push: (input: NoticeInput) => string;
    dismiss: (id: string) => void;
    /** 키로 지운다. 같은 상황이 풀렸을 때(재연결 등) 쓴다. */
    dismissKey: (key: string) => void;
    /** 마우스를 올린 동안 타이머를 멈춘다. 읽는 중에 사라지면 소용이 없다. */
    hold: (held: boolean) => void;
}

export function useNotices(): NoticeApi {
    const [notices, setNotices] = useState<Notice[]>([]);
    const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const held = useRef(false);
    /** 멈춘 동안 만료된 것. 마우스를 치우면 그때 다시 센다. */
    const pending = useRef(new Map<string, number>());

    const clearTimer = useCallback((id: string): void => {
        const timer = timers.current.get(id);
        if (timer !== undefined) {
            clearTimeout(timer);
            timers.current.delete(id);
        }
        pending.current.delete(id);
    }, []);

    const dismiss = useCallback((id: string): void => {
        clearTimer(id);
        setNotices((current) => current.filter((item) => item.id !== id));
    }, [clearTimer]);

    const arm = useCallback((id: string, ms: number): void => {
        if (ms <= 0) {
            return;
        }
        pending.current.set(id, ms);
        if (held.current) {
            return;
        }
        timers.current.set(id, setTimeout(() => dismiss(id), ms));
    }, [dismiss]);

    const push = useCallback((input: NoticeInput): string => {
        const level = input.level ?? 'info';
        const id = crypto.randomUUID();
        const notice: Notice = {
            id,
            level,
            message: input.message,
            actions: input.actions ?? [],
            sticky: input.sticky ?? level === 'error',
            ...(input.key === undefined ? {} : { key: input.key }),
        };
        setNotices((current) => {
            const withoutSameKey = notice.key === undefined
                ? current
                : current.filter((item) => item.key !== notice.key);
            const next = [...withoutSameKey, notice];
            // 넘치는 만큼 앞에서 자른다. 가장 오래된 것이 가장 덜 급하다.
            return next.slice(Math.max(0, next.length - MAX_NOTICES));
        });
        if (!notice.sticky) {
            arm(id, TIMEOUT_MS[level]);
        }
        return id;
    }, [arm]);

    const dismissKey = useCallback((key: string): void => {
        setNotices((current) => {
            for (const item of current) {
                if (item.key === key) {
                    clearTimer(item.id);
                }
            }
            return current.filter((item) => item.key !== key);
        });
    }, [clearTimer]);

    const hold = useCallback((next: boolean): void => {
        held.current = next;
        if (next) {
            for (const [id, timer] of timers.current) {
                clearTimeout(timer);
                timers.current.delete(id);
            }
            return;
        }
        for (const [id, ms] of pending.current) {
            timers.current.set(id, setTimeout(() => dismiss(id), ms));
        }
    }, [dismiss]);

    return { notices, push, dismiss, dismissKey, hold };
}
