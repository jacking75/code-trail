import { createHash } from 'node:crypto';

import {
    newEntityId,
    textForRange,
    type Anchor,
    type CodeRange,
    type SourceBaseline,
} from '@code-trail/shared';

export function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function createBaselineFile(args: {
    relPath: string;
    contentHash: string;
    commit?: string | null;
    dirty?: boolean | null;
    capturedAt?: string;
    baselineId?: string;
    fileId?: string;
}): { baseline: SourceBaseline; fileId: string } {
    const fileId = args.fileId ?? newEntityId();
    return {
        fileId,
        baseline: {
            id: args.baselineId ?? newEntityId(),
            repositoryId: null,
            commit: args.commit ?? null,
            dirty: args.dirty ?? null,
            capturedAt: args.capturedAt ?? new Date().toISOString(),
            files: [{ fileId, relPath: args.relPath, contentHash: args.contentHash, textEncoding: 'utf-8' }],
        },
    };
}

export function contextForRange(text: string, range: CodeRange, lines = 2): {
    selectedText: string;
    before: string | null;
    after: string | null;
} | null {
    const selectedText = textForRange(text, range);
    if (selectedText === null) return null;
    const all = text.split(/\r?\n/);
    const before = all.slice(Math.max(0, range.start.line - lines), range.start.line).join('\n') || null;
    const after = all.slice(range.end.line + 1, range.end.line + 1 + lines).join('\n') || null;
    return { selectedText, before, after };
}

function positionAt(text: string, offset: number): { line: number; char: number } {
    let line = 0;
    let lineStart = 0;
    for (let index = 0; index < offset; index += 1) {
        if (text.charCodeAt(index) === 10) {
            line += 1;
            lineStart = index + 1;
        }
    }
    return { line, char: offset - lineStart };
}

export interface ReanchorCandidate {
    id: string;
    range: CodeRange;
    score: number;
}

export interface ReanchorResult {
    state: Anchor['state'];
    currentRange: CodeRange | null;
    candidates: ReanchorCandidate[];
}

/** 언어 해석을 하지 않는 제한된 본문·문맥 재탐색이다. */
export function reanchor(anchor: Anchor, currentText: string, currentHash: string): ReanchorResult {
    if (anchor.selectedText === null) {
        return { state: 'unknown', currentRange: null, candidates: [] };
    }
    if (textForRange(currentText, anchor.range) === anchor.selectedText) {
        return {
            state: currentHash === anchor.selectedTextHash ? 'matched' : 'matched',
            currentRange: anchor.range,
            candidates: [],
        };
    }
    if (anchor.selectedText.length === 0) {
        return { state: 'changed', currentRange: null, candidates: [] };
    }
    const matches: ReanchorCandidate[] = [];
    let from = 0;
    while (matches.length <= 100) {
        const index = currentText.indexOf(anchor.selectedText, from);
        if (index < 0) break;
        const start = positionAt(currentText, index);
        const end = positionAt(currentText, index + anchor.selectedText.length);
        const nearby = currentText.slice(Math.max(0, index - 1_024), index);
        const following = currentText.slice(index + anchor.selectedText.length, index + anchor.selectedText.length + 1_024);
        let score = 1;
        if (anchor.contextBefore && nearby.endsWith(anchor.contextBefore)) score += 1;
        if (anchor.contextAfter && following.startsWith(anchor.contextAfter)) score += 1;
        matches.push({ id: newEntityId(), range: { start, end }, score });
        from = index + Math.max(1, anchor.selectedText.length);
    }
    const strongest = Math.max(0, ...matches.map((item) => item.score));
    const candidates = matches.filter((item) => item.score === strongest);
    if (candidates.length === 1) return { state: 'moved', currentRange: candidates[0]?.range ?? null, candidates };
    if (candidates.length > 1) return { state: 'ambiguous', currentRange: null, candidates };
    return { state: currentText.length === 0 ? 'missing' : 'changed', currentRange: null, candidates: [] };
}
