import {
    Trail,
    toTrailSummary,
    trailToMarkdown,
    type CommandError,
    type NodeUiState,
    type TrailMode,
    type TrailSummary,
    fromStoredTrail,
    type StoredTrail,
} from '@code-trail/shared';

import type { Logger } from '../config/logger.js';
import type { ProjectStore } from '../persistence/store.js';
import type { SaveScheduler } from '../persistence/scheduler.js';

/**
 * 트레일의 정본 (구현서 14.1).
 *
 * 서버 메모리가 정본이고 브라우저는 복사본만 그린다. 모든 변경은 명령으로 들어오고
 * 여기서 순서대로 처리된다. 트레일마다 mutation queue 를 둬 두 탭이 같은 순간에
 * 보낸 명령이 서로를 덮어쓰지 못하게 한다.
 *
 * 저장은 직접 하지 않고 `SaveScheduler` 에 맡긴다 — 명령 처리가 디스크를 기다리면
 * 화면이 멈춘다.
 */

export interface TrailMutationResult {
    trail: Trail;
    revision: number;
}

export type ServiceResult<T> =
    | { ok: true; value: T }
    | { ok: false; error: CommandError };

function notFound(what: string): CommandError {
    return { code: 'NOT_FOUND', message: `${what}을 찾을 수 없다.`, retryable: false };
}

function stale(current: number): CommandError {
    return {
        code: 'STALE_REVISION',
        message: '다른 곳에서 먼저 바뀌었다. 최신 상태를 받은 뒤 다시 시도한다.',
        retryable: true,
        details: { revision: current },
    };
}

export interface TrailServiceOptions {
    store: ProjectStore;
    scheduler: SaveScheduler;
    logger: Logger;
}

export class TrailService {
    private readonly trails = new Map<string, Trail>();
    private readonly queues = new Map<string, Promise<unknown>>();
    private activeTrailId: string | null = null;
    private readonly logger: Logger;

    constructor(private readonly options: TrailServiceOptions) {
        this.logger = options.logger.child('trail');
    }

    /** 저장된 트레일을 전부 메모리로 올린다. 서버가 뜨기 전에 한 번 부른다. */
    async load(): Promise<void> {
        const index = await this.options.store.loadIndex();
        for (const id of await this.options.store.listTrailIds()) {
            const trail = await this.options.store.loadTrail(id);
            if (trail) {
                this.trails.set(trail.id, trail);
            }
        }
        this.activeTrailId = index.activeTrailId !== null && this.trails.has(index.activeTrailId)
            ? index.activeTrailId
            : (this.firstTrailId() ?? null);
        this.logger.info('트레일을 불러왔다.', { count: this.trails.size });
    }

    private firstTrailId(): string | undefined {
        return [...this.trails.keys()].sort()[0];
    }

    get(trailId: string): Trail | undefined {
        return this.trails.get(trailId);
    }

    getActiveTrailId(): string | null {
        return this.activeTrailId;
    }

    list(): TrailSummary[] {
        return [...this.trails.values()]
            .map(toTrailSummary)
            .sort((a, b) => (a.id < b.id ? -1 : 1));
    }

    /**
     * 트레일 하나에 대한 변경을 줄 세워 실행한다.
     *
     * 명령 하나가 여러 await 를 거치는 동안 다른 명령이 끼어들면 revision 이
     * 뒤엉킨다. 트레일별로 직렬화하되 서로 다른 트레일은 나란히 돈다.
     */
    private enqueue<T>(trailId: string, work: () => Promise<T> | T): Promise<T> {
        const previous = this.queues.get(trailId) ?? Promise.resolve();
        const next = previous.then(work, work);
        this.queues.set(
            trailId,
            next.catch(() => undefined),
        );
        return next;
    }

    /** 변경 뒤 저장을 예약하고 목록도 갱신한다. */
    private afterMutation(trail: Trail): void {
        this.options.scheduler.schedule({
            key: `trail:${trail.id}`,
            revision: trail.revision,
            write: () => this.options.store.saveTrail(trail),
        });
        this.scheduleIndexSave();
    }

    private scheduleIndexSave(): void {
        this.options.scheduler.schedule({
            key: 'index',
            // 목록에는 revision 이 없다. 합으로 "뭔가 바뀌었다" 만 표현한다.
            revision: [...this.trails.values()].reduce((sum, t) => sum + t.revision, 0),
            write: () => this.options.store.saveIndex([...this.trails.values()], this.activeTrailId),
        });
    }

    // ── 명령 ────────────────────────────────────────────────────────────────

