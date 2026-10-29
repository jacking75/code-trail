# Code Trail 기능·UX 추가 개선 계획

작성 기준: 2026-09-18 20:05 KST, 커밋 `8f6685c`(버전 1.4.0). 저장소의 실제 코드와 문서만 근거로 삼았다.
실제 언어 서버(clangd·gopls·rust-analyzer·roslyn·typescript-language-server)가 이 기계에 없어
언어 서버 응답 자체의 정확도는 평가하지 않았다. 그것은 [`code-understanding-and-sharing-plan.md`](code-understanding-and-sharing-plan.md)
의 T02·T23·T37 이 그대로 맡는다.

[`review-ux-improvement-plan.md`](review-ux-improvement-plan.md) 의 U01~U20 이 끝난 뒤의 구현을
"코드 리뷰와 분석을 목적으로 하는 도구" 로 다시 훑어, **아직 부족한 것**과 **무엇을 어떻게 만들지**를
태스크 단위로 적는다. 사용 편의성(UX)을 첫째 기준으로 삼았고, 새 LSP 요청은 하나도 추가하지 않는다.

## 0. 태스크 목록

한 태스크를 끝낼 때마다 즉시 그 줄을 `- [x]` 로 바꾸고 완료 일시(KST, 시스템 명령으로 확인)를
덧붙인다. 여러 개를 몰아서 체크하지 않는다. 각 항목은 본문의 상세 절로 링크한다.

**V01~V23 이 모두 끝났다(1.7.0).** 남은 것은 5장의 종단 간 인수 시나리오를 실제 언어
서버가 있는 기계에서 손으로 확인하는 일과, 6장에서 저장소 주인이 정할 것들이다.

### A. 변경에서 시작하는 리뷰 동선

