import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

import type { Logger } from '../config/logger.js';
import { toPosixRelative } from '../security/paths.js';
import type { WorkspaceTree } from './tree.js';

/**
 * 파일 변경 감시.
 *
 * 목적 하나뿐이다: **열려 있는 노드의 스냅샷이 낡았다는 것을 알리는 것.**
 * 파일이 바뀌었다고 노드를 다시 읽거나 지우지 않는다(구현서 9.4) — 사용자가
 * 보고 있던 코드가 발밑에서 바뀌면 읽던 흐름이 끊긴다. 표시만 하고 갱신은 사용자가 정한다.
 *
 * `fs.watch` 는 플랫폼마다 동작이 다르고 이벤트를 흘리기도 한다. 그래서 이것을
 * 정확성의 근거로 삼지 않는다. 최종 판정은 저장된 `contentHash` 와 지금 파일
 * 해시의 비교다 — 감시는 "언제 비교해 볼지" 를 알려주는 신호일 뿐이다.
 */

export interface WorkspaceWatcherOptions {
    tree: WorkspaceTree;
    logger: Logger;
    /** 바뀐 파일의 `/` 구분 상대경로 묶음. */
    onChange: (relPaths: string[]) => void;
    /** 연달아 오는 이벤트를 모으는 시간. */
    debounceMs?: number;
}

export class WorkspaceWatcher {
    private watcher: FSWatcher | undefined;
    private readonly pending = new Set<string>();
    private timer: NodeJS.Timeout | undefined;
    private readonly logger: Logger;

    constructor(private readonly options: WorkspaceWatcherOptions) {
        this.logger = options.logger.child('watch');
    }

    start(): void {
        if (this.watcher) {
            return;
        }
        try {
            this.watcher = watch(
                this.options.tree.projectRoot,
                { recursive: true, persistent: false },
                (_event, fileName) => {
                    if (typeof fileName === 'string') {
                        this.record(fileName);
                    }
                },
            );
            this.watcher.on('error', (error) => {
                this.logger.warn('파일 감시가 멈췄다. 변경 표시가 늦을 수 있다.', {
                    reason: error.message,
                });
                this.stop();
            });
        } catch (error) {
            // recursive 감시를 지원하지 않는 플랫폼이 있다. 감시 없이도 동작해야 한다.
            this.logger.warn('파일 감시를 켤 수 없다. 변경 표시는 다시 열 때만 갱신된다.', {
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.watcher?.close();
        this.watcher = undefined;
        this.pending.clear();
    }

    private record(rawName: string): void {
        const relPath = toPosixRelative(path.normalize(rawName));
        if (relPath.startsWith('..')) {
            return;
        }
        if (this.options.tree.isExcludedRelPath(relPath)) {
            return;
        }
        // 우리가 쓰는 파일이다. 우리 저장이 우리 알림을 낳는 고리를 끊는다.
        if (relPath === '.code-trail' || relPath.startsWith('.code-trail/')) {
            return;
        }
        this.pending.add(relPath);

        if (this.timer) {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const batch = [...this.pending].sort();
            this.pending.clear();
            if (batch.length > 0) {
                this.options.onChange(batch);
            }
        }, this.options.debounceMs ?? 200);
        if (typeof this.timer.unref === 'function') {
            this.timer.unref();
        }
    }
}
