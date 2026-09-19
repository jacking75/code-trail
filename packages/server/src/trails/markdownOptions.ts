import type { MarkdownOptions } from '@code-trail/shared';

import type { AnalysisService } from '../analysis/service.js';

/**
 * 트레일 Markdown 에 함께 실을 것 (V23).
 *
 * 분석 ID 를 주면 그 분석을, 안 주면 이 트레일과 짝지어진 분석을 쓴다.
 * 어느 쪽도 없으면 예전처럼 코드만 담는다 — 내보내기가 실패하지는 않는다.
 */
export function markdownOptionsFor(
    analyses: AnalysisService,
    trailId: string,
    options: { analysisId?: string | undefined; mermaid?: boolean | undefined },
): MarkdownOptions {
    const id = options.analysisId
        ?? analyses.list().find((item) => item.trailIds?.includes(trailId))?.id;
    const analysis = id === undefined ? undefined : analyses.get(id);
    return {
        trailId,
        mermaid: options.mermaid === true,
        ...(analysis === undefined ? {} : {
            annotations: analysis.annotations,
            reviews: analysis.reviews,
            walkthroughs: analysis.walkthroughs,
        }),
    };
}
