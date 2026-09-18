import { useEffect, useMemo, useRef, type JSX } from 'react';

import type { ClickTarget } from '../../tokenizer/tokenize.js';
import {
    countForNode,
    describeCount,
    marksInRange,
    type AnnotationIndex,
} from './annotationIndex.js';
import { sortChildren, type BoardPoint } from './board.js';
import { CodeBody, callSiteKey } from './CodeBody.js';
import {
    circled,
    kindName,
    locationLabel,
    showsContainer,
    splitName,
    type NodeUiView,
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
 *
 * 보드 모드에서는 자식을 여기서 그리지 않는다. 모든 노드가 캔버스 바로 아래에
 * 평평하게 놓이고, 부모-자식은 `.board-lines` 의 곡선으로만 이어진다.
 * 중첩된 채로 절대 배치를 하면 자식 좌표가 부모 기준이 되어 엉킨다.
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
    /** `board` 면 자식을 여기서 그리지 않고 `position` 자리에 놓는다. */
    layout: 'tree' | 'board';
    /** 보드 모드에서 노드가 놓일 자리. 노드 ID 로 찾는다. */
    positions: Readonly<Record<string, BoardPoint>>;
    /** 노드별로 저장된 본문 높이·코드 글자 크기. */
    nodeUi: Readonly<Record<string, NodeUiView>>;
    /** 활성 분석의 기록 색인. 헤더 배지와 본문 줄 표시가 쓴다(U10). */
    annotations: AnnotationIndex;
    /** 파일이 바뀌어 옛 코드를 보여주고 있는 노드(U08). */
    staleNodeIds: ReadonlySet<string>;

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
    onRangeSelect?: (
        node: TrailNodeView,
        range: {
            start: { line: number; char: number };
            end: { line: number; char: number };
        },
        anchor: { x: number; y: number } | null,
    ) => void;
    /** 본문 높이를 사용자가 바꿨을 때. 값은 서버에 저장된다. */
    onNodeUi: (nodeId: string, patch: { bodyHeight?: number | null }) => void;
    /** 헤더의 `＋` — 이 노드에 기록 남기기(U10). */
    onNote: (node: TrailNodeView) => void;
    /** 헤더의 `✎ N` 배지 — 이 노드의 기록 보기. */
    onShowNotes: (node: TrailNodeView) => void;
    /** 헤더의 `↻` — 현재 코드로 다시 읽기(U08). */
    onRefresh: (node: TrailNodeView) => void;
    /** 본문 줄의 색 띠를 눌렀다. 그 기록으로 간다. */
    onOpenAnnotation: (annotationId: string) => void;
    /** 이 노드에 포커스가 들어왔다. roving tabindex 를 옮긴다. */
    onFocusHeader: (nodeId: string) => void;
}

/** 본문 높이 저장을 몰아 보내는 간격. 끄는 동안 매 프레임 보내지 않는다. */
const RESIZE_SAVE_MS = 200;

