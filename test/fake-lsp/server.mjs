#!/usr/bin/env node
/*
 * 가짜 stdio 언어 서버 (구현서 20.2).
 *
 * 진짜 clangd·gopls 없이 우리 LSP 계층을 검사하기 위한 것이다. 실제 언어 서버가
 * 하는 **나쁜 일들**을 골라서 재현한다 — 정상 동작만 흉내내면 정작 우리가 막고
 * 싶은 상황을 하나도 시험하지 못한다.
 *
 * 시나리오는 `--scenario=<이름>` 으로 고른다. 쉼표로 여러 개를 겹칠 수 있다.
 *
 *   normal              정상. DocumentSymbol 계층과 LocationLink 를 준다
 *   symbolInformation   계층 없는 SymbolInformation 을 준다 (구형 서버)
 *   plainLocation       LocationLink 대신 Location 을 준다
 *   noDocumentSymbol    documentSymbol capability 가 없다
 *   noImplementation    implementation capability 가 없다
 *   oneLineRange        함수 range 를 한 줄만 준다 (일부 C++ 서버)
 *   multiDefinition     정의 후보를 여러 개 준다
 *   multiImplementation 구현 후보를 여러 개 준다
 *   noImplementationResult 구현을 못 찾는다 (빈 배열)
 *   slow                모든 요청을 오래 끈다 (timeout·취소 시험용)
 *   pollute             stdout 에 JSON-RPC 가 아닌 것을 먼저 뱉는다
 *   crashOnRequest      첫 요청을 받으면 죽는다 (매 프로세스마다)
 *   crashAfterInit      initialize 직후 죽는다
 *   dynamicCapability   initialize 뒤에 implementation 을 동적 등록한다
 *   badRange            문서 범위를 벗어나는 range 를 준다
 *   noisyStderr         stderr 로 많은 줄을 뱉는다
 *   noDefinitionResult  정의를 못 찾는다 (typeDefinition 폴백 시험용)
 *   declarationTarget   정의가 몸통 없는 선언으로 간다 (자동 구현 추적 시험용)
 *   externalTarget      정의가 프로젝트 **밖** 파일로 간다 (일시 문서 권한 시험용).
 *                       `--external-file=<절대경로>` 로 그 파일을 지정한다
 *
 * `--crash-once=<파일경로>` 를 주면 **처음 뜬 프로세스만** 죽는다. 그 파일을
 * 표시로 남겨 두 번째 프로세스는 정상 동작한다 — 재시작 뒤에 제대로 도는지를
 * 보려면 계속 죽으면 안 되기 때문이다.
 *
 * 심볼 자료는 파일 내용에서 만들지 않는다. 미리 정한 모양을 그대로 준다 —
 * 가짜 서버가 파서를 흉내내기 시작하면 그 파서를 또 시험해야 한다.
 */
import { existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const scenarios = new Set(
    (args.find((a) => a.startsWith('--scenario='))?.slice('--scenario='.length) ?? 'normal')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
);
const slowMs = Number(
    args.find((a) => a.startsWith('--slow-ms='))?.slice('--slow-ms='.length) ?? '3000',
);
const crashOnceMarker = args
    .find((a) => a.startsWith('--crash-once='))
    ?.slice('--crash-once='.length);
/** `externalTarget` 이 가리킬 프로젝트 밖 파일. 절대경로다. */
const externalFile = args
    .find((a) => a.startsWith('--external-file='))
    ?.slice('--external-file='.length);

/** 이 프로세스가 죽어야 하는지. `--crash-once` 는 첫 프로세스에만 적용된다. */
function shouldCrash() {
    if (crashOnceMarker === undefined) {
        return true;
    }
    if (existsSync(crashOnceMarker)) {
        return false;
    }
    writeFileSync(crashOnceMarker, 'crashed');
    return true;
}

const has = (name) => scenarios.has(name);

// ── 프레이밍 ────────────────────────────────────────────────────────────────

function send(message) {
    const body = JSON.stringify(message);
    const length = Buffer.byteLength(body, 'utf8');
    process.stdout.write(`Content-Length: ${length}\r\n\r\n${body}`);
}

let buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
            return;
        }
        const header = buffer.subarray(0, headerEnd).toString('ascii');
        const match = /Content-Length: (\d+)/i.exec(header);
        if (!match) {
            buffer = buffer.subarray(headerEnd + 4);
            continue;
        }
        const length = Number(match[1]);
        const start = headerEnd + 4;
        if (buffer.length < start + length) {
            return;
        }
        const body = buffer.subarray(start, start + length).toString('utf8');
        buffer = buffer.subarray(start + length);
        try {
            handle(JSON.parse(body));
        } catch {
            // 우리가 못 읽는 것은 무시한다. 진짜 서버도 그런다.
        }
    }
});

// ── 자료 ────────────────────────────────────────────────────────────────────

