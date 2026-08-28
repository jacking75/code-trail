/**
 * 로컬 서버 조립 지점.
 *
 * 단계 2에서 Fastify 부트스트랩, 정적 자산, 인증 middleware, CSP, WebSocket 게이트웨이가
 * 여기에 붙는다. 지금은 공유 도메인이 서버 쪽에서 `vscode` 없이 그대로 쓰이는지만 보인다.
 */
import { PROTOCOL_VERSION, defaultSettings, type ProjectSettings } from '@code-trail/shared';

export interface ServerOptions {
    /** 이미 절대화·검증이 끝난 프로젝트 루트. CLI 가 넘긴다. */
    projectRoot: string;
    settings?: ProjectSettings;
}

export interface ServerInfo {
    protocolVersion: typeof PROTOCOL_VERSION;
    projectRoot: string;
    settings: ProjectSettings;
}

export function describeServer(options: ServerOptions): ServerInfo {
    return {
        protocolVersion: PROTOCOL_VERSION,
        projectRoot: options.projectRoot,
        settings: options.settings ?? defaultSettings(),
    };
}
