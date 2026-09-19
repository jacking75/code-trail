import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { ConfirmPopover } from './ConfirmPopover.js';
import type { TrailSummaryView } from './types.js';

/**
 * 트레일 목록 (V22).
 *
 * 앱 바의 셀렉트를 대신한다. 셀렉트는 `제목 (노드 수)` 한 줄뿐이라 트레일이
 * 열 개를 넘으면 무엇이 최신인지, 어디에 기록이 달렸는지 알 수 없었다.
 *
 * 앱 바 자리는 그대로 `트레일 ▾ <제목>` 한 버튼이고 누르면 이 팝오버가 뜬다.
 */

export interface TrailListProps {
    trails: TrailSummaryView[];
    activeTrailId: string | null;
    /** 트레일별 기록 수. `App` 이 분석의 `trailIds` 로 합산해 넘긴다. */
    noteCounts: ReadonlyMap<string, number>;
    onSelect: (trailId: string) => void;
    onCreate: () => void;
    onRename: (title: string) => void;
    onDelete: () => void;
    onDismiss: () => void;
}

type SortBy = 'recent' | 'name';

function relative(iso: string | undefined): string {
    if (iso === undefined) return '';
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return '';
    const minutes = Math.floor((Date.now() - at) / 60_000);
    if (minutes < 1) return '방금';
    if (minutes < 60) return `${minutes}분 전`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}시간 전`;
    return `${Math.floor(hours / 24)}일 전`;
}

export function TrailList(props: TrailListProps): JSX.Element {
    const [query, setQuery] = useState('');
    const [sortBy, setSortBy] = useState<SortBy>('recent');
    const [renaming, setRenaming] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
    const boxRef = useRef<HTMLDivElement | null>(null);
    const { onDismiss } = props;

    useEffect(() => {
        const onPointer = (event: MouseEvent): void => {
            if (!boxRef.current?.contains(event.target as Node)) onDismiss();
        };
        window.addEventListener('mousedown', onPointer, true);
        return () => window.removeEventListener('mousedown', onPointer, true);
    }, [onDismiss]);

    const rows = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const filtered = props.trails.filter(
            (trail) => needle === '' || trail.title.toLowerCase().includes(needle),
        );
        return [...filtered].sort((a, b) => (sortBy === 'name'
            ? a.title.localeCompare(b.title)
            : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')));
    }, [props.trails, query, sortBy]);

    const active = props.trails.find((trail) => trail.id === props.activeTrailId) ?? null;

    return (
        <div
            className="trail-list"
            role="dialog"
            aria-label="트레일 목록"
            ref={boxRef}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    onDismiss();
                }
            }}
        >
            <div className="trail-list-tools">
                <button type="button" onClick={props.onCreate}>＋ 새 트레일</button>
                <input
                    type="search"
                    autoFocus
                    aria-label="트레일 이름 검색"
                    placeholder="이름 검색…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                />
                <select
                    aria-label="트레일 정렬"
                    value={sortBy}
                    onChange={(event) => setSortBy(event.target.value as SortBy)}
                >
                    <option value="recent">최근 수정</option>
                    <option value="name">이름</option>
                </select>
            </div>

            <ul className="trail-list-rows">
                {rows.length === 0 ? <li className="muted">해당하는 트레일이 없다.</li> : null}
                {rows.map((trail) => (
                    <li key={trail.id} className={trail.id === props.activeTrailId ? 'active' : ''}>
                        <button
                            type="button"
                            className="trail-list-pick"
                            onClick={() => {
                                props.onSelect(trail.id);
                                onDismiss();
                            }}
                        >
                            <strong>{trail.title}</strong>
                            <small>
                                {`노드 ${trail.nodeCount}`}
                                {(props.noteCounts.get(trail.id) ?? 0) > 0
                                    ? ` · ✎ ${props.noteCounts.get(trail.id)}` : ''}
                                {trail.updatedAt ? ` · ${relative(trail.updatedAt)}` : ''}
                            </small>
                        </button>
                        {trail.id === props.activeTrailId ? (
                            <button
                                type="button"
                                aria-label="트레일 이름 바꾸기"
                                title="이름 바꾸기"
                                onClick={() => setRenaming(trail.title)}
                            >
                                ✎
                            </button>
                        ) : null}
                    </li>
                ))}
            </ul>

            {renaming === null ? null : (
                <form
                    className="rename"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const title = renaming.trim();
                        if (title !== '') props.onRename(title);
                        setRenaming(null);
                    }}
                >
                    <input
                        value={renaming}
                        aria-label="트레일 이름"
                        autoFocus
                        onChange={(event) => setRenaming(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') setRenaming(null);
                        }}
                    />
                    <button type="submit">저장</button>
                </form>
            )}

            {active === null ? null : (
                <div className="toolbar-confirm">
                    <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirming((open) => !open)}
                    >
                        {`✕ 『${active.title}』 지우기`}
                    </button>
                    {confirming ? (
                        <ConfirmPopover
                            message={`트레일 『${active.title}』(노드 ${active.nodeCount}개)를 지운다.`
                                + ((props.noteCounts.get(active.id) ?? 0) > 0
                                    ? ` 이 트레일을 대상으로 한 분석 기록 ${props.noteCounts.get(active.id)}개는`
                                        + ' 남지만 트레일 대상 링크는 끊긴다.'
                                    : ' 되돌릴 수 없다.')}
                            confirmLabel="지운다"
                            onConfirm={() => {
                                setConfirming(false);
                                props.onDelete();
                            }}
                            onCancel={() => setConfirming(false)}
                        />
                    ) : null}
                </div>
            )}
        </div>
    );
}