export function TrailNode(props: TrailNodeProps): JSX.Element | null {
    const { node } = props;
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const ui = props.nodeUi[node.id];
    const bodyHeight = ui?.bodyHeight;
    const onNodeUi = props.onNodeUi;

    /*
     * 저장해 둔 높이를 다시 입힌다.
     *
     * React 의 `style` 로 넣지 않는다 — 사용자가 CSS `resize` 로 끌면 브라우저가
     * 같은 inline 속성을 덮어쓰고, 그러면 React 가 아는 값과 실제 값이 어긋난다.
     * 우리가 직접 세우고 직접 지운다.
     */
    useEffect(() => {
        const el = bodyRef.current;
        if (el === null) {
            return;
        }
        if (bodyHeight === undefined) {
            el.style.removeProperty('height');
        } else {
            el.style.height = `${bodyHeight}px`;
        }
    }, [bodyHeight]);

    /*
     * 본문 모서리를 끌어 높이를 바꾸면 그 값을 서버에 저장한다.
     *
     * `resize` 에는 이벤트가 없어서 관찰자로 잡는다. 사용자가 끌었을 때만
     * 브라우저가 `style.height` 를 직접 박으므로, 그게 있을 때만 기억한다.
     * 폭 맞춤이 글자 크기를 바꿔 높이가 달라진 경우와 이렇게 구분된다.
     */
    useEffect(() => {
        const el = bodyRef.current;
        if (el === null || typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const observer = new ResizeObserver(() => {
            const inline = el.style.height;
            if (inline === '') {
                return;
            }
            const px = Math.round(Number.parseFloat(inline));
            if (!Number.isFinite(px) || px === Math.round(bodyHeight ?? -1)) {
                return;
            }
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => onNodeUi(node.id, { bodyHeight: px }), RESIZE_SAVE_MS);
        });
        observer.observe(el);
        return () => {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
            observer.disconnect();
        };
    }, [node.id, bodyHeight, onNodeUi]);

    const children = useMemo(
        () => sortChildren(node.children, props.childOrder),
        [node.children, props.childOrder],
    );

    /**
     * 펼쳐본 호출부에 순번을 붙인다.
     *
     * 부모 본문의 ①과 자식 노드 헤더의 ①이 한 짝이다. 자식이 어느 줄에서
     * 갈라졌는지 눈으로 잇는 유일한 단서다. 보드 모드에서 자식이 멀리 떨어져
     * 놓여도 이 짝은 그대로다 — 자식을 모델에서 세기 때문이다.
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

    if (props.visibleIds !== null && !props.visibleIds.has(node.id)) {
        return null;
    }

    const parts = splitName(node.symbol);
    const kind = kindName(node.symbol.kind);
    const busy = props.busyNodeIds.has(node.id);
    const stale = props.staleNodeIds.has(node.id);
    const board = props.layout === 'board';
    const lineCount = node.symbol.code === '' ? 0 : node.symbol.code.split(/\r?\n/).length;
    const bodyEnd = node.symbol.startLine + Math.max(0, lineCount - 1);
    const noteCount = countForNode(
        props.annotations,
        node.id,
        node.symbol.relPath,
        node.symbol.startLine,
        bodyEnd,
    );
    const marks = marksInRange(
        props.annotations,
        node.symbol.relPath,
        node.symbol.startLine,
        bodyEnd,
    );
    const active = props.activeNodeId === node.id;
    const spot = props.positions[node.id];
    const style = board && spot !== undefined
        ? { left: `${Math.round(spot.x)}px`, top: `${Math.round(spot.y)}px` }
        : undefined;

    return (
        <div
            className={`node${node.collapsed ? ' collapsed' : ''}${
                props.activeNodeId === node.id ? ' active' : ''}`}
            data-id={node.id}
            data-parent={node.parentId ?? ''}
            data-depth={props.depth}
            {...(style === undefined ? {} : { style })}
        >
            <div
                className="hd"
                // 활성 노드의 헤더만 탭 순서에 둔다(roving tabindex). 전부 넣으면
                // `Tab` 한 번에 한 노드씩 지나가느라 트리를 건너다닐 수 없다.
                tabIndex={active ? 0 : -1}
                role={board ? 'listitem' : 'treeitem'}
                aria-expanded={node.collapsed ? false : undefined}
                aria-level={props.depth + 1}
                aria-selected={active}
                data-node-header={node.id}
                onFocus={() => props.onFocusHeader(node.id)}
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
                {stale ? (
                    <span
                        className="badge stale"
                        title="이 노드의 파일이 바뀌었다. ↻ 로 현재 코드를 다시 읽는다."
                    >
                        바뀜
                    </span>
                ) : null}
                {noteCount.total > 0 ? (
                    <button
                        type="button"
                        className={`badge notes${noteCount.open > 0 ? ' open' : ''}`}
                        data-act="notes"
                        title={describeCount(noteCount)}
                        onClick={() => props.onShowNotes(node)}
                    >
                        {`✎ ${noteCount.total}`}
                    </button>
                ) : null}
                {busy ? (
                    <span
                        className="badge busy"
                        title="언어 서버 응답을 기다리는 중이다."
                    >
                        …
                    </span>
                ) : null}

                <span className="spacer" />

                {/*
                  * 버튼은 한 묶음이다. 낱개로 두면 자리가 모자랄 때 마지막 하나만
                  * 다음 줄로 떨어져 나가 헤더가 깨져 보인다. 줄바꿈은 묶음 단위로 한다.
                  */}
                <span className="acts">
                <button
                    type="button"
                    className="act"
                    data-act="note"
                    title="이 노드에 기록 남기기"
                    onClick={() => props.onNote(node)}
                >
                    ＋
                </button>

                {stale ? (
                    <button
                        type="button"
                        className="act hot"
                        data-act="refresh"
                        title="현재 코드로 다시 읽기"
                        onClick={() => props.onRefresh(node)}
                    >
                        ↻
                    </button>
                ) : null}

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
                </span>
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
                    {props.staleNodeIds.has(node.parentId ?? '') ? (
                        <span className="muted"> (줄이 달라졌을 수 있다)</span>
                    ) : null}
                </div>
            ) : null}

            <div className="body" ref={bodyRef}>
                {node.collapsed ? null : <CodeBody
                    symbol={node.symbol}
                    clickTarget={props.clickTarget}
                    maxCodeLines={props.maxCodeLines}
                    visited={visited}
                    marks={marks}
                    {...(ui?.codeFontSize === undefined
                        ? {}
                        : { fontSize: ui.codeFontSize })}
                    onIdentifierClick={(line, char, text, modifiers) =>
                        props.onIdentifierClick(node, line, char, text, modifiers)}
                    onRangeSelect={(range, anchor) => props.onRangeSelect?.(node, range, anchor)}
                    onMarkClick={props.onOpenAnnotation}
                />}
            </div>

            {board ? null : (
                <div className="kids" role="group">
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
            )}
        </div>
    );
}
