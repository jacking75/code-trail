import type { Trail, TrailNode } from './trail.js';
import { kindName } from './symbol.js';

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

export interface MarkdownOptions {
    /** 문서 제목. 없으면 트레일 제목을 쓴다. */
    title?: string;
}

/**
 * 트레일 전체를 Markdown 문서로 만든다.
 *
 * 깊이는 제목 수준으로 나타내고 6단계에서 멈춘다. 진입 링크와 경로:줄 을 함께 적어
 * 문서만 보고도 원본을 찾아갈 수 있게 한다.
 */
export function trailToMarkdown(trail: Trail, options: MarkdownOptions = {}): string {
    const out: string[] = [`# ${options.title ?? trail.title}`, ''];

    const walk = (node: TrailNode, depth: number): void => {
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
        const badge = badges.length > 0 ? ` _(${badges.join(', ')})_` : '';

        out.push(`${hashes} ${node.symbol.name} \`${kindName(node.symbol.kind)}\`${badge}`);
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

        node.children.forEach((child) => walk(child, depth + 1));
    };

    trail.roots.forEach((root) => walk(root, 0));
    return out.join('\n');
}
