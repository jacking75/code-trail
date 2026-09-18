import type { JSX } from 'react';

import type { LanguageDiagnostics } from '../../api/http.js';

/**
 * 서버 상태 표시 (U01).
 *
 * 앱 바와 코드 화면 문서 줄에 붙는, 지금 문서 언어의 언어 서버 상태다.
 * 정의를 못 찾았을 때 "언어 서버 때문인지, 뜨는 중인지, 이 파일 형식은 원래
 * 안 되는지" 를 화면에서 바로 알 수 있어야 한다.
 *
 * **여기서 언어 서버를 띄우지 않는다.** `App` 이 이미 들고 있는 진단 배열에서
 * 고르기만 한다 — 상태를 보여주는 일이 서버 기동을 부르면 안 된다.
 */

export interface LspStatusProps {
    /** 지금 문서의 언어. `null` 이면 심볼 해석을 지원하지 않는 파일이다. */
    language: 'cpp' | 'csharp' | 'go' | 'rust' | 'typescript' | null;
    diagnostics: LanguageDiagnostics[];
    /** 눌렀을 때. 진단 화면의 그 언어 카드로 데려간다. */
    onOpen: (language: string | null) => void;
}

interface Shown {
    label: string;
    tone: 'idle' | 'starting' | 'partial' | 'ok' | 'bad';
    title: string;
}

export function describeLspStatus(info: LanguageDiagnostics | undefined): Shown {
    if (info === undefined) {
        return { label: '상태 모름', tone: 'idle', title: '진단 화면에서 다시 읽는다.' };
    }
    if (!info.enabled) {
        return {
            label: '꺼짐',
            tone: 'idle',
            title: `${info.displayName} 가 설정에서 꺼져 있다.`,
        };
    }
    switch (info.state) {
        case 'starting':
            return {
                label: '뜨는 중',
                tone: 'starting',
                title: '큰 프로젝트는 첫 요청까지 수십 초 걸린다.',
            };
        case 'failed':
            return {
                label: '실패',
                tone: 'bad',
                title: info.lastError ?? '언어 서버가 멎었다. 진단 화면에서 이유를 본다.',
            };
        case 'ready':
            return info.verified
                ? {
                    label: '지원됨',
                    tone: 'ok',
                    title: '샘플 문서에서 documentSymbol 과 definition 이 응답했다.',
                }
                : {
                    label: '실행 중 · 확인 전',
                    tone: 'partial',
                    title: '떠 있지만 아직 실제 요청으로 확인하지 않았다. 진단 화면에서 ✓ 확인.',
                };
        case 'stopped':
            return { label: '멈춤', tone: 'idle', title: '아직 이 언어의 파일을 열지 않았다.' };
        default:
            return { label: '안 뜸', tone: 'idle', title: '아직 이 언어의 파일을 열지 않았다.' };
    }
}

export function LspStatus(props: LspStatusProps): JSX.Element | null {
    if (props.language === null) {
        return (
            <button
                type="button"
                className="lsp-status tone-idle"
                data-language=""
                title="이 파일 형식은 심볼 해석을 지원하지 않는다. 지원 언어: C/C++·C#·Go·Rust·TypeScript."
                onClick={() => props.onOpen(null)}
            >
                심볼 해석 없음
            </button>
        );
    }
    const info = props.diagnostics.find((item) => item.language === props.language);
    // 진단을 아직 못 읽었다. "상태 모름" 은 그 언어가 목록에 없다는 뜻이라
    // 읽는 중과 구분한다 — 다섯 언어의 탐지가 끝나야 첫 응답이 온다.
    const shown = props.diagnostics.length === 0 && info === undefined
        ? { label: '확인 중', tone: 'starting' as const, title: '언어 서버 상태를 읽는 중이다.' }
        : describeLspStatus(info);
    return (
        <button
            type="button"
            className={`lsp-status tone-${shown.tone}`}
            data-language={props.language}
            title={shown.title}
            onClick={() => props.onOpen(props.language)}
        >
            {`${info?.displayName ?? props.language} · ${shown.label}`}
        </button>
    );
}
