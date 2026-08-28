export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
    error(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    info(message: string, fields?: Record<string, unknown>): void;
    debug(message: string, fields?: Record<string, unknown>): void;
    child(prefix: string): Logger;
}

/**
 * 로그에 남기면 안 되는 것들.
 *
 * 구현서 8.1: 세션 토큰, 코드 본문, 환경 변수 전체, 언어 서버 인증 값을 남기지 않는다.
 * 사람이 매번 조심하는 대신 필드 이름으로 걸러낸다. 걸러지지 않은 이름으로 비밀을
 * 넣는 실수는 여전히 가능하지만, 흔한 실수 쪽은 여기서 막힌다.
 */
const MASKED_KEYS = /token|secret|password|authorization|cookie|apikey|api_key|env$/i;

/** 코드 본문처럼 통째로 남기면 안 되는 값. */
const BULK_KEYS = /^(code|text|content|body|source)$/i;

function maskValue(key: string, value: unknown): unknown {
    if (MASKED_KEYS.test(key)) {
        return '***';
    }
    if (BULK_KEYS.test(key) && typeof value === 'string') {
        return `<${value.length}자 생략>`;
    }
    if (typeof value === 'string' && value.length > 200) {
        return `${value.slice(0, 200)}…<${value.length}자>`;
    }
    return value;
}

function formatFields(fields: Record<string, unknown> | undefined): string {
    if (!fields) {
        return '';
    }
    const parts: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
        const masked = maskValue(key, value);
        parts.push(`${key}=${typeof masked === 'string' ? masked : JSON.stringify(masked)}`);
    }
    return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export interface LoggerOptions {
    level: LogLevel;
    /** 테스트에서 출력을 가로채기 위해 둔 구멍. 기본은 stderr. */
    write?: (line: string) => void;
}

export function createLogger(options: LoggerOptions): Logger {
    const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
    const threshold = ORDER[options.level];

    const make = (prefix: string): Logger => {
        const emit = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
            if (ORDER[level] > threshold) {
                return;
            }
            write(`[${level}]${prefix ? ` ${prefix}` : ''} ${message}${formatFields(fields)}`);
        };
        return {
            error: (m, f) => emit('error', m, f),
            warn: (m, f) => emit('warn', m, f),
            info: (m, f) => emit('info', m, f),
            debug: (m, f) => emit('debug', m, f),
            child: (childPrefix) => make(prefix ? `${prefix}:${childPrefix}` : childPrefix),
        };
    };

    return make('');
}

export function isLogLevel(value: string): value is LogLevel {
    return (LOG_LEVELS as readonly string[]).includes(value);
}
