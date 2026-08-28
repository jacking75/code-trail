import { useCallback, useEffect, useState, type JSX } from 'react';

import {
    api,
    type EditorDiagnostics,
    type LanguageDiagnostics,
    type ProjectSettingsView,
    type SolutionDiagnostics,
} from '../../api/http.js';

/**
 * 진단 화면 (구현서 18).
 *
 * 언어 서버가 왜 안 도는지 여기서만 알 수 있어야 한다. 그래서 상태 한 줄이
 * 아니라 근거를 전부 편다 — 실행 파일, 버전 명령 결과, PID, 초기화 시간,
 * 광고된 capability, 마지막 성공 요청, 마지막 종료, 프로젝트 인식 정보.
 *
 * **`지원됨` 은 프로세스가 떴다는 뜻이 아니다.** 실제 샘플 문서에서
 * `documentSymbol` 과 `definition` 이 응답했다는 뜻이고, 그 확인은 사용자가
 * `확인` 을 눌러야 돈다. 우리가 마음대로 언어 서버를 띄우지 않는다.
 *
 * 로그는 기본으로 펼치지 않는다. 코드 본문이 섞여 들어올 수 있어서다(구현서 11.6).
 */

const STATE_LABEL: Record<LanguageDiagnostics['state'], string> = {
    notStarted: '안 뜸',
    starting: '뜨는 중',
    ready: '실행 중',
    failed: '실패',
    stopped: '멈춤',
};

const SOURCE_LABEL: Record<string, string> = {
    settings: '설정',
    path: 'PATH',
    platform: '설치 위치',
    goBin: 'GOBIN',
    goPath: 'GOPATH/bin',
    rustup: 'rustup',
    notFound: '못 찾음',
};

export interface DiagnosticsViewProps {
    languages: LanguageDiagnostics[];
    settings: ProjectSettingsView | null;
    recoveryCandidates: unknown[];
    onRefresh: () => void;
    onRestart: (language: string) => void;
    onVerify: (language: string) => void;
    /** 설정 저장. 서버가 파일에 쓰고 `settings.changed` 로 되돌려준다. */
    onUpdateSettings: (settings: ProjectSettingsView) => void;
}

/** 한 줄 항목. 이름과 값을 나란히 둔다. */
function Row(props: { label: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="diag-row">
            <span className="diag-label">{props.label}</span>
            <span className="diag-value">{props.children}</span>
        </div>
    );
}

function capabilityList(info: LanguageDiagnostics): string {
    const names: Array<[string, boolean]> = [
        ['definition', info.capabilities.definition],
        ['documentSymbol', info.capabilities.documentSymbol],
        ['implementation', info.capabilities.implementation],
        ['typeDefinition', info.capabilities.typeDefinition],
    ];
    const on = names.filter(([, has]) => has).map(([name]) => name);
    return on.length === 0 ? '아직 없다' : on.join(', ');
}

