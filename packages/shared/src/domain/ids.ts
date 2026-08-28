/**
 * 노드와 트레일 식별자.
 *
 * 확장은 프로세스 전역 카운터(`n1`, `n2` …)를 썼다. 서버 하나가 여러 트레일을 들고
 * 여러 탭에 같은 이벤트를 뿌리는 지금 구조에서는 그 방식이 위험하다 — 서버를 다시
 * 띄우면 번호가 되돌아가고, 저장된 트레일과 새로 만든 노드의 번호가 겹친다.
 * 그래서 UUID v4 를 쓴다.
 */

type UuidCapableCrypto = { randomUUID(): string };

function getCrypto(): UuidCapableCrypto {
    const c = (globalThis as { crypto?: Partial<UuidCapableCrypto> }).crypto;
    if (!c || typeof c.randomUUID !== 'function') {
        throw new Error(
            'crypto.randomUUID 를 쓸 수 없다. Node 19 이상 또는 보안 컨텍스트의 브라우저가 필요하다.',
        );
    }
    return c as UuidCapableCrypto;
}

export function newTrailId(): string {
    return getCrypto().randomUUID();
}

export function newNodeId(): string {
    return getCrypto().randomUUID();
}

export function newCommandId(): string {
    return getCrypto().randomUUID();
}

export function newEventId(): string {
    return getCrypto().randomUUID();
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 저장 파일에서 읽은 ID 가 UUID 인지. 파일명으로 쓰기 전에 반드시 통과시킨다. */
export function isUuid(value: string): boolean {
    return UUID_V4.test(value);
}
