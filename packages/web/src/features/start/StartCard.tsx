import type { JSX } from 'react';

import type { Bootstrap, LanguageDiagnostics } from '../../api/http.js';
import { describeLspStatus } from '../diagnostics/LspStatus.js';

/**
 * 시작하기 카드 (U19).
 *
 * 파일을 열기 전 코드 화면 자리에 보인다. 예전에는 빈 화면 한 줄이었고,
 * "이 프로젝트가 되는지" 를 알려면 진단 탭을 찾아 들어가야 했다.
 *
 * 보여주는 것 셋 — 준비 상태(언어별 파일 수와 서버 상태), 시작하는 방법,
 * 그리고 바로 갈 곳(변경 파일·최근 연 파일).
 */

/** 언어 ID → 사람이 읽는 이름. 심볼 해석을 지원하지 않는 것도 센다. */
const LANGUAGE_LABEL: Record<string, string> = {
    c: 'C', cpp: 'C/C++', csharp: 'C#', go: 'Go', rust: 'Rust',
    typescript: 'TypeScript', typescriptreact: 'TypeScript', javascript: 'JavaScript',
    javascriptreact: 'JavaScript', python: 'Python', json: 'JSON', markdown: 'Markdown',
};

/** 우리가 심볼 해석을 지원하는 언어. `LspManager` 의 판정과 같아야 한다. */
const SUPPORTED: Record<string, 'cpp' | 'csharp' | 'go' | 'rust' | 'typescript'> = {
    c: 'cpp', cpp: 'cpp', csharp: 'csharp', go: 'go', rust: 'rust',
    typescript: 'typescript', typescriptreact: 'typescript',
    javascript: 'typescript', javascriptreact: 'typescript',
};

export interface StartCardProps {
    bootstrap: Bootstrap | null;
    diagnostics: LanguageDiagnostics[];
    changedFiles: Array<{ relPath: string; status: string }>;
    recentFiles: string[];
    onOpenFile: (relPath: string) => void;
    onOpenDiagnostics: (language: string | null) => void;
}

export function StartCard(props: StartCardProps): JSX.Element {
    const summary = props.bootstrap?.languageSummary?.languages ?? [];
    // 같은 언어 서버가 맡는 것끼리 묶는다. `.ts` 와 `.tsx` 는 한 줄이면 된다.
    const grouped = new Map<string, { label: string; count: number; supported: string | null }>();
    for (const entry of summary) {
        const supported = SUPPORTED[entry.languageId] ?? null;
        const key = supported ?? entry.languageId;
        const label = LANGUAGE_LABEL[key] ?? LANGUAGE_LABEL[entry.languageId] ?? entry.languageId;
        const existing = grouped.get(key);
        grouped.set(key, {
            label,
            count: (existing?.count ?? 0) + entry.fileCount,
            supported,
        });
    }
    const rows = [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 6);
    const anySupported = rows.some((row) => row.supported !== null);
    const anyReady = props.diagnostics.some((info) => info.state === 'ready');

    return (
        <div className="start-card">
            <h2>{props.bootstrap?.project.name ?? '프로젝트'}</h2>

            <section className="start-languages">
                {rows.length === 0 ? (
                    <p className="muted">파일을 세는 중이다.</p>
                ) : (
                    <ul>
                        {rows.map((row) => {
                            const info = row.supported === null
                                ? undefined
                                : props.diagnostics.find((item) => item.language === row.supported);
                            const shown = row.supported === null
                                ? null
                                : describeLspStatus(info);
                            return (
                                <li key={row.label}>
                                    <span className="start-language">{row.label}</span>
                                    <span className="muted">{row.count}</span>
                                    {shown === null ? (
                                        <span className="lsp-status tone-idle">심볼 해석 없음</span>
                                    ) : (
                                        <button
                                            type="button"
                                            className={`lsp-status tone-${shown.tone}`}
                                            data-language={row.supported ?? ''}
                                            title={shown.title}
                                            onClick={() => props.onOpenDiagnostics(row.supported)}
                                        >
                                            {shown.label}
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {anySupported ? null : (
                    <p className="muted">
                        이 프로젝트의 파일 형식은 심볼 해석을 지원하지 않는다.
                        지원 언어: C/C++ · C# · Go · Rust · TypeScript.
                    </p>
                )}
            </section>

            <section className="start-how">
                <h3>시작하는 법</h3>
                <ol>
                    <li>왼쪽 파일 탐색기에서 파일을 연다.</li>
                    <li>
                        함수 위에 커서를 두고 <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd>
                        {' '}또는 문서 줄의 <b>▶ 트레일 시작</b>.
                    </li>
                    <li>본문의 식별자를 클릭하면 그 정의가 자식으로 쌓인다.</li>
                </ol>
            </section>

            {props.changedFiles.length === 0 ? null : (
                <section className="start-links">
                    <h3>바뀐 파일</h3>
                    <ul>
                        {props.changedFiles.slice(0, 5).map((change) => (
                            <li key={`${change.status}:${change.relPath}`}>
                                <button type="button" onClick={() => props.onOpenFile(change.relPath)}>
                                    <span className="muted">{change.status}</span>
                                    <code>{change.relPath}</code>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {props.recentFiles.length === 0 ? null : (
                <section className="start-links">
                    <h3>최근 연 파일</h3>
                    <ul>
                        {props.recentFiles.slice(0, 5).map((relPath) => (
                            <li key={relPath}>
                                <button type="button" onClick={() => props.onOpenFile(relPath)}>
                                    <code>{relPath}</code>
                                </button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {anyReady ? null : (
                <p className="muted start-example">
                    언어 서버 없이 흐름만 보려면{' '}
                    <code>code-trail --read-share examples/first-review.ctshare.json</code>
                </p>
            )}
        </div>
    );
}
