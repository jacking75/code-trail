import type { FastifyInstance } from 'fastify';

import { PROTOCOL_VERSION, textForRange } from '@code-trail/shared';

import type { ServerContext } from '../context.js';
import { findSolutionCandidates } from '../lsp/adapters/index.js';
import { toPublicState } from '../lsp/types.js';
import { supportedLanguageFor, type SupportedLanguage } from '../workspace/languages.js';
import { PathDeniedError } from '../security/paths.js';
import { DocumentTooLargeError } from '../workspace/documents.js';
import { searchFiles } from '../workspace/search.js';
import { searchContent } from '../workspace/contentSearch.js';
import { markdownOptionsFor } from '../trails/markdownOptions.js';

/**
 * HTTP API (구현서 15.1).
 *
 * 여기서 돌려주는 것은 **읽기**뿐이다. 상태를 바꾸는 것은 전부 WebSocket 명령으로
 * 간다. 그래야 "누가 언제 무엇을 바꿨는가" 가 한 통로에 모이고, revision 과
 * 이벤트 방송이 한곳에서 끝난다.
 */

const SUPPORTED_LANGUAGES: readonly string[] = ['cpp', 'csharp', 'go', 'rust', 'typescript'];

/** 이 둘이 실제 문서에서 응답해야 `지원됨` 이다. */
const VERIFY_METHODS = ['textDocument/documentSymbol', 'textDocument/definition'] as const;

function denyStatus(reason: PathDeniedError['reason']): number {
    return reason === 'notFound' ? 404 : 403;
}

/**
 * 변경 관련 API 가 받아들이는 경로.
 *
 * 두 관문을 다 지나야 한다 — 문서 권한(경계·심볼릭 링크)과 "지금 변경 목록에
 * 있는가". 앞의 것만으로는 프로젝트 안 아무 파일의 이력이나 원본을 꺼낼 수 있다.
 */
async function allowedChangedPath(
    context: ServerContext,
    raw: string,
    base?: { from?: string; to?: string },
): Promise<string | null> {
    const grant = await context.documents.grantInsideProject(raw).catch(() => null);
    if (grant === null || grant.relPath === null) {
        return null;
    }
    // 변경 기준이 있으면 그 기준의 목록으로 본다(V01). 작업 트리 목록만 보면
    // 이미 커밋된 변경의 hunk 를 열 수 없다.
    const changes = base?.from
        ? await context.git.changesBetween(base.from, base.to).catch(() => [])
        : await context.git.workingChanges().catch(() => []);
    return changes.some((change) => change.relPath === grant.relPath
        || change.oldRelPath === grant.relPath)
        ? grant.relPath
        : null;
}

/**
 * 변경 기준 질의를 실제 git 기준으로 바꾼다 (V01).
 *
 * `mergeBase=1` 이면 `from` 을 `merge-base(from, to)` 로 바꾼다. 화면이 보낸
 * 문자열을 그대로 git 인자로 넘기지 않는다 — `resolveRevision` 이 먼저 확인한다.
 */
async function resolveBase(
    context: ServerContext,
    query: { from?: string; to?: string; mergeBase?: string },
): Promise<{ from?: string; to?: string }> {
    if (!query.from) {
        return {};
    }
    const to = query.to && query.to !== '' ? query.to : undefined;
    if (query.mergeBase === '1' && to !== undefined) {
        return { from: await context.git.mergeBase(query.from, to), to };
    }
    return to === undefined ? { from: query.from } : { from: query.from, to };
}

