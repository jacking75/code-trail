/**
 * Code Trail 공유 패키지.
 *
 * 서버·CLI·웹이 함께 쓰는 도메인 모델과 프로토콜만 담는다. 파일 시스템, 네트워크,
 * DOM, 그리고 VS Code API 에 절대 의존하지 않는다 — 이 패키지가 `vscode` 없이
 * 빌드되는지가 확장에서 떨어져 나왔는지를 재는 기준이다.
 */

export * from './domain/symbol.js';
export * from './domain/trail.js';
export * from './domain/settings.js';
export * from './domain/storage.js';
export * from './domain/markdown.js';
export * from './domain/ids.js';

export * from './protocol/schemas.js';
export * from './protocol/commands.js';
export * from './protocol/events.js';
