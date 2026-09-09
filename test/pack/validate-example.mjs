import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { canonicalJson, parseWith, shareBundleSchema, sharePayloadWithoutIntegrity } from '../../packages/shared/dist/index.js';

const bundle = JSON.parse(await readFile(new URL('../../examples/first-review.ctshare.json', import.meta.url), 'utf8'));
const expected = createHash('sha256').update(canonicalJson(sharePayloadWithoutIntegrity(bundle))).digest('hex');
if (process.argv.includes('--hash')) {
    process.stdout.write(`${expected}\n`);
} else {
    const parsed = parseWith(shareBundleSchema, bundle);
    if (!parsed.ok || bundle.integrity !== expected) throw new Error('첫 검토 예제 공유 묶음이 유효하지 않다.');
    process.stdout.write('첫 검토 예제 공유 묶음 검증 통과\n');
}
