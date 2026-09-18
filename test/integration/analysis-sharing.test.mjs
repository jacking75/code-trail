import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { authFetch, makeProject, removeProject, withServer } from './helpers.mjs';

const { AiExplanationService } = await import('../../packages/server/dist/ai/service.js');
const { contextForRange, createBaselineFile, sha256 } = await import('../../packages/server/dist/analysis/baselines.js');

const FILES = { 'src/a.cpp': 'void a() {\n\treturn;\n}\n' };

test('분석 기록은 재전송·재시작에도 중복되지 않고 디스크에서 복구된다', async () => {
    const root = await makeProject(FILES);
    const author = { id: randomUUID(), displayName: '검토자' };
    const commandId = randomUUID();
    let analysisId = '';
    let trailId = '';
    try {
        await withServer(root, async (running) => {
            trailId = (await running.context.trails.create('분석 대상')).trail.id;
            const analysis = await running.context.analyses.create({ title: '분석', trailIds: [trailId], author });
            analysisId = analysis.id;
            const input = {
                analysisId, commandId, target: { kind: 'trail', trailId }, body: '첫 기록',
                kind: 'explanation', tags: ['핵심'], author,
            };
            assert.equal((await running.context.analyses.createAnnotation(input)).ok, true);
            assert.equal((await running.context.analyses.createAnnotation(input)).ok, true);
            assert.equal(running.context.analyses.get(analysisId).annotations.length, 1);
        });

        await withServer(root, async (running) => {
            const input = {
                analysisId, commandId, target: { kind: 'trail', trailId }, body: '첫 기록',
                kind: 'explanation', tags: ['핵심'], author,
            };
            assert.equal((await running.context.analyses.createAnnotation(input)).ok, true);
            assert.equal(running.context.analyses.get(analysisId).annotations.length, 1);
        });
    } finally {
        await removeProject(root);
    }
});

test('분석 요약은 다루는 트레일을 함께 알려준다', async () => {
    // 트레일을 고르면 짝지은 분석이 따라온다(U11). 목록만 보고 짝을 찾을 수
    // 없으면 분석마다 전체 문서를 읽어야 한다.
    const root = await makeProject(FILES);
    const author = { id: randomUUID(), displayName: '검토자' };
    try {
        await withServer(root, async (running) => {
            const trailId = (await running.context.trails.create('로그인 검토')).trail.id;
            await running.context.analyses.create({ title: '분석', trailIds: [trailId], author });

            const listed = await (await authFetch(running, '/api/analyses')).json();
            assert.deepEqual(listed.analyses[0].trailIds, [trailId]);
        });
    } finally {
        await removeProject(root);
    }
});

