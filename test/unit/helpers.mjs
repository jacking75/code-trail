/**
 * 단위 테스트 공용 도구.
 *
 * 테스트는 `packages/shared/dist` 를 그대로 불러온다. 소스를 직접 읽지 않는 이유는
 * "빌드된 결과가 동작하는가" 가 확인하고 싶은 것이기 때문이다. 그래서 테스트를
 * 돌리기 전에 `npm run build -w @code-trail/shared` 가 한 번 돌아야 한다.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const shared = await import(
    new URL('../../packages/shared/dist/index.js', import.meta.url).href
);

/** `test/fixtures/*.json` 을 읽는다. */
export function fixture(name) {
    return require(`../fixtures/${name}`);
}

let counter = 0;

/**
 * 테스트용 심볼. 같은 파일·같은 줄이면 같은 심볼로 취급되므로,
 * 재귀를 만들고 싶으면 `relPath` 와 `anchorLine` 을 같게 주면 된다.
 */
export function makeSymbol(overrides = {}) {
    counter += 1;
    return {
        name: `Sym${counter}`,
        detail: '',
        container: '',
        kind: 12,
        relPath: `src/file${counter}.cpp`,
        displayPath: `proj/src/file${counter}.cpp`,
        external: false,
        languageId: 'cpp',
        code: `void Sym${counter}() {}`,
        startLine: 10,
        anchorLine: 10,
        anchorChar: 5,
        approximate: false,
        callable: true,
        declarationOnly: false,
        contentHash: null,
        modifiedAt: null,
        documentId: null,
        ...overrides,
    };
}

export function makeOrigin(overrides = {}) {
    return { line: 12, char: 4, text: 'call', ...overrides };
}

/** 시각을 고정한 트레일. 저장 결과를 바이트 단위로 비교하려면 시계가 멈춰 있어야 한다. */
export function makeTrail(overrides = {}) {
    return new shared.Trail({
        title: '테스트 트레일',
        createdAt: '2026-01-01T00:00:00.000Z',
        now: () => '2026-01-01T00:00:00.000Z',
        ...overrides,
    });
}
