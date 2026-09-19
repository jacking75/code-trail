import type { Trail, TrailNode } from './trail.js';
import { kindName } from './symbol.js';
import type {
    Annotation,
    AnnotationTarget,
    ReviewRecord,
    ReviewState,
    Walkthrough,
} from './analysis.js';

/**
 * 언어 ID 를 Markdown 코드 펜스의 언어 이름으로 바꾼다.
 * 모르는 언어는 그대로 쓴다 — 잘못된 이름이어도 코드 블록 자체는 깨지지 않는다.
 */
const FENCE_LANG: Record<string, string> = {
    c: 'c',
    cpp: 'cpp',
    csharp: 'csharp',
    go: 'go',
    rust: 'rust',
    typescript: 'ts',
    javascript: 'js',
    python: 'python',
};

function fenceLang(languageId: string): string {
    return FENCE_LANG[languageId] ?? languageId;
}

/**
 * 코드 안에 백틱 세 개가 들어 있으면 펜스가 먼저 닫혀 문서가 깨진다.
 * 코드를 고치지 않고 펜스 쪽을 늘려 피한다 — 원본을 변형하지 않는다는 규칙 그대로다.
 */
function fenceFor(code: string): string {
    let longest = 0;
    for (const run of code.match(/`+/g) ?? []) {
        longest = Math.max(longest, run.length);
    }
    return '`'.repeat(Math.max(3, longest + 1));
}

/** 기록 본문은 Markdown 으로 해석하지 않는다. 받은 글자를 그대로 읽히게만 한다. */
function plain(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const KIND_LABEL: Record<string, string> = {
    explanation: '설명',
    question: '질문',
    concern: '우려',
    conclusion: '결론',
};

const REVIEW_LABEL: Record<ReviewState, string> = {
    unreviewed: '미검토',
    reviewing: '확인 중',
    reviewed: '확인함',
    needsReview: '재검토',
};

/** 원문자 순번. 헤더의 ①과 같은 글자다. 20을 넘으면 괄호 숫자로 떨어진다. */
function circled(index: number): string {
    return index >= 1 && index <= 20
        ? String.fromCharCode(0x2460 + index - 1)
        : `(${index})`;
}

export interface MarkdownOptions {
    /** 문서 제목. 없으면 트레일 제목을 쓴다. */
    title?: string;
    /**
     * 함께 실을 기록. 노드 대상과 트레일 대상만 본다 — 범위 대상은 어느 노드
     * 아래에 붙일지 정할 근거가 여기 없다(앵커는 분석 문서에 있다).
     */
    annotations?: readonly Annotation[];
    /** 검토 기록. 노드 헤더에 `확인함` 배지를 붙인다. */
    reviews?: readonly ReviewRecord[];
    /** 안내 순서. 문서 맨 뒤에 목록으로 적는다. */
    walkthroughs?: readonly Walkthrough[];
    /** 맨 앞에 `flowchart TD` 블록을 넣는다. */
    mermaid?: boolean;
    /** 이 트레일의 ID. 대상이 이 트레일인 기록만 고르는 데 쓴다. */
    trailId?: string;
}

/**
 * Markdown 이 노드에서 보는 만큼만.
 *
 * `TrailNode` 를 그대로 받지 않는다 — 서버의 도메인 노드와 저장된 노드가 모두
 * 이 모양을 만족하므로, 어느 쪽에서 내보내도 같은 함수를 쓸 수 있다.
 */
export interface MarkdownNodeLike {
    id: string;
    origin: { line: number; text: string } | null;
    recursive: boolean;
    symbol: {
        name: string;
        kind: number;
        displayPath: string;
        anchorLine: number;
        code: string;
        languageId: string;
        declarationOnly: boolean;
        approximate: boolean;
    };
    children: readonly MarkdownNodeLike[];
}

/** 노드 하나에 붙일 기록·검토를 미리 모아 둔다. 노드마다 다시 훑지 않는다. */
interface Attachments {
    byNode: Map<string, Annotation[]>;
    reviewByNode: Map<string, ReviewState>;
    trailLevel: Annotation[];
}

function collect(options: MarkdownOptions): Attachments {
    const byNode = new Map<string, Annotation[]>();
    const reviewByNode = new Map<string, ReviewState>();
    const trailLevel: Annotation[] = [];
    for (const annotation of options.annotations ?? []) {
        if (annotation.deletedAt !== null) {
            continue;
        }
        const target = annotation.target as AnnotationTarget;
        if (target.kind === 'node') {
            byNode.set(target.nodeId, [...(byNode.get(target.nodeId) ?? []), annotation]);
        } else if (target.kind === 'trail'
            && (options.trailId === undefined || target.trailId === options.trailId)) {
            trailLevel.push(annotation);
        }
    }
    for (const review of options.reviews ?? []) {
        const target = review.target as AnnotationTarget;
        if (target.kind === 'node') {
            reviewByNode.set(target.nodeId, review.state);
        }
    }
    return { byNode, reviewByNode, trailLevel };
}

function nodeSection(
    node: MarkdownNodeLike,
    depth: number,
    ordinal: number,
    attachments: Attachments,
    out: string[],
): void {
    const hashes = '#'.repeat(Math.min(6, depth + 2));
    const badges: string[] = [];
    if (node.recursive) {
        badges.push('재귀');
    }
    if (node.symbol.declarationOnly) {
        badges.push('선언만');
    }
    if (node.symbol.approximate) {
        badges.push('근사');
    }
    const review = attachments.reviewByNode.get(node.id);
    if (review !== undefined && review !== 'unreviewed') {
        badges.push(REVIEW_LABEL[review]);
    }
    const badge = badges.length > 0 ? ` _(${badges.join(', ')})_` : '';
    const index = ordinal > 0 ? `${circled(ordinal)} ` : '';

    out.push(`${hashes} ${index}${node.symbol.name} \`${kindName(node.symbol.kind)}\`${badge}`);
    out.push('');
    if (node.origin) {
        out.push(`> 진입: 부모의 ${node.origin.line + 1}번째 줄 \`${node.origin.text}\` 에서`);
        out.push('');
    }
    out.push(`\`${node.symbol.displayPath}:${node.symbol.anchorLine + 1}\``);
    out.push('');

    const fence = fenceFor(node.symbol.code);
    out.push(fence + fenceLang(node.symbol.languageId));
    out.push(node.symbol.code);
    out.push(fence);
    out.push('');

    // 기록은 코드 블록 바로 뒤 인용이다. 무엇에 대한 말인지가 바로 위에 있다.
    for (const annotation of attachments.byNode.get(node.id) ?? []) {
        const label = KIND_LABEL[annotation.kind] ?? annotation.kind;
        const state = annotation.status === 'resolved' ? ' · 해결됨' : '';
        out.push(`> **${label}${state}** — ${plain(annotation.body).replace(/\r?\n/g, '\n> ')}`);
        if (annotation.tags.length > 0) {
            out.push(`> _태그: ${plain(annotation.tags.join(', '))}_`);
        }
        out.push('');
    }

    node.children.forEach((child, childIndex) =>
        nodeSection(child, depth + 1, childIndex + 1, attachments, out));
}

/**
 * 노드 하나와 그 하위만 Markdown 으로 (V08).
 *
 * PR 댓글에 함수 하나의 흐름을 붙이는 일에 쓴다. 형제는 담지 않는다 —
 * 담으면 "이 함수의 흐름" 이 아니라 트레일의 일부가 된다.
 */
export function subtreeToMarkdown(node: MarkdownNodeLike, options: MarkdownOptions = {}): string {
    const attachments = collect(options);
    const out: string[] = [];
    if (options.title !== undefined) {
        out.push(`# ${options.title}`, '');
    }
    nodeSection(node, 0, 0, attachments, out);
    return out.join('\n');
}

/**
 * 트레일 전체를 Markdown 문서로 만든다.
 *
 * 깊이는 제목 수준으로 나타내고 6단계에서 멈춘다. 진입 링크와 경로:줄 을 함께 적어
 * 문서만 보고도 원본을 찾아갈 수 있게 한다.
 *
 * 기록·검토·안내 순서를 함께 실으면 한 문서에 "흐름 + 코드 + 기록" 이 다 담긴다.
 * 어디서 내보내도 같은 형식이 되도록 공유 묶음의 Markdown 도 이 함수를 쓴다(V23).
 */
export function trailToMarkdown(trail: Trail, options: MarkdownOptions = {}): string {
    const attachments = collect({ ...options, trailId: options.trailId ?? trail.id });
    const out: string[] = [`# ${options.title ?? trail.title}`, ''];

    if (options.mermaid) {
        out.push(...mermaidBlock(trail), '');
    }

    for (const annotation of attachments.trailLevel) {
        const label = KIND_LABEL[annotation.kind] ?? annotation.kind;
        out.push(`> **${label}** — ${plain(annotation.body).replace(/\r?\n/g, '\n> ')}`);
        out.push('');
    }

    trail.roots.forEach((root, index) =>
        nodeSection(root, 0, trail.roots.length > 1 ? index + 1 : 0, attachments, out));

    const walkthroughs = options.walkthroughs ?? [];
    if (walkthroughs.length > 0) {
        out.push('## 안내 순서', '');
        for (const walkthrough of walkthroughs) {
            out.push(`### ${plain(walkthrough.title)}`, '');
            walkthrough.steps.forEach((step, index) => {
                const body = step.body.trim() === ''
                    ? ''
                    : ` — ${plain(step.body).replace(/\r?\n/g, ' ')}`;
                out.push(`${index + 1}. **${plain(step.title)}**${body}`);
            });
            out.push('');
        }
    }

    return out.join('\n');
}

/**
 * 트리를 Mermaid `flowchart TD` 로 (V23).
 *
 * 이름에 `"` 가 들어갈 수 있으므로 `#quot;` 로 바꾼다 — Mermaid 가 아는 이스케이프다.
 * 재귀 노드는 점선 화살표로 구분한다.
 */
function mermaidBlock(trail: Trail): string[] {
    const lines = ['```mermaid', 'flowchart TD'];
    const key = new Map<string, string>();
    let next = 0;
    const idFor = (nodeId: string): string => {
        const existing = key.get(nodeId);
        if (existing !== undefined) {
            return existing;
        }
        const made = `n${next++}`;
        key.set(nodeId, made);
        return made;
    };
    const label = (value: string): string => value.replace(/"/g, '#quot;');
    const walk = (node: TrailNode, parent: TrailNode | null): void => {
        lines.push(`    ${idFor(node.id)}["${label(node.symbol.name)}"]`);
        if (parent !== null) {
            lines.push(`    ${idFor(parent.id)} ${node.recursive ? '-.->' : '-->'} ${idFor(node.id)}`);
        }
        node.children.forEach((child) => walk(child, node));
    };
    trail.roots.forEach((root) => walk(root, null));
    lines.push('```');
    return lines;
}