test('범위 기록은 이전·현재 코드를 읽기 전용으로 비교하고 변경 시 검토를 무효화한다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const author = { id: randomUUID(), displayName: '검토자' };
            const analysis = await running.context.analyses.create({ title: '코드 비교', author });
            const grant = await running.context.documents.grantInsideProject('src/a.cpp');
            const before = await running.context.documents.read(grant.documentId);
            const range = { start: { line: 1, char: 1 }, end: { line: 1, char: 8 } };
            const selected = contextForRange(before.text, range);
            assert.ok(selected);
            const { baseline, fileId } = createBaselineFile({
                relPath: 'src/a.cpp', contentHash: before.contentHash,
            });
            assert.equal((await running.context.analyses.addBaseline({
                analysisId: analysis.id, commandId: randomUUID(), baseline,
            })).ok, true);
            const addedAnchor = await running.context.analyses.addAnchor({
                analysisId: analysis.id, commandId: randomUUID(), baselineId: baseline.id, fileId,
                range, selectedText: selected.selectedText, selectedTextHash: sha256(selected.selectedText),
                contextBefore: selected.before, contextBeforeHash: selected.before ? sha256(selected.before) : null,
                contextAfter: selected.after, contextAfterHash: selected.after ? sha256(selected.after) : null,
            });
            assert.equal(addedAnchor.ok, true);
            const anchorId = addedAnchor.value.result;
            const annotation = await running.context.analyses.createAnnotation({
                analysisId: analysis.id, commandId: randomUUID(), target: { kind: 'range', anchorId },
                body: '반환 흐름 확인', kind: 'explanation', tags: [], author,
            });
            assert.equal(annotation.ok, true);
            assert.equal((await running.context.analyses.setReview({
                analysisId: analysis.id, commandId: randomUUID(), target: { kind: 'range', anchorId },
                baselineId: baseline.id, state: 'reviewed', authorId: author.id,
                evidenceIds: [annotation.value.result],
            })).ok, true);

            await writeFile(path.join(root, 'src', 'a.cpp'), 'void a() {\n\tthrow new Error();\n}\n', 'utf8');
            assert.equal((await running.context.analyses.setAnchorCheck({
                analysisId: analysis.id, commandId: randomUUID(), anchorId,
                state: 'changed', currentRange: null, candidateIds: [], actorId: author.id,
            })).ok, true);
            assert.equal(running.context.analyses.get(analysis.id).reviews[0].state, 'needsReview');

            const response = await authFetch(
                running,
                `/api/analyses/${encodeURIComponent(analysis.id)}/anchors/${encodeURIComponent(anchorId)}/compare`,
            );
            assert.equal(response.status, 200);
            const comparison = await response.json();
            assert.equal(comparison.previousText, 'return;');
            assert.equal(comparison.currentText, 'throw n');
            assert.equal(comparison.state, 'changed');
            assert.equal(comparison.relPath, 'src/a.cpp');
            assert.equal(JSON.stringify(comparison).includes(root), false);
            assert.equal(JSON.stringify(comparison).includes('documentId'), false);

            const missing = await authFetch(
                running,
                `/api/analyses/${encodeURIComponent(analysis.id)}/anchors/${encodeURIComponent(randomUUID())}/compare`,
            );
            assert.equal(missing.status, 404);
        });
    } finally {
        await removeProject(root);
    }
});

test('공유 묶음은 코드 정책·무결성을 지키고 안전한 HTML을 만든다', async () => {
    const root = await makeProject(FILES);
    try {
        await withServer(root, async (running) => {
            const trail = (await running.context.trails.create('공유 트레일')).trail;
            const author = { id: randomUUID(), displayName: '<검토자>' };
            const analysis = await running.context.analyses.create({ title: '<script>alert(1)</script>', trailIds: [trail.id], author });
            await running.context.analyses.createAnnotation({
                analysisId: analysis.id, commandId: randomUUID(), target: { kind: 'trail', trailId: trail.id },
                body: '<img src=x onerror=alert(1)>', kind: 'concern', tags: [], author,
            });
            const preview = running.context.sharing.prepare(analysis.id, { includeCode: false });
            const exported = running.context.sharing.export(preview.planId);
            assert.ok(exported);
            assert.equal(exported.text.includes('C:\\'), false);
            assert.equal(exported.bundle.exportPolicy.includeCode, false);
            const html = running.context.sharing.staticHtml(exported.bundle);
            assert.equal(html.includes('<script>alert(1)</script>'), false);
            assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

            const bytes = Buffer.from(exported.text, 'utf8');
            const uploadId = running.context.sharing.uploadStart(bytes.length, createHash('sha256').update(bytes).digest('hex'));
            running.context.sharing.uploadChunk(uploadId, 0, bytes.toString('base64'));
            assert.equal(running.context.sharing.uploadFinish(uploadId).bundleId, exported.bundle.bundleId);
        });
    } finally {
        await removeProject(root);
    }
});