export function DiagnosticsView(props: DiagnosticsViewProps): JSX.Element {
    const [logs, setLogs] = useState<Record<string, string[]>>({});
    const [editor, setEditor] = useState<EditorDiagnostics | null>(null);
    const [solutions, setSolutions] = useState<SolutionDiagnostics | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        void api.editorDiagnostics().then(setEditor).catch(() => undefined);
        void api.solutions().then(setSolutions).catch(() => undefined);
    }, [props.languages]);

    const showLog = useCallback((language: string) => {
        void api
            .lspLog(language)
            .then((data) => setLogs((prev) => ({ ...prev, [language]: data.lines })))
            .catch(() => setNotice('로그를 읽지 못했다.'));
    }, []);

    /**
     * 로그를 파일로 내려받는다.
     *
     * 서버가 이미 정제해 준 줄만 담는다. 환경 변수와 토큰은 서버가 로그에
     * 넣지 않으므로 여기서 다시 거를 것이 없다.
     */
    const downloadLog = useCallback((language: string) => {
        void api.lspLog(language).then((data) => {
            const blob = new Blob([data.lines.join('\n')], { type: 'text/plain' });
            const href = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = href;
            link.download = `code-trail-${language}.log`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(href);
        }).catch(() => setNotice('로그를 내려받지 못했다.'));
    }, []);

    const pickEditor = useCallback((executable: string, args: string[]) => {
        if (props.settings === null) {
            return;
        }
        props.onUpdateSettings({
            ...props.settings,
            editor: { executable, args },
        });
        setNotice(`${executable} 를 외부 에디터로 정했다.`);
    }, [props]);

    const pickSolution = useCallback((solutionPath: string | null) => {
        if (props.settings === null) {
            return;
        }
        const { languages } = props.settings;
        props.onUpdateSettings({
            ...props.settings,
            languages: {
                ...languages,
                csharp: { ...languages.csharp, solutionPath },
            },
        });
        setNotice(solutionPath === null ? '솔루션 선택을 지웠다.' : `${solutionPath} 를 골랐다.`);
    }, [props]);

    return (
        <div className="diagnostics" id="diagnostics">
            <div className="toolbar">
                <button type="button" onClick={props.onRefresh}>↻ 다시 읽기</button>
                <span className="spacer" />
                <span className="muted">
                    `지원됨` 은 실제 샘플 요청이 응답했다는 뜻이다.
                </span>
            </div>

            {notice === null ? null : (
                <button type="button" className="diag-notice" onClick={() => setNotice(null)}>
                    {notice}
                </button>
            )}

            {props.languages.map((info) => (
                <section className="diag-card" key={info.language} data-language={info.language}>
                    <h2>
                        <span className="diag-name">{info.displayName}</span>
                        <span className={`diag-state s-${info.state}`}>
                            {STATE_LABEL[info.state]}
                        </span>
                        {info.verified ? (
                            <span className="badge ok" title="샘플 문서에서 documentSymbol 과 definition 이 응답했다">
                                지원됨
                            </span>
                        ) : (
                            <span className="badge decl" title="아직 실제 요청으로 확인하지 않았다">
                                확인 전
                            </span>
                        )}
                        {info.enabled ? null : <span className="badge decl">꺼짐</span>}
                        <span className="spacer" />
                        <button type="button" onClick={() => props.onVerify(info.language)}>
                            ✓ 확인
                        </button>
                        <button type="button" onClick={() => props.onRestart(info.language)}>
                            ↻ 다시 시작
                        </button>
                    </h2>

                    <Row label="실행 파일">
                        {info.executableName ?? '못 찾음'}
                        <span className="muted">
                            {` (${SOURCE_LABEL[info.detectionSource] ?? info.detectionSource})`}
                        </span>
                    </Row>
                    <Row label="프로세스">
                        {info.pid === null ? '안 떠 있다' : `PID ${info.pid}`}
                    </Row>
                    <Row label="초기화">
                        {info.initializeMs === null ? '아직' : `${info.initializeMs}ms`}
                    </Row>
                    <Row label="광고한 capability">{capabilityList(info)}</Row>
                    {info.missingCapabilities.length === 0 ? null : (
                        <Row label="없는 capability">
                            <span className="warn">{info.missingCapabilities.join(', ')}</span>
                        </Row>
                    )}
                    <Row label="마지막 성공 요청">
                        {info.lastRequest === null
                            ? '없다'
                            : `${info.lastRequest.method} — ${info.lastRequest.durationMs}ms `
                                + `(${info.lastRequest.at})`}
                    </Row>
                    <Row label="다시 띄운 횟수">{String(info.restartCount)}</Row>
                    {info.lastExit === null ? null : (
                        <Row label="마지막 종료">
                            <span className="warn">
                                {`코드 ${info.lastExit.code ?? '없음'}`}
                                {info.lastExit.signal === null ? '' : ` (${info.lastExit.signal})`}
                                {` — ${info.lastExit.at}`}
                            </span>
                        </Row>
                    )}
                    {info.lastError === null ? null : (
                        <Row label="마지막 오류">
                            <span className="warn">{info.lastError}</span>
                        </Row>
                    )}

                    <div className="diag-checks">
                        {info.healthChecks.map((check) => (
                            <div className={`diag-check l-${check.level}`} key={check.label}>
                                <span className="diag-check-label">{check.label}</span>
                                <span className="diag-check-detail">{check.detail}</span>
                            </div>
                        ))}
                    </div>

                    <div className="diag-actions">
                        <button type="button" onClick={() => showLog(info.language)}>
                            로그 보기
                        </button>
                        <button type="button" onClick={() => downloadLog(info.language)}>
                            로그 내려받기
                        </button>
                    </div>

                    {logs[info.language] === undefined ? null : (
                        <pre className="diag-log">
                            {logs[info.language].length === 0
                                ? '(남은 로그가 없다)'
                                : logs[info.language].join('\n')}
                        </pre>
                    )}

                    {info.language === 'csharp' && solutions !== null ? (
                        <div className="diag-solutions">
                            <h3>솔루션</h3>
                            {solutions.candidates.length === 0 ? (
                                <p className="muted">.sln 도 .csproj 도 찾지 못했다.</p>
                            ) : (
                                <ul>
                                    {solutions.candidates.map((candidate) => (
                                        <li key={candidate}>
                                            <button
                                                type="button"
                                                className={solutions.selected === candidate
                                                    ? 'picked' : ''}
                                                onClick={() => pickSolution(candidate)}
                                            >
                                                {candidate}
                                            </button>
                                            {solutions.suggested === candidate ? (
                                                <span className="muted"> 추천</span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {solutions.selected === null ? null : (
                                <button type="button" onClick={() => pickSolution(null)}>
                                    선택 지우기
                                </button>
                            )}
                        </div>
                    ) : null}
                </section>
            ))}

            <section className="diag-card" id="diag-editor">
                <h2>
                    <span className="diag-name">외부 에디터</span>
                    {editor?.configured === null || editor === null ? (
                        <span className="badge decl">설정 없음</span>
                    ) : (
                        <span className="badge ok">{editor.configured}</span>
                    )}
                </h2>
                <p className="muted">
                    후보를 찾아 보여줄 뿐이다. 여기서 고르기 전에는 아무것도 실행하지 않는다.
                    인자에는 <code>{'{path}'}</code>, <code>{'{line}'}</code>,
                    {' '}<code>{'{column}'}</code>, <code>{'{project}'}</code> 만 쓸 수 있다.
                </p>
                {editor === null || editor.candidates.length === 0 ? (
                    <p className="muted">PATH 에서 알려진 에디터 CLI 를 찾지 못했다.</p>
                ) : (
                    <ul className="diag-editors">
                        {editor.candidates.map((candidate) => (
                            <li key={candidate.executable}>
                                <button
                                    type="button"
                                    className={editor.configured === candidate.executable
                                        ? 'picked' : ''}
                                    onClick={() => pickEditor(candidate.executable, candidate.args)}
                                >
                                    {candidate.displayName}
                                </button>
                                <code>{`${candidate.executable} ${candidate.args.join(' ')}`}</code>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {props.recoveryCandidates.length === 0 ? null : (
                <section className="diag-card">
                    <h2><span className="diag-name">복구 후보</span></h2>
                    <p className="muted">
                        저장 중 강제 종료된 흔적이다. 다음 저장 때 정리된다.
                    </p>
                    <pre className="diag-log">
                        {JSON.stringify(props.recoveryCandidates, null, 2)}
                    </pre>
                </section>
            )}
        </div>
    );
}
