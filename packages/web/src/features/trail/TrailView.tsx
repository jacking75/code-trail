import { useCallback, useMemo, useState, type JSX } from 'react';

import type { ClickTarget } from '../../tokenizer/tokenize.js';
import { TrailNode } from './TrailNode.js';
import {
    ancestorsOf,
    splitName,
    type DefinitionChoice,
    type TrailNodeView,
    type TrailSnapshot,
} from './types.js';

/**
 * 트레일 화면 (구현서 16.1, 16.3).
 *
 * 툴바 · 브레드크럼 · 트리 세 부분이다. 트리 배치는 CSS 가 만든다 —
 * 부모가 위, 자식이 그 아래 같은 행에 좌우로 놓인다.
 */

export interface TrailViewProps {
    trail: TrailSnapshot;
    busyNodeIds: ReadonlySet<string>;
    clickTarget: ClickTarget;
    maxCodeLines: number;
    /** 이 언어 서버가 구현 찾기를 지원하는지. */
    implementationSupported: boolean;
    choice: DefinitionChoice | null;

    onToggle: (node: TrailNodeView) => void;
    onToggleAll: (collapsed: boolean) => void;
    onRemove: (node: TrailNodeView) => void;
    onPromote: (node: TrailNodeView) => void;
    onImplementations: (node: TrailNodeView) => void;
    onOpenInEditor: (node: TrailNodeView) => void;
    onIdentifierClick: (
        node: TrailNodeView,
        line: number,
        char: number,
        text: string,
        modifiers: { alt: boolean; ctrl: boolean },
    ) => void;
    onFocusNode: (nodeId: string) => void;
    onClear: () => void;
    onExportMarkdown: () => void;
    onChooseCandidate: (choiceId: string, candidateId: string) => void;
    onDismissChoice: () => void;
}

/**
 * 필터에 걸린 노드와 그 조상.
 *
 * 조상을 함께 남기는 이유는 트리 모양을 지키기 위해서다. 걸린 노드만 남기면
 * 부모가 사라져 어디서 갈라진 것인지 알 수 없다.
 */
function filterIds(roots: readonly TrailNodeView[], query: string): Set<string> | null {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
        return null;
    }
    const keep = new Set<string>();
    const walk = (node: TrailNodeView, chain: TrailNodeView[]): boolean => {
        const nextChain = [...chain, node];
        const hit = node.symbol.name.toLowerCase().includes(needle)
            || node.symbol.displayPath.toLowerCase().includes(needle);
        let anyChild = false;
        for (const child of node.children) {
            anyChild = walk(child, nextChain) || anyChild;
        }
        if (hit || anyChild) {
            for (const inChain of nextChain) {
                keep.add(inChain.id);
            }
            return true;
        }
        return false;
    };
    roots.forEach((root) => walk(root, []));
    return keep;
}

