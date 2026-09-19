import { useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';

/**
 * 기록 카드 하나 (U13).
 *
 * 분석 기록 화면과 기록 열이 **같은 컴포넌트**를 쓴다. 두 벌을 두면 한쪽만
 * 고치는 실수가 반드시 생기고, 편집 방식이 화면마다 달라진다.
 *
 * 수정은 카드 안에서 한다. `window.prompt` 는 여러 줄 기록을 한 줄 입력창에
 * 밀어 넣어 줄바꿈을 잃는다.
 */

export type AnnotationKind = 'explanation' | 'question' | 'concern' | 'conclusion';

export const KIND_LABEL: Record<AnnotationKind, string> = {
    explanation: '설명',
    question: '질문',
    concern: '우려',
    conclusion: '결론',
};

export interface AnnotationItemValue {
    id: string;
    version: number;
    kind: AnnotationKind;
    body: string;
    tags: string[];
    status: 'open' | 'resolved';
    deletedAt: string | null;
}

/** 기록에서 코드로 가는 길. 대상 종류마다 하나 이상 있다. */
export interface TargetLink {
    label: string;
    run: () => void;
}

export interface AnnotationItemProps {
    annotation: AnnotationItemValue;
    authorName: string;
    replies: Array<{ id: string; body: string }>;
    readOnly: boolean;
    /** 카드 앵커. 기록 링크가 가리키는 자리다. */
    anchorId: string;
    targetLinks: TargetLink[];
    referenceHref: string;
    onFocusReference: (href: string) => void;
    onUpdate: (patch: Record<string, unknown>) => void;
    onDelete: () => void;
    onRestore: () => void;
    onReply: (body: string) => void;
    /** 범위·노드 대상에 있다. `onCompare` 는 범위 대상에만 있다(V02). */
    review?: { state: string; onChange: (state: string) => void; onCompare?: () => void };
    /** 이 분석에 이미 쓰인 태그. 태그 칸의 `<datalist>` 가 쓴다(V15). */
    tagSuggestions?: readonly string[];
    /** 코드 비교 같은 덧붙이는 내용. */
    children?: ReactNode;
}

export function AnnotationItem(props: AnnotationItemProps): JSX.Element {
    const { annotation } = props;
    const [editing, setEditing] = useState(false);
    const [draftBody, setDraftBody] = useState(annotation.body);
    const [draftKind, setDraftKind] = useState<AnnotationKind>(annotation.kind);
    const [draftTags, setDraftTags] = useState(annotation.tags.join(', '));
    const [replying, setReplying] = useState(false);
    const [replyBody, setReplyBody] = useState('');

    const beginEdit = (): void => {
        setDraftBody(annotation.body);
        setDraftKind(annotation.kind);
        setDraftTags(annotation.tags.join(', '));
        setEditing(true);
    };

    const save = (): void => {
        if (!draftBody.trim()) {
            return;
        }
        props.onUpdate({
            body: draftBody,
            kind: draftKind,
            tags: draftTags.split(',').map((value) => value.trim()).filter(Boolean),
        });
        setEditing(false);
    };

    const editorKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            save();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(false);
        }
    };

    return (
        <article
            id={props.anchorId}
            tabIndex={-1}
            className={`annotation-item${annotation.deletedAt ? ' deleted' : ''}${editing ? ' editing' : ''}`}
        >
            <header>
                <span className={`annotation-kind k-${annotation.kind}`}>
                    {KIND_LABEL[annotation.kind]}
                </span>
                <span>{props.authorName}</span>
                {props.targetLinks.map((link) => (
                    <button
                        key={link.label}
                        type="button"
                        className="target-link"
                        onClick={link.run}
                    >
                        {link.label}
                    </button>
                ))}
                <span>{`v${annotation.version}`}</span>
            </header>

            {editing ? (
                <div className="annotation-edit">
                    <select
                        value={draftKind}
                        aria-label="기록 종류"
                        onChange={(event) => setDraftKind(event.target.value as AnnotationKind)}
                    >
                        {(Object.keys(KIND_LABEL) as AnnotationKind[]).map((kind) => (
                            <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>
                        ))}
                    </select>
                    <textarea
                        value={draftBody}
                        aria-label="기록 본문"
                        onChange={(event) => setDraftBody(event.target.value)}
                        onKeyDown={editorKey}
                    />
                    <input
                        value={draftTags}
                        aria-label="태그"
                        placeholder="태그, 쉼표로 구분"
                        list={`tags-${props.anchorId}`}
                        onChange={(event) => setDraftTags(event.target.value)}
                    />
                    {/* 이미 쓴 태그를 다시 치지 않게 한다(V15). */}
                    <datalist id={`tags-${props.anchorId}`}>
                        {(props.tagSuggestions ?? []).map((tag) => <option key={tag} value={tag} />)}
                    </datalist>
                    <div className="annotation-edit-row">
                        <button type="button" onClick={save} disabled={!draftBody.trim()}>
                            저장
                        </button>
                        <button type="button" onClick={() => setEditing(false)}>취소</button>
                        <small className="muted">Ctrl+Enter 저장 · Esc 취소</small>
                    </div>
                </div>
            ) : (
                <p>{annotation.body}</p>
            )}

            {annotation.tags.length > 0 && !editing ? (
                <div className="tags">{annotation.tags.map((tag) => <span key={tag}>{`#${tag}`}</span>)}</div>
            ) : null}

            {props.replies.map((reply) => <blockquote key={reply.id}>{reply.body}</blockquote>)}

            <footer>
                {(annotation.kind === 'question' || annotation.kind === 'concern')
                    && annotation.deletedAt === null ? (
                        <button
                            type="button"
                            disabled={props.readOnly}
                            onClick={() => props.onUpdate({
                                status: annotation.status === 'open' ? 'resolved' : 'open',
                            })}
                        >
                            {annotation.status === 'open' ? '해결로 표시' : '다시 열기'}
                        </button>
                    ) : null}
                <button
                    type="button"
                    disabled={props.readOnly || annotation.deletedAt !== null}
                    onClick={beginEdit}
                >
                    수정
                </button>
                <button
                    type="button"
                    disabled={props.readOnly || annotation.deletedAt !== null}
                    onClick={() => setReplying(true)}
                >
                    답글
                </button>
                {annotation.deletedAt === null ? (
                    <button type="button" disabled={props.readOnly} onClick={props.onDelete}>삭제</button>
                ) : (
                    <button type="button" disabled={props.readOnly} onClick={props.onRestore}>복원</button>
                )}
                <a
                    className="internal-reference"
                    href={props.referenceHref}
                    onClick={(event) => {
                        event.preventDefault();
                        props.onFocusReference(props.referenceHref);
                    }}
                >
                    기록 링크
                </a>
                {props.review ? (
                    <>
                        {props.review.onCompare === undefined ? null : (
                            <button type="button" onClick={props.review.onCompare}>코드 비교</button>
                        )}
                        <select
                            aria-label="검토 상태"
                            disabled={props.readOnly}
                            value={props.review.state}
                            onChange={(event) => props.review?.onChange(event.target.value)}
                        >
                            <option value="unreviewed">미검토</option>
                            <option value="reviewing">확인 중</option>
                            <option value="reviewed">확인함</option>
                            <option value="needsReview">재검토 필요</option>
                        </select>
                    </>
                ) : null}
            </footer>

            {props.children}

            {replying ? (
                <form
                    className="reply-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (replyBody.trim()) {
                            props.onReply(replyBody);
                        }
                        setReplyBody('');
                        setReplying(false);
                    }}
                >
                    <textarea
                        autoFocus
                        value={replyBody}
                        aria-label="답글 본문"
                        onChange={(event) => setReplyBody(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.nativeEvent.isComposing) return;
                            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                                event.preventDefault();
                                if (replyBody.trim()) props.onReply(replyBody);
                                setReplyBody('');
                                setReplying(false);
                            } else if (event.key === 'Escape') {
                                event.preventDefault();
                                setReplyBody('');
                                setReplying(false);
                            }
                        }}
                    />
                    <button type="submit">답글 저장</button>
                    <button type="button" onClick={() => setReplying(false)}>취소</button>
                </form>
            ) : null}
        </article>
    );
}