- [x] [V01. 변경 기준을 골라 작업 트리 외의 변경도 리뷰한다](#v01-변경-기준을-골라-작업-트리-외의-변경도-리뷰한다) — P0 · 완료 2026-09-19 09:40 KST
- [x] [V02. 노드에 검토 표시를 붙인다](#v02-노드에-검토-표시를-붙인다) — P0 · 완료 2026-09-19 09:40 KST
- [x] [V03. 변경 목록의 hunk 에 검토 표시를 붙인다](#v03-변경-목록의-hunk-에-검토-표시를-붙인다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V04. 코드 화면 여백에 트레일 노드와 기록 표식을 그린다](#v04-코드-화면-여백에-트레일-노드와-기록-표식을-그린다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V05. 노드 헤더의 경로에서 코드 화면으로 간다](#v05-노드-헤더의-경로에서-코드-화면으로-간다) — P0 · 완료 2026-09-19 09:40 KST
- [x] [V06. 문서 심볼 클릭은 이동하고 루트 만들기는 따로 둔다](#v06-문서-심볼-클릭은-이동하고-루트-만들기는-따로-둔다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V07. 넓은 화면에서 코드 화면과 트레일 패널을 나란히 본다](#v07-넓은-화면에서-코드-화면과-트레일-패널을-나란히-본다) — P2 · 완료 2026-09-19 09:40 KST

### B. 트레일 패널 조작

- [x] [V08. 노드 메뉴를 만들고 Markdown 복사와 노드 링크를 넣는다](#v08-노드-메뉴를-만들고-markdown-복사와-노드-링크를-넣는다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V09. 트레일 필터를 본문과 기록까지 넓힌다](#v09-트레일-필터를-본문과-기록까지-넓힌다) — P2 · 완료 2026-09-19 09:40 KST
- [x] [V10. 새 루트로 떼어내기에 되돌리기를 붙인다](#v10-새-루트로-떼어내기에-되돌리기를-붙인다) — P2 · 완료 2026-09-19 09:40 KST
- [x] [V11. 보드 자동 배치 초기화를 넣는다](#v11-보드-자동-배치-초기화를-넣는다) — P2 · 완료 2026-09-19 09:40 KST
- [x] [V12. 접힌 노드에 하위 요약을 보여준다](#v12-접힌-노드에-하위-요약을-보여준다) — P2 · 완료 2026-09-19 09:40 KST

### C. 기록과 분석

- [x] [V13. 안내 순서를 단계별로 따라 읽는 재생 모드를 만든다](#v13-안내-순서를-단계별로-따라-읽는-재생-모드를-만든다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V14. 안내 순서의 단계를 추가하고 지우고 고친다](#v14-안내-순서의-단계를-추가하고-지우고-고친다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V15. 기록 목록에 필터와 정렬과 전체 검색을 넣는다](#v15-기록-목록에-필터와-정렬과-전체-검색을-넣는다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V16. 코드 화면에도 기록 열을 붙인다](#v16-코드-화면에도-기록-열을-붙인다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V17. 파일이 바뀌면 기록 위치를 자동으로 다시 확인한다](#v17-파일이-바뀌면-기록-위치를-자동으로-다시-확인한다) — P1 · 완료 2026-09-19 09:40 KST

### D. 앱 전반

- [x] [V18. 개인 화면 상태를 서버에 저장하고 마지막 상태를 복원한다](#v18-개인-화면-상태를-서버에-저장하고-마지막-상태를-복원한다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V19. 단축키를 보강하고 Alt 위아래 변경 이동을 실제로 붙인다](#v19-단축키를-보강하고-alt-위아래-변경-이동을-실제로-붙인다) — P0 · 완료 2026-09-19 09:40 KST
- [x] [V20. 탭 폭 설정을 추가해 두 화면의 표시를 맞춘다](#v20-탭-폭-설정을-추가해-두-화면의-표시를-맞춘다) — P1 · 완료 2026-09-19 09:40 KST
- [x] [V21. 파일 탐색기가 열린 파일을 펼치고 변경 상태를 보여준다](#v21-파일-탐색기가-열린-파일을-펼치고-변경-상태를-보여준다) — P2 · 완료 2026-09-19 09:40 KST
- [x] [V22. 트레일 목록을 관리하는 화면을 만든다](#v22-트레일-목록을-관리하는-화면을-만든다) — P2 · 완료 2026-09-19 09:40 KST
- [x] [V23. Markdown 과 정적 HTML 내보내기를 하나로 합친다](#v23-markdown-과-정적-html-내보내기를-하나로-합친다) — P2 · 완료 2026-09-19 09:40 KST

## 1. 현재 구현 평가

### 1.1 그대로 지킬 강점

- **정본이 서버에 있고 화면은 이벤트로만 바뀐다.** 이 문서의 어떤 태스크도 낙관적 갱신을 넣지 않는다.
- **심볼 해석은 LSP 네 요청뿐이다.** 이 문서는 `hover`·`references`·`callHierarchy`·`workspace/symbol` 을 추가하지 않는다.
  hover 는 [6장](#6-정해진-것)에서 여전히 "결정 보류" 로 둔다.
- **경계가 분명하다.** 새 API(V01 의 기준 목록, V18 의 개인 상태)도 토큰·Host·Origin 검사와 "절대경로·토큰을 밖으로 내보내지 않는다" 를 그대로 지난다.
- **U01~U20 이 만든 통로가 있다.** 알림(`useNotices`)·선택 칩·기록 열·후보 팝오버·되돌리기 버퍼·키보드 이동을 그대로 쓴다. 새 표시 통로를 만들지 않는다.
- **테스트 층이 갖춰져 있다.** 단위 163 · 통합 122 · E2E 넷 · pack · install. 각 태스크의 검증은 이 층에 한 줄씩 더하는 방식으로 적었다.

### 1.2 부족한 것 — 근거와 함께

| 간극 | 근거 (파일:줄) | 사용자에게 생기는 일 | 태스크 |
| --- | --- | --- | --- |
| 변경 목록이 작업 트리 변경만 본다. 서버는 두 커밋 사이 변경·hunk·원본을 줄 수 있는데 화면이 안 쓴다 | `App.tsx:213` `api.changes()` 인자 없음, `git/service.ts:246` `changesBetween`, `routes.ts:271` `from`·`to` 받음 | 브랜치 전체나 특정 커밋을 리뷰할 시작점이 없다. 커밋한 뒤에는 변경 목록이 비어 버린다 | V01 |
| "이 함수는 봤다" 를 남길 자리가 없다. 검토 상태는 노드 대상을 허용하는데 화면은 범위에만 붙인다 | `App.tsx:1635` `target.kind !== 'range'` 이면 무시, `AnalysisPanel.tsx:671` 진행률도 범위만 센다 | 수십 개 노드 중 어디까지 봤는지 트리에서 알 수 없다 | V02 |
| 변경 목록의 `열어봄 ✓` 는 파일을 열었다는 뜻일 뿐이다 | `ReadingStarts.tsx:111` | hunk 열 개 중 몇 개를 확인했는지 남지 않는다 | V03 |
| 코드 화면에 "이 함수가 트레일에 있다" 표시가 없고, 기록 범위는 밑줄과 hover 글뿐이라 누를 수 없다 | `CodeView.tsx:267-268` `inlineClassName`·`hoverMessage` 만 | 코드 화면에서 트레일·기록으로 건너갈 길이 없다 | V04 |
| 노드 헤더의 `경로:줄` 이 글자일 뿐이다. 노드에서 파일 전체를 보려면 외부 에디터뿐이다 | `TrailNode.tsx:261` `<span className="loc">` | 함수 주변 맥락(멤버·include·인접 함수)을 보려면 파일 탐색기에서 다시 찾는다 | V05 |
| 문서 심볼을 누르면 곧바로 루트가 생긴다 | `ReadingStarts.tsx:151` `onAddRoot` | 목록을 훑어보려던 클릭이 트레일을 오염시킨다. 계획서 8.2 의 이름 필터도 없다 | V06 |
| 코드 화면과 트레일 패널이 탭이라 한쪽을 잃는다 | `App.tsx:1077-1085` | hunk 를 보며 흐름을 따라가려면 탭을 계속 오간다 | V07 |
| 헤더 버튼이 여섯 개라 노드 단위 행동을 더 넣을 자리가 없다. 노드 하나를 Markdown 으로 복사하거나 링크를 만들 수 없다 | `TrailNode.tsx` `.acts` 여섯 버튼, `App.tsx` 해시는 `localAnalysis` 만 처리 | PR 댓글에 한 함수의 흐름을 붙이려면 전체 Markdown 을 내려받아 잘라낸다 | V08 |
| 필터가 이름·경로만 본다 | `TrailView.tsx:130` `filterIds` | "이 트레일에서 `mutex` 를 만진 곳" 을 못 찾는다 | V09 |
| `⇱` 는 진입 링크를 지우는데 되돌릴 수 없다. 되돌리기는 삭제에만 있다 | `commands.ts:367` `trail.undoRemove` 뿐 | 잘못 떼어낸 서브트리를 원래 자리로 되돌릴 길이 없다 | V10 |
| 보드에서 손으로 옮긴 자리는 영구 저장이고 초기화가 없다 | `TrailView.tsx:289-317` 좌표 없는 노드만 자동 배치 | 뒤엉킨 보드를 다시 정리할 방법이 없다 | V11 |
| 접힌 노드는 `↳ N`(직계만) 뿐이다 | `TrailNode.tsx:257` | 접힌 서브트리 안에 미해결 우려가 있는지 알 수 없다 | V12 |
| 안내 순서가 링크 목록일 뿐이다 | `AnalysisPanel.tsx:414-457` | 받는 사람이 단계마다 링크를 누르고 되돌아와야 한다 | V13 |
| 안내 순서는 "현재 기록 순서로 만들기" 와 위아래 이동만 된다 | `AnalysisPanel.tsx:456`, 단계 추가·삭제·수정 UI 없음 | 설명하기 좋은 순서로 다듬을 수 없다 | V14 |
| 기록 필터가 본문 검색·종류·삭제 포함뿐이다. 서버의 전체 검색 API 를 화면이 안 쓴다 | `AnalysisPanel.tsx:359-369`, `routes.ts:135` `/api/annotations/search` 미사용 | 열림/해결·작성자·파일별로 못 거르고, 다른 분석의 기록을 찾을 수 없다 | V15 |
| 코드 화면의 `＋ 기록` 은 분석 탭으로 보낸다 | `App.tsx:1093-1097` | 코드를 떠나야 기록한다. U12 가 트레일에만 기록 열을 붙였다 | V16 |
| 파일이 바뀌어도 `위치 다시 확인` 을 눌러야 상태가 바뀐다 | `gateway.ts:1245` 명령으로만 진입, `bootstrap.ts:271` 감시자는 `filesChanged` 만 방송 | 옛 위치에 붙은 기록을 모른 채 읽는다 | V17 |
| 새로고침·재시작 뒤 항상 시작하기 카드부터다. 개인 화면 상태는 `localStorage` 인데 origin 이 `127.0.0.1:<포트>` 이고 포트 기본값이 0 이라 재시작마다 origin 이 바뀐다 | `App.tsx:87,90`, `args.ts` USAGE "기본 0 = 운영체제가 빈 포트를 고른다" | 사이드바 폭·기록 열·이동 이력·최근 파일이 서버를 다시 띄우면 전부 사라진다. "브라우저에 남긴다" 가 실제로는 남지 않는다 | V18 |
| 툴팁과 단축키 도움말이 `Alt+↑/↓` 를 약속하지만 전역 처리기는 `Alt+←/→` 만 본다 | `App.tsx:1237,1244` 툴팁, `ShortcutsHelp.tsx:47`, `App.tsx:803` | 문서화된 키가 안 먹는다. 탭·사이드바·기록 열 토글 키도 없다 | V19 |
| 코드 화면은 탭 폭 4, 트레일 본문은 `tab-size` 미지정이라 브라우저 기본 8 | `CodeView.tsx:117` `tabSize: 4`, `trail.css:525-533` `.code` 에 `tab-size` 없음 | 같은 Go 함수가 두 화면에서 다르게 보이고 폭 맞춤도 8칸 기준으로 잰다 | V20 |
| 검색·변경 목록으로 연 파일이 파일 탐색기에서 안 보인다. 변경 상태도 안 보인다 | `FileTree.tsx:76` 이미 그려진 줄만 강조 | 지금 어느 폴더의 파일을 보고 있는지 트리에서 모른다 | V21 |
| 트레일 고르기가 `제목 (노드 수)` 셀렉트뿐이다. 서버가 주는 `updatedAt` 을 화면 타입이 버린다 | `TrailBar.tsx:36`, `types.ts:65` `TrailSummaryView`, `http.ts:89` `TrailSummary` 에는 있다 | 트레일이 쌓이면 무엇이 최신인지 모른다 | V22 |
| 트레일 Markdown 은 코드만, 공유 Markdown 은 기록 중심에 코드가 평평하다. 정적 HTML 도 평평하다 | `markdown.ts:46`, `sharing/service.ts:436,477`, `staticHtml` `<details>` 나열 | 같은 이름의 내보내기 둘이 다른 문서를 만들고, 어느 쪽도 트리+기록을 다 담지 않는다 | V23 |

### 1.3 우선순위 원칙

P0 는 **리뷰의 시작점이 없거나 약속한 것이 안 되는 것**이다(V01·V02·V05·V19).
P1 은 리뷰 동선을 짧게 만들거나 저장한 줄 알았던 것을 실제로 남기는 것, P2 는 있으면 좋은 것이다.
기능 수를 늘리기보다 "변경 기준 고르기 → hunk 에서 시작 → 흐름 따라가기 → 봤다고 표시 → 기록 → 안내 순서로 전달" 이
끊기지 않게 하는 데 집중한다.

## 2. 권장 배포 단위

| 배포 | 태스크 | 목표 |
| --- | --- | --- |
| 1.5.0 — 변경 기준과 검토 표시 | V01 V02 V03 V05 V06 V19 V20 | 브랜치·커밋 단위로 리뷰를 시작하고, 본 것을 노드와 hunk 에 남기고, 약속한 키가 전부 먹는다 |
| 1.6.0 — 기록과 안내 순서 | V04 V08 V13 V14 V15 V16 V17 V18 | 코드 화면에서도 기록하고, 안내 순서를 다듬어 따라 읽게 하고, 개인 상태가 재시작을 견딘다 |
| 1.7.0 — 화면 구성 | V07 V09 V10 V11 V12 V21 V22 V23 | 넓은 화면을 쓰고, 트레일이 커져도 찾고 정리하고 내보낼 수 있다 |

각 배포는 `CHANGELOG.md` 항목과 네 `package.json` 의 `version` 을 함께 올린다(`CLAUDE.md` `바꾸면 같이 고칠 것`).

## 3. 새로 정하는 용어

이 문서의 태스크가 만드는 화면 부위다. 구현 시 `CLAUDE.md`·`AGENTS.md` 의 `## 용어` 표에 그대로 옮기고,
트레일 패널 안에 생기는 것은 `docs/terms.svg` 에도 그린다.

| 용어 | 코드 / DOM | 뜻 | 태스크 |
| --- | --- | --- | --- |
| **변경 기준** | `ChangeBase`, `.change-base` | 변경 목록·hunk·변경 보기가 무엇과 비교하는지. 작업 트리(기본)·커밋·브랜치 | V01 |
| **검토 표시** | `.act.review`, `.badge.reviewed` | 노드 헤더와 hunk 줄의 `☐/☑`. 눌러 `확인함` 을 남기고, 코드가 바뀌면 `재검토` 로 내려간다 | V02 V03 |
| **여백 표식** | `.glyph-node`, `.glyph-note` | 코드 화면 왼쪽 여백의 트레일 노드·기록 표시. 누르면 그 노드·기록으로 간다 | V04 |
| **분할 보기** | `.main.split` | 코드 화면과 트레일 패널을 나란히 놓은 상태. 좁은 화면에서는 탭으로 돌아간다 | V07 |
| **노드 메뉴** | `NodeMenu`, `.node-menu` | 헤더 우클릭 또는 `⋯` 로 여는 노드 단위 행동 목록 | V08 |
| **안내 순서 재생** | `WalkthroughPlayer`, `.walkthrough-player` | 화면 아래 고정 막대. `n/m · 제목 · ← 이전 · 다음 →` 로 단계를 따라간다 | V13 |
| **개인 화면 상태** | `LocalUiState`, `.code-trail/local/ui-state.json` | 사이드바·기록 열·마지막 문서·이동 이력처럼 이 기계의 이 사람에게만 속한 값 | V18 |
| **트레일 목록** | `TrailList`, `.trail-list` | 앱 바에서 여는 트레일 관리 팝오버. 셀렉트를 대체한다 | V22 |

배지 표에 `✓`(확인함)·`재검토`(V02)가 추가된다.

## 4. 상세 태스크

각 절은 목적 · 변경할 파일 · 구현 방법 · 검증 방법 · 완료 기준 · 함께 고칠 문서 순이다.
새 명령·이벤트는 반드시 `packages/shared/src/protocol/` 의 스키마와 `test/unit/protocol.test.mjs` 의 목록에 같이 넣는다.
새 순수 함수는 `packages/web/tsconfig.lib.json` 의 `include` 에 넣어야 단위 테스트가 찾는다.

---

### V01. 변경 기준을 골라 작업 트리 외의 변경도 리뷰한다

**목적.** 리뷰 대상은 작업 트리 변경만이 아니다. "이 브랜치가 main 에서 갈라진 뒤 바뀐 것 전부",
"이 커밋 하나" 를 검토할 시작점이 지금은 없다. 서버는 이미 `changesBetween`·`hunks(from, to)`·
`originalText(ref)` 를 갖고 있고 `/api/changes` 도 `from`·`to` 를 받는데, 화면이 인자 없이만 부른다.

**변경할 파일.**
- `packages/server/src/git/service.ts` — `recentRefs()`: 브랜치(`for-each-ref --sort=-committerdate refs/heads refs/remotes`, 상위 30)와 최근 커밋(`log -n 20 --format=%H%x00%s`). `mergeBase(a, b)`. `hunks(relPath, from)` 에서 `to` 가 없으면 `git diff <from> -- path`(기준 커밋 → 작업 트리).
- `packages/server/src/http/routes.ts` — `GET /api/changes/refs`. `/api/changes` 와 `/api/changes/hunks` 에 `mergeBase=1` 이 오면 `from` 을 `merge-base(from, to)` 로 바꾼다.
- `packages/web/src/api/http.ts` — `changes(base)`, `hunks(relPath, base)`, `originalText(relPath, ref)`, `changeRefs()`.
- `packages/web/src/features/changes/ReadingStarts.tsx` — 변경 목록 머리에 **변경 기준** 셀렉트.
- `packages/web/src/app/App.tsx` — `changeBase` 상태 하나를 변경 목록·hunk·변경 보기·시작하기 카드가 같이 쓴다.

**구현 방법.**
1. 기준은 셋 중 하나다. `작업 트리`(기본, 지금과 같다) · `커밋 이후 작업 트리`(`from=<커밋>`, `to` 없음) · `두 지점 사이`(`from`·`to`, 브랜치면 `mergeBase=1`).
2. 셀렉트 목록은 `현재 브랜치 ← 기본 브랜치(merge-base)` 를 맨 위 추천으로 두고, 브랜치·최근 커밋을 그 아래 둔다. `ref` 는 서버 `resolveRevision` 을 통과한 것만 쓴다 — 화면이 보낸 문자열을 그대로 `git` 인자로 넘기지 않는다(`-` 로 시작하는 값 거부는 이미 있다).
3. 기준이 바뀌면 `changes`·열린 문서의 `hunks`·`originalText` 를 다시 받는다. `변경 보기` 의 왼쪽은 기준의 `from` 이다.
4. 두 지점 사이 모드에서는 `추적되지 않음`·`staged`·`unstaged` 구분이 없으므로 `area: 'commit'` 한 줄로 보인다. 삭제된 파일은 열지 못하므로 줄을 비활성으로 두고 이유를 툴팁에 적는다.
5. 기준 값은 V18 의 개인 화면 상태에 남긴다. V18 전에는 React 상태로만 둔다.

**검증 방법.**
- `test/integration/git.test.mjs` — 커밋 둘을 가진 임시 저장소에서 `refs` 목록, `merge-base` 기준 변경 목록, `from` 만 준 hunk 가 작업 트리를 본다는 것 각 한 줄.
- `test/integration/resilience.test.mjs` 의 인증 훑기가 새 경로를 자동으로 잡는다.
- `test/e2e/shell.e2e.mjs` — 기준을 `커밋 이후 작업 트리` 로 바꾸면 변경 목록 항목 수가 달라진다.

**완료 기준.** 기준을 고르면 변경 목록·hunk·변경 보기·시작하기 카드가 모두 그 기준을 따른다. Git 이 없는 프로젝트에서는 셀렉트가 비활성이고 나머지가 그대로 돈다. 새 API 는 토큰 없이 401 이다.

**함께 고칠 문서.** README `## 사용법` 의 `변경에서 시작하기` 줄, 구현서 15.1 HTTP 표, `CLAUDE.md`·`AGENTS.md` 용어 표(변경 기준), `docs/terms.md` 읽기 시작점 설명, CHANGELOG.

---

### V02. 노드에 검토 표시를 붙인다

**목적.** 리뷰 도구인데 "이 함수는 봤다" 를 남길 자리가 없다. `review.setState` 는 `{kind:'node'}` 대상을
받을 수 있지만 화면은 범위 기록의 셀렉트로만 상태를 바꾼다. 트리에서 어디까지 봤는지 알 수 없고,
코드가 바뀌었을 때 "다시 봐야 할 함수" 도 알 수 없다.

**변경할 파일.**
- `packages/web/src/features/trail/annotationIndex.ts` — `reviewByNode: Map<nodeId, ReviewState>` 와 `reviewCounts`(확인함·재검토 수). 순수 함수.
- `packages/web/src/features/trail/TrailNode.tsx` — 버튼 묶음 맨 앞의 검토 표시 `☐/☑`, 헤더 배지 `✓`(초록)·`재검토`(주황).
- `packages/web/src/features/trail/TrailView.tsx` — 키 `v`, 툴바 오른쪽 `확인함 N · 재검토 K`.
- `packages/web/src/app/App.tsx` — `onReview` 가 노드 대상도 보낸다. 분석이 없으면 U11 과 같은 길로 먼저 만든다.
- `packages/web/src/features/annotations/AnalysisPanel.tsx` — `Progress` 가 노드 대상 검토도 센다. 노드 대상 기록 카드에도 검토 셀렉트를 붙인다.
- `packages/server/src/analysis/service.ts` — 노드 대상 검토는 그 노드 심볼의 `relPath`·`contentHash` 로 기준(baseline)을 잡는다. `trail.refreshNode` 로 해시가 달라지면 그 노드의 `reviewed` 를 `needsReview` 로 내린다.
- `packages/web/src/styles/trail.css`, `docs/terms.svg`.

**구현 방법.**
1. 검토 표시는 `unreviewed ↔ reviewed` 토글이다. `reviewing`·`needsReview` 는 셀렉트(기록 열·분석 화면)에서만 고른다 — 헤더 한 번 누르기의 뜻이 둘이면 안 된다.
2. 표시는 활성 분석 하나만 본다(U10 과 같은 결정). 분석이 없으면 첫 토글이 분석을 만든다.
3. 툴바 수치는 개수만 적는다. 분모를 노드 수로 잡으면 "노드를 펼친 횟수를 이해 완료율로 계산하지 않는다"(계획서 8.4)에 어긋난다. 분석 화면의 진행률은 지금처럼 검토 기록 수를 분모로 둔다.
4. 다시 읽기(`↻`)로 해시가 달라진 노드는 서버가 `needsReview` 로 내린다. 되돌리기(`trail.undoRemove`)로 살아난 노드의 검토 기록은 그대로다 — 노드 ID 가 같다.
5. Markdown 내보내기(V23)에 `확인함` 배지가 실린다.

**검증 방법.**
- `test/unit/annotation-index.test.mjs` — 노드 대상 검토가 색인에 들어가고 범위 대상은 섞이지 않는다.
- `test/integration/analysis-sharing.test.mjs` — 노드 대상 `review.setState` 왕복, `refreshNode` 뒤 `needsReview`.
- `test/e2e/analysis.e2e.mjs` — `v` 를 누르면 헤더에 `✓`, 툴바에 `확인함 1`.

**완료 기준.** 헤더 한 번으로 `확인함` 이 남고 새로고침·재시작 뒤에도 그대로다. 코드가 바뀐 노드는 다시 읽으면 `재검토` 가 된다. 공유 묶음에 노드 검토가 실려 받는 쪽에서도 보인다.

**함께 고칠 문서.** README `### 표시되는 배지`·`### 헤더에 표시되는 것`·키 표, `docs/terms.svg` 헤더 줄과 배지 콜아웃, `ShortcutsHelp.tsx`, 용어 표(검토 표시), `docs/share-format.md`(검토 기록 포함 정책은 이미 있다 — 노드 대상 예시 한 줄), CHANGELOG.

---

### V03. 변경 목록의 hunk 에 검토 표시를 붙인다

**목적.** `열어봄 ✓` 는 파일을 열었다는 뜻일 뿐이다. hunk 열 개 중 몇 개를 실제로 확인했는지가
리뷰의 진행이고, 코드가 또 바뀌면 어느 hunk 를 다시 봐야 하는지가 남아야 한다.

**변경할 파일.**
- `packages/web/src/features/changes/ReadingStarts.tsx` — hunk 줄 오른쪽 `☐/☑`, 파일 줄에 `✓ n/m`.
- `packages/web/src/app/App.tsx` — 토글 시 `api.open(relPath)` 로 문서 권한을 얻고 `anchor.capture(hunk 전체 줄)` → `review.setState(range, 'reviewed')`.
- `packages/web/src/features/trail/annotationIndex.ts` — `reviewsByFile`: 파일별 `확인함`·`재검토` 범위. 순수 함수.
- `packages/server/src/analysis/service.ts` — `anchor.capture` 가 같은 파일·같은 범위·같은 해시면 새 앵커를 만들지 않고 기존 것을 돌려준다.

**구현 방법.**
1. hunk 의 범위는 `newStart..newStart+newCount-1` 전체 줄이다. 삭제만 된 hunk(`newCount === 0`)는 앞줄 한 줄을 범위로 잡고 툴팁에 "지워진 자리" 라고 적는다.
2. 표시는 `reviewsByFile` 과 hunk 범위의 겹침으로 판정한다. 범위가 정확히 같지 않아도 `확인함` 범위가 hunk 를 덮으면 `☑` 다.
3. 파일이 바뀌면 V17 의 자동 재확인이 앵커를 `needsReview` 로 내리고, hunk 줄은 `재검토` 로 보인다.
4. 변경 기준(V01)을 바꾸면 hunk 가 달라지므로 표시도 새 hunk 기준으로 다시 판정한다. 검토 기록 자체는 지우지 않는다.

**검증 방법.**
- `test/unit/annotation-index.test.mjs` — `reviewsByFile` 과 겹침 판정.
- `test/integration/analysis-sharing.test.mjs` — 같은 범위 `anchor.capture` 두 번이 앵커 하나다.
- `test/e2e/analysis.e2e.mjs` — hunk `☐` → `☑`, 파일 줄 `✓ 1/2`.

**완료 기준.** hunk 단위로 봤다는 표시가 남고 재시작 뒤에도 유지된다. 코드가 바뀐 hunk 는 `재검토` 로 구분된다.

**함께 고칠 문서.** README `변경에서 시작하기`, `docs/terms.md` 읽기 시작점, 용어 표(검토 표시 — V02 와 한 줄), CHANGELOG.

---

### V04. 코드 화면 여백에 트레일 노드와 기록 표식을 그린다

**목적.** 코드 화면은 "이 함수가 이미 트레일에 있다" 를 모른다. 기록 범위는 밑줄과 hover 글뿐이라
누를 수 없다. 리뷰어는 코드 화면에서 hunk 를 읽다가 트레일의 그 노드로, 또는 그 줄의 기록으로 바로 가고 싶다.

**변경할 파일.**
- `packages/web/src/features/source/gutterIndex.ts`(새 파일, 순수 함수) — 활성 트레일의 노드를 `relPath → Map<line, nodeId[]>` 로, 활성 분석의 범위 기록을 `relPath → Map<line, annotationId[]>` 로 편다. `tsconfig.lib.json` 에 넣는다.
- `packages/web/src/features/source/CodeView.tsx` — `glyphMargin: true`, `glyphMarginClassName`·`glyphMarginHoverMessage` 장식, `onMouseDown` 의 `GUTTER_GLYPH_MARGIN` 처리.
- `packages/web/src/app/App.tsx` — 표식 클릭 → 노드면 `setActiveNode` + 트레일 탭(같은 줄에 노드가 여럿이면 후보 팝오버가 아니라 알림으로 "같은 심볼 N/M" 이동을 안내), 기록이면 기록 열(V16) 또는 분석 화면의 그 카드.
- `packages/web/src/styles/app.css`.

**구현 방법.**
1. 노드 표식은 `anchorLine` 한 줄에만 둔다. 본문 전체에 색을 칠하면 hunk 색 띠와 섞인다.
2. 기록 표식은 종류별 색을 트레일 본문의 색 띠(`.cl.noted[data-kind]`)와 같은 값으로 쓴다. 같은 것을 두 색으로 부르지 않는다.
3. 변경 보기(diff)에서는 오른쪽(수정본)에만 그린다.
4. 표식은 활성 트레일·활성 분석만 본다(U10 과 같은 결정).

**검증 방법.**
- `test/unit/gutter-index.test.mjs`(새 파일) — 같은 파일의 노드 둘·기록 하나가 줄별로 색인된다.
- `test/e2e/trail.e2e.mjs` — 루트를 만든 뒤 그 파일을 다시 열면 여백 표식이 있고, 누르면 트레일 탭에서 그 노드가 활성이다.

**완료 기준.** 코드 화면에서 트레일 노드와 기록으로 한 번에 간다. 표식이 없는 줄의 여백은 지금과 같다.

**함께 고칠 문서.** 용어 표(여백 표식), `docs/terms.md` 코드 화면 설명, README `## 사용법`, CHANGELOG.

---

### V05. 노드 헤더의 경로에서 코드 화면으로 간다

**목적.** 노드는 함수 본문만 보여준다. 그 함수를 감싸는 클래스의 다른 멤버, 파일 상단의 include,
바로 옆 함수를 보려면 지금은 외부 에디터(`↗`)뿐이다. 헤더의 `경로:줄` 은 이미 거기 있는데 글자일 뿐이다.

**변경할 파일.**
- `packages/web/src/features/trail/TrailNode.tsx` — `.loc` 을 `<button>` 으로. `relPath === null`(프로젝트 밖)이면 비활성 + 툴팁 "프로젝트 밖 파일은 코드 화면에서 열 수 없다".
- `packages/web/src/features/trail/TrailView.tsx` — 키 `g`.
- `packages/web/src/app/App.tsx` — `onOpenInCodeView(node)` → `openFile(relPath, anchorLine, anchorChar)`. 이동 이력에 남는다.

**구현 방법.**
1. 보드 모드의 드래그는 `closest('button')` 을 이미 건너뛰므로 버튼으로 바꿔도 끌기가 깨지지 않는다.
2. 코드 화면이 열리면 `revealLine` 이 가운데로 데려오고, V04 의 여백 표식이 그 노드를 가리킨다.
3. `Alt+←` 로 트레일의 그 노드로 돌아온다(이동 이력).

**검증 방법.**
- `test/e2e/trail.e2e.mjs` — `.loc` 클릭 → 코드 탭, 문서 줄 경로가 같고 커서 줄이 `anchorLine` 이다.

**완료 기준.** 노드에서 파일 전체 맥락으로 한 번에 가고 돌아온다.

**함께 고칠 문서.** README 키 표(`g`), `ShortcutsHelp.tsx`, `docs/terms.svg` 헤더 `경로:줄` 콜아웃에 "누르면 코드 화면", CHANGELOG.

---

### V06. 문서 심볼 클릭은 이동하고 루트 만들기는 따로 둔다

**목적.** 문서 심볼 목록의 줄을 누르면 곧바로 루트가 생긴다. 목록으로 파일을 훑어보려던 사람이
트레일에 노드를 쌓는다. 계획서 8.2 가 말한 "이름으로 필터한다" 도 없다.

**변경할 파일.**
- `packages/web/src/features/changes/ReadingStarts.tsx` — 줄 클릭 = 코드 화면 그 위치로, 줄 오른쪽 `▶` = 루트. 위에 이름 필터 입력. 커서를 감싸는 심볼 강조.
- `packages/web/src/app/App.tsx` — `enclosingSymbol` 을 넘긴다.
- `packages/web/src/styles/app.css`.

**구현 방법.**
1. 클릭은 `onOpenFile(document.relPath, line, char)` 다. 이미 열린 문서이므로 `revealLine` 만 일어난다.
2. `▶` 는 지금의 `onAddRoot` 그대로다. 언어 서버가 심볼 해석을 지원하지 않는 문서면 `▶` 를 숨긴다.
3. 필터는 이름 부분 일치, 대소문자 무시. 계층(`depth`) 들여쓰기는 유지한다.

**검증 방법.**
- `test/e2e/shell.e2e.mjs` — 심볼 클릭 뒤 노드 수가 그대로고 커서 줄이 바뀐다. `▶` 로만 노드가 는다.

**완료 기준.** 문서 심볼 목록이 이동 도구가 되고 루트 만들기는 명시적 버튼이다.

**함께 고칠 문서.** README `## 사용법`, `docs/terms.md` 읽기 시작점, CHANGELOG.

---

### V07. 넓은 화면에서 코드 화면과 트레일 패널을 나란히 본다

**목적.** 리뷰는 "코드 화면의 hunk ↔ 트레일의 흐름" 왕복이다. 구현서가 탭을 택한 이유
("작은 화면에서 둘을 나란히 놓으면 코드도 트리도 못 읽는다")는 그대로 지키되, 1400px 이상에서는
사용자가 켤 수 있는 **분할 보기**를 둔다. 기본은 탭이다.

**변경할 파일.**
- `packages/web/src/app/App.tsx` — `layout: 'tabs' | 'split'`. split 이면 `.main` 이 코드 열과 트레일 열 둘이고 탭 줄에는 분석 기록·설정·진단만 남는다. 열 경계는 사이드바 손잡이와 같은 방식으로 끈다.
- `packages/web/src/styles/app.css` — `.main.split`.
- `packages/web/src/features/trail/useFitToWidth.ts` — 건드리지 않는다. 트레일 열 폭이 곧 `--ct-tree-node-width` 의 컨테이너다.

**구현 방법.**
1. 토글은 탭 줄 오른쪽 `⫿ 분할` 과 `Ctrl+Alt+\`(V19). 창이 1400px 아래로 줄면 자동으로 탭으로 돌아가고 넓어지면 사용자가 켰던 값으로 돌아온다.
2. 분할 상태에서 `▶ 트레일 시작`·식별자 클릭은 탭을 바꾸지 않는다 — 두 열이 다 보인다. `focusRequest` 스크롤은 트레일 열 안에서만 일어난다.
3. 선택 칩·후보 팝오버는 뷰포트 좌표를 쓰므로 그대로 동작한다.
4. 상태는 V18 의 개인 화면 상태에 남긴다.

**검증 방법.**
- `test/e2e/shell.e2e.mjs` — 1600×900 에서 토글하면 `.code-view` 와 `.trail` 이 동시에 보이고, 1200 으로 줄이면 탭으로 돌아온다.

**완료 기준.** 넓은 화면에서 hunk 를 읽으며 흐름을 따라간다. 좁은 화면의 동작은 지금과 같다.

**함께 고칠 문서.** 용어 표(분할 보기), `docs/terms.md` 트레일 패널 밖 그림, README `## 사용법`, `ShortcutsHelp.tsx`, CHANGELOG.

---

### V08. 노드 메뉴를 만들고 Markdown 복사와 노드 링크를 넣는다

**목적.** 헤더 버튼이 여섯이라 더 넣을 자리가 없다. 노드 단위로 필요한 행동 — 코드 화면에서 보기(V05),
서브트리를 Markdown 으로 복사, 노드 링크 복사, 안내 순서에 추가(V14), 검토 표시(V02) — 을 한 곳에 모은다.
PR 댓글에 함수 하나의 흐름을 붙이는 일이 지금은 전체 Markdown 을 내려받아 잘라내는 일이다.

**변경할 파일.**
- `packages/web/src/features/trail/NodeMenu.tsx`(새 파일) — `.node-menu`. 위치 잡기는 `ChoicePopover` 의 방식을 재사용한다.
- `packages/web/src/features/trail/TrailNode.tsx` — 헤더 `onContextMenu` 와 버튼 묶음 끝의 `⋯`.
- `packages/web/src/features/trail/TrailView.tsx` — 키 `m`·`Shift+F10`.
- `packages/shared/src/domain/markdown.ts` — `subtreeToMarkdown(node, options)`. `trailToMarkdown` 이 이것을 부른다.
- `packages/web/src/app/App.tsx` — 해시 `#trail=<id>&node=<id>` 를 읽어 트레일 선택 + 활성 노드. `localAnalysis` 처리와 같은 자리.
- `packages/web/src/styles/trail.css`, `docs/terms.svg`.

**구현 방법.**
1. 메뉴 항목 순서: 코드 화면에서 보기 · 에디터에서 열기 · 검토 표시 · 기록 남기기 · 안내 순서에 추가 · Markdown 복사 · 링크 복사 · 새 루트로 떼어내기 · 삭제. 기존 헤더 버튼은 그대로 둔다 — 메뉴는 자리가 모자란 행동을 위한 것이지 버튼의 대체가 아니다.
2. Markdown 복사는 그 노드와 하위를 `subtreeToMarkdown` 으로 만든다. 기록(활성 분석)이 있으면 코드 블록 뒤에 인용으로 붙인다(V23 과 같은 형식).
3. 링크는 `#trail=…&node=…` 뿐이다. 토큰·포트·경로를 담지 않는다. 같은 서버의 다른 탭에서 열면 그 노드가 활성이 되고, 정적 HTML(V23)이 이미 쓰는 매개변수 이름과 같다.
4. 클립보드는 `navigator.clipboard.writeText`. 실패하면 알림에 본문을 담은 `복사` 버튼을 둔다(에디터 실패 처리와 같은 길).

**검증 방법.**
- `test/unit/markdown.test.mjs` — 서브트리 Markdown 이 자식·진입 링크·배지를 담고 형제는 담지 않는다.
- `test/e2e/trail.e2e.mjs` — 우클릭 → 메뉴 → `링크 복사` → 새 탭에서 그 해시로 열면 활성 노드가 같다. 클립보드는 `context.grantPermissions(['clipboard-read'])` 로 읽는다.

**완료 기준.** 노드 하나의 흐름을 Markdown 으로 바로 붙일 수 있고, 노드를 가리키는 링크가 있다.

**함께 고칠 문서.** 용어 표(노드 메뉴), `docs/terms.svg` 헤더 `⋯`, README `### 헤더에 표시되는 것`·키 표, `ShortcutsHelp.tsx`, CHANGELOG.

---

### V09. 트레일 필터를 본문과 기록까지 넓힌다

**목적.** 필터가 이름·경로만 본다. "이 트레일에서 `mutex` 를 만진 곳", "우려가 달린 노드만" 을 찾을 수 없다.

**변경할 파일.**
- `packages/web/src/features/trail/filter.ts`(새 파일, 순수 함수) — `filterIds` 를 여기로 옮기고 대상(`name` · `body` · `notes`)과 매치 줄을 돌려준다. `tsconfig.lib.json` 에 넣는다.
- `packages/web/src/features/trail/TrailView.tsx` — 필터 대상 셀렉트, 매치 수, `Enter` 로 다음 매치.
- `packages/web/src/features/trail/CodeBody.tsx` — 매치 줄 `.cl.hit` 강조.

**구현 방법.**
1. 본문 매치는 `symbol.code` 의 줄 단위 부분 일치다. 토크나이저를 돌리지 않는다.
2. 기록 매치는 `annotationIndex` 의 종류·미해결 여부·본문이다(`우려`, `미해결` 같은 낱말도 받는다).
3. 조상을 함께 남기는 규칙은 그대로다.

**검증 방법.**
- `test/unit/trail-filter.test.mjs`(새 파일) — 세 대상 각각과 조상 보존.
- `test/e2e/trail.e2e.mjs` — 본문 필터로 한 노드만 남고 그 줄이 강조된다.

**완료 기준.** 이름·경로·본문·기록으로 트레일을 거른다.

**함께 고칠 문서.** README `## 사용법` 필터 줄, `docs/terms.svg` 툴바 필터 콜아웃, CHANGELOG.

---

### V10. 새 루트로 떼어내기에 되돌리기를 붙인다

**목적.** `⇱` 는 진입 링크를 지우고 재귀 배지를 다시 계산하는, 관계를 바꾸는 유일한 동작인데 되돌릴 수 없다.
삭제에는 8초 되돌리기가 있다. "되돌리기 버퍼는 한 단계다" 규칙을 지키면서 그 한 단계가 승격도 담게 한다.

**변경할 파일.**
- `packages/shared/src/domain/trail.ts` — `promoteToRoot` 가 `{ previousParentId, index, origin, recursiveBefore }` 를 돌려준다. `undoPromote(record)`.
- `packages/shared/src/protocol/commands.ts`·`events.ts` — 구조 명령 `trail.undoPromote`, `trail.nodePromoted` 에 `undoable`.
- `packages/server/src/trails/service.ts` — 삭제와 공용인 한 단계 버퍼. 다른 구조 명령이 오면 비운다(지금 규칙 그대로).
- `packages/server/src/ws/gateway.ts`, `packages/web/src/app/App.tsx`(`offerUndo` 확장).

**구현 방법.**
1. 되돌리기는 같은 ID 로 원래 부모의 원래 인덱스에 다시 붙이고 진입 링크를 복원한다. 보드 좌표는 승격 때 건드리지 않았으니 그대로다.
2. 승격 뒤 자식을 더 붙였다가 되돌려도 자식은 함께 돌아간다 — 서브트리째 옮기는 것이라 자연스럽다. 단, 그 사이의 구조 명령이 버퍼를 비우므로 실제로는 승격 직후에만 된다.

**검증 방법.**
- `test/unit/trail.test.mjs` — 승격 → 되돌리기 뒤 부모·인덱스·진입 링크·재귀 배지가 같다.
- `test/integration/websocket.test.mjs` — 승격 뒤 다른 구조 명령이 오면 `undoPromote` 가 거절된다.
- `test/unit/protocol.test.mjs` 목록.

**완료 기준.** `⇱` 알림의 `되돌리기` 가 8초 안에 원래 자리로 돌린다.

**함께 고칠 문서.** 구현서 14.2 명령 표, README `⇱` 설명, CHANGELOG.

---

### V11. 보드 자동 배치 초기화를 넣는다

**목적.** 보드에서 손으로 옮긴 자리는 트레일과 함께 저장된다. 노드가 늘어 뒤엉킨 뒤 "처음 배치로"
돌아갈 방법이 없다 — 자동 배치는 좌표가 없는 노드에만 돈다.

**변경할 파일.**
- `packages/shared/src/protocol/commands.ts` — 화면 명령 `trail.resetBoardLayout`(revision 을 올리지 않는다).
- `packages/server/src/trails/service.ts`·`ws/gateway.ts` — 모든 `nodeUi` 의 `boardX`·`boardY` 를 지우고 `trail.snapshot` 을 다시 보낸다(트리가 크게 바뀌는 명령과 같은 길).
- `packages/web/src/features/trail/TrailView.tsx` — 보드 모드 툴바 `⟲ 자동 배치` + 확인 팝오버.

**구현 방법.**
1. 확인 문구는 "손으로 옮긴 자리 N개를 지우고 다시 배치한다. 되돌릴 수 없다." 다. 좌표는 되돌리기 버퍼에 넣지 않는다 — 구조가 아니라 화면 상태다.
2. 본문 높이·글자 크기(`bodyHeight`·`codeFontSize`)는 건드리지 않는다.

**검증 방법.**
- `test/integration/websocket.test.mjs` — 명령 뒤 snapshot 의 `nodeUi` 에 좌표가 없고 revision 이 그대로다.
- `test/unit/protocol.test.mjs` 목록.
- `test/e2e/trail.e2e.mjs` `[보드 모드]` — 옮긴 뒤 초기화하면 자동 배치 자리로 돌아간다.

**완료 기준.** 보드를 한 번에 정리할 수 있고 트리 구조·revision 은 그대로다.

**함께 고칠 문서.** `docs/terms.svg` 툴바, README `### 보드 모드`, 구현서 14.2, CHANGELOG.

---

### V12. 접힌 노드에 하위 요약을 보여준다

**목적.** 접힌 노드는 `↳ N`(직계 자식 수)뿐이다. 그 안에 노드가 몇 개 더 있고 미해결 우려가 있는지는
펼쳐 봐야 안다. 큰 트레일을 접어 두고 훑을 때 어디를 펼칠지 고를 단서가 없다.

**변경할 파일.**
- `packages/web/src/features/trail/annotationIndex.ts` — `subtreeSummary(roots)`: 노드별 하위 노드 수·기록 수·미해결 수·재검토 수. 순수 함수, 한 번 순회.
- `packages/web/src/features/trail/TrailNode.tsx` — 접힌 헤더에만 `하위 12 · ✎ 3 · 미해결 1`.

**구현 방법.** 펼쳐진 노드에는 지금처럼 `↳ N` 만 둔다. 요약은 접힌 상태에서만 뜻이 있다.

**검증 방법.**
- `test/unit/annotation-index.test.mjs` — 3단 트리에서 합계가 맞고 형제 것이 섞이지 않는다.

**완료 기준.** 접힌 노드만 보고도 안에 볼 것이 있는지 안다.

**함께 고칠 문서.** `docs/terms.svg` 접힌 노드 C 헤더, README `### 헤더에 표시되는 것`, CHANGELOG.

---

### V13. 안내 순서를 단계별로 따라 읽는 재생 모드를 만든다

**목적.** 안내 순서는 "설명하기 좋은 순서" 를 담으라고 만든 것인데 지금은 링크 목록이다. 받는 사람은
단계마다 링크를 누르고 분석 화면으로 돌아와 다음 링크를 찾는다. `--read-share` 로 프로젝트 없이 읽는
사람에게는 이것이 첫 경험이다.

**변경할 파일.**
- `packages/web/src/features/annotations/WalkthroughPlayer.tsx`(새 파일) — `.walkthrough-player`. 화면 아래 알림 위에 고정. `n/m · 제목 · 설명 · ← 이전 · 다음 → · ×`.
- `packages/web/src/app/App.tsx` — 단계 이동 시 대상으로 이동: 노드면 트레일 탭 + `setActiveNode`, 범위면 코드 화면 그 줄, 기록이면 기록 열(V16)의 그 카드.
- `packages/web/src/features/annotations/AnalysisPanel.tsx` — 안내 순서 제목 옆 `따라 읽기`.
- `packages/server/src/sharing/service.ts` — 정적 HTML 의 각 단계에 `이전`·`다음` 링크.
- `packages/web/src/styles/app.css`.

**구현 방법.**
1. 키 `[`·`]` 로 이전·다음, `Esc` 로 종료. 입력 중에는 먹지 않는다.
2. 대상이 없어진 단계(노드 삭제 등)는 건너뛰지 않고 "연결할 곳이 없다" 를 막대에 적는다 — 계획서 8.3 의 결정 그대로다.
3. 재생 중에 사용자가 다른 곳을 눌러도 막대는 남는다. 다음 단계가 다시 제자리로 데려간다.
4. 정적 HTML 은 스크립트가 없으므로 앵커 링크로만 한다.

**검증 방법.**
- `test/e2e/analysis.e2e.mjs` — 단계 둘을 만들고 `따라 읽기` → `다음` 으로 활성 노드가 바뀐다.
- `test/e2e/share-html.e2e.mjs` — 단계에 이전·다음 앵커가 있고 `:target` 이 옮겨간다.

**완료 기준.** 안내 순서를 처음부터 끝까지 `다음` 만 눌러 읽는다.

**함께 고칠 문서.** 용어 표(안내 순서 재생), `docs/terms.md` 트레일 패널 밖, README `### 분석 기록과 공유`·키 표, `docs/first-review-guide.md`, `ShortcutsHelp.tsx`, CHANGELOG.

---

### V14. 안내 순서의 단계를 추가하고 지우고 고친다

**목적.** 안내 순서는 `현재 기록 순서로 만들기` 한 번과 위아래 이동만 된다. 단계를 하나 더 넣거나,
기록 없이 노드만 가리키는 단계를 만들거나, 제목을 고칠 수 없다. `walkthrough.update` 는 이미 임의의
`steps` 를 받는다 — 화면만 없다.

**변경할 파일.**
- `packages/web/src/features/annotations/WalkthroughEditor.tsx`(새 파일, `AnalysisPanel` 의 안내 순서 절을 옮긴다) — 단계 줄에 `✎`(제목·설명 인라인 편집)·`✕`, 아래에 `현재 위치를 단계로 추가`.
- `packages/web/src/features/trail/NodeMenu.tsx`(V08) — `안내 순서에 추가`.
- `packages/web/src/app/App.tsx` — 안내 순서가 없으면 빈 것을 하나 만든 뒤 단계를 붙인다.

**구현 방법.**
1. `현재 위치` 는 활성 노드(있으면) 또는 선택 범위(앵커를 먼저 잡는다) 또는 트레일이다. 기록 없이 `target` 만 가진 단계다.
2. 삭제는 확인 없이 되돌리기 알림(8초, 화면에서 `walkthrough.update` 를 이전 `steps` 로 다시 보낸다). 서버 버퍼가 아니라 화면이 이전 배열을 들고 있는 것으로 충분하다 — 단계는 구조가 아니다.
3. 인라인 편집은 `AnnotationItem` 의 편집 방식과 같다(`Ctrl+Enter` 저장, `Esc` 취소).

**검증 방법.**
- `test/e2e/analysis.e2e.mjs` — 노드 메뉴로 단계 추가, 제목 수정, 삭제 → 되돌리기.

**완료 기준.** 안내 순서를 원하는 순서·제목·대상으로 다듬을 수 있다.

**함께 고칠 문서.** README `### 분석 기록과 공유`, `docs/first-review-guide.md` 3~4단계, CHANGELOG.

---

### V15. 기록 목록에 필터와 정렬과 전체 검색을 넣는다

**목적.** 기록 목록은 본문 검색·종류·삭제 포함으로만 거른다. 열림/해결·작성자·대상 종류로 못 거르고,
위치순으로 못 세우고, 파일별로 못 묶는다. 서버의 `/api/annotations/search`(모든 분석 대상)는 화면이 안 쓴다.
태그는 매번 손으로 친다.

**변경할 파일.**
- `packages/web/src/features/annotations/annotationList.ts`(새 파일, 순수 함수) — 필터·정렬·묶기. `tsconfig.lib.json` 에 넣는다.
- `packages/web/src/features/annotations/AnalysisPanel.tsx` — 도구 줄에 상태·작성자·대상 셀렉트, 정렬(최신·위치·종류), `파일별 묶기`, `모든 분석에서 찾기`.
- `packages/web/src/api/http.ts` — `annotationSearch(q, { kind, status, tag })`.
- `packages/web/src/features/annotations/AnnotationComposer.tsx`·`AnnotationItem.tsx` — 태그 입력에 `<datalist>`(활성 분석의 태그 집합).

**구현 방법.**
1. 위치순은 `relPath` → 시작 줄 → 노드는 트레일의 보이는 순서(`visibleOrder`)다. 트레일 전체 대상은 맨 위.
2. `모든 분석에서 찾기` 결과는 분석 제목을 앞에 달고, 누르면 그 분석으로 전환한 뒤 그 카드로 간다(`manualAnalysis` 를 세운다 — 트레일 전환이 덮지 않게).
3. 필터 상태는 화면 상태다. 저장하지 않는다.

**검증 방법.**
- `test/unit/annotation-list.test.mjs`(새 파일) — 상태·작성자 필터, 위치순 정렬, 파일별 묶기.
- `test/e2e/analysis.e2e.mjs` — `열림` 만 남기기, 전체 검색으로 다른 분석의 기록 열기.

**완료 기준.** 기록이 수백 개여도 원하는 것을 세 번 안에 찾는다.

**함께 고칠 문서.** README `### 분석 기록과 공유`, CHANGELOG.

---

### V16. 코드 화면에도 기록 열을 붙인다

**목적.** 코드 화면에서 드래그 → `＋ 기록` 을 누르면 분석 탭으로 넘어간다. 코드를 떠나야 기록한다.
U12 의 기록 열은 트레일 패널에만 있다. hunk 를 읽으며 바로 옆에 적는 것이 리뷰의 기본 동작이다.

**변경할 파일.**
- `packages/web/src/app/App.tsx` — `renderCodePane` 이 `.code-pane` 안에 `CodeView` + (열려 있으면) `AnnotationColumn` 을 놓는다. 열의 목록은 현재 문서의 범위 기록(`annotationIndex.byFile`)이고 대상 기본값은 `range`. 선택 칩의 `＋ 기록` 은 탭을 바꾸지 않고 열을 연다.
- `packages/web/src/features/annotations/AnnotationColumn.tsx` — 코드 화면용 대상 문구.
- `packages/web/src/styles/app.css`.

**구현 방법.**
1. 열림·폭은 트레일 패널의 것과 같은 값을 쓴다(V18 의 개인 화면 상태). 두 화면이 다른 폭이면 탭을 오갈 때 튄다.
2. 코드 화면의 열은 파일 단위다. 노드 대상 기록은 여기 보이지 않는다 — "표시는 활성 분석 하나, 대상은 지금 보는 것" 규칙을 지킨다.
3. 저장하면 V04 의 여백 표식과 Monaco 밑줄이 바로 갱신된다(`analysis.snapshot` 으로).

**검증 방법.**
- `test/e2e/analysis.e2e.mjs` — 코드 화면에서 두 줄 선택 → 칩 `＋ 기록` → 열이 열리고 탭은 `코드` 그대로 → 저장 → 목록에 카드 하나.

**완료 기준.** 코드 화면을 떠나지 않고 기록한다.

**함께 고칠 문서.** `docs/terms.md` 기록 열 절("트레일 패널 오른쪽" → "트레일 패널과 코드 화면 오른쪽"), 용어 표 기록 열 뜻, README, CHANGELOG.

---

### V17. 파일이 바뀌면 기록 위치를 자동으로 다시 확인한다

**목적.** 파일이 바뀌어도 앵커 상태는 `위치 다시 확인` 을 누르기 전까지 옛 그대로다. 감시자는
`workspace.filesChanged` 를 방송할 뿐이다. 옛 위치에 붙은 기록·색 띠를 그대로 믿고 읽게 된다.
"파일이 바뀌면 알리되 자동으로 다시 읽지 않는다" 는 **문서와 노드 본문**에 대한 규칙이다 — 앵커
재확인은 코드를 다시 읽는 것이 아니라 기록의 상태를 다시 판정하는 것이고, 재연결(`anchor.rebind`)은
여전히 사람이 한다.

**변경할 파일.**
- `packages/server/src/analysis/service.ts` — `recheckForFiles(relPaths)`: 그 파일을 기준으로 하는 앵커를 가진 분석마다 재확인. 1초 디바운스. 이력에는 `actorId: 'system'` 으로 남긴다.
- `packages/server/src/bootstrap.ts` — 감시자 콜백에서 위를 부른다. `readOnlyShare` 에서는 돌지 않는다(감시자도 안 뜬다).
- `packages/server/src/ws/gateway.ts` — 결과를 `analysis.snapshot` 으로 방송. 명령 없이 온 snapshot 이므로 `commandId` 없음.
- `packages/web/src/app/App.tsx` — `ambiguous`·`missing` 이 새로 생겼을 때만 경고 알림 + `분석 기록` 버튼. `moved`·`matched` 는 조용히 반영.

**구현 방법.**
1. 후보가 여럿이면 고르지 않는다(지금 규칙). 자동으로 바뀌는 것은 `state`·`currentRange` 뿐이다.
2. `reviewed` 였던 범위가 `changed` 가 되면 `needsReview` 로 내리는 기존 규칙이 자동 재확인에도 그대로 적용된다 — V02·V03 의 `재검토` 표시가 이 길로 켜진다.
3. 저장은 기존 분석 저장 스케줄러를 탄다. revision 이 오르므로 화면의 `baseRevision` 이 낡을 수 있다 — 화면은 snapshot 을 받으면 이미 갱신하므로 문제없다.

**검증 방법.**
- `test/integration/analysis-sharing.test.mjs` — 범위 기록을 만든 뒤 파일 위에 줄을 끼워 넣으면, 명령 없이 `analysis.snapshot` 이 오고 앵커가 `moved` 다.

**완료 기준.** 파일이 바뀌면 몇 초 안에 기록 위치·검토 상태가 현재 코드를 따라간다. 모호한 것은 알림으로 남고 사람이 재연결한다.

**함께 고칠 문서.** README `코드가 바뀌면` 단락, `docs/data-and-recovery.md`(시스템 이력 항목), CHANGELOG.

---

### V18. 개인 화면 상태를 서버에 저장하고 마지막 상태를 복원한다

**목적.** 두 가지가 겹친다. 첫째, 새로고침·재시작 뒤 항상 시작하기 카드부터라 어제 보던 파일·노드로
돌아가려면 최근 파일 → 파일 → 트레일 탭을 다시 밟는다. 둘째, "브라우저에 남긴다" 던 사이드바 폭·접힘·
기록 열·이동 이력·최근 파일은 `localStorage` 에 있는데, origin 이 `127.0.0.1:<포트>` 이고 포트 기본값이
0(운영체제가 고른다)이라 서버를 다시 띄우면 다른 origin 이 된다. **저장한 줄 알았던 값이 매번 초기화된다.**
작성자 이름만 서버의 로컬 설정에 있어 살아남는다.

**변경할 파일.**
- `packages/server/src/persistence/localUiStateStore.ts`(새 파일) — `.code-trail/local/ui-state.json`. 원자적 쓰기, 디바운스 500ms. `local/` 은 이미 자체 `.gitignore` 가 있다.
- `packages/shared/src/protocol/commands.ts`·`schemas.ts` — 화면 명령 `ui.saveLocalState`(revision 무관). 내용: `layout`(V07), `sidebar {width, collapsed}`, `annotationColumn {open, width}`, `lastPane`, `lastDocument {relPath, line, char}`, `navigation`(최근 100), `changeBase`(V01). **절대경로·documentId·토큰 없음.**
- `packages/server/src/http/routes.ts` — 부트스트랩에 `localUiState`.
- `packages/server/src/ws/gateway.ts`.
- `packages/web/src/app/App.tsx` — `localStorage` 대신 이것을 읽고 쓴다. 옛 `localStorage` 값은 첫 실행에 한 번 읽어 옮기고 지운다.
- `packages/web/src/features/start/StartCard.tsx` — 최근 파일이 이 상태에서 온다.

**구현 방법.**
1. 시작 시 `lastDocument` 가 있고 프로젝트 안에 아직 있으면 그 파일을 열고 `lastPane` 으로 간다. 없어졌으면 시작하기 카드 + 알림 없음(조용히).
2. 활성 트레일은 이미 서버 `index.json` 이 기억한다. 활성 노드도 트레일 파일에 있다. 여기서는 겹쳐 저장하지 않는다.
3. 여러 브라우저 탭이 같은 상태를 쓴다 — 마지막에 쓴 탭이 이긴다. `settings.changed` 처럼 방송하지 않는다. 옆 탭의 사이드바 폭이 따라 움직이면 방해다.
4. `--read-share` 에서는 임시 디렉터리이므로 저장하지 않는다.

**검증 방법.**
- `test/integration/persistence.test.mjs` — `ui.saveLocalState` 뒤 서버를 껐다 켜면 부트스트랩이 같은 값을 준다. 파일에 절대경로가 없다.
- `test/e2e/shell.e2e.mjs` — 파일을 열고 새로고침하면 같은 파일이 열려 있다. 서버를 다른 포트로 다시 띄워도 사이드바 폭이 같다.
- `test/unit/protocol.test.mjs` 목록.

**완료 기준.** 서버를 다시 띄워도 어제 보던 자리에서 시작한다. `localStorage` 를 더 이상 쓰지 않는다.

**함께 고칠 문서.** `docs/data-and-recovery.md` 파일 목록(`local/ui-state.json`), `docs/terms.md` 기록 열 절("브라우저에 남는다" → "이 기계의 개인 화면 상태에 남는다"), 구현서 14.2·15.1, 용어 표(개인 화면 상태), README, CHANGELOG.

---

### V19. 단축키를 보강하고 Alt 위아래 변경 이동을 실제로 붙인다

**목적.** 문서 줄 버튼의 툴팁과 단축키 도움말이 `Alt+↑ / Alt+↓` 를 약속하는데 전역 처리기는
`Alt+←/→` 만 본다. **문서화된 키가 안 먹는다.** 또 탭 전환·사이드바·기록 열을 여닫는 키가 없어
마우스 없이는 코드 화면과 트레일을 오갈 수 없다 — U16 이 트리 안 이동만 만들었다.

**변경할 파일.**
- `packages/web/src/app/App.tsx` — 전역 keydown 에 `Alt+↑/↓` → `jumpChange`. `Ctrl+Alt+1`~`5` 탭(코드·트레일·분석 기록·설정·진단), `Ctrl+Alt+B` 사이드바, `Ctrl+Alt+N` 기록 열, `Ctrl+Alt+\` 분할 보기(V07).
- `packages/web/src/features/source/CodeView.tsx` — Monaco 안에서도 먹도록 `addAction` 으로 같은 키를 등록한다(Monaco 가 화살표 키를 먼저 삼킬 수 있다).
- `packages/web/src/features/help/ShortcutsHelp.tsx`, README 키 표.

**구현 방법.**
1. `Ctrl+Alt+숫자` 를 고른 이유: `Ctrl+숫자` 는 브라우저 탭 전환, `Alt+숫자` 는 Firefox 탭 전환이다. `Ctrl+Alt+T` 와 같은 조합이라 익히기도 쉽다.
2. 단일 문자 키(`?`, `f` 등)는 그대로 둔다. Monaco 의 숨은 `textarea` 안에서는 입력 중으로 판정되어 먹지 않는 것이 맞다.
3. 기록 열 토글은 지금 탭이 코드면 V16 의 열, 트레일이면 기존 열이다.

**검증 방법.**
- `test/e2e/shell.e2e.mjs` — `Ctrl+Alt+2` 로 트레일 탭, `Ctrl+Alt+B` 로 사이드바 접힘. 변경 목록이 있는 파일에서 `Alt+ArrowDown` 뒤 커서 줄이 다음 hunk 시작이다.

**완료 기준.** 도움말에 적힌 모든 키가 실제로 동작한다. 탭 다섯·사이드바·기록 열을 키로 여닫는다.

**함께 고칠 문서.** README `## 사용법` 키 표, `ShortcutsHelp.tsx`(어디서나 절), CHANGELOG.

---

### V20. 탭 폭 설정을 추가해 두 화면의 표시를 맞춘다

**목적.** 코드 화면은 Monaco `tabSize: 4` 고, 트레일 본문 `.code` 는 `white-space: pre` 에 `tab-size` 가
없어 브라우저 기본값 8 로 그려진다. 탭 들여쓰기를 쓰는 Go·C++ 프로젝트에서 같은 함수가 두 화면에서
다르게 보이고, 폭 맞춤도 8칸 기준으로 재서 글자를 더 줄인다. 탭 폭은 **표시 설정**이다 — 원본 문자열과
컬럼 좌표는 바꾸지 않는다.

**변경할 파일.**
- `packages/shared/src/domain/settings.ts` — `ui.tabSize`(기본 4, 1~16). `defaultSettings`.
- `packages/shared/src/protocol/schemas.ts` — 같은 스키마.
- `packages/web/src/features/settings/SettingsView.tsx` — 화면 카드에 숫자 입력.
- `packages/web/src/app/App.tsx` — `documentElement.style.setProperty('--ct-tab-size', …)`.
- `packages/web/src/styles/trail.css` — `.code { tab-size: var(--ct-tab-size, 4); }`.
- `packages/web/src/features/source/CodeView.tsx` — `editor.updateOptions({ tabSize })` 와 모델 `updateOptions`. `detectIndentation: false` 는 그대로다.

**검증 방법.**
- `test/unit/settings.test.mjs` — 기본값과 범위.
- `test/e2e/trail.e2e.mjs` — 탭으로 시작하는 줄(`\tif (...)`)의 첫 토큰 x 좌표가 공백 4칸 폭과 같다. 설정을 2 로 바꾸면 줄어든다.

**완료 기준.** 두 화면의 탭 폭이 같고 설정 하나로 바뀐다.

**함께 고칠 문서.** README `## 설정` 표, CHANGELOG.

---

### V21. 파일 탐색기가 열린 파일을 펼치고 변경 상태를 보여준다

**목적.** 검색·변경 목록·최근 파일로 연 파일은 트리에서 안 보인다(이미 그려진 줄만 강조). 변경된
파일이 트리에서 구분되지 않아 "이 폴더에 손댄 파일이 있나" 를 변경 목록과 대조해야 한다.

**변경할 파일.**
- `packages/web/src/features/workspace/FileTree.tsx` — `activePath` 가 바뀌면 경로 조각을 위에서부터 `load` 하며 펼치고 `scrollIntoView({ block: 'nearest' })`. `changes` 를 받아 파일 줄에 `.tree-file.changed/added/untracked`, 디렉터리 줄에 점. 머리에 `전부 접기` · `현재 파일 위치`.
- `packages/web/src/app/App.tsx` — `changes` 를 넘긴다.
- `packages/web/src/styles/app.css`.

**구현 방법.**
1. 펼치기는 한 단계씩 순서대로 요청한다. 디렉터리 하나가 `truncated` 면 거기서 멈추고 검색을 권하는 기존 문구를 둔다.
2. 색은 변경 목록의 상태 글자와 같은 뜻이다. 변경 기준(V01)을 따른다.

**검증 방법.**
- `test/e2e/shell.e2e.mjs` — 검색으로 `src/registry.cpp` 를 열면 트리에 그 줄이 보이고 활성이다.

**완료 기준.** 어떤 길로 파일을 열어도 트리가 그 자리를 보여주고, 변경된 파일이 눈에 띈다.

**함께 고칠 문서.** `docs/terms.md` 파일 탐색기 설명, README, CHANGELOG.

---

### V22. 트레일 목록을 관리하는 화면을 만든다

**목적.** 트레일 고르기가 `제목 (노드 수)` 셀렉트뿐이다. 서버는 `createdAt`·`updatedAt` 을 주지만
화면 타입이 버린다. 트레일이 열 개를 넘으면 무엇이 최신인지, 어디에 기록이 달렸는지 모른다.

**변경할 파일.**
- `packages/web/src/features/trail/TrailList.tsx`(새 파일, `TrailBar` 의 셀렉트를 대체) — `.trail-list` 팝오버: 제목·노드·기록 수·마지막 수정, 이름 검색, 정렬(최근·이름), 줄에서 이름 바꾸기·지우기(기존 확인 팝오버).
- `packages/web/src/features/trail/types.ts` — `TrailSummaryView` 에 `createdAt`·`updatedAt`.
- `packages/web/src/app/App.tsx` — 기록 수는 `analyses[].trailIds` 로 합산.

**구현 방법.** 앱 바 자리는 그대로 `트레일 ▾ <제목>` 한 버튼이고 누르면 목록이 뜬다. `＋ 새 트레일` 은 목록 맨 위.

**검증 방법.**
- `test/e2e/shell.e2e.mjs` — 트레일 셋을 만들고 이름으로 거른 뒤 고른다. 마지막 수정이 최근순이다.

**완료 기준.** 트레일이 많아도 찾고 정리한다.

**함께 고칠 문서.** 용어 표(트레일 목록), `docs/terms.md` 앱 바 설명, README `트레일 여러 개` 줄, CHANGELOG.

---

### V23. Markdown 과 정적 HTML 내보내기를 하나로 합친다

**목적.** 툴바 `Markdown` 은 코드만 담고, 분석 화면의 Markdown 은 기록 중심에 코드가 트리 구조 없이
평평하다. 정적 HTML 도 평평한 `<details>` 나열이다. 같은 이름의 내보내기 둘이 다른 문서를 만들고,
어느 쪽도 "트리 + 기록 + 안내 순서" 를 한 문서에 담지 않는다.

**변경할 파일.**
- `packages/shared/src/domain/markdown.ts` — `trailToMarkdown(trail, { annotations?, reviews?, walkthroughs?, mermaid? })` 하나. 깊이 = 제목 수준, 순번, 진입 링크, 노드별 기록을 코드 블록 바로 뒤 인용으로, `확인함` 배지. `mermaid: true` 면 맨 앞에 `flowchart TD` 블록(노드 ID → 이름, 부모 → 자식).
- `packages/server/src/sharing/service.ts` — `markdown()` 의 `포함된 코드` 절이 위를 쓴다. `staticHtml()` 은 `<details>` 를 중첩해 트리를 지키고 순번을 단다.
- `packages/server/src/ws/gateway.ts` — `trail.exportMarkdown` 에 활성 분석 ID(선택)를 실어 기록을 함께 담는다.
- `packages/web/src/features/trail/TrailView.tsx` — 툴바 `Markdown` 이 작은 팝오버로 `기록 포함`·`Mermaid 포함` 을 묻는다.

**구현 방법.**
1. 기록 본문은 그대로 넣되 Markdown 문법을 해석하지 않는다(`plain` 이스케이프 유지). 코드 펜스 길이 규칙(`fenceFor`)은 그대로다.
2. Mermaid 노드 이름은 `"` 로 감싸고 안의 `"` 는 `#quot;` 로 바꾼다. 재귀 노드는 점선 화살표.
3. 정적 HTML 의 CSP·외부 통신 없음은 그대로다. 스크립트를 넣지 않는다.

**검증 방법.**
- `test/unit/markdown.test.mjs` — 기록이 그 노드 아래에만 붙고, Mermaid 블록의 화살표 수가 노드 수 − 루트 수다.
- `test/e2e/share-html.e2e.mjs` — 중첩 `<details>` 가 깊이대로고 순번이 보인다.

**완료 기준.** 어디서 내보내도 같은 형식이고, 한 문서에 흐름·코드·기록·안내 순서가 다 있다.

**함께 고칠 문서.** `docs/share-format.md` Markdown 절, README `공유하기`·툴바 설명, `docs/terms.svg` 툴바(팝오버는 그리지 않는다 — 버튼은 그대로), CHANGELOG.

## 5. 종단 간 인수 시나리오

배포 단위 셋이 모두 끝났을 때 실제 브라우저에서 손으로 확인한다. 각 줄이 실패하면 그 태스크를 다시 연다.

1. 커밋 둘이 있는 저장소를 열고 변경 기준을 `main ← 현재 브랜치` 로 바꾸면 변경 목록·시작하기 카드가 그 범위를 보인다. hunk 를 누르면 그 줄이 열리고 `변경 보기` 왼쪽이 merge-base 다. (V01)
2. 문서 심볼을 누르면 커서만 옮겨 가고, `▶` 를 눌러야 루트가 생긴다. (V06)
3. 노드 헤더의 `경로:줄` 을 누르면 코드 화면의 그 줄이고, 여백에 노드 표식이 있다. `Alt+←` 로 노드로 돌아온다. (V05, V04)
4. `v` 로 노드에 `✓` 를 남기고, hunk 에 `☑` 를 남긴다. 외부 에디터로 그 함수를 고치면 몇 초 안에 둘 다 `재검토` 가 된다. (V02, V03, V17)
5. 코드 화면에서 두 줄을 드래그해 `＋ 기록` 을 누르면 탭이 그대로인 채 오른쪽에 기록 열이 열리고 저장 뒤 여백 표식이 생긴다. (V16, V04)
6. 노드 메뉴에서 `안내 순서에 추가` 를 세 번 하고 `따라 읽기` 로 `다음` 만 눌러 끝까지 읽는다. (V08, V14, V13)
7. 노드 메뉴의 `Markdown 복사` 결과가 그 서브트리와 기록만 담는다. 툴바 `Markdown` 에 `Mermaid 포함` 을 켜면 그림 블록이 앞에 있다. (V08, V23)
8. 서버를 끄고 다른 포트로 다시 띄워도 마지막에 보던 파일·탭·사이드바 폭이 같다. (V18)
9. `Alt+↓` 가 다음 hunk 로 가고, `Ctrl+Alt+2` 가 트레일 탭이다. 1600px 에서 `Ctrl+Alt+\` 로 코드와 트레일을 나란히 본다. (V19, V07)
10. Go 파일의 탭 들여쓰기가 코드 화면과 노드 본문에서 같은 폭이다. (V20)

## 6. 정해진 것

**저장소 주인이 2026-09-19 에 전부 추천대로 정했다.** 아래는 이제 추천이 아니라 결정이고,
다시 물을 일이 생기면 그 근거(오른쪽 칸)부터 뒤집어야 한다.

| 물음 | 결정 | 이유 |
| --- | --- | --- |
| `textDocument/hover` 를 다섯 번째 요청으로 추가할까 | **넣지 않는다** | U 계획의 결정 그대로다. V05(코드 화면으로)·V12(하위 요약)가 "무엇인지 몰라 파고든다" 를 일부 대신한다. T33 관찰 뒤에 다시 본다 |
| 코드 화면에서 식별자를 눌러 노드 없이 정의 파일로만 이동하는 기능을 둘까 | **두지 않는다** | 트레일이 탐색의 단위라는 제품 결정과 어긋난다. 노드를 붙였다 지우는 것(되돌리기 8초)으로 충분하고, V05 가 반대 방향을 이미 준다 |
| 분할 보기의 기본값 | **탭** | 구현서가 탭을 택한 이유가 여전히 맞다. 넓은 화면에서 사용자가 켜는 것이다 |
| 노드 검토 표시의 분모 | **개수만** | 노드 수를 분모로 두면 "펼친 횟수를 이해 완료율로 계산하지 않는다" 에 어긋난다. 분석 화면의 진행률만 검토 기록 수를 분모로 둔다 |
| 개인 화면 상태의 저장 위치 | **`.code-trail/local/ui-state.json`** | `localStorage` 는 origin 이 포트에 묶여 재시작을 못 견딘다. 포트를 고정하는 대안은 같은 기계의 두 프로젝트가 충돌한다 |
| 자동 앵커 재확인의 이력 표기 | **`actorId: 'system'` 으로 남긴다** | 재확인이 언제 돌았는지 모르면 "누가 상태를 바꿨나" 를 답할 수 없다. 재연결은 여전히 사람의 항목이다 |
| 루트의 `working_log.md` | **지웠다. 앞으로 쓰지 않는다** | 커밋 `8f6685c` 에 이은 주인의 결정이다. 무엇을 왜 바꿨는지는 커밋 메시지와 `CHANGELOG.md`, 그리고 이런 계획 문서가 이미 담는다 — 같은 내용을 네 번째 자리에 또 적으면 어느 것이 정본인지 알 수 없다. 새 세션이 다시 만들지 않도록 `CLAUDE.md`·`AGENTS.md` 와 `.gitignore` 에 적어 뒀다 |

## 7. 이 문서가 다루지 않는 것

- **새 LSP 요청.** `hover`·`references`·`callHierarchy`·`workspace/symbol` 을 추가하지 않는다. "이 함수를 누가 부르나" 는 여전히 비목표다 — 참조에는 호출부가 섞이고, 네 언어를 한 계층으로 지탱하는 근거가 흔들린다.
- **`git blame`.** 셸 없는 git 호출이라 기술적으로는 V01 위에 얹을 수 있지만, 리뷰의 핵심 동선(변경 → 흐름 → 기록 → 전달)에 필요하지 않고 화면에 커밋 메타데이터를 늘린다. 실제 사용자 관찰(T33)에서 "누가 언제" 가 반복되면 그때 본다.
- 실제 언어 서버 다섯 개와 macOS·Linux 에서의 확인(T02·T23·T37, 구현서 0.13·0.14). 이 기계에 없다.
- 실제 참여자 사용성 평가(T33·T40, [`usability-evaluation.md`](usability-evaluation.md)). 이 문서의 태스크가 끝나면 그 평가의 과제 1~6 에 "변경 기준 고르기 → hunk 검토 → 안내 순서 따라 읽기" 를 더해 그대로 쓴다.
- npm 배포. 되돌릴 수 없어 저장소 주인이 정한다.
- 원격 서버·다중 사용자 동시 편집. 구현서 3.2 비목표 그대로다. V18 의 개인 상태도 이 기계의 이 사람 것이다.
- 트리 가상화. [`perf-1000-nodes.md`](perf-1000-nodes.md) 의 판단을 유지한다. V04·V12 로 노드가 무거워지면 그 문서의 측정을 다시 돌려 확인한다.
- 화면 문구의 다국어. 사람에게 보이는 글은 한글이라는 규칙 그대로다.

## 8. 채택하면 함께 고칠 것

1.7.0 에서 그렇게 바꿨다. `CLAUDE.md`·`AGENTS.md` 의 `## 지금 무엇을 하고 있나` 가 이 문서와 0장의 V01~V23 을
가리켰고, 1.8.0 부터는 남은 검증의 정본이 `docs/compatibility.md` 다.
