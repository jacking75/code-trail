import { keywordSet } from './keywords.js';

/**
 * 가벼운 C계열 토크나이저.
 *
 * 확장의 `media/tokenizer.js` 를 옮겼다. 바뀐 것은 **결과 모양 하나**다.
 * 예전에는 HTML 문자열을 만들었지만 이제 토큰 배열을 준다 — React 가 그걸
 * 엘리먼트로 그린다. 문자열을 만들어 `dangerouslySetInnerHTML` 로 넣으면
 * 이스케이프 실수 하나가 곧바로 XSS 가 되고, 그 코드는 우리가 읽는 남의
 * 저장소에서 온다.
 *
 * 하는 일은 둘뿐이다.
 *
 *   1. 하이라이팅
 *   2. 식별자마다 **원본 파일 기준** (줄, 컬럼)을 심어 클릭 가능하게 만들기
 *
 * 정확한 심볼 해석은 언어 서버가 한다. 완벽한 파서가 필요 없다. 다만
 * **주석과 문자열 안의 단어는 클릭 대상에서 확실히 뺀다** — 그게 거슬리는
 * 유일한 오탐이고, 테스트가 이것을 지킨다.
 */

export type TokenKind =
    /** 예약어 */
    | 'kw'
    /** 주석 */
    | 'cm'
    /** 문자열·문자 리터럴 */
    | 'st'
    /** 숫자 */
    | 'nu'
    /** 전처리기 */
    | 'pp'
    /** Rust 라이프타임 */
    | 'lt'
    /** 호출로 보이는 식별자 */
    | 'fn'
    /** 대문자로 시작하는 식별자 (타입으로 본다) */
    | 'ty'
    /** 그 밖의 식별자 */
    | 'id'
    /** 공백 */
    | 'ws'
    /** 기호 */
    | 'pu';

export interface Token {
    kind: TokenKind;
    text: string;
    /**
     * 클릭 가능한 식별자면 원본 파일 기준 좌표가 들어간다.
     * 둘 다 0-based 이고 컬럼은 UTF-16 코드 단위다 — 그대로 언어 서버에 넘어간다.
     */
    line?: number;
    char?: number;
}

export type ClickTarget = 'allSymbols' | 'callsOnly';

export interface TokenizeOptions {
    languageId: string;
    /** `code` 의 첫 줄이 원본 파일에서 몇 번째 줄인지 (0-based). */
    startLine: number;
    clickTarget: ClickTarget;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

function isIdentStart(ch: string): boolean {
    // 비ASCII 는 식별자로 본다. 한글 변수명을 쓰는 코드가 있다.
    return IDENT_START.test(ch) || ch.charCodeAt(0) > 127;
}

function isIdentPart(ch: string): boolean {
    return IDENT_PART.test(ch) || ch.charCodeAt(0) > 127;
}

function isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
}

/**
 * 코드를 줄 단위 토큰 배열로 만든다.
 *
 * 입력 줄 수와 출력 줄 수가 항상 같다. 화면의 줄 번호가 원본과 어긋나면
 * 사용자가 코드를 찾을 수 없다.
 */