export async function registerRoutes(app: FastifyInstance, context: ServerContext): Promise<void> {
    app.get('/api/health', async () => ({
        status: 'ok' as const,
        uptimeSeconds: Math.round(process.uptime()),
    }));

    app.get('/api/bootstrap', async () => ({
        protocolVersion: PROTOCOL_VERSION,
        project: { name: context.projectName },
        /**
         * 언어별 파일 수. 시작하기 카드가 "이 프로젝트가 되는지" 를 먼저 보여준다.
         * 세다가 실패해도 시작을 막지 않는다 — 그냥 요약이 비는 것뿐이다.
         */
        languageSummary: await context.tree.languageSummary()
            .catch(() => ({ languages: [], truncated: false })),
        settings: context.store.getSettings(),
        localAuthor: context.store.getLocalAuthor(),
        trails: context.trails.list(),
        activeTrailId: context.trails.getActiveTrailId(),
        /**
         * 이 기계의 개인 화면 상태 (V18). 없으면 `null` 이고 화면이 기본값을 쓴다.
         * 절대경로·documentId·토큰은 들어가지 않는다.
         */
        localUiState: context.localUiState.get(),
        capabilities: {
            externalEditor: context.editor.isConfigured(),
            // 실행 파일을 찾은 언어만 알린다. 실제로 뜨는지는 열어봐야 안다.
            languages: await context.lsp.availableLanguages(),
            analyses: true,
            sharing: true,
            readOnlyShare: context.readOnlyShare,
            ai: context.readOnlyShare
                ? { enabled: false, provider: 'ollama', model: '', maxInputBytes: 0 }
                : context.ai.capability(),
        },
    }));

    app.get('/api/analyses', async () => ({ analyses: context.analyses.list() }));

    app.get<{ Params: { analysisId: string } }>('/api/analyses/:analysisId', async (request, reply) => {
        const analysis = context.analyses.get(request.params.analysisId);
        return analysis ?? reply.code(404).send({
            code: 'NOT_FOUND', message: '분석 문서를 찾을 수 없다.', retryable: false,
        });
    });

    app.get<{ Params: { analysisId: string; anchorId: string } }>(
        '/api/analyses/:analysisId/anchors/:anchorId/compare',
        async (request, reply) => {
            const analysis = context.analyses.get(request.params.analysisId);
            const anchor = analysis?.anchors.find((item) => item.id === request.params.anchorId);
            const baseline = analysis?.baselines.find((item) => item.id === anchor?.baselineId);
            const file = baseline?.files.find((item) => item.fileId === anchor?.fileId);
            if (!analysis || !anchor || !baseline || !file) {
                return reply.code(404).send({
                    code: 'NOT_FOUND', message: '비교할 기록 위치를 찾을 수 없다.', retryable: false,
                });
            }

            // 저장된 상대경로를 그대로 읽지 않고 문서 권한 경계를 다시 통과시킨다.
            // 가져온 공유 자료가 악의적인 경로를 담아도 프로젝트 밖 파일은 열리지 않는다.
            const grant = await context.documents.grantInsideProject(file.relPath).catch(() => null);
            const content = grant
                ? await context.documents.read(grant.documentId).catch(() => null)
                : null;
            const currentRange = anchor.currentRange ?? anchor.range;
            const currentText = content ? textForRange(content.text, currentRange) : null;
            const currentUnavailableReason = !content
                ? 'file-unavailable' as const
                : currentText === null
                    ? 'range-unavailable' as const
                    : null;

            return {
                analysisId: analysis.id,
                anchorId: anchor.id,
                relPath: file.relPath,
                state: anchor.state,
                previousRange: anchor.range,
                currentRange,
                previousText: anchor.selectedText,
                currentText,
                previousUnavailableReason: anchor.selectedText === null ? 'code-not-included' as const : null,
                currentUnavailableReason,
            };
        },
    );

    app.get<{ Querystring: { q?: string; kind?: 'explanation' | 'question' | 'concern' | 'conclusion'; status?: 'open' | 'resolved'; tag?: string } }>(
        '/api/annotations/search',
        async (request) => ({
            results: context.analyses.search(request.query.q ?? '', {
                ...(request.query.kind ? { kind: request.query.kind } : {}),
                ...(request.query.status ? { status: request.query.status } : {}),
                ...(request.query.tag ? { tag: request.query.tag } : {}),
            }),
        }),
    );

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

    app.get<{ Params: { documentId: string } }>(
        '/api/documents/:documentId/symbols',
        async (request, reply) => {
            const grant = context.documents.get(request.params.documentId);
            if (!grant) return reply.code(404).send({ code: 'NOT_FOUND', message: '문서 권한이 없다.', retryable: false });
            const controller = new AbortController();
            const abort = (): void => controller.abort();
            request.raw.once('aborted', abort);
            try {
                const symbols = await context.lsp.documentSymbols(grant, controller.signal);
                return { documentId: grant.documentId, symbols };
            } catch {
                return reply.code(503).send({
                    code: 'LSP_UNAVAILABLE', message: '문서 심볼을 가져오지 못했다.', retryable: true,
                });
            } finally {
                request.raw.off('aborted', abort);
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
            const content = await context.documents.read(grant.documentId);
            return {
                ...content,
                /**
                 * 이 파일 형식에 심볼 해석이 되는지. `null` 이면 언어 서버에
                 * 물을 것이 없다 — 화면이 서버 왕복 없이 바로 안내한다.
                 */
                supportedLanguage: supportedLanguageFor(content.languageId),
            };
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

    app.get<{ Params: { trailId: string }; Querystring: { analysis?: string; mermaid?: string } }>(
        '/api/trails/:trailId/export.md',
        async (request, reply) => {
            const result = context.trails.markdown(
                request.params.trailId,
                markdownOptionsFor(context.analyses, request.params.trailId, {
                    analysisId: request.query.analysis,
                    mermaid: request.query.mermaid === '1',
                }),
            );
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

    /**
     * 노드 하나와 그 하위의 Markdown (V08).
     *
     * 트레일 전체 내보내기와 **같은 함수**를 쓴다. 브라우저가 따로 만들면 같은
     * 이름의 결과가 두 형식이 된다.
     */
    app.get<{
        Params: { trailId: string; nodeId: string };
        Querystring: { analysis?: string };
    }>('/api/trails/:trailId/nodes/:nodeId/export.md', async (request, reply) => {
        const result = context.trails.nodeMarkdown(
            request.params.trailId,
            request.params.nodeId,
            markdownOptionsFor(context.analyses, request.params.trailId, {
                analysisId: request.query.analysis,
            }),
        );
        if (!result.ok) return reply.code(404).send(result.error);
        return reply
            .header('Content-Type', 'text/markdown; charset=utf-8')
            .send(result.value);
    });

    app.get<{ Querystring: { from?: string; to?: string; mergeBase?: string } }>('/api/changes', async (request, reply) => {
        try {
            const base = await resolveBase(context, request.query);
            const changes = base.from
                ? await context.git.changesBetween(base.from, base.to)
                : await context.git.workingChanges();
            return { repository: true, changes };
        } catch {
            return reply.code(200).send({ repository: false, changes: [], message: 'Git 변경 정보를 읽을 수 없다.' });
        }
    });

    /**
     * 변경 기준으로 고를 수 있는 브랜치와 최근 커밋 (V01).
     *
     * Git 저장소가 아니면 빈 목록을 준다 — 셀렉트가 비활성이 되고 나머지 화면은
     * 그대로 돈다.
     */
    app.get('/api/changes/refs', async () => {
        try {
            return { repository: true, ...await context.git.recentRefs() };
        } catch {
            return {
                repository: false,
                currentBranch: null,
                defaultBranch: null,
                branches: [],
                commits: [],
            };
        }
    });

    /**
     * 그 파일에서 바뀐 줄 덩어리 (U14).
     *
     * 경로는 문서 권한 경계를 다시 통과시키고, 지금 변경 목록에 있는 파일만
     * 허용한다. 브라우저가 임의 파일의 diff 를 꺼내 가는 통로를 만들지 않는다.
     */
    app.get<{ Querystring: { relPath?: string; from?: string; to?: string; mergeBase?: string } }>(
        '/api/changes/hunks',
        async (request, reply) => {
            const base = await resolveBase(context, request.query)
                .catch((): { from?: string; to?: string } => ({}));
            const relPath = await allowedChangedPath(context, request.query.relPath ?? '', base);
            if (relPath === null) {
                return reply.code(403).send({
                    code: 'PATH_DENIED', message: '변경 목록에 없는 파일이다.', retryable: false,
                });
            }
            try {
                const hunks = await context.git.hunks(relPath, base.from, base.to);
                return { relPath, hunks };
            } catch {
                return reply.code(200).send({ relPath, hunks: [] });
            }
        },
    );

    /** 그 기준 시점의 본문. 좌우 비교가 왼쪽에 넣는다. */
    app.get<{ Querystring: { relPath?: string; ref?: string; to?: string; mergeBase?: string } }>(
        '/api/changes/original',
        async (request, reply) => {
            const requested = request.query.ref ?? 'HEAD';
            // 브랜치 이름도 받는다. git 인자로 쓰기 전에 커밋 해시로 고정한다.
            const resolved = requested === 'HEAD'
                ? {}
                : await resolveBase(context, { ...request.query, from: requested })
                    .catch((): { from?: string; to?: string } => ({}));
            const ref = resolved.from ?? 'HEAD';
            const base = resolved.from === undefined ? {} : resolved;
            const relPath = await allowedChangedPath(context, request.query.relPath ?? '', base);
            if (relPath === null) {
                return reply.code(403).send({
                    code: 'PATH_DENIED', message: '변경 목록에 없는 파일이다.', retryable: false,
                });
            }
            try {
                return await context.git.originalText(ref, relPath);
            } catch {
                return reply.code(400).send({
                    code: 'INVALID_COMMAND',
                    message: '이 기준에서 원본을 읽을 수 없다.',
                    retryable: false,
                });
            }
        },
    );

    app.get<{ Querystring: { q?: string; scope?: string; case?: string } }>(
        '/api/workspace/content-search',
        async (request, reply) => {
            const controller = new AbortController();
            const abort = (): void => controller.abort();
            request.raw.once('aborted', abort);
            try {
                return await searchContent({
                    tree: context.tree,
                    query: request.query.q ?? '',
                    scope: request.query.scope ?? '',
                    caseSensitive: request.query.case === '1',
                    signal: controller.signal,
                });
            } catch {
                return reply.code(400).send({
                    code: 'INVALID_COMMAND', message: '내용 검색 조건이 올바르지 않다.', retryable: false,
                });
            } finally {
                request.raw.off('aborted', abort);
            }
        },
    );

    app.get<{ Params: { planId: string; format: string } }>(
        '/api/shares/:planId/:format',
        async (request, reply) => {
            const exported = context.sharing.export(request.params.planId);
            if (!exported) return reply.code(404).send({ code: 'NOT_FOUND', message: '내보내기 계획이 없거나 바뀌었다.', retryable: false });
            const safe = exported.bundle.analysis.title.replace(/[^\w가-힣.-]+/g, '_') || 'code-trail-share';
            if (request.params.format === 'markdown') {
                return reply.header('Content-Type', 'text/markdown; charset=utf-8')
                    .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safe}.md`)}`)
                    .send(context.sharing.markdown(exported.bundle));
            }
            if (request.params.format === 'html') {
                return reply.header('Content-Type', 'text/html; charset=utf-8')
                    .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safe}.html`)}`)
                    .send(context.sharing.staticHtml(exported.bundle));
            }
            if (request.params.format !== 'ctshare') return reply.code(404).send({ code: 'NOT_FOUND', message: '모르는 내보내기 형식이다.', retryable: false });
            return reply.header('Content-Type', 'application/json; charset=utf-8')
                .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${safe}.ctshare.json`)}`)
                .send(exported.text);
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
            analysisRecoveryCandidates: context.analysisStore.getRecoveryCandidates(),
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
