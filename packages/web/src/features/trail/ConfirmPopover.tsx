import { useEffect, useRef, type JSX } from 'react';

/**
 * 인라인 확인 (U03).
 *
 * 되돌릴 수 없는 삭제에만 쓴다. 노드 삭제처럼 리뷰 중 수십 번 일어나는 일에는
 * 붙이지 않는다 — 매번 확인을 띄우면 흐름이 끊기고, 사람은 곧 읽지 않고 누른다.
 * 그쪽은 되돌리기가 맡는다.
 *
 * 첫 포커스는 **취소**다. `Enter` 를 습관적으로 누르는 사람이 확정하지 않게 한다.
 */

export interface ConfirmPopoverProps {
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ConfirmPopover(props: ConfirmPopoverProps): JSX.Element {
    const cancelRef = useRef<HTMLButtonElement | null>(null);
    const { onCancel, onConfirm } = props;

    useEffect(() => {
        cancelRef.current?.focus();
    }, []);

    return (
        <div
            className="confirm-popover"
            role="dialog"
            aria-label="삭제 확인"
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    onCancel();
                } else if (event.key === 'Enter') {
                    event.preventDefault();
                    onConfirm();
                }
            }}
        >
            <p>{props.message}</p>
            <div className="confirm-row">
                <button type="button" ref={cancelRef} onClick={onCancel}>취소</button>
                <button type="button" className="danger" onClick={onConfirm}>
                    {props.confirmLabel}
                </button>
            </div>
        </div>
    );
}
