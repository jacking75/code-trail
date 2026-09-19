import type { Logger } from './config/logger.js';
import type { EditorService } from './editor/service.js';
import type { LspManager } from './lsp/manager.js';
import type { ProjectStore } from './persistence/store.js';
import type { ResolveFlow } from './trails/resolveFlow.js';
import type { TrailService } from './trails/service.js';
import type { DocumentRegistry } from './workspace/documents.js';
import type { WorkspaceTree } from './workspace/tree.js';
import type { AnalysisStore } from './persistence/analysisStore.js';
import type { LocalUiStateStore } from './persistence/localUiStateStore.js';
import type { AnalysisService } from './analysis/service.js';
import type { SharingService } from './sharing/service.js';
import type { GitService } from './git/service.js';
import type { AiExplanationService } from './ai/service.js';

/**
 * 서버 한 대가 들고 있는 것들.
 *
 * 프로세스 하나가 프로젝트 하나만 연다(구현서 5.1). 그래서 이 묶음은 서버당
 * 하나뿐이고, 경로 보안·저장소·트레일 정본이 전부 같은 프로젝트 루트를 기준으로 돈다.
 */
export interface ServerContext {
    /** 심볼릭 링크를 푼 실제 프로젝트 루트. 절대경로다. */
    projectRoot: string;
    /** 화면에 찍는 프로젝트 이름. 절대경로를 브라우저로 내보내지 않는다. */
    projectName: string;
    logger: Logger;
    store: ProjectStore;
    trails: TrailService;
    tree: WorkspaceTree;
    documents: DocumentRegistry;
    /** 언어별 서버 세션. 그 언어 파일을 처음 열 때 뜬다. */
    lsp: LspManager;
    /** 정의 클릭 한 번이 일으키는 일. 게이트웨이와 도메인 사이에 있다. */
    resolveFlow: ResolveFlow;
    /** 외부 에디터 열기. 경로는 문서 권한에서 역조회한다. */
    editor: EditorService;
    analysisStore: AnalysisStore;
    analyses: AnalysisService;
    sharing: SharingService;
    git: GitService;
    ai: AiExplanationService;
    /** 이 기계의 개인 화면 상태. 트레일·분석과 섞지 않는다(V18). */
    localUiState: LocalUiStateStore;
    /** 프로젝트 없는 공유 읽기에서는 변경 동작과 LSP를 제한한다. */
    readOnlyShare: boolean;
}
