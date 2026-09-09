/* 긴 본문·많은 분석 기록의 직렬화/검증 한계를 재는 비브라우저 성능 시험이다. */
import { randomUUID, createHash } from 'node:crypto';

const shared = await import(new URL('../../packages/shared/dist/index.js', import.meta.url).href);

const cases = [
    { annotations: 100, bodyLines: 250 },
    { annotations: 1_000, bodyLines: 40 },
    { annotations: 10_000, bodyLines: 1 },
];

const elapsed = async (work) => {
    const started = performance.now();
    const value = await work();
    return { value, ms: Math.round((performance.now() - started) * 10) / 10 };
};

console.log('\n[분석 기록 규모]');
console.log('| 기록 | 본문 줄/건 | JSON 크기 | 직렬화 | 스키마 검증 | 공유 검증 |');
console.log('| ---: | ---: | ---: | ---: | ---: | ---: |');

for (const item of cases) {
    const author = { id: randomUUID(), displayName: '성능 시험' };
    const trailId = randomUUID();
    const analysis = shared.createAnalysis({ title: '규모 시험', author, trailIds: [trailId] });
    const now = new Date().toISOString();
    const body = Array.from({ length: item.bodyLines }, (_, index) => `설명 ${index} — 한글과 emoji 😀`).join('\n');
    analysis.annotations = Array.from({ length: item.annotations }, (_, index) => ({
        id: randomUUID(), version: 1, target: { kind: 'trail', trailId },
        kind: index % 3 === 0 ? 'question' : 'explanation', body, tags: ['성능'],
        status: 'open', authorId: author.id, createdAt: now, updatedAt: now, deletedAt: null,
    }));
    const serialized = await elapsed(() => shared.stringifyAnalysis(analysis));
    const validated = await elapsed(() => shared.analysisDocumentSchema.safeParse(JSON.parse(serialized.value)));
    if (!validated.value.success) throw new Error('분석 스키마 검증 실패');

    const withoutIntegrity = {
        format: shared.SHARE_FORMAT, schemaVersion: shared.SHARE_SCHEMA_VERSION,
        bundleId: randomUUID(), createdAt: now, producerVersion: '1.1.0',
        lineage: { sourceAnalysisId: analysis.id, baseContentHash: '0'.repeat(64), previousBundleId: null },
        project: { name: '성능 시험', repositoryId: null }, baselines: [],
        trails: [{ schemaVersion: 1, id: trailId, title: '빈 트레일', createdAt: now, updatedAt: now, revision: 0, activeNodeId: null, mode: 'tree', roots: [], nodeUi: {} }],
        analysis: {
            id: analysis.id, title: analysis.title, purpose: '', revision: analysis.revision,
            authors: analysis.authors, annotations: analysis.annotations, replies: [], reviews: [],
            anchors: [], walkthroughs: [], goals: [], importantLocations: [],
        }, mergeBase: { annotations: analysis.annotations, replies: [] }, snapshots: [],
        exportPolicy: { includeCode: false, includeAuthors: true, includeReplies: true, includeBoardLayout: false },
    };
    const bundle = { ...withoutIntegrity, integrity: createHash('sha256').update(shared.canonicalJson(withoutIntegrity)).digest('hex') };
    const shareValidated = await elapsed(() => shared.shareBundleSchema.safeParse(bundle));
    if (!shareValidated.value.success) throw new Error('공유 스키마 검증 실패');
    console.log(`| ${item.annotations} | ${item.bodyLines} | ${(Buffer.byteLength(serialized.value) / 1024 / 1024).toFixed(2)}MiB | ${serialized.ms}ms | ${validated.ms}ms | ${shareValidated.ms}ms |`);
}