test('수신자의 회신 묶음은 원본 ID로 돌아와 검토 후 한 번만 합쳐진다', async () => {
    const senderRoot = await makeProject(FILES);
    const receiverRoot = await makeProject(FILES);
    try {
        await withServer(senderRoot, async (sender) => {
            const trail = (await sender.context.trails.create('왕복 트레일')).trail;
            const senderAuthor = { id: randomUUID(), displayName: '보낸 사람' };
            const original = await sender.context.analyses.create({ title: '왕복 분석', trailIds: [trail.id], author: senderAuthor });
            const created = await sender.context.analyses.createAnnotation({
                analysisId: original.id, commandId: randomUUID(), target: { kind: 'trail', trailId: trail.id },
                body: '원본 기록', kind: 'question', tags: [], author: senderAuthor,
            });
            assert.equal(created.ok, true);
            const walkthrough = await sender.context.analyses.updateWalkthrough({
                analysisId: original.id, commandId: randomUUID(), title: '회신 읽기', actorId: senderAuthor.id,
                steps: [{
                    id: randomUUID(), title: '원본 기록', body: '이 기록을 먼저 읽는다.',
                    annotationId: created.value.result,
                    target: { kind: 'trail', trailId: trail.id }, baselineId: null,
                }],
            });
            assert.equal(walkthrough.ok, true);
            const firstPreview = sender.context.sharing.prepare(original.id, { includeCode: false });
            const first = sender.context.sharing.export(firstPreview.planId);
            assert.ok(first);

            let returnedText = '';
            await withServer(receiverRoot, async (receiver) => {
                const imported = await receiver.context.sharing.import(first.text);
                const received = receiver.context.analyses.get(imported.analysis.id);
                const record = received.annotations[0];
                assert.equal(received.walkthroughs[0].steps[0].annotationId, record.id);
                const receiverAuthor = { id: randomUUID(), displayName: '받은 사람' };
                const changed = await receiver.context.analyses.updateAnnotation({
                    analysisId: received.id, commandId: randomUUID(), annotationId: record.id,
                    baseVersion: record.version, actorId: receiverAuthor.id,
                    patch: { body: '수신자가 확인해 고친 기록' },
                });
                assert.equal(changed.ok, true);
                const returnPreview = receiver.context.sharing.prepare(received.id, { includeCode: false });
                const returned = receiver.context.sharing.export(returnPreview.planId);
                assert.ok(returned);
                assert.equal(returned.bundle.analysis.annotations[0].id, first.bundle.analysis.annotations[0].id);
                assert.equal(returned.bundle.analysis.walkthroughs[0].steps[0].annotationId, first.bundle.analysis.annotations[0].id);
                returnedText = returned.text;
            });

            const returnedBundle = sender.context.sharing.parse(returnedText);
            const plan = sender.context.sharing.prepareMerge(returnedBundle);
            assert.ok(plan);
            assert.equal(plan.conflicts.length, 0);
            assert.equal(plan.updates.length, 1);
            await sender.context.sharing.applyMerge(plan.id, randomUUID(), senderAuthor.id);
            assert.equal(sender.context.analyses.get(original.id).annotations[0].body, '수신자가 확인해 고친 기록');

            const repeated = sender.context.sharing.prepareMerge(returnedBundle);
            assert.ok(repeated);
            assert.equal(repeated.additions.length + repeated.updates.length + repeated.deletions.length, 0);
            await sender.context.sharing.applyMerge(repeated.id, randomUUID(), senderAuthor.id);
            assert.equal(sender.context.analyses.get(original.id).annotations.length, 1);
        });
    } finally {
        await removeProject(senderRoot);
        await removeProject(receiverRoot);
    }
});

