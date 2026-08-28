import { shortName } from '@code-trail/shared';

/**
 * 문서 심볼 평탄화 (구현서 13.1).
 *
 * LSP `textDocument/documentSymbol` 은 두 가지 모양 중 하나로 온다.
 *
 * - `DocumentSymbol[]` — 계층이 있다. `range`(전체)와 `selectionRange`(이름)가 나뉜다.
 * - `SymbolInformation[]` — 계층이 없다. `location.range` 하나뿐이다.
 *
 * 둘을 하나의 `FlatSymbol` 로 맞춘다. 아래 선택 규칙들이 두 모양을 각각 다루면
 * 규칙이 두 벌이 되고, 한쪽만 고치는 실수가 반드시 생긴다.
 */

export interface Position {
    line: number;
    character: number;
}

export interface Range {
    start: Position;
    end: Position;
}

export interface FlatSymbol {
    name: string;
    detail: string;
    /** 감싸는 클래스·네임스페이스 이름. 없으면 빈 문자열. */
    container: string;
    /** LSP SymbolKind 숫자값 (1-based). */
    kind: number;
    /** 심볼 전체 범위. */
    range: Range;
    /** 이름이 있는 범위. 없는 서버는 `range` 로 채운다. */
    selectionRange: Range;
    /** 계층 깊이. `SymbolInformation` 은 전부 0 이다. */
    depth: number;
}

interface RawDocumentSymbol {
    name?: unknown;
    detail?: unknown;
    kind?: unknown;
    range?: unknown;
    selectionRange?: unknown;
    children?: unknown;
}

interface RawSymbolInformation {
    name?: unknown;
    kind?: unknown;
    containerName?: unknown;
    location?: { range?: unknown };
}

function isPosition(value: unknown): value is Position {
    const p = value as Position | undefined;
    return typeof p?.line === 'number' && typeof p?.character === 'number'
        && Number.isFinite(p.line) && Number.isFinite(p.character);
}

function isRange(value: unknown): value is Range {
    const r = value as Range | undefined;
    return isPosition(r?.start) && isPosition(r?.end);
}

export function comparePositions(a: Position, b: Position): number {
    if (a.line !== b.line) {
        return a.line - b.line;
    }
    return a.character - b.character;
}

/** `range` 가 `position` 을 담고 있는지. 끝 위치도 포함으로 본다. */
export function rangeContains(range: Range, position: Position): boolean {
    return comparePositions(range.start, position) <= 0
        && comparePositions(position, range.end) <= 0;
}

/**
 * 문서 범위를 벗어난 심볼인지 (구현서 13.1).
 *
 * 잘라 쓰지 않는다. 범위가 틀린 심볼을 잘라서 쓰면 엉뚱한 코드를 그 심볼의
 * 본문이라고 보여주게 된다. 잘못된 응답으로 보고 후보에서 뺀다.
 */
export function isWithinDocument(range: Range, lineCount: number): boolean {
    return range.start.line >= 0
        && range.end.line >= range.start.line
        && range.start.line < lineCount
        && range.end.line < lineCount;
}

/** `DocumentSymbol[]` 인지 `SymbolInformation[]` 인지 가른다. */
function isDocumentSymbol(value: unknown): value is RawDocumentSymbol {
    const s = value as RawDocumentSymbol & { location?: unknown };
    return s.location === undefined
        && (s.selectionRange !== undefined || s.children !== undefined || s.range !== undefined);
}

/**
 * 어느 모양이 오든 `FlatSymbol[]` 로 만든다.
 *
 * `lineCount` 를 주면 문서 범위를 벗어난 심볼을 걸러낸다.
 */
export function flattenDocumentSymbols(raw: unknown, lineCount?: number): FlatSymbol[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: FlatSymbol[] = [];
    walk(raw, 0, '', out);
    if (lineCount === undefined) {
        return out;
    }
    return out.filter((symbol) => isWithinDocument(symbol.range, lineCount));
}

function walk(symbols: unknown[], depth: number, parentName: string, out: FlatSymbol[]): void {
    for (const entry of symbols) {
        if (entry === null || typeof entry !== 'object') {
            continue;
        }
        if (isDocumentSymbol(entry)) {
            const raw = entry;
            if (!isRange(raw.range)) {
                // 범위가 없으면 본문을 잘라낼 수 없다. 후보가 못 된다.
                continue;
            }
            const name = typeof raw.name === 'string' ? raw.name : '';
            out.push({
                name,
                // LSP 정의상 `detail` 은 시그니처 같은 부가 설명이다.
                detail: typeof raw.detail === 'string' ? raw.detail : '',
                container: parentName,
                kind: typeof raw.kind === 'number' ? raw.kind : 0,
                range: raw.range,
                // selectionRange 가 없거나 이상하면 range 로 되돌린다(구현서 13.1).
                selectionRange: isRange(raw.selectionRange) ? raw.selectionRange : raw.range,
                depth,
            });
            if (Array.isArray(raw.children)) {
                walk(raw.children, depth + 1, shortName(name), out);
            }
            continue;
        }

        const info = entry as RawSymbolInformation;
        const range = info.location?.range;
        if (!isRange(range)) {
            continue;
        }
        out.push({
            name: typeof info.name === 'string' ? info.name : '',
            // SymbolInformation 에는 detail 이 없다. containerName 을 detail 에
            // 넣으면 함수 헤더에 클래스명이 딸려 나온다 — container 로만 쓴다.
            detail: '',
            container: typeof info.containerName === 'string' ? info.containerName : '',
            kind: typeof info.kind === 'number' ? info.kind : 0,
            range,
            // 이름 범위를 따로 주지 않는다. 전체 범위로 대신한다.
            selectionRange: range,
            depth: 0,
        });
    }
}
