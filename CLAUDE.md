# Code Tail
VS Code 확장. 함수 본문을 웹뷰 패널에 인라인으로 펼치고, 코드 안의 식별자를 클릭하면
그 정의가 자식 노드로 중첩되며 쌓이는 코드 탐색 트리.

## 용어

UI 문구·문서·커밋 메시지·코드 주석에서 아래 이름만 쓴다. 같은 것을 두 이름으로 부르지 않는다.
코드 식별자는 영어(오른쪽 칸), 사람에게 보이는 글은 한글(왼쪽 칸)이다.

각각이 화면 어디를 가리키는지는 [`docs/terms.md`](docs/terms.md) 에 그림으로 있다.
**패널 UI를 바꾸면 `docs/terms.svg` 도 같이 고친다.**

| 용어 | 코드 / DOM | 뜻 |
| --- | --- | --- |
| **트레일 패널** (줄여서 **패널**) | `TrailPanel`, viewType `codeTrail.panel` | 함수 본문이 펼쳐지는 웹뷰 창 **전체**. "뷰어", "윈도우", "미리보기 창"이라 부르지 않는다 |
| **트레일** | `Trail` | 패널에 담긴 탐색 트리 전체. 저장·불러오기·Markdown 내보내기의 단위 |
| **루트** | `Trail.roots` | `Ctrl+Alt+T` 로 시작한 최상위 노드. 여러 개 있을 수 있다 |
| **노드** | `TrailNode`, `.node` | 심볼 하나가 차지하는 덩어리 = 헤더 + 진입 링크 + 본문 + 자식. "카드", "박스"가 아니다 |
| **헤더** | `.hd` | 노드의 첫 줄. `종류 · 이름 · 시그니처 · 경로:줄 · 배지 · 버튼`. 클릭하면 접힌다 |
| **본문** | `.body`, 그 안의 `.code` | 노드가 보여주는 원본 코드 영역. "스니펫", "코드 미리보기"가 아니다 |
| **진입 링크** | `TrailOrigin`, `.origin` | 헤더 밑의 `↑ A 의 127번째 줄 Find`. 누르면 부모의 호출부로 돌아간다 |
| **호출부** | `origin.line` / `origin.char`, `.clickable.visited` | 부모 본문에서 클릭했던 그 지점. 펼쳐본 뒤에는 ①②③ 순번이 붙는다 |
| **순번** | `.idx`(헤더), `data-idx`(호출부) | 형제 노드 번호. 부모 호출부의 ①과 자식 노드의 ①이 한 짝이다 |
| **배지** | `.badge` | 헤더 오른쪽의 `재귀` · `선언만` · `근사` |
| **브레드크럼** | `#breadcrumb` | 패널 맨 위의 현재 경로 줄 |
| **툴바** | `#toolbar` | 전체 펼치기·접기, 정렬, 필터, 내보내기, 지우기 버튼 줄 |
| **트리 모드 / 보드 모드** | `#root.board`, `boardMode` | 기본은 **트리 모드**(자식이 부모 안에 중첩). **보드 모드**는 노드를 캔버스에 자유 배치하고 헤더를 끌어 옮긴다 |
| **연결선** | `.board-lines path` | 보드 모드에서 부모 오른쪽 → 자식 왼쪽을 잇는 곡선. 트리 모드의 가이드선에 해당한다 |
| **심볼** | `ResolvedSymbol` | 언어 서버가 준 정의 하나 + 본문 코드 + 좌표. 노드가 감싸고 있는 알맹이 |
| **클릭 후보** | `.tok.clickable` | 토크나이저가 좌표를 심어둔 식별자 span. 주석·문자열 안의 단어는 후보가 아니다 |

동사는 이렇게 쓴다.

- **펼치다 / 접다** — 본문을 보이게 / 감추게 하는 것(`collapsed`). 새 자식이 생기는
  경우(식별자 클릭, `⚑`)에도 "펼친다"고 쓴다. 사용자 눈에는 같은 동작이다.
- **붙이다** — 트리에 노드를 새로 다는 것(`addChild`). 접기/펼치기와 구분해야 할 때만 쓴다.
- **파고들다** — 한 단계 더 들어가는 사용자 행위. 문서에서만 쓰고 코드 이름에는 안 쓴다.

## 지금 무엇을 하고 있나

**독립 프로그램으로 전환하는 중이다.** 계획은 [`docs/standalone-implementation-plan.md`](docs/standalone-implementation-plan.md)
이고 그 문서 0장의 체크리스트가 진행의 정본이다. 단계 0(기준선)과 단계 1(모노레포와 공유 도메인)이 끝났다.

