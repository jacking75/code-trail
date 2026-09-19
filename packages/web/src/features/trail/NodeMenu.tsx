import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react';

/**
 * 노드 메뉴 (V08).
 *
 * 헤더 버튼이 여섯이라 노드 단위 행동을 더 넣을 자리가 없다. 메뉴는 **자리가
 * 모자란 행동**을 위한 것이지 버튼의 대체가 아니다 — 기존 버튼은 그대로 둔다.
 *
 * 자리 잡기는 후보 팝오버와 같은 방식이다. 기준 요소 바로 아래에 띄우되
 * 아래로 넘치면 위로 뒤집는다.
 */

export interface NodeMenuItem {
    label: string;
    /** 눌렀을 때. 메뉴는 실행 뒤 닫힌다. */
    run: () => void;
    disabled?: boolean;
    /** 삭제처럼 되돌리기 알림이 뒤따르는 것. 빨갛게 표시한다. */
    danger?: boolean;
    title?: string;
}

export interface NodeMenuProps {
    /** 메뉴를 띄울 기준. 헤더 요소나 우클릭한 지점이다. */
    anchor: { x: number; y: number };
    title: string;
    items: NodeMenuItem[];
    onDismiss: () => void;
}

const GAP = 4;

export function NodeMenu(props: NodeMenuProps): JSX.Element {
    const boxRef = useRef<HTMLDivElement | null>(null);
    const [spot, setSpot] = useState(props.anchor);
    const [active, setActive] = useState(0);
    const { onDismiss } = props;

    useLayoutEffect(() => {
        const box = boxRef.current;
        if (box === null) return;
        const height = box.offsetHeight;
        const width = box.offsetWidth;
        // 화면 밖에 뜨면 아무 소용이 없다. 넘치는 쪽으로 접어 넣는다.
        setSpot({
            x: Math.max(GAP, Math.min(props.anchor.x, window.innerWidth - width - GAP)),
            y: props.anchor.y + height + GAP > window.innerHeight
                ? Math.max(GAP, props.anchor.y - height - GAP)
                : props.anchor.y,
        });
    }, [props.anchor]);

    useEffect(() => {
        boxRef.current?.focus();
        const onPointer = (event: MouseEvent): void => {
            if (!boxRef.current?.contains(event.target as Node)) onDismiss();
        };
        window.addEventListener('mousedown', onPointer, true);
        return () => window.removeEventListener('mousedown', onPointer, true);
    }, [onDismiss]);

    const usable = props.items.filter((item) => item.disabled !== true);

    return (
        <div
            className="node-menu"
            role="menu"
            aria-label={props.title}
            tabIndex={-1}
            ref={boxRef}
            style={{ left: `${Math.round(spot.x)}px`, top: `${Math.round(spot.y)}px` }}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    onDismiss();
                    return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    setActive((index) => (index + step + usable.length) % Math.max(1, usable.length));
                    return;
                }
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    const item = usable[active];
                    if (item) {
                        item.run();
                        onDismiss();
                    }
                }
            }}
        >
            <div className="node-menu-title">{props.title}</div>
            {props.items.map((item, index) => (
                <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    className={`node-menu-item${item.danger ? ' danger' : ''}${
                        usable[active]?.label === item.label ? ' active' : ''}`}
                    disabled={item.disabled === true}
                    {...(item.title === undefined ? {} : { title: item.title })}
                    onMouseEnter={() => {
                        const position = usable.findIndex((value) => value.label === item.label);
                        if (position >= 0) setActive(position);
                    }}
                    onClick={() => {
                        item.run();
                        onDismiss();
                    }}
                    data-index={index}
                >
                    {item.label}
                </button>
            ))}
        </div>
    );
}
