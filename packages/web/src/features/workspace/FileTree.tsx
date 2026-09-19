import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { api, type WorkspaceEntry } from '../../api/http.js';

/**
 * 파일 탐색기 (구현서 10.1).
 *
 * 펼칠 때 그 디렉터리 한 단계만 읽는다. 전체를 미리 훑지 않는 이유는 큰
 * 저장소에서 시작이 몇 초씩 걸리기 때문이고, 읽지 않은 파일에는 문서 권한도
 * 발급되지 않기 때문이다.
 *
 * **어떤 길로 열어도 트리가 그 자리를 보여준다**(V21). 검색·변경 목록·최근
 * 파일로 연 파일이 트리에 안 보이면 지금 어느 폴더를 보고 있는지 알 수 없다.
 */

export interface FileTreeProps {
    onOpenFile: (relPath: string) => void;
    /** 지금 열려 있는 파일의 상대경로. */
    activePath: string | null;
    /** 변경된 파일의 상대경로 → 상태. 줄 색을 가른다(V21). */
    changedPaths: ReadonlyMap<string, string>;
}

interface DirectoryState {
    entries: WorkspaceEntry[];
    truncated: boolean;
}

export function FileTree({ onOpenFile, activePath, changedPaths }: FileTreeProps): JSX.Element {
    const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
    const [error, setError] = useState<string | null>(null);
    const rootRef = useRef<HTMLUListElement | null>(null);

    const load = useCallback(async (id: string): Promise<DirectoryState | null> => {
        try {
            const result = await api.children(id);
            const state = { entries: result.entries, truncated: result.truncated };
            setDirectories((prev) => ({ ...prev, [id]: state }));
            return state;
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
            return null;
        }
    }, []);

    useEffect(() => {
        void load('');
    }, [load]);

    /**
     * 열린 파일까지 한 단계씩 펼친다 (V21).
     *
     * 디렉터리 하나가 `truncated` 면 거기서 멈춘다 — 그 아래는 목록에 없으므로
     * 더 내려가도 보여줄 줄이 없고, 검색을 권하는 기존 문구가 그 자리에 남는다.
     */
    const revealPath = useCallback(async (relPath: string): Promise<void> => {
        const parts = relPath.split('/');
        let walked = '';
        for (let index = 0; index < parts.length - 1; index += 1) {
            // 갱신 함수가 나중에 불리므로 이 단계의 경로를 지역 상수로 잡는다.
            // 바깥 변수를 그대로 쓰면 마지막 값만 펼쳐진다.
            const prefix = walked === '' ? (parts[index] ?? '') : `${walked}/${parts[index]}`;
            walked = prefix;
            const state = await load(prefix);
            setExpanded((prev) => (prev.has(prefix) ? prev : new Set([...prev, prefix])));
            if (state === null || state.truncated) return;
        }
    }, [load]);

    useEffect(() => {
        if (activePath === null) return;
        void revealPath(activePath).then(() => {
            window.setTimeout(() => {
                rootRef.current
                    ?.querySelector<HTMLElement>('.tree-file.active')
                    ?.scrollIntoView({ block: 'nearest' });
            }, 0);
        });
    }, [activePath, revealPath]);

    const toggle = useCallback(
        (id: string) => {
            setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(id)) {
                    next.delete(id);
                } else {
                    next.add(id);
                    void load(id);
                }
                return next;
            });
        },
        [load],
    );

    /** 이 디렉터리 아래에 변경된 파일이 있는지. 디렉터리 줄에 점을 찍는다. */
    const hasChangeBelow = (id: string): boolean => {
        const prefix = `${id}/`;
        for (const relPath of changedPaths.keys()) {
            if (relPath.startsWith(prefix)) return true;
        }
        return false;
    };

    const renderLevel = (parentId: string, depth: number): JSX.Element[] => {
        const state = directories[parentId];
        if (!state) {
            return [];
        }
        const rows: JSX.Element[] = [];
        for (const entry of state.entries) {
            const isOpen = expanded.has(entry.id);
            const status = changedPaths.get(entry.id);
            const changeClass = entry.kind === 'file' && status !== undefined
                ? ` changed ${status}`
                : '';
            rows.push(
                <li key={entry.id}>
                    <button
                        type="button"
                        className={
                            entry.kind === 'directory'
                                ? `tree-row tree-dir${hasChangeBelow(entry.id) ? ' has-change' : ''}`
                                : `tree-row tree-file${activePath === entry.id ? ' active' : ''}${changeClass}`
                        }
                        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
                        {...(status === undefined ? {} : { title: `변경: ${status}` })}
                        onClick={() =>
                            entry.kind === 'directory' ? toggle(entry.id) : onOpenFile(entry.id)}
                    >
                        <span className="tree-mark">
                            {entry.kind === 'directory' ? (isOpen ? '▾' : '▸') : ''}
                        </span>
                        {entry.name}
                    </button>
                    {entry.kind === 'directory' && isOpen ? (
                        <ul className="tree-list">{renderLevel(entry.id, depth + 1)}</ul>
                    ) : null}
                </li>,
            );
        }
        if (state.truncated) {
            rows.push(
                <li key={`${parentId}:truncated`} className="tree-note">
                    항목이 많아 일부만 보인다. 검색을 쓴다.
                </li>,
            );
        }
        return rows;
    };

    if (error !== null) {
        // 목록 자체를 못 읽은 것이라 그 자리에 적는다. 알림으로 띄우면
        // 빈 트리만 남아 "파일이 없다" 로 보인다.
        return <p className="tree-error">{error}</p>;
    }

    return (
        <>
            <div className="tree-tools">
                <button
                    type="button"
                    onClick={() => setExpanded(new Set(['']))}
                    title="열어둔 폴더를 모두 접는다"
                >
                    전부 접기
                </button>
                <button
                    type="button"
                    disabled={activePath === null}
                    onClick={() => { if (activePath !== null) void revealPath(activePath); }}
                    title="지금 보고 있는 파일 자리로"
                >
                    현재 파일 위치
                </button>
            </div>
            <ul className="tree-list tree-root" ref={rootRef}>{renderLevel('', 0)}</ul>
        </>
    );
}
