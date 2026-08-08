import { ResolvedSymbol, kindName } from './symbols';

export interface TrailOrigin {
    /** 부모 코드에서 클릭된 절대 줄 번호 (0-based, 원본 파일 기준) */
    line: number;
    char: number;
    /** 클릭된 식별자 텍스트 */
    text: string;
}

export interface TrailNode {
    id: string;
    parentId: string | null;
    symbol: ResolvedSymbol;
    origin: TrailOrigin | null;
    collapsed: boolean;
    /** 조상 중에 같은 위치의 심볼이 이미 있으면 true (재귀/순환) */
    recursive: boolean;
    children: TrailNode[];
}

let counter = 0;
function nextId(): string {
    counter += 1;
    return `n${counter}`;
}

export class Trail {
    roots: TrailNode[] = [];
    private index = new Map<string, TrailNode>();

    get isEmpty(): boolean {
        return this.roots.length === 0;
    }

    get(id: string): TrailNode | undefined {
        return this.index.get(id);
    }

    addRoot(symbol: ResolvedSymbol): TrailNode {
        const node: TrailNode = {
            id: nextId(),
            parentId: null,
            symbol,
            origin: null,
            collapsed: false,
            recursive: false,
            children: [],
        };
        this.roots.push(node);
        this.index.set(node.id, node);
        return node;
    }

    addChild(parentId: string, symbol: ResolvedSymbol, origin: TrailOrigin): TrailNode | undefined {
        const parent = this.index.get(parentId);
        if (!parent) {
            return undefined;
        }
        const node: TrailNode = {
            id: nextId(),
            parentId,
            symbol,
            origin,
            collapsed: false,
            recursive: this.isAncestorSymbol(parent, symbol),
            children: [],
        };
        parent.children.push(node);
        this.index.set(node.id, node);
        return node;
    }

    /** 같은 부모 아래에 같은 대상이 이미 있으면 그 노드를 돌려준다. */
    findExistingChild(parentId: string, symbol: ResolvedSymbol): TrailNode | undefined {
        const parent = this.index.get(parentId);
        if (!parent) {
            return undefined;
        }
        return parent.children.find(
            (c) => c.symbol.uri === symbol.uri && c.symbol.anchorLine === symbol.anchorLine,
        );
    }

    private isAncestorSymbol(from: TrailNode, symbol: ResolvedSymbol): boolean {
        let cur: TrailNode | undefined = from;
        while (cur) {
            if (cur.symbol.uri === symbol.uri && cur.symbol.anchorLine === symbol.anchorLine) {
                return true;
            }
            cur = cur.parentId ? this.index.get(cur.parentId) : undefined;
        }
        return false;
    }

    /**
     * 자식 노드를 트리 맨 위로 떼어내 독립된 루트로 만든다. 하위 노드는 함께 따라간다.
     *
     * 깊이 들어간 노드를 기준점으로 삼고 싶을 때 쓴다. 부모에서 왔다는 사실은
     * 더 이상 유효하지 않으므로 진입 정보(origin)를 지우고, 조상이 달라졌으니
     * 하위 노드의 재귀 표시도 새 사슬 기준으로 다시 계산한다.
     */
    promoteToRoot(id: string): TrailNode | undefined {
        const node = this.index.get(id);
        if (!node || node.parentId === null) {
            return undefined;
        }
        const parent = this.index.get(node.parentId);
        if (parent) {
            const i = parent.children.indexOf(node);
            if (i >= 0) {
                parent.children.splice(i, 1);
            }
        }
        node.parentId = null;
        node.origin = null;
        node.recursive = false;
        this.roots.push(node);
        this.recomputeRecursive(node);
        return node;
    }

    private recomputeRecursive(from: TrailNode): void {
        const walk = (n: TrailNode) => {
            for (const c of n.children) {
                c.recursive = this.isAncestorSymbol(n, c.symbol);
                walk(c);
            }
        };
        walk(from);
    }

    remove(id: string): void {
        const node = this.index.get(id);
        if (!node) {
            return;
        }
        const siblings = node.parentId ? this.index.get(node.parentId)?.children : this.roots;
        if (siblings) {
            const i = siblings.indexOf(node);
            if (i >= 0) {
                siblings.splice(i, 1);
            }
        }
        const drop = (n: TrailNode) => {
            this.index.delete(n.id);
            n.children.forEach(drop);
        };
        drop(node);
    }

    setCollapsed(id: string, collapsed: boolean): void {
        const node = this.index.get(id);
        if (node) {
            node.collapsed = collapsed;
        }
    }

    clear(): void {
        this.roots = [];
        this.index.clear();
    }

    ancestorsOf(id: string): TrailNode[] {
        const chain: TrailNode[] = [];
        let cur = this.index.get(id);
        while (cur) {
            chain.unshift(cur);
            cur = cur.parentId ? this.index.get(cur.parentId) : undefined;
        }
        return chain;
    }

    toJSON(): string {
        return JSON.stringify({ version: 1, roots: this.roots }, null, 2);
    }

    loadJSON(text: string): void {
        const data = JSON.parse(text) as { version?: number; roots?: TrailNode[] };
        if (!data.roots || !Array.isArray(data.roots)) {
            throw new Error('roots 배열이 없다. Code Trail이 저장한 파일이 맞는지 확인 필요.');
        }
        this.clear();
        const reindex = (n: TrailNode, parentId: string | null) => {
            n.id = nextId();
            n.parentId = parentId;
            n.children = n.children ?? [];
            this.index.set(n.id, n);
            n.children.forEach((c) => reindex(c, n.id));
        };
        this.roots = data.roots;
        this.roots.forEach((r) => reindex(r, null));
    }

    toMarkdown(): string {
        const out: string[] = ['# Code Trail', ''];
        const walk = (n: TrailNode, depth: number) => {
            const hashes = '#'.repeat(Math.min(6, depth + 2));
            const loc = `${n.symbol.relPath}:${n.symbol.anchorLine + 1}`;
            const rec = n.recursive ? ' _(재귀)_' : '';
            out.push(`${hashes} ${'└ '.repeat(0)}${n.symbol.name} \`${kindName(n.symbol.kind)}\`${rec}`);
            out.push('');
            if (n.origin) {
                out.push(`> 진입: 부모의 ${n.origin.line + 1}번째 줄 \`${n.origin.text}\` 에서`);
                out.push('');
            }
            out.push(`\`${loc}\``);
            out.push('');
            out.push('```' + mdLang(n.symbol.languageId));
            out.push(n.symbol.code);
            out.push('```');
            out.push('');
            n.children.forEach((c) => walk(c, depth + 1));
        };
        this.roots.forEach((r) => walk(r, 0));
        return out.join('\n');
    }
}

function mdLang(languageId: string): string {
    const map: Record<string, string> = {
        cpp: 'cpp',
        c: 'c',
        csharp: 'csharp',
        go: 'go',
        rust: 'rust',
        typescript: 'ts',
        javascript: 'js',
        python: 'python',
    };
    return map[languageId] ?? languageId;
}