- `src/`, `media/` — **지금 동작하는 VS Code 확장.** 단계 10까지 그대로 둔다. 손대면 기준선이 흔들린다.
- `packages/` — **새 독립 프로그램.** shared 도메인·프로토콜만 채워져 있고 서버·웹·CLI는 뼈대다.
- 확장 마지막 상태는 tag `v0.6.0-vscode-extension` 이고 기준선 기록은 [`docs/baseline.md`](docs/baseline.md) 다.
- 확장에서 되던 동작을 새 프로그램에서 무엇으로 확인할지는 [`docs/e2e-port-checklist.md`](docs/e2e-port-checklist.md) 에 있다.

## 명령

```
npm install

# 새 독립 프로그램 (packages/)
npm run build                   # shared → server → cli
npm run typecheck               # 확장 + 모든 workspace
npm test                        # 토크나이저 + 셸 + test/unit (브라우저 불필요)

# 지금 동작하는 확장 (src/, media/)
npm run compile                 # tsc → out/
npx @vscode/vsce package        # → code-trail-<version>.vsix
npm run test:ui                 # 웹뷰 (playwright 필요)
npm run screenshot              # docs/baseline/*.png 다시 만들기
```

`npm test` 의 `test/unit` 은 `packages/shared/dist` 를 불러온다. 먼저 `npm run build` 를 돌린다.
`npm run test:ui` 와 `npm run screenshot` 은 컨테이너의 프리설치 Chromium을 쓴다.
경로가 다르면 `CT_CHROME=/path/to/chrome` 로 넘긴다.

## 지켜야 할 것

**심볼 해석은 전부 언어 서버가 한다.** 자체 파서를 만들지 않는다.
`executeDefinitionProvider` / `executeDocumentSymbolProvider` /
`executeImplementationProvider` / `executeTypeDefinitionProvider` 넷만 쓴다.
C++·C#·Go·Rust를 동시에 지원하는 유일한 방법이고, 언어별 분기를 코드에 넣지 않는 이유다.

**`media/tokenizer.js` 는 하이라이팅과 "클릭 후보 고르기"만 담당한다.**
정확도를 책임지지 않는다. 식별자 span에 원본 파일 기준 절대 좌표
(`data-l` = 줄, `data-c` = 컬럼, 둘 다 0-based)를 심고, 그 좌표를 그대로
언어 서버에 넘기는 것이 전부다. 여기에 타입 추론이나 스코프 해석을 넣지 않는다.
단 주석·문자열 안의 단어는 클릭 대상에서 제외해야 한다 (테스트가 이걸 검증한다).

**코드를 표시할 때 원본 문자열을 변형하지 않는다.**
공통 들여쓰기 제거, 탭→스페이스 변환 모두 금지. 컬럼 좌표가 어긋난다.

**`media/*.js` 는 컴파일하지 않는 브라우저용 평문 JS다.**
TypeScript 문법, `import`/`export`, 옵셔널 체이닝 금지. 번들러 없다.
웹뷰 CSP상 인라인 스크립트와 외부 CDN도 불가 — 새 리소스는 `media/` 에 두고
`asWebviewUri` 로 참조한다.

**폭 맞춤은 코드 본문에만 건다.** `.code` 는 `--ct-code-font-size` 를 쓰고
`main.js` 의 `applyFontSize` 가 이것만 덮어쓴다. 헤더 이름(`.name`)이 쓰는
`--ct-font-size` 는 건드리지 않는다 — 헤더까지 작아지면 트리 구조가 안 읽힌다.
새 UI를 넣을 때 `--ct-font-size` 를 "코드 폰트"로 오해하지 않는다.

**부모-자식 관계는 "클릭한 코드가 어느 노드에 속했는가"로만 정해진다.**
A 안에서 B, C를 클릭하면 둘 다 A의 형제 자식이다. 이 규칙을 깨지 않는다.
보드 모드에서 노드를 아무 데나 끌어다 놓아도 이 관계는 바뀌지 않는다 — 화면 배치일 뿐이다.
관계를 바꾸는 것은 `⇱`(새 루트로 떼어내기) 하나뿐이고, 그건 확장 쪽 `promoteToRoot` 가 한다.

**보드 모드에서는 노드를 `#root` 바로 아래에 평평하게 늘어놓는다.**
중첩된 채로 절대 배치를 하면 자식 좌표가 부모 기준이 되어 엉킨다.
그래서 자식을 DOM 이 아니라 모델(`nodes[id].children`)에서 찾는다 —
`childBoxes` 를 DOM 순회로 되돌리지 않는다. 두 모드 모두에서 깨진다.

## 구조

지금 동작하는 확장:

```
src/symbols.ts    언어 서버 호출 → ResolvedSymbol (본문 코드 + 좌표 + declarationOnly 등)
src/trail.ts      트리 모델, 재귀 감지, Markdown/JSON 직렬화
src/panel.ts      웹뷰 패널, 확장↔웹뷰 메시지 처리, HTML 셸
src/extension.ts  명령 등록
media/tokenizer.js  하이라이팅 + 식별자에 좌표 심기
media/main.js       트리 렌더링, 클릭 처리, 툴바
media/style.css     VS Code 테마 변수 기반 스타일
```

