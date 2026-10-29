/*
 * 실제 언어 서버 스모크 — node test/smoke/real-lsp.mjs
 *
 * 가짜 LSP 는 우리가 만든 모양만 돌려준다. 진짜 clangd·gopls·rust-analyzer 가
 * 실제로 어떤 응답을 주는지는 그걸로 알 수 없다. 이 파일이 그 간극을 메운다.
 *
 * **설치된 언어만 검사하고 나머지는 건너뛴다**(구현서 20.4). 개발 기계마다
 * 있는 도구가 다르므로, 없는 것 때문에 실패하면 아무도 이 테스트를 안 돌린다.
 * CI 는 두지 않는다. 그 언어가 설치된 기계에서 손으로 돌린다.
 *
 * 각 언어에 대해 확인하는 것은 셋이다.
 *   1. 서버가 뜨고 initialize 가 끝난다.
 *   2. documentSymbol 이 우리가 아는 심볼을 준다.
 *   3. definition 이 다른 파일의 정의로 간다.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const server = await import(
    new URL('../../packages/server/dist/index.js', import.meta.url).href
);
const adapters = await import(
    new URL('../../packages/server/dist/lsp/adapters/index.js', import.meta.url).href
);
const { defaultSettings } = await import(
    new URL('../../packages/shared/dist/index.js', import.meta.url).href
);

let failures = 0;
let skipped = 0;

const check = (name, condition, extra) => {
    console.log(`    ${condition ? 'ok  ' : 'FAIL'} ${name}${!condition && extra ? ` — ${extra}` : ''}`);
    if (!condition) {
        failures++;
    }
};

/**
 * 언어별 fixture.
 *
 * `caller` 안의 `callSite` 위치에서 정의를 물으면 `defineFile` 로 가야 한다.
 * 좌표는 파일 내용에서 계산한다 — 손으로 적으면 파일을 고칠 때마다 틀린다.
 */
const FIXTURES = {
    cpp: {
        files: {
            'compile_flags.txt': '-std=c++17\n',
            'registry.h': [
                '#pragma once',
                '',
                'struct HandlerRegistry {',
                '    int Find(int opcode) const;',
                '};',
                '',
            ].join('\n'),
            'registry.cpp': [
                '#include "registry.h"',
                '',
                'int HandlerRegistry::Find(int opcode) const {',
                '    return opcode + 1;',
                '}',
                '',
            ].join('\n'),
            'dispatch.cpp': [
                '#include "registry.h"',
                '',
                'int HandlePacket(HandlerRegistry& registry, int opcode) {',
                '    return registry.Find(opcode);',
                '}',
                '',
            ].join('\n'),
        },
        callerFile: 'dispatch.cpp',
        callWord: 'Find',
        expectSymbol: 'HandlePacket',
    },
    go: {
        files: {
            'go.mod': 'module smoke\n\ngo 1.21\n',
            'registry.go': [
                'package smoke',
                '',
                'type Registry struct{}',
                '',
                'func (r Registry) Find(opcode int) int {',
                '\treturn opcode + 1',
                '}',
                '',
            ].join('\n'),
            'dispatch.go': [
                'package smoke',
                '',
                'func HandlePacket(r Registry, opcode int) int {',
                '\treturn r.Find(opcode)',
                '}',
                '',
            ].join('\n'),
        },
        callerFile: 'dispatch.go',
        callWord: 'Find',
        expectSymbol: 'HandlePacket',
    },
    rust: {
        files: {
            'Cargo.toml': '[package]\nname = "smoke"\nversion = "0.1.0"\nedition = "2021"\n',
            'src/registry.rs': [
                'pub struct Registry;',
                '',
                'impl Registry {',
                '    pub fn find(&self, opcode: i32) -> i32 {',
                '        opcode + 1',
                '    }',
                '}',
                '',
            ].join('\n'),
            'src/lib.rs': [
                'pub mod registry;',
                '',
                'use registry::Registry;',
                '',
                'pub fn handle_packet(r: &Registry, opcode: i32) -> i32 {',
                '    r.find(opcode)',
                '}',
                '',
            ].join('\n'),
        },
        callerFile: 'src/lib.rs',
        callWord: 'find',
        expectSymbol: 'handle_packet',
    },
    csharp: {
        files: {
            'Smoke.csproj': [
                '<Project Sdk="Microsoft.NET.Sdk">',
                '  <PropertyGroup>',
                '    <TargetFramework>net8.0</TargetFramework>',
                '  </PropertyGroup>',
                '</Project>',
                '',
            ].join('\n'),
            'Registry.cs': [
                'namespace Smoke;',
                '',
                'public class Registry',
                '{',
                '    public int Find(int opcode) => opcode + 1;',
                '}',
                '',
            ].join('\n'),
            'Dispatch.cs': [
                'namespace Smoke;',
                '',
                'public static class Dispatch',
                '{',
                '    public static int HandlePacket(Registry registry, int opcode)',
                '    {',
                '        return registry.Find(opcode);',
                '    }',
                '}',
                '',
            ].join('\n'),
        },
        callerFile: 'Dispatch.cs',
        callWord: 'Find',
        expectSymbol: 'HandlePacket',
    },
    typescript: {
        files: {
            'package.json': '{"type":"module"}\n',
            'tsconfig.json': '{"compilerOptions":{"strict":true,"module":"NodeNext","moduleResolution":"NodeNext"},"include":["src"]}\n',
            'src/registry.ts': [
                'export class Registry {',
                '    find(opcode: number): number {',
                '        return opcode + 1;',
                '    }',
                '}',
                '',
            ].join('\n'),
            'src/dispatch.ts': [
                "import { Registry } from './registry.js';",
                '',
                'export function handlePacket(registry: Registry, opcode: number): number {',
                '    return registry.find(opcode);',
                '}',
                '',
            ].join('\n'),
        },
        callerFile: 'src/dispatch.ts',
        callWord: 'find',
        expectSymbol: 'handlePacket',
    },
};

