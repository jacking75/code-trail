/**
 * 화면이 들고 있는 트레일 복사본.
 *
 * 서버 타입을 그대로 쓰지 않고 여기 다시 적는다. `@code-trail/shared` 를 웹에서
 * 가져올 수는 있지만, 그러면 도메인 클래스(`Trail`)까지 번들에 들어온다.
 * 화면에 필요한 것은 **그려지는 모양**뿐이라 그 모양만 적는다.
 */

export interface ResolvedSymbolView {
    name: string;
    detail: string;
    container: string;
    kind: number;
    relPath: string | null;
    displayPath: string;
    external: boolean;
    languageId: string;
    code: string;
    startLine: number;
    anchorLine: number;
    anchorChar: number;
    approximate: boolean;
    callable: boolean;
    declarationOnly: boolean;
    contentHash: string | null;
    modifiedAt: string | null;
    documentId: string | null;
}

export interface TrailOriginView {
    line: number;
    char: number;
    text: string;
}

export interface TrailNodeView {
    id: string;
    parentId: string | null;
    symbol: ResolvedSymbolView;
    origin: TrailOriginView | null;
    collapsed: boolean;
    recursive: boolean;
    children: TrailNodeView[];
}

export interface NodeUiView {
    boardX?: number;
    boardY?: number;
    bodyHeight?: number;
    codeFontSize?: number;
}

export interface TrailSnapshot {
    id: string;
    title: string;
    revision: number;
    mode: 'tree' | 'board';
    /** 이 트레일에서 고른 형제 정렬. `null` 이면 설정 기본값을 쓴다. */
    childOrder: 'source' | 'click' | null;
    activeNodeId: string | null;
    roots: TrailNodeView[];
    nodeUi: Record<string, NodeUiView>;
}

export interface TrailSummaryView {
    id: string;
    title: string;
    revision: number;
    nodeCount: number;
    rootCount: number;
    /** 서버가 주는 시각. 트레일 목록이 최근순으로 세울 때 쓴다(V22). */
    createdAt?: string;
    updatedAt?: string;
}

export interface CandidateView {
    candidateId: string;
    name: string;
    displayPath: string;
    line: number;
    hasBody: boolean;
}

/**
 * 사용자가 골라야 하는 후보 목록.
 *
 * 정의 후보와 구현 후보가 같은 모양을 쓴다. 다른 것은 어디에 띄우느냐뿐이다 —
 * 정의는 클릭한 토큰 아래, 구현은 그 노드 헤더 아래.
 */
export interface DefinitionChoice {
    choiceId: string;
    nodeId: string | null;
    candidates: CandidateView[];
    /** 클릭한 지점. 있으면 그 토큰 바로 아래에 띄운다. */
    origin?: { line: number; char: number; text: string } | null;
    title?: string;
    /** 구현 목록이면 `전부 붙이기` 를 맨 위에 둔다. */
    kind?: 'definition' | 'implementation';
}

/**
 * LSP SymbolKind → 헤더에 찍는 종류 이름.
 *
 * 서버가 준 숫자는 **LSP 값**(1-based)이다. VS Code 값(0-based)과 하나 어긋나므로
 * 확장에서 옮겨온 표를 그대로 쓰면 안 된다.
 */
const KIND_NAMES: Record<number, string> = {
    1: 'file', 2: 'module', 3: 'namespace', 4: 'package', 5: 'class',
    6: 'method', 7: 'property', 8: 'field', 9: 'constructor', 10: 'enum',
    11: 'interface', 12: 'function', 13: 'variable', 14: 'constant', 15: 'string',
    16: 'number', 17: 'boolean', 18: 'array', 19: 'object', 20: 'key',
    21: 'null', 22: 'enum member', 23: 'struct', 24: 'event', 25: 'operator',
    26: 'type parameter',
};

export function kindName(kind: number): string {
    return KIND_NAMES[kind] ?? 'symbol';
}

/** 감싸는 이름을 헤더에 함께 보여줄 종류인지. 함수·메서드에는 붙이지 않는다. */
const CLASS_LIKE = new Set([2, 3, 5, 10, 11, 23]);

export function showsContainer(symbol: ResolvedSymbolView): boolean {
    return CLASS_LIKE.has(symbol.kind) && symbol.container !== '';
}

/**
 * 이름과 시그니처를 나눈다.
 *
 * Roslyn 은 `Foo(string, int) : Task<T>` 처럼 시그니처를 이름에 통째로 넣는다.
 * 그대로 두면 헤더가 네 줄로 깨진다.
 */
export function splitName(symbol: ResolvedSymbolView): { name: string; sig: string } {
    const raw = symbol.name;
    const cut = raw.indexOf('(');
    if (cut > 0) {
        return { name: raw.slice(0, cut).trim(), sig: raw.slice(cut).trim() };
    }
    return { name: raw, sig: symbol.detail.trim() };
}

/** `경로:줄`. 줄은 1-based 로 보여준다. */
export function locationLabel(symbol: ResolvedSymbolView): string {
    return `${symbol.displayPath}:${symbol.anchorLine + 1}`;
}

/** 1 → ①. 코드 안에 끼워 넣어도 한눈에 읽히도록. */
export function circled(n: number): string {
    return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`;
}

/** 트리 전체를 순회하며 노드를 찾는다. */
export function findNode(roots: readonly TrailNodeView[], id: string): TrailNodeView | undefined {
    for (const node of roots) {
        if (node.id === id) {
            return node;
        }
        const found = findNode(node.children, id);
        if (found) {
            return found;
        }
    }
    return undefined;
}

/** 루트부터 이 노드까지의 사슬. 브레드크럼이 쓴다. */
export function ancestorsOf(
    roots: readonly TrailNodeView[],
    id: string,
): TrailNodeView[] {
    const walk = (nodes: readonly TrailNodeView[], chain: TrailNodeView[]): TrailNodeView[] | null => {
        for (const node of nodes) {
            const next = [...chain, node];
            if (node.id === id) {
                return next;
            }
            const found = walk(node.children, next);
            if (found) {
                return found;
            }
        }
        return null;
    };
    return walk(roots, []) ?? [];
}
