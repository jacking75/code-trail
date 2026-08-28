#!/usr/bin/env node
/**
 * `code-trail [project-directory]` 진입점.
 *
 * 단계 2에서 인자 해석, 프로젝트 검증, 포트 선택, 브라우저 열기, 종료 신호 처리가
 * 여기에 붙는다. 심볼 해석과 트레일 변경은 여기서 하지 않는다(구현서 5.2).
 */
export const CLI_NAME = 'code-trail';
