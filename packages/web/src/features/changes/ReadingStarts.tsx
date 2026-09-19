import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { api, type ChangeBaseView, type DocumentContent, type GitHunkView } from '../../api/http.js';
import { reviewForRange, type AnnotationIndex } from '../trail/annotationIndex.js';

/**
 * 읽기 시작점.
 *
 * 변경 목록 · 문서 심볼 · 제한된 내용 검색 셋을 사이드바 아래에 둔다.
 *
 * **리뷰의 시작점은 파일이 아니라 hunk 다** (U14). 파일 줄을 펼치면 바뀐 줄
 * 덩어리가 나오고, 그 줄에서 바로 연다. 파일 첫 줄로 열면 바뀐 곳을 다시
 * 찾아 내려가야 한다.
 *
 * **무엇과 비교하는지는 변경 기준이 정한다** (V01). 작업 트리만 보면 커밋한
 * 뒤에는 목록이 비어 리뷰를 이어갈 시작점이 사라진다.
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

export interface ChangeRefsView {
    repository: boolean;
    currentBranch: string | null;
    defaultBranch: string | null;
    branches: string[];
    commits: Array<{ hash: string; shortHash: string; subject: string }>;
}

export interface ReadingStartsProps {
    document: DocumentContent | null;
    changes: ChangeEntry[];
    /** `App` 이 들고 있는 문서 심볼. 요청은 문서마다 한 번뿐이다. */
    symbols: DocumentSymbolEntry[];
    /** 이 문서에 심볼 해석이 되는지. 아니면 `▶` 를 숨긴다(V06). */
    symbolsSupported: boolean;
    /** 커서를 감싸는 심볼의 시작 줄. 그 줄을 강조한다(V06). */
    enclosingLine: number | null;
    /** 이동 이력에 있는 파일. `열어봄 ✓` 을 붙인다. */
    openedPaths: ReadonlySet<string>;
    /** 파일별 기록 수. 활성 분석의 색인에서 온다. */
    noteCounts: ReadonlyMap<string, number>;
    /** 검토 표시를 판정할 색인 (V03). */
    annotations: AnnotationIndex;
    /** 지금 무엇과 비교하는지 (V01). */
    changeBase: ChangeBaseView;
    refs: ChangeRefsView | null;
    onChangeBase: (base: ChangeBaseView) => void;
    onOpenFile: (relPath: string, line?: number, char?: number) => void;
    /** `▶` 로 루트 만들기. 목록을 훑는 클릭과 구분한다(V06). */
    onAddRoot: (line: number, char: number) => void;
    /** hunk 의 `☐/☑`. 그 줄 범위를 확인함으로 남긴다(V03). */
    onToggleHunkReview: (relPath: string, hunk: GitHunkView, reviewed: boolean) => void;
}

/** 변경 기준 셀렉트의 항목 하나. `value` 는 화면 안에서만 쓰는 키다. */
interface BaseOption {
    value: string;
    label: string;
    base: ChangeBaseView;
}

