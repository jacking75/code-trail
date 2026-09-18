import { useEffect, useMemo, useState, type JSX } from 'react';

import type { AnchorComparisonView, AnalysisDocumentView, AnalysisSummaryView } from '../../api/http.js';
import { AnnotationComposer, type ComposerTargetKind } from './AnnotationComposer.js';
import { AnnotationItem, KIND_LABEL, type AnnotationKind, type TargetLink } from './AnnotationItem.js';

export type AnalysisTarget =
    | { kind: 'trail'; trailId: string }
    | { kind: 'node'; trailId: string; nodeId: string }
    | { kind: 'range'; anchorId: string };

export interface SelectedCodeRange {
    documentId: string;
    label: string;
    range: { start: { line: number; char: number }; end: { line: number; char: number } };
}

export interface SharePreviewView {
    planId: string;
    analysisId: string;
    analysisRevision: number;
    trailCount: number;
    nodeCount: number;
    annotationCount: number;
    replyCount: number;
    approximateBytes: number;
    warnings: string[];
}

export interface ImportPreviewView {
    uploadId: string;
    title: string;
    annotationCount: number;
    trailCount: number;
    codeIncluded: boolean;
    merge: {
        planId: string;
        additionCount: number;
        updateCount: number;
        deletionCount: number;
        conflicts: Array<{
            entity: 'annotation' | 'reply';
            id: string;
            reason: 'bothChanged' | 'deleteUpdate' | 'missingBase';
            localBody: string | null;
            incomingBody: string | null;
        }>;
    } | null;
}

export interface AiDraftView {
    id: string;
    anchorId: string;
    provider: string;
    model: string;
    body: string;
    questions: string[];
    evidence: Array<{ anchorId: string; claim: string }>;
    createdAt: string;
}

export interface AnalysisPanelProps {
    analyses: AnalysisSummaryView[];
    analysis: AnalysisDocumentView | null;
    activeTrailId: string | null;
    activeNodeId: string | null;
    activeNodeLabel: string | null;
    selectedRange: SelectedCodeRange | null;
    author: { id: string; displayName: string };
    persistedRevision: number | null;
    readOnly: boolean;
    sharePreview: SharePreviewView | null;
    importPreview: ImportPreviewView | null;
    aiCapability: { enabled: boolean; provider: string; model: string; maxInputBytes: number };
    aiDraft: AiDraftView | null;
    aiBusy: boolean;
    comparison: AnchorComparisonView | null;
    /** 작성 칸의 대상과 본문. `App` 이 들고 있어 기록 열과 같은 것을 쓴다. */
    composerTarget: ComposerTargetKind;
    composerBody: string;
    onComposerTarget: (kind: ComposerTargetKind) => void;
    onComposerBody: (body: string) => void;
    onSelect: (analysisId: string) => void;
    onCreateAnalysis: (title: string, purpose: string) => void;
    onCreateAnnotation: (value: {
        target: AnalysisTarget | SelectedCodeRange;
        body: string;
        kind: AnnotationKind;
        tags: string[];
    }) => void;
    onUpdateAnnotation: (annotationId: string, version: number, patch: Record<string, unknown>) => void;
    onDeleteAnnotation: (annotationId: string, version: number) => void;
    onRestoreAnnotation: (annotationId: string, version: number) => void;
    onReply: (annotationId: string, body: string) => void;
    onReview: (target: AnalysisTarget, state: string, evidenceIds: string[]) => void;
    onRecheck: () => void;
    onCreateWalkthrough: () => void;
    onUpdateWalkthrough: (walkthrough: AnalysisDocumentView['walkthroughs'][number]) => void;
    onPrepareShare: (includeCode: boolean) => void;
    onExport: (planId: string, format: 'ctshare' | 'markdown' | 'html') => void;
    onChooseImport: (file: File) => void;
    onCommitImport: (uploadId: string) => void;
    onCommitMerge: (planId: string) => void;
    onGenerateAi: (purpose: string) => void;
    onCancelAi: () => void;
    onAcceptAi: (draftId: string) => void;
    onSaveDraft: (draftId: string, target: AnalysisTarget, body: string) => void;
    onUpdatePlan: (
        purpose: string,
        goals: Array<{ id: string; title: string; targetIds: string[]; evidenceIds: string[] }>,
        importantLocations: Array<{ id: string; title: string; target: AnalysisTarget }>,
    ) => void;
    onNavigateTarget: (target: AnalysisTarget) => void;
    onCompareAnchor: (anchorId: string) => void;
    onCloseComparison: () => void;
}

