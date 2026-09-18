# Code Trail 코드 리뷰·분석 도구 사용성 개선 계획

작성 기준: 2026-09-17 KST, 커밋 `6e1df5f`(버전 1.1.0). 저장소의 실제 코드와 문서만 근거로 삼았다.
실제 언어 서버(clangd·gopls·rust-analyzer·roslyn·typescript-language-server)가 이 기계에 없어
언어 서버 응답 자체의 정확도는 평가하지 않았다. 그것은 [`code-understanding-and-sharing-plan.md`](code-understanding-and-sharing-plan.md)
의 T02·T23·T37 이 그대로 맡는다.

이 문서는 "코드 리뷰와 분석을 목적으로 하는 도구" 로서 **지금 구현에서 부족한 것**과
**무엇을 어떻게 만들지**를 태스크 단위로 적는다. 사용 편의성(UX)을 첫째 기준으로 삼았다.

## 0. 태스크 목록

한 태스크를 끝낼 때마다 즉시 그 줄을 `- [x]` 로 바꾸고 완료 일시(KST, 시스템 명령으로 확인)를
덧붙인다. 여러 개를 몰아서 체크하지 않는다. 각 항목은 본문의 상세 절로 링크한다.

**U01~U20 이 모두 끝났다** (1.2.0 · 1.3.0 · 1.4.0). 구현하면서 계획과 달라진 판단은
아래 [7.1 계획과 달라진 것](#71-계획과-달라진-것) 에 모아 두었다. 남은 것은 이 기계에서
할 수 없는 확인뿐이다 — 7장을 본다.

### A. 탐색 흐름의 마찰 제거

- [x] [U01. 언어 서버 상태를 화면에 항상 보여주고 오류를 다음 행동으로 잇는다](#u01-언어-서버-상태를-화면에-항상-보여주고-오류를-다음-행동으로-잇는다) — P0 — 완료 2026-09-18 12:51 KST
- [x] [U02. 알림 채널을 하나로 합치고 닫기·행동 버튼을 붙인다](#u02-알림-채널을-하나로-합치고-닫기행동-버튼을-붙인다) — P0 — 완료 2026-09-18 12:51 KST
- [x] [U03. 지우기·트레일 삭제에 확인을, 노드 삭제에 되돌리기를 붙인다](#u03-지우기트레일-삭제에-확인을-노드-삭제에-되돌리기를-붙인다) — P0 — 완료 2026-09-18 12:51 KST
- [x] [U04. 본문 드래그가 탭을 바꾸지 않게 하고 선택 위에 행동 칩을 띄운다](#u04-본문-드래그가-탭을-바꾸지-않게-하고-선택-위에-행동-칩을-띄운다) — P0 — 완료 2026-09-18 12:51 KST
- [x] [U05. 트레일이 없어도 `Ctrl+Alt+T` 한 번으로 루트를 만든다](#u05-트레일이-없어도-ctrlaltt-한-번으로-루트를-만든다) — P1 — 완료 2026-09-18 12:51 KST
- [x] [U06. 활성 노드로 화면을 이동시키고 잠깐 강조한다](#u06-활성-노드로-화면을-이동시키고-잠깐-강조한다) — P1 — 완료 2026-09-18 12:51 KST
- [x] [U07. 코드 화면에서 마우스로도 트레일을 시작한다](#u07-코드-화면에서-마우스로도-트레일을-시작한다) — P1 — 완료 2026-09-18 12:51 KST
- [x] [U08. 파일이 바뀌면 노드에 `바뀜` 배지를 달고 다시 읽기를 제공한다](#u08-파일이-바뀌면-노드에-바뀜-배지를-달고-다시-읽기를-제공한다) — P1 — 완료 2026-09-18 12:51 KST
- [x] [U09. 정의·구현 후보를 클릭한 지점 옆에서 고른다](#u09-정의구현-후보를-클릭한-지점-옆에서-고른다) — P1 — 완료 2026-09-18 12:51 KST

### B. 기록을 코드 옆에 붙이기

- [x] [U10. 트레일 노드에 기록 수 배지와 줄 표시를 붙인다](#u10-트레일-노드에-기록-수-배지와-줄-표시를-붙인다) — P0 — 완료 2026-09-18 12:51 KST
- [x] [U11. 첫 기록 때 분석을 자동으로 만들고 트레일과 연결한다](#u11-첫-기록-때-분석을-자동으로-만들고-트레일과-연결한다) — P0 — 완료 2026-09-18 12:51 KST
- [x] [U12. 트레일 패널 옆에 접이식 기록 열을 둔다](#u12-트레일-패널-옆에-접이식-기록-열을-둔다) — P1 — 완료 2026-09-18 12:51 KST
- [x] [U13. `window.prompt` 편집을 인라인 편집으로 바꾸고 기록에서 코드로 바로 간다](#u13-windowprompt-편집을-인라인-편집으로-바꾸고-기록에서-코드로-바로-간다) — P1 — 완료 2026-09-18 12:51 KST
- [x] [U14. 변경 목록을 hunk 단위로 펼치고 코드 화면에 변경 표시와 변경 보기를 넣는다](#u14-변경-목록을-hunk-단위로-펼치고-코드-화면에-변경-표시와-변경-보기를-넣는다) — P1 — 완료 2026-09-18 12:51 KST

### C. 화면 구성과 조작

- [x] [U15. 설정 화면을 만들고 Monaco 테마를 앱 테마에 맞춘다](#u15-설정-화면을-만들고-monaco-테마를-앱-테마에-맞춘다) — P1 — 완료 2026-09-18 12:51 KST
- [x] [U16. 키보드로 트리를 다니고 단축키 도움말을 띄운다](#u16-키보드로-트리를-다니고-단축키-도움말을-띄운다) — P1 — 완료 2026-09-18 12:51 KST
- [x] [U17. 형제 정렬 설정을 실제로 반영하고 트레일에 저장한다](#u17-형제-정렬-설정을-실제로-반영하고-트레일에-저장한다) — P2 — 완료 2026-09-18 12:51 KST
- [x] [U18. 사이드바 폭을 끌어 조절하고 접는다](#u18-사이드바-폭을-끌어-조절하고-접는다) — P2 — 완료 2026-09-18 12:51 KST

### D. 첫 사용 경험

- [x] [U19. 빈 코드 화면을 시작하기 카드로 바꾸고 탭 순서와 저장 상태를 정리한다](#u19-빈-코드-화면을-시작하기-카드로-바꾸고-탭-순서와-저장-상태를-정리한다) — P1 — 완료 2026-09-18 12:51 KST

### E. 문서 정합

- [x] [U20. `CLAUDE.md`·`AGENTS.md`·README 의 용어·구조를 1.1.0 구조에 맞춘다](#u20-claudemdagentsmdreadme-의-용어구조를-110-구조에-맞춘다) — P2 — 완료 2026-09-18 12:51 KST

## 1. 현재 구현 평가

### 1.1 그대로 지킬 강점

- **정본이 서버에 있고 화면은 이벤트로만 바뀐다.** 여러 탭 동기화, 재시작 복원, revision 충돌 처리가 한 구조에서 나온다. 이 문서의 어떤 태스크도 낙관적 갱신을 넣지 않는다.
- **심볼 해석은 LSP 네 요청뿐이다.** 언어별 분기가 어댑터에만 있다. 이 문서는 새 LSP 요청을 추가하지 않는다(hover 는 6장에서 "결정 보류" 로 남긴다).
- **경계가 분명하다.** 불투명한 `documentId`, 셸 없는 자식 프로세스, 오류에 절대경로·토큰 없음. 새 API(U14 의 hunk·원본 조회)도 같은 경계를 지난다.
- **트리 구조 규칙이 단순하다.** "클릭한 코드가 속한 노드가 부모" 하나뿐이라 새 UI 를 얹어도 설명이 안 늘어난다.
- **테스트 층이 갖춰져 있다.** 단위 148 · 통합 110 · E2E · pack · install. 각 태스크의 검증은 이 층에 한 줄씩 더하는 방식으로 적었다.

### 1.2 부족한 것 — 근거와 함께

| 간극 | 근거 (파일:줄) | 사용자에게 생기는 일 | 태스크 |
| --- | --- | --- | --- |
| 언어 서버 상태가 앱 바·코드 화면 어디에도 없다. 정의 실패 메시지가 언어·상태를 안 알려준다 | `ws/gateway.ts:433` "정의를 찾지 못했다. 해당 언어의 언어 서버가 켜져 있는지 확인한다.", `app/App.tsx` 앱 바에 연결 상태만 표시 | 저장소 주인이 적어 준 실제 불만 그대로다 — C# 에서 정의를 못 찾는데 왜인지 모른다 | U01 |
| 오류 표시가 두 갈래고 닫을 수 없다 | `App.tsx` `error` → `.panel-error`(닫기 없음, 다음 파일 열기까지 남음), `useTrail.ts` `notice` → `.toast`. `App.tsx` 의 `onEvent` 가 `command.error` 를 먼저 먹고 `return` 하므로 `useTrail` 의 같은 분기는 죽은 코드다 | 지난 오류가 화면 아래 계속 남고, 새 오류가 덮어쓴다 | U02 |
| 되돌릴 수 없는 삭제에 확인도 실행 취소도 없다 | `TrailView.tsx` `지우기` → `commands.clear` 직행, `TrailBar.tsx` `✕ 트레일` → `commands.deleteTrail` 직행, `TrailNode.tsx` `✕` → 하위까지 삭제. `window.confirm` 사용처 0 | 한 번 잘못 누르면 수십 노드가 사라진다 | U03 |
| 본문에서 글자를 드래그하면 분석 기록 탭으로 튕긴다 | `CodeBody.tsx` `onMouseUp` → `onRangeSelect` → `App.tsx` `setPane('analysis')` | 코드 한 줄을 복사하려 해도 탭이 바뀐다 | U04 |
| 트레일이 없으면 `Ctrl+Alt+T` 를 두 번 눌러야 한다 | `App.tsx` `addRootHere`: 트레일 생성 후 "한 번 더 누른다" | 첫 사용에서 가장 먼저 만나는 마찰이다 | U05 |
| 이미 펼친 노드를 다시 클릭하면 활성만 바뀌고 화면이 안 움직인다 | `gateway.ts` `'existing'` → `trail.activeNodeChanged` 만 방송, `TrailView.tsx` 는 `jumpToOrigin` 에서만 `scrollIntoView` | 어디로 갔는지 찾아 스크롤해야 한다 | U06 |
| 코드 화면에서 트레일을 시작하는 수단이 단축키 하나다 | `CodeView.tsx` 는 커서 위치만 기록. 우클릭 메뉴·버튼 없음 | 단축키를 모르면 시작을 못 한다 | U07 |
| 파일이 바뀌어도 트레일 노드는 옛 코드를 조용히 보여준다 | `App.tsx` 는 열린 문서만 `staleDocument`. `TrailNode.tsx` 에 `contentHash` 비교 없음 | 옛 좌표로 정의를 물어 엉뚱한 곳으로 간다 | U08 |
| 정의 후보 대화상자가 트리 맨 위에 뜨고 무엇을 클릭했는지 안 보인다. 구현이 여럿이면 토스트로 `⚑` 를 누르라고만 한다 | `TrailView.tsx` `.choice` 위치, `useTrail.ts` `trail.implementationChoice` | 저장소 주인의 세 번째 질문 — "왜 깃발을 또 눌러야 하나" | U09 |
| 트레일 패널에 기록 존재 표시가 전혀 없다 | `TrailNode.tsx` 헤더 배지는 `재귀·선언만·근사` 뿐. 목업(`code-understanding-and-sharing-mockup.png`)의 `+ 기록`·개수·검토 상태가 구현에 없다 | 어느 함수에 우려가 달려 있는지 트리에서 알 수 없다 | U10 |
| 분석을 먼저 만들어야 기록할 수 있다 | `AnalysisPanel.tsx` `analysis === null` 이면 작성 폼만 보인다 | 트레일 만들기 → 분석 만들기 → 대상 고르기 → 쓰기, 네 단계다 | U11 |
| 기록이 별도 탭이라 코드와 기록 사이를 계속 오간다 | `App.tsx` 탭 넷 중 `analysis` 만 기록을 그린다 | 노드 하나에 기록을 달 때마다 왕복한다 | U12 |
| 기록·목표 수정에 `window.prompt` 를 쓴다. 기록에서 코드로 가는 링크가 없다 | `AnalysisPanel.tsx:271, 308, 395`, 기록 헤더는 "코드 범위" 라는 글자만 | 여러 줄 기록이 한 줄 입력창에서 깨진다 | U13 |
| 변경 목록이 파일 단위다. 코드 화면에 변경 표시·diff 가 없다 | `git/service.ts` 는 `--name-status`·`--numstat` 만, `ReadingStarts.tsx` 는 파일 첫 줄로 연다 | "바뀐 곳만 보기" 가 안 된다. 리뷰 도구의 핵심 동선이다 | U14 |
| 설정을 바꾸려면 JSON 파일을 열어야 한다. 밝은 테마에서도 코드 화면은 어둡다 | `ui.*` 10개 중 UI 편집 가능 0개, `CodeView.tsx` `theme: 'vs-dark'` 고정 (`docs/baseline/standalone-shell.png` 참고) | 테마·글자 크기 하나 바꾸려고 파일을 연다 | U15 |
| 키보드로 트리를 다닐 수 없다 | `TrailNode.tsx` `.hd` 는 `div` + `onClick`, `tabIndex` 없음. `aria-label` 은 웹 전체 13곳 | 마우스 없이는 한 노드도 못 연다 | U16 |
| `ui.childOrder` 설정이 무시된다 | `TrailView.tsx` `useState<'source' \| 'click'>('source')` | README 가 약속한 설정이 안 먹는다 | U17 |
| 사이드바가 280px 고정이고 접을 수 없다 | `app.css` `.sidebar { width: 280px }` | 좁은 화면에서 트리 자리가 모자란다 | U18 |
| 첫 화면이 빈 코드 화면이고 준비 상태를 알려주지 않는다. 탭 순서가 `분석 기록 · 코드 · 트레일 · 진단` 이다 | `App.tsx` `renderCodePane` placeholder, `pane-tabs` 순서 | 진단 탭을 찾아 들어가야 시작 가능 여부를 안다 | U19 |
| `CLAUDE.md` 용어 표에 1.1.0 부위 셋이 없고, 구조 목록에 `analysis·sharing·git·ai` 모듈이 없다 | `CLAUDE.md` 와 `AGENTS.md` 의 `## 용어` diff 3줄, 양쪽 `## 구조` 에 `server/src/analysis/` 등 부재 | 다음 작업자가 없는 모듈을 다시 만든다 | U20 |

### 1.3 우선순위 원칙

P0 는 **지금 사용자가 실제로 막히거나 데이터를 잃는 것**이다(U01~U04, U10, U11).
P1 은 리뷰 동선을 짧게 만드는 것, P2 는 있으면 좋은 것이다.
기능 수를 늘리기보다 "첫 루트 → 첫 기록 → 바뀐 곳 확인" 이 끊기지 않게 하는 데 집중한다.

## 2. 권장 배포 단위

| 배포 | 태스크 | 목표 |
| --- | --- | --- |
| 1.2.0 — 막힘 제거 | U01 U02 U03 U04 U05 U06 U10 U11 U20 | 정의 실패 원인을 화면에서 알 수 있고, 실수로 지우지 않고, 기록이 트리에 보인다 |
| 1.3.0 — 리뷰 연결 | U07 U08 U09 U12 U13 U14 | 바뀐 곳에서 시작해 코드 옆에서 기록하고, 옛 코드를 구분한다 |
| 1.4.0 — 조작·설정·첫 경험 | U15 U16 U17 U18 U19 | 마우스 없이 다니고, 파일 없이 설정하고, 첫 화면에서 준비 상태를 본다 |

각 배포는 `CHANGELOG.md` 항목과 네 `package.json` 의 `version` 을 함께 올린다(`CLAUDE.md` `바꾸면 같이 고칠 것`).

## 3. 새로 정하는 용어

이 문서의 태스크가 만드는 화면 부위다. 구현 시 `CLAUDE.md`·`AGENTS.md` 의 `## 용어` 표에 그대로 옮기고,
트레일 패널 안에 생기는 것은 `docs/terms.svg` 에도 그린다.

| 용어 | 코드 / DOM | 뜻 | 태스크 |
| --- | --- | --- | --- |
| **서버 상태 표시** | `LspStatus`, `.lsp-status` | 앱 바와 코드 화면 문서 줄에 붙는 현재 문서 언어의 언어 서버 상태. 누르면 진단 화면의 그 언어 카드로 간다 | U01 |
| **알림** | `Notices`, `.notices`, `.notice` | 화면 오른쪽 아래에 쌓이는 메시지. 수준(info/warn/error)과 행동 버튼을 가진다. "토스트", "패널 오류" 를 대체한다 | U02 |
| **선택 칩** | `SelectionChip`, `.selection-chip` | 본문이나 코드 화면에서 글자를 드래그하면 선택 끝에 뜨는 작은 버튼 묶음(`＋ 기록` · `AI 초안` · `복사`) | U04 |
| **후보 팝오버** | `ChoicePopover`, `.choice` | 정의·구현 후보를 클릭한 식별자 바로 아래에서 고르는 창. 기존 `.choice` 의 자리를 옮긴 것 | U09 |
| **기록 표시** | `.badge.notes`, `.cl.noted` | 노드 헤더의 `✎ N` 배지와 본문 줄 왼쪽의 색 띠. 그 노드·줄에 분석 기록이 있다는 뜻 | U10 |
| **기록 열** | `AnnotationColumn`, `.annotation-column` | 트레일 패널 오른쪽의 접이식 세로 영역. 활성 노드의 기록 목록과 작성 칸이 있다 | U12 |
| **변경 보기** | `.code-view.diff` | 코드 화면을 `HEAD` 대비 좌우 비교로 바꾼 상태. 읽기 전용 Monaco DiffEditor | U14 |
| **설정 화면** | `SettingsView`, `#settings` | `ui.*`·언어 사용 여부·작성자·AI 설정을 편집하는 탭 | U15 |
| **단축키 도움말** | `ShortcutsHelp`, `.shortcuts` | `?` 로 띄우는 키 목록 오버레이 | U16 |
| **시작하기 카드** | `StartCard`, `.start-card` | 파일을 열기 전 코드 화면 자리에 보이는 준비 상태·시작 방법 안내 | U19 |

배지 표에 `바뀜`(U08)이 추가된다.

## 4. 상세 태스크

각 절은 목적 · 변경할 파일 · 구현 방법 · 검증 방법 · 완료 기준 · 함께 고칠 문서 순이다.
새 명령·이벤트는 반드시 `packages/shared/src/protocol/` 의 스키마와 `test/unit/protocol.test.mjs` 의 목록에 같이 넣는다.

---

### U01. 언어 서버 상태를 화면에 항상 보여주고 오류를 다음 행동으로 잇는다

**목적.** 정의를 못 찾았을 때 "언어 서버 때문인지, 서버가 뜨는 중인지, 이 파일 형식은 원래 안 되는지, C# 솔루션을 안 골라서인지" 를
화면에서 바로 알 수 있게 한다. 저장소 주인이 적어 준 첫 불만이 이것이다.

**변경할 파일.**

- `packages/shared/src/protocol/events.ts` (또는 `schemas.ts` 의 `commandErrorSchema`) — `CommandError` 에 선택 필드 `context` 추가
- `packages/server/src/trails/resolveFlow.ts` — `toCommandError`, `resolveFromNode`, `addRootAt`
- `packages/server/src/ws/gateway.ts` — `runResolve` 의 `'none'` 분기, `resolveImplementations` 의 `'none'` 분기
- `packages/server/src/lsp/manager.ts` — 언어별 상태 조회 함수 노출(이미 `/api/diagnostics` 가 쓰는 항목을 재사용)
- `packages/server/src/http/routes.ts` — `/api/workspace/open` 응답에 `supportedLanguage: 'cpp' | 'csharp' | 'go' | 'rust' | 'typescript' | null` 추가
- `packages/web/src/api/http.ts` — `DocumentContent.supportedLanguage`
- `packages/web/src/features/diagnostics/LspStatus.tsx` (신규) — 상태 표시 컴포넌트
- `packages/web/src/app/App.tsx` — 앱 바·문서 줄에 `LspStatus` 배치, `addRootHere` 의 사전 검사, `onIdentifierClick` 의 사전 검사
- `packages/web/src/styles/app.css` — `.lsp-status` 상태별 색과 점

**구현 방법.**

1. `CommandError` 에 다음을 더한다. 전부 선택이라 기존 이벤트와 호환된다.

   ```ts
   context?: {
       language?: 'cpp' | 'csharp' | 'go' | 'rust' | 'typescript';
       lspState?: 'notStarted' | 'starting' | 'ready' | 'failed' | 'stopped';
       verified?: boolean;
       /** 화면이 붙일 버튼. */
       action?: 'openDiagnostics' | 'retry' | 'chooseSolution' | 'verify';
   }
   ```

2. `ResolveFlow` 는 `grant.languageId` 로 언어를 알고, `LspManager` 에서 그 언어의 `state`·`verified`·`lastError` 를 읽어 `context` 를 채운다.
   `'none'` 결과의 메시지를 상태별로 나눈다.
   - `ready` 이고 `verified` — "언어 서버가 정의를 돌려주지 않았다. 헤더 파일이나 생성 코드일 수 있다." (`action: 'retry'` 없음)
   - `ready` 이고 미확인 — "언어 서버는 떠 있지만 아직 실제 요청으로 확인하지 않았다." (`action: 'verify'`)
   - `starting` — "언어 서버가 뜨는 중이다. 큰 프로젝트는 첫 요청까지 수십 초 걸린다." (`action: 'retry'`)
   - `failed`·`stopped` — `lastError` 한 줄 + (`action: 'openDiagnostics'`)
   - C# 이고 어댑터 점검에 "솔루션 후보 N개" 가 있으며 `solutionPath === null` — "C# 솔루션을 고르지 않았다. 진단 화면에서 고른다." (`action: 'chooseSolution'`, 진단 화면의 `csharp` 카드로 스크롤)
   `LSP_TIMEOUT`·`LSP_UNAVAILABLE` 도 같은 `context` 를 싣는다.
3. 웹은 `command.error` 를 U02 의 알림으로 보내고, `context.action` 에 따라 버튼을 붙인다. `openDiagnostics`·`chooseSolution` 은 `setPane('diagnostics')` 뒤 `[data-language=...]` 카드로 `scrollIntoView`. `retry` 는 마지막 해석 명령을 다시 보낸다(명령 객체를 `lastResolveRef` 에 들고 있는다).
4. `supportedLanguage === null` 인 문서에서 `Ctrl+Alt+T` 를 누르면 서버에 보내지 않고 즉시 알림 "이 파일 형식(`.py`)은 심볼 해석을 지원하지 않는다. 지원 언어: C/C++·C#·Go·Rust·TypeScript". 코드 화면 문서 줄에도 `심볼 해석 없음` 회색 표시.
5. `LspStatus` 컴포넌트: `App` 이 이미 들고 있는 `diagnostics` 배열에서 현재 문서 언어 항목을 찾아 그린다. 상태 → 표시:
   `notStarted` "안 뜸" · `starting` "뜨는 중"(점 깜빡임, `prefers-reduced-motion` 이면 정지) · `ready`+미확인 "실행 중 · 확인 전" · `ready`+`verified` "지원됨" · `failed` "실패". 클릭하면 진단 화면의 해당 카드로 간다.
   앱 바에는 현재 문서 언어 하나만, 문서가 없으면 숨긴다. `lsp.stateChanged` 이벤트가 오면 `refreshDiagnostics` 가 이미 돌므로 추가 폴링은 없다.
6. 노드의 `…` 배지(`busy`)에 `title` 로 "언어 서버 응답 대기 중 (뜨는 중)" 처럼 상태를 함께 적는다.

**검증 방법.**

- 단위 `test/unit/protocol.test.mjs`: `command.error` 가 `context` 없이도, 있어도 통과한다.
- 통합 `test/integration/lsp.test.mjs`: 가짜 서버가 `definition` 에 `null` 을 주는 시나리오에서 오류 `context.language === 'cpp'`, `lspState === 'ready'`. 시작 직후 죽는 시나리오에서 `lspState === 'failed'`, `action === 'openDiagnostics'`.
- 통합 `test/integration/adapters.test.mjs`: 솔루션 후보 둘인 C# 프로젝트에서 `action === 'chooseSolution'`.
- E2E `test/e2e/trail.e2e.mjs`: `.lsp-status` 텍스트가 "실행 중 · 확인 전" → `✓ 확인` 뒤 "지원됨". `.py` 파일에서 `Ctrl+Alt+T` → 알림 한 줄, 서버 명령 0건(가짜 서버 로그로 확인).
- `npm run typecheck`, `npm test`.

**완료 기준.** 정의 실패 알림이 언어·상태·다음 행동 버튼을 갖고, 앱 바에 현재 문서 언어의 서버 상태가 보이며, 지원하지 않는 파일에서는 서버 왕복 없이 안내가 뜬다.

**함께 고칠 문서.** `## 용어` 표에 "서버 상태 표시", README `## 동작 방식`(진단 탭 설명 옆 한 줄), `CHANGELOG.md`, `test/fake-lsp/server.mjs` 시나리오 목록.

---

### U02. 알림 채널을 하나로 합치고 닫기·행동 버튼을 붙인다

**목적.** 오류·안내가 한 자리에서 같은 모양으로 나오고, 사용자가 닫을 수 있고, 필요한 다음 행동이 버튼으로 붙게 한다.

**변경할 파일.**

- `packages/web/src/features/notices/Notices.tsx`, `useNotices.ts` (신규)
- `packages/web/src/app/App.tsx` — `error` 상태·`.panel-error`·`editorFallback` 제거, `onEvent` 의 `command.error` 처리
- `packages/web/src/features/trail/useTrail.ts` — `notice` 상태 제거(죽은 `command.error` 분기 포함), `trail.implementationChoice`·`trail.exportReady` 는 알림 API 호출로 대체
- `packages/web/src/features/diagnostics/DiagnosticsView.tsx` — `.diag-notice` 를 알림으로
- `packages/web/src/styles/app.css`, `trail.css` — `.toast`, `.panel-error`, `.editor-fallback`, `.diag-notice` 삭제, `.notices` 추가

**구현 방법.**

1. `useNotices()` 가 `{ notices, push, dismiss }` 를 준다. 항목은 `{ id, level: 'info'|'warn'|'error', message, actions?: Array<{ label, run }>, sticky }`.
   `info` 6초, `warn` 10초 뒤 자동으로 사라지고 `error` 는 닫을 때까지 남는다. 마우스를 올리면 타이머가 멈춘다. 최대 3개, 넘치면 가장 오래된 것부터 뺀다.
2. `Notices` 는 오른쪽 아래에 세로로 쌓는다. `role="status"`(`info`/`warn`) 와 `role="alert"`(`error`) 를 나눈다. `Esc` 는 가장 최근 것을 닫는다. 각 항목에 `×` 버튼.
3. `App` 은 `command.error` 를 받으면 `push({ level, message, actions })` 한다. `actions` 는 U01 의 `context.action` 으로 만든다. `retryable` 이면 `warn`, 아니면 `error`.
4. 외부 에디터 실패(`editor.opened` 의 `launched === false`)는 행동 둘 — "경로·줄 복사", "에디터 정하기" — 를 가진 `error` 알림이 된다. 기존 `.editor-fallback` 의 문구를 그대로 옮긴다.
5. `useTrail` 은 이벤트 → 상태만 담당하고 알림은 `App` 이 붙인다. `trail.implementationChoice` 는 U09 에서 팝오버로 바뀌므로 그때까지만 알림으로 둔다.
6. 서버 연결이 끊기면(`connection === 'closed'`) sticky `error` 알림 "서버와 연결이 끊겼다. 터미널의 code-trail 이 살아 있는지 본다." 를 하나만 띄우고 재연결되면 지운다.

**검증 방법.**

- E2E `test/e2e/trail.e2e.mjs`: 정의 실패 → `.notice.notice-warn` 한 개, 버튼 클릭으로 진단 탭 이동, `×` 로 닫힘. `.panel-error` 와 `.toast` 가 DOM 에 없다.
- E2E `test/e2e/shell.e2e.mjs`: 서버를 끄면 sticky 알림, 다시 켜면 사라진다(재연결 로직이 이미 있으면 그 경로로).
- 단위 테스트는 두지 않는다. 타이머·큐는 E2E 가 실제 브라우저에서 확인한다.

**완료 기준.** 웹 코드에 오류 표시 경로가 `Notices` 하나뿐이고(`grep -rn "setError\|panel-error\|toast" packages/web/src` 결과 0), 모든 알림을 닫을 수 있다.

**함께 고칠 문서.** `## 용어` 표에 "알림", `CHANGELOG.md`.

---

### U03. 지우기·트레일 삭제에 확인을, 노드 삭제에 되돌리기를 붙인다

**목적.** 한 번의 오클릭으로 탐색 결과를 잃지 않게 한다. 큰 삭제는 확인으로, 잦은 삭제(노드)는 되돌리기로 막는다. 확인 대화상자를 노드 삭제마다 띄우면 리뷰 흐름이 끊기므로 둘을 구분한다.

**변경할 파일.**

- `packages/shared/src/domain/trail.ts` — `remove(id)` 가 떼어낸 서브트리를 돌려주도록, `insertSubtree(parentId, nodes, index)` 추가
- `packages/shared/src/domain/storage.ts` — 변경 없음(되돌리기 버퍼는 저장하지 않는다)
- `packages/shared/src/protocol/commands.ts` — `trail.undoRemove` (구조 명령, payload `{ nodeId }`), `STRUCTURE_COMMAND_TYPES` 에 추가
- `packages/server/src/trails/service.ts` — `lastRemoved: Map<trailId, { rootNodeId, parentId, index, nodes, nodeUi, expiresAt }>` (한 단계, 60초)
- `packages/server/src/ws/gateway.ts` — `trail.removeNode` 처리 뒤 버퍼 저장, `trail.undoRemove` 처리 → `trail.snapshot` 방송
- `packages/web/src/api/commands.ts` — `undoRemove`
- `packages/web/src/features/trail/ConfirmPopover.tsx` (신규) — `.choice` 와 같은 스타일의 인라인 확인
- `packages/web/src/features/trail/TrailView.tsx` — `지우기` 확인
- `packages/web/src/features/trail/TrailBar.tsx` — `✕ 트레일` 확인
- `packages/web/src/app/App.tsx` — `trail.nodeRemoved` 수신 시 되돌리기 알림

**구현 방법.**

1. `Trail.remove` 는 지금 `boolean` 을 준다. 떼어낸 노드들을 `walk()` 순서로 모은 배열과 부모 안에서의 형제 인덱스를 함께 돌려준다. 재귀 배지 계산은 기존 `promoteToRoot` 가 쓰는 것을 `insertSubtree` 에서 재사용한다(조상이 같으니 원래 값 그대로다).
2. `TrailService` 는 `mutate` 로 삭제한 직후 그 결과를 `lastRemoved` 에 넣는다. 다음 구조 명령이 오면(어떤 것이든) 버퍼를 비운다 — 그 사이에 트리가 바뀌면 원래 자리에 되돌릴 수 없기 때문이다. 60초가 지나도 비운다.
3. `trail.undoRemove` 는 `baseRevision` 을 검사하고, 버퍼의 `parentId` 가 아직 있으면 `insertSubtree` 로 같은 ID·같은 `origin`·같은 `nodeUi` 를 되살린다. 부모가 없어졌으면 `NOT_FOUND` "되돌릴 자리가 없어졌다". 결과는 `trail.snapshot` 으로 보낸다(큰 변화는 snapshot 을 쓰는 기존 관례).
4. 웹: `trail.nodeRemoved` 를 받으면 알림 "『Find』와 하위 2개를 지웠다" + 행동 "되돌리기"(8초). 다른 탭에서 지운 것에도 뜬다 — 정본이 서버라 되돌리기도 서버가 한다.
5. `지우기` 와 `✕ 트레일` 은 `ConfirmPopover` 를 버튼 바로 아래에 띄운다. 문구는 개수를 포함한다: "노드 12개를 지운다. 되돌릴 수 없다." / "트레일 『로그인 검토』(노드 12개)를 지운다. 이 트레일을 대상으로 한 분석 기록 3개는 남지만 트레일 대상 링크는 끊긴다." `Enter` 확정, `Esc` 취소, 첫 포커스는 취소 버튼.
6. U16 이 들어오면 `Delete` 키도 같은 경로를 탄다.

**검증 방법.**

- 단위 `test/unit/trail.test.mjs`: `remove` → `insertSubtree` 왕복 뒤 `walk()` 결과(ID·부모·origin·형제 순서·collapsed)가 같다. 부모가 사라진 뒤 `insertSubtree` 는 `undefined`.
- 단위 `test/unit/protocol.test.mjs`: 명령 목록에 `trail.undoRemove`.
- 통합 `test/integration/websocket.test.mjs`: 삭제 → 되돌리기 → snapshot 이 원래와 같다. 삭제 → 다른 구조 명령 → 되돌리기는 `NOT_FOUND`. 삭제 → 61초(테스트에서는 옵션으로 줄임) → `NOT_FOUND`.
- E2E: `지우기` 클릭 → 확인 팝오버 → `Esc` 로 취소되면 노드 수 그대로. 노드 `✕` → 알림의 "되돌리기" → 노드 복귀.

**완료 기준.** 지우기·트레일 삭제는 확인 없이 실행되지 않고, 노드 삭제는 8초 안에 되돌릴 수 있으며 되돌린 노드의 ID·순번·진입 링크가 그대로다.

**함께 고칠 문서.** README `## 사용법` 의 "노드 삭제" 줄에 되돌리기 언급, 구현서 14.2 명령 표, `CHANGELOG.md`.

---

### U04. 본문 드래그가 탭을 바꾸지 않게 하고 선택 위에 행동 칩을 띄운다

**목적.** 코드를 복사하려고 드래그해도 화면이 그대로 있고, 기록을 남기고 싶을 때만 한 번 더 눌러 가게 한다.

**변경할 파일.**

- `packages/web/src/features/trail/CodeBody.tsx` — `onMouseUp` 은 범위만 알린다
- `packages/web/src/features/selection/SelectionChip.tsx` (신규)
- `packages/web/src/features/source/CodeView.tsx` — Monaco 선택 끝 좌표(`getScrolledVisiblePosition`)를 함께 알린다
- `packages/web/src/app/App.tsx` — `onRangeSelect` 에서 `setPane('analysis')` 제거, 칩 렌더
- `packages/web/src/features/annotations/AnalysisPanel.tsx` — `selectedRange` 가 새로 생기면 `targetKind` 를 `'range'` 로 자동 전환
- `packages/web/src/styles/trail.css` — `.selection-chip`

**구현 방법.**

1. `CodeBody` 의 `onMouseUp` 은 지금처럼 원본 좌표 범위를 계산하되, 추가로 `selection.getRangeAt(0).getBoundingClientRect()` 의 오른쪽 아래 점을 함께 준다. `App` 은 `selectedRange` 와 `chipAnchor` 를 세운다. 탭은 바꾸지 않는다.
2. `SelectionChip` 은 `position: fixed` 로 그 점 아래 8px 에 뜬다. 버튼: `＋ 기록`, `AI 초안`(`capabilities.ai.enabled` 일 때만), `복사`. 화면 밖으로 나가면 위쪽으로 뒤집는다.
3. `＋ 기록` — U12 의 기록 열이 있으면 그 작성 칸을 열고 대상을 "선택한 코드 범위" 로 둔다. 그 전까지는 `setPane('analysis')` 로 가되 `targetKind === 'range'` 가 미리 잡혀 있게 한다.
   `AI 초안` — `onGenerateAi` 를 바로 부른다(기존 조건 그대로: 분석이 있어야 한다. 없으면 U11 의 자동 생성이 먼저 돈다).
   `복사` — `navigator.clipboard.writeText(selection.toString())`.
4. 칩은 다음 중 하나로 사라진다: 선택이 접힘(`selectionchange`), 다른 곳 클릭, `Esc`, 스크롤 200px 이상, 탭 전환.
5. 코드 화면(Monaco)도 같은 칩을 쓴다. 지금은 선택해도 아무 표시가 없어 "선택한 코드 범위" 라는 대상이 어디서 오는지 알기 어렵다.
6. `CodeBody` 의 `suppressClick` (드래그 뒤 첫 클릭 무시)은 그대로 둔다.

**검증 방법.**

- E2E `test/e2e/analysis.e2e.mjs`: 노드 본문에서 두 줄 드래그 → `pane` 이 `trail` 그대로, `.selection-chip` 보임 → `＋ 기록` → 작성 칸의 대상이 `login.ts:63` 형식으로 표시. `Esc` → 칩 사라짐. 코드 화면에서도 같은 흐름.
- 기존 E2E 중 "드래그하면 분석 탭으로 간다" 를 전제로 한 단계가 있으면 칩 경유로 고친다.

**완료 기준.** 본문·코드 화면 어디서 드래그해도 탭이 바뀌지 않고, 칩의 `＋ 기록` 으로만 작성 칸이 열리며 대상이 미리 채워져 있다.

**함께 고칠 문서.** `## 용어` 표에 "선택 칩", `docs/terms.svg`(노드 본문 옆에 칩 하나와 콜아웃), README `### 분석 기록과 공유` 첫 문단, `CHANGELOG.md`.

---

### U05. 트레일이 없어도 `Ctrl+Alt+T` 한 번으로 루트를 만든다

**목적.** 첫 사용의 첫 동작이 "한 번 더 누른다" 로 끝나지 않게 한다.

**변경할 파일.**

- `packages/web/src/app/App.tsx` — `addRootHere`, `trail.snapshot`·`trail.rootAdded` 수신 효과
- `packages/web/src/features/trail/TrailView.tsx` — 빈 패널 placeholder 문구

**구현 방법.**

1. `addRootHere` 는 `context.trailId === null` 이면 `pendingRootRef = { documentId, line, char, at: Date.now() }` 를 세우고 `commands.createTrail` 만 보낸다. 오류 메시지를 띄우지 않는다.
2. `trail.snapshot` 이 와서 `context.trailId` 가 생기면(이미 `useMemo` 로 갱신된다) 효과 하나가 `pendingRootRef` 를 보고 `commands.addRootAt` 을 보낸 뒤 비운다. 5초가 지나도 트레일이 안 생기면 알림 "트레일을 만들지 못했다" 를 띄운다.
3. `trail.rootAdded` 를 받았을 때 트레일 제목이 기본값(`새 트레일`)이고 루트가 하나뿐이면 `commands.renameTrail(context, node.symbol.name)` 을 보낸다. 트레일 목록의 `새 트레일 (3)` 이 `HandlePacket (3)` 이 된다. 사용자가 이미 이름을 바꿨으면 손대지 않는다.
4. 트레일 패널의 빈 placeholder 를 "코드 화면에서 함수 위를 누르고 `Ctrl+Alt+T`. 트레일은 자동으로 생긴다." 로 바꾼다. 앱 바의 `＋ 새 트레일` 은 그대로 둔다 — 둘째 트레일부터는 그게 필요하다.

**검증 방법.**

- E2E `test/e2e/trail.e2e.mjs`: 트레일이 0개인 프로젝트에서 파일 열기 → `Ctrl+Alt+T` 한 번 → 루트 1개, 앱 바의 트레일 이름이 그 함수 이름. 두 번째 루트를 추가해도 이름은 안 바뀐다.

**완료 기준.** 새 프로젝트에서 키 한 번으로 루트가 생기고 트레일 이름이 첫 함수 이름이다.

**함께 고칠 문서.** README `## 사용법` "탐색 시작" 줄, `CHANGELOG.md`.

---

### U06. 활성 노드로 화면을 이동시키고 잠깐 강조한다

**목적.** 이미 펼친 식별자를 다시 눌렀을 때, 브레드크럼을 눌렀을 때, 같은 심볼 이동 버튼을 눌렀을 때 그 노드가 화면에 들어오게 한다.

**변경할 파일.**

- `packages/web/src/features/trail/TrailView.tsx` — `activeNodeId` 변화 효과
- `packages/web/src/styles/trail.css` — `.node.flash > .hd` 애니메이션

**구현 방법.**

1. `TrailView` 에 `useEffect([trail.activeNodeId])`: 해당 `.node > .hd` 가 `#root` 의 보이는 영역 안에 완전히 있는지 `getBoundingClientRect` 로 재고, 아니면 `scrollIntoView({ block: 'center', behavior: 'smooth' })`. 보드 모드는 같은 코드로 동작한다(절대 배치도 스크롤 컨테이너 안이다).
2. 이동 여부와 상관없이 `.flash` 클래스를 800ms 붙인다. `@media (prefers-reduced-motion: reduce)` 에서는 배경색만 잠깐 바꾸고 애니메이션은 없앤다.
3. 다른 탭이 활성 노드를 바꿔도 이 탭이 따라 스크롤하면 방해가 된다. `trail.activeNodeChanged` 이벤트의 `commandId` 가 이 탭이 보낸 것일 때만 스크롤한다 — `api/commands.ts` 가 보낸 `commandId` 를 `Set` 에 잠깐 기억해 두면 된다(이미 `command.error` 상관을 위해 `commandId` 가 이벤트에 실린다).
4. `runResolve` 의 `'existing'` 경우 알림은 띄우지 않는다. 이동과 강조로 충분하다.

**검증 방법.**

- E2E: 긴 트레일(루트 아래 자식 15개)에서 첫 호출부를 두 번 클릭 → 두 번째 클릭 뒤 자식 노드 헤더의 `boundingBox` 가 뷰포트 안. 노드 수는 그대로. 브레드크럼 클릭도 같은 검사.

**완료 기준.** 활성 노드가 바뀌면 그 노드가 화면 안에 있고 잠깐 강조된다. 다른 탭의 조작으로는 스크롤하지 않는다.

**함께 고칠 문서.** 없음(동작 보강). `CHANGELOG.md` 한 줄.

---

### U07. 코드 화면에서 마우스로도 트레일을 시작한다

**목적.** 단축키를 모르는 사용자도 코드 화면에서 트레일을 시작할 수 있게 하고, 커서가 어느 함수 안에 있는지 미리 보여준다.

**변경할 파일.**

- `packages/web/src/features/source/CodeView.tsx` — Monaco `addAction`, `onAddRoot` prop
- `packages/web/src/app/App.tsx` — 문서 줄(`.doc-bar`)에 시작 버튼, 문서 심볼을 `App` 으로 올리기
- `packages/web/src/features/changes/ReadingStarts.tsx` — 문서 심볼을 `App` 에서 받도록
- `packages/web/src/styles/app.css` — `.doc-bar .start`

**구현 방법.**

1. `CodeView` 가 `editor.addAction({ id: 'code-trail.addRoot', label: '여기서 트레일 시작', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyT], contextMenuGroupId: 'navigation', contextMenuOrder: 1, run: (ed) => onAddRoot(toZeroBased(ed.getPosition())) })` 를 등록한다. 우클릭 메뉴에 나오고 Monaco 안에서 키도 잡힌다. `App` 의 전역 `keydown` 은 코드 화면 밖(예: 파일 탐색기에 포커스)에서 누른 경우를 위해 남긴다.
2. 문서 줄에 버튼 `▶ 트레일 시작` 을 둔다. `title` 은 "Ctrl+Alt+T · 커서가 있는 함수부터". `App` 이 문서 심볼(`api.documentSymbols`)을 들고 있으면 커서를 감싸는 심볼 이름을 버튼 옆에 `HandlePacket 에서` 로 보여준다. 문서 심볼 요청은 지금 `ReadingStarts` 가 문서마다 한 번 하므로 그 결과를 `App` 으로 올려 둘이 나눠 쓴다 — 요청 수는 늘지 않는다.
3. 언어 서버가 없는 문서(U01 의 `supportedLanguage === null`)에서는 버튼을 비활성화하고 `title` 에 이유를 적는다.

**검증 방법.**

- E2E `test/e2e/shell.e2e.mjs`: `editor.getAction('code-trail.addRoot')` 가 있다. `.doc-bar .start` 클릭 → 트레일 탭에 루트 1개. `.py` 문서에서는 버튼이 `disabled`.

**완료 기준.** 우클릭 메뉴와 문서 줄 버튼으로 루트를 만들 수 있고, 버튼이 커서가 든 함수 이름을 보여준다.

**함께 고칠 문서.** README `## 사용법` "탐색 시작" 줄, `docs/terms.md` 의 "코드 화면" 설명, `CHANGELOG.md`.

---

### U08. 파일이 바뀌면 노드에 `바뀜` 배지를 달고 다시 읽기를 제공한다

**목적.** 리뷰 중 코드가 고쳐졌을 때(특히 AI 가 다시 생성했을 때) 트레일이 옛 코드를 보여주고 있다는 것을 알리고, 옛 좌표로 언어 서버에 묻는 일을 막는다.

**변경할 파일.**

- `packages/server/src/bootstrap.ts` — `workspace.filesChanged` 방송 전에 영향받는 노드 계산
- `packages/server/src/trails/service.ts` — `staleNodesFor(relPaths, hashOf)`; `refreshNode`
- `packages/shared/src/domain/trail.ts` — `replaceSymbol(id, symbol)` (자식·origin·collapsed 유지, 재귀 배지 재계산)
- `packages/shared/src/protocol/events.ts` — `trail.nodesStale { trailId, nodeIds }`
- `packages/shared/src/protocol/commands.ts` — `trail.refreshNode { nodeId }` (구조 명령)
- `packages/server/src/ws/gateway.ts` — 두 처리
- `packages/server/src/symbols/resolver.ts` — `resolveByName(grant, name, container, kind)`: `documentSymbol` 결과에서 같은 이름·컨테이너·종류 찾기
- `packages/web/src/features/trail/useTrail.ts` — `staleNodeIds` 상태
- `packages/web/src/features/trail/TrailNode.tsx` — `바뀜` 배지와 `↻` 버튼
- `packages/web/src/app/App.tsx` — 오래된 노드에서 식별자 클릭 시 알림
- `packages/web/src/styles/trail.css` — `.badge.stale`

**구현 방법.**

1. 서버가 `workspace.filesChanged` 를 방송하기 직전에, 불러온 모든 트레일의 노드 중 `symbol.relPath ∈ relPaths` 인 것을 모으고 파일의 현재 해시(문서 레지스트리가 쓰는 것과 같은 방식)를 `symbol.contentHash` 와 비교한다. 다른 노드들을 `trail.nodesStale` 로 방송한다. 같으면(저장만 다시 됨) 아무것도 보내지 않는다. 계산은 파일당 한 번이고 노드 수에 비례한다 — 1,000개 노드에서도 ms 단위다.
2. 웹은 `staleNodeIds` 를 두고 헤더에 `바뀜` 배지(`title`: "이 노드의 파일이 바뀌었다. ↻ 로 현재 코드를 다시 읽는다") 와 `↻` 버튼을 붙인다. 오래된 노드 본문에서 식별자를 클릭하면 서버에 보내지 않고 알림 "옛 코드의 좌표다. 먼저 ↻ 로 다시 읽는다" + 행동 "다시 읽기".
3. `trail.refreshNode` 는 `documentSymbol` 로 같은 이름·컨테이너·종류의 심볼을 찾는다. 정확히 하나면 본문 범위를 기존 규칙(`symbols/body.ts`)으로 다시 잘라 `replaceSymbol` 하고 `trail.snapshot` 을 보낸다. 0개면 `NOT_FOUND` "현재 파일에 같은 이름의 심볼이 없다"(배지는 남는다). 여럿이면 `trail.definitionChoice` 를 재사용해 고르게 한다(U09 팝오버가 헤더 아래에 뜬다).
4. 자식의 `origin.line` 은 부모 본문이 바뀌면 어긋날 수 있다. 다시 읽은 부모의 자식 진입 링크에는 `(줄이 달라졌을 수 있다)` 를 덧붙이고 호출부 순번은 `origin.text` 로 같은 이름의 첫 토큰을 찾아 다시 붙인다. 못 찾으면 순번 없이 둔다. 이것은 알려진 한계로 README 에 적는다.
5. 서버를 다시 띄웠을 때도 같은 검사를 한 번 돌려 시작 snapshot 뒤에 `trail.nodesStale` 을 보낸다 — 꺼둔 사이에 바뀐 파일을 잡는다.

**검증 방법.**

- 단위 `test/unit/trail.test.mjs`: `replaceSymbol` 뒤 자식·origin·collapsed 유지, 재귀 배지 재계산.
- 통합 `test/integration/websocket.test.mjs`(파일 감시 fixture 재사용): 파일 수정 → `trail.nodesStale` 에 그 노드만. 같은 내용으로 다시 저장 → 이벤트 없음. `trail.refreshNode` → snapshot 의 본문이 새 코드, 자식 그대로.
- 통합 `test/integration/lsp.test.mjs`: 가짜 서버 시나리오 "같은 이름 심볼 둘" → `trail.definitionChoice`.
- E2E: 파일을 바꾼 뒤 `.badge.stale` 표시, `↻` 뒤 사라짐.

**완료 기준.** 파일이 바뀌면 관련 노드에만 `바뀜` 이 붙고, 다시 읽기로 현재 코드가 되며, 옛 노드에서의 클릭이 서버로 가지 않는다.

**함께 고칠 문서.** README `### 표시되는 배지` 에 `바뀜`, `## 용어` 표 배지 줄, `docs/terms.svg` 헤더 줄, 구현서 14.2·15.2, `CHANGELOG.md`.

---

### U09. 정의·구현 후보를 클릭한 지점 옆에서 고른다

**목적.** 후보 목록이 "무엇의 후보인지" 보이게 하고, 구현이 여럿일 때 `⚑` 를 한 번 더 누르는 단계를 없앤다. 자동으로 고르지 않는다는 규칙은 그대로다.

**변경할 파일.**

- `packages/shared/src/protocol/events.ts` — `trail.definitionChoice` 에 `origin?: { line, char, text }`, `title?: string`; `trail.implementationChoice` 에 `choiceId`, `nodeId`, `candidates`
- `packages/server/src/trails/resolveFlow.ts` — `remember` 에 origin 전달, `autoFollowSingleImplementation` 이 후보 여럿일 때 `remember` 로 등록
- `packages/server/src/ws/gateway.ts` — 두 이벤트 payload
- `packages/web/src/features/trail/ChoicePopover.tsx` (신규, 기존 `.choice` JSX 이동)
- `packages/web/src/features/trail/TrailView.tsx` — 팝오버 위치 계산, 키 처리
- `packages/web/src/features/trail/useTrail.ts` — `implementationChoice` 를 `choice` 상태로
- `packages/web/src/styles/trail.css` — `.choice` 절대 배치

**구현 방법.**

1. 팝오버는 `#root` 안에서 `position: absolute` 로 그린다. 기준점은 정의 후보면 `[data-id=nodeId] [data-l=line][data-c=char]` 토큰의 아래, 구현 후보면 그 노드 헤더의 아래. 루트 만들기(`nodeId === null`) 때는 지금처럼 트리 맨 위. 화면 아래로 넘치면 위로 뒤집는다.
2. 제목: "『Find』의 정의 후보 3개" / "『IHandler::Invoke』의 구현 4개". 항목: 이름 · `경로:줄` · `선언만` 배지. 구현 목록에는 맨 위에 "전부 붙이기" 항목을 둔다(기존 `⚑` 와 같은 결과). `⚑` 버튼은 그대로 둔다 — 몸통 있는 가상 함수의 재정의를 모을 때 여전히 필요하다.
3. 키: `↑`/`↓` 이동, `Enter` 선택, `Esc` 닫기, 첫 포커스는 첫 항목. 팝오버가 열려 있으면 트리 다른 곳 클릭으로 닫힌다(`trail.chooseCandidate` 는 안 보낸다. 서버의 `pending` 은 32개 상한과 함께 그대로 둔다).
4. 서버: `autoFollowSingleImplementation` 이 몸통 있는 후보를 2개 이상 찾으면 `remember(trailId, nodeId, origin=null, candidates)` 로 등록하고 `trail.implementationChoice { choiceId, nodeId, candidates, truncated }` 를 보낸다. 사용자가 하나를 고르면 기존 `trail.chooseCandidate` 경로로 붙는다. "전부 붙이기" 는 기존 `trail.resolveImplementations` 를 보낸다.

**검증 방법.**

- 통합 `test/integration/lsp.test.mjs`: 구현 셋 시나리오에서 `trail.implementationChoice.candidates.length === 3` 과 `choiceId`; `trail.chooseCandidate` 로 하나 붙이면 선언 노드 아래 자식 1개.
- 단위 `test/unit/protocol.test.mjs`: 두 이벤트의 새 필드.
- E2E `test/e2e/trail.e2e.mjs` `[보드 모드]` 포함: 팝오버의 `boundingBox.y` 가 클릭한 토큰의 `y` 보다 크고 40px 안. `Esc` 로 닫힘. 구현 여럿인 fixture 에서 팝오버가 헤더 아래에 뜬다.

**완료 기준.** 후보 창이 클릭한 곳 옆에 제목과 함께 뜨고, 구현이 여럿일 때 토스트 대신 같은 창에서 바로 고를 수 있다.

**함께 고칠 문서.** README `### 인터페이스 · 가상 함수` 절, `## 용어` 표에 "후보 팝오버", `docs/terms.svg`, 구현서 15.2, `CHANGELOG.md`.

---

### U10. 트레일 노드에 기록 수 배지와 줄 표시를 붙인다

**목적.** 트리를 보는 것만으로 어느 함수에 설명·질문·우려가 달려 있고 그중 몇 개가 미해결인지 알게 한다. 리뷰 도구에서 기록이 코드 옆에 안 보이면 기록 기능이 없는 것과 같다.

**변경할 파일.**

- `packages/web/src/features/trail/annotationIndex.ts` (신규, 순수 함수)
- `packages/web/src/features/trail/types.ts` — `AnnotationMarkView`
- `packages/web/src/app/App.tsx` — 활성 분석에서 색인 계산(`useMemo`), `TrailView` 에 전달
- `packages/web/src/features/trail/TrailView.tsx`, `TrailNode.tsx`, `CodeBody.tsx` — 배지·줄 표시·`＋ 기록` 버튼
- `packages/web/src/styles/trail.css` — `.badge.notes`, `.badge.notes.open`, `.cl.noted`, 종류별 색

**구현 방법.**

1. `buildAnnotationIndex(analysis)` 는 `{ byNode: Map<nodeId, { total, open }>, byFile: Map<relPath, Array<{ startLine, endLine, annotationId, kind, open }>> }` 를 만든다.
   - `target.kind === 'node'` → `byNode`.
   - `target.kind === 'range'` → `anchors` 에서 `anchorId` 로 앵커를, `baselines[].files` 에서 `fileId → relPath` 를 찾고 `currentRange ?? range` 를 쓴다.
   - `target.kind === 'trail'` 은 노드에 붙이지 않는다(툴바 오른쪽 "기록 N" 으로 표시).
   삭제된 기록(`deletedAt !== null`)은 뺀다. `open` 은 `kind ∈ {question, concern}` 이고 `status === 'open'`.
2. `TrailNode` 헤더: `byNode` 에 있거나 본문 줄 범위(`startLine ~ startLine + 줄 수`)와 겹치는 `byFile` 항목이 있으면 `✎ N` 배지. 미해결이 있으면 주황(`.open`), 없으면 회색. `title` 에 "설명 2 · 질문 1(미해결)". 클릭하면 U12 의 기록 열을 열거나(없으면 분석 기록 탭으로 가서) 그 노드 기록만 필터한다.
3. `CodeBody` 각 줄: 겹치는 항목이 있으면 `.cl.noted` 와 `data-kind` 로 왼쪽 3px 띠. 색은 `.annotation-kind` 과 같게(설명 파랑·질문 보라·우려 주황·결론 초록). `title` 은 첫 기록의 본문 첫 줄. 클릭은 그 기록으로 간다(`focusInternalReference` 재사용).
4. 헤더 버튼 줄에 `＋`(`data-act="note"`, `title` "이 노드에 기록 남기기") 를 추가한다. 대상은 `node`. U12 전까지는 분석 기록 탭으로 가되 `targetKind === 'node'` 를 미리 잡는다.
5. 툴바 오른쪽 `노드 12` 옆에 `기록 6 · 미해결 2` 를 붙인다(트레일 대상 기록 포함).
6. 색인은 **활성 분석 하나**만 본다. 다른 분석의 기록은 표시하지 않는다 — 분석을 바꾸면 배지도 바뀐다. 이 제한을 README 에 적는다.

**검증 방법.**

- 단위 `test/unit/annotation-index.test.mjs`(신규): 여러 줄 범위가 노드 본문과 부분적으로 겹칠 때 그 줄들만 `noted`; `fileId → relPath` 매핑이 다른 파일이면 표시 안 함; 삭제된 기록 제외; 미해결 계산. 이 넷은 실제로 틀리기 쉬운 계산이다.
- E2E `test/e2e/analysis.e2e.mjs`: 범위 기록 작성 → 그 노드 헤더 `✎ 1`, 해당 줄 `.cl.noted`; 해결로 표시 → `.open` 사라짐; 삭제 → 배지 사라짐.

**완료 기준.** 노드 헤더와 본문 줄에서 기록의 존재·종류·미해결 여부를 볼 수 있고, 클릭하면 그 기록으로 간다.

**함께 고칠 문서.** `## 용어` 표에 "기록 표시" 와 배지 줄, `docs/terms.svg`(헤더에 `✎ 2`, 본문 한 줄에 띠, 콜아웃), README `### 표시되는 배지`·`### 헤더에 표시되는 것`, `CHANGELOG.md`.

---

### U11. 첫 기록 때 분석을 자동으로 만들고 트레일과 연결한다

**목적.** "분석을 먼저 만드세요" 단계를 없앤다. 트레일을 고르면 그 트레일의 분석이 따라온다.

**변경할 파일.**

- `packages/server/src/analysis/service.ts`, `packages/server/src/http/routes.ts` — `AnalysisSummaryView` 에 `trailIds` 포함
- `packages/shared/src/protocol/analysisSchemas.ts` — 요약 스키마
- `packages/web/src/api/http.ts` — `AnalysisSummaryView.trailIds`
- `packages/web/src/app/App.tsx` — 대기 중 기록(`pendingAnnotation`) 패턴 확장, 트레일 선택 시 분석 자동 선택
- `packages/web/src/features/annotations/AnalysisPanel.tsx` — 분석이 없어도 작성 칸 표시

**구현 방법.**

1. 작성 칸은 분석이 없어도 보인다. 저장 시 `analysis === null` 이면 `App` 이 `commands.createAnalysis({ title: <활성 트레일 제목>, purpose: '', trailIds: [활성 트레일], author })` 를 보내고 기록 내용을 `pendingAnnotation` 에 둔다. `analysis.snapshot` 이 오면(이미 `setAnalysis` 로 잡힌다) 그 ID 로 기록을 만든다. 범위 대상이면 기존 `captureAnchor → anchor.checked → createAnnotation` 사슬 앞에 한 단계가 더 붙을 뿐이다.
2. 트레일이 바뀌면(`trail.snapshot` 의 `id` 변경) `analyses` 중 `trailIds` 에 그 트레일이 든 첫 항목을 `api.analysis` 로 연다. 없으면 `analysis` 를 `null` 로 두어 다음 저장이 새로 만들게 한다. 사용자가 분석 선택 상자에서 직접 고른 것은 `manualAnalysisRef` 로 기억해 트레일을 바꿔도 그 세션 동안 유지한다.
3. `새 분석 만들기` 폼은 "다른 분석 만들기" 로 이름을 바꿔 아래로 내린다. 목적(`purpose`)은 나중에 U13 의 인라인 편집으로 쓴다.

**검증 방법.**

- 통합 `test/integration/analysis-sharing.test.mjs`: `analysis.create` 요약에 `trailIds`.
- E2E `test/e2e/analysis.e2e.mjs`: 새 프로젝트, 루트 하나 → 분석 없이 노드 기록 저장 → 분석 목록 1개, 제목이 트레일 제목, `trailIds` 에 트레일. 둘째 트레일로 바꾸면 분석 선택이 비고, 첫 트레일로 돌아오면 다시 잡힌다.

**완료 기준.** 사용자가 분석을 만들지 않아도 첫 기록이 저장되고, 트레일과 분석이 자동으로 짝지어진다.

**함께 고칠 문서.** README `### 분석 기록과 공유` 첫 문단("분석 하나를 만든 뒤" 삭제), `docs/first-review-guide.md` 3단계, `CHANGELOG.md`.

---

### U12. 트레일 패널 옆에 접이식 기록 열을 둔다

**목적.** 노드를 보면서 바로 옆에서 기록을 읽고 쓴다. 분석 기록 탭은 목록 관리·공유·안내 순서 용도로 남긴다.

**변경할 파일.**

- `packages/web/src/features/annotations/AnnotationComposer.tsx`, `AnnotationItem.tsx` (신규, `AnalysisPanel.tsx` 에서 분리)
- `packages/web/src/features/annotations/AnnotationColumn.tsx` (신규)
- `packages/web/src/features/annotations/AnalysisPanel.tsx` — 분리한 컴포넌트 사용
- `packages/web/src/features/trail/TrailView.tsx` — 툴바 `✎ 기록` 토글, `.trail` 을 가로 flex 로
- `packages/web/src/app/App.tsx` — 열 상태(localStorage `code-trail.annotationColumn`), 콜백 연결
- `packages/web/src/styles/trail.css` — `.annotation-column`(기본 320px, `min 240px`, 끌어 조절)

**구현 방법.**

1. `.trail` 을 `flex-direction: row` 로 바꾸고 안에 `.trail-main`(툴바·브레드크럼·트리)과 `.annotation-column` 을 둔다. 열이 열리면 `#root` 폭이 줄고 `useFitToWidth` 가 `ResizeObserver` 로 이미 따라간다.
2. 열 내용, 위에서 아래로: 대상 표시("『Find』 · registry.cpp:4" / 선택 범위면 "registry.cpp:6–7"), 작성 칸(`AnnotationComposer`: 종류·태그·본문, `Ctrl+Enter` 저장, `Esc` 비움), 활성 노드에 붙은 기록 목록(`AnnotationItem`, U10 의 색인으로 노드+범위 모음), 맨 아래 "이 트레일의 기록 전체 보기 →"(분석 기록 탭).
3. 대상 결정 순서: 선택 칩에서 왔으면 범위 → 활성 노드 → 트레일. 작성 칸 위에 대상을 글자로 보여주고 클릭하면 바꿀 수 있다.
4. 활성 노드가 없으면 열은 "노드를 고르면 그 노드의 기록이 여기 보인다" 를 보여준다.
5. 열 열림 여부와 폭은 브라우저에 저장한다. 트레일과 함께 저장하지 않는다 — 화면 상태다.
6. `AnalysisPanel` 의 목록은 분리한 `AnnotationItem` 을 그대로 쓴다. 두 벌이 생기면 U13 의 편집 방식이 갈린다.

**검증 방법.**

- E2E `test/e2e/analysis.e2e.mjs`: `✎ 기록` → 열 표시, 노드 클릭 → 열 제목이 그 노드, 저장 → 헤더 `✎ 1`, 열 닫기 → `#root` 폭이 원래대로. 새로고침 뒤 열 상태 유지.
- E2E `test/e2e/trail.e2e.mjs` 의 폭 맞춤 검사가 열이 열린 상태에서도 통과한다(코드 글자 크기가 줄어든다).

**완료 기준.** 트레일 패널을 떠나지 않고 활성 노드의 기록을 읽고 쓸 수 있으며, 열을 닫으면 트리가 원래 폭을 되찾는다.

**함께 고칠 문서.** `## 용어` 표에 "기록 열", 툴바 줄에 버튼 추가, `docs/terms.svg`(툴바 버튼과 오른쪽 열), README `## 사용법`, `CHANGELOG.md`.

---

### U13. `window.prompt` 편집을 인라인 편집으로 바꾸고 기록에서 코드로 바로 간다

**목적.** 여러 줄 기록을 잃지 않고 고치고, 기록 하나에서 그 코드로 한 번에 간다.

**변경할 파일.**

- `packages/web/src/features/annotations/AnnotationItem.tsx` — 편집 모드, 대상 링크
- `packages/web/src/features/annotations/AnalysisPanel.tsx` — 목적·중요 위치 이름의 인라인 편집
- `packages/web/src/app/App.tsx` — `navigateAnalysisTarget` 에 노드 대상 스크롤(U06 와 연동), 범위 대상이 트레일 노드 안에 있으면 그 노드로
- `packages/web/src/styles/app.css` — `.annotation-item.editing`

**구현 방법.**

1. `AnnotationItem` 의 `수정` 은 그 카드 안을 `textarea`(본문) + 태그 입력 + 종류 선택으로 바꾼다. `Ctrl+Enter` 저장, `Esc` 취소, 저장 버튼. `baseVersion` 은 편집 시작 시점 값을 쓰고 서버가 `STALE` 로 거절하면(다른 탭이 고침) 알림 "다른 곳에서 먼저 고쳤다" + "새 내용 보기".
2. 목적(`purpose`) 은 카드 안의 `textarea` 로, 중요 위치 이름은 `input` 으로. `window.prompt` 호출을 전부 없앤다.
3. 헤더의 대상 글자를 링크로 바꾼다.
   - 노드 대상: `Find · registry.cpp:4` → 클릭하면 트레일 탭에서 그 노드로(활성 + 스크롤).
   - 범위 대상: `registry.cpp:6–7` → 클릭하면 코드 화면 그 줄로(기존 `openFile(relPath, line)`). 범위가 활성 트레일의 어느 노드 본문 안에 있으면 두 번째 링크 "트레일에서 보기" 를 붙인다(U10 색인 역조회).
   - 트레일 대상: `트레일 · 로그인 검토`.
4. 답글 작성 칸도 같은 키(`Ctrl+Enter`/`Esc`)를 쓴다.

**검증 방법.**

- E2E `test/e2e/analysis.e2e.mjs`: 세 줄짜리 기록을 수정해 저장 → 줄바꿈 유지. 헤더 링크 클릭 → 코드 탭의 커서 줄 == 범위 시작. `window.prompt` 가 호출되지 않는다(`page.on('dialog')` 로 감시).

**완료 기준.** 웹 코드에 `window.prompt` 가 없고, 기록 헤더에서 코드나 노드로 한 번에 간다.

**함께 고칠 문서.** README `### 분석 기록과 공유`, `CHANGELOG.md`.

---

### U14. 변경 목록을 hunk 단위로 펼치고 코드 화면에 변경 표시와 변경 보기를 넣는다

**목적.** "바뀐 곳만 보기" 를 가능하게 한다. 리뷰의 시작점은 파일이 아니라 hunk 다.

**변경할 파일.**

- `packages/server/src/git/service.ts` — `hunks(relPath, from?, to?)`, `originalText(ref, relPath)`
- `packages/server/src/http/routes.ts` — `GET /api/changes/hunks?relPath=&from=&to=`, `GET /api/changes/original?relPath=&ref=`
- `packages/server/src/security/paths.ts` — 두 경로가 반드시 통과
- `packages/web/src/api/http.ts` — 두 API
- `packages/web/src/features/changes/ReadingStarts.tsx` — 파일 항목 펼치면 hunk 목록, 열어봄·기록 수 표시
- `packages/web/src/features/source/CodeView.tsx` — 바뀐 줄 장식, `diff` 모드(`monaco.editor.createDiffEditor`)
- `packages/web/src/app/App.tsx` — 문서 줄에 `변경 보기` 토글, `이전 변경`/`다음 변경`
- `packages/web/src/styles/app.css` — `.changed-line`, `.code-view.diff`

**구현 방법.**

1. `hunks`: `git diff -U0 --no-ext-diff --no-textconv --no-color [from to] -- <relPath>` 를 `execFile` 로 돌리고 `@@ -a[,b] +c[,d] @@` 만 읽어 `{ oldStart, oldCount, newStart, newCount }[]` 를 만든다. 추적되지 않은 파일은 hunk 하나(전체)로 취급한다. 출력 상한은 기존 `MAX_OUTPUT`.
2. `originalText`: `git show <ref>:<relPath>` (`ref` 는 `HEAD` 또는 40자 해시만 허용, `-` 로 시작하는 값 거부). 크기 상한은 문서 읽기와 같게, 바이너리(NUL 포함)면 거부. 응답은 `{ text, ref }` 뿐이고 절대경로는 없다.
3. 두 경로 모두 `relPath` 를 `security/paths.ts` 로 검사하고, 현재 변경 목록에 있는 파일만 허용한다.
4. `ReadingStarts` 의 변경 목록: 파일 줄에 `+12 −3`, 펼치면 hunk 줄(`63–67`, `+5`) 클릭으로 그 줄에서 연다. 파일 줄 오른쪽에 `열어봄 ✓`(이동 이력에 있음)·`✎ 2`(U10 색인의 `byFile`) 표시. 이것이 리뷰 진행의 실제 감이 된다.
5. 코드 화면: 열린 문서가 변경 목록에 있으면 hunk 를 받아 `deltaDecorations` 로 왼쪽 여백에 색 띠(추가 초록, 수정 파랑, 삭제 위치 빨강 표식). 문서 줄에 `이전 변경`/`다음 변경` 버튼(`Alt+↑`/`Alt+↓`)과 `변경 보기` 토글.
6. `변경 보기`: 같은 자리에 `createDiffEditor({ readOnly: true, originalEditable: false, renderSideBySide: width > 1100 })` 를 만들고 `original = originalText(HEAD)`, `modified = 현재 문서`. `Ctrl+Alt+T` 와 우클릭 시작(U07)은 `modified` 쪽 커서를 쓴다. 토글을 끄면 일반 편집기로 돌아온다(모델은 재사용).
7. 커밋 범위 비교(`from`/`to`)는 기존 `/api/changes` 의 쿼리를 그대로 이어받는다. UI 에서 범위를 고르는 입력은 이번에 넣지 않는다 — 작업 트리 변경만으로 시작한다.

**검증 방법.**

- 통합 `test/integration/git.test.mjs`: 추가·수정·이름 변경 파일의 hunk 파싱; `originalText('HEAD', ...)` 본문; `ref = '--output=x'` 거부; `relPath = '../x'` 거부(`security.test.mjs` 에 한 줄).
- 통합 `test/integration/resilience.test.mjs`: 새 경로 둘이 인증 훑기에 자동으로 잡힌다.
- E2E `test/e2e/shell.e2e.mjs`: 수정된 fixture 파일을 열면 `.changed-line` 장식, `변경 보기` → `.monaco-diff-editor`, `다음 변경` → 커서 줄이 hunk 시작.

**완료 기준.** 변경 목록에서 hunk 로 바로 가고, 코드 화면이 바뀐 줄을 표시하며, `HEAD` 와의 좌우 비교를 켜고 끌 수 있다.

**함께 고칠 문서.** `## 용어` 표에 "변경 보기" 와 "읽기 시작점" 설명 갱신, README `## 사용법`("변경에서 시작하기"), 구현서 15.1 표, `CHANGELOG.md`.

---

### U15. 설정 화면을 만들고 Monaco 테마를 앱 테마에 맞춘다

**목적.** 파일을 열지 않고 설정을 바꾼다. 밝은 테마에서 코드 화면만 어두운 것을 고친다.

**변경할 파일.**

- `packages/web/src/features/settings/SettingsView.tsx` (신규)
- `packages/web/src/app/App.tsx` — `Pane` 에 `'settings'`, 탭 추가, 작성자 이름 입력을 여기로 이동
- `packages/web/src/features/source/CodeView.tsx` — 테마 따라가기
- `packages/web/src/features/annotations/AnalysisPanel.tsx` — 작성자 입력 제거
- `packages/web/src/styles/app.css` — `.settings`

**구현 방법.**

1. 설정 화면은 카드 넷이다.
   - **화면**: 테마(system/light/dark 라디오), 코드 글자 크기(0 = 자동, 숫자 입력), 폭 맞춤(체크), 최소 글자 크기, 노드당 최대 줄 수.
   - **탐색**: 클릭 대상(allSymbols/callsOnly), 형제 정렬 기본값, 구현 하나면 자동으로 따라가기, 노드 추가 시 외부 에디터 열기, 문맥 줄 수.
   - **언어 서버**: 언어별 켜기/끄기. 실행 파일·인자·환경 변수는 **로컬 설정**이므로 "진단 화면에서 탐지 결과를 보고, 직접 지정하려면 `.code-trail/local/settings.json`" 안내와 링크만 둔다 — 임의 실행 파일 경로를 웹 입력으로 받는 것은 이번에 넣지 않는다.
   - **작성자와 AI**: 표시 이름(기존 입력 이동), AI 켜기·모델 이름·endpoint(서버가 loopback 검사를 이미 한다). 이 카드는 `readOnlyShare` 면 숨긴다.
2. 각 입력은 바뀌면 400ms 뒤 `commands.updateSettings(context, next)` 를 보낸다. 서버가 프로젝트/로컬로 나눠 저장하고 `settings.changed` 로 돌려주는 기존 경로를 그대로 쓴다. 저장 상태 한 줄("저장됨" / "저장 중").
3. Monaco: `resolvedTheme = ui.theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : ui.theme` 를 계산해 `monaco.editor.setTheme(resolvedTheme === 'light' ? 'vs' : 'vs-dark')`. `matchMedia` 변화도 구독한다. `CodeView` 생성 시 `theme` 고정값을 없앤다.
4. 탭 순서는 U19 와 맞춰 `코드 · 트레일 · 분석 기록 · 설정 · 진단`.

**검증 방법.**

- E2E `test/e2e/shell.e2e.mjs`: 설정 탭에서 테마를 `light` 로 → `html[data-theme=light]` 와 `.monaco-editor.vs` 존재; `.code-trail/settings.json` 에 `ui.theme: "light"`; 로컬 키는 `local/settings.json` 에만(기존 분리 검사 재사용). 새로고침 뒤 유지.

**완료 기준.** `ui.*` 전부와 언어 켜기·작성자·AI 를 화면에서 바꿀 수 있고, 코드 화면 테마가 앱 테마를 따른다.

**함께 고칠 문서.** `## 용어` 표에 "설정 화면", README `## 설정`(첫 문단에 "설정 탭에서 바꾼다", 진단 탭 언급 조정), `docs/terms.md` "트레일 패널 밖", `CHANGELOG.md`.

---

### U16. 키보드로 트리를 다니고 단축키 도움말을 띄운다

**목적.** 마우스 없이 노드를 고르고 펼치고 지우고 파고들 수 있게 한다. 리뷰는 손을 키보드에 둔 채 오래 하는 일이다.

**변경할 파일.**

- `packages/web/src/features/trail/keyboard.ts` (신규, 순수 함수 `nextVisible`, `prevVisible`, `parentOf`, `firstChild`)
- `packages/web/src/features/trail/TrailView.tsx` — `#root` 의 `onKeyDown`, roving tabindex
- `packages/web/src/features/trail/TrailNode.tsx` — `.hd` 에 `tabIndex`, `role`, `aria-expanded`, `aria-level`
- `packages/web/src/features/trail/CodeBody.tsx` — 클릭 후보 `span` 을 `Tab` 으로 다닐 수 있게(`tabIndex=-1`, `F`/`Enter` 로 파고들기)
- `packages/web/src/features/help/ShortcutsHelp.tsx` (신규)
- `packages/web/src/app/App.tsx` — `?` 전역 키, `Alt+←/→` 이동 이력
- `packages/web/src/styles/trail.css` — `:focus-visible` 표시

**구현 방법.**

1. 트리 모드의 `#root` 는 `role="tree"`, 각 `.node` 는 `role="treeitem"` 에 `aria-expanded`, `aria-level`. 보드 모드는 `role="list"`/`listitem`. 활성 노드의 `.hd` 만 `tabIndex=0`, 나머지는 `-1`(roving).
2. `#root` 의 키:
   - `↓`/`↑` — 보이는 순서(`flattenTree` 순서에서 접힌 서브트리와 필터에 걸린 것 제외)로 이동. 이동은 `commands.setActiveNode` 를 보낸다(화면 명령, revision 안 올림).
   - `→` — 접혀 있으면 펼치기, 아니면 첫 자식. `←` — 펼쳐 있으면 접기, 아니면 부모.
   - `Enter`/`Space` — 접기·펼치기. `Home`/`End`.
   - `Delete` — U03 의 삭제(되돌리기 알림). `o` — 외부 에디터. `f` — `⚑`. `p` — 진입 링크(부모 호출부로). `n` — 기록(U12). `r` — `⇱` 새 루트로.
   - `Tab` — 활성 노드 본문의 첫 클릭 후보로 들어가고, 후보 사이는 `Tab`/`Shift+Tab`, `Enter` 로 파고들기, `Alt+Enter` 로 구현. `Esc` 로 헤더로 돌아온다.
   - `/` — 툴바 필터에 포커스. `Esc` — 팝오버·칩·필터 닫기.
3. 전역: `?` 가 단축키 도움말 오버레이(표 한 장, `Esc` 로 닫기). `Alt+←`/`Alt+→` 가 기존 이동 이력 버튼. 입력 요소에 포커스가 있을 때는 한 글자 키를 잡지 않는다.
4. `:focus-visible` 에 헤더 테두리 강조. 활성 노드와 포커스가 다를 수 있으므로 색이 아니라 테두리 두께로 구분한다.

**검증 방법.**

- 단위 `test/unit/keyboard.test.mjs`(신규): 접힌 서브트리·필터 제외 노드를 건너뛴 `nextVisible`/`prevVisible`; 마지막에서 `↓` 는 그대로. 이 함수가 틀리면 키보드가 보이지 않는 노드로 "사라진다".
- E2E `test/e2e/trail.e2e.mjs`: `Tab` 으로 트리 진입 → `↓` 두 번 → `.node.active` 가 셋째 노드 → `Enter` 로 접힘 → `Delete` → 알림 → 되돌리기. `?` → `.shortcuts` 표시.

**완료 기준.** 마우스 없이 루트 만들기 → 파고들기 → 접기 → 삭제·되돌리기 → 기록 열기가 되고, 도움말이 모든 키를 나열한다.

**함께 고칠 문서.** README `## 사용법` 표에 키 열 추가, `## 용어` 표에 "단축키 도움말", `CHANGELOG.md`.

---

### U17. 형제 정렬 설정을 실제로 반영하고 트레일에 저장한다

**목적.** README 가 약속한 `ui.childOrder` 가 동작하게 하고, 트레일마다 고른 정렬이 새로고침 뒤에도 남게 한다.

**변경할 파일.**

- `packages/shared/src/domain/trail.ts` — `childOrder: 'source' | 'click'` 화면 상태(`setChildOrder`)
- `packages/shared/src/domain/storage.ts`, `protocol/schemas.ts` — `StoredTrail.childOrder?`(선택, 저장 버전 1 유지)
- `packages/shared/src/protocol/commands.ts`, `events.ts` — `trail.setChildOrder`(화면 명령), `trail.childOrderChanged`
- `packages/server/src/ws/gateway.ts`, `trails/service.ts` — `updateUi` 경로
- `packages/web/src/features/trail/TrailView.tsx`, `useTrail.ts`, `api/commands.ts`, `app/App.tsx`

**구현 방법.**

1. 트레일 snapshot 에 `childOrder` 를 싣는다. 값이 없으면(옛 저장 파일) `settings.ui.childOrder` 를 쓴다.
2. 툴바 `⇅` 토글은 `commands.setChildOrder` 를 보내고, 이벤트로 돌아온 값을 그린다. `revision` 은 올리지 않는다(접기와 같은 화면 상태).
3. `TrailView` 의 `useState('source')` 를 없앤다.

**검증 방법.**

- 단위 `test/unit/storage.test.mjs`: `childOrder` 있는/없는 저장 파일 왕복.
- E2E: `⇅` 로 클릭 순서 → 새로고침 → 그대로. 설정에서 `click` 으로 바꾸고 새 트레일 → 기본이 클릭 순서.

**완료 기준.** 설정 기본값과 트레일별 선택이 모두 반영되고 저장된다.

**함께 고칠 문서.** 구현서 14.2·15.2, `CHANGELOG.md`.

---

### U18. 사이드바 폭을 끌어 조절하고 접는다

**목적.** 넓은 트리와 긴 파일 이름이 서로 자리를 빼앗지 않게 한다.

**변경할 파일.**

- `packages/web/src/app/App.tsx` — `.sidebar-handle`, 접기 버튼(앱 바 왼쪽 `☰`)
- `packages/web/src/styles/app.css` — `.sidebar` 폭 변수 `--ct-sidebar-width`, `.sidebar.collapsed`

**구현 방법.**

1. 사이드바 오른쪽 가장자리에 4px 손잡이. pointer capture 로 끌어 180px ~ `50vw` 안에서 조절, `localStorage.code-trail.sidebarWidth` 에 저장. 손잡이 더블클릭은 기본 280px 로.
2. 앱 바 왼쪽 `☰` 로 접기·펴기. 접힌 상태에서도 파일 이름 검색은 `Ctrl+P` 로 열 수 있게 한다(검색 입력이 팝오버로 뜬다).
3. 손잡이는 `role="separator"`, `aria-orientation="vertical"`, 포커스 가능, `←`/`→` 로 16px 씩.

**검증 방법.**

- E2E `test/e2e/shell.e2e.mjs`: 손잡이를 120px 끌면 `.sidebar` 폭이 그만큼 늘고 새로고침 뒤 유지. `☰` 로 접으면 `.main` 이 전체 폭.

**완료 기준.** 사이드바 폭 조절·접기가 되고 새로고침에 남는다.

**함께 고칠 문서.** README `## 사용법` 한 줄, `CHANGELOG.md`.

---

### U19. 빈 코드 화면을 시작하기 카드로 바꾸고 탭 순서와 저장 상태를 정리한다

**목적.** 첫 화면에서 "이 프로젝트가 되는지, 다음에 뭘 하면 되는지" 를 보게 한다. 진단 탭을 찾아가지 않아도 되게 한다.

**변경할 파일.**

- `packages/server/src/http/routes.ts` — `/api/bootstrap` 에 `languageSummary: Array<{ language, fileCount }>`
- `packages/server/src/workspace/tree.ts` — 확장자 집계(기존 방문 상한 5,000 디렉터리 안에서)
- `packages/server/src/persistence/scheduler.ts`, `ws/gateway.ts`, `shared/protocol/events.ts` — `trail.persisted { trailId, revision }`
- `packages/web/src/features/start/StartCard.tsx` (신규)
- `packages/web/src/app/App.tsx` — placeholder 대체, 탭 순서, 앱 바 저장 상태
- `packages/web/src/styles/app.css`

**구현 방법.**

1. 시작하기 카드 내용, 위에서 아래로:
   - 프로젝트 이름과 언어 요약: "C# 132 · C++ 14 · TypeScript 3". 각 언어 옆에 U01 의 서버 상태 표시. 지원하지 않는 언어만 있으면 "이 프로젝트의 파일 형식은 심볼 해석을 지원하지 않는다" 와 지원 언어 목록.
   - 시작 방법 세 줄: 파일 열기 → 함수 위에서 `Ctrl+Alt+T` 또는 `▶ 트레일 시작` → 본문의 식별자 클릭.
   - 바로가기: 변경 파일 상위 5개(`/api/changes`), 최근 연 파일 5개(이동 이력). 클릭하면 연다.
   - 언어 서버가 하나도 `ready` 가 아니면 예제 안내: "언어 서버 없이 흐름을 보려면 `code-trail --read-share examples/first-review.ctshare.json`".
2. 탭 순서를 `코드 · 트레일 · 분석 기록 · 진단`(U15 뒤 `설정` 추가)으로 바꾼다. 기본 탭은 `코드`. `분석 기록` 탭 이름의 개수 표시는 유지.
3. 앱 바 트레일 이름 옆에 저장 상태: `trail.persisted` 의 revision 과 현재 revision 이 같으면 "저장됨", 다르면 "저장 중…". 분석 기록 화면이 이미 같은 표시(`디스크 저장됨 · rN`)를 갖고 있으니 모양을 맞춘다.
4. `trail.persisted` 는 `scheduler` 가 파일 쓰기를 끝낸 뒤 방송한다. 서버 종료 중 flush 에서도 보낸다(이미 붙어 있는 연결에만).

**검증 방법.**

- 통합 `test/integration/persistence.test.mjs`: 구조 명령 뒤 debounce 시간 안에 `trail.persisted` 가 오고 revision 이 일치.
- E2E `test/e2e/shell.e2e.mjs`: 첫 화면에 `.start-card`, 언어 요약에 `cpp`, 변경 파일 바로가기 클릭으로 열림, 콘솔 오류 0. 탭 첫 번째가 `코드`.

**완료 기준.** 파일을 열기 전 화면이 준비 상태·시작 방법·바로가기를 보여주고, 앱 바에 저장 상태가 있다.

**함께 고칠 문서.** `## 용어` 표에 "시작하기 카드", `docs/terms.md` "트레일 패널 밖" 그림, README `## 사용법`, 구현서 15.2, `CHANGELOG.md`.

---

### U20. `CLAUDE.md`·`AGENTS.md`·README 의 용어·구조를 1.1.0 구조에 맞춘다

**목적.** 다음 작업자가 이미 있는 모듈을 모르고 다시 만들거나, 없는 규칙을 따르는 일을 막는다.

**변경할 파일.** `CLAUDE.md`, `AGENTS.md`, `README.md`(`## 구조`), `docs/terms.md`.

**구현 방법.**

1. `CLAUDE.md` `## 용어` 표에 `AGENTS.md` 에만 있는 세 줄(분석 기록 화면 · 읽기 시작점 · AI 설명 초안)을 넣어 두 파일을 같게 한다. 이후 두 파일은 diff 가 0 이어야 한다.
2. 양쪽 `## 구조` 에 빠진 모듈을 넣는다.

   ```
   packages/shared/src/domain/     … analysis.ts(분석 기록), share.ts(공유 묶음), ai.ts
   packages/shared/src/protocol/   … analysisSchemas.ts
   packages/server/src/analysis/   분석 기록 정본, 기준 해시, 위치 재탐색
   packages/server/src/sharing/    공유 묶음 내보내기·검증·가져오기·병합
   packages/server/src/git/        변경 목록 (셸 없는 git 호출)
   packages/server/src/ai/         선택 범위만 보내는 loopback Ollama 제공자
   packages/server/src/workspace/contentSearch.ts  제한된 내용 검색
   packages/web/src/features/annotations/  분석 기록 화면
   packages/web/src/features/changes/      읽기 시작점
   test/e2e/analysis.e2e.mjs, share-html.e2e.mjs
   test/perf/analysis-scale.mjs
   ```

3. `## 지금 무엇을 하고 있나` 를 갱신한다: 독립 프로그램 전환(1.0.0) 과 코드 이해·공유(1.1.0) 가 끝났고, 이 문서(`docs/review-ux-improvement-plan.md`)가 다음 진행의 정본이라고 적는다. 남은 외부 검증(T02·T23·T33·T34·T37·T40)은 그대로 링크한다.
4. `## 바꾸면 같이 고칠 것` 에 두 줄을 더한다.
   - 분석 기록 도메인·스키마(`domain/analysis.ts`, `analysisSchemas.ts`) → `docs/share-format.md`, `docs/data-and-recovery.md`, `test/unit/analysis-sharing.test.mjs`
   - 공유 묶음에 들어가는 필드 → `docs/share-format.md` 포함 정책, `examples/first-review.ctshare.json` 무결성 재계산
5. README `## 구조` 도 같은 목록으로.
6. 루트의 작업 메모(`working_prompt.md`)와 작업 로그(`working_log.md`)는 저장소 주인의 결정으로 지웠다. 두 지침 파일의 `## 바꾸면 같이 고칠 것` 에서 작업 로그를 참조하던 줄도 함께 걷어냈다.

**검증 방법.** `diff <(sed -n '/^## 용어/,/^## 지금/p' CLAUDE.md) <(sed -n '/^## 용어/,/^## 지금/p' AGENTS.md)` 가 비어 있다. `## 구조` 의 모든 경로가 실제로 존재한다(`ls`).

**완료 기준.** 두 지침 파일이 같고, 구조 목록이 실제 디렉터리와 일치한다.

**함께 고칠 문서.** 없음(이 태스크 자체가 문서다).

## 5. 종단 간 인수 시나리오

배포 단위 셋이 모두 끝났을 때 실제 브라우저에서 손으로 확인한다. 각 줄이 실패하면 그 태스크를 다시 연다.

1. 새 C# 프로젝트를 열면 시작하기 카드에 "C# N개" 와 서버 상태가 보인다. 솔루션이 둘이면 상태가 "솔루션 선택 필요" 이고 누르면 진단의 그 카드로 간다. (U19, U01)
2. 파일을 열고 `▶ 트레일 시작` 을 누르면 트레일이 자동으로 생기고 이름이 함수 이름이다. (U07, U05)
3. 본문에서 두 줄을 드래그해도 탭이 그대로다. 칩의 `＋ 기록` 을 누르면 기록 열이 열리고 대상이 그 범위다. 분석을 만든 적이 없는데 저장이 된다. (U04, U12, U11)
4. 저장 뒤 노드 헤더에 `✎ 1`, 그 줄에 색 띠가 보인다. 배지를 누르면 기록 열이 그 기록을 보여준다. (U10)
5. 변경 목록에서 hunk 를 누르면 그 줄이 열리고 바뀐 줄에 색 띠가 있다. `변경 보기` 로 좌우 비교가 뜬다. (U14)
6. 외부 에디터로 그 함수를 고치면 트레일 노드에 `바뀜` 이 붙고 `↻` 로 새 코드가 들어온다. (U08)
7. 인터페이스 메서드를 클릭하면 구현이 셋인 목록이 헤더 아래에 뜬다. 하나를 고르면 그것만 붙는다. (U09)
8. 노드 `✕` 를 누르고 8초 안에 되돌리면 순번·진입 링크가 그대로다. `지우기` 는 확인 없이 실행되지 않는다. (U03)
9. 마우스를 치우고 `↓` `→` `Enter` `Delete` `?` 만으로 3~8 을 다시 한다. (U16)
10. 설정 탭에서 밝은 테마로 바꾸면 코드 화면도 밝아진다. (U15)

## 6. 결정이 필요한 것

저장소 주인이 정할 일이다. 이 문서는 추천만 적는다.

| 물음 | 추천 | 이유 |
| --- | --- | --- |
| `textDocument/hover` 를 다섯 번째 요청으로 추가해 식별자 위에 타입·문서를 띄울까 | **지금은 넣지 않는다** | "넷만 쓴다" 는 이 프로젝트가 네 언어를 한 계층으로 지탱하는 근거다. hover 없이도 U01~U19 가 리뷰 동선을 충분히 줄인다. 실제 사용자 관찰(T33)에서 "무엇인지 몰라 파고든다" 가 반복되면 그때 다시 본다 |
| 설정을 새 `설정` 탭에 둘까, 진단 화면의 카드로 둘까 | **새 탭** | 테마를 바꾸러 "진단" 을 누르는 사람은 없다. 외부 에디터·솔루션 선택은 환경 진단이므로 진단에 남긴다 |
| 노드 삭제에 확인만 둘까, 되돌리기까지 만들까 | **되돌리기** | 노드 삭제는 리뷰 중 수십 번 일어난다. 매번 확인하면 흐름이 끊긴다. 서버 버퍼 한 단계(60초)면 충분하다 |
| `변경 보기` 의 원본을 `git show HEAD:path` 로 읽어도 되나 | **된다** | 프로젝트 안 경로만, 변경 목록에 있는 파일만, `ref` 는 `HEAD`·해시만 받는다. 셸을 거치지 않는다 |
| 기록 표시(U10)를 활성 분석 하나로 제한할까, 모든 분석을 합칠까 | **활성 분석 하나** | 여러 분석의 기록을 합치면 "누구의 우려인지" 가 흐려진다. 분석 선택 상자가 이미 있다 |
| `working_prompt.md` 를 저장소에 둘까 | **지웠다** (주인의 결정) | 루트에 작업 메모가 있으면 배포물 검사(`test:pack`)와 README 독자가 혼란스럽다. 작업 로그(`working_log.md`)도 같은 이유로 함께 지웠다 |

## 7. 이 문서가 다루지 않는 것

- 실제 언어 서버 다섯 개와 macOS·Linux 에서의 확인(T02·T23·T37, 구현서 0.13·0.14). 이 기계에 없다.
- 실제 참여자 사용성 평가(T33·T40, [`usability-evaluation.md`](usability-evaluation.md)). 이 문서의 태스크가 끝나면 그 평가의 과제 1~6 을 그대로 쓴다.
- npm 배포. 되돌릴 수 없어 저장소 주인이 정한다.
- 원격 서버·다중 사용자 동시 편집. 구현서 3.2 비목표 그대로다.
- 트리 가상화. [`perf-1000-nodes.md`](perf-1000-nodes.md) 의 판단(목표 안이라 보류)을 유지한다. U10·U12 로 노드가 무거워지면 그 문서의 측정을 다시 돌려 확인한다.

### 7.1 계획과 달라진 것

구현하면서 계획과 다르게 간 곳이다. 이유를 함께 남긴다.

| 계획 | 실제 | 이유 |
| --- | --- | --- |
| U08 이 `trail.nodesStale` 를 새로 만든다 | 쓰이지 않던 `trail.nodeStale` 을 그 이름으로 바꿔 썼다 | 이름이 한 글자 다른 이벤트 둘을 두면 어느 쪽을 보내는지 매번 헷갈린다. `cleared` 를 더해 다시 읽은 노드의 배지를 떼는 신호도 같은 이벤트가 나른다 |
| U09 의 `trail.implementationChoice` 에 `choiceId` 추가 | `choiceId` 를 **nullable** 로 뒀다 | 상한에 걸려 잘렸다는 알림에는 고를 것이 없다. 같은 이벤트가 두 일을 하고, `null` 이 그 구분이다 |
| U03 의 `remove(id)` 가 배열과 인덱스를 돌려준다 | `RemovedSubtree`(루트 노드·부모·인덱스·`nodeUi`·개수) 하나로 돌려준다 | 되돌리기가 필요로 하는 것이 그 다섯이고, 흩어 두면 호출부가 다시 모아야 한다 |
| U11 이 `pendingAnnotation` 패턴을 확장한다 | 분석 자동 생성용 `pendingForNewAnalysis` 를 따로 뒀다 | 기존 것은 앵커를 기다리는 대기열이다. 분석을 기다리는 것과 섞으면 범위 기록이 두 단계를 기다리는 동안 어느 쪽인지 알 수 없다 |
| U15 가 AI endpoint 를 설정 화면에서 받는다 | 안내만 두고 로컬 설정 파일로 미뤘다 | endpoint 는 로컬 설정이고, 웹 입력으로 주소를 받으면 loopback 검사의 의미가 옅어진다. 켜고 끄는 것도 같은 파일에서 한다 |
| U19 의 `languageSummary` 를 `/api/bootstrap` 에 넣는다 | 그대로 넣되 실패해도 시작을 막지 않게 했다 | 큰 저장소에서 세는 일이 시작을 붙잡으면 안 된다. 방문 상한(5,000 디렉터리)에서 끊고 그 사실을 함께 준다 |
| — | `SelectionChip` 에 `mousedown` 기본 동작 막기를 넣었다 | 기본 동작대로면 칩을 누르는 순간 선택이 접히고, 그 `selectionchange` 가 칩을 먼저 지워 클릭이 아무 데도 닿지 않는다. 계획서에 없던 실제 함정이다 |
| — | 버전 검사에서 하드코딩한 `1.1.0` 을 걷어냈다 | `test/pack` · `test/install` 과 공유 묶음의 `producerVersion` 이 루트 `package.json` 하나를 본다. 손으로 적어 두면 올릴 때마다 한쪽이 빠진다 |

### 7.2 이 구현으로 확인한 것

- 단위 163 · 통합 122 가 모두 통과한다. 새로 더한 것은 되돌리기 왕복·`replaceSymbol`·
  형제 정렬 저장(단위), 기록 색인·키보드 이동(순수 함수 단위), 오류 맥락·구현 후보
  목록·되돌리기 만료·`바뀜` 과 다시 읽기·hunk 파싱·`ref` 거부·변경 API 경계·저장
  알림·분석 요약의 `trailIds`(통합)다.
- E2E 넷(`shell` · `trail` · `analysis` · `share-html`)이 실제 Chrome 에서 통과한다.
  `npm run test:pack` 도 통과한다.
- **`npm run test:install` 과 `npm run test:lsp` 는 이번에 돌리지 않았다.** 앞의 것은
  네트워크가 필요하고, 뒤의 것은 이 기계에 실제 언어 서버가 없다.
- 루트의 `working_prompt.md` · `working_log.md` 는 저장소 주인의 결정으로 지웠다.
  이 문서와 `CHANGELOG.md` 가 진행 기록을 대신한다.
