import type { CodeRange } from './analysis.js';

export interface ExplanationEvidence {
    anchorId: string;
    claim: string;
}

export interface AiExplanationDraft {
    id: string;
    provider: string;
    model: string;
    baselineId: string;
    range: CodeRange;
    body: string;
    questions: string[];
    evidence: ExplanationEvidence[];
    createdAt: string;
    acceptedAt: string | null;
}

/**
 * 제공자 독립 계약이다. 구현체는 사용자가 명시적으로 요청한 범위만 받는다.
 * 비밀키와 전송은 서버 구현의 책임이며 shared에는 들어오지 않는다.
 */
export interface ExplanationProvider {
    readonly name: string;
    generate(input: {
        code: string;
        languageId: string;
        purpose: string;
        signal?: { readonly aborted: boolean };
    }): Promise<{ model: string; body: string; questions: string[]; evidence: ExplanationEvidence[] }>;
}
