import { useEffect, useImperativeHandle, useRef, type JSX, type Ref } from 'react';
import { monaco } from './monaco.js';

import type { DocumentContent, GitHunkView } from '../../api/http.js';

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
 *
 * **변경 보기**(U14)는 같은 자리에 좌우 비교 편집기를 만든다. 오른쪽(수정본)이
 * 현재 문서이고, `Ctrl+Alt+T` 와 우클릭 시작은 그쪽 커서를 쓴다.
 */

export interface CodeViewHandle {
    /** 그 줄로 커서를 옮기고 화면 가운데로. 1-based 가 아니라 0-based 다. */
    revealLine: (line: number, char?: number) => void;
    /** 지금 커서. 좌표는 0-based. */
    cursor: () => { line: number; char: number };
}

export interface CodeViewProps {
    document: DocumentContent | null;
    /** 코드에서 무언가를 눌렀을 때. 좌표는 이미 0-based 로 바꿔서 준다. */
    onPositionClick?: (position: { line: number; char: number; word: string }) => void;
    onSelectionChange?: (
        range: {
            start: { line: number; char: number };
            end: { line: number; char: number };
        } | null,
        /** 선택 끝의 뷰포트 좌표. 선택 칩을 여기 띄운다. */
        anchor: { x: number; y: number } | null,
    ) => void;
    annotationRanges?: Array<{
        start: { line: number; char: number };
        end: { line: number; char: number };
    }>;
    /** 바뀐 줄 덩어리. 왼쪽 여백에 색 띠를 그린다. */
    hunks?: GitHunkView[];
    /** `HEAD` 쪽 본문. 있으면 변경 보기를 켤 수 있다. */
    originalText?: string | null;
    diff?: boolean;
    /** `vs` 또는 `vs-dark`. 앱 테마를 따라간다. */
    theme?: string;
    /** 우클릭 메뉴와 Monaco 안의 `Ctrl+Alt+T`. */
    onAddRoot?: (position: { line: number; char: number }) => void;
    handle?: Ref<CodeViewHandle>;
}

/** Monaco 의 1-based 위치를 우리가 쓰는 0-based 로 바꾼다. */
export function toZeroBased(position: monaco.IPosition): { line: number; char: number } {
    return { line: position.lineNumber - 1, char: position.column - 1 };
}

