import { MAX_TOTAL_LINES_HARD_CAP } from '@code-trail/shared';

import type { FlatSymbol, Range } from './flatten.js';
import { isBodyKind } from './select.js';

/**
 * 본문 범위 정하기 (구현서 13.3).
 *
 * 순서가 정해져 있다.
 *
 * 1. 문서 심볼의 **다중 행** range — 가장 믿을 만하다.
 * 2. `LocationLink` 의 `targetRange` — 심볼이 한 줄만 왔을 때의 보정.
 * 3. 같은 depth 이하에서 다음에 시작하는 심볼의 바로 앞 줄.
 * 4. 현재 위치부터 `contextLines`.
 *
 * 2~4로 정한 경우는 `approximate` 를 세운다. 사용자가 "이 끝이 진짜 끝인지"
 * 를 알 수 있어야 하기 때문이다 — 헤더의 `근사` 배지가 그것이다.
 */

export interface BodyRangeInput {
    symbol: FlatSymbol | undefined;
    /** 심볼이 없을 때 기준이 되는 위치. */
    fallbackLine: number;
    /** 같은 문서의 심볼 전부. 3번 규칙이 쓴다. */
    allSymbols: readonly FlatSymbol[];
    /** 언어 서버가 `LocationLink` 로 준 전체 범위. */
    hintRange?: Range | undefined;
    lineCount: number;
    contextLines: number;
}

export interface BodyRange {
    startLine: number;
    endLine: number;
    approximate: boolean;
}

/**
 * 한 줄만 온 range 의 끝을 추정한다.
 *
 * 자체 파서를 두지 않는다는 원칙을 지키려고 중괄호를 세는 대신 **언어 서버가 준
 * 문서 심볼 목록만** 쓴다. "이 심볼보다 뒤에서 시작하는, 이 심볼의 자식이 아닌
 * 가장 가까운 심볼" 바로 앞 줄을 끝으로 본다. 그 경계조차 없으면
 * (파일의 마지막 심볼 등) `contextLines` 만큼만 보여준다.
 */
export function guessBodyEnd(
    all: readonly FlatSymbol[],
    symbol: FlatSymbol,
    lineCount: number,
    contextLines: number,
): number {
    const startLine = symbol.range.start.line;
    let boundary = -1;
    for (const candidate of all) {
        if (candidate === symbol || candidate.range.start.line <= startLine) {
            continue;
        }
        // 이 심볼 안쪽(지역 변수 등)은 경계가 아니다.
        if (candidate.depth > symbol.depth) {
            continue;
        }
        if (boundary === -1 || candidate.range.start.line < boundary) {
            boundary = candidate.range.start.line;
        }
    }
    const end = boundary > startLine ? boundary - 1 : startLine + contextLines;
    return Math.max(startLine, Math.min(lineCount - 1, end));
}

export function chooseBodyRange(input: BodyRangeInput): BodyRange {
    const { symbol, hintRange, lineCount, contextLines } = input;

    /** 힌트가 이 줄부터 여러 줄에 걸쳐 있는지. 한 줄짜리 힌트는 도움이 안 된다. */
    const hintSpansBody = (from: number): boolean =>
        hintRange !== undefined
        && hintRange.start.line <= from
        && hintRange.end.line > from;

    if (symbol) {
        const startLine = symbol.range.start.line;
        // 1. 다중 행 range 를 그대로 쓴다.
        if (symbol.range.end.line > startLine) {
            return {
                startLine,
                endLine: Math.min(lineCount - 1, symbol.range.end.line),
                approximate: false,
            };
        }
        // 한 줄인데 몸통이 있어야 할 종류다. 보정한다.
        if (isBodyKind(symbol.kind)) {
            const endLine = hintSpansBody(startLine)
                // 2. LocationLink 의 targetRange.
                ? Math.min(lineCount - 1, (hintRange as Range).end.line)
                // 3~4. 다음 심볼 경계 또는 contextLines.
                : guessBodyEnd(input.allSymbols, symbol, lineCount, contextLines);
            return { startLine, endLine, approximate: true };
        }
        // 필드·변수처럼 원래 한 줄인 것. 근사가 아니다.
        return { startLine, endLine: startLine, approximate: false };
    }

    // 심볼 자체가 없다. 위치 주변만 보여준다.
    const startLine = Math.max(0, input.fallbackLine);
    const endLine = hintSpansBody(startLine)
        ? Math.min(lineCount - 1, (hintRange as Range).end.line)
        : Math.min(lineCount - 1, startLine + contextLines);
    return { startLine, endLine, approximate: true };
}

/**
 * 본문 문자열을 잘라낸다.
 *
 * **원본을 변형하지 않는다.** 공통 들여쓰기 제거도 탭 변환도 하지 않는다 —
 * 하는 순간 컬럼 좌표가 어긋나고, 그 좌표를 그대로 언어 서버에 넘기는 우리
 * 구조가 무너진다.
 *
 * 노드 하나가 읽는 절대 상한을 여기서 건다. 언어 서버가 파일 전체를 한 심볼의
 * 범위로 주는 사고를 막는 마지막 방어선이다.
 */
export function sliceLines(
    lines: readonly string[],
    range: BodyRange,
): { code: string; startLine: number; capped: boolean } {
    const startLine = Math.max(0, Math.min(range.startLine, lines.length - 1));
    let endLine = Math.max(startLine, Math.min(range.endLine, lines.length - 1));

    const capped = endLine - startLine > MAX_TOTAL_LINES_HARD_CAP;
    if (capped) {
        endLine = startLine + MAX_TOTAL_LINES_HARD_CAP;
    }
    return {
        code: lines.slice(startLine, endLine + 1).join('\n'),
        startLine,
        capped,
    };
}

/** 원문을 줄 배열로 나눈다. 줄바꿈 종류를 바꾸지 않는다. */
export function splitLines(text: string): string[] {
    // CRLF 파일에서 `\r` 을 남기면 화면 끝에 보이지 않는 문자가 생기고 컬럼이
    // 하나 늘어난다. 줄을 나눌 때만 떼고 줄 안의 문자는 건드리지 않는다.
    return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
}

export { MAX_TOTAL_LINES_HARD_CAP };
