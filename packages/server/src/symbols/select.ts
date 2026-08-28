import { SymbolKind } from '@code-trail/shared';

import { rangeContains, type FlatSymbol, type Position } from './flatten.js';

/**
 * 심볼 선택 규칙 (구현서 13.2).
 *
 * 확장의 `narrower` / `pickEnclosing` / `pickEnclosingBody` / `pickByDeclaration`
 * 를 그대로 옮겼다. 규칙 자체가 여러 언어 서버의 실제 동작에 부딪혀 다듬어진
 * 것이라, 옮기면서 "더 나은 방법" 을 넣지 않았다.
 */

/** 함수·메서드·클래스처럼 "몸통" 이라는 개념이 있는 종류인지. */
export function isBodyKind(kind: number): boolean {
    return (
        kind === SymbolKind.Function
        || kind === SymbolKind.Method
        || kind === SymbolKind.Constructor
        || kind === SymbolKind.Class
        || kind === SymbolKind.Struct
        || kind === SymbolKind.Interface
        || kind === SymbolKind.Enum
        || kind === SymbolKind.Namespace
        || kind === SymbolKind.Module
    );
}

/**
 * 범위가 좁은 것을 앞으로. 같으면 더 깊은 것을 앞으로.
 *
 * depth 만으로 정렬하면 안 된다. 언어 서버가 계층 없는 `SymbolInformation` 을
 * 주면 클래스도 메서드도 전부 depth 0 이고 `selectionRange` 가 심볼 전체 범위라서,
 * 메서드를 클릭했는데 그 메서드를 감싸는 클래스가 먼저 걸려 나온다.
 * (클래스 코드가 통째로 펼쳐지고 정작 함수 본문은 잘려 보이던 원인이다.)
 *
 * 그래도 같으면 언어 서버가 준 원래 순서를 유지한다 — `Array.prototype.sort` 가
 * 안정 정렬이라 0 을 돌려주면 그렇게 된다.
 */
export function narrower(a: FlatSymbol, b: FlatSymbol): number {
    const la = a.range.end.line - a.range.start.line;
    const lb = b.range.end.line - b.range.start.line;
    if (la !== lb) {
        return la - lb;
    }
    if (a.depth !== b.depth) {
        return b.depth - a.depth;
    }
    return 0;
}

/**
 * position 을 감싸는 심볼 중 "본문을 보여주기에 적절한" 것.
 *
 * 가장 깊은 심볼이 항상 정답은 아니다. 클래스 안의 메서드를 클릭하면 메서드를
 * 보여줘야 하지만, 필드 변수를 클릭하면 그 필드 한 줄만 보여주는 게 맞다.
 * 그래서 감싸는 것 중 가장 좁은 심볼을 쓴다.
 */
export function pickEnclosing(
    symbols: readonly FlatSymbol[],
    position: Position,
): FlatSymbol | undefined {
    const containing = symbols.filter((s) => rangeContains(s.range, position));
    if (containing.length === 0) {
        return undefined;
    }
    return [...containing].sort(narrower)[0];
}

/**
 * 커서를 감싸는 심볼 중 "몸통이 있는" 가장 안쪽 것.
 *
 * 함수 안에 커서를 두고 탐색을 시작했는데 언어 서버가 지역 변수까지 심볼로
 * 보고하면, 가장 좁은 심볼은 그 변수 한 줄이 된다. 그때는 함수를 보여줘야 한다.
 */
export function pickEnclosingBody(
    symbols: readonly FlatSymbol[],
    position: Position,
): FlatSymbol | undefined {
    const containing = symbols.filter((s) => rangeContains(s.range, position));
    if (containing.length === 0) {
        return undefined;
    }
    const bodies = containing.filter((s) => isBodyKind(s.kind));
    const pool = bodies.length > 0 ? bodies : containing;
    return [...pool].sort(narrower)[0];
}

/**
 * 정의 위치(선언 이름 위치)와 맞아떨어지는 심볼.
 *
 * 이름 범위(`selectionRange`)가 그 위치를 포함하는 것을 먼저 본다. 언어 서버가
 * 준 정의 위치는 대개 이름의 시작이라, 이 쪽이 전체 범위보다 정확하다.
 */
export function pickByDeclaration(
    symbols: readonly FlatSymbol[],
    position: Position,
): FlatSymbol | undefined {
    const byName = symbols.filter((s) => rangeContains(s.selectionRange, position));
    if (byName.length > 0) {
        return [...byName].sort(narrower)[0];
    }
    return pickEnclosing(symbols, position);
}