const TARGET_URI_SUFFIX = '/registry.cpp';

/** `HandlePacket` 안에서 `Find` 를 클릭했을 때 갈 곳. */
const DEFINITION_TARGET = {
    line: 3,
    character: 10,
    rangeStart: { line: 3, character: 0 },
    rangeEnd: { line: 7, character: 1 },
};

function definitionUri(requestUri) {
    if (has('externalTarget') && externalFile !== undefined) {
        // 프로젝트 밖으로 보낸다. 표준 라이브러리 헤더로 가는 상황과 같다.
        const posix = externalFile.split('\\').join('/');
        return `file:///${posix.replace(/^\/+/, '')}`;
    }
    // 같은 디렉터리의 registry.cpp 로 보낸다.
    return requestUri.replace(/\/[^/]+$/, TARGET_URI_SUFFIX);
}

function locationResult(uri, target) {
    if (has('plainLocation')) {
        return [
            {
                uri,
                range: {
                    start: { line: target.line, character: target.character },
                    end: { line: target.line, character: target.character + 4 },
                },
            },
        ];
    }
    return [
        {
            targetUri: uri,
            targetRange: { start: target.rangeStart, end: target.rangeEnd },
            targetSelectionRange: {
                start: { line: target.line, character: target.character },
                end: { line: target.line, character: target.character + 4 },
            },
        },
    ];
}

/**
 * 선언 대상. 몸통이 없는 한 줄 선언을 흉내낸다.
 * 우리 쪽에서 `declarationOnly` 로 판정돼야 자동 구현 추적이 걸린다.
 */
const DECLARATION_TARGET = {
    line: 8,
    character: 12,
    // 두 줄이라 근사 보정이 걸리지 않는다. 그 두 줄에 `{` 가 없어서
    // 우리 쪽 판정이 "몸통 없는 선언" 으로 떨어진다.
    rangeStart: { line: 8, character: 0 },
    rangeEnd: { line: 9, character: 2 },
};

/** 계층이 있는 DocumentSymbol. `registry.cpp` 를 흉내낸다. */
function hierarchicalSymbols() {
    if (has('declarationTarget')) {
        return [
            {
                name: 'Find',
                detail: '(uint16_t) -> IHandler*',
                kind: 6,
                // 몸통 표지(`{`)가 없는 줄들이다.
                range: { start: DECLARATION_TARGET.rangeStart, end: DECLARATION_TARGET.rangeEnd },
                selectionRange: {
                    start: { line: 8, character: 12 },
                    end: { line: 8, character: 16 },
                },
                children: [],
            },
        ];
    }
    const bodyEnd = has('oneLineRange')
        ? { line: 3, character: 60 }
        : { line: 7, character: 1 };
    const range = has('badRange')
        // 문서 범위를 한참 벗어난다. 잘라 쓰지 않고 후보에서 빼야 한다.
        ? { start: { line: 900, character: 0 }, end: { line: 999, character: 0 } }
        : { start: { line: 3, character: 0 }, end: bodyEnd };

    return [
        {
            name: 'HandlerRegistry',
            detail: 'class',
            kind: 5,
            range: { start: { line: 0, character: 0 }, end: { line: 9, character: 1 } },
            selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 21 } },
            children: [
                {
                    name: 'Find',
                    detail: '(uint16_t) -> IHandler*',
                    kind: 6,
                    range,
                    selectionRange: {
                        start: { line: 3, character: 10 },
                        end: { line: 3, character: 14 },
                    },
                    children: [],
                },
                {
                    name: 'entries_',
                    detail: 'std::map',
                    kind: 8,
                    range: { start: { line: 8, character: 2 }, end: { line: 8, character: 30 } },
                    selectionRange: {
                        start: { line: 8, character: 12 },
                        end: { line: 8, character: 20 },
                    },
                    children: [],
                },
            ],
        },
    ];
}

/** 계층 없는 SymbolInformation. 구형 서버가 주는 모양이다. */
function flatSymbols(uri) {
    return [
        {
            name: 'HandlerRegistry',
            kind: 5,
            location: {
                uri,
                range: { start: { line: 0, character: 0 }, end: { line: 9, character: 1 } },
            },
        },
        {
            name: 'Find',
            kind: 6,
            containerName: 'HandlerRegistry',
            location: {
                uri,
                range: { start: { line: 3, character: 0 }, end: { line: 7, character: 1 } },
            },
        },
    ];
}

// ── 처리 ────────────────────────────────────────────────────────────────────

let initialized = false;
let requestCount = 0;

function reply(id, result) {
    send({ jsonrpc: '2.0', id, result });
}

function delayed(fn) {
    if (has('slow')) {
        setTimeout(fn, slowMs);
        return;
    }
    fn();
}