    async create(title?: string): Promise<TrailMutationResult> {
        const trail = new Trail(title !== undefined ? { title } : {});
        this.trails.set(trail.id, trail);
        this.activeTrailId = trail.id;
        // 아직 노드가 없어 revision 이 0 이다. 그래도 파일은 만든다 —
        // 다시 띄웠을 때 "만들었던 빈 트레일" 이 그대로 있어야 한다.
        this.options.scheduler.schedule({
            key: `trail:${trail.id}`,
            revision: trail.revision,
            write: () => this.options.store.saveTrail(trail),
        });
        this.scheduleIndexSave();
        return { trail, revision: trail.revision };
    }

    /** 검증한 공유 묶음을 새 ID로 바꾼 뒤 등록할 때만 사용한다. */
    async importStored(stored: StoredTrail): Promise<TrailMutationResult> {
        const trail = fromStoredTrail(stored);
        if (this.trails.has(trail.id)) {
            throw new Error('가져올 트레일 ID가 이미 있다.');
        }
        this.trails.set(trail.id, trail);
        this.activeTrailId = trail.id;
        await this.options.store.saveTrail(trail);
        this.scheduleIndexSave();
        return { trail, revision: trail.revision };
    }

    async remove(trailId: string): Promise<ServiceResult<null>> {
        if (!this.trails.has(trailId)) {
            return { ok: false, error: notFound('트레일') };
        }
        this.trails.delete(trailId);
        if (this.activeTrailId === trailId) {
            this.activeTrailId = this.firstTrailId() ?? null;
        }
        await this.options.store.deleteTrail(trailId);
        this.scheduleIndexSave();
        return { ok: true, value: null };
    }

    select(trailId: string): ServiceResult<null> {
        if (!this.trails.has(trailId)) {
            return { ok: false, error: notFound('트레일') };
        }
        this.activeTrailId = trailId;
        this.scheduleIndexSave();
        return { ok: true, value: null };
    }

    /**
     * 구조를 바꾸는 명령. `baseRevision` 이 지금과 다르면 거부한다.
     *
     * 거부는 실패가 아니라 "당신이 본 상태가 낡았다" 는 신호다. 부르는 쪽은
     * 최신 snapshot 을 보내 클라이언트를 따라잡게 한다(구현서 14.1).
     */
    mutate(
        trailId: string,
        baseRevision: number,
        apply: (trail: Trail) => boolean,
    ): Promise<ServiceResult<TrailMutationResult>> {
        return this.enqueue(trailId, () => {
            const trail = this.trails.get(trailId);
            if (!trail) {
                return { ok: false as const, error: notFound('트레일') };
            }
            if (trail.revision !== baseRevision) {
                return { ok: false as const, error: stale(trail.revision) };
            }
            const changed = apply(trail);
            if (changed) {
                this.afterMutation(trail);
            }
            return { ok: true as const, value: { trail, revision: trail.revision } };
        });
    }

    /** 트리 모양을 건드리지 않는 명령. revision 검사를 하지 않는다. */
    updateUi(
        trailId: string,
        apply: (trail: Trail) => boolean,
    ): Promise<ServiceResult<TrailMutationResult>> {
        return this.enqueue(trailId, () => {
            const trail = this.trails.get(trailId);
            if (!trail) {
                return { ok: false as const, error: notFound('트레일') };
            }
            if (apply(trail)) {
                this.afterMutation(trail);
            }
            return { ok: true as const, value: { trail, revision: trail.revision } };
        });
    }

    setMode(trailId: string, mode: TrailMode): Promise<ServiceResult<TrailMutationResult>> {
        return this.updateUi(trailId, (trail) => trail.setMode(mode));
    }

    setNodeUi(
        trailId: string,
        nodeId: string,
        patch: Partial<Record<keyof NodeUiState, number | null>>,
    ): Promise<ServiceResult<TrailMutationResult>> {
        return this.updateUi(trailId, (trail) => trail.setNodeUi(nodeId, patch));
    }

    setActiveNode(
        trailId: string,
        nodeId: string | null,
    ): Promise<ServiceResult<TrailMutationResult>> {
        return this.updateUi(trailId, (trail) => trail.setActiveNode(nodeId));
    }

    markdown(trailId: string): ServiceResult<string> {
        const trail = this.trails.get(trailId);
        if (!trail) {
            return { ok: false, error: notFound('트레일') };
        }
        return { ok: true, value: trailToMarkdown(trail) };
    }

    /** 종료 절차. 대기 중인 저장을 모두 끝낸다. */
    async flush(): Promise<void> {
        this.scheduleIndexSave();
        await this.options.scheduler.flush();
    }
}
