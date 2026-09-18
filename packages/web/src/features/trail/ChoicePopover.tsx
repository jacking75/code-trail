import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

import type { DefinitionChoice } from './types.js';

/**
 * 후보 팝오버 (U09).
 *
 * 정의·구현 후보를 **클릭한 지점 옆에서** 고른다. 트리 맨 위에 뜨면 무엇의
 * 후보인지 알 수 없고, 긴 트레일에서는 목록이 화면 밖에 있다.
 *
 * **자동으로 고르지 않는다는 규칙은 그대로다.** 달라진 것은 고르는 자리뿐이다 —
 * 어느 구현이 실제로 도는지는 호출부의 정적 타입만으로 알 수 없고, 하나를
 * 골라 붙이면 그게 실행되는 코드라고 오해하게 된다.
 */

export interface ChoicePopoverProps {
    choice: DefinitionChoice;
    /** 팝오버를 담는 스크롤 컨테이너. 좌표를 이 기준으로 잰다. */
    host: HTMLElement | null;
    onChoose: (choiceId: string, candidateId: string) => void;
    /** 구현 목록의 `전부 붙이기`. 기존 `⚑` 와 같은 결과다. */
    onAttachAll?: (nodeId: string) => void;
    onDismiss: () => void;
}

/** 기준점에서 팝오버까지의 거리. */
const GAP = 6;

/**
 * 기준이 되는 화면 요소.
 *
 * 정의 후보는 클릭한 토큰, 구현 후보는 그 노드 헤더다. 둘 다 없으면(루트
 * 만들기) 트리 맨 위에 그대로 둔다.
 */
function anchorFor(choice: DefinitionChoice, host: HTMLElement): HTMLElement | null {
    if (choice.nodeId === null) {
        return null;
    }
    if (choice.origin) {
        const token = host.querySelector<HTMLElement>(
            `[data-id="${choice.nodeId}"] [data-l="${choice.origin.line}"][data-c="${choice.origin.char}"]`,
        );
        if (token) {
            return token;
        }
    }
    return host.querySelector<HTMLElement>(`[data-id="${choice.nodeId}"] > .hd`);
}

export function ChoicePopover(props: ChoicePopoverProps): JSX.Element {
    const { choice, host, onDismiss } = props;
    const boxRef = useRef<HTMLDivElement | null>(null);
    const [spot, setSpot] = useState<{ left: number; top: number } | null>(null);
    const [active, setActive] = useState(0);

    const implementation = choice.kind === 'implementation';
    const rowCount = choice.candidates.length + (implementation ? 1 : 0);

    useLayoutEffect(() => {
        if (host === null) {
            setSpot(null);
            return;
        }
        const anchor = anchorFor(choice, host);
        if (anchor === null) {
            setSpot(null);
            return;
        }
        const anchorBox = anchor.getBoundingClientRect();
        const hostBox = host.getBoundingClientRect();
        const height = boxRef.current?.offsetHeight ?? 0;
        // 아래로 넘치면 위로 뒤집는다. 화면 밖에 뜨면 아무 소용이 없다.
        const flip = anchorBox.bottom + GAP + height > window.innerHeight && anchorBox.top > height;
        setSpot({
            left: anchorBox.left - hostBox.left + host.scrollLeft,
            top: flip
                ? anchorBox.top - hostBox.top + host.scrollTop - height - GAP
                : anchorBox.bottom - hostBox.top + host.scrollTop + GAP,
        });
    }, [choice, host]);

    useEffect(() => {
        boxRef.current?.querySelector<HTMLElement>('button')?.focus();
    }, [choice.choiceId]);

    const commit = (index: number): void => {
        if (implementation && index === 0) {
            if (choice.nodeId !== null) {
                props.onAttachAll?.(choice.nodeId);
            }
            return;
        }
        const candidate = choice.candidates[implementation ? index - 1 : index];
        if (candidate) {
            props.onChoose(choice.choiceId, candidate.candidateId);
        }
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            onDismiss();
            return;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const delta = event.key === 'ArrowDown' ? 1 : -1;
            const next = (active + delta + rowCount) % rowCount;
            setActive(next);
            const buttons = boxRef.current?.querySelectorAll<HTMLElement>('button.choice-row');
            buttons?.[next]?.focus();
        }
    };

    return (
        <div
            className="choice"
            role="dialog"
            aria-label={implementation ? '구현 후보' : '정의 후보'}
            ref={boxRef}
            onKeyDown={onKeyDown}
            {...(spot === null
                ? {}
                : { style: { position: 'absolute', left: `${spot.left}px`, top: `${spot.top}px` } })}
        >
            <p>
                {choice.title
                    ?? (implementation
                        ? `구현 ${choice.candidates.length}개`
                        : `정의 후보 ${choice.candidates.length}개`)}
            </p>
            <ul>
                {implementation ? (
                    <li>
                        <button
                            type="button"
                            className="choice-row all"
                            onClick={() => commit(0)}
                        >
                            <span className="cand-name">전부 붙이기</span>
                            <span className="cand-path">{`${choice.candidates.length}개를 형제 자식으로`}</span>
                        </button>
                    </li>
                ) : null}
                {choice.candidates.map((candidate, index) => (
                    <li key={candidate.candidateId}>
                        <button
                            type="button"
                            className="choice-row"
                            onClick={() => commit(implementation ? index + 1 : index)}
                        >
                            <span className="cand-name">{candidate.name}</span>
                            <span className="cand-path">
                                {`${candidate.displayPath}:${candidate.line + 1}`}
                            </span>
                            {candidate.hasBody ? null : <span className="badge decl">선언만</span>}
                        </button>
                    </li>
                ))}
            </ul>
            <button type="button" className="danger" onClick={onDismiss}>취소</button>
        </div>
    );
}
