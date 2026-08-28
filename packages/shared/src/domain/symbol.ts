/**
 * 언어 서버가 준 정의 하나 + 본문 코드 + 좌표.
 *
 * 확장 시절의 `src/symbols.ts` 와 같은 자리를 차지하지만 VS Code 타입을 쓰지 않는다.
 * 여기에는 타입 추론도, AST 분석도, 언어별 분기도 들어가지 않는다 — 언어 서버가 준
 * 결과를 정규화해 담는 그릇일 뿐이다.
 */

/**
 * LSP `SymbolKind`. 프로토콜 명세의 숫자값을 그대로 쓴다 (1-based).
 *
 * VS Code 의 `vscode.SymbolKind` 는 이보다 1 작은 0-based 값이라 서로 다르다.
 * 확장에서 옮겨온 값을 그대로 믿지 말고 LSP 값으로 바꿔 넣는다.
 */
export const SymbolKind = {
    File: 1,
    Module: 2,
    Namespace: 3,
    Package: 4,
    Class: 5,
    Method: 6,
    Property: 7,
    Field: 8,
    Constructor: 9,
    Enum: 10,
    Interface: 11,
    Function: 12,
    Variable: 13,
    Constant: 14,
    String: 15,
    Number: 16,
    Boolean: 17,
    Array: 18,
    Object: 19,
    Key: 20,
    Null: 21,
    EnumMember: 22,
    Struct: 23,
    Event: 24,
    Operator: 25,
    TypeParameter: 26,
} as const;

export type SymbolKindValue = (typeof SymbolKind)[keyof typeof SymbolKind];

const KIND_NAMES: Record<number, string> = {
    [SymbolKind.File]: 'file',
    [SymbolKind.Module]: 'module',
    [SymbolKind.Namespace]: 'namespace',
    [SymbolKind.Package]: 'package',
    [SymbolKind.Class]: 'class',
    [SymbolKind.Method]: 'method',
    [SymbolKind.Property]: 'property',
    [SymbolKind.Field]: 'field',
    [SymbolKind.Constructor]: 'constructor',
    [SymbolKind.Enum]: 'enum',
    [SymbolKind.Interface]: 'interface',
    [SymbolKind.Function]: 'function',
    [SymbolKind.Variable]: 'variable',
    [SymbolKind.Constant]: 'constant',
    [SymbolKind.String]: 'string',
    [SymbolKind.Number]: 'number',
    [SymbolKind.Boolean]: 'boolean',
    [SymbolKind.Array]: 'array',
    [SymbolKind.Object]: 'object',
    [SymbolKind.Key]: 'key',
    [SymbolKind.Null]: 'null',
    [SymbolKind.EnumMember]: 'enum member',
    [SymbolKind.Struct]: 'struct',
    [SymbolKind.Event]: 'event',
    [SymbolKind.Operator]: 'operator',
    [SymbolKind.TypeParameter]: 'type parameter',
};

/** 헤더에 표시할 종류 이름. 모르는 값이면 `symbol` 로 둔다. */
export function kindName(kind: number): string {
    return KIND_NAMES[kind] ?? 'symbol';
}

/** 함수·메서드·클래스처럼 "구현" 이라는 개념이 있는 종류인지. */
export function isCallableKind(kind: number): boolean {
    return (
        kind === SymbolKind.Method
        || kind === SymbolKind.Function
        || kind === SymbolKind.Constructor
        || kind === SymbolKind.Operator
    );
}

/** 감싸는 이름을 헤더에 함께 보여줄 종류인지. 함수·메서드에는 붙이지 않는다. */
export function isContainerKind(kind: number): boolean {
    return (
        kind === SymbolKind.Class
        || kind === SymbolKind.Struct
        || kind === SymbolKind.Interface
        || kind === SymbolKind.Enum
        || kind === SymbolKind.Namespace
        || kind === SymbolKind.Module
    );
}

