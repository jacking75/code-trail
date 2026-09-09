import { useEffect, useRef, useState, type JSX } from 'react';

import { api, type DocumentContent } from '../../api/http.js';

export interface ReadingStartsProps {
    document: DocumentContent | null;
    onOpenFile: (relPath: string, line?: number, char?: number) => void;
    onAddRoot: (line: number, char: number) => void;
}

export function ReadingStarts(props: ReadingStartsProps): JSX.Element {
    const [changes, setChanges] = useState<Array<{ relPath: string; status: string; area: string; addedLines: number | null; deletedLines: number | null }>>([]);
    const [symbols, setSymbols] = useState<Array<{ name: string; detail: string; container: string; kind: number; depth: number; selectionRange: { start: { line: number; character: number } } }>>([]);
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<Array<{ relPath: string; line: number; char: number; preview: string }>>([]);
    const [busy, setBusy] = useState(false);
    const [scope, setScope] = useState('');
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [truncated, setTruncated] = useState(false);
    const searchController = useRef<AbortController | null>(null);

    useEffect(() => {
        void api.changes().then((value) => setChanges(value.changes)).catch(() => setChanges([]));
    }, []);

    useEffect(() => {
        if (!props.document) { setSymbols([]); return; }
        let cancelled = false;
        const controller = new AbortController();
        void api.documentSymbols(props.document.documentId, controller.signal)
            .then((value) => { if (!cancelled) setSymbols(value.symbols); })
            .catch(() => { if (!cancelled) setSymbols([]); });
        return () => { cancelled = true; controller.abort(); };
    }, [props.document]);

    useEffect(() => () => searchController.current?.abort(), []);

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
                <summary>{`변경 목록 (${changes.length})`}</summary>
                <ul>
                    {changes.slice(0, 100).map((change, index) => (
                        <li key={`${change.area}:${change.relPath}:${index}`}>
                            <button type="button" onClick={() => props.onOpenFile(change.relPath)}>
                                <span>{change.status}</span><code>{change.relPath}</code><small>{change.area}</small>
                            </button>
                        </li>
                    ))}
                </ul>
            </details>

            <details open={symbols.length > 0}>
                <summary>{`문서 심볼 (${symbols.length})`}</summary>
                <ul>
                    {symbols.map((symbol, index) => (
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
