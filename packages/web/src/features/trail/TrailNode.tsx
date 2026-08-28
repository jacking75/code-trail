import { useMemo, type JSX } from 'react';

import type { ClickTarget } from '../../tokenizer/tokenize.js';
import { CodeBody, callSiteKey } from './CodeBody.js';
import {
    circled,
    kindName,
    locationLabel,
    showsContainer,
    splitName,
    type TrailNodeView,
} from './types.js';

/**
 * 노드 하나 (구현서 16.3).
 *
 * 확장의 `renderNode` 를 옮겼다. 화면에 보이는 것의 순서와 이름을 그대로 지킨다 —
 * 헤더는 `종류 · 이름 · 시그니처 · 경로:줄 · 배지 · 버튼` 이고, 그 밑에 진입 링크,
 * 그 밑에 본문, 그 밑에 자식이다.
 *
 * 트리 모드에서는 **부모가 위, 자식이 그 아래 같은 행**에 좌우로 놓인다.
 * 이 배치는 CSS 가 만든다 — 자식을 부모 안에 중첩해 두고 `.kids` 를 가로로 편다.
 */

export interface TrailNodeProps {
    node: TrailNodeView;
    /** 형제 중 몇 번째인지. 부모 호출부의 ①과 짝이 된다. */
    ordinal: number;
    depth: number;
    activeNodeId: string | null;
    busyNodeIds: ReadonlySet<string>;
    clickTarget: ClickTarget;
    maxCodeLines: number;
    childOrder: 'source' | 'click';
    /** 이 언어 서버가 구현 찾기를 지원하는지. 아니면 ⚑ 를 끈다. */
    implementationSupported: boolean;
    /** 필터에 걸린 노드 ID. `null` 이면 필터가 꺼진 것이다. */
    visibleIds: ReadonlySet<string> | null;
    parentName: string;

    onToggle: (node: TrailNodeView) => void;
    onRemove: (node: TrailNodeView) => void;
    onPromote: (node: TrailNodeView) => void;
    onImplementations: (node: TrailNodeView) => void;
    onOpenInEditor: (node: TrailNodeView) => void;
    onJumpToOrigin: (node: TrailNodeView) => void;
    onIdentifierClick: (
        node: TrailNodeView,
        line: number,
        char: number,
        text: string,
        modifiers: { alt: boolean; ctrl: boolean },
    ) => void;
}

/**
 * 형제 정렬.
 *
 * `source` 는 부모 코드에 나온 순서(= 호출 순서), `click` 은 내가 클릭한 순서다.
 * 클릭 순서는 서버가 붙인 순서 그대로라 정렬하지 않는다.
 */
function sortChildren(
    children: readonly TrailNodeView[],
    order: 'source' | 'click',
): TrailNodeView[] {
    if (order === 'click') {
        return [...children];
    }
    return [...children].sort((a, b) => {
        const al = a.origin?.line ?? 0;
        const bl = b.origin?.line ?? 0;
        if (al !== bl) {
            return al - bl;
        }
        return (a.origin?.char ?? 0) - (b.origin?.char ?? 0);
    });
}

