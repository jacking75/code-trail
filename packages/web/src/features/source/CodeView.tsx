import { useEffect, useRef, type JSX } from 'react';
import { monaco } from './monaco.js';

import type { DocumentContent } from '../../api/http.js';

/**
 * 읽기 전용 코드 화면 (구현서 10.2).
 *
 * 지키는 것 넷.
 *
 * - `readOnly` 와 `domReadOnly` 를 모두 켠다. 하나만 켜면 IME 입력이나
 *   붙여넣기로 모델이 바뀔 수 있다.
 * - 서버가 준 문자열을 **그대로** 모델에 넣는다. 줄바꿈을 변환하지 않는다.
 * - 탭 크기는 보여주는 방식일 뿐이다. 원본 텍스트와 컬럼 좌표를 바꾸지 않는다.
 * - Monaco 위치는 1-based 다. 서버로 보낼 때 줄과 컬럼에서 각각 1 을 뺀다.
 */

export interface CodeViewProps {
    document: DocumentContent | null;
    /** 코드에서 무언가를 눌렀을 때. 좌표는 이미 0-based 로 바꿔서 준다. */
    onPositionClick?: (position: { line: number; char: number; word: string }) => void;
}

/** Monaco 의 1-based 위치를 우리가 쓰는 0-based 로 바꾼다. */
export function toZeroBased(position: monaco.IPosition): { line: number; char: number } {
    return { line: position.lineNumber - 1, char: position.column - 1 };
}

export function CodeView({ document: doc, onPositionClick }: CodeViewProps): JSX.Element {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const clickRef = useRef(onPositionClick);
    clickRef.current = onPositionClick;

    useEffect(() => {
        const host = hostRef.current;
        if (host === null) {
            return undefined;
        }

        const editor = monaco.editor.create(host, {
            value: '',
            language: 'plaintext',
            readOnly: true,
            domReadOnly: true,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            // 원본을 그대로 보여준다. 자동 들여쓰기 감지가 켜져 있으면 화면의
            // 탭 폭이 파일마다 달라져 같은 코드가 다르게 보인다.
            detectIndentation: false,
            tabSize: 4,
            fontLigatures: false,
            theme: 'vs-dark',
        });
        editorRef.current = editor;

        const listener = editor.onMouseUp((event) => {
            const position = event.target.position;
            if (position === null || position === undefined) {
                return;
            }
            const model = editor.getModel();
            const word = model?.getWordAtPosition(position)?.word ?? '';
            const { line, char } = toZeroBased(position);
            clickRef.current?.({ line, char, word });
        });

        return () => {
            listener.dispose();
            editor.getModel()?.dispose();
            editor.dispose();
            editorRef.current = null;
        };
    }, []);

    useEffect(() => {
        const editor = editorRef.current;
        if (editor === null) {
            return;
        }
        const previous = editor.getModel();
        if (doc === null) {
            editor.setModel(null);
            previous?.dispose();
            return;
        }
        // 새 모델을 만든다. `setValue` 로 덮으면 실행 취소 이력에 남고,
        // 언어도 함께 바꿀 수 없다.
        const model = monaco.editor.createModel(doc.text, monacoLanguage(doc.languageId));
        editor.setModel(model);
        previous?.dispose();
    }, [doc]);

    return <div className="code-view" ref={hostRef} />;
}

/**
 * 우리 `languageId` 를 Monaco 가 아는 이름으로 바꾼다.
 * 모르는 언어는 `plaintext` 로 둔다 — 하이라이팅만 없고 코드는 그대로 보인다.
 */
function monacoLanguage(languageId: string): string {
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
        case 'typescriptreact':
            return 'typescript';
        case 'javascriptreact':
            return 'javascript';
        case 'shellscript':
            return 'shell';
        default:
            return monaco.languages.getLanguages().some((l) => l.id === languageId)
                ? languageId
                : 'plaintext';
    }
}
