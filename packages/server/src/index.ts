/**
 * Code Trail 로컬 서버.
 *
 * CLI 가 여기 있는 것만 쓴다. 서버 내부 구조(라우트, 게이트웨이, 저장소)는
 * 밖으로 내보내지 않는다 — CLI 가 서버 속을 직접 만지기 시작하면 계층이 무너진다.
 */

export { startServer, type RunningServer, type StartServerOptions } from './bootstrap.js';
export { createLogger, isLogLevel, LOG_LEVELS, type LogLevel, type Logger } from './config/logger.js';
export { readLock, isProcessAlive, type ServerLock } from './persistence/lock.js';
export { STORE_DIR, RUNTIME_DIR } from './persistence/store.js';
export { resolveProjectRoot } from './security/paths.js';
export { WS_PROTOCOL } from './security/auth.js';
