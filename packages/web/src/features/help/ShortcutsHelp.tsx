import { useEffect, useRef, type JSX } from 'react';

/**
 * 단축키 도움말 (U16).
 *
 * `?` 로 띄우는 표 한 장이다. 키보드만으로 다닐 수 있게 만들어 놓고 그 키를
 * 어디에도 적지 않으면 없는 기능과 같다.
 */

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
        title: '어디서나',
        rows: [
            ['Ctrl+Alt+T', '커서가 있는 함수부터 트레일 시작'],
            ['Ctrl+P', '파일 이름 검색'],
            ['Alt+← / Alt+→', '읽던 위치 앞뒤로'],
            ['Ctrl+Alt+1…5', '탭 — 코드·트레일·분석 기록·설정·진단'],
            ['Ctrl+Alt+B', '파일 탐색기 접기·펴기'],
            ['Ctrl+Alt+N', '기록 열 열기·닫기'],
            ['Ctrl+Alt+\\', '분할 보기 (넓은 화면에서만)'],
            ['[ / ]', '안내 순서 따라 읽기 — 이전·다음 단계'],
            ['?', '이 도움말'],
            ['Esc', '알림·팝오버·선택 칩·따라 읽기 닫기'],
        ],
    },
    {
        title: '트레일 패널',
        rows: [
            ['↑ / ↓', '보이는 순서로 노드 이동'],
            ['→', '접혀 있으면 펼치기, 아니면 첫 자식'],
            ['←', '펼쳐 있으면 접기, 아니면 부모'],
            ['Enter / Space', '접기·펼치기'],
            ['Home / End', '첫 노드 / 마지막 노드'],
            ['Tab', '본문의 클릭 후보로 들어가기'],
            ['Delete', '노드 삭제 (8초 안에 되돌리기)'],
            ['f', '구현 보기 ⚑'],
            ['o', '외부 에디터에서 열기'],
            ['p', '부모 호출부로 (진입 링크)'],
            ['r', '새 루트로 떼어내기 ⇱'],
            ['n', '이 노드에 기록 남기기'],
            ['v', '확인함 표시 — 다시 누르면 되돌린다'],
            ['g', '코드 화면에서 이 위치 열기'],
            ['m / Shift+F10', '노드 메뉴'],
            ['/', '필터로 포커스 (Enter 로 다음 매치)'],
        ],
    },
    {
        title: '본문 · 코드 화면',
        rows: [
            ['클릭', '그 식별자의 정의를 자식으로'],
            ['Alt+클릭', '구현 먼저 찾기'],
            ['Ctrl+클릭', '외부 에디터에서 그 자리 열기'],
            ['Ctrl+휠', '이 노드의 코드 글자 크기만'],
            ['드래그', '선택 칩 — ＋ 기록 · AI 초안 · 복사'],
            ['Alt+↑ / Alt+↓', '이전 변경 / 다음 변경'],
        ],
    },
];

export interface ShortcutsHelpProps {
    onClose: () => void;
}

export function ShortcutsHelp(props: ShortcutsHelpProps): JSX.Element {
    const closeRef = useRef<HTMLButtonElement | null>(null);
    const { onClose } = props;

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="shortcuts-backdrop" onClick={onClose} role="presentation">
            <div
                className="shortcuts"
                role="dialog"
                aria-label="단축키"
                onClick={(event) => event.stopPropagation()}
            >
                <header>
                    <h2>단축키</h2>
                    <button type="button" ref={closeRef} onClick={onClose} aria-label="닫기">×</button>
                </header>
                <div className="shortcuts-groups">
                    {GROUPS.map((group) => (
                        <section key={group.title}>
                            <h3>{group.title}</h3>
                            <table>
                                <tbody>
                                    {group.rows.map(([keys, what]) => (
                                        <tr key={keys}>
                                            <th scope="row"><kbd>{keys}</kbd></th>
                                            <td>{what}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </section>
                    ))}
                </div>
            </div>
        </div>
    );
}
