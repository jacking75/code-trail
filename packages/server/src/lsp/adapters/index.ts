import type { SupportedLanguage } from '../../workspace/languages.js';
import { clangdAdapter } from './clangd.js';
import { csharpAdapter } from './csharp.js';
import { goplsAdapter } from './gopls.js';
import { rustAnalyzerAdapter } from './rustAnalyzer.js';
import { typescriptAdapter } from './typescript.js';
import type { LspAdapter } from './types.js';

/**
 * 언어 → 어댑터.
 *
 * 공통 LSP 계층이 언어를 아는 유일한 자리다. 여기 말고 다른 곳에
 * `if (language === 'cpp')` 가 생기면 그건 어댑터로 옮겨야 하는 코드다.
 */
export const ADAPTERS: Record<SupportedLanguage, LspAdapter> = {
    cpp: clangdAdapter,
    csharp: csharpAdapter,
    go: goplsAdapter,
    rust: rustAnalyzerAdapter,
    typescript: typescriptAdapter,
};

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = ['cpp', 'csharp', 'go', 'rust', 'typescript'];

export function adapterFor(language: SupportedLanguage): LspAdapter {
    return ADAPTERS[language];
}

export { findSolutionCandidates, isProjectRelative } from './csharp.js';
export { relativeOrName } from './clangd.js';
export type {
    DetectionResult,
    DetectionSource,
    HealthCheck,
    HealthLevel,
    LspAdapter,
    WorkspaceInfo,
} from './types.js';
