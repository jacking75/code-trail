/* CLI 인자 해석 — node --test "test/unit/*.test.mjs" */
import test from 'node:test';
import assert from 'node:assert/strict';

const cli = await import(
    new URL('../../packages/cli/dist/args.js', import.meta.url).href
);
const browser = await import(
    new URL('../../packages/cli/dist/openBrowser.js', import.meta.url).href
);

const { CliArgsError, USAGE, parseArgs } = cli;

test('인자가 없으면 현재 디렉터리를 연다', () => {
    const args = parseArgs([]);
    assert.equal(args.projectDirectory, process.cwd());
    assert.equal(args.mode, 'run');
});

test('기본값은 빈 포트 자동 선택과 브라우저 열기다', () => {
    const args = parseArgs([]);
    assert.equal(args.port, 0);
    assert.equal(args.open, true);
    assert.equal(args.logLevel, 'info');
    assert.equal(args.trailId, null);
    assert.equal(args.configPath, null);
});

test('프로젝트 경로를 위치 인자로 받는다', () => {
    assert.equal(parseArgs(['C:/proj']).projectDirectory, 'C:/proj');
    assert.equal(parseArgs(['./relative']).projectDirectory, './relative');
});

test('옵션을 모두 해석한다', () => {
    const args = parseArgs([
        'proj', '--port', '5173', '--no-open',
        '--trail', 'abc', '--log-level', 'debug', '--config', 'custom.json',
    ]);
    assert.equal(args.projectDirectory, 'proj');
    assert.equal(args.port, 5173);
    assert.equal(args.open, false);
    assert.equal(args.trailId, 'abc');
    assert.equal(args.logLevel, 'debug');
    assert.equal(args.configPath, 'custom.json');
});

test('--help 와 --version 은 서버를 띄우지 않는다', () => {
    for (const flag of ['-h', '--help']) {
        assert.equal(parseArgs([flag]).mode, 'help');
    }
    for (const flag of ['-v', '--version']) {
        assert.equal(parseArgs([flag]).mode, 'version');
    }
    // 다른 인자보다 우선한다.
    assert.equal(parseArgs(['proj', '--help', '--port', '1']).mode, 'help');
});

test('잘못된 인자를 거부한다', () => {
    const bad = [
        ['--port'],                  // 값 없음
        ['--port', '--no-open'],     // 값 자리에 옵션
        ['--port', '70000'],         // 범위 밖
        ['--port', '-1'],
        ['--port', 'abc'],
        ['--log-level', 'verbose'],  // 모르는 수준
        ['--모르는옵션'],
        ['a', 'b'],                  // 위치 인자 둘
    ];
    for (const argv of bad) {
        assert.throws(() => parseArgs(argv), CliArgsError, argv.join(' '));
    }
});

test('호스트를 바꾸는 옵션은 없다', () => {
    // 서버는 127.0.0.1 에만 바인딩한다(구현서 7.1). 빠진 기능이 아니라 정한 것이라
    // 실수로 되살아나지 않게 도움말과 해석기 양쪽에서 못을 박는다.
    for (const flag of ['--host', '--bind', '--address', '--public']) {
        assert.throws(() => parseArgs([flag, '0.0.0.0']), CliArgsError, flag);
    }
    assert.equal(USAGE.includes('--host'), false);
    assert.match(USAGE, /127\.0\.0\.1 에만 바인딩/);
});

test('브라우저 열기는 플랫폼별 명령을 고른다', () => {
    // 실제로 열지 않는다. 명령 선택만 본다.
    const url = 'http://127.0.0.1:5173/#token=비밀';

    assert.deepEqual(browser.browserCommand(url, 'win32'), {
        command: 'rundll32',
        args: ['url.dll,FileProtocolHandler', url],
    });
    assert.deepEqual(browser.browserCommand(url, 'darwin'), { command: 'open', args: [url] });
    assert.deepEqual(browser.browserCommand(url, 'linux'), { command: 'xdg-open', args: [url] });

    // URL 은 인자 배열에 통째로 들어간다. 셸 문자열로 이어 붙이지 않는다 —
    // 토큰에 셸이 해석할 문자가 있어도 그대로 전달되어야 한다.
    for (const platform of ['win32', 'darwin', 'linux']) {
        const picked = browser.browserCommand(url, platform);
        assert.equal(picked.args.includes(url), true, platform);
        assert.equal(picked.command.includes(url), false, platform);
    }
});
