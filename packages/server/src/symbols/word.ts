/**
 * 위치에 놓인 식별자 꺼내기.
 *
 * 언어 서버가 심볼 이름을 안 줄 때 헤더에 쓸 이름이 필요하다. 그때만 쓴다 —
 * 이건 표시용 폴백이고, 심볼 해석의 근거가 아니다.
 *
 * 규칙은 하나: 글자·숫자·`_`·`$` 가 이어지는 구간. 언어별 식별자 규칙(C++ 의
 * `::`, Rust 의 `'a`)을 흉내내지 않는다. 그건 언어 서버의 몫이다.
 */

const IDENTIFIER = /[\p{L}\p{N}_$]/u;

export function wordAt(line: string, character: number): string {
    if (character < 0 || character > line.length) {
        return '';
    }
    // 경계에 커서가 있으면 왼쪽 글자를 본다. `foo|(` 에서 `foo` 를 잡기 위해서다.
    let start = character;
    if (start > 0 && !IDENTIFIER.test(line[start] ?? '')) {
        start -= 1;
    }
    if (!IDENTIFIER.test(line[start] ?? '')) {
        return '';
    }
    let end = start;
    while (start > 0 && IDENTIFIER.test(line[start - 1] ?? '')) {
        start -= 1;
    }
    while (end + 1 < line.length && IDENTIFIER.test(line[end + 1] ?? '')) {
        end += 1;
    }
    return line.slice(start, end + 1);
}
