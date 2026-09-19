import { useState, type FormEvent, type JSX, type KeyboardEvent } from 'react';

import { KIND_LABEL, type AnnotationKind } from './AnnotationItem.js';

/**
 * 기록 작성 칸 (U11, U12).
 *
 * 분석 기록 화면과 기록 열이 같은 것을 쓴다.
 *
 * **분석이 없어도 보인다.** 예전에는 분석을 먼저 만들어야 작성 칸이 나왔고,
 * 첫 기록까지 네 단계였다. 지금은 저장하는 순간 필요한 분석이 생긴다.
 */

export type ComposerTargetKind = 'trail' | 'node' | 'range';

export interface AnnotationComposerProps {
    targetKind: ComposerTargetKind;
    onTargetKind: (kind: ComposerTargetKind) => void;
    /** 지금 대상이 무엇인지 글자로. 없으면 왜 없는지 적는다. */
    targetLabel: string;
    nodeAvailable: boolean;
    rangeAvailable: boolean;
    readOnly: boolean;
    /** 초안 복구용. 바깥이 들고 있다가 되돌려준다. */
    body: string;
    onBody: (body: string) => void;
    onSubmit: (value: { body: string; kind: AnnotationKind; tags: string[] }) => void;
    /** 저장할 수 있는 상태인지. 대상이 없으면 누를 수 없다. */
    canSubmit: boolean;
    /** 이 분석에 이미 쓰인 태그. 매번 손으로 치지 않게 한다(V15). */
    tagSuggestions?: readonly string[];
}

export function AnnotationComposer(props: AnnotationComposerProps): JSX.Element {
    const [kind, setKind] = useState<AnnotationKind>('explanation');
    const [tags, setTags] = useState('');

    const submit = (event?: FormEvent): void => {
        event?.preventDefault();
        if (!props.canSubmit || !props.body.trim()) {
            return;
        }
        props.onSubmit({
            body: props.body,
            kind,
            tags: tags.split(',').map((value) => value.trim()).filter(Boolean),
        });
        setTags('');
    };

    const editorKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            submit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            props.onBody('');
        }
    };

    return (
        <form className="annotation-composer" onSubmit={submit}>
            <div className="composer-row">
                <select
                    value={props.targetKind}
                    aria-label="기록 대상"
                    onChange={(event) => props.onTargetKind(event.target.value as ComposerTargetKind)}
                >
                    <option value="trail">트레일 전체</option>
                    <option value="node" disabled={!props.nodeAvailable}>현재 노드</option>
                    <option value="range" disabled={!props.rangeAvailable}>선택한 코드 범위</option>
                </select>
                <select
                    value={kind}
                    aria-label="기록 종류"
                    onChange={(event) => setKind(event.target.value as AnnotationKind)}
                >
                    {(Object.keys(KIND_LABEL) as AnnotationKind[]).map((value) => (
                        <option key={value} value={value}>{KIND_LABEL[value]}</option>
                    ))}
                </select>
            </div>
            <small className="composer-target">{props.targetLabel}</small>
            <textarea
                value={props.body}
                aria-label="기록 본문"
                onChange={(event) => props.onBody(event.target.value)}
                onKeyDown={editorKey}
                placeholder="설명·질문·우려·결론을 남긴다. Ctrl+Enter로 저장한다."
                disabled={props.readOnly}
            />
            <input
                value={tags}
                aria-label="태그"
                list="composer-tags"
                onChange={(event) => setTags(event.target.value)}
                placeholder="태그, 쉼표로 구분"
                disabled={props.readOnly}
            />
            <datalist id="composer-tags">
                {(props.tagSuggestions ?? []).map((tag) => <option key={tag} value={tag} />)}
            </datalist>
            <button type="submit" disabled={props.readOnly || !props.canSubmit || !props.body.trim()}>
                기록 저장
            </button>
        </form>
    );
}
