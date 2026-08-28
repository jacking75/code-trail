import { useState, type JSX } from 'react';

import type { TrailSummaryView } from './types.js';

/**
 * 트레일 목록과 관리 (구현서 15.1).
 *
 * 확장의 `저장` / `불러오기` 버튼을 대신한다. 파일 대화상자는 없다 —
 * 트레일은 `.code-trail/trails/` 에 자동으로 저장되고, 여기서는 고르고 만들고
 * 이름을 바꾸고 지운다.
 */

export interface TrailBarProps {
    trails: TrailSummaryView[];
    activeTrailId: string | null;
    onSelect: (trailId: string) => void;
    onCreate: () => void;
    onRename: (title: string) => void;
    onDelete: () => void;
}

export function TrailBar(props: TrailBarProps): JSX.Element {
    const [renaming, setRenaming] = useState<string | null>(null);
    const active = props.trails.find((t) => t.id === props.activeTrailId) ?? null;

    return (
        <div className="trail-bar">
            <label className="trail-pick">
                <span className="muted">트레일</span>
                <select
                    value={props.activeTrailId ?? ''}
                    aria-label="트레일 고르기"
                    onChange={(event) => props.onSelect(event.target.value)}
                    disabled={props.trails.length === 0}
                >
                    {props.trails.length === 0 ? <option value="">없음</option> : null}
                    {props.trails.map((trail) => (
                        <option key={trail.id} value={trail.id}>
                            {`${trail.title} (${trail.nodeCount})`}
                        </option>
                    ))}
                </select>
            </label>

            <button type="button" onClick={props.onCreate} title="새 트레일 만들기">＋ 새 트레일</button>

            {active === null ? null : renaming === null ? (
                <button
                    type="button"
                    onClick={() => setRenaming(active.title)}
                    title="트레일 이름 바꾸기"
                >
                    ✎ 이름
                </button>
            ) : (
                <form
                    className="rename"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const title = renaming.trim();
                        if (title !== '') {
                            props.onRename(title);
                        }
                        setRenaming(null);
                    }}
                >
                    <input
                        value={renaming}
                        aria-label="트레일 이름"
                        autoFocus
                        onChange={(event) => setRenaming(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') {
                                setRenaming(null);
                            }
                        }}
                    />
                    <button type="submit">저장</button>
                </form>
            )}

            {active === null ? null : (
                <button
                    type="button"
                    className="danger"
                    onClick={props.onDelete}
                    title="이 트레일을 지운다"
                >
                    ✕ 트레일
                </button>
            )}
        </div>
    );
}