export function AnalysisPanel(props: AnalysisPanelProps): JSX.Element {
    const [newTitle, setNewTitle] = useState('');
    const [newPurpose, setNewPurpose] = useState('');
    const [query, setQuery] = useState('');
    const [filterKind, setFilterKind] = useState<'all' | AnnotationKind>('all');
    const [showDeleted, setShowDeleted] = useState(false);
    const [includeCode, setIncludeCode] = useState(false);
    const [goalTitle, setGoalTitle] = useState('');
    const [editingPurpose, setEditingPurpose] = useState<string | null>(null);
    const [locationTitle, setLocationTitle] = useState<string | null>(null);

    const focusInternalReference = (href: string): void => {
        setQuery('');
        setFilterKind('all');
        setShowDeleted(true);
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${href}`);
        window.setTimeout(() => {
            const element = document.getElementById(href.slice(1));
            element?.focus({ preventScroll: true });
            element?.scrollIntoView({ block: 'nearest' });
        }, 0);
    };

    useEffect(() => {
        if (!props.analysis || !window.location.hash) return;
        const params = new URLSearchParams(window.location.hash.slice(1));
        const identity = analysisReferenceIdentity(props.analysis);
        if (params.get('bundle') !== identity.bundleId
            || params.get('analysis') !== identity.analysisId) return;
        setQuery('');
        setFilterKind('all');
        setShowDeleted(true);
        const timer = window.setTimeout(() => {
            const element = document.getElementById(window.location.hash.slice(1));
            element?.focus({ preventScroll: true });
            element?.scrollIntoView({ block: 'nearest' });
        }, 0);
        return () => window.clearTimeout(timer);
    }, [props.analysis?.id]);

    const records = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase('ko');
        return (props.analysis?.annotations ?? []).filter((item) => {
            if (!showDeleted && item.deletedAt !== null) return false;
            if (filterKind !== 'all' && item.kind !== filterKind) return false;
            return needle === '' || `${item.body} ${item.tags.join(' ')}`.toLocaleLowerCase('ko').includes(needle);
        });
    }, [props.analysis, query, filterKind, showDeleted]);

    const selectedTarget = (): AnalysisTarget | SelectedCodeRange | null => {
        if (props.composerTarget === 'range') return props.selectedRange;
        if (props.composerTarget === 'node') {
            return props.activeTrailId && props.activeNodeId
                ? { kind: 'node', trailId: props.activeTrailId, nodeId: props.activeNodeId }
                : null;
        }
        return props.activeTrailId ? { kind: 'trail', trailId: props.activeTrailId } : null;
    };

    // 저장 초안. 대상이 범위면 서버에 보낼 수 없으므로(앵커가 아직 없다) 건너뛴다.
    useEffect(() => {
        if (!props.analysis || !props.composerBody.trim()) return;
        const target = selectedTarget();
        if (!target || 'documentId' in target) return;
        const timer = window.setTimeout(
            () => props.onSaveDraft(props.author.id, target, props.composerBody),
            600,
        );
        return () => window.clearTimeout(timer);
    }, [props.composerBody, props.analysis?.id, props.author.id, props.composerTarget,
        props.activeTrailId, props.activeNodeId]);

    const submit = (value: { body: string; kind: AnnotationKind; tags: string[] }): void => {
        const target = selectedTarget();
        if (!target) return;
        props.onCreateAnnotation({ target, ...value });
        props.onComposerBody('');
    };

    const composerLabel = props.composerTarget === 'range'
        ? props.selectedRange?.label ?? '코드를 먼저 선택한다.'
        : props.composerTarget === 'node'
            ? props.activeNodeLabel ?? '노드를 먼저 고른다.'
            : '트레일 전체';

    return (
        <section className="analysis-panel" aria-label="분석 기록">
            <header className="analysis-head">
                <div>
                    <h2>분석 기록</h2>
                    <span className="save-state" role="status">
                        {props.analysis === null ? '분석 없음 — 첫 기록을 저장하면 만들어진다'
                            : props.persistedRevision === props.analysis.revision
                                ? `디스크 저장됨 · r${props.analysis.revision}`
                                : '서버 반영 중'}
                    </span>
                </div>
                <label>
                    <span className="sr-only">분석 고르기</span>
                    <select
                        value={props.analysis?.id ?? ''}
                        onChange={(event) => props.onSelect(event.target.value)}
                    >
                        <option value="">분석 고르기</option>
                        {props.analyses.map((item) => (
                            <option key={item.id} value={item.id}>{`${item.title} · 기록 ${item.annotationCount}`}</option>
                        ))}
                    </select>
                </label>
            </header>

            {props.readOnly ? <p className="readonly-note">공유 읽기 모드다. 원본은 바뀌지 않는다.</p> : null}

            {props.analysis === null ? null : (
                <div className="analysis-purpose">
                    <strong>{props.analysis.title}</strong>
                    {editingPurpose === null ? (
                        <>
                            <p>{props.analysis.purpose || '목표가 아직 없다.'}</p>
                            <Progress analysis={props.analysis} />
                            <button
                                type="button"
                                disabled={props.readOnly}
                                onClick={() => setEditingPurpose(props.analysis?.purpose ?? '')}
                            >
                                목표 설명 수정
                            </button>
                        </>
                    ) : (
                        <div className="inline-edit">
                            <textarea
                                autoFocus
                                aria-label="읽기 목표"
                                value={editingPurpose}
                                onChange={(event) => setEditingPurpose(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.nativeEvent.isComposing) return;
                                    if (event.key === 'Escape') setEditingPurpose(null);
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    if (props.analysis) props.onUpdatePlan(
                                        editingPurpose,
                                        props.analysis.goals as Array<{ id: string; title: string; targetIds: string[]; evidenceIds: string[] }>,
                                        props.analysis.importantLocations as Array<{ id: string; title: string; target: AnalysisTarget }>,
                                    );
                                    setEditingPurpose(null);
                                }}
                            >
                                저장
                            </button>
                            <button type="button" onClick={() => setEditingPurpose(null)}>취소</button>
                        </div>
                    )}
                </div>
            )}

            {props.analysis === null ? null : (
                <section className="analysis-plan">
                    <h3>검토 목표와 중요 위치</h3>
                    <ul>
                        {(props.analysis.goals as Array<{ id: string; title: string }>).map((goal) => (
                            <li key={goal.id}>{goal.title}</li>
                        ))}
                    </ul>
                    <form onSubmit={(event) => {
                        event.preventDefault();
                        if (!goalTitle.trim() || !props.analysis) return;
                        const targetId = props.activeNodeId ?? props.activeTrailId;
                        props.onUpdatePlan(props.analysis.purpose, [
                            ...(props.analysis.goals as Array<{ id: string; title: string; targetIds: string[]; evidenceIds: string[] }>),
                            { id: crypto.randomUUID(), title: goalTitle, targetIds: targetId ? [targetId] : [], evidenceIds: [] },
                        ], props.analysis.importantLocations as Array<{ id: string; title: string; target: AnalysisTarget }>);
                        setGoalTitle('');
                    }}>
                        <input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="확인할 목표" disabled={props.readOnly} />
                        <button type="submit" disabled={props.readOnly || !goalTitle.trim()}>목표 추가</button>
                    </form>
                    <ul>
                        {(props.analysis.importantLocations as Array<{ id: string; title: string; target: AnalysisTarget }>).map((item) => (
                            <li key={item.id}><button type="button" onClick={() => props.onNavigateTarget(item.target)}>{item.title}</button></li>
                        ))}
                    </ul>
                    {locationTitle === null ? (
                        <button
                            type="button"
                            disabled={props.readOnly || (!props.activeNodeId && !props.activeTrailId)}
                            onClick={() => setLocationTitle(props.activeNodeId ? '중요 노드' : '중요 트레일')}
                        >
                            현재 위치 표시
                        </button>
                    ) : (
                        <form className="inline-edit" onSubmit={(event) => {
                            event.preventDefault();
                            if (!props.analysis || !props.activeTrailId || !locationTitle.trim()) return;
                            const target: AnalysisTarget = props.activeNodeId
                                ? { kind: 'node', trailId: props.activeTrailId, nodeId: props.activeNodeId }
                                : { kind: 'trail', trailId: props.activeTrailId };
                            props.onUpdatePlan(
                                props.analysis.purpose,
                                props.analysis.goals as Array<{ id: string; title: string; targetIds: string[]; evidenceIds: string[] }>,
                                [
                                    ...(props.analysis.importantLocations as Array<{ id: string; title: string; target: AnalysisTarget }>),
                                    { id: crypto.randomUUID(), title: locationTitle, target },
                                ],
                            );
                            setLocationTitle(null);
                        }}>
                            <input
                                autoFocus
                                aria-label="중요 위치 이름"
                                value={locationTitle}
                                onChange={(event) => setLocationTitle(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') setLocationTitle(null);
                                }}
                            />
                            <button type="submit">추가</button>
                            <button type="button" onClick={() => setLocationTitle(null)}>취소</button>
                        </form>
                    )}
                </section>
            )}

            <AnnotationComposer
                targetKind={props.composerTarget}
                onTargetKind={props.onComposerTarget}
                targetLabel={composerLabel}
                nodeAvailable={props.activeNodeId !== null}
                rangeAvailable={props.selectedRange !== null}
                readOnly={props.readOnly}
                body={props.composerBody}
                onBody={props.onComposerBody}
                onSubmit={submit}
                canSubmit={selectedTarget() !== null}
            />

            {props.analysis === null ? null : (
                <>
                    <div className="annotation-tools">
                        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="기록 본문·태그 검색" />
                        <select value={filterKind} onChange={(event) => setFilterKind(event.target.value as typeof filterKind)}>
                            <option value="all">모든 종류</option>
                            {(Object.keys(KIND_LABEL) as AnnotationKind[]).map((value) => (
                                <option key={value} value={value}>{KIND_LABEL[value]}</option>
                            ))}
                        </select>
                        <label><input type="checkbox" checked={showDeleted} onChange={(event) => setShowDeleted(event.target.checked)} /> 삭제 포함</label>
                        <button type="button" onClick={props.onRecheck} disabled={props.analysis.anchors.length === 0}>위치 다시 확인</button>
                    </div>

                    <div className="annotation-list" aria-live="polite">
                        {records.map((item) => {
                            const author = props.analysis?.authors.find((value) => value.id === item.authorId)?.displayName ?? '알 수 없음';
                            const target = item.target as unknown as AnalysisTarget;
                            const replies = props.analysis?.replies.filter((value) => value.annotationId === item.id && value.deletedAt === null) ?? [];
                            const href = props.analysis
                                ? internalReference(props.analysis, { annotationId: item.id })
                                : '#';
                            const reviewState = props.analysis?.reviews.find(
                                (value) => JSON.stringify(value.target) === JSON.stringify(target),
                            )?.state ?? 'unreviewed';
                            return (
                                <AnnotationItem
                                    key={item.id}
                                    anchorId={href.slice(1)}
                                    annotation={item as never}
                                    authorName={author}
                                    replies={replies}
                                    readOnly={props.readOnly}
                                    referenceHref={href}
                                    targetLinks={targetLinks(props.analysis, target, props.onNavigateTarget)}
                                    onFocusReference={focusInternalReference}
                                    onUpdate={(patch) => props.onUpdateAnnotation(item.id, item.version, patch)}
                                    onDelete={() => props.onDeleteAnnotation(item.id, item.version)}
                                    onRestore={() => props.onRestoreAnnotation(item.id, item.version)}
                                    onReply={(body) => props.onReply(item.id, body)}
                                    {...(target.kind === 'range' ? {
                                        review: {
                                            state: reviewState,
                                            onChange: (state: string) => props.onReview(target, state, [item.id]),
                                            onCompare: () => props.onCompareAnchor(target.anchorId),
                                        },
                                    } : {})}
                                >
                                    {target.kind === 'range' && props.comparison?.anchorId === target.anchorId ? (
                                        <AnchorComparison comparison={props.comparison} onClose={props.onCloseComparison} />
                                    ) : null}
                                </AnnotationItem>
                            );
                        })}
                        {records.length === 0 ? <p className="muted">조건에 맞는 기록이 없다.</p> : null}
                    </div>

                    <section className="walkthrough-section">
                        <h3>안내 순서</h3>
                        {props.analysis.walkthroughs.map((walkthrough) => (
                            <div key={walkthrough.id}>
                                <strong>{walkthrough.title}</strong>
                                {walkthrough.steps.map((step, index) => (
                                    <div
                                        className="walkthrough-row"
                                        key={step.id}
                                        id={internalReference(props.analysis, { walkthroughId: walkthrough.id, stepId: step.id }).slice(1)}
                                        tabIndex={-1}
                                    >
                                        <button className="walkthrough-step" type="button" onClick={() => {
                                            if (step.annotationId) {
                                                focusInternalReference(internalReference(props.analysis, { annotationId: step.annotationId }));
                                                return;
                                            }
                                            const target = step.target as AnalysisTarget | null;
                                            if (target) props.onNavigateTarget(target);
                                        }}><b>{`${index + 1}. ${step.title}`}</b><span>{step.body}</span></button>
                                        <a
                                            className="internal-reference"
                                            href={internalReference(props.analysis, { walkthroughId: walkthrough.id, stepId: step.id })}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                focusInternalReference(event.currentTarget.hash);
                                            }}
                                        >단계 링크</a>
                                        <button type="button" aria-label="앞 단계로 옮기기" disabled={props.readOnly || index === 0} onClick={() => {
                                            const steps = [...walkthrough.steps];
                                            [steps[index - 1], steps[index]] = [steps[index]!, steps[index - 1]!];
                                            props.onUpdateWalkthrough({ ...walkthrough, steps });
                                        }}>↑</button>
                                        <button type="button" aria-label="뒤 단계로 옮기기" disabled={props.readOnly || index === walkthrough.steps.length - 1} onClick={() => {
                                            const steps = [...walkthrough.steps];
                                            [steps[index], steps[index + 1]] = [steps[index + 1]!, steps[index]!];
                                            props.onUpdateWalkthrough({ ...walkthrough, steps });
                                        }}>↓</button>
                                    </div>
                                ))}
                            </div>
                        ))}
                        <button type="button" disabled={props.readOnly || props.analysis.annotations.length === 0} onClick={props.onCreateWalkthrough}>현재 기록 순서로 만들기</button>
                    </section>
                </>
            )}

            {/*
              * 분석을 먼저 만들 필요는 없다(U11). 첫 기록을 저장하면 활성 트레일
              * 이름으로 하나가 생긴다. 이 폼은 **따로** 하나 더 만들고 싶을 때만 쓴다.
              */}
            <form className="analysis-create" onSubmit={(event) => {
                event.preventDefault();
                if (newTitle.trim()) {
                    props.onCreateAnalysis(newTitle, newPurpose);
                    setNewTitle('');
                    setNewPurpose('');
                }
            }}>
                <h3>다른 분석 만들기</h3>
                <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="분석 제목" />
                <textarea value={newPurpose} onChange={(event) => setNewPurpose(event.target.value)} placeholder="읽기 목표와 확인할 질문" />
                <button type="submit" disabled={props.readOnly || !newTitle.trim()}>만들기</button>
            </form>

            <aside className="analysis-side">
                <section className="share-section">
                    <h3>공유</h3>
                    <label><input type="checkbox" checked={includeCode} onChange={(event) => setIncludeCode(event.target.checked)} /> 코드 본문 포함</label>
                    <button type="button" disabled={!props.analysis} onClick={() => props.onPrepareShare(includeCode)}>공유 내용 확인</button>
                    {props.sharePreview ? (
                        <div className="share-preview">
                            <p>{`트레일 ${props.sharePreview.trailCount} · 노드 ${props.sharePreview.nodeCount} · 기록 ${props.sharePreview.annotationCount} · 약 ${formatBytes(props.sharePreview.approximateBytes)}`}</p>
                            {props.sharePreview.warnings.map((warning) => <small key={warning}>{warning}</small>)}
                            <div>
                                <button type="button" onClick={() => props.onExport(props.sharePreview?.planId ?? '', 'ctshare')}>공유 묶음</button>
                                <button type="button" onClick={() => props.onExport(props.sharePreview?.planId ?? '', 'markdown')}>Markdown</button>
                                <button type="button" onClick={() => props.onExport(props.sharePreview?.planId ?? '', 'html')}>정적 HTML</button>
                            </div>
                        </div>
                    ) : null}
                    <label className="file-pick">공유 묶음 가져오기<input type="file" accept=".json,.ctshare.json,application/json" onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) props.onChooseImport(file);
                        event.currentTarget.value = '';
                    }} /></label>
                    {props.importPreview ? (
                        <div className="import-preview">
                            <p>{`${props.importPreview.title} · 트레일 ${props.importPreview.trailCount} · 기록 ${props.importPreview.annotationCount}`}</p>
                            <p>{props.importPreview.codeIncluded ? '코드 본문을 포함한다.' : '코드 본문이 없다.'}</p>
                            {props.importPreview.merge ? (
                                <div className="merge-preview">
                                    <p>{`원본에 합칠 변경: 추가 ${props.importPreview.merge.additionCount} · 수정 ${props.importPreview.merge.updateCount} · 삭제 ${props.importPreview.merge.deletionCount}`}</p>
                                    {props.importPreview.merge.conflicts.length > 0 ? (
                                        <>
                                            <strong>{`충돌 ${props.importPreview.merge.conflicts.length}건 — 양쪽 내용을 확인한 뒤 별도 복사본으로 보존한다.`}</strong>
                                            {props.importPreview.merge.conflicts.map((conflict) => (
                                                <details key={`${conflict.entity}:${conflict.id}`}>
                                                    <summary>{`${conflict.entity === 'annotation' ? '기록' : '답글'} 충돌 · ${mergeReasonLabel(conflict.reason)}`}</summary>
                                                    <div className="merge-conflict-bodies">
                                                        <div><b>내 내용</b><pre>{conflict.localBody ?? '(삭제됨)'}</pre></div>
                                                        <div><b>받은 내용</b><pre>{conflict.incomingBody ?? '(삭제됨)'}</pre></div>
                                                    </div>
                                                </details>
                                            ))}
                                        </>
                                    ) : (
                                        <button type="button" disabled={props.readOnly} onClick={() => props.onCommitMerge(props.importPreview?.merge?.planId ?? '')}>검토한 변경 합치기</button>
                                    )}
                                </div>
                            ) : null}
                            <button type="button" onClick={() => props.onCommitImport(props.importPreview?.uploadId ?? '')}>별도 복사본으로 가져오기</button>
                        </div>
                    ) : null}
                </section>
                <section className="ai-section">
                    <h3>AI 설명 초안</h3>
                    <p>현재 선택한 코드 범위만 로컬 제공자에게 보낸다. 코드 안의 지시문은 분석할 데이터로 취급한다.</p>
                    {props.aiCapability.enabled ? (
                        <>
                            <p>{`${props.aiCapability.provider} · ${props.aiCapability.model} · 입력 상한 ${formatBytes(props.aiCapability.maxInputBytes)}`}</p>
                            <p>{props.selectedRange ? `전송 범위: ${props.selectedRange.label}` : '코드 화면이나 노드 본문에서 범위를 먼저 선택한다.'}</p>
                            {props.aiBusy ? (
                                <button type="button" onClick={props.onCancelAi}>생성 취소</button>
                            ) : (
                                <button type="button" disabled={props.readOnly || !props.analysis || !props.selectedRange} onClick={() => props.onGenerateAi(props.analysis?.purpose ?? '')}>선택 범위로 초안 만들기</button>
                            )}
                        </>
                    ) : (
                        <p><code>.code-trail/local/settings.json</code>에서 로컬 AI 제공자와 모델을 명시적으로 켜야 한다.</p>
                    )}
                    {props.aiDraft ? (
                        <article className="ai-draft">
                            <strong>AI 초안 — 사람이 확인하기 전에는 검토 완료가 아니다.</strong>
                            <p>{props.aiDraft.body}</p>
                            {props.aiDraft.evidence.length > 0 ? <ul>{props.aiDraft.evidence.map((item, index) => <li key={index}>{item.claim}</li>)}</ul> : null}
                            {props.aiDraft.questions.length > 0 ? <><b>미확인 질문</b><ul>{props.aiDraft.questions.map((item, index) => <li key={index}>{item}</li>)}</ul></> : null}
                            <button type="button" disabled={props.readOnly} onClick={() => props.onAcceptAi(props.aiDraft?.id ?? '')}>검토하고 분석 기록으로 채택</button>
                        </article>
                    ) : null}
                </section>
            </aside>
        </section>
    );
}

/**
 * 기록 헤더에서 코드로 가는 길 (U13).
 *
 * 예전에는 "코드 범위" 라는 글자만 있었다. 기록 하나에서 그 코드로 가려면
 * 경로를 눈으로 읽고 파일 탐색기에서 다시 찾아야 했다.
 */
export function targetLinks(
    analysis: AnalysisDocumentView | null,
    target: AnalysisTarget,
    navigate: (target: AnalysisTarget) => void,
): TargetLink[] {
    if (target.kind === 'trail') {
        return [{ label: '트레일', run: () => navigate(target) }];
    }
    if (target.kind === 'node') {
        return [{ label: '노드에서 보기', run: () => navigate(target) }];
    }
    const anchor = (analysis?.anchors as Array<{
        id: string; fileId: string;
        range?: { start: { line: number } }; currentRange?: { start: { line: number } } | null;
    }> | undefined)?.find((item) => item.id === target.anchorId);
    const file = (analysis?.baselines as Array<{ files: Array<{ fileId: string; relPath: string }> }> | undefined)
        ?.flatMap((baseline) => baseline.files).find((item) => item.fileId === anchor?.fileId);
    const line = (anchor?.currentRange ?? anchor?.range)?.start.line;
    const label = file && line !== undefined ? `${file.relPath}:${line + 1}` : '코드 범위';
    return [{ label, run: () => navigate(target) }];
}

const ANCHOR_STATE_LABEL: Record<AnchorComparisonView['state'], string> = {
    matched: '일치함',
    moved: '위치 이동',
    changed: '코드 변경',
    ambiguous: '후보 여러 개',
    missing: '연결 대상 없음',
    unknown: '기준 미확인',
};

function AnchorComparison(props: { comparison: AnchorComparisonView; onClose: () => void }): JSX.Element {
    const value = props.comparison;
    return (
        <section className="anchor-comparison" aria-label="이전 코드와 현재 코드 비교">
            <header>
                <strong>코드 비교</strong>
                <span>{`${value.relPath} · ${ANCHOR_STATE_LABEL[value.state]}`}</span>
                <button type="button" onClick={props.onClose} aria-label="코드 비교 닫기">×</button>
            </header>
            <div className="anchor-comparison-columns">
                <div>
                    <b>기록 당시</b>
                    <small>{rangeLabel(value.previousRange)}</small>
                    <pre>{value.previousText ?? '공유 자료에 이전 코드가 포함되지 않았다.'}</pre>
                </div>
                <div>
                    <b>현재</b>
                    <small>{rangeLabel(value.currentRange)}</small>
                    <pre>{value.currentText ?? currentUnavailableLabel(value.currentUnavailableReason)}</pre>
                </div>
            </div>
        </section>
    );
}

function rangeLabel(range: AnchorComparisonView['previousRange']): string {
    const start = `${range.start.line + 1}:${range.start.char + 1}`;
    const end = `${range.end.line + 1}:${range.end.char + 1}`;
    return `${start}–${end}`;
}

function currentUnavailableLabel(reason: AnchorComparisonView['currentUnavailableReason']): string {
    return reason === 'file-unavailable'
        ? '현재 프로젝트에서 파일을 읽을 수 없다.'
        : '현재 코드에서 비교 범위를 읽을 수 없다.';
}

function analysisReferenceIdentity(analysis: AnalysisDocumentView): { bundleId: string; analysisId: string } {
    const source = analysis.sourceShare;
    return {
        bundleId: typeof source?.bundleId === 'string' ? source.bundleId : analysis.id,
        analysisId: typeof source?.sourceAnalysisId === 'string' ? source.sourceAnalysisId : analysis.id,
    };
}

function sharedEntityId(analysis: AnalysisDocumentView, id: string): string {
    const ids = analysis.sourceShare?.originalIds;
    if (ids && typeof ids === 'object' && !Array.isArray(ids)) {
        const original = (ids as Record<string, unknown>)[id];
        if (typeof original === 'string') return original;
    }
    return id;
}

export function internalReference(
    analysis: AnalysisDocumentView | null,
    target: { annotationId: string } | { walkthroughId: string; stepId: string },
): string {
    if (!analysis) return '#';
    const identity = analysisReferenceIdentity(analysis);
    const params = new URLSearchParams({
        bundle: identity.bundleId,
        analysis: identity.analysisId,
        localAnalysis: analysis.id,
    });
    if ('annotationId' in target) {
        params.set('annotation', sharedEntityId(analysis, target.annotationId));
    } else {
        params.set('walkthrough', sharedEntityId(analysis, target.walkthroughId));
        params.set('step', sharedEntityId(analysis, target.stepId));
    }
    return `#${params.toString()}`;
}

function Progress({ analysis }: { analysis: AnalysisDocumentView }): JSX.Element {
    const reviewed = analysis.reviews.filter((item) => item.state === 'reviewed').length;
    const total = analysis.reviews.length;
    return <div className="review-progress"><span>{`확인함 ${reviewed}/${total}개 범위`}</span><progress max={Math.max(1, total)} value={reviewed} /></div>;
}

function formatBytes(bytes: number): string {
    return bytes < 1024 ? `${bytes}B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)}KiB` : `${(bytes / 1024 / 1024).toFixed(1)}MiB`;
}

function mergeReasonLabel(reason: 'bothChanged' | 'deleteUpdate' | 'missingBase'): string {
    if (reason === 'bothChanged') return '양쪽 수정';
    if (reason === 'deleteUpdate') return '삭제와 수정';
    return '기준 내용 없음';
}
