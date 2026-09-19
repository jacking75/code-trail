/* 명령·이벤트 런타임 스키마 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

import { shared } from './helpers.mjs';

const {
    COMMAND_PAYLOADS,
    EVENT_PAYLOADS,
    PROTOCOL_VERSION,
    STRUCTURE_COMMAND_TYPES,
    UI_COMMAND_TYPES,
    defaultSettings,
    isStructureCommand,
    parseClientCommand,
    parseServerEvent,
    parseWith,
} = shared;

const NODE_ID = '11111111-1111-4111-8111-111111111111';
const TRAIL_ID = '22222222-2222-4222-8222-222222222222';

function command(overrides = {}) {
    return {
        protocolVersion: PROTOCOL_VERSION,
        type: 'trail.resolve',
        commandId: 'cmd-1',
        trailId: TRAIL_ID,
        baseRevision: 3,
        payload: { nodeId: NODE_ID, line: 10, char: 4, text: 'Find' },
        ...overrides,
    };
}

test('구조 명령과 화면 명령이 겹치지 않고 전부 payload 를 갖는다', () => {
    const structure = new Set(STRUCTURE_COMMAND_TYPES);
    const ui = new Set(UI_COMMAND_TYPES);

    for (const type of ui) {
        assert.equal(structure.has(type), false, `${type} 가 양쪽에 있다`);
    }
    const all = [...structure, ...ui];
    assert.deepEqual([...all].sort(), Object.keys(COMMAND_PAYLOADS).sort());
    for (const type of all) {
        assert.ok(COMMAND_PAYLOADS[type], `${type} 의 payload 스키마가 없다`);
    }
});

test('구현서 14.2 의 명령이 전부 있다', () => {
    const documented = [
        'trail.create', 'trail.rename', 'trail.delete', 'trail.select',
        'trail.addRootAt', 'trail.addRootFromSymbol', 'trail.resolve',
        'trail.resolveImplementations', 'trail.chooseCandidate',
        'trail.removeNode', 'trail.toggleNode', 'trail.undoRemove', 'trail.refreshNode',
        'trail.promoteToRoot', 'trail.undoPromote', 'trail.setMode', 'trail.setNodeUi',
        'trail.setActiveNode', 'trail.setChildOrder', 'trail.clear', 'trail.exportMarkdown',
        'trail.resetBoardLayout', 'ui.saveLocalState',
        'workspace.openDocument', 'workspace.searchFiles', 'editor.openLocation',
        'settings.update', 'lsp.restart', 'lsp.verify',
        'settings.updateLocalAuthor',
        'analysis.create', 'analysis.updatePlan', 'analysis.recover', 'analysis.saveDraft',
        'annotation.create', 'annotation.update', 'annotation.delete',
        'annotation.restore', 'annotation.reply', 'annotation.setStatus',
        'review.setState', 'anchor.capture', 'anchor.recheck', 'anchor.rebind',
        'walkthrough.update', 'share.prepare', 'share.export',
        'share.uploadStart', 'share.uploadChunk', 'share.uploadFinish',
        'share.importPreview', 'share.importCommit', 'share.mergeCommit',
        'ai.generate', 'ai.cancel', 'ai.accept',
    ];
    assert.deepEqual(Object.keys(COMMAND_PAYLOADS).sort(), [...documented].sort());
});

test('정상 명령을 해석한다', () => {
    const parsed = parseClientCommand(command());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.type, 'trail.resolve');
    assert.equal(parsed.value.payload.text, 'Find');
    assert.equal(parsed.value.baseRevision, 3);
});

test('모르는 명령은 거부한다', () => {
    const parsed = parseClientCommand(command({ type: 'trail.깜짝' }));
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, 'INVALID_COMMAND');
    assert.equal(parsed.error.retryable, false);
});

test('구조 명령에 baseRevision 이 없으면 거부한다', () => {
    for (const type of STRUCTURE_COMMAND_TYPES) {
        const raw = command({ type, baseRevision: undefined, payload: {} });
        delete raw.baseRevision;
        const parsed = parseClientCommand(raw);
        assert.equal(parsed.ok, false, `${type} 가 baseRevision 없이 통과했다`);
        assert.match(parsed.error.message, /baseRevision/);
    }
});

test('화면 명령은 baseRevision 없이도 통과한다', () => {
    const raw = command({ type: 'trail.setMode', payload: { mode: 'board' } });
    delete raw.baseRevision;
    const parsed = parseClientCommand(raw);
    assert.equal(parsed.ok, true);
    assert.equal(isStructureCommand('trail.setMode'), false);
    assert.equal(isStructureCommand('trail.resolve'), true);
});

test('프로토콜 버전이 다르면 거부한다', () => {
    const parsed = parseClientCommand(command({ protocolVersion: 2 }));
    assert.equal(parsed.ok, false);
});

test('payload 가 스키마에 안 맞으면 거부한다', () => {
    const cases = [
        command({ payload: { nodeId: 'n1', line: 10, char: 4, text: 'x' } }),   // UUID 아님
        command({ payload: { nodeId: NODE_ID, line: -1, char: 4, text: 'x' } }), // 음수 좌표
        command({ payload: { nodeId: NODE_ID, line: 1.5, char: 4, text: 'x' } }), // 정수 아님
        command({ payload: { nodeId: NODE_ID, line: 10, char: 4 } }),            // text 없음
    ];
    for (const raw of cases) {
        assert.equal(parseClientCommand(raw).ok, false, JSON.stringify(raw.payload));
    }
});

test('오류에는 받은 값이 아니라 어디가 틀렸는지만 담는다', () => {
    const secret = 'void 비밀함수() { /* 코드 본문 */ }';
    const parsed = parseClientCommand(command({ payload: { nodeId: secret, line: 0, char: 0, text: '' } }));

    assert.equal(parsed.ok, false);
    const dumped = JSON.stringify(parsed.error);
    assert.equal(dumped.includes(secret), false);
    assert.equal(dumped.includes('비밀함수'), false);
    assert.match(dumped, /nodeId/);
});