/**
 * Roslyn 등이 `Foo(string, int) : Task<T>` 형태로 주는 이름에서 식별자만 뽑는다.
 * 언어별 분기가 아니라 "이름에 괄호가 있으면 앞까지" 라는 한 줄 규칙이다.
 */
export function shortName(name: string): string {
    const cut = name.indexOf('(');
    return cut > 0 ? name.slice(0, cut).trim() : name;
}

/**
 * 언어 서버가 준 정의 하나 + 본문 코드 + 좌표.
 *
 * 저장 규칙(구현서 9.4):
 * - 프로젝트 안의 파일은 `relPath` 에 OS 독립적인 `/` 구분 상대경로를 담는다.
 * - 절대경로는 어디에도 담지 않는다. `displayPath` 는 화면에 쓸 경로다.
 * - `documentId` 는 세션 안에서만 유효하다. 저장할 때 버린다.
 */
export interface ResolvedSymbol {
    /** 표시용 이름. Roslyn 스타일 이름은 `shortName` 을 통과한 뒤 값이다. */
    name: string;
    /** 언어 서버가 준 부가 설명(시그니처 등). 없으면 빈 문자열. */
    detail: string;
    /** 감싸는 클래스·네임스페이스 이름. 없으면 빈 문자열. */
    container: string;
    /** LSP SymbolKind 숫자값. */
    kind: number;
    /**
     * 프로젝트 루트 기준 `/` 구분 상대경로. 프로젝트 밖 심볼이면 `null`.
     * 저장·비교·문서 열기의 기준이 되는 유일한 경로다.
     */
    relPath: string | null;
    /** 화면에 그대로 찍는 경로. 프로젝트 밖 심볼은 여기에만 경로가 남는다. */
    displayPath: string;
    /** 프로젝트 경계 밖 심볼인지. `true` 면 재시작 후 외부 에디터 열기를 막는다. */
    external: boolean;
    /** 하이라이팅과 Markdown 코드 블록에 쓰는 언어 ID. */
    languageId: string;
    /** 본문 코드. 들여쓰기·탭·줄바꿈을 원본 그대로 둔다. */
    code: string;
    /** `code` 의 첫 줄이 원본 파일에서 몇 번째 줄인지 (0-based). */
    startLine: number;
    /** 심볼 이름이 있는 줄 (0-based). */
    anchorLine: number;
    /** 심볼 이름이 있는 컬럼 (0-based, UTF-16 코드 단위). */
    anchorChar: number;
    /** 본문 범위를 못 구하고 주변 줄로 추정했는지. */
    approximate: boolean;
    /** 구현이라는 개념이 있는 심볼인지. */
    callable: boolean;
    /** 몸통 없이 선언만 있는지. */
    declarationOnly: boolean;
    /** 스냅샷을 뜬 시점 파일 내용의 SHA-256(hex). 못 구했으면 `null`. */
    contentHash: string | null;
    /** 스냅샷을 뜬 시점 파일 수정 시각(ISO 8601). 못 구했으면 `null`. */
    modifiedAt: string | null;
    /** 세션 안에서만 유효한 문서 식별자. **저장하지 않는다.** */
    documentId: string | null;
}

/**
 * 같은 대상인지 판정하는 키. 재귀 판정과 형제 중복 판정이 모두 이걸 쓴다.
 *
 * 파일과 이름 위치(anchorLine)만 본다. 본문 범위나 코드 내용은 보지 않는다 —
 * 같은 함수를 두 경로로 열어도 같은 심볼이어야 하기 때문이다.
 */
export function symbolKey(symbol: ResolvedSymbol): string {
    return `${symbol.relPath ?? symbol.displayPath}:${symbol.anchorLine}`;
}

/** 두 심볼이 같은 대상을 가리키는지. */
export function isSameSymbol(a: ResolvedSymbol, b: ResolvedSymbol): boolean {
    return symbolKey(a) === symbolKey(b);
}
