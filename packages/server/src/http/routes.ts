import type { FastifyInstance } from 'fastify';

import { PROTOCOL_VERSION } from '@code-trail/shared';

import type { ServerContext } from '../context.js';
import { findSolutionCandidates } from '../lsp/adapters/index.js';
import { toPublicState } from '../lsp/types.js';
import type { SupportedLanguage } from '../workspace/languages.js';
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

const SUPPORTED_LANGUAGES: readonly string[] = ['cpp', 'csharp', 'go', 'rust'];

/** 이 둘이 실제 문서에서 응답해야 `지원됨` 이다. */
const VERIFY_METHODS = ['textDocument/documentSymbol', 'textDocument/definition'] as const;

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
            externalEditor: context.editor.isConfigured(),
            // 실행 파일을 찾은 언어만 알린다. 실제로 뜨는지는 열어봐야 안다.
            languages: await context.lsp.availableLanguages(),
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

    app.get('/api/diagnostics', async () => {
        const languages = await context.lsp.diagnostics();
        return {
            languages: languages.map((info) => ({
                language: info.language,
                displayName: info.displayName,
                enabled: info.enabled,
                state: toPublicState(info.state),
                // 실행 파일 **이름**만. 전체 경로는 내보내지 않는다(구현서 8.1).
                // 예외는 rust-analyzer 뿐이고, 그건 어댑터가 점검 항목에 담는다.
                executableName: info.executableName,
                detectionSource: info.detectionSource,
                lastError: info.lastError,
                restartCount: info.restartCount,
                missingCapabilities: info.missingCapabilities,
                healthChecks: info.healthChecks,
                pid: info.pid,
                capabilities: info.capabilities,
                initializeMs: info.initializeMs,
                lastRequest: info.lastRequest,
                lastExit: info.lastExit,
                /**
                 * `지원됨` 은 프로세스가 떴다는 뜻이 아니라 실제 샘플 문서에서
                 * `documentSymbol` 과 `definition` 이 응답했다는 뜻이다(구현서 18).
                 */
                verified: VERIFY_METHODS.every(
                    (method) => info.verifiedMethods.includes(method),
                ),
                verifiedMethods: info.verifiedMethods,
            })),
            recoveryCandidates: context.store.getRecoveryCandidates(),
        };
    });

    /**
     * 외부 에디터 후보와 지금 설정 (구현서 17.2).
     *
     * **제안만 한다.** 사용자가 설정으로 확정하기 전에는 아무것도 실행하지 않는다.
     * 후보는 실행 파일 **이름**만 담는다 — 전체 경로는 브라우저로 내보내지 않는다.
     */
    app.get('/api/diagnostics/editor', async () => {
        const settings = context.store.getSettings().editor;
        return {
            candidates: await context.editor.candidates(),
            configured: settings.executable,
            args: settings.args,
        };
    });

    /** C# 솔루션 후보. 여럿이면 사용자가 하나를 골라 설정에 적는다(구현서 12.2). */
    app.get('/api/diagnostics/csharp/solutions', async () => {
        const candidates = await findSolutionCandidates(context.projectRoot);
        return {
            // 프로젝트 상대경로만. 절대경로는 내보내지 않는다.
            candidates: candidates.paths,
            suggested: candidates.suggested,
            selected: context.store.getSettings().languages.csharp.solutionPath,
        };
    });

    /**
     * 언어 서버의 최근 stderr.
     *
     * 토큰 인증을 거친다(구현서 11.6). 코드 본문이 섞여 들어올 수 있어서
     * 기본 진단 화면에는 넣지 않고 사용자가 따로 열게 한다.
     */
    app.get<{ Params: { language: string } }>(
        '/api/diagnostics/:language/log',
        async (request, reply) => {
            const { language } = request.params;
            if (!SUPPORTED_LANGUAGES.includes(language as SupportedLanguage)) {
                return reply.code(404).send({
                    code: 'NOT_FOUND',
                    message: '모르는 언어다.',
                    retryable: false,
                });
            }
            return {
                language,
                lines: context.lsp.recentLog(language as SupportedLanguage),
            };
        },
    );
}