export function CodeView(props: CodeViewProps): JSX.Element {
    const {
        document: doc, onPositionClick, onSelectionChange, annotationRanges = [],
        hunks = [], originalText = null, diff = false, theme = 'vs-dark',
    } = props;
    const hostRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
    const diffRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
    const modelRef = useRef<monaco.editor.ITextModel | null>(null);
    const originalModelRef = useRef<monaco.editor.ITextModel | null>(null);
    const clickRef = useRef(onPositionClick);
    clickRef.current = onPositionClick;
    const selectionRef = useRef(onSelectionChange);
    selectionRef.current = onSelectionChange;
    const addRootRef = useRef(props.onAddRoot);
    addRootRef.current = props.onAddRoot;
    const decorationIds = useRef<string[]>([]);

    /** 지금 커서를 읽을 수 있는 편집기. 변경 보기에서는 수정본 쪽이다. */
    const activeEditor = (): monaco.editor.IStandaloneCodeEditor | null =>
        (diffRef.current?.getModifiedEditor() as monaco.editor.IStandaloneCodeEditor | null)
        ?? editorRef.current;

    useImperativeHandle(props.handle, () => ({
        revealLine: (line, char = 0) => {
            const editor = activeEditor();
            if (editor === null) return;
            const position = { lineNumber: line + 1, column: char + 1 };
            editor.setPosition(position);
            editor.revealLineInCenter(position.lineNumber);
            editor.focus();
        },
        cursor: () => {
            const position = activeEditor()?.getPosition();
            return position ? toZeroBased(position) : { line: 0, char: 0 };
        },
    }), []);

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
            theme,
        });
        editorRef.current = editor;

        // 우클릭 메뉴와 Monaco 안의 키. 바깥의 전역 keydown 은 코드 화면 밖에서
        // 누른 경우를 위해 그대로 둔다(U07).
        editor.addAction({
            id: 'code-trail.addRoot',
            label: '여기서 트레일 시작',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyT],
            contextMenuGroupId: 'navigation',
            contextMenuOrder: 1,
            run: (target) => {
                const position = target.getPosition();
                if (position) {
                    addRootRef.current?.(toZeroBased(position));
                }
            },
        });

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
        const selectionListener = editor.onDidChangeCursorSelection((event) => {
            const selection = event.selection;
            if (selection.isEmpty()) {
                selectionRef.current?.(null, null);
                return;
            }
            const start = toZeroBased(selection.getStartPosition());
            const end = toZeroBased(selection.getEndPosition());
            // 선택 끝의 화면 좌표. 선택 칩이 여기 아래에 뜬다(U04).
            const visible = editor.getScrolledVisiblePosition(selection.getEndPosition());
            const box = host.getBoundingClientRect();
            selectionRef.current?.(
                { start, end },
                visible === null
                    ? null
                    : {
                        x: box.left + visible.left,
                        y: box.top + visible.top + visible.height,
                    },
            );
        });

        return () => {
            listener.dispose();
            selectionListener.dispose();
            editor.dispose();
            editorRef.current = null;
        };
    }, []);

    // 테마는 전역이다. 편집기를 새로 만들지 않고 갈아끼운다(U15).
    useEffect(() => {
        monaco.editor.setTheme(theme);
    }, [theme]);

    useEffect(() => {
        const editor = editorRef.current;
        if (editor === null) {
            return;
        }
        const previous = modelRef.current;
        if (doc === null) {
            editor.setModel(null);
            modelRef.current = null;
            previous?.dispose();
            return;
        }
        // 새 모델을 만든다. `setValue` 로 덮으면 실행 취소 이력에 남고,
        // 언어도 함께 바꿀 수 없다.
        const model = monaco.editor.createModel(doc.text, monacoLanguage(doc.languageId));
        modelRef.current = model;
        if (diffRef.current === null) {
            editor.setModel(model);
        } else {
            diffRef.current.setModel({
                original: originalModelRef.current ?? monaco.editor.createModel('', model.getLanguageId()),
                modified: model,
            });
        }
        previous?.dispose();
    }, [doc]);

    /**
     * 변경 보기 (U14).
     *
     * 좌우 비교는 별도의 편집기라 같은 호스트에 겹쳐 만들 수 없다. 켜고 끌 때
     * 한쪽을 지우고 다른 쪽을 만들되, **모델은 재사용한다** — 다시 만들면
     * 스크롤 위치와 접힘이 모두 초기화된다.
     */
    useEffect(() => {
        const host = hostRef.current;
        const model = modelRef.current;
        if (host === null) {
            return;
        }
        if (!diff || originalText === null || model === null) {
            if (diffRef.current !== null) {
                diffRef.current.setModel(null);
                diffRef.current.dispose();
                diffRef.current = null;
                originalModelRef.current?.dispose();
                originalModelRef.current = null;
                editorRef.current?.setModel(model);
                editorRef.current?.layout();
            }
            return;
        }
        if (diffRef.current !== null) {
            originalModelRef.current?.setValue(originalText);
            return;
        }
        editorRef.current?.setModel(null);
        const original = monaco.editor.createModel(originalText, model.getLanguageId());
        originalModelRef.current = original;
        const created = monaco.editor.createDiffEditor(host, {
            readOnly: true,
            originalEditable: false,
            automaticLayout: true,
            renderSideBySide: host.clientWidth > 1100,
            minimap: { enabled: false },
            theme,
        });
        created.setModel({ original, modified: model });
        diffRef.current = created;
    }, [diff, originalText, doc, theme]);

    useEffect(() => {
        const editor = editorRef.current;
        if (!editor || diffRef.current !== null) return;
        decorationIds.current = editor.deltaDecorations(
            decorationIds.current,
            [
                ...annotationRanges.map((range) => ({
                    range: new monaco.Range(
                        range.start.line + 1, range.start.char + 1,
                        range.end.line + 1, range.end.char + 1,
                    ),
                    options: {
                        inlineClassName: 'analysis-range',
                        hoverMessage: { value: '분석 기록 위치' },
                    },
                })),
                // 바뀐 줄. 왼쪽 여백에만 색 띠를 둔다 — 본문 색을 건드리면
                // 토큰 색과 섞여 코드가 안 읽힌다.
                ...hunks.filter((hunk) => hunk.newCount > 0).map((hunk) => ({
                    range: new monaco.Range(
                        hunk.newStart, 1,
                        hunk.newStart + Math.max(0, hunk.newCount - 1), 1,
                    ),
                    options: {
                        isWholeLine: true,
                        linesDecorationsClassName: hunk.oldCount === 0
                            ? 'changed-line added'
                            : 'changed-line modified',
                    },
                })),
                // 지워지기만 한 자리. 줄이 없으므로 그 앞줄에 표식을 둔다.
                ...hunks.filter((hunk) => hunk.newCount === 0).map((hunk) => ({
                    range: new monaco.Range(
                        Math.max(1, hunk.newStart), 1, Math.max(1, hunk.newStart), 1,
                    ),
                    options: {
                        isWholeLine: true,
                        linesDecorationsClassName: 'changed-line deleted',
                    },
                })),
            ],
        );
    }, [annotationRanges, hunks, doc, diff]);

    return <div className={diff ? 'code-view diff' : 'code-view'} ref={hostRef} />;
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