export function tokenizeLines(code: string, options: TokenizeOptions): Token[][] {
    const keywords = keywordSet(options.languageId);
    const language = options.languageId;
    const callsOnly = options.clickTarget === 'callsOnly';
    const rawLines = code.split('\n');
    const out: Token[][] = [];

    // 여러 줄에 걸치는 상태
    let inBlockComment = false;
    let rawTerminator: string | null = null;

    for (let li = 0; li < rawLines.length; li++) {
        const line = rawLines[li] ?? '';
        const absLine = options.startLine + li;
        const tokens: Token[] = [];
        const push = (kind: TokenKind, text: string): void => {
            if (text !== '') {
                tokens.push({ kind, text });
            }
        };

        let i = 0;
        const n = line.length;

        while (i < n) {
            // ── 블록 주석 계속 ──
            if (inBlockComment) {
                const endIdx = line.indexOf('*/', i);
                if (endIdx === -1) {
                    push('cm', line.slice(i));
                    i = n;
                } else {
                    push('cm', line.slice(i, endIdx + 2));
                    i = endIdx + 2;
                    inBlockComment = false;
                }
                continue;
            }

            // ── 멀티라인 raw 문자열 계속 ──
            if (rawTerminator !== null) {
                const rEnd = line.indexOf(rawTerminator, i);
                if (rEnd === -1) {
                    push('st', line.slice(i));
                    i = n;
                } else {
                    push('st', line.slice(i, rEnd + rawTerminator.length));
                    i = rEnd + rawTerminator.length;
                    rawTerminator = null;
                }
                continue;
            }

            const ch = line[i] as string;

            // ── 공백 ──
            if (ch === ' ' || ch === '\t') {
                const ws = i;
                while (i < n && (line[i] === ' ' || line[i] === '\t')) {
                    i++;
                }
                push('ws', line.slice(ws, i));
                continue;
            }

            // ── 주석 ──
            if (ch === '/' && line[i + 1] === '/') {
                push('cm', line.slice(i));
                i = n;
                continue;
            }
            if (ch === '/' && line[i + 1] === '*') {
                const be = line.indexOf('*/', i + 2);
                if (be === -1) {
                    push('cm', line.slice(i));
                    i = n;
                    inBlockComment = true;
                } else {
                    push('cm', line.slice(i, be + 2));
                    i = be + 2;
                }
                continue;
            }
            if (language === 'python' && ch === '#') {
                push('cm', line.slice(i));
                i = n;
                continue;
            }

            // ── 전처리기 ──
            if (ch === '#' && (language === 'cpp' || language === 'c' || language === 'csharp')) {
                if (/^[ \t]*$/.test(line.slice(0, i))) {
                    let pe = i + 1;
                    while (pe < n && /[A-Za-z_]/.test(line[pe] ?? '')) {
                        pe++;
                    }
                    push('pp', line.slice(i, pe));
                    i = pe;
                    continue;
                }
            }

            // ── C++ raw string: R"delim( ... )delim" ──
            if ((language === 'cpp' || language === 'c') && (ch === 'R' || ch === 'u' || ch === 'L')) {
                const rm = /^(?:u8|u|U|L)?R"([^\s()\\]{0,16})\(/.exec(line.slice(i));
                if (rm) {
                    const delim = `)${rm[1] ?? ''}"`;
                    const closeAt = line.indexOf(delim, i + rm[0].length);
                    if (closeAt === -1) {
                        push('st', line.slice(i));
                        i = n;
                        rawTerminator = delim;
                    } else {
                        push('st', line.slice(i, closeAt + delim.length));
                        i = closeAt + delim.length;
                    }
                    continue;
                }
            }

            // ── Rust raw string: r#"..."# ──
            if (language === 'rust' && (ch === 'r' || ch === 'b')) {
                const rr = /^b?r(#*)"/.exec(line.slice(i));
                if (rr) {
                    const rdelim = `"${rr[1] ?? ''}`;
                    const rc = line.indexOf(rdelim, i + rr[0].length);
                    if (rc === -1) {
                        push('st', line.slice(i));
                        i = n;
                        rawTerminator = rdelim;
                    } else {
                        push('st', line.slice(i, rc + rdelim.length));
                        i = rc + rdelim.length;
                    }
                    continue;
                }
            }

            // ── C# verbatim string: @"..." ("" 가 이스케이프) ──
            if (language === 'csharp' && (ch === '@' || (ch === '$' && line[i + 1] === '@'))) {
                const vm = /^[$@]{1,2}"/.exec(line.slice(i));
                if (vm) {
                    let j = i + vm[0].length;
                    let closed = false;
                    while (j < n) {
                        if (line[j] === '"') {
                            if (line[j + 1] === '"') {
                                j += 2;
                                continue;
                            }
                            j++;
                            closed = true;
                            break;
                        }
                        j++;
                    }
                    push('st', line.slice(i, closed ? j : n));
                    if (!closed) {
                        rawTerminator = '"';
                    }
                    i = closed ? j : n;
                    continue;
                }
            }

            // ── Go raw string: `...` ──
            if (ch === '`') {
                const bt = line.indexOf('`', i + 1);
                if (bt === -1) {
                    push('st', line.slice(i));
                    i = n;
                    rawTerminator = '`';
                } else {
                    push('st', line.slice(i, bt + 1));
                    i = bt + 1;
                }
                continue;
            }

            // ── 일반 문자열 ──
            if (ch === '"') {
                let k = i + 1;
                while (k < n) {
                    if (line[k] === '\\') {
                        k += 2;
                        continue;
                    }
                    if (line[k] === '"') {
                        k++;
                        break;
                    }
                    k++;
                }
                push('st', line.slice(i, Math.min(k, n)));
                i = Math.min(k, n);
                continue;
            }

            // ── 문자 리터럴 / Rust 라이프타임 ──
            if (ch === "'") {
                const cm = /^'(\\.|[^'\\])'/.exec(line.slice(i));
                if (cm) {
                    push('st', cm[0]);
                    i += cm[0].length;
                    continue;
                }
                if (language === 'rust') {
                    const lm = /^'[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
                    if (lm) {
                        push('lt', lm[0]);
                        i += lm[0].length;
                        continue;
                    }
                }
                if (language === 'python' || language === 'javascript' || language === 'typescript') {
                    let q = i + 1;
                    while (q < n) {
                        if (line[q] === '\\') {
                            q += 2;
                            continue;
                        }
                        if (line[q] === "'") {
                            q++;
                            break;
                        }
                        q++;
                    }
                    push('st', line.slice(i, Math.min(q, n)));
                    i = Math.min(q, n);
                    continue;
                }
                push('pu', "'");
                i++;
                continue;
            }

            // ── 숫자 ──
            if (isDigit(ch) || (ch === '.' && isDigit(line[i + 1] ?? ''))) {
                const nm = /^(?:0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]+)?(?:[eE][+-]?[0-9]+)?)[uUlLfFdDmM]*(?:i8|i16|i32|i64|u8|u16|u32|u64|usize|isize|f32|f64)?/
                    .exec(line.slice(i));
                if (nm) {
                    push('nu', nm[0]);
                    i += nm[0].length;
                    continue;
                }
            }

            // ── 식별자 ──
            if (isIdentStart(ch)) {
                const start = i;
                i++;
                while (i < n && isIdentPart(line[i] as string)) {
                    i++;
                }
                const word = line.slice(start, i);

                if (keywords.has(word)) {
                    push('kw', word);
                    continue;
                }

                // 뒤에 여는 괄호가 오면 호출로 본다.
                const after = line.slice(i);
                const isCall = /^\s*[(<]/.test(after) && !/^\s*<[<=]/.test(after);
                const clickable = callsOnly ? isCall : true;
                const kind: TokenKind = isCall ? 'fn' : (/^[A-Z]/.test(word) ? 'ty' : 'id');

                if (clickable) {
                    // 좌표를 여기서만 심는다. 이 값이 그대로 언어 서버로 간다.
                    tokens.push({ kind, text: word, line: absLine, char: start });
                } else {
                    push(kind, word);
                }
                continue;
            }

            // ── 그 밖의 기호 ──
            const ps = i;
            while (
                i < n
                && !isIdentStart(line[i] as string)
                && !isDigit(line[i] as string)
                && line[i] !== ' '
                && line[i] !== '\t'
                && line[i] !== '"'
                && line[i] !== "'"
                && line[i] !== '`'
                && line[i] !== '/'
                && line[i] !== '#'
            ) {
                i++;
            }
            if (i === ps) {
                i++;
            }
            push('pu', line.slice(ps, i));
        }

        out.push(tokens);
    }

    return out;
}

/** 클릭 가능한 토큰인지. 좌표가 심어져 있으면 그렇다. */
export function isClickable(token: Token): token is Token & { line: number; char: number } {
    return token.line !== undefined && token.char !== undefined;
}