/** `callWord` 가 놓인 첫 위치. 0-based 줄과 UTF-16 컬럼. */
function findCallSite(text, word) {
    const lines = text.split('\n');
    for (let line = 0; line < lines.length; line++) {
        // 정의가 아니라 호출부를 찾는다. `.` 뒤에 오는 것을 고른다.
        const column = lines[line].indexOf(`.${word}`);
        if (column !== -1) {
            return { line, character: column + 1 };
        }
    }
    return null;
}

async function makeProject(files) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'code-trail-smoke-'));
    for (const [relPath, contents] of Object.entries(files)) {
        const full = path.join(root, ...relPath.split('/'));
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, contents, 'utf8');
    }
    return root;
}

async function runLanguage(language, fixture) {
    const root = await makeProject(fixture.files);
    let running;
    try {
        // 어댑터가 이 기계에서 실행 파일을 찾는지 먼저 본다.
        const detection = await adapters.adapterFor(language).detectExecutable({
            projectRoot: root,
            settings: defaultSettings(),
        });
        if (detection.executable === null) {
            console.log(`  건너뜀 — ${detection.hint ?? '실행 파일을 찾지 못했다.'}`);
            skipped++;
            return;
        }
        console.log(`  실행 파일: ${detection.executable} (${detection.source})`);

        running = await server.startServer({
            projectDirectory: root,
            logLevel: 'error',
            logWrite: () => {},
            // 진짜 서버는 프로젝트를 읽는 데 시간이 걸린다.
            lspRequestTimeoutMs: 60_000,
        });

        const token = running.token;
        const get = async (pathname) => {
            const response = await fetch(`${running.url}${pathname}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            return response.json();
        };

        const diagnostics = await get('/api/diagnostics');
        const info = diagnostics.languages.find((l) => l.language === language);
        const errors = info.healthChecks.filter((c) => c.level === 'error');
        if (errors.length > 0) {
            // 실행 파일은 찾았지만 못 돈다. 흔한 경우가 rustup proxy 인데
            // toolchain 에 실제 서버가 없는 것이다(구현서 12.4). 실패가 아니라
            // "이 기계에는 준비가 안 됐다" 이므로 건너뛴다.
            console.log(`  건너뜀 — ${errors.map((e) => e.detail).join(' | ')}`);
            skipped++;
            return;
        }
        check('진단에 오류가 없다', true);

        const opened = await get(
            `/api/workspace/open?relPath=${encodeURIComponent(fixture.callerFile)}`,
        );
        const site = findCallSite(opened.text, fixture.callWord);
        check('호출부를 찾았다', site !== null, fixture.callWord);
        if (site === null) {
            return;
        }

        // 커서를 감싸는 심볼로 루트를 만든다 — documentSymbol 이 도는지 본다.
        const context = running.context;
        const grant = context.documents.get(opened.documentId);
        const resolver = context.resolveFlow;

        const trail = await context.trails.create('스모크');
        const rooted = await resolver.addRootAt({
            trailId: trail.trail.id,
            baseRevision: trail.revision,
            documentId: opened.documentId,
            // 함수 본문 안. 감싸는 함수가 잡혀야 한다.
            line: site.line,
            char: 0,
        });
        check(
            `documentSymbol 이 ${fixture.expectSymbol} 을 준다`,
            rooted.kind === 'added' && rooted.node.symbol.name === fixture.expectSymbol,
            rooted.kind === 'added' ? rooted.node.symbol.name : JSON.stringify(rooted),
        );
        if (rooted.kind !== 'added') {
            return;
        }

        // 호출부에서 정의로 간다.
        const resolved = await resolver.resolveFromNode({
            trailId: trail.trail.id,
            baseRevision: rooted.revision,
            nodeId: rooted.node.id,
            line: site.line,
            char: site.character,
            text: fixture.callWord,
            mode: 'definition',
        });
        check(
            'definition 이 다른 파일의 정의로 간다',
            resolved.kind === 'added'
                && resolved.node.symbol.relPath !== fixture.callerFile,
            resolved.kind === 'added'
                ? `${resolved.node.symbol.name} @ ${resolved.node.symbol.relPath}`
                : JSON.stringify(resolved),
        );
        // grant 는 위에서 문서 권한이 실제로 발급됐는지 확인하는 용도다.
        check('문서 권한이 발급됐다', grant !== undefined);
    } catch (error) {
        check('예외 없이 끝난다', false, error instanceof Error ? error.message : String(error));
    } finally {
        await running?.close().catch(() => undefined);
        await rm(root, { recursive: true, force: true });
    }
}

const only = process.argv[2];
for (const [language, fixture] of Object.entries(FIXTURES)) {
    if (only !== undefined && only !== language) {
        continue;
    }
    console.log(`\n[${language}]`);
    await runLanguage(language, fixture);
}

console.log(
    `\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`
    + `${skipped > 0 ? ` (${skipped}개 언어는 서버가 없어 건너뜀)` : ''}`,
);
process.exit(failures === 0 ? 0 : 1);