test('setNodeUi 는 null 로 지우기를 받아준다', () => {
    const raw = command({
        type: 'trail.setNodeUi',
        payload: { nodeId: NODE_ID, patch: { codeFontSize: null, boardX: 12.5 } },
    });
    delete raw.baseRevision;
    const parsed = parseClientCommand(raw);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.payload.patch.codeFontSize, null);
    assert.equal(parsed.value.payload.patch.boardX, 12.5);
});

test('editor.openLocation 은 문서 ID 만 받고 경로를 받지 않는다', () => {
    const schema = COMMAND_PAYLOADS['editor.openLocation'];
    const good = parseWith(schema, { documentId: 'doc-1', line: 3, char: 0 });
    assert.equal(good.ok, true);
    assert.equal('path' in good.value, false);
    assert.equal('relPath' in good.value, false);

    // 경로를 끼워 넣어도 값이 통과해 나가지 않는다
    const sneaky = parseWith(schema, {
        documentId: 'doc-1', line: 3, char: 0, path: 'C:/Windows/System32/config/SAM',
    });
    assert.equal(sneaky.ok, true);
    assert.equal(JSON.stringify(sneaky.value).includes('System32'), false);
});

test('settings.update 는 설정 전체 스키마를 통과해야 한다', () => {
    const schema = COMMAND_PAYLOADS['settings.update'];
    assert.equal(parseWith(schema, { settings: defaultSettings() }).ok, true);

    const broken = defaultSettings();
    broken.ui.clickTarget = '아무거나';
    assert.equal(parseWith(schema, { settings: broken }).ok, false);

    const negative = defaultSettings();
    negative.ui.maxCodeLines = 0;
    assert.equal(parseWith(schema, { settings: negative }).ok, false);
});

test('이벤트를 해석하고 모르는 이벤트는 거부한다', () => {
    const event = {
        protocolVersion: PROTOCOL_VERSION,
        type: 'trail.nodeBusy',
        eventId: 'evt-1',
        commandId: 'cmd-1',
        trailId: TRAIL_ID,
        payload: { nodeId: NODE_ID, on: true },
    };
    const parsed = parseServerEvent(event);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.payload.on, true);

    assert.equal(parseServerEvent({ ...event, type: 'trail.없는것' }).ok, false);
    assert.equal(parseServerEvent({ ...event, payload: { nodeId: NODE_ID } }).ok, false);
});

test('구현 후보 이벤트는 고를 값과 잘림 여부를 함께 싣는다', () => {
    const schema = EVENT_PAYLOADS['trail.implementationChoice'];
    const parsed = parseWith(schema, {
        nodeId: NODE_ID,
        choiceId: 'choice-1',
        truncated: false,
        candidates: [
            { candidateId: 'c1', name: 'Impl', displayPath: 'proj/a.cs', line: 10, hasBody: true },
        ],
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.choiceId, 'choice-1');

    // 잘림만 알릴 때는 고를 것이 없다.
    const notice = parseWith(schema, {
        nodeId: NODE_ID, choiceId: null, truncated: true, candidates: [],
    });
    assert.equal(notice.ok, true);
});

test('오류 맥락은 없어도 있어도 통과한다', () => {
    // 전부 선택이라 맥락을 모르는 옛 화면도 그대로 받는다(U01).
    const schema = EVENT_PAYLOADS['command.error'];
    const bare = parseWith(schema, {
        error: { code: 'NOT_FOUND', message: '정의를 찾지 못했다.', retryable: true },
    });
    assert.equal(bare.ok, true);

    const rich = parseWith(schema, {
        error: {
            code: 'NOT_FOUND',
            message: '언어 서버가 뜨는 중이다.',
            retryable: true,
            context: {
                language: 'cpp', lspState: 'starting', verified: false, action: 'retry',
            },
        },
    });
    assert.equal(rich.ok, true);
    assert.equal(rich.value.error.context.action, 'retry');

    // 모르는 행동은 받지 않는다. 화면이 못 그리는 버튼을 붙이게 된다.
    const wrong = parseWith(schema, {
        error: {
            code: 'NOT_FOUND', message: 'x', retryable: false, context: { action: '아무거나' },
        },
    });
    assert.equal(wrong.ok, false);
});

test('Markdown 은 이벤트에 본문을 싣지 않고 URL 만 준다', () => {
    const schema = EVENT_PAYLOADS['trail.exportReady'];
    const parsed = parseWith(schema, {
        trailId: TRAIL_ID,
        url: `/api/trails/${TRAIL_ID}/export.md`,
        fileName: 'trail.md',
    });
    assert.equal(parsed.ok, true);
    assert.equal('markdown' in parsed.value, false);
    assert.equal('content' in parsed.value, false);
});
