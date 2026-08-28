/**
 * 선언만 판정 (구현서 13.4).
 *
 * **언어별 파서를 만들지 않는다.** 판정은 셋을 모두 만족할 때만 참이다.
 *
 * 1. 몸통이 있어야 할 종류다 (`callable`).
 * 2. 본문 범위를 추정하지 않았다 (`approximate` 가 아니다).
 * 3. 코드에 몸통 시작 표지(`{`)가 없다.
 *
 * 2번이 있는 이유는 근사 본문이 함수의 첫 줄만 담을 수 있기 때문이다. 그
 * 한 줄에 `{` 가 없다고 "선언뿐" 이라고 하면, 실제로는 몸통이 있는 함수에
 * `선언만` 배지가 붙고 사용자는 `⚑` 를 눌러 헛것을 찾게 된다.
 *
 * 이 휴리스틱을 파일 하나로 격리해 둔 것은 잘못된 판정이 심볼 해석 전체로
 * 퍼지지 않게 하기 위해서다. 여기만 고치면 규칙 전체가 바뀐다.
 */

export interface DeclarationOnlyInput {
    callable: boolean;
    approximate: boolean;
    code: string;
}

/**
 * 몸통 없이 선언만 있는지.
 *
 * C# 인터페이스 메서드, C++ 순수 가상 함수와 헤더 선언, Go 인터페이스 메서드,
 * Rust 트레이트의 기본 구현 없는 메서드가 이 규칙 하나에 모두 걸린다.
 */
export function isDeclarationOnly(input: DeclarationOnlyInput): boolean {
    if (!input.callable || input.approximate) {
        return false;
    }
    return !hasBodyMarker(input.code);
}

/**
 * 몸통 시작 표지가 있는지.
 *
 * 문자열·주석 안의 `{` 까지 가려내지 않는다. 그러려면 언어별 파서가 필요하고,
 * 그건 이 프로그램이 하지 않기로 한 일이다. 잘못 판정되는 쪽은 "몸통이 있는데
 * 없다고 하는" 것이 아니라 "없는데 있다고 하는" 쪽이라 안전하다 —
 * 배지가 안 붙을 뿐 사용자가 잃는 것이 없다.
 */
function hasBodyMarker(code: string): boolean {
    return code.includes('{');
}