function buildOptions(refs: ChangeRefsView | null): BaseOption[] {
    const working: BaseOption = {
        value: 'working',
        label: '작업 트리',
        base: { mode: 'working', from: null, to: null, mergeBase: false, label: '작업 트리' },
    };
    if (refs === null || !refs.repository) return [working];
    const options = [working];
    // 추천을 맨 위에 둔다 — 브랜치 전체 리뷰가 가장 잦은 시작점이다.
    if (refs.currentBranch !== null && refs.defaultBranch !== null
        && refs.currentBranch !== refs.defaultBranch) {
        const label = `${refs.currentBranch} ← ${refs.defaultBranch} (갈라진 지점부터)`;
        options.push({
            value: `merge:${refs.defaultBranch}`,
            label,
            base: {
                mode: 'between',
                from: refs.defaultBranch,
                to: refs.currentBranch,
                mergeBase: true,
                label,
            },
        });
    }
    for (const branch of refs.branches) {
        if (branch === refs.currentBranch) continue;
        const label = `${branch} 이후 작업 트리`;
        options.push({
            value: `branch:${branch}`,
            label,
            base: { mode: 'since', from: branch, to: null, mergeBase: false, label },
        });
    }
    for (const commit of refs.commits) {
        const label = `${commit.shortHash} ${commit.subject}`.slice(0, 60);
        options.push({
            value: `commit:${commit.hash}`,
            label: `${label} 이후`,
            base: { mode: 'since', from: commit.hash, to: null, mergeBase: false, label },
        });
    }
    return options;
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
    const [symbolFilter, setSymbolFilter] = useState('');
    const searchController = useRef<AbortController | null>(null);

    useEffect(() => () => searchController.current?.abort(), []);

    // 기준이 바뀌면 받아 둔 hunk 는 더 이상 그 기준의 것이 아니다.
    const baseKey = `${props.changeBase.mode}:${props.changeBase.from ?? ''}:${props.changeBase.to ?? ''}`;
    useEffect(() => {
        setHunks({});
        setExpanded(null);
    }, [baseKey]);

    const options = useMemo(() => buildOptions(props.refs), [props.refs]);
    const selected = options.find((option) => option.base.mode === props.changeBase.mode
        && option.base.from === props.changeBase.from
        && option.base.to === props.changeBase.to)?.value ?? 'working';

    const toggleHunks = (relPath: string): void => {
        setExpanded((current) => (current === relPath ? null : relPath));
        if (hunks[relPath] !== undefined) {
            return;
        }
        void api.hunks(relPath, props.changeBase)
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

    /** hunk 가 덮는 줄 범위(0-based). 삭제만 된 자리는 앞줄 한 줄로 잡는다. */
    const hunkRange = (hunk: GitHunkView): { start: number; end: number } => {
        if (hunk.newCount === 0) {
            const line = Math.max(0, hunk.newStart - 1);
            return { start: line, end: line };
        }
        return { start: hunk.newStart - 1, end: hunk.newStart + hunk.newCount - 2 };
    };

    const filteredSymbols = props.symbols.filter((symbol) => {
        const needle = symbolFilter.trim().toLowerCase();
        return needle === '' || symbol.name.toLowerCase().includes(needle);
    });

    return (
        <div className="reading-starts">
            <details>
                <summary>{`변경 목록 (${props.changes.length})`}</summary>
                <label className="change-base">
                    <span className="muted">기준</span>
                    <select
                        aria-label="변경 기준"
                        value={selected}
                        disabled={options.length === 1}
                        onChange={(event) => {
                            const option = options.find((item) => item.value === event.target.value);
                            if (option) props.onChangeBase(option.base);
                        }}
                    >
                        {options.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>
                <ul>
                    {props.changes.slice(0, 100).map((change, index) => {
                        const noteCount = props.noteCounts.get(change.relPath) ?? 0;
                        const open = expanded === change.relPath;
                        const fileHunks = hunks[change.relPath] ?? [];
                        const reviewed = fileHunks.filter((hunk) => {
                            const range = hunkRange(hunk);
                            return reviewForRange(props.annotations, change.relPath, range.start, range.end) === 'reviewed';
                        }).length;
                        const deleted = change.status === 'deleted';
                        return (
                            <li key={`${change.area}:${change.relPath}:${index}`} className="change-row">
                                <button
                                    type="button"
                                    className="change-file"
                                    aria-expanded={open}
                                    disabled={deleted}
                                    title={deleted ? '지워진 파일이라 열 수 없다.' : undefined}
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
                                    {fileHunks.length > 0 && reviewed > 0 ? (
                                        <small className="change-reviewed">{`✓ ${reviewed}/${fileHunks.length}`}</small>
                                    ) : null}
                                    {noteCount > 0 ? <small className="change-notes">{`✎ ${noteCount}`}</small> : null}
                                </button>
                                {open ? (
                                    <ul className="hunk-list">
                                        {fileHunks.length === 0 ? (
                                            <li className="muted">바뀐 줄을 읽지 못했다.</li>
                                        ) : fileHunks.map((hunk, hunkIndex) => {
                                            const range = hunkRange(hunk);
                                            const state = reviewForRange(
                                                props.annotations, change.relPath, range.start, range.end,
                                            );
                                            return (
                                                <li key={`${hunk.newStart}:${hunkIndex}`} className="hunk-row">
                                                    <button
                                                        type="button"
                                                        onClick={() => props.onOpenFile(
                                                            change.relPath,
                                                            range.start,
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
                                                    <button
                                                        type="button"
                                                        className={`hunk-review${state === 'reviewed' ? ' on' : ''}${
                                                            state === 'needsReview' ? ' stale' : ''}`}
                                                        aria-pressed={state === 'reviewed'}
                                                        aria-label={`${hunk.newStart}번째 줄 덩어리 확인함`}
                                                        title={hunk.newCount === 0
                                                            ? '지워진 자리 — 앞줄을 기준으로 확인함을 남긴다'
                                                            : state === 'needsReview'
                                                                ? '확인한 뒤 코드가 바뀌었다.'
                                                                : '이 hunk 를 확인함으로 표시'}
                                                        onClick={() => props.onToggleHunkReview(
                                                            change.relPath, hunk, state !== 'reviewed',
                                                        )}
                                                    >
                                                        {state === 'reviewed' ? '☑' : state === 'needsReview' ? '↻' : '☐'}
                                                    </button>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            </details>

            <details open={props.symbols.length > 0}>
                <summary>{`문서 심볼 (${props.symbols.length})`}</summary>
                <input
                    className="symbol-filter"
                    type="search"
                    aria-label="심볼 이름 필터"
                    placeholder="이름 필터…"
                    value={symbolFilter}
                    onChange={(event) => setSymbolFilter(event.target.value)}
                />
                <ul>
                    {filteredSymbols.map((symbol, index) => (
                        <li
                            key={`${symbol.name}:${symbol.selectionRange.start.line}:${index}`}
                            className={props.enclosingLine === symbol.selectionRange.start.line
                                ? 'symbol-row here' : 'symbol-row'}
                            style={{ paddingInlineStart: `${symbol.depth * 12}px` }}
                        >
                            {/*
                              * 줄을 누르면 **이동만** 한다(V06). 목록을 훑어보려던
                              * 클릭이 트레일에 노드를 쌓으면 안 된다.
                              */}
                            <button
                                type="button"
                                onClick={() => props.document && props.onOpenFile(
                                    props.document.relPath,
                                    symbol.selectionRange.start.line,
                                    symbol.selectionRange.start.character,
                                )}
                            >
                                <code>{symbol.name}</code><small>{symbol.detail || symbol.container}</small>
                            </button>
                            {props.symbolsSupported ? (
                                <button
                                    type="button"
                                    className="symbol-root"
                                    title="이 심볼부터 트레일 시작"
                                    aria-label={`${symbol.name} 부터 트레일 시작`}
                                    onClick={() => props.onAddRoot(
                                        symbol.selectionRange.start.line,
                                        symbol.selectionRange.start.character,
                                    )}
                                >
                                    ▶
                                </button>
                            ) : null}
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
