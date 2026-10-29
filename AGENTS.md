# Code Trail

`code-trail <프로젝트 경로>` 로 실행하는 프로그램. 로컬 서버가 뜨고 브라우저가 열린다.
함수 본문을 웹 화면에 인라인으로 펼치고, 코드 안의 식별자를 클릭하면 그 정의가
자식 노드로 중첩되며 쌓이는 코드 탐색 트리다.

**편집기가 아니다.** 코드는 읽기만 하고, 고칠 때는 외부 에디터를 연다.

## 용어

UI 문구·문서·커밋 메시지·코드 주석에서 아래 이름만 쓴다. 같은 것을 두 이름으로 부르지 않는다.
코드 식별자는 영어(오른쪽 칸), 사람에게 보이는 글은 한글(왼쪽 칸)이다.

각각이 화면 어디를 가리키는지는 [`docs/terms.md`](docs/terms.md) 에 그림으로 있다.
**트레일 패널 UI를 바꾸면 `docs/terms.svg` 도 같이 고친다.**

| 용어 | 코드 / DOM | 뜻 |
| --- | --- | --- |
| **앱 바** | `.app-bar` | 맨 위 줄. 파일 탐색기 접기 · 프로젝트 이름 · 트레일 고르기 · 저장 상태 · 서버 상태 표시 · 연결 상태 |
| **파일 탐색기** | `FileTree`·`FileSearch`, `.sidebar` | 왼쪽의 프로젝트 파일 목록과 이름 검색 |
| **코드 화면** | `CodeView`, `.code-view` | Monaco 로 파일 전체를 보여주는 읽기 전용 탭. 여기서 `Ctrl+Alt+T` 를 누르거나 문서 줄의 `▶ 트레일 시작` 을 누른다 |
| **변경 보기** | `.code-view.diff` | 코드 화면을 `HEAD` 대비 좌우 비교로 바꾼 상태. 읽기 전용 Monaco DiffEditor |
| **시작하기 카드** | `StartCard`, `.start-card` | 파일을 열기 전 코드 화면 자리에 보이는 준비 상태·시작 방법·바로가기 |
| **설정 화면** | `SettingsView`, `#settings` | `ui.*`·언어 켜기·작성자·AI 안내를 편집하는 탭 |
| **분석 기록 화면** | `AnalysisPanel`, `.analysis-panel` | 트레일·노드·코드 범위에 설명·질문·우려·결론을 남기고 검토·공유하는 탭 |
| **읽기 시작점** | `ReadingStarts`, `.reading-starts` | 파일 탐색기 아래의 Git 변경 목록·문서 심볼·제한된 내용 검색 |
| **AI 설명 초안** | `AiExplanationDraft`, `.ai-draft` | 선택한 코드 범위만 로컬 제공자에게 보내 받아온 채택 전 설명. 사람이 검토해 채택하기 전에는 분석 기록도 검토 완료도 아니다 |
| **변경 기준** | `ChangeBase`, `.change-base` | 변경 목록·hunk·변경 보기가 무엇과 비교하는지. 작업 트리(기본)·커밋·브랜치 |
| **검토 표시** | `.act.review`, `.badge.reviewed` | 노드 헤더와 hunk 줄의 `☐/☑`. 눌러 `확인함` 을 남기고, 코드가 바뀌면 `재검토` 로 내려간다 |
| **여백 표식** | `.glyph-node`, `.glyph-note` | 코드 화면 왼쪽 여백의 트레일 노드·기록 표시. 누르면 그 노드·기록으로 간다 |
| **분할 보기** | `.main.split` | 코드 화면과 트레일 패널을 나란히 놓은 상태. 좁은 화면에서는 탭으로 돌아간다 |
| **안내 순서 재생** | `WalkthroughPlayer`, `.walkthrough-player` | 화면 아래 고정 막대. `n/m · 제목 · ← 이전 · 다음 →` 로 단계를 따라간다 |
| **개인 화면 상태** | `LocalUiState`, `.code-trail/local/ui-state.json` | 사이드바·기록 열·마지막 문서·이동 이력처럼 이 기계의 이 사람에게만 속한 값 |
| **트레일 목록** | `TrailList`, `.trail-list` | 앱 바에서 여는 트레일 관리 팝오버 |
| **트레일 패널** (줄여서 **패널**) | `TrailView`, `.trail` | 함수 본문이 펼쳐지는 탭 **전체**. "뷰어", "윈도우", "미리보기 창"이라 부르지 않는다 |
| **진단 화면** | `DiagnosticsView`, `#diagnostics` | 언어 서버 상태·점검 결과·로그와 외부 에디터 설정을 보여주는 탭 |
| **서버 상태 표시** | `LspStatus`, `.lsp-status` | 앱 바와 코드 화면 문서 줄에 붙는 현재 문서 언어의 언어 서버 상태. 누르면 진단 화면의 그 언어 카드로 간다 |
| **알림** | `Notices`, `.notices`·`.notice` | 화면 오른쪽 아래에 쌓이는 메시지. 수준(info/warn/error)과 행동 버튼을 가진다. 화면이 사람에게 말하는 **유일한** 통로다 |
| **선택 칩** | `SelectionChip`, `.selection-chip` | 본문이나 코드 화면에서 글자를 드래그하면 선택 끝에 뜨는 버튼 묶음(`＋ 기록` · `AI 초안` · `복사`) |
| **단축키 도움말** | `ShortcutsHelp`, `.shortcuts` | `?` 로 띄우는 키 목록 오버레이 |
| **트레일** | `Trail` | 패널에 담긴 탐색 트리 전체. 자동 저장과 Markdown 내보내기의 단위 |
| **루트** | `Trail.roots` | `Ctrl+Alt+T` 로 시작한 최상위 노드. 여러 개 있을 수 있다 |
| **노드** | `TrailNode`, `.node` | 심볼 하나가 차지하는 덩어리 = 헤더 + 진입 링크 + 본문 + 자식. "카드", "박스"가 아니다 |
| **헤더** | `.hd` | 노드의 첫 줄. `종류 · 이름 · 시그니처 · 경로:줄 · 배지 · 버튼`. 클릭하면 접힌다 |
| **본문** | `.body`, 그 안의 `.code` | 노드가 보여주는 원본 코드 영역. "스니펫", "코드 미리보기"가 아니다 |
| **진입 링크** | `TrailOrigin`, `.origin` | 헤더 밑의 `↑ A 의 127번째 줄 Find`. 누르면 부모의 호출부로 돌아간다 |
| **호출부** | `origin.line` / `origin.char`, `.clickable.visited` | 부모 본문에서 클릭했던 그 지점. 펼쳐본 뒤에는 ①②③ 순번이 붙는다 |
| **순번** | `.idx`(헤더), `data-idx`(호출부) | 형제 노드 번호. 부모 호출부의 ①과 자식 노드의 ①이 한 짝이다 |
| **배지** | `.badge` | 헤더 오른쪽의 `재귀` · `선언만` · `근사` · `바뀜` · `✓`(확인함) · `재검토` |
| **기록 표시** | `.badge.notes`, `.cl.noted` | 노드 헤더의 `✎ N` 배지와 본문 줄 왼쪽의 색 띠. 그 노드·줄에 분석 기록이 있다는 뜻 |
| **기록 열** | `AnnotationColumn`, `.annotation-column` | 트레일 패널과 코드 화면 오른쪽의 접이식 세로 영역. 보고 있는 것(활성 노드 또는 열린 파일)의 기록 목록과 작성 칸이 있다 |
| **후보 팝오버** | `ChoicePopover`, `.choice` | 정의·구현 후보를 클릭한 식별자(또는 그 노드 헤더) 바로 아래에서 고르는 창 |
| **노드 메뉴** | `NodeMenu`, `.node-menu` | 헤더 우클릭 또는 `⋯` 로 여는 노드 단위 행동 목록 |
| **브레드크럼** | `#breadcrumb` | 패널 위쪽의 현재 경로 줄 |
| **툴바** | `#toolbar` | 전체 펼치기·접기, 정렬, 보드 전환, 자동 배치, 필터, 내보내기, 지우기 버튼 줄. 오른쪽 끝에 노드 수·기록 수·검토 수 |
| **트리 모드 / 보드 모드** | `#root.board`, `Trail.mode` | 기본은 **트리 모드**(자식이 부모 안에 중첩). **보드 모드**는 노드를 캔버스에 자유 배치하고 헤더를 끌어 옮긴다 |
| **연결선** | `.board-lines path` | 보드 모드에서 부모 오른쪽 → 자식 왼쪽을 잇는 곡선. 트리 모드의 가이드선에 해당한다 |
| **폭 맞춤** | `useFitToWidth`, `--ct-code-font-size` | 가장 빠듯한 노드에 맞춰 **코드 본문** 글자만 줄이는 것. 헤더는 안 줄인다 |
| **심볼** | `ResolvedSymbol` | 언어 서버가 준 정의 하나 + 본문 코드 + 좌표. 노드가 감싸고 있는 알맹이 |
| **클릭 후보** | `.tok.clickable` | 토크나이저가 좌표를 심어둔 식별자 span. 주석·문자열 안의 단어는 후보가 아니다 |
| **문서 권한** | `DocumentGrant`, `documentId` | 서버가 발급한 불투명한 파일 ID. 브라우저는 경로를 모르고 이것만 들고 있다 |