export function TrailNode(props: TrailNodeProps): JSX.Element | null {
    const { node } = props;

    if (props.visibleIds !== null && !props.visibleIds.has(node.id)) {
        return null;
    }

    const children = sortChildren(node.children, props.childOrder);
    const parts = splitName(node.symbol);
    const kind = kindName(node.symbol.kind);
    const busy = props.busyNodeIds.has(node.id);

    /**
     * 펼쳐본 호출부에 순번을 붙인다.
     *
     * 부모 본문의 ①과 자식 노드 헤더의 ①이 한 짝이다. 자식이 어느 줄에서
     * 갈라졌는지 눈으로 잇는 유일한 단서다.
     */
    const visited = useMemo(() => {
        const map = new Map<string, number>();
        children.forEach((child, index) => {
            if (child.origin) {
                map.set(callSiteKey(child.origin.line, child.origin.char), index + 1);
            }
        });
        return map;
    }, [children]);

    return (
        <div
            className={`node${node.collapsed ? ' collapsed' : ''}${
                props.activeNodeId === node.id ? ' active' : ''}`}
            data-id={node.id}
            data-parent={node.parentId ?? ''}
            data-depth={props.depth}
        >
            <div
                className="hd"
                onClick={(event) => {
                    // 헤더 버튼을 눌렀으면 접기까지 하지 않는다.
                    if ((event.target as HTMLElement).closest('button')) {
                        return;
                    }
                    props.onToggle(node);
                }}
            >
                <span className="chev">{node.collapsed ? '▸' : '▾'}</span>
                {props.ordinal > 0 ? <span className="idx">{circled(props.ordinal)}</span> : null}
                <span className={`kind k-${kind.replace(/\s+/g, '-')}`}>{kind}</span>

                {showsContainer(node.symbol) ? (
                    <span
                        className="container"
                        title={`이 ${kind} 를 감싸는 ${node.symbol.container}`}
                    >
                        {`${node.symbol.container} ·`}
                    </span>
                ) : null}

                <span className="name" title={node.symbol.name}>{parts.name}</span>
                {children.length > 0 ? <span className="cnt">{`↳ ${children.length}`}</span> : null}
                {parts.sig !== '' ? (
                    <span className="sig" title={parts.sig}>{parts.sig}</span>
                ) : null}
                <span className="loc">{locationLabel(node.symbol)}</span>

                {node.recursive ? <span className="badge rec">재귀</span> : null}
                {node.symbol.declarationOnly ? (
                    <span
                        className="badge decl"
                        title="몸통이 없는 선언이다. ⚑ 를 눌러 실제 구현을 펼친다."
                    >
                        선언만
                    </span>
                ) : null}
                {node.symbol.approximate ? (
                    <span
                        className="badge approx"
                        title="언어 서버가 이 심볼의 전체 범위를 알려주지 않아 주변 몇 줄만 보여준다."
                    >
                        근사
                    </span>
                ) : null}
                {busy ? <span className="badge busy">…</span> : null}

                <span className="spacer" />

                {node.symbol.callable ? (
                    <button
                        type="button"
                        className={`act impl${node.symbol.declarationOnly ? ' hot' : ''}`}
                        data-act="impl"
                        // 언어 서버가 구현 찾기를 지원하지 않으면 눌러도 오류만 난다.
                        // 눌리지 않게 하고 왜 그런지 알려준다.
                        disabled={!props.implementationSupported}
                        title={!props.implementationSupported
                            ? '이 언어 서버는 구현 찾기를 지원하지 않는다.'
                            : node.symbol.declarationOnly
                                ? '구현 보기 — 이 선언을 실제로 구현한 곳들을 자식으로 붙인다'
                                : '구현/재정의 보기'}
                        onClick={() => props.onImplementations(node)}
                    >
                        ⚑
                    </button>
                ) : null}

                {node.parentId !== null ? (
                    <button
                        type="button"
                        className="act"
                        data-act="root"
                        title="새 루트로 떼어내기 — 이 노드를 트리 맨 위로 올린다 (하위 노드도 함께)"
                        onClick={() => props.onPromote(node)}
                    >
                        ⇱
                    </button>
                ) : null}

                <button
                    type="button"
                    className="act"
                    data-act="open"
                    title="에디터에서 열기"
                    onClick={() => props.onOpenInEditor(node)}
                >
                    ↗
                </button>

                <button
                    type="button"
                    className="act"
                    data-act="del"
                    title="이 노드와 하위 노드 삭제"
                    onClick={() => props.onRemove(node)}
                >
                    ✕
                </button>
            </div>

            {node.origin ? (
                <div className="origin">
                    <button
                        type="button"
                        className="origin-link"
                        title="부모의 해당 호출 지점으로 이동"
                        onClick={() => props.onJumpToOrigin(node)}
                    >
                        {`↑ ${props.parentName} 의 `}
                        <code>{`${node.origin.line + 1}번째 줄 ${node.origin.text}`}</code>
                    </button>
                </div>
            ) : null}

            <div className="body">
                <CodeBody
                    symbol={node.symbol}
                    clickTarget={props.clickTarget}
                    maxCodeLines={props.maxCodeLines}
                    visited={visited}
                    onIdentifierClick={(line, char, text, modifiers) =>
                        props.onIdentifierClick(node, line, char, text, modifiers)}
                />
            </div>

            <div className="kids">
                {children.map((child, index) => (
                    <TrailNode
                        {...props}
                        key={child.id}
                        node={child}
                        ordinal={index + 1}
                        depth={props.depth + 1}
                        parentName={parts.name}
                    />
                ))}
            </div>
        </div>
    );
}
