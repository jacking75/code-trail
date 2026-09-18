import type { ChildOrder, NodeUiState, TrailMode, TrailNode } from './trail.js';
import { NODE_UI_KEYS, Trail } from './trail.js';
import type { ResolvedSymbol } from './symbol.js';

/**
 * `.code-trail/trails/<trail-id>.json` 의 형식.
 *
 * 확장의 `version: 1` 형식과 호환하지 않는다(구현서 3.2). 노드 ID 가 UUID 가 되고,
 * revision·모드·노드별 화면 상태가 새로 들어온다.
 *
 * 사용자가 원하면 형상 관리할 수 있어야 하므로 **결정적으로** 쓴다. 키 순서와
 * 배열 순서를 고정하고 `nodeUi` 의 노드 ID 를 정렬한다. 같은 트레일을 두 번 저장하면
 * 바이트가 같아야 하고, 그래야 git diff 가 실제 변경만 보여준다.
 */
export const TRAIL_SCHEMA_VERSION = 1;

/** 저장되는 심볼. 세션 전용인 `documentId` 가 빠진 것이 런타임 타입과의 차이다. */
export type StoredSymbol = Omit<ResolvedSymbol, 'documentId'>;

export interface StoredTrailNode {
    id: string;
    parentId: string | null;
    symbol: StoredSymbol;
    origin: TrailNode['origin'];
    collapsed: boolean;
    recursive: boolean;
    children: StoredTrailNode[];
}

export interface StoredTrail {
    schemaVersion: typeof TRAIL_SCHEMA_VERSION;
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    activeNodeId: string | null;
    mode: TrailMode;
    /**
     * 이 트레일에서 고른 형제 정렬. 옛 저장 파일에는 없고, 없으면 화면이
     * `settings.ui.childOrder` 를 쓴다. 저장 버전은 1 그대로다.
     */
    childOrder?: ChildOrder | null;
    roots: StoredTrailNode[];
    nodeUi: Record<string, NodeUiState>;
}

function storeSymbol(symbol: StoredSymbol): StoredSymbol {
    // 키를 하나씩 세워 순서를 고정한다. 스프레드로 복사하면 입력 객체의
    // 키 순서가 그대로 파일에 새겨져 저장할 때마다 diff 가 흔들린다.
    return {
        name: symbol.name,
        detail: symbol.detail,
        container: symbol.container,
        kind: symbol.kind,
        relPath: symbol.relPath,
        displayPath: symbol.displayPath,
        external: symbol.external,
        languageId: symbol.languageId,
        startLine: symbol.startLine,
        anchorLine: symbol.anchorLine,
        anchorChar: symbol.anchorChar,
        approximate: symbol.approximate,
        callable: symbol.callable,
        declarationOnly: symbol.declarationOnly,
        contentHash: symbol.contentHash,
        modifiedAt: symbol.modifiedAt,
        code: symbol.code,
    };
}

function loadSymbol(stored: StoredSymbol): ResolvedSymbol {
    // 세션 문서 ID 는 저장하지 않았다. 다시 열 때 서버가 채운다.
    return { ...storeSymbol(stored), documentId: null };
}

function storeNode(node: TrailNode): StoredTrailNode {
    return {
        id: node.id,
        parentId: node.parentId,
        symbol: storeSymbol(node.symbol),
        origin: node.origin === null
            ? null
            : { line: node.origin.line, char: node.origin.char, text: node.origin.text },
        collapsed: node.collapsed,
        recursive: node.recursive,
        children: node.children.map(storeNode),
    };
}

function loadNode(stored: StoredTrailNode): TrailNode {
    return {
        id: stored.id,
        parentId: stored.parentId,
        symbol: loadSymbol(stored.symbol),
        origin: stored.origin === null
            ? null
            : { line: stored.origin.line, char: stored.origin.char, text: stored.origin.text },
        collapsed: stored.collapsed,
        recursive: stored.recursive,
        children: (stored.children ?? []).map(loadNode),
    };
}

function storeNodeUi(state: NodeUiState): NodeUiState {
    const out: NodeUiState = {};
    for (const key of NODE_UI_KEYS) {
        const value = state[key];
        if (value !== undefined) {
            out[key] = value;
        }
    }
    return out;
}

export function toStoredTrail(trail: Trail): StoredTrail {
    const nodeUi: Record<string, NodeUiState> = {};
    // `nodeUiEntries` 가 노드 ID 순으로 준다. JSON 객체의 키 순서가 그대로
    // 파일 순서가 되므로 여기서 다시 흔들지 않는다.
    for (const [id, state] of trail.nodeUiEntries()) {
        nodeUi[id] = storeNodeUi(state);
    }
    return {
        schemaVersion: TRAIL_SCHEMA_VERSION,
        id: trail.id,
        title: trail.title,
        createdAt: trail.createdAt,
        updatedAt: trail.updatedAt,
        revision: trail.revision,
        activeNodeId: trail.activeNodeId,
        mode: trail.mode,
        childOrder: trail.childOrder,
        roots: trail.roots.map(storeNode),
        nodeUi,
    };
}

export function fromStoredTrail(stored: StoredTrail, now?: () => string): Trail {
    const nodeUi: Record<string, NodeUiState> = {};
    for (const [id, state] of Object.entries(stored.nodeUi ?? {})) {
        nodeUi[id] = storeNodeUi(state);
    }
    return Trail.fromStructure({
        id: stored.id,
        title: stored.title,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        revision: stored.revision,
        mode: stored.mode,
        childOrder: stored.childOrder ?? null,
        activeNodeId: stored.activeNodeId,
        roots: (stored.roots ?? []).map(loadNode),
        nodeUi,
        ...(now ? { now } : {}),
    });
}

/** 파일에 쓸 문자열. 끝에 줄바꿈 하나를 붙여 POSIX 텍스트 파일로 만든다. */
export function stringifyStoredTrail(stored: StoredTrail): string {
    return `${JSON.stringify(stored, null, 2)}\n`;
}

/** 트레일 목록 화면과 `index.json` 이 쓰는 요약. 본문 코드는 담지 않는다. */
export interface TrailSummary {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    revision: number;
    nodeCount: number;
    rootCount: number;
}

export function toTrailSummary(trail: Trail): TrailSummary {
    return {
        id: trail.id,
        title: trail.title,
        createdAt: trail.createdAt,
        updatedAt: trail.updatedAt,
        revision: trail.revision,
        nodeCount: trail.size,
        rootCount: trail.roots.length,
    };
}