동사는 이렇게 쓴다.

- **펼치다 / 접다** — 본문을 보이게 / 감추게 하는 것(`collapsed`). 새 자식이 생기는
  경우(식별자 클릭, `⚑`)에도 "펼친다"고 쓴다. 사용자 눈에는 같은 동작이다.
- **붙이다** — 트리에 노드를 새로 다는 것(`addChild`). 접기/펼치기와 구분해야 할 때만 쓴다.
- **파고들다** — 한 단계 더 들어가는 사용자 행위. 문서에서만 쓰고 코드 이름에는 안 쓴다.

## 지금 무엇을 하고 있나

**기능은 네 묶음이 끝났다.** 독립 프로그램 전환(1.0.0), 코드 이해·공유(1.1.0),
리뷰 도구로서의 사용성 개선(1.2.0~1.4.0), 변경 기준·검토 표시·안내 순서(1.7.0)다.
**1.8.0 은 공개 준비다** — 의존성 보안 업데이트, Node 22.12 요구, npm 패키지 README·LICENSE,
스크린샷과 README 개편, 문서 정리. 앱 동작과 저장·공유 형식은 1.7.0 과 같다.

남은 것은 **이 기계에서 할 수 없는 확인**뿐이고, 그 정본은
[`docs/compatibility.md`](docs/compatibility.md) 의 `남은 실환경 검증` 이다 — 실제 언어 서버 넷
(C/C++·C#·Go·Rust, TypeScript 는 일부 확인), macOS·Linux 확인, 서로 다른 기계 간 공유·회신,
실제 참여자 사용성 평가, npm 배포(CONTRIBUTING.md 의 릴리스 절차).

네 계획서([`docs/design-history.md`](docs/design-history.md) 한 파일에 합쳤다)는 설계 결정의 근거이고 역사다.

- `packages/` 가 전부다. VS Code 확장 소스(`src/`, `media/`)와 `.vsix` 흐름은 1.0.0 에서 지웠다.
  확장 마지막 상태는 태그 `v0.6.0-vscode-extension` 이고 기준선 기록은 [`docs/design-history.md`](docs/design-history.md) 다.
- 언어 서버는 어댑터가 찾는다(설정 → PATH → 플랫폼별·GOBIN·rustup). **자동으로 내려받지 않는다.**
- **실제 언어 서버로 검증하지 못한 것이 있다.** 이 기계에 clangd·gopls·roslyn 이 없고
  rust-analyzer 는 rustup proxy 만 있다(typescript-language-server 는 1.8.0 준비 때 설치해 Windows 에서 확인했다).
  `npm run test:pack` · `npm run test:install` 은 Windows 에서만 실제로 돌렸다.
  어느 줄이 그런지는 구현서 0.7 · 0.13 · 0.14 와 `docs/compatibility.md` 에 표시해 뒀다.
- 확장에서 되던 동작이 새 프로그램의 무엇으로 옮겨졌는지는 [`docs/design-history.md`](docs/design-history.md) 에 있다.

지금 되는 것을 눈으로 보려면:

```
npm run build
npm run start -- <프로젝트 경로>
```

## 명령

```
npm install

npm run build                   # shared → server → web → cli
npm run start -- <경로>         # 서버를 띄우고 브라우저를 연다
npm run dev                     # Vite 개발 서버 (웹만 고칠 때)
npm run typecheck               # 모든 workspace
npm test                        # test/unit + test/integration (브라우저 불필요)
npm run test:unit                # 단위만
npm run test:integration         # 통합만
npm run test:e2e                # 진짜 서버 + 진짜 브라우저 (playwright 필요)
npm run test:lsp                # 실제 언어 서버 스모크. 설치된 언어만 돈다
npm run test:pack               # 배포물 파일 목록 + 외부 의존성 고지 검사 (npm pack --dry-run)
npm run test:install            # tarball 을 깨끗한 폴더에 설치하고 띄워 본다
npm run release:check            # 브라우저 없이 되는 전부 (build · typecheck · test · pack · install)
npm run test:perf               # 1,000개 노드 성능 측정 → docs/perf-1000-nodes.md
```

`npm test` 는 빌드된 `packages/*/dist` 를 불러온다. 먼저 `npm run build` 를 돌린다.
브라우저를 쓰는 것(`test:e2e`, `test:perf`)은 컨테이너의 프리설치 Chromium을 기본으로 찾는다.
경로가 다르면 `CT_CHROME=/path/to/chrome` 로 넘긴다.

## 지켜야 할 것

**심볼 해석은 전부 언어 서버가 한다.** 자체 파서를 만들지 않는다.
쓰는 요청은 넷뿐이다.

```
textDocument/definition        식별자의 정의
textDocument/documentSymbol    심볼 목록과 본문 범위
textDocument/implementation    구현 찾기
textDocument/typeDefinition    정의 폴백
```

**이 넷만 쓴다.** C++·C#·Go·Rust를 동시에 지원하는 유일한 방법이고, 언어별 분기를
공통 계층에 넣지 않는 이유다. 특히 `textDocument/references` 를 구현 찾기 폴백으로 쓰지
않는다 — 참조에는 호출부가 섞여 있어서 "이 메서드를 부르는 함수"가 구현으로 붙는다.
`test/fake-lsp/server.mjs` 가 그 요청이 오면 stderr에 표시를 남기고 테스트가 그걸 잡는다.

**`packages/web/src/tokenizer/` 는 하이라이팅과 "클릭 후보 고르기"만 담당한다.**
정확도를 책임지지 않는다. 식별자 토큰에 원본 파일 기준 절대 좌표
(`line`, `char`, 둘 다 0-based UTF-16)를 심고, 그 좌표를 그대로 언어 서버에 넘기는 것이
전부다. 여기에 타입 추론이나 스코프 해석을 넣지 않는다.
단 주석·문자열 안의 단어는 클릭 대상에서 제외해야 한다 (테스트가 이걸 검증한다).

**코드를 표시할 때 원본 문자열을 변형하지 않는다.**
공통 들여쓰기 제거, 탭→스페이스 변환 모두 금지. 컬럼 좌표가 어긋난다.

**트레일의 정본은 서버에 있다.** 화면은 명령을 보내고 이벤트를 받아서만 바뀐다 —
낙관적으로 먼저 그려두면 서버가 거절했을 때(오래된 revision, 권한 없는 문서) 두 상태가
어긋나고, 그 어긋남은 다음 명령의 `baseRevision` 을 타고 번진다.

**개인 화면 상태는 `localStorage` 가 아니라 서버에 남긴다.** origin 이
`127.0.0.1:<포트>` 이고 포트 기본값이 0(운영체제가 고른다)이라 서버를 다시 띄우면 다른
origin 이 된다 — `localStorage` 에 넣은 값은 매번 초기화된다. 사이드바 폭·기록 열·탭·
마지막 문서·이동 이력·변경 기준은 `.code-trail/local/ui-state.json` 이 들고 있고,
**절대경로·documentId·토큰은 담지 않는다.** 방송하지도 않는다 — 옆 탭의 사이드바 폭이
따라 움직이면 방해다.

**화면 상태는 revision 을 올리지 않는다.** 접기(`trail.toggleNode`), 모드 전환,
보드 좌표, 활성 노드는 트리 모양을 바꾸지 않는다. revision 을 올리면 노드를 하나 누른
것만으로 그 순간 날아가던 구조 명령이 `STALE_REVISION` 으로 거절된다.

**폭 맞춤은 코드 본문에만 건다.** `.code` 는 `--ct-code-font-size` 를 쓰고
`useFitToWidth` 가 이것만 덮어쓴다. 헤더 이름(`.name`)이 쓰는 `--ct-font-size` 는
건드리지 않는다 — 헤더까지 작아지면 트리 구조가 안 읽힌다.
새 UI를 넣을 때 `--ct-font-size` 를 "코드 폰트"로 오해하지 않는다.

폭 맞춤이 일을 하려면 **본문 폭이 묶여 있어야 한다.** 트리 모드는
`--ct-tree-node-width`, 보드 모드는 `--ct-board-width` 로 노드 폭을 정한다.
이 폭을 없애고 내용에 맞춰 늘리면 본문이 넘칠 일이 없어져 폭 맞춤이 조용히
아무 일도 안 하는 설정이 된다. `Ctrl+휠` 로 사용자가 맞춘 노드는 `.code[data-fs]`
표시가 붙고, 폭 맞춤은 그 노드를 재지도 바꾸지도 않는다.

**부모-자식 관계는 "클릭한 코드가 어느 노드에 속했는가"로만 정해진다.**
A 안에서 B, C를 클릭하면 둘 다 A의 형제 자식이다. 이 규칙을 깨지 않는다.
보드 모드에서 노드를 아무 데나 끌어다 놓아도 이 관계는 바뀌지 않는다 — 화면 배치일 뿐이다.
관계를 바꾸는 것은 `⇱`(새 루트로 떼어내기) 하나뿐이다.

**보드 모드에서는 노드를 `#root` 바로 아래에 평평하게 늘어놓는다.**
중첩된 채로 절대 배치를 하면 자식 좌표가 부모 기준이 되어 엉킨다.
그래서 자식을 DOM 이 아니라 모델에서 찾는다 — `features/trail/board.ts` 의
`flattenTree`·`connectors` 다. DOM 순회로 되돌리지 않는다. 두 모드 모두에서 깨진다.

**브라우저는 파일 경로를 모른다.** 서버가 발급한 불투명한 `documentId` 로만 문서를
요청한다. 프로젝트 밖 파일(표준 라이브러리 헤더 등)은 언어 서버가 결과로 돌려줬을 때만
권한을 얻고, 서버를 다시 띄우면 사라진다. 저장에서 불러온 노드에는 **프로젝트 안 파일만**
권한을 다시 발급한다.

**외부 에디터는 브라우저가 보낸 경로로 열지 않는다.** 브라우저는 `documentId` 만
보내고 실제 경로는 서버가 문서 권한 목록에서 역조회한다. 실행은 `shell: false` 로
실행 파일과 argv 배열을 그대로 넘긴다 — 파일 이름에 `;` 가 있어도 인자 하나로 간다.
자리표시자는 `{path}`, `{line}`, `{column}`, `{project}` 넷뿐이고 모르는 것이 있으면
실행하지 않고 이유를 알린다. 못 열었을 때는 경로와 줄을 돌려줘 복사할 수 있게 한다.

**진단 화면의 `지원됨` 은 프로세스가 떴다는 뜻이 아니다.** 실제 샘플 문서에서
`documentSymbol` 과 `definition` 이 응답했다는 뜻이고, 그 확인은 `lsp.verify` 명령이
사용자가 눌렀을 때만 돈다. 진단 화면을 여는 것만으로 다섯 언어 서버를 다 띄우지 않는다.

**오류에 절대경로·코드 본문·환경 변수·토큰을 담지 않는다.** 브라우저는 신뢰 경계 밖이고,
오류 메시지는 그 경계를 넘는 통로다. 실행 파일도 이름만 내보낸다.

**종료가 시작되면 새 연결도 새 명령도 받지 않는다.** 종료 절차는 저장을 끝낸 뒤
언어 서버를 내린다. 그 사이에 들어온 명령을 처리하면 트레일이 또 바뀌고 그 변경은
어디에도 안 남는다. HTTP 는 503, WebSocket 은 붙자마자 1001 로 닫고, 이미 붙어 있던
연결의 명령에는 `SERVER_STOPPING` 을 돌려준다. 업그레이드 요청에 평범한 HTTP 응답을
쓰면 어느 쪽으로도 끝나지 않으므로, 그 판단은 `app.ts` 훅이 아니라 게이트웨이가 한다.

**언어 서버를 자동으로 내려받지 않는다.** 설치 명령은 진단 화면이 안내만 한다.

**화면이 사람에게 말하는 통로는 알림 하나다.** `Notices` 밖에 오류 표시를 새로
만들지 않는다. 예전에는 닫을 수 없는 패널 오류와 서로 덮어쓰는 토스트가 따로 있었고,
같은 `command.error` 를 두 모양으로 보여줬다. 목록 자체를 못 읽은 경우처럼 **그 자리에
적어야 뜻이 통하는 것**만 예외다(`.tree-error`).

**오류는 다음 행동까지 말한다.** 해석이 실패하면 `CommandError.context` 에 언어·서버
상태·`action` 을 실어 보내고, 화면은 그것으로 버튼을 만든다. "언어 서버가 켜져 있는지
확인한다" 한 줄로는 사용자가 무엇을 할지 모른다. **맥락에 경로·실행 파일 위치를 담지
않는다** — 담는 것은 상태뿐이다.

**되돌릴 수 없는 삭제에만 확인을 붙인다.** 툴바 `지우기`, 트레일 목록의 트레일 삭제,
보드 `⟲ 자동 배치` 는 인라인 확인을 거치고, 노드 삭제와 `⇱` 는 확인 대신
되돌리기(8초 알림 / 서버 버퍼 60초)다. 리뷰 중 수십 번 일어나는 일에 매번 확인을 띄우면
사람은 곧 읽지 않고 누른다.

**되돌리기 버퍼는 한 단계다.** 삭제·승격 뒤 다른 구조 명령이 들어오면 원래 자리가 더 이상
그 자리가 아니므로 `TrailService.mutate` 가 버퍼를 비운다. 둘은 **같은 버퍼**를 나눠
쓴다 — 직전 한 번만 되돌릴 수 있다. 여러 단계를 쌓으려면 트리
변경 이력을 통째로 들고 있어야 한다.

**CI 를 두지 않는다.** 저장소 주인의 결정이다. `.github/workflows/` 를 만들지 않고,
계획 문서에도 CI 항목을 넣지 않는다. 플랫폼별 확인이 필요하면 그 환경에서
`npm test` · `npm run test:e2e` · `npm run test:install` 을 손으로 돌린다.
필요해지면 주인이 직접 요청한다.

**루트에 작업 로그·작업 메모를 두지 않는다.** 저장소 주인의 결정이다
(`docs/design-history.md` 6장). `working_log.md` · `working_prompt.md` 를
만들지 않는다 — 사용자 공통 규칙에 작업 로그 항목이 있어도 **이 저장소에서는 쓰지
않는다.** 무엇을 왜 바꿨는지는 커밋 메시지와 `CHANGELOG.md`, 그리고 `docs/` 의 계획
문서가 이미 담는다. 같은 내용을 네 번째 자리에 또 적으면 어느 것이 정본인지 알 수 없고,
배포물 검사와 README 독자에게도 혼란스럽다. 실수로 되살아나지 않게 `.gitignore` 에도 적어 뒀다.

## 구조

npm workspaces. 배포하는 것은 `packages/cli` 의 `code-trail` 이다.

```
packages/shared/src/domain/     ResolvedSymbol, Trail, 설정, 저장 스키마, Markdown, UUID
                                analysis.ts(분석 기록), share.ts(공유 묶음), ai.ts
packages/shared/src/protocol/   명령·이벤트 타입과 Zod 런타임 스키마, analysisSchemas.ts

packages/server/src/security/   토큰, Host·Origin 검사, 경로 경계, CSP
packages/server/src/persistence/ .code-trail/ 저장소, 원자적 쓰기, debounce, 잠금 파일
                                localUiStateStore.ts(개인 화면 상태)
packages/server/src/workspace/  파일 트리, 이름 검색, 문서 권한(documentId), 파일 감시
packages/server/src/trails/     트레일 정본과 mutation queue
packages/server/src/config/     로그. 절대경로와 토큰을 남기지 않는다
packages/server/src/http/       읽기 전용 API
packages/server/src/ws/         명령 수신과 이벤트 방송
packages/server/src/lsp/        JSON-RPC 전송, 문서 동기화, 상태 머신·재시작
packages/server/src/lsp/adapters/  언어별 탐지·진단. 언어를 아는 유일한 자리다
packages/server/src/symbols/    평탄화, 심볼 선택, 본문 범위, 선언만 판정
packages/server/src/editor/     외부 에디터 탐지와 실행 (shell 없이, documentId 역조회)
packages/server/src/analysis/   분석 기록 정본, 기준 해시, 위치 재탐색
packages/server/src/sharing/    공유 묶음 내보내기·검증·가져오기·병합
packages/server/src/git/        변경 목록과 hunk (셸 없는 git 호출)
packages/server/src/ai/         선택 범위만 보내는 loopback Ollama 제공자
packages/server/src/workspace/contentSearch.ts  제한된 내용 검색

packages/web/src/app/           화면 뼈대. 앱 바, 탭, 소켓 이벤트 배분
packages/web/src/api/           토큰 부트스트랩, HTTP, WebSocket, 명령 보내기
packages/web/src/tokenizer/     하이라이팅 + 식별자에 좌표 심기 (순수 함수)
packages/web/src/features/      파일 탐색기, 검색, 코드 화면, 트레일 화면, 진단 화면
packages/web/src/features/annotations/  분석 기록 화면, 기록 카드·작성 칸·기록 열
packages/web/src/features/changes/      읽기 시작점 (변경 목록·hunk·문서 심볼·내용 검색)
packages/web/src/features/notices/      알림 하나로 합친 메시지 통로
packages/web/src/features/selection/    선택 칩
packages/web/src/features/settings/     설정 화면
packages/web/src/features/start/        시작하기 카드
packages/web/src/features/help/         단축키 도움말
packages/web/src/features/trail/board.ts           보드 배치 계산 (순수 함수)
packages/web/src/features/trail/annotationIndex.ts 기록·검토 색인, 하위 요약 (순수 함수)
packages/web/src/features/trail/filter.ts          이름·본문·기록 필터 (순수 함수)
packages/web/src/features/trail/keyboard.ts        키보드 이동 (순수 함수)
packages/web/src/features/source/gutterIndex.ts    코드 화면 여백 표식 색인 (순수 함수)
packages/web/src/features/annotations/annotationList.ts 기록 목록 거르기·정렬 (순수 함수)
packages/web/src/styles/        app.css(변수·뼈대) 와 trail.css(노드·보드)
packages/cli/src/               인자 해석, 서버 재사용 감지, 브라우저 열기

test/unit/                      도메인·프로토콜·심볼 선택·보드 배치·기록 색인·키보드 이동·CLI 인자 (node:test)
test/integration/               진짜 서버 + 가짜 언어 서버 + 외부 에디터 + 경계 (node:test)
test/e2e/                       진짜 브라우저까지 (playwright)
test/fake-lsp/                  나쁜 언어 서버를 흉내내는 stdio fixture
test/smoke/                     실제 언어 서버 스모크 (설치된 언어만)
test/pack/                      배포물 파일 목록과 설치 스모크
test/perf/                      1,000개 노드 성능 측정과 분석 규모 측정
test/fixtures/                  확장 시절 데이터를 굳혀 둔 것. **고치지 않는다**
```

브라우저 없이 테스트하는 웹 모듈(`board.ts`·`annotationIndex.ts`·`filter.ts`·
`keyboard.ts`·`gutterIndex.ts`·`annotationList.ts`·`tokenizer/`)은 `packages/web/tsconfig.lib.json` 의 `include` 에 있어야 한다.
`npm run build:lib` 가 그것만 `packages/web/lib/` 로 내보내고 `test/unit/` 이 그걸 읽는다.
**순수 함수를 새로 만들면 그 목록에 넣는다** — 안 넣으면 테스트가 모듈을 못 찾는다.

`packages/shared` 는 파일 시스템·네트워크·DOM 어디에도 의존하지 않는다.
서버·CLI·브라우저가 함께 쓰기 때문이다. 둘이 지킨다 —
`test/unit/shared-independence.test.mjs` 가 `vscode` 와 Node 전용 모듈(`node:*`, `fs`,
`path`, `child_process` …)을 잡고, `packages/shared/tsconfig.json` 이 `lib` 에서
`DOM` 을 빼서 `document`·`window` 를 컴파일 단계에서 막는다. **`DOM` 을 다시 넣지 않는다.**

## 바꾸면 같이 고칠 것

한쪽만 고치면 티 안 나게 낡는 것들이다. **코드를 고칠 때마다 이 표를 훑는다.**

| 고친 곳 | 같이 고칠 것 |
| --- | --- |
| 헤더 구성·배지·버튼 (`features/trail/TrailNode.tsx`, `trail.css`) | `docs/terms.svg` 의 헤더 줄과 콜아웃, README `### 헤더에 표시되는 것` · `### 표시되는 배지`, `test/e2e/trail.e2e.mjs` |
| 툴바 버튼 추가·삭제 (`TrailView.tsx`) | `docs/terms.svg` 의 툴바, README `## 사용법` |
| 화면에 새 부위가 생김 (새 영역·새 버튼·새 표시) | `## 용어` 표에 이름 한 줄, 트레일 패널 안이면 `docs/terms.svg` 에 그 부위와 콜아웃 |
| 용어를 바꾸거나 새로 정함 | `## 용어` 표, `docs/terms.*`, 그리고 UI 문구를 같은 말로 |
| 사용자가 체감하는 동작 변경 | `CHANGELOG.md` 새 항목 + 네 `package.json` 의 `version` |
| `packages/shared` 의 도메인 타입 | `packages/shared/src/protocol/schemas.ts` 의 같은 스키마 (`satisfies` 가 컴파일에서 잡는다), `test/unit/` |
| 새 명령·이벤트 추가 | `protocol/commands.ts` 또는 `events.ts` 의 payload 스키마, 구현서 14.2·15.2, `test/unit/protocol.test.mjs` 의 목록 |
| HTTP 경로 추가 | 구현서 15.1 표, `test/integration/resilience.test.mjs` 의 인증 훑기가 자동으로 잡는다 |
| 경로를 받는 새 API | `security/paths.ts` 를 반드시 통과시키고 `test/integration/security.test.mjs` 에 탈출 시도 한 줄 |
| LSP 요청·응답 처리 변경 | `test/fake-lsp/server.mjs` 에 그 상황을 재현하는 시나리오와 `test/integration/lsp.test.mjs` 한 줄 |
| 심볼 선택·본문 범위 규칙 | `test/unit/symbols.test.mjs`, 그리고 구현서 13장 |
| `packages/web/src/tokenizer/` | `test/unit/tokenizer-port.test.mjs`. 주석·문자열 제외가 깨지면 여기서 걸린다 |
| 언어별 탐지·진단 | 그 어댑터 파일 하나 안에서만. 공통 계층에 `if (language === ...)` 를 넣지 않는다 |
| 보드 배치 규칙 (`features/trail/board.ts`) | `test/unit/board.test.mjs`, `test/e2e/trail.e2e.mjs` 의 `[보드 모드]`, 무거워졌으면 `docs/perf-1000-nodes.md` |
| 외부 에디터 실행 경로 (`server/src/editor/`) | `test/integration/editor.test.mjs` 에 셸 특수문자 한 줄. 자리표시자를 늘리면 README `## 설정` 과 구현서 17.1 |
| 진단 화면에 항목 추가 | `LspSessionInfo` → `/api/diagnostics` → `LanguageDiagnostics` → `DiagnosticsView` 넷을 한 벌로, 그리고 구현서 18 |
| `.code-trail/settings.json` 항목 추가 | `shared/domain/settings.ts`, `protocol/schemas.ts`, `features/settings/SettingsView.tsx`, README `## 설정` |
| 분석 기록 도메인·스키마 (`domain/analysis.ts`, `analysisSchemas.ts`) | `docs/data-formats.md`, `test/unit/analysis-sharing.test.mjs` |
| 공유 묶음에 들어가는 필드 | `docs/data-formats.md` 의 포함 정책, `examples/first-review.ctshare.json` 무결성 재계산 |
| 기록이 노드·줄에 붙는 규칙 (`features/trail/annotationIndex.ts`) | `test/unit/annotation-index.test.mjs`, `test/e2e/analysis.e2e.mjs` |
| 키보드 이동 규칙 (`features/trail/keyboard.ts`) | `test/unit/keyboard.test.mjs`, `features/help/ShortcutsHelp.tsx`, README `## 사용법` 의 키 표 |
| 트레일 필터 규칙 (`features/trail/filter.ts`) | `test/unit/trail-filter.test.mjs`, README `## 사용법` 필터 줄 |
| 여백 표식 규칙 (`features/source/gutterIndex.ts`) | `test/unit/gutter-index.test.mjs`, `test/e2e/trail.e2e.mjs` |
| 기록 목록 거르기·정렬 (`features/annotations/annotationList.ts`) | `test/unit/annotation-list.test.mjs` |
| 개인 화면 상태에 항목 추가 (`protocol/schemas.ts` 의 `localUiStateSchema`) | `persistence/localUiStateStore.ts`, `App.tsx` 의 저장·복원, `test/integration/persistence.test.mjs`, `docs/data-formats.md` |
| Markdown 형식 (`shared/domain/markdown.ts`) | `test/unit/markdown.test.mjs`, `server/src/sharing/service.ts` 의 `staticHtml`, `docs/data-formats.md` |
| 알림을 새로 띄우는 자리 | `features/notices/useNotices.ts` 를 지난다. 새 표시 요소를 만들지 않는다 |
| `package.json` 의 `files`·`bin`·의존성 | `npm run test:pack` 과 `npm run test:install` 을 돌린다. 새 런타임 의존성은 `THIRD-PARTY-NOTICES.md` 에도 |
| CLI 인자 추가 | `packages/cli/src/args.ts` 의 `USAGE`, README `## 설치와 실행` 표, `test/unit/cli-args.test.mjs` |
| `LICENSE` | `packages/*/LICENSE` 넷에 같은 내용을 복사한다 (심볼릭 링크는 Windows·npm pack 에서 깨진다) |
| 배포 의존성(`dependencies`) | `node test/pack/third-party-notices.mjs --write` 로 `THIRD-PARTY-NOTICES.md` 를 다시 만든다. `npm run test:pack` 이 어긋남을 잡는다 |
| README 그림 (`docs/images/`) | 스크린샷은 이 저장소 자체를 TypeScript 언어 서버로 열어 Playwright 로 찍은 것이다. 1600px 안팎·한 장 400KB 아래로, 주소창(토큰)과 로컬 경로가 안 찍히게 앱 영역만 자른다 |
| 언어 서버 예외 처리 추가 | 아래 `## 언어 서버별 함정` |

이 중 기계가 잡아주는 것은 프로토콜 스키마(컴파일), 명령 목록(`test/unit/protocol.test.mjs`),
API 인증(`test/integration/resilience.test.mjs`), 배포물 목록(`npm run test:pack`) 넷이다.
나머지는 사람이 챙긴다.

`docs/terms.svg` 는 손으로 쓴 SVG다. 좌표가 전부 상수로 박혀 있으니
`<!-- 노드 A 헤더 -->` 같은 주석으로 구역을 찾아 그 근처만 고친다.
고친 뒤에는 브라우저로 열어 글자가 겹치거나 지시선이 코드 위를 가로지르지 않는지 눈으로 본다.

## 언어 서버별 함정

- **Roslyn(C#)** 은 심볼 이름에 시그니처를 통째로 넣는다
  (`Foo(string, int) : Task<T>`). 표시할 때 `(` 앞까지만 잘라 쓴다.
- 일부 C++ 서버는 함수의 `range` 를 한 줄만 준다. 이때 `contextLines` 로
  보정하고 `approximate` 플래그를 세운다.
- 인터페이스 메서드는 정의가 선언뿐이다. 코드에 `{` 가 없으면 `declarationOnly` 로
  표시하고, 사용자가 `⚑` 로 구현을 찾아갈 수 있게 한다.
  구현이 **정확히 하나**면 `resolveFlow.autoFollowSingleImplementation` 이 그것까지 바로 붙인다.
  **둘 이상일 때 하나를 골라 붙이지 않는다** — 호출부의 정적 타입만으로는 어느 구현이
  도는지 알 수 없고, 자동으로 고르면 그게 실행되는 코드라고 오해하게 된다.
  `SymbolResolver.resolveImplementations` 에는 **참조 검색 폴백 자체가 없다.**
  확장에는 껐다 켤 수 있는 폴백이 있었지만, 새 구현에서는 그 통로를 두지 않았다 —
  참조에는 호출부가 섞여 있어서 "이 메서드를 부르는 함수" 가 구현으로 붙는다.
  선언 노드는 어느 쪽이든 지우지 않는다. "인터페이스를 거쳐 갔다"도 경로의 일부다.
- **뜨자마자 죽는 서버**는 매번 `initialize` 에 성공한다. 그래서 성공만으로 재시도
  횟수를 되돌리면 자동 재시작이 영원히 멈추지 않는다. 요청 하나가 실제로 응답했거나
  (`markStable`) 뜬 채로 `STABLE_AFTER_MS` 를 버텼을 때만 되돌린다.
- **clangd** 에게 빌드 플래그를 만들어 주지 않는다. 헤더 탐색 경로를 우리가 계산하기
  시작하면 그 계산이 틀릴 때마다 사용자가 우리를 의심하게 되고, 정확도의 책임이 언어
  서버에서 우리에게 넘어온다. `compile_commands.json` 이 있는지 알려주는 것까지가 우리 몫이다.
- **rust-analyzer 만 진단 화면에 전체 경로를 보여준다.** "실행 파일은 이름만 내보낸다"
  규칙의 **의도된 예외**다. `PATH` 의 `rust-analyzer` 가 rustup proxy 인데 그 toolchain 에
  실제 서버가 없는 경우가 흔하고, 경로를 안 보여주면 무엇을 고쳐야 할지 알 수 없다.
  감추려는 것은 프로젝트의 파일 구조이지 사용자가 직접 설치한 도구의 위치가 아니다.
  이 줄을 "버그" 로 보고 고치지 않는다.
- **Windows 의 `.cmd`/`.bat` shim** 은 `shell: false` 로 못 띄운다(Node CVE-2024-27980 대응).
  탐지에서 빼고, 설정에 적혀 있으면 그 이유를 알린다. `cmd /c` 로 우회하지 않는다 —
  인자가 셸 문법으로 해석되면 "셸을 거치지 않는다" 규칙이 무너진다.
- **typescript-language-server의 Windows npm shim도 같은 예외다.** 전역 패키지의
  `lib/cli.mjs`를 찾았을 때만 현재 Node 실행 파일로 직접 `--stdio` 기동한다. 프로젝트의
  `node_modules`를 자동 실행하지 않는다.
