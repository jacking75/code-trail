import { useEffect, useState, type JSX } from 'react';

/**
 * 선택 칩 (U04).
 *
 * 본문이나 코드 화면에서 글자를 드래그하면 선택 끝에 뜨는 작은 버튼 묶음이다.
 *
 * **드래그만으로 화면이 바뀌지 않는다.** 예전에는 본문에서 두 줄을 끌면 곧장
 * 분석 기록 탭으로 튕겼고, 코드 한 줄을 복사하려던 사람도 탭 밖으로 밀려났다.
 * 이제 드래그는 칩을 띄우는 데서 멈추고, 그다음 한 번을 사용자가 정한다.
 */

export interface SelectionChipAnchor {
    /** 선택 끝의 뷰포트 좌표. */
    x: number;
    y: number;
}

export interface SelectionChipProps {
    anchor: SelectionChipAnchor;
    /** AI 초안 버튼을 띄울지. 제공자가 꺼져 있으면 누를 수 없는 버튼을 두지 않는다. */
    aiEnabled: boolean;
    onNote: () => void;
    onAiDraft: () => void;
    onCopy: () => void;
    onDismiss: () => void;
}

/** 선택 끝에서 칩까지 띄우는 거리. 글자를 가리지 않을 만큼만. */
const GAP = 8;
/** 칩이 들어갈 대략의 높이. 아래로 넘치면 위로 뒤집는 판정에 쓴다. */
const CHIP_HEIGHT = 34;

export function SelectionChip(props: SelectionChipProps): JSX.Element {
    const { onDismiss } = props;
    const [flipped, setFlipped] = useState(false);

    useEffect(() => {
        setFlipped(props.anchor.y + GAP + CHIP_HEIGHT > window.innerHeight);
    }, [props.anchor.y]);

    // 선택이 접히거나 다른 곳을 누르면 사라진다. 남아 있으면 무엇에 대한
    // 버튼인지 알 수 없어진다.
    useEffect(() => {
        const onSelectionChange = (): void => {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) {
                onDismiss();
            }
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onDismiss();
            }
        };
        document.addEventListener('selectionchange', onSelectionChange);
        window.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('selectionchange', onSelectionChange);
            window.removeEventListener('keydown', onKey);
        };
    }, [onDismiss]);

    return (
        <div
            className="selection-chip"
            /*
             * 칩을 눌러도 선택이 풀리지 않게 한다.
             *
             * 기본 동작대로면 mousedown 이 선택을 접고, 그 `selectionchange` 가
             * 칩을 먼저 지워 click 이 아무 데도 닿지 않는다. `복사` 도 빈 문자열을
             * 집는다. 선택 위에 뜨는 도구 막대가 늘 쓰는 수법이다.
             */
            onMouseDown={(event) => event.preventDefault()}
            style={{
                left: `${Math.max(8, props.anchor.x)}px`,
                top: `${flipped ? props.anchor.y - GAP - CHIP_HEIGHT : props.anchor.y + GAP}px`,
            }}
            role="toolbar"
            aria-label="선택한 코드로 할 일"
        >
            <button type="button" onClick={props.onNote}>＋ 기록</button>
            {props.aiEnabled ? (
                <button type="button" onClick={props.onAiDraft}>AI 초안</button>
            ) : null}
            <button type="button" onClick={props.onCopy}>복사</button>
        </div>
    );
}
