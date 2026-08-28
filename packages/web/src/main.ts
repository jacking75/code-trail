/**
 * 브라우저 진입점.
 *
 * 단계 2에서 Vite·React 앱과 부트스트랩 토큰 처리가, 단계 7에서 트레일 화면이 붙는다.
 * 프론트엔드는 파일 시스템과 프로세스에 직접 접근하지 않는다(구현서 5.2).
 */
import { PROTOCOL_VERSION } from '@code-trail/shared';

export const protocolVersion = PROTOCOL_VERSION;
