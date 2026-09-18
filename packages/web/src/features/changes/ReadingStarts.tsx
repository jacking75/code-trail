import { useEffect, useRef, useState, type JSX } from 'react';

import { api, type DocumentContent, type GitHunkView } from '../../api/http.js';

/**
 * 읽기 시작점.
 *
 * 변경 목록 · 문서 심볼 · 제한된 내용 검색 셋을 사이드바 아래에 둔다.
 *
 * **리뷰의 시작점은 파일이 아니라 hunk 다** (U14). 파일 줄을 펼치면 바뀐 줄
 * 덩어리가 나오고, 그 줄에서 바로 연다. 파일 첫 줄로 열면 바뀐 곳을 다시
 * 찾아 내려가야 한다.
 */

export interface ChangeEntry {
    relPath: string;
    status: string;
    area: string;
    addedLines: number | null;
    deletedLines: number | null;
}

export interface DocumentSymbolEntry {
    name: string;
    detail: string;
    container: string;
    kind: number;
    depth: number;
    selectionRange: { start: { line: number; character: number } };
}

export interface ReadingStartsProps {
    document: DocumentContent | null;
    changes: ChangeEntry[];
    /** `App` 이 들고 있는 문서 심볼. 요청은 문서마다 한 번뿐이다. */
    symbols: DocumentSymbolEntry[];
    /** 이동 이력에 있는 파일. `열어봄 ✓` 을 붙인다. */
    openedPaths: ReadonlySet<string>;
    /** 파일별 기록 수. 활성 분석의 색인에서 온다. */
    noteCounts: ReadonlyMap<string, number>;
    onOpenFile: (relPath: string, line?: number, char?: number) => void;
    onAddRoot: (line: number, char: number) => void;
}

export function ReadingStarts(props: ReadingStartsProps): JSX.Element {
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<Array<{ relPath: string; line: number; char: number; preview: string }>>([]);
    const [busy, setBusy] = useState(false);
    const [scope, setScope] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [truncated, setTruncated] = useState(false);
    const [hunks, setHunks] = useState<Record<string, GitHunkView[]>>({});
    const [expanded, setExpanded] = useState<string | null>(null);
    const searchController = useRef<AbortController | null>(null);

    useEffect(() => () => searchController.current?.abort(), []);

    const toggleHunks = (relPath: string): void => {
        setExpanded((current) => (current === relPath ? null : relPath));
        if (hunks[relPath] !== undefined) {
            return;
        }
        void api.hunks(relPath)
            .then((value) => setHunks((current) => ({ ...current, [relPath]: value.hunks })))
            .catch(() => setHunks((current) => ({ ...current, [relPath]: [] })));
    };

    const search = (): void => {
        if (query.trim().length < 2) return;
        searchController.current?.abort();
        const controller = new AbortController();
        searchController.current = controller;
        setBusy(true);
        void api.contentSearch(query, scope, caseSensitive, controller.signal).then((value) => {
            setMatches(value.matches); setTruncated(value.truncated);
        })
            .catch((error: unknown) => {
                if (!(error instanceof DOMException && error.name === 'AbortError')) setMatches([]);
            }).finally(() => {
                if (searchController.current === controller) {
                    searchController.current = null;
                    setBusy(false);
                }
            });
    };

    return (
        <div className="reading-starts">
            <details>
                <summary>{`변경 목록 (${props.changes.length})`}</summary>
                <ul>
                    {props.changes.slice(0, 100).map((change, index) => {
                        const noteCount = props.noteCounts.get(change.relPath) ?? 0;
                        const open = expanded === change.relPath;
                        return (
                            <li key={`${change.area}:${change.relPath}:${index}`} className="change-row">
                                <button
                                    type="button"
                                    className="change-file"
                                    aria-expanded={open}
                                    onClick={() => toggleHunks(change.relPath)}
                                >
                                    <span>{change.status}</span>
                                    <code>{change.relPath}</code>
                                    {change.addedLines === null ? null : (
                                        <small className="change-stat">
                                            {`+${change.addedLines} −${change.deletedLines ?? 0}`}
                                        </small>
                                    )}
                                    {props.openedPaths.has(change.relPath) ? (
                                        <small className="change-seen">열어봄 ✓</small>
                                    ) : null}
                                    {noteCount > 0 ? <small className="change-notes">{`✎ ${noteCount}`}</small> : null}
                                </button>
                                {open ? (
                                    <ul className="hunk-list">
                                        {(hunks[change.relPath] ?? []).length === 0 ? (
                                            <li className="muted">바뀐 줄을 읽지 못했다.</li>
                                        ) : (hunks[change.relPath] ?? []).map((hunk, hunkIndex) => (
                                            <li key={`${hunk.newStart}:${hunkIndex}`}>
                                                <button
                                                    type="button"
                                                    onClick={() => props.onOpenFile(
                                                        change.relPath,
                                                        Math.max(0, hunk.newStart - 1),
                                                        0,
                                                    )}
                                                >
                                                    <code>
                                                        {hunk.newCount <= 1
                                                            ? `${hunk.newStart}`
                                                            : `${hunk.newStart}–${hunk.newStart + hunk.newCount - 1}`}
                                                    </code>
                                                    <small>{`+${hunk.newCount} −${hunk.oldCount}`}</small>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            </details>

            <details open={props.symbols.length > 0}>
                <summary>{`문서 심볼 (${props.symbols.length})`}</summary>
                <ul>
                    {props.symbols.map((symbol, index) => (
                        <li key={`${symbol.name}:${symbol.selectionRange.start.line}:${index}`} style={{ paddingInlineStart: `${symbol.depth * 12}px` }}>
                            <button type="button" onClick={() => props.onAddRoot(symbol.selectionRange.start.line, symbol.selectionRange.start.character)}>
                                <code>{symbol.name}</code><small>{symbol.detail || symbol.container}</small>
                            </button>
                        </li>
                    ))}
                </ul>
            </details>

            <details>
                <summary>내용 검색</summary>
                <form onSubmit={(event) => { event.preventDefault(); search(); }}>
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="일반 문자열 검색" />
                    <input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="범위(상대경로, 선택)" />
                    <label><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /> 대소문자 구분</label>
                    <button type="submit" disabled={query.trim().length < 2}>{busy ? '다시 검색' : '검색'}</button>
                    {busy ? <button type="button" onClick={() => searchController.current?.abort()}>취소</button> : null}
                </form>
                {truncated ? <p className="muted">결과 또는 검색 파일 제한에 도달해 일부만 표시한다.</p> : null}
                <ul>
                    {matches.map((match, index) => (
                        <li key={`${match.relPath}:${match.line}:${match.char}:${index}`}>
                            <button type="button" onClick={() => props.onOpenFile(match.relPath, match.line, match.char)}>
                                <code>{`${match.relPath}:${match.line + 1}`}</code><small>{match.preview}</small>
                            </button>
                        </li>
                    ))}
                </ul>
            </details>
        </div>
    );
}