function handle(message) {
    const { id, method, params } = message;

    if (method === 'initialize') {
        if (has('pollute')) {
            // 프레이밍 밖의 쓰레기. 진짜 서버가 stdout 에 진단을 찍을 때 이렇다.
            process.stdout.write('warning: 이건 JSON-RPC 가 아니다\n');
        }
        if (has('noisyStderr')) {
            for (let i = 0; i < 2000; i++) {
                process.stderr.write(`[fake] 로그 줄 ${i} ${'x'.repeat(80)}\n`);
            }
        }
        reply(id, {
            serverInfo: { name: 'fake-lsp', version: '1.0.0' },
            capabilities: {
                textDocumentSync: 1,
                definitionProvider: true,
                documentSymbolProvider: !has('noDocumentSymbol'),
                implementationProvider: !has('noImplementation') && !has('dynamicCapability'),
                typeDefinitionProvider: true,
            },
        });
        if (has('crashAfterInit') && shouldCrash()) {
            setTimeout(() => process.exit(3), 50);
        }
        return;
    }

    if (method === 'initialized') {
        initialized = true;
        if (has('dynamicCapability')) {
            // 뒤늦게 implementation 을 켠다. initialize 응답만 믿으면 놓친다.
            setTimeout(() => {
                send({
                    jsonrpc: '2.0',
                    id: 9001,
                    method: 'client/registerCapability',
                    params: {
                        registrations: [
                            { id: 'impl-1', method: 'textDocument/implementation' },
                        ],
                    },
                });
            }, 20);
        }
        send({
            jsonrpc: '2.0',
            method: 'window/logMessage',
            params: { type: 3, message: '가짜 서버가 준비됐다' },
        });
        return;
    }

    if (method === 'shutdown') {
        reply(id, null);
        return;
    }
    if (method === 'exit') {
        process.exit(0);
    }

    // 알림은 대답하지 않는다.
    if (id === undefined) {
        return;
    }

    requestCount += 1;
    if (has('crashOnRequest') && requestCount === 1 && shouldCrash()) {
        process.exit(4);
    }

    if (!initialized) {
        send({ jsonrpc: '2.0', id, error: { code: -32002, message: 'not initialized' } });
        return;
    }

    switch (method) {
        case 'textDocument/definition': {
            delayed(() => {
                if (has('noDefinitionResult')) {
                    // 빈 결과. 우리 쪽이 typeDefinition 으로 넘어가야 한다.
                    reply(id, []);
                    return;
                }
                const uri = definitionUri(params.textDocument.uri);
                if (has('declarationTarget')) {
                    reply(id, locationResult(uri, DECLARATION_TARGET));
                    return;
                }
                if (has('multiDefinition')) {
                    reply(id, [
                        ...locationResult(uri, DEFINITION_TARGET),
                        ...locationResult(
                            uri.replace(/\.cpp$/, '.h'),
                            { ...DEFINITION_TARGET, line: 12 },
                        ),
                    ]);
                    return;
                }
                reply(id, locationResult(uri, DEFINITION_TARGET));
            });
            return;
        }

        case 'textDocument/typeDefinition': {
            delayed(() => {
                // 정의를 못 찾았을 때의 폴백 경로를 시험하려고 여기서만 답한다.
                const uri = definitionUri(params.textDocument.uri);
                reply(id, locationResult(uri, { ...DEFINITION_TARGET, line: 3 }));
            });
            return;
        }

        case 'textDocument/documentSymbol': {
            delayed(() => {
                if (has('noDocumentSymbol')) {
                    reply(id, null);
                    return;
                }
                if (has('symbolInformation')) {
                    reply(id, flatSymbols(params.textDocument.uri));
                    return;
                }
                reply(id, hierarchicalSymbols());
            });
            return;
        }

        case 'textDocument/implementation': {
            delayed(() => {
                if (has('noImplementationResult')) {
                    reply(id, []);
                    return;
                }
                const uri = definitionUri(params.textDocument.uri).replace(/\.cpp$/, '.impl.cpp');
                if (has('multiImplementation')) {
                    reply(id, [
                        ...locationResult(uri, DEFINITION_TARGET),
                        ...locationResult(
                            uri.replace(/\.impl\.cpp$/, '.impl2.cpp'),
                            DEFINITION_TARGET,
                        ),
                    ]);
                    return;
                }
                reply(id, locationResult(uri, DEFINITION_TARGET));
            });
            return;
        }

        case 'textDocument/references': {
            // **이 요청이 오면 안 된다** (구현서 11.1). 왔다는 것을 테스트가
            // 알아볼 수 있게 표시를 남긴다.
            process.stderr.write('[fake] REFERENCES_REQUESTED\n');
            reply(id, []);
            return;
        }

        default:
            send({ jsonrpc: '2.0', id, error: { code: -32601, message: `no ${method}` } });
    }
}

// stdin 이 닫히면 끝낸다. 부모가 죽었는데 남아 있으면 안 된다.
process.stdin.on('end', () => process.exit(0));
process.stdin.on('close', () => process.exit(0));
