import { useMemo, useRef, useState, type JSX, type MouseEvent } from 'react';

import { isClickable, tokenizeLines, type ClickTarget, type Token } from '../../tokenizer/tokenize.js';
import type { AnnotationMarkView } from './annotationIndex.js';
import { circled, type ResolvedSymbolView } from './types.js';

/**
 * 노드의 코드 본문.
 *
 * **원본 문자열을 변형하지 않는다.** 공통 들여쓰기 제거도 탭 변환도 하지 않는다 —
 * 하는 순간 토크나이저가 심는 컬럼이 원본과 어긋나고, 그 좌표가 그대로 언어
 * 서버로 가기 때문에 엉뚱한 정의를 찾게 된다.
 *
 * 줄 번호는 **원본 파일 기준**이다. 화면의 첫 줄이 1번이 아니다.
 */

export interface CodeBodyProps {
    symbol: ResolvedSymbolView;
    clickTarget: ClickTarget;
    /** 노드 하나에 보여줄 최대 줄 수. 초과분은 `…더 보기` 로 접는다. */
    maxCodeLines: number;
    /** 이미 펼쳐본 호출부. 순번을 붙여 자식 노드와 짝을 만든다. */
    visited: ReadonlyMap<string, number>;
    /** 이 본문과 겹치는 분석 기록. 줄 왼쪽에 색 띠를 둔다(U10). */
    marks?: readonly AnnotationMarkView[];
    /**
     * 이 노드만의 코드 글자 크기(px). `Ctrl+휠` 로 사용자가 맞춘 값이다.
     * 세워 두면 폭 맞춤이 이 노드를 건너뛴다 — 손으로 맞춘 것을 되돌리지 않는다.
     */
    fontSize?: number;
    onIdentifierClick: (
        line: number,
        char: number,
        text: string,
        modifiers: { alt: boolean; ctrl: boolean },
    ) => void;
    onRangeSelect?: (
        range: {
            start: { line: number; char: number };
            end: { line: number; char: number };
        },
        /** 선택 끝의 뷰포트 좌표. 선택 칩을 여기 아래에 띄운다(U04). */
        anchor: { x: number; y: number } | null,
    ) => void;
    /** 줄 왼쪽 색 띠를 눌렀을 때. 그 기록으로 간다. */
    onMarkClick?: (annotationId: string) => void;
}

/** 호출부를 가리키는 키. 줄과 컬럼이 같으면 같은 지점이다. */
export function callSiteKey(line: number, char: number): string {
    return `${line}:${char}`;
}

