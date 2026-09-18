import { useEffect, type JSX } from 'react';

import type { Notice } from './useNotices.js';

/**
 * 알림 더미 (U02).
 *
 * 화면 오른쪽 아래에 세로로 쌓는다. 오류는 `role="alert"` 로 즉시 읽히고,
 * 안내는 `role="status"` 로 하던 일을 끊지 않는다.
 */

export interface NoticesProps {
    notices: Notice[];
    onDismiss: (id: string) => void;
    onHold: (held: boolean) => void;
}

export function Notices(props: NoticesProps): JSX.Element | null {
    const { notices, onDismiss } = props;

    // `Esc` 는 가장 최근 것을 닫는다. 입력 중일 때는 그 입력이 먼저다.
    useEffect(() => {
        if (notices.length === 0) {
            return undefined;
        }
        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') {
                return;
            }
            const target = event.target as HTMLElement | null;
            if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
                return;
            }
            const last = notices[notices.length - 1];
            if (last) {
                onDismiss(last.id);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [notices, onDismiss]);

    if (notices.length === 0) {
        return null;
    }

    return (
        <div
            className="notices"
            onMouseEnter={() => props.onHold(true)}
            onMouseLeave={() => props.onHold(false)}
        >
            {notices.map((notice) => (
                <div
                    key={notice.id}
                    className={`notice notice-${notice.level}`}
                    role={notice.level === 'error' ? 'alert' : 'status'}
                >
                    <span className="notice-message">{notice.message}</span>
                    {notice.actions.map((action) => (
                        <button
                            key={action.label}
                            type="button"
                            className="notice-action"
                            onClick={() => {
                                action.run();
                                props.onDismiss(notice.id);
                            }}
                        >
                            {action.label}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="notice-close"
                        aria-label="알림 닫기"
                        onClick={() => props.onDismiss(notice.id)}
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
}
