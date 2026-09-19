import { useState, type JSX } from 'react';

/**
 * 안내 순서 편집 (V14).
 *
 * 예전에는 `현재 기록 순서로 만들기` 한 번과 위아래 이동만 됐다. 단계를 더 넣거나,
 * 기록 없이 노드만 가리키는 단계를 만들거나, 제목을 고칠 수 없었다.
 * `walkthrough.update` 는 이미 임의의 `steps` 를 받는다 — 없던 것은 화면뿐이다.
 *
 * 삭제에는 확인을 붙이지 않는다. 되돌리기 알림이 이전 배열을 그대로 다시 보낸다 —
 * 단계는 구조가 아니라 목록이라 화면이 들고 있는 것으로 충분하다.
 */

export interface WalkthroughStepEdit {
    id: string;
    title: string;
    body: string;
    annotationId: string | null;
    target: Record<string, unknown> | null;
    baselineId: string | null;
}

export interface WalkthroughView {
    id: string;
    version: number;
    title: string;
    steps: WalkthroughStepEdit[];
}

export interface WalkthroughEditorProps {
    walkthroughs: WalkthroughView[];
    readOnly: boolean;
    /** 기록이 하나도 없으면 `현재 기록 순서로 만들기` 를 끈다. */
    hasAnnotations: boolean;
    /** 지금 가리킬 수 있는 곳이 있는지. 활성 노드나 선택 범위다. */
    canAddHere: boolean;
    stepHref: (walkthroughId: string, stepId: string) => string;
    onCreate: () => void;
    onUpdate: (walkthrough: WalkthroughView) => void;
    /** 단계를 눌렀다. 그 대상으로 간다. */
    onOpenStep: (walkthroughId: string, stepIndex: number) => void;
    /** `따라 읽기` — 재생 막대를 연다(V13). */
    onPlay: (walkthroughId: string) => void;
    /** `현재 위치를 단계로 추가`. 대상은 `App` 이 정한다. */
    onAddCurrent: (walkthroughId: string | null) => void;
}

export function WalkthroughEditor(props: WalkthroughEditorProps): JSX.Element {
    const [editing, setEditing] = useState<{ id: string; title: string; body: string } | null>(null);

    const move = (walkthrough: WalkthroughView, index: number, delta: -1 | 1): void => {
        const steps = [...walkthrough.steps];
        const other = steps[index + delta];
        const current = steps[index];
        if (other === undefined || current === undefined) return;
        steps[index] = other;
        steps[index + delta] = current;
        props.onUpdate({ ...walkthrough, steps });
    };

    return (
        <section className="walkthrough-section">
            <h3>안내 순서</h3>
            {props.walkthroughs.map((walkthrough) => (
                <div key={walkthrough.id}>
                    <div className="walkthrough-head">
                        <strong>{walkthrough.title}</strong>
                        <button
                            type="button"
                            disabled={walkthrough.steps.length === 0}
                            onClick={() => props.onPlay(walkthrough.id)}
                        >
                            따라 읽기
                        </button>
                        <button
                            type="button"
                            disabled={props.readOnly || !props.canAddHere}
                            title={props.canAddHere
                                ? '활성 노드나 선택 범위를 단계로 더한다'
                                : '노드를 고르거나 코드를 선택한 뒤 누른다'}
                            onClick={() => props.onAddCurrent(walkthrough.id)}
                        >
                            현재 위치를 단계로 추가
                        </button>
                    </div>
                    {walkthrough.steps.map((step, index) => (
                        <div
                            className="walkthrough-row"
                            key={step.id}
                            id={props.stepHref(walkthrough.id, step.id).slice(1)}
                            tabIndex={-1}
                        >
                            {editing?.id === step.id ? (
                                <form
                                    className="inline-edit"
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        const steps = walkthrough.steps.map((item) => (
                                            item.id === step.id
                                                ? { ...item, title: editing.title.trim() || item.title, body: editing.body }
                                                : item));
                                        props.onUpdate({ ...walkthrough, steps });
                                        setEditing(null);
                                    }}
                                >
                                    <input
                                        autoFocus
                                        aria-label="단계 제목"
                                        value={editing.title}
                                        onChange={(event) => setEditing({ ...editing, title: event.target.value })}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Escape') setEditing(null);
                                        }}
                                    />
                                    <textarea
                                        aria-label="단계 설명"
                                        value={editing.body}
                                        onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                                        onKeyDown={(event) => {
                                            if (event.nativeEvent.isComposing) return;
                                            if (event.key === 'Escape') setEditing(null);
                                            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                                event.currentTarget.form?.requestSubmit();
                                            }
                                        }}
                                    />
                                    <button type="submit">저장</button>
                                    <button type="button" onClick={() => setEditing(null)}>취소</button>
                                </form>
                            ) : (
                                <>
                                    <button
                                        className="walkthrough-step"
                                        type="button"
                                        onClick={() => props.onOpenStep(walkthrough.id, index)}
                                    >
                                        <b>{`${index + 1}. ${step.title}`}</b>
                                        <span>{step.body}</span>
                                    </button>
                                    <a
                                        className="internal-reference"
                                        href={props.stepHref(walkthrough.id, step.id)}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            props.onOpenStep(walkthrough.id, index);
                                        }}
                                    >
                                        단계 링크
                                    </a>
                                    <button
                                        type="button"
                                        aria-label="단계 수정"
                                        disabled={props.readOnly}
                                        onClick={() => setEditing({ id: step.id, title: step.title, body: step.body })}
                                    >
                                        ✎
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="앞 단계로 옮기기"
                                        disabled={props.readOnly || index === 0}
                                        onClick={() => move(walkthrough, index, -1)}
                                    >
                                        ↑
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="뒤 단계로 옮기기"
                                        disabled={props.readOnly || index === walkthrough.steps.length - 1}
                                        onClick={() => move(walkthrough, index, 1)}
                                    >
                                        ↓
                                    </button>
                                    <button
                                        type="button"
                                        aria-label="단계 지우기"
                                        disabled={props.readOnly}
                                        onClick={() => props.onUpdate({
                                            ...walkthrough,
                                            steps: walkthrough.steps.filter((item) => item.id !== step.id),
                                        })}
                                    >
                                        ✕
                                    </button>
                                </>
                            )}
                        </div>
                    ))}
                </div>
            ))}
            <button
                type="button"
                disabled={props.readOnly || !props.hasAnnotations}
                onClick={props.onCreate}
            >
                현재 기록 순서로 만들기
            </button>
            {props.walkthroughs.length === 0 ? (
                <button
                    type="button"
                    disabled={props.readOnly || !props.canAddHere}
                    onClick={() => props.onAddCurrent(null)}
                >
                    현재 위치로 새 안내 순서 시작
                </button>
            ) : null}
        </section>
    );
}