export function CodeBody(props: CodeBodyProps): JSX.Element {
    const { symbol } = props;
    const lines = useMemo(
        () => tokenizeLines(symbol.code, {
            languageId: symbol.languageId,
            startLine: symbol.startLine,
            clickTarget: props.clickTarget,
        }),
        [symbol.code, symbol.languageId, symbol.startLine, props.clickTarget],
    );

    const [expanded, setExpanded] = useState(false);
    const limit = props.maxCodeLines > 0 ? props.maxCodeLines : lines.length;
    const shown = expanded ? lines.length : Math.min(lines.length, limit);
    const gutterWidth = String(symbol.startLine + lines.length).length;
    const suppressClick = useRef(false);

    /** 줄 번호(0-based) → 그 줄을 덮는 첫 기록. 줄마다 다시 훑지 않는다. */
    const markByLine = useMemo(() => {
        const map = new Map<number, AnnotationMarkView>();
        for (const mark of props.marks ?? []) {
            for (let line = mark.startLine; line <= mark.endLine; line += 1) {
                // 미해결이 있으면 그것이 먼저 보여야 한다.
                const existing = map.get(line);
                if (existing === undefined || (!existing.open && mark.open)) {
                    map.set(line, mark);
                }
            }
        }
        return map;
    }, [props.marks]);

    const onClick = (event: MouseEvent<HTMLSpanElement>, token: Token): void => {
        if (!isClickable(token)) {
            return;
        }
        if (suppressClick.current) {
            suppressClick.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        props.onIdentifierClick(token.line, token.char, token.text, {
            alt: event.altKey,
            ctrl: event.ctrlKey || event.metaKey,
        });
    };

    return (
        <div
            className="code"
            onMouseUp={() => {
                const selection = window.getSelection();
                if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
                const range = selection.getRangeAt(0);
                const startLine = closestCodeLine(range.startContainer);
                const endLine = closestCodeLine(range.endContainer);
                if (!startLine || !endLine) return;
                const start = pointInLine(startLine, range.startContainer, range.startOffset);
                const end = pointInLine(endLine, range.endContainer, range.endOffset);
                if (start === null || end === null) return;
                const a = { line: Number(startLine.dataset.line), char: start };
                const b = { line: Number(endLine.dataset.line), char: end };
                const ordered = a.line < b.line || (a.line === b.line && a.char <= b.char)
                    ? { start: a, end: b } : { start: b, end: a };
                suppressClick.current = true;
                // 선택 오른쪽 아래. 칩이 여기 아래에 뜬다.
                const box = range.getBoundingClientRect();
                props.onRangeSelect?.(
                    ordered,
                    box.width === 0 && box.height === 0
                        ? null
                        : { x: box.right, y: box.bottom },
                );
            }}
            {...(props.fontSize === undefined
                ? {}
                : { style: { fontSize: `${props.fontSize}px` }, 'data-fs': '1' })}
        >
            {lines.slice(0, shown).map((tokens, index) => {
                const lineNumber = symbol.startLine + index;
                const mark = markByLine.get(lineNumber);
                return (
                    // 줄은 순서가 고정이고 재배열되지 않는다. 인덱스 키로 충분하다.
                    // eslint-disable-next-line react/no-array-index-key
                    <div
                        className={mark === undefined ? 'cl' : `cl noted${mark.open ? ' open' : ''}`}
                        key={index}
                        {...(mark === undefined ? {} : { 'data-kind': mark.kind, title: mark.preview })}
                        {...(mark === undefined ? {} : {
                            onClick: (event) => {
                                if ((event.target as HTMLElement).closest('.clickable')) return;
                                if ((event.nativeEvent.offsetX ?? 99) > 6) return;
                                event.stopPropagation();
                                props.onMarkClick?.(mark.annotationId);
                            },
                        })}
                    >
                        <span className="no">
                            {String(lineNumber + 1).padStart(gutterWidth, ' ')}
                        </span>
                        <span className="ct" data-line={lineNumber}>
                            {tokens.map((token, ti) => {
                                if (!isClickable(token)) {
                                    return (
                                        // eslint-disable-next-line react/no-array-index-key
                                        <span className={`tok ${token.kind}`} key={ti}>
                                            {token.text}
                                        </span>
                                    );
                                }
                                const ordinal = props.visited.get(callSiteKey(token.line, token.char));
                                return (
                                    <span
                                        // eslint-disable-next-line react/no-array-index-key
                                        key={ti}
                                        className={`tok ${token.kind} clickable${
                                            ordinal === undefined ? '' : ' visited'}`}
                                        data-l={token.line}
                                        data-c={token.char}
                                        // 키보드로도 본문 안을 다닌다(U16). 활성 노드의
                                        // 본문에만 `Tab` 으로 들어간다 — 트리 전체가
                                        // 탭 순서에 들어가면 헤더 사이 이동이 불가능해진다.
                                        tabIndex={-1}
                                        role="link"
                                        {...(ordinal === undefined ? {} : { 'data-idx': ordinal })}
                                        onClick={(event) => onClick(event, token)}
                                        onKeyDown={(event) => {
                                            if (event.key !== 'Enter') return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            props.onIdentifierClick(
                                                token.line, token.char, token.text,
                                                { alt: event.altKey, ctrl: false },
                                            );
                                        }}
                                    >
                                        {token.text}
                                        {ordinal === undefined ? null : (
                                            <span className="idx-mark">{circled(ordinal)}</span>
                                        )}
                                    </span>
                                );
                            })}
                        </span>
                    </div>
                );
            })}

            {lines.length > shown ? (
                <button
                    type="button"
                    className="more"
                    onClick={(event) => {
                        event.stopPropagation();
                        setExpanded(true);
                    }}
                >
                    {`…더 보기 (${lines.length - shown}줄)`}
                </button>
            ) : null}
        </div>
    );
}

function closestCodeLine(node: Node): HTMLElement | null {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    return element?.closest<HTMLElement>('.ct[data-line]') ?? null;
}

function pointInLine(line: HTMLElement, node: Node, offset: number): number | null {
    try {
        const range = document.createRange();
        range.selectNodeContents(line);
        range.setEnd(node, offset);
        return range.toString().length;
    } catch {
        return null;
    }
}
