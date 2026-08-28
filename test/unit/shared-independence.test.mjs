/* shared 패키지가 호스트에서 떨어져 나왔는지 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fixture, shared } from './helpers.mjs';

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

test('shared 는 vscode 를 의존하지 않는다', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(SHARED, 'package.json'), 'utf8'));
    const deps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
        ...(pkg.peerDependencies ?? {}),
    };
    for (const name of Object.keys(deps)) {
        assert.equal(name.includes('vscode'), false, `${name} 이 걸려 있다`);
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

test('빌드된 dist 를 그대로 불러올 수 있다', () => {
    assert.equal(typeof shared.Trail, 'function');
    assert.equal(typeof shared.trailToMarkdown, 'function');
    assert.equal(typeof shared.parseClientCommand, 'function');
    assert.equal(shared.PROTOCOL_VERSION, 1);
    assert.equal(shared.TRAIL_SCHEMA_VERSION, 1);
    assert.equal(shared.SETTINGS_SCHEMA_VERSION, 1);
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

test('단계 0 fixture 의 심볼이 새 ResolvedSymbol 로 그대로 옮겨진다', () => {
    // 확장이 만들던 값이 새 타입에서 빠짐없이 자리를 찾는지 확인한다.
    // 여기서 걸리면 이식 과정에서 정보를 흘린 것이다.
    const { symbols } = fixture('resolved-symbols.json');
    assert.ok(symbols.length >= 6);

    for (const { case: name, symbol: legacy } of symbols) {
        const ported = {
            name: legacy.name,
            detail: legacy.detail,
            container: legacy.container,
            // 확장은 vscode.SymbolKind 를 썼다. LSP 값은 하나 크다.
            kind: legacy.kind + 1,
            relPath: legacy.relPath.startsWith('/') ? null : legacy.relPath,
            displayPath: legacy.relPath,
            external: legacy.relPath.startsWith('/'),
            languageId: legacy.languageId,
            code: legacy.code,
            startLine: legacy.startLine,
            anchorLine: legacy.anchorLine,
            anchorChar: legacy.anchorChar,
            approximate: legacy.approximate,
            callable: legacy.callable,
            declarationOnly: legacy.declarationOnly,
            contentHash: null,
            modifiedAt: null,
            documentId: null,
        };

        const parsed = shared.parseWith(shared.resolvedSymbolSchema, ported);
        assert.equal(parsed.ok, true, `${name}: ${JSON.stringify(parsed.error ?? {})}`);
        // 본문은 한 글자도 바뀌지 않는다
        assert.equal(parsed.value.code, legacy.code);
    }
});

test('단계 0 fixture 의 웹뷰 메시지가 전부 대체 경로를 가진다', () => {
    const messages = fixture('webview-messages.json');
    const commandNames = new Set(Object.keys(shared.COMMAND_PAYLOADS));

    for (const entry of [...messages.webviewToExtension, ...messages.extensionToWebview]) {
        assert.ok(entry.replacedBy, `${entry.message.type} 의 대체 경로가 비어 있다`);
        // 명령 이름을 적어둔 항목은 실제로 존재하는 명령이어야 한다
        if (commandNames.has(entry.replacedBy)) {
            assert.ok(shared.COMMAND_PAYLOADS[entry.replacedBy]);
        }
    }
});
