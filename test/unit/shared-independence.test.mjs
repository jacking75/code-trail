/* shared 패키지가 호스트에서 떨어져 나왔는지 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shared } from './helpers.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SHARED = path.join(ROOT, 'packages', 'shared');

function walkFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walkFiles(full));
        } else {
            out.push(full);
        }
    }
    return out;
}

test('shared 소스 어디에도 vscode 가 없다', () => {
    for (const file of walkFiles(path.join(SHARED, 'src'))) {
        const text = fs.readFileSync(file, 'utf8');
        assert.equal(
            /['"]vscode['"]/.test(text),
            false,
            `${path.relative(ROOT, file)} 이 vscode 를 참조한다`,
        );
    }
});

test('shared 는 Node 전용 모듈을 불러오지 않는다', () => {
    // 브라우저 번들에도 그대로 들어가야 한다. fs·path·child_process 가 섞이면
    // Vite 빌드에서야 터진다 — 여기서 먼저 막는다.
    const forbidden = /from\s+['"](node:|fs|path|os|crypto|child_process|http|net)['"]/;
    for (const file of walkFiles(path.join(SHARED, 'src'))) {
        const text = fs.readFileSync(file, 'utf8');
        assert.equal(forbidden.test(text), false, `${path.relative(ROOT, file)}`);
    }
});

test('LSP SymbolKind 값을 쓴다 — VS Code 의 0-based 값이 아니다', () => {
    // LSP 명세는 File=1 부터, VS Code 는 File=0 부터다. 확장에서 옮겨온 숫자를
    // 그대로 믿으면 헤더의 종류 이름이 한 칸씩 밀린다.
    assert.equal(shared.SymbolKind.File, 1);
    assert.equal(shared.SymbolKind.Class, 5);
    assert.equal(shared.SymbolKind.Method, 6);
    assert.equal(shared.SymbolKind.Function, 12);

    assert.equal(shared.kindName(shared.SymbolKind.Function), 'function');
    assert.equal(shared.kindName(shared.SymbolKind.Method), 'method');
    assert.equal(shared.kindName(9999), 'symbol');
});

test('Roslyn 스타일 이름에서 식별자만 뽑는다', () => {
    assert.equal(shared.shortName('SendAsync(Packet, CancellationToken) : Task<bool>'), 'SendAsync');
    assert.equal(shared.shortName('HandlePacket'), 'HandlePacket');
    assert.equal(shared.shortName('(익명)'), '(익명)');
});

test('감싸는 이름은 클래스류에만 붙인다', () => {
    assert.equal(shared.isContainerKind(shared.SymbolKind.Class), true);
    assert.equal(shared.isContainerKind(shared.SymbolKind.Interface), true);
    assert.equal(shared.isContainerKind(shared.SymbolKind.Method), false);
    assert.equal(shared.isContainerKind(shared.SymbolKind.Function), false);
});
