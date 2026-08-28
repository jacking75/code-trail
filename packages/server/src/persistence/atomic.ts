import { open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * 원자적 파일 쓰기 (구현서 9.5).
 *
 * 같은 디렉터리에 `.tmp` 로 쓰고 flush 한 뒤 최종 이름으로 바꿔치기한다.
 * 다른 디렉터리에 쓰면 rename 이 파일 시스템 경계를 넘어 원자성이 깨진다.
 *
 * 중간에 프로세스가 죽으면 최종 파일은 이전 내용 그대로 남고 `.tmp` 만 남는다.
 * 남은 `.tmp` 는 시작할 때 복구 후보로 진단 화면에 올린다 — 조용히 지우지 않는다.
 */

export function tempPathFor(target: string): string {
    return `${target}.tmp`;
}

export async function writeFileAtomic(target: string, contents: string): Promise<void> {
    const temp = tempPathFor(target);
    const handle = await open(temp, 'w');
    try {
        await handle.writeFile(contents, 'utf8');
        // rename 전에 내용이 디스크에 닿아야 한다. 이게 없으면 전원이 끊겼을 때
        // "이름은 새것, 내용은 빈 파일" 이 남는다.
        await handle.sync();
    } finally {
        await handle.close();
    }
    try {
        await rename(temp, target);
    } catch (error) {
        // rename 이 실패하면 임시 파일이 남는다. 여기서만큼은 지운다 —
        // 최종 파일이 멀쩡하므로 복구 후보가 아니다.
        await unlink(temp).catch(() => undefined);
        throw error;
    }
}

/** `<name>.json.tmp` 에서 `<name>.json` 을 되돌린다. */
export function targetPathForTemp(tempFile: string): string {
    return tempFile.endsWith('.tmp') ? tempFile.slice(0, -'.tmp'.length) : tempFile;
}

export function isTempFile(fileName: string): boolean {
    return path.basename(fileName).endsWith('.tmp');
}
