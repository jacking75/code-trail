import type { FastifyInstance } from 'fastify';

import { PROTOCOL_VERSION } from '@code-trail/shared';

import type { ServerContext } from '../context.js';
import { PathDeniedError } from '../security/paths.js';
import { DocumentTooLargeError } from '../workspace/documents.js';
import { searchFiles } from '../workspace/search.js';

/**
 * HTTP API (구현서 15.1).
 *
 * 여기서 돌려주는 것은 **읽기**뿐이다. 상태를 바꾸는 것은 전부 WebSocket 명령으로
 * 간다. 그래야 "누가 언제 무엇을 바꿨는가" 가 한 통로에 모이고, revision 과
 * 이벤트 방송이 한곳에서 끝난다.
 */

function denyStatus(reason: PathDeniedError['reason']): number {
    return reason === 'notFound' ? 404 : 403;
}

export async function registerRoutes(app: FastifyInstance, context: ServerContext): Promise<void> {
    app.get('/api/health', async () => ({
        status: 'ok' as const,
        uptimeSeconds: Math.round(process.uptime()),
    }));

    app.get('/api/bootstrap', async () => ({
        protocolVersion: PROTOCOL_VERSION,
        project: { name: context.projectName },
        settings: context.store.getSettings(),
        trails: context.trails.list(),
        activeTrailId: context.trails.getActiveTrailId(),
        capabilities: {
            // 단계 9에서 외부 에디터가, 단계 6에서 언어 서버가 붙는다.
            externalEditor: context.store.getSettings().editor.executable !== null,
            languages: [] as string[],
        },
    }));

    app.get<{ Querystring: { id?: string } }>('/api/workspace/children', async (request, reply) => {
        const id = request.query.id ?? '';
        try {
            const result = await context.tree.children(id);
            return { parentId: id, entries: result.entries, truncated: result.truncated };
        } catch (error) {
            if (error instanceof PathDeniedError) {
                return reply.code(denyStatus(error.reason)).send({
                    code: 'PATH_DENIED',
                    message: '허용되지 않은 경로다.',
                    retryable: false,
                });
            }
            throw error;
        }
    });

    app.get<{ Querystring: { q?: string } }>('/api/workspace/search', async (request) => {
        return searchFiles(context.tree, request.query.q ?? '');
    });

    /**
     * 문서 본문. **`documentId` 만 받는다.**
     * 브라우저가 경로를 보내 임의 파일을 지목하는 통로를 만들지 않는다(구현서 8.2).
     */
    app.get<{ Params: { documentId: string } }>(
        '/api/documents/:documentId',
        async (request, reply) => {
            try {
                return await context.documents.read(request.params.documentId);
            } catch (error) {
                if (error instanceof DocumentTooLargeError) {
                    return reply.code(413).send({
                        code: 'PATH_DENIED',
                        message: '파일이 너무 크다.',
                        retryable: false,
                    });
                }
                if (error instanceof PathDeniedError) {
                    return reply.code(denyStatus(error.reason)).send({
                        code: 'PATH_DENIED',
                        message: '허용되지 않은 문서다.',
                        retryable: false,
                    });
                }
                throw error;
            }
        },
    );

    /**
     * 프로젝트 안의 파일을 열어 문서 권한을 받는다.
     *
     * 상대경로를 받는 유일한 지점이다. 여기서 경계 검사와 심볼릭 링크 확인을
     * 모두 통과해야 `documentId` 가 나온다.
     */
    app.get<{ Querystring: { relPath?: string } }>('/api/workspace/open', async (request, reply) => {
        const relPath = request.query.relPath ?? '';
        try {
            const grant = await context.documents.grantInsideProject(relPath);
            return await context.documents.read(grant.documentId);
        } catch (error) {
            if (error instanceof DocumentTooLargeError) {
                return reply.code(413).send({
                    code: 'PATH_DENIED',
                    message: '파일이 너무 크다.',
                    retryable: false,
                });
            }
            if (error instanceof PathDeniedError) {
                return reply.code(denyStatus(error.reason)).send({
                    code: 'PATH_DENIED',
                    message: '허용되지 않은 경로다.',
                    retryable: false,
                });
            }
            throw error;
        }
    });

    app.get<{ Params: { trailId: string } }>(
        '/api/trails/:trailId/export.md',
        async (request, reply) => {
            const result = context.trails.markdown(request.params.trailId);
            if (!result.ok) {
                return reply.code(404).send(result.error);
            }
            const trail = context.trails.get(request.params.trailId);
            const name = `${(trail?.title ?? 'trail').replace(/[^\w가-힣.-]+/g, '_')}.md`;
            return reply
                .header('Content-Type', 'text/markdown; charset=utf-8')
                .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
                .send(result.value);
        },
    );

    app.get('/api/diagnostics', async () => ({
        // 언어 서버는 단계 4~6에서 붙는다. 지금은 저장소 쪽 진단만 있다.
        languages: [] as unknown[],
        recoveryCandidates: context.store.getRecoveryCandidates(),
    }));
}
