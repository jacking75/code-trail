import { useEffect, useState, type JSX } from 'react';

import { api, type WorkspaceEntry } from '../../api/http.js';

/**
 * 파일 이름 검색.
 *
 * 서버에서 훑는다. 결과에는 상대경로와 파일 ID 만 오고 절대경로는 오지 않는다.
 * 내용 검색이 아니다 — 코드 본문 grep 은 비목표다(구현서 3.2).
 */

export interface FileSearchProps {
    onOpenFile: (relPath: string) => void;
}

export function FileSearch({ onOpenFile }: FileSearchProps): JSX.Element {
    const [query, setQuery] = useState('');
    const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
    const [truncated, setTruncated] = useState(false);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed === '') {
            setEntries([]);
            setTruncated(false);
            return undefined;
        }
        // 타자를 칠 때마다 서버를 훑지 않는다.
        let cancelled = false;
        const timer = window.setTimeout(() => {
            void api
                .search(trimmed)
                .then((result) => {
                    if (!cancelled) {
                        setEntries(result.entries);
                        setTruncated(result.truncated);
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        setEntries([]);
                    }
                });
        }, 200);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [query]);

    return (
        <div className="file-search">
            <input
                type="search"
                value={query}
                placeholder="파일 이름 검색…"
                aria-label="파일 이름 검색"
                onChange={(event) => setQuery(event.target.value)}
            />
            {entries.length > 0 ? (
                <ul className="search-results">
                    {entries.map((entry) => (
                        <li key={entry.id}>
                            <button
                                type="button"
                                className="tree-row tree-file"
                                onClick={() => onOpenFile(entry.id)}
                                title={entry.id}
                            >
                                <span className="search-name">{entry.name}</span>
                                <span className="search-path">{entry.id}</span>
                            </button>
                        </li>
                    ))}
                    {truncated ? <li className="tree-note">결과가 많아 일부만 보인다.</li> : null}
                </ul>
            ) : null}
        </div>
    );
}