export function TrailView(props: TrailViewProps): JSX.Element {
    const { trail } = props;
    const [filter, setFilter] = useState('');
    const [childOrder, setChildOrder] = useState<'source' | 'click'>('source');

    const visibleIds = useMemo(() => filterIds(trail.roots, filter), [trail.roots, filter]);

    const breadcrumb = useMemo(
        () => (trail.activeNodeId === null ? [] : ancestorsOf(trail.roots, trail.activeNodeId)),
        [trail.roots, trail.activeNodeId],
    );

    /**
     * 진입 링크를 누르면 부모의 그 호출 지점으로 간다.
     *
     * 부모 노드를 활성으로 만들고 화면에 보이게 한다. 호출부에는 이미 ①이
     * 붙어 있어서, 활성 표시와 순번이 함께 어디를 봐야 할지 알려준다.
     */
    const jumpToOrigin = useCallback((node: TrailNodeView) => {
        if (node.parentId === null) {
            return;
        }
        props.onFocusNode(node.parentId);
        const selector = `[data-id="${node.parentId}"] [data-l="${node.origin?.line}"][data-c="${node.origin?.char}"]`;
        const target = document.querySelector(selector);
        target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [props]);

    const nodeCount = useMemo(() => {
        let count = 0;
        const walk = (nodes: readonly TrailNodeView[]): void => {
            count += nodes.length;
            nodes.forEach((n) => walk(n.children));
        };
        walk(trail.roots);
        return count;
    }, [trail.roots]);

    return (
        <div className="trail">
            <div className="toolbar" id="toolbar">
                <button type="button" onClick={() => props.onToggleAll(false)}>⤢ 전체 펼치기</button>
                <button type="button" onClick={() => props.onToggleAll(true)}>⤡ 전체 접기</button>
                <button
                    type="button"
                    onClick={() => setChildOrder(childOrder === 'source' ? 'click' : 'source')}
                    title="같은 부모 아래 형제 노드의 정렬 순서"
                >
                    {childOrder === 'source' ? '⇅ 코드 순서' : '⇅ 클릭 순서'}
                </button>
                <span className="sep" />
                <input
                    id="filter"
                    type="search"
                    value={filter}
                    placeholder="이름/경로 필터…"
                    aria-label="이름/경로 필터"
                    onChange={(event) => setFilter(event.target.value)}
                />
                <span className="sep" />
                <button type="button" onClick={props.onExportMarkdown}>Markdown</button>
                <button type="button" className="danger" onClick={props.onClear}>지우기</button>
                <span className="spacer" />
                <span className="muted">{`노드 ${nodeCount}`}</span>
            </div>

            <div className="breadcrumb" id="breadcrumb">
                {breadcrumb.length === 0 ? (
                    <span className="muted">노드를 고르면 여기에 경로가 나온다.</span>
                ) : breadcrumb.map((node, index) => (
                    <span key={node.id}>
                        {index > 0 ? <span className="crumb-sep">›</span> : null}
                        <button
                            type="button"
                            className="crumb"
                            onClick={() => props.onFocusNode(node.id)}
                        >
                            {splitName(node.symbol).name}
                        </button>
                    </span>
                ))}
            </div>

            {props.choice !== null ? (
                <div className="choice" role="dialog" aria-label="정의 후보">
                    <p>
                        정의 후보가 여러 개다. 어느 것이 실제로 도는지는 호출부만으로 알 수
                        없으니 직접 고른다.
                    </p>
                    <ul>
                        {props.choice.candidates.map((candidate) => (
                            <li key={candidate.candidateId}>
                                <button
                                    type="button"
                                    onClick={() => props.onChooseCandidate(
                                        (props.choice as DefinitionChoice).choiceId,
                                        candidate.candidateId,
                                    )}
                                >
                                    <span className="cand-name">{candidate.name}</span>
                                    <span className="cand-path">
                                        {`${candidate.displayPath}:${candidate.line + 1}`}
                                    </span>
                                    {candidate.hasBody ? null : (
                                        <span className="badge decl">선언만</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                    <button type="button" className="danger" onClick={props.onDismissChoice}>
                        취소
                    </button>
                </div>
            ) : null}

            <div className="tree" id="root">
                {trail.roots.length === 0 ? (
                    <div className="placeholder">
                        <p>아직 노드가 없다.</p>
                        <p className="muted">
                            코드 화면에서 함수 위를 누르고 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>
                            를 누르면 여기에 펼쳐진다.
                        </p>
                    </div>
                ) : trail.roots.map((root) => (
                    <TrailNode
                        key={root.id}
                        node={root}
                        ordinal={0}
                        depth={0}
                        parentName=""
                        activeNodeId={trail.activeNodeId}
                        busyNodeIds={props.busyNodeIds}
                        clickTarget={props.clickTarget}
                        maxCodeLines={props.maxCodeLines}
                        implementationSupported={props.implementationSupported}
                        childOrder={childOrder}
                        visibleIds={visibleIds}
                        onToggle={props.onToggle}
                        onRemove={props.onRemove}
                        onPromote={props.onPromote}
                        onImplementations={props.onImplementations}
                        onOpenInEditor={props.onOpenInEditor}
                        onJumpToOrigin={jumpToOrigin}
                        onIdentifierClick={props.onIdentifierClick}
                    />
                ))}
            </div>
        </div>
    );
}
