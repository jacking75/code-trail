import { isLogLevel, type LogLevel } from '@code-trail/server';

/**
 * `code-trail [project-directory]` 인자 해석 (구현서 7.1).
 *
 * 라이브러리를 쓰지 않는다. 옵션이 다섯 개뿐이고, 인자 해석기가 하나 늘면
 * 그 라이브러리의 동작(축약형, 부정형, 환경변수 읽기)까지 우리 계약이 된다.
 *
 * **호스트 주소를 바꾸는 옵션은 없다.** 서버는 `127.0.0.1` 에만 바인딩한다.
 * 이건 빠진 기능이 아니라 정한 것이다 — 이 서버는 로컬 파일과 프로세스에 닿는다.
 */

export interface CliArgs {
    projectDirectory: string;
    port: number;
    open: boolean;
    trailId: string | null;
    logLevel: LogLevel;
    configPath: string | null;
    /** `--help` 나 `--version` 이면 서버를 띄우지 않는다. */
    mode: 'run' | 'help' | 'version';
}

export class CliArgsError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CliArgsError';
    }
}

export const USAGE = `code-trail [project-directory]

  코드 탐색 트레일을 로컬 서버로 띄우고 기본 브라우저를 연다.
  경로를 주지 않으면 현재 디렉터리를 연다.

옵션
  --port <number>      들을 포트. 기본 0 = 운영체제가 빈 포트를 고른다
  --no-open            브라우저를 자동으로 열지 않는다
  --trail <trail-id>   시작한 뒤 이 트레일을 고른다
  --log-level <level>  error | warn | info | debug  (기본 info)
  --config <path>      설정 파일 위치를 덮어쓴다 (테스트·특수 환경 전용)
  -h, --help           이 도움말
  -v, --version        버전

서버는 항상 127.0.0.1 에만 바인딩한다. 외부 주소로 여는 옵션은 없다.
`;

function requireValue(name: string, value: string | undefined): string {
    if (value === undefined || value.startsWith('--')) {
        throw new CliArgsError(`${name} 에 값이 필요하다.`);
    }
    return value;
}

export function parseArgs(argv: readonly string[]): CliArgs {
    const args: CliArgs = {
        projectDirectory: '',
        port: 0,
        open: true,
        trailId: null,
        logLevel: 'info',
        configPath: null,
        mode: 'run',
    };
    const positional: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] as string;
        switch (arg) {
            case '-h':
            case '--help':
                args.mode = 'help';
                return args;
            case '-v':
            case '--version':
                args.mode = 'version';
                return args;
            case '--no-open':
                args.open = false;
                break;
            case '--port': {
                const raw = requireValue('--port', argv[++i]);
                const port = Number(raw);
                if (!Number.isInteger(port) || port < 0 || port > 65535) {
                    throw new CliArgsError('--port 는 0~65535 사이 정수다.');
                }
                args.port = port;
                break;
            }
            case '--trail':
                args.trailId = requireValue('--trail', argv[++i]);
                break;
            case '--log-level': {
                const level = requireValue('--log-level', argv[++i]);
                if (!isLogLevel(level)) {
                    throw new CliArgsError('--log-level 은 error|warn|info|debug 중 하나다.');
                }
                args.logLevel = level;
                break;
            }
            case '--config':
                args.configPath = requireValue('--config', argv[++i]);
                break;
            default:
                if (arg.startsWith('-')) {
                    throw new CliArgsError(`모르는 옵션이다: ${arg}`);
                }
                positional.push(arg);
        }
    }

    if (positional.length > 1) {
        throw new CliArgsError('프로젝트 경로는 하나만 준다.');
    }
    // 1. 인자가 없으면 현재 작업 디렉터리를 쓴다.
    args.projectDirectory = positional[0] ?? process.cwd();
    return args;
}
