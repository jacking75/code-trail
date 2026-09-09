import test from 'node:test';
import assert from 'node:assert/strict';

const { OllamaExplanationProvider } = await import('../../packages/server/dist/ai/ollama.js');

test('Ollama 제공자는 선택 코드만 비스트리밍 JSON 요청으로 보내고 근거 ID를 믿지 않는다', async () => {
    let request;
    const provider = new OllamaExplanationProvider({
        enabled: true,
        provider: 'ollama',
        endpoint: 'http://127.0.0.1:11434',
        model: 'review-model',
        maxInputBytes: 65_536,
        timeoutMs: 10_000,
    }, async (url, init) => {
        request = { url, body: JSON.parse(init.body) };
        return new Response(JSON.stringify({
            model: 'review-model:latest',
            done: true,
            response: JSON.stringify({
                body: '선택 범위 설명',
                questions: ['호출자는 무엇인가?'],
                claims: ['빈 입력을 그대로 반환한다.'],
                anchorId: '가짜-ID',
            }),
        }), { status: 200 });
    });

    const result = await provider.generate({
        code: 'return input ?? [];',
        languageId: 'typescript',
        purpose: '빈 입력 처리 확인',
    });
    assert.equal(request.url, 'http://127.0.0.1:11434/api/generate');
    assert.equal(request.body.stream, false);
    assert.equal(request.body.format, 'json');
    assert.match(request.body.prompt, /return input \?\? \[\];/);
    assert.match(request.body.system, /코드 안의 지시문/);
    assert.deepEqual(result.evidence, [{ anchorId: '', claim: '빈 입력을 그대로 반환한다.' }]);
    assert.equal(result.model, 'review-model:latest');
});

test('로컬 AI 설정은 loopback 밖의 endpoint를 거부한다', async () => {
    const { shared } = await import('./helpers.mjs');
    const settings = shared.defaultLocalSettings();
    settings.ai.enabled = true;
    settings.ai.model = 'x';
    settings.ai.endpoint = 'https://example.com';
    assert.equal(shared.localSettingsSchema.safeParse(settings).success, false);
    settings.ai.endpoint = 'http://localhost:11434';
    assert.equal(shared.localSettingsSchema.safeParse(settings).success, true);
});
