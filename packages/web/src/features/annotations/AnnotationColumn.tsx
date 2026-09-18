import { useEffect, useRef, type JSX, type ReactNode } from 'react';

/**
 * 기록 열 (U12).
 *
 * 트레일 패널 오른쪽의 접이식 세로 영역. 노드를 보면서 바로 옆에서 기록을 읽고
 * 쓴다 — 분석 기록 탭으로 왕복하면 노드 하나에 기록을 달 때마다 코드를 잃는다.
 *
 * 열림 여부와 폭은 브라우저에 저장한다. 트레일과 함께 저장하지 않는다 —
 * 화면 상태이고, 같은 트레일을 다른 창에서 다르게 보고 싶을 수 있다.
 */

export const ANNOTATION_COLUMN_MIN = 240;
export const ANNOTATION_COLUMN_DEFAULT = 320;

export interface AnnotationColumnProps {
    /** 지금 무엇에 기록하는지. */
    targetLabel: string;
    width: number;
    onWidth: (width: number) => void;
    onClose: () => void;
    /** 작성 칸. `App` 이 만든다 — 대상 결정과 저장은 바깥의 일이다. */
    composer: ReactNode;
    /** 활성 노드에 달린 기록. */
    items: ReactNode;
    itemCount: number;
    onOpenAnalysisPane: () => void;
}

export function AnnotationColumn(props: AnnotationColumnProps): JSX.Element {
    const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
    const { onWidth } = props;

    // 끄는 동안은 포인터를 잡아 둔다. 놓으면 그 폭이 그대로 남는다.
    useEffect(() => () => { dragRef.current = null; }, []);

    return (
        <aside
            className="annotation-column"
            style={{ width: `${Math.max(ANNOTATION_COLUMN_MIN, props.width)}px` }}
            aria-label="기록 열"
        >
            <div
                className="annotation-column-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="기록 열 폭"
                tabIndex={0}
                onPointerDown={(event) => {
                    dragRef.current = {
                        pointerId: event.pointerId,
                        startX: event.clientX,
                        startWidth: props.width,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                    const drag = dragRef.current;
                    if (drag === null) return;
                    // 왼쪽으로 끌면 넓어진다 — 열이 오른쪽에 있다.
                    onWidth(Math.max(
                        ANNOTATION_COLUMN_MIN,
                        Math.min(drag.startWidth + (drag.startX - event.clientX), window.innerWidth * 0.6),
                    ));
                }}
                onPointerUp={(event) => {
                    dragRef.current = null;
                    try {
                        event.currentTarget.releasePointerCapture(event.pointerId);
                    } catch { /* 이미 놓였다. */ }
                }}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        onWidth(Math.min(window.innerWidth * 0.6, props.width + 16));
                    } else if (event.key === 'ArrowRight') {
                        event.preventDefault();
                        onWidth(Math.max(ANNOTATION_COLUMN_MIN, props.width - 16));
                    }
                }}
            />
            <header className="annotation-column-head">
                <strong>기록</strong>
                <span className="muted">{props.targetLabel}</span>
                <button type="button" aria-label="기록 열 닫기" onClick={props.onClose}>×</button>
            </header>

            {props.composer}

            <div className="annotation-column-list">
                {props.itemCount === 0 ? (
                    <p className="muted">이 노드에 달린 기록이 없다.</p>
                ) : props.items}
            </div>

            <button type="button" className="annotation-column-more" onClick={props.onOpenAnalysisPane}>
                이 트레일의 기록 전체 보기 →
            </button>
        </aside>
    );
}
