import { normalizeUri } from '../lsp/documents.js';
import type { Position, Range } from './flatten.js';

/**
 * `Location` 과 `LocationLink` 정규화 (구현서 11.5).
 *
 * LSP 는 위치를 두 모양으로 준다.
 *
 * - `Location` — `uri` + `range` 하나.
 * - `LocationLink` — `targetUri` + `targetRange`(전체) + `targetSelectionRange`(이름).
 *
 * 후자가 정보가 많다. `targetRange` 는 본문 범위 힌트로 쓸 수 있어서, 문서 심볼을
 * 주지 않는 서버에서도 함수 전체를 보여줄 수 있다. 그래서 우리는 `linkSupport` 를
 * 켜고 오는 대로 하나의 `NormalizedLocation` 으로 맞춘다.
 */

export interface NormalizedLocation {
    /** 원래 URI. **표시와 파일 읽기에 이 값을 쓴다.** */
    uri: string;
    /** 비교·중복 제거 전용 표준형. 화면에 내보내지 않는다. */
    key: string;
    /** 정의된 이름의 위치. */
    selection: Position;
    /** 언어 서버가 알려준 전체 범위. 없을 수 있다. */
    fullRange?: Range;
}

interface RawLocation {
    uri?: unknown;
    range?: { start?: unknown };
}

interface RawLocationLink {
    targetUri?: unknown;
    targetRange?: unknown;
    targetSelectionRange?: unknown;
}

function isPosition(value: unknown): value is Position {
    const p = value as Position | undefined;
    return typeof p?.line === 'number' && typeof p?.character === 'number';
}

function isRange(value: unknown): value is Range {
    const r = value as Range | undefined;
    return isPosition(r?.start) && isPosition(r?.end);
}

/**
 * 응답을 정규화한다. 배열이 아니어도(단일 Location) 받아준다 — LSP 명세가
 * `Location | Location[] | LocationLink[] | null` 을 모두 허용한다.
 *
 * 같은 위치의 중복은 표준화 URI 와 시작 위치로 지운다.
 */
export function normalizeLocations(raw: unknown): NormalizedLocation[] {
    if (raw === null || raw === undefined) {
        return [];
    }
    const entries: unknown[] = Array.isArray(raw) ? raw : [raw];
    const out: NormalizedLocation[] = [];
    const seen = new Set<string>();

    for (const entry of entries) {
        if (entry === null || typeof entry !== 'object') {
            continue;
        }
        const normalized = normalizeOne(entry);
        if (normalized === undefined) {
            continue;
        }
        const dedupeKey = `${normalized.key}#${normalized.selection.line}:${normalized.selection.character}`;
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);
        out.push(normalized);
    }
    return out;
}

function normalizeOne(entry: object): NormalizedLocation | undefined {
    if ('targetUri' in entry) {
        const link = entry as RawLocationLink;
        if (typeof link.targetUri !== 'string') {
            return undefined;
        }
        // targetSelectionRange 가 anchor, targetRange 가 본문 힌트다(구현서 11.5).
        const selectionRange = isRange(link.targetSelectionRange)
            ? link.targetSelectionRange
            : (isRange(link.targetRange) ? link.targetRange : undefined);
        if (selectionRange === undefined) {
            return undefined;
        }
        return {
            uri: link.targetUri,
            key: normalizeUri(link.targetUri),
            selection: selectionRange.start,
            ...(isRange(link.targetRange) ? { fullRange: link.targetRange } : {}),
        };
    }

    const location = entry as RawLocation;
    if (typeof location.uri !== 'string' || !isPosition(location.range?.start)) {
        return undefined;
    }
    return {
        uri: location.uri,
        key: normalizeUri(location.uri),
        selection: location.range.start,
    };
}

/**
 * `file:` 로 읽을 수 있는 위치만.
 *
 * 언어 서버는 `jdt:`, `deno:` 같은 가상 문서 URI 를 돌려주기도 한다. 그런 곳은
 * 코드 본문을 읽을 방법이 없으므로 후보에서 뺀다(구현서 11.5).
 */
export function onlyReadable(locations: readonly NormalizedLocation[]): NormalizedLocation[] {
    return locations.filter((location) => location.uri.startsWith('file:'));
}