test('AI 초안은 선택 범위만 보내고 실제 기준점에 연결한 뒤 사람의 채택으로만 기록이 된다', async () => {
    const root = await makeProject({ 'src/review.ts': 'const secret = 1;\nfunction value() {\n  return 42;\n}\n' });
    try {
        await withServer(root, async (running) => {
            const grant = await running.context.documents.grantInsideProject('src/review.ts');
            const author = { id: randomUUID(), displayName: '검토자' };
            const analysis = await running.context.analyses.create({ title: 'AI 검토', author });
            let providerInput;
            const settings = {
                enabled: true, provider: 'ollama', endpoint: 'http://127.0.0.1:11434',
                model: 'fake', maxInputBytes: 1024, timeoutMs: 10_000,
            };
            const service = new AiExplanationService(
                running.context.documents,
                running.context.analyses,
                () => settings,
                () => ({
                    name: 'fake-local',
                    async generate(input) {
                        providerInput = input;
                        return {
                            model: 'fake-v1', body: '42를 반환한다.', questions: ['호출 근거는?'],
                            evidence: [{ anchorId: 'model-made-id', claim: '상수 42를 반환한다.' }],
                        };
                    },
                }),
            );
            const preview = await service.generate({
                requestId: randomUUID(), analysisId: analysis.id, documentId: grant.documentId,
                range: { start: { line: 1, char: 0 }, end: { line: 2, char: 12 } },
                purpose: '반환값 확인',
            });
            assert.equal(providerInput.code, 'function value() {\n  return 42;');
            assert.equal(providerInput.code.includes('secret'), false);
            assert.equal(preview.draft.evidence[0].anchorId, preview.draft.anchorId);
            assert.deepEqual(Object.keys(preview.draft).sort(), [
                'acceptedAt', 'anchorId', 'baselineId', 'body', 'createdAt', 'evidence',
                'id', 'model', 'provider', 'questions', 'range',
            ]);
            assert.equal(running.context.analyses.get(analysis.id).annotations.length, 0);

            const accepted = await service.accept({
                draftId: preview.draft.id, analysisId: analysis.id, commandId: randomUUID(), author,
            });
            const saved = running.context.analyses.get(analysis.id);
            assert.equal(saved.annotations[0].id, accepted.annotationId);
            assert.deepEqual(saved.annotations[0].tags, ['AI 채택']);
            assert.equal(saved.reviews.length, 0);

            const second = await service.generate({
                requestId: randomUUID(), analysisId: analysis.id, documentId: grant.documentId,
                range: { start: { line: 1, char: 0 }, end: { line: 2, char: 12 } }, purpose: '',
            });
            await writeFile(path.join(root, 'src', 'review.ts'), 'function value() { return 7; }\n', 'utf8');
            await assert.rejects(
                service.accept({ draftId: second.draft.id, analysisId: analysis.id, commandId: randomUUID(), author }),
                /코드가 바뀌었다/,
            );
        });
    } finally {
        await removeProject(root);
    }
});

test('진행 중인 AI 설명 요청은 requestId로 취소되고 초안을 남기지 않는다', async () => {
    const root = await makeProject({ 'src/review.ts': 'const selected = 42;\n' });
    try {
        await withServer(root, async (running) => {
            const grant = await running.context.documents.grantInsideProject('src/review.ts');
            const author = { id: randomUUID(), displayName: '검토자' };
            const analysis = await running.context.analyses.create({ title: 'AI 취소', author });
            const settings = {
                enabled: true, provider: 'ollama', endpoint: 'http://127.0.0.1:11434',
                model: 'fake', maxInputBytes: 1024, timeoutMs: 10_000,
            };
            let markStarted;
            const started = new Promise((resolve) => { markStarted = resolve; });
            const service = new AiExplanationService(
                running.context.documents,
                running.context.analyses,
                () => settings,
                () => ({
                    name: 'fake-local',
                    generate(input) {
                        markStarted();
                        return new Promise((_, reject) => {
                            input.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                        });
                    },
                }),
            );
            const requestId = randomUUID();
            const pending = service.generate({
                requestId, analysisId: analysis.id, documentId: grant.documentId,
                range: { start: { line: 0, char: 0 }, end: { line: 0, char: 20 } }, purpose: '',
            });
            await started;
            assert.equal(service.cancel(requestId), true);
            await assert.rejects(pending, /취소했거나 제한 시간을 넘었다/);
            assert.equal(service.cancel(requestId), false);
            assert.equal(running.context.analyses.get(analysis.id).annotations.length, 0);
        });
    } finally {
        await removeProject(root);
    }
});