전환 중인 독립 프로그램 (npm workspaces):

```
packages/shared/src/domain/     ResolvedSymbol, Trail, 설정, 저장 스키마, Markdown, UUID
packages/shared/src/protocol/   명령·이벤트 타입과 Zod 런타임 스키마
packages/server/src/            로컬 서버 (단계 2부터)
packages/web/src/               브라우저 프론트엔드 (단계 2부터)
packages/cli/src/               code-trail CLI (단계 2부터)
test/unit/                      shared 단위 테스트 (node:test)
test/fixtures/                  단계 0에서 굳힌 확장 시절 데이터
```

`packages/shared` 는 파일 시스템·네트워크·DOM·`vscode` 어디에도 의존하지 않는다.
`test/unit/shared-independence.test.mjs` 가 이걸 검사한다.

메시지는 `panel.ts` 의 `onMessage`(웹뷰→확장)와 `main.js` 의
`window.addEventListener('message')`(확장→웹뷰) 두 곳에 한 쌍으로 추가한다.

`test/preview.html` 은 `main.js` 를 브라우저에서 그대로 띄우기 위한 하네스다.
`panel.ts` 의 툴바 HTML을 바꾸면 여기도 같이 고쳐야 한다 (안 그러면 `main.js` 가
`getElementById` 에서 null을 잡고 죽는다). 이 쌍이 어긋났는지는
`node test/shell.test.js` 가 잡아준다 — id 집합, `getElementById` 대상,
`media/` 리소스 로드 여부를 셋 다 비교한다.

## 바꾸면 같이 고칠 것

한쪽만 고치면 티 안 나게 낡는 것들이다. **코드를 고칠 때마다 이 표를 훑는다.**

| 고친 곳 | 같이 고칠 것 |
| --- | --- |
| `panel.ts` 의 툴바 HTML(`html()`) | `test/preview.html` 의 툴바(`node test/shell.test.js` 가 검사한다), `docs/terms.svg` 의 툴바 |
| 헤더 구성·배지·버튼 (`main.js` 의 `renderNode`, `style.css`) | `docs/terms.svg` 의 헤더 줄과 콜아웃, README `### 헤더에 표시되는 것` · `### 표시되는 배지` |
| 패널에 새 부위가 생김 (새 영역·새 버튼·새 표시) | `## 용어` 표에 이름 한 줄, `docs/terms.svg` 에 그 부위와 콜아웃, 필요하면 `docs/terms.md` 의 트리 그림 |
| 용어를 바꾸거나 새로 정함 | `## 용어` 표, `docs/terms.*`, 그리고 UI 문구(`panel.ts` 토스트, `main.js` 의 `title`)를 같은 말로 |
| 확장↔웹뷰 메시지 추가 | `panel.ts` 의 `onMessage` 와 `main.js` 의 `window.addEventListener('message')` 에 한 쌍으로 |
| `package.json` 에 설정 추가 | README `## 설정` 표. 웹뷰가 읽어야 하면 `readConfig` · `ClientConfig` · `main.js` 의 `config` 까지 |
| 명령·키바인딩 추가 | README `## 사용법` 표 |
| 사용자가 체감하는 동작 변경 | `CHANGELOG.md` 새 항목 + `package.json` 의 `version`, 그리고 `working_log.md` |
| `packages/shared` 의 도메인 타입 | `packages/shared/src/protocol/schemas.ts` 의 같은 스키마 (`satisfies` 가 컴파일에서 잡는다), `test/unit/` |
| 새 명령·이벤트 추가 | `protocol/commands.ts` 또는 `events.ts` 의 payload 스키마, 그리고 구현서 14.2·15.2 |
| 전환 단계 하나를 끝냄 | 구현서 0장 체크리스트, `docs/e2e-port-checklist.md` 의 해당 줄, `working_log.md` |
| 언어 서버 예외 처리 추가 | 아래 `## 언어 서버별 함정` |

이 중 기계가 잡아주는 건 첫 줄(`node test/shell.test.js`)뿐이다. 나머지는 사람이 챙긴다.

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
  구현이 **정확히 하나**면 `autoFollowSingleImplementation` 이 그것까지 바로 붙인다.
  **둘 이상일 때 하나를 골라 붙이지 않는다** — 호출부의 정적 타입만으로는 어느 구현이
  도는지 알 수 없고, 자동으로 고르면 그게 실행되는 코드라고 오해하게 된다.
  자동으로 따라가는 경로에서는 `resolveImplementationsAt` 의 참조 검색 폴백을 끈다.
  참조에는 호출부가 섞여 있어서 "이 메서드를 부르는 함수"로 끌려갈 수 있다.
  선언 노드는 어느 쪽이든 지우지 않는다. "인터페이스를 거쳐 갔다"도 경로의 일부다.
