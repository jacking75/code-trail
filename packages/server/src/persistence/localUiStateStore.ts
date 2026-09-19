import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { localUiStateSchema, parseWith, type LocalUiState } from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import { writeFileAtomic } from './atomic.js';

/**
 * 개인 화면 상태 (V18).
 *
 * `.code-trail/local/ui-state.json` 하나에 담는다. `local/` 은 자체 `.gitignore`
 * 로 통째로 빠지므로 다른 사람의 저장소에 이 기계의 습관이 섞이지 않는다.
 *
 * **`localStorage` 를 대신한다.** origin 이 `127.0.0.1:<포트>` 이고 포트 기본값이
 * 0(운영체제가 고른다)이라 서버를 다시 띄우면 다른 origin 이 되고, 저장한 줄
 * 알았던 사이드바 폭·기록 열·이동 이력이 매번 초기화됐다.
 *
 * **절대경로·documentId·토큰을 담지 않는다.** 담기는 것은 스키마가 정한 값뿐이다.
 */

export const LOCAL_UI_STATE_FILE = 'ui-state.json';

/** 저장을 몰아 보내는 간격. 사이드바를 끄는 동안 매 프레임 쓰지 않는다. */
const SAVE_DEBOUNCE_MS = 500;

export interface LocalUiStateStoreOptions {
    /** `.code-trail/local` 디렉터리. `ProjectStore.localDir` 을 그대로 받는다. */
    localDir: string;
    logger: Logger;
    /** 임시 디렉터리에서 도는 공유 읽기 모드에서는 저장하지 않는다. */
    readOnly?: boolean;
    debounceMs?: number;
}

export class LocalUiStateStore {
    private readonly file: string;
    private readonly logger: Logger;
    private state: LocalUiState | null = null;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private pending: Promise<void> = Promise.resolve();

    constructor(private readonly options: LocalUiStateStoreOptions) {
        this.file = path.join(options.localDir, LOCAL_UI_STATE_FILE);
        this.logger = options.logger.child('local-ui');
    }

    /** 파일을 읽는다. 손상됐으면 조용히 버린다 — 개인 화면 상태는 복구 대상이 아니다. */
    async load(): Promise<void> {
        try {
            const parsed = parseWith(localUiStateSchema, JSON.parse(await readFile(this.file, 'utf8')));
            this.state = parsed.ok ? parsed.value : null;
        } catch {
            this.state = null;
        }
    }

    get(): LocalUiState | null {
        return this.state;
    }

    /**
     * 화면이 보낸 값을 기억하고 곧 쓴다.
     *
     * 여러 탭이 같은 파일을 쓴다 — 마지막에 쓴 탭이 이긴다. 방송하지 않는다.
     * 옆 탭의 사이드바 폭이 따라 움직이면 방해다.
     */
    save(state: LocalUiState): void {
        this.state = state;
        if (this.options.readOnly === true) {
            return;
        }
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.pending = this.pending.then(() => this.write()).catch(() => undefined);
        }, this.options.debounceMs ?? SAVE_DEBOUNCE_MS);
    }

    private async write(): Promise<void> {
        const value = this.state;
        if (value === null) {
            return;
        }
        try {
            await writeFileAtomic(this.file, `${JSON.stringify(value, null, 2)}\n`);
        } catch (error) {
            this.logger.warn('개인 화면 상태를 저장하지 못했다.', {
                reason: error instanceof Error ? error.message : String(error),
            });
        }
    }

    /** 종료 절차. 대기 중인 쓰기를 끝낸다. */
    async flush(): Promise<void> {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
            this.pending = this.pending.then(() => this.write()).catch(() => undefined);
        }
        await this.pending;
    }
}
