import { useMemo, useState, type JSX, type MouseEvent } from 'react';

import { isClickable, tokenizeLines, type ClickTarget, type Token } from '../../tokenizer/tokenize.js';
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
    onIdentifierClick: (
        line: number,
        char: number,
        text: string,
        modifiers: { alt: boolean; ctrl: boolean },
    ) => void;
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

    const onClick = (event: MouseEvent<HTMLSpanElement>, token: Token): void => {
        if (!isClickable(token)) {
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
        <div className="code">
            {lines.slice(0, shown).map((tokens, index) => (
                // 줄은 순서가 고정이고 재배열되지 않는다. 인덱스 키로 충분하다.
                // eslint-disable-next-line react/no-array-index-key
                <div className="cl" key={index}>
                    <span className="no">
                        {String(symbol.startLine + index + 1).padStart(gutterWidth, ' ')}
                    </span>
                    <span className="ct">
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
                                    {...(ordinal === undefined ? {} : { 'data-idx': ordinal })}
                                    onClick={(event) => onClick(event, token)}
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
            ))}

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
