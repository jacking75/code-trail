import { useState, type JSX } from 'react';

import { ConfirmPopover } from './ConfirmPopover.js';
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
    /** 활성 트레일이 디스크에 남았는지. 앱 바에 한 줄로 보여준다(U19). */
    saveState: 'saved' | 'saving' | 'none';
    /** 이 트레일을 대상으로 한 분석 기록 수. 삭제 확인 문구에 넣는다. */
    annotationCount: number;
    onSelect: (trailId: string) => void;
    onCreate: () => void;
    onRename: (title: string) => void;
    onDelete: () => void;
}

export function TrailBar(props: TrailBarProps): JSX.Element {
    const [renaming, setRenaming] = useState<string | null>(null);
    const [confirming, setConfirming] = useState(false);
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
                <span className="toolbar-confirm">
                    <button
                        type="button"
                        className="danger"
                        onClick={() => setConfirming((open) => !open)}
                        title="이 트레일을 지운다"
                    >
                        ✕ 트레일
                    </button>
                    {confirming ? (
                        <ConfirmPopover
                            message={`트레일 『${active.title}』(노드 ${active.nodeCount}개)를 지운다.`
                                + (props.annotationCount > 0
                                    ? ` 이 트레일을 대상으로 한 분석 기록 ${props.annotationCount}개는`
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
                </span>
            )}

            {active === null || props.saveState === 'none' ? null : (
                <span className="save-state" role="status">
                    {props.saveState === 'saved' ? '저장됨' : '저장 중…'}
                </span>
            )}
        </div>
    );
}
