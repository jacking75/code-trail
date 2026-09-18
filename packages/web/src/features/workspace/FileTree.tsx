import { useCallback, useEffect, useState, type JSX } from 'react';

import { api, type WorkspaceEntry } from '../../api/http.js';

/**
 * 파일 탐색기 (구현서 10.1).
 *
 * 펼칠 때 그 디렉터리 한 단계만 읽는다. 전체를 미리 훑지 않는 이유는 큰
 * 저장소에서 시작이 몇 초씩 걸리기 때문이고, 읽지 않은 파일에는 문서 권한도
 * 발급되지 않기 때문이다.
 */

export interface FileTreeProps {
    onOpenFile: (relPath: string) => void;
    /** 지금 열려 있는 파일의 상대경로. */
    activePath: string | null;
}

interface DirectoryState {
    entries: WorkspaceEntry[];
    truncated: boolean;
}

export function FileTree({ onOpenFile, activePath }: FileTreeProps): JSX.Element {
    const [directories, setDirectories] = useState<Record<string, DirectoryState>>({});
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (id: string) => {
        try {
            const result = await api.children(id);
            setDirectories((prev) => ({
                ...prev,
                [id]: { entries: result.entries, truncated: result.truncated },
            }));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
    }, []);

    useEffect(() => {
        void load('');
    }, [load]);

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

    const renderLevel = (parentId: string, depth: number): JSX.Element[] => {
        const state = directories[parentId];
        if (!state) {
            return [];
        }
        const rows: JSX.Element[] = [];
        for (const entry of state.entries) {
            const isOpen = expanded.has(entry.id);
            rows.push(
                <li key={entry.id}>
                    <button
                        type="button"
                        className={
                            entry.kind === 'directory'
                                ? 'tree-row tree-dir'
                                : `tree-row tree-file${activePath === entry.id ? ' active' : ''}`
                        }
                        style={{ paddingInlineStart: `${depth * 12 + 8}px` }}
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
        <ul className="tree-list tree-root">{renderLevel('', 0)}</ul>
    );
}
