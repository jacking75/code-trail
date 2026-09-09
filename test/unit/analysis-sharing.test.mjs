import test from 'node:test';
import assert from 'node:assert/strict';

import { shared } from './helpers.mjs';

const UUID = {
    analysis: '10000000-0000-4000-8000-000000000001',
    author: '10000000-0000-4000-8000-000000000002',
    trail: '10000000-0000-4000-8000-000000000003',
    annotation: '10000000-0000-4000-8000-000000000004',
    reply: '10000000-0000-4000-8000-000000000005',
};

function mergeFixture() {
    const now = '2026-01-01T00:00:00.000Z';
    const author = { id: UUID.author, displayName: '작성자' };
    const baseAnnotation = {
        id: UUID.annotation, version: 1, target: { kind: 'trail', trailId: UUID.trail },
        kind: 'explanation', body: '기준 내용', tags: [], status: 'open', authorId: UUID.author,
        createdAt: now, updatedAt: now, deletedAt: null,
    };
    const local = shared.createAnalysis({ id: UUID.analysis, title: '분석', trailIds: [UUID.trail], author, now });
    local.annotations = [{ ...baseAnnotation }];
    const bundle = {
        format: shared.SHARE_FORMAT, schemaVersion: shared.SHARE_SCHEMA_VERSION,
        bundleId: '10000000-0000-4000-8000-000000000010', createdAt: now, producerVersion: '1.1.0',
        lineage: { sourceAnalysisId: UUID.analysis, baseContentHash: 'a'.repeat(64), previousBundleId: '10000000-0000-4000-8000-000000000011' },
        project: { name: '예제', repositoryId: null }, baselines: [], trails: [],
        analysis: {
            id: UUID.analysis, title: '분석', purpose: '', revision: 2, authors: [author],
            annotations: [{ ...baseAnnotation }], replies: [], reviews: [], anchors: [], walkthroughs: [], goals: [], importantLocations: [],
        },
        mergeBase: { annotations: [{ ...baseAnnotation }], replies: [] }, snapshots: [],
        exportPolicy: { includeCode: false, includeAuthors: true, includeReplies: true, includeBoardLayout: false },
        integrity: 'b'.repeat(64),
    };
    return { local, bundle, baseAnnotation };
}

test('원본 UTF-16 범위는 탭·CRLF·한글·이모지를 바꾸지 않는다', () => {
    const source = '\t한글😀A\r\n둘째 줄\n';
    assert.equal(shared.textForRange(source, {
        start: { line: 0, char: 1 },
        end: { line: 1, char: 2 },
    }), '한글😀A\r\n둘째');
    assert.equal(shared.textForRange(source, {
        start: { line: 1, char: 4 }, end: { line: 0, char: 0 },
    }), null);
});

test('프로젝트 설정과 로컬 설정을 분리하고 다시 합치면 의미가 같다', () => {
    const effective = shared.defaultSettings();
    effective.ui.theme = 'dark';
    effective.editor = { executable: 'code', args: ['--goto', '{path}:{line}'] };
    effective.languages.cpp.executable = 'C:/tools/clangd.exe';
    effective.languages.cpp.env = { PRIVATE: 'secret' };
    const local = shared.localSettingsFromEffective(effective, {
        id: UUID.author, displayName: '작성자',
    });
    const project = shared.shareableSettings(effective);
    const merged = shared.applyLocalSettings(project, local);

    assert.equal(project.editor.executable, null);
    assert.deepEqual(project.languages.cpp.env, {});
    assert.equal(merged.editor.executable, 'code');
    assert.equal(merged.languages.cpp.env.PRIVATE, 'secret');
    assert.equal(merged.ui.theme, 'dark');
    assert.equal(shared.localSettingsSchema.safeParse(local).success, true);
});

test('공유 스키마는 끊어진 작성자·대상 참조를 거부한다', () => {
    const now = '2026-01-01T00:00:00.000Z';
    const bundle = {
        format: shared.SHARE_FORMAT,
        schemaVersion: shared.SHARE_SCHEMA_VERSION,
        bundleId: '10000000-0000-4000-8000-000000000010',
        createdAt: now,
        producerVersion: '1.1.0',
        lineage: { sourceAnalysisId: UUID.analysis, baseContentHash: 'a'.repeat(64), previousBundleId: null },
        project: { name: '예제', repositoryId: null },
        baselines: [],
        trails: [],
        analysis: {
            id: UUID.analysis, title: '검토', purpose: '', revision: 1, authors: [],
            annotations: [{
                id: UUID.annotation, version: 1,
                target: { kind: 'trail', trailId: UUID.trail },
                kind: 'question', body: '왜 그런가', tags: [], status: 'open',
                authorId: UUID.author, createdAt: now, updatedAt: now, deletedAt: null,
            }],
            replies: [], reviews: [], anchors: [], walkthroughs: [], goals: [], importantLocations: [],
        },
        mergeBase: { annotations: [], replies: [] },
        snapshots: [],
        exportPolicy: { includeCode: false, includeAuthors: true, includeReplies: true, includeBoardLayout: false },
        integrity: 'b'.repeat(64),
    };
    const result = shared.shareBundleSchema.safeParse(bundle);
    assert.equal(result.success, false);
    assert.match(JSON.stringify(result.error?.issues), /작성자 참조|대상 참조/);
});

test('정규 JSON은 객체 키 입력 순서와 무관하다', () => {
    assert.equal(shared.canonicalJson({ b: 1, a: { d: 2, c: 3 } }), shared.canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
});

test('왕복 공유는 충돌 없는 추가·수정·삭제를 세 방향으로 비교하고 반복 적용을 늘리지 않는다', () => {
    const { local, bundle, baseAnnotation } = mergeFixture();
    bundle.analysis.annotations[0] = { ...baseAnnotation, version: 2, body: '회신에서 수정', updatedAt: '2026-01-02T00:00:00.000Z' };
    bundle.analysis.annotations.push({
        ...baseAnnotation, id: '10000000-0000-4000-8000-000000000012', body: '새 기록',
    });
    const plan = shared.planShareMerge(local, bundle);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.additions.length, 1);
    assert.equal(plan.deletions.length, 0);

    local.annotations = bundle.analysis.annotations.map((item) => ({ ...item, tags: [...item.tags] }));
    const repeated = shared.planShareMerge(local, bundle);
    assert.equal(repeated.additions.length + repeated.updates.length + repeated.deletions.length, 0);
    assert.deepEqual(repeated.conflicts, []);
});

test('왕복 공유 충돌은 양쪽 본문과 삭제·수정 상태를 잃지 않는다', () => {
    const { local, bundle, baseAnnotation } = mergeFixture();
    local.annotations[0] = { ...baseAnnotation, version: 2, body: '내 수정', updatedAt: '2026-01-03T00:00:00.000Z' };
    bundle.analysis.annotations[0] = { ...baseAnnotation, version: 99, body: '받은 수정', updatedAt: '2025-12-01T00:00:00.000Z' };
    const concurrent = shared.planShareMerge(local, bundle);
    assert.deepEqual(concurrent.conflicts.map(({ reason, localBody, incomingBody }) => ({ reason, localBody, incomingBody })), [{
        reason: 'bothChanged', localBody: '내 수정', incomingBody: '받은 수정',
    }]);

    bundle.analysis.annotations = [];
    const deleteUpdate = shared.planShareMerge(local, bundle);
    assert.equal(deleteUpdate.conflicts[0].reason, 'deleteUpdate');
    assert.equal(deleteUpdate.conflicts[0].localBody, '내 수정');
    assert.equal(deleteUpdate.conflicts[0].incomingBody, null);
});
