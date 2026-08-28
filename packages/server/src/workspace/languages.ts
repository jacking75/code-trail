/**
 * 확장자 → 언어 ID.
 *
 * 이건 **표시용 추정**이다. 하이라이팅과 Markdown 코드 펜스에만 쓴다.
 * 최종 `languageId` 는 언어 서버 어댑터가 정한다(구현서 10.1) — 여기서 틀려도
 * 심볼 해석에는 영향이 없다.
 */
const BY_EXTENSION: Record<string, string> = {
    '.c': 'c',
    '.h': 'cpp',
    '.hh': 'cpp',
    '.hpp': 'cpp',
    '.hxx': 'cpp',
    '.inl': 'cpp',
    '.cc': 'cpp',
    '.cpp': 'cpp',
    '.cxx': 'cpp',
    '.ipp': 'cpp',
    '.cs': 'csharp',
    '.go': 'go',
    '.rs': 'rust',
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.json': 'json',
    '.md': 'markdown',
    '.toml': 'toml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.css': 'css',
    '.html': 'html',
    '.sh': 'shellscript',
    '.sql': 'sql',
    '.xml': 'xml',
};

/** 이름 전체로 판정하는 것들. 확장자가 없다. */
const BY_NAME: Record<string, string> = {
    Makefile: 'makefile',
    Dockerfile: 'dockerfile',
    'CMakeLists.txt': 'cmake',
};

export function languageIdFor(fileName: string): string | null {
    if (BY_NAME[fileName]) {
        return BY_NAME[fileName];
    }
    const dot = fileName.lastIndexOf('.');
    if (dot <= 0) {
        return null;
    }
    return BY_EXTENSION[fileName.slice(dot).toLowerCase()] ?? null;
}

/** Code Trail 이 심볼 해석을 지원하는 언어. */
export type SupportedLanguage = 'cpp' | 'csharp' | 'go' | 'rust';

export function supportedLanguageFor(languageId: string): SupportedLanguage | null {
    switch (languageId) {
        case 'c':
        case 'cpp':
            return 'cpp';
        case 'csharp':
            return 'csharp';
        case 'go':
            return 'go';
        case 'rust':
            return 'rust';
        default:
            return null;
    }
}
