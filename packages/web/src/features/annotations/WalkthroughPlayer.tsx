import { useEffect, type JSX } from 'react';

/**
 * 안내 순서 재생 (V13).
 *
 * 안내 순서는 "설명하기 좋은 순서" 를 담으라고 만든 것인데 링크 목록이면 받는
 * 사람이 단계마다 링크를 누르고 분석 화면으로 돌아와 다음 링크를 찾아야 한다.
 * 화면 아래 고정 막대로 `다음` 만 눌러 끝까지 읽게 한다.
 *
 * **대상이 없어진 단계는 건너뛰지 않는다.** "연결할 곳이 없다" 를 막대에 적는다 —
 * 조용히 넘기면 설명에 구멍이 났다는 사실 자체가 사라진다.
 */

export interface WalkthroughStepView {
    id: string;
    title: string;
    body: string;
    annotationId: string | null;
    target: Record<string, unknown> | null;
}

export interface WalkthroughPlayerProps {
    title: string;
    steps: WalkthroughStepView[];
    index: number;
    /** 이 단계가 가리키는 곳이 아직 있는지. 없으면 그 사실을 적는다. */
    reachable: boolean;
    onMove: (index: number) => void;
    onClose: () => void;
}

export function WalkthroughPlayer(props: WalkthroughPlayerProps): JSX.Element | null {
    const { steps, index, onMove, onClose } = props;

    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
            if (event.key === '[') {
                event.preventDefault();
                onMove(Math.max(0, index - 1));
            } else if (event.key === ']') {
                event.preventDefault();
                onMove(Math.min(steps.length - 1, index + 1));
            } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [index, steps.length, onMove, onClose]);

    const step = steps[index];
    if (step === undefined) return null;

    return (
        <div className="walkthrough-player" role="region" aria-label="안내 순서 따라 읽기">
            <span className="walkthrough-count">{`${index + 1}/${steps.length}`}</span>
            <div className="walkthrough-body">
                <strong>{step.title}</strong>
                {step.body.trim() === '' ? null : <span>{step.body}</span>}
                {props.reachable ? null : (
                    <span className="muted">연결할 곳이 없다 — 대상이 지워졌다.</span>
                )}
            </div>
            <span className="muted walkthrough-title">{props.title}</span>
            <button
                type="button"
                disabled={index === 0}
                title="이전 단계 ([)"
                onClick={() => onMove(index - 1)}
            >
                ← 이전
            </button>
            <button
                type="button"
                disabled={index >= steps.length - 1}
                title="다음 단계 (])"
                onClick={() => onMove(index + 1)}
            >
                다음 →
            </button>
            <button type="button" aria-label="따라 읽기 끝내기" onClick={onClose}>×</button>
        </div>
    );
}
