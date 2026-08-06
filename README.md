# Code Trail

코드를 읽어 내려간 **경로 그 자체**를 트리로 남기는 VS Code 확장이다.

함수 위에서 단축키를 누르면 그 함수 본문이 패널에 펼쳐진다. 본문 안의 식별자를 클릭하면
그 정의가 **자식 노드로 아래에 붙는다**. 또 클릭하면 또 붙는다. 시작 지점에서 지금까지
어떤 순서로 타고 들어왔는지가 중첩 트리로 그대로 남고, 각 단계를 접었다 폈다 할 수 있다.

VS Code 내장 Call Hierarchy는 트리를 보여주지만 코드 본문을 보여주지 않고,
마켓플레이스의 Call Graph 계열 확장들은 그래프만 그리고 코드는 에디터로 점프시킨다.
Code Trail은 그 사이의 빈칸을 메운다.

## 트리 구조

`A` 안에서 `B`를 클릭하고, 다시 `A` 안에서 `C`를 클릭하면
**B와 C는 A의 형제 자식으로 나란히** 붙는다. C가 B 밑으로 들어가지 않는다.
클릭한 코드가 어느 노드에 속해 있느냐가 부모를 결정하기 때문이다.

```
A                     ↳2          ← A에서 2군데를 펼쳐봤다
│  ...
│  auto h = reg.Find①(op);        ← 펼쳐본 호출부에 순번이 붙는다
│  h->Invoke②(s, p);
│
├─ ① B (Find)         ↳1
│  │  ...
│  └─ ① map_.find
│
└─ ② C (Invoke)
```

부모 코드의 `Find①` 을 다시 누르면 아래 ① 노드로 이동하고,
자식 헤더 밑의 `↑ A 의 127번째 줄 Find` 를 누르면 반대로 부모의 그 호출부로 돌아간다.

형제 순서는 툴바의 `⇅` 버튼으로 **코드 순서(= 호출 순서, 기본값)** 와
**클릭 순서** 사이를 오갈 수 있다.

## 동작 방식

심볼 해석은 전부 **VS Code의 언어 서버 API**에 위임한다. 자체 파서를 두지 않으므로
Definition Provider를 제공하는 언어라면 대체로 동작한다.

| 언어 | 필요한 확장 |
| --- | --- |
| C / C++ | clangd 또는 C/C++ (`ms-vscode.cpptools`) |
| C# | **C# (`ms-dotnettools.csharp`) 하나면 된다.** C# Dev Kit은 필요 없다 |
| Go | Go (`golang.go` / gopls) |
| Rust | rust-analyzer |
| 그 외 | Definition Provider를 제공하는 모든 언어 |

쓰는 API는 `executeDefinitionProvider`, `executeDocumentSymbolProvider`,
`executeImplementationProvider`, `executeTypeDefinitionProvider` 넷뿐이다.
전부 표준 LSP 기능이라 언어 서버만 붙어 있으면 된다.

지금 환경이 되는지 확인하려면 대상 파일을 열고
명령 팔레트 → **`Code Trail: 언어 서버 지원 확인`** 을 실행한다.
provider별 응답 여부가 표로 나온다.

### C# 참고

기본 C# 확장은 2.x부터 Roslyn 기반 언어 서버를 단독으로 띄우므로
Dev Kit 없이도 정의 이동·문서 심볼·구현 찾기가 모두 동작한다.
Dev Kit이 추가하는 건 솔루션 탐색기, 테스트 탐색기 같은 IDE 편의 기능이지
언어 분석이 아니다.

다른 프로젝트로 넘어가는 정의 이동이 안 되면 Code Trail이 아니라
Roslyn이 솔루션을 다 못 읽은 것이다. `dotnet.defaultSolution` 에
`.sln` 경로를 지정해본다.

## 사용법

| 동작 | 방법 |
| --- | --- |
| 탐색 시작 | 함수 위에 커서를 놓고 `Ctrl+Alt+T` (macOS `Cmd+Alt+T`) |
| 새 루트 추가 | 명령 팔레트 → `Code Trail: 커서 위치를 새 루트로 추가` |
| 한 단계 파고들기 | 패널의 코드에서 **식별자 클릭** |
| 구현체 찾기 | 호출부에서 **Alt + 클릭**, 또는 선언 노드 헤더의 **`⚑`** |
| 실제 에디터에서 열기 | **Ctrl/Cmd + 클릭**, 또는 노드 헤더의 `↗` |
| 접기 / 펼치기 | 노드 헤더 클릭 |
| 노드 삭제 | 노드 헤더의 `✕` (하위 노드까지 함께) |
| 형제 정렬 바꾸기 | 툴바 `⇅ 코드 순서` ↔ `⇅ 클릭 순서` |
| 경로 이동 | 상단 브레드크럼의 이름 클릭, 또는 자식 헤더 밑 `↑ …` 링크 |
| 기록 남기기 | 툴바 `Markdown` → 트리 전체가 코드 블록 포함 문서로 |
| 세션 저장/복원 | 툴바 `저장` / `불러오기` (JSON) |

### 인터페이스 · 가상 함수 — 선언만 나올 때

`IFoo foo` 처럼 인터페이스 타입 변수의 메서드를 클릭하면 정의는 **인터페이스의 선언**으로 간다.
몸통이 없으니 시그니처만 보인다. 언어 서버가 제대로 답한 것이고, 실제로 도는 코드는 구현 클래스에 있다.

이때 노드 헤더에 `선언만` 배지와 **`⚑` 버튼**이 뜬다.
`⚑` 를 누르면 그 선언을 구현한 곳을 전부 찾아 **자식 노드로 붙인다.**
구현이 여러 개면 여러 개가 형제로 붙는다.

호출부에서 곧장 구현으로 가고 싶으면 **Alt+클릭**을 쓴다.
`⚑` 는 몸통이 있는 메서드(가상 함수, `virtual`/`override`)에서도 쓸 수 있다 — 재정의한 곳들을 모아준다.

해당하는 경우:

- C# — 인터페이스 메서드, `abstract` 멤버
- C++ — 순수 가상 함수(`= 0`), 헤더의 선언
- Go — 인터페이스 메서드
- Rust — 기본 구현 없는 트레이트 메서드

### 표시되는 배지

- **재귀** — 조상 노드 중에 같은 심볼이 이미 있다. 순환 호출이다.
- **선언만** — 몸통이 없는 선언이다. `⚑` 로 구현을 펼친다.
- **근사** — 언어 서버가 그 심볼의 전체 본문 범위를 알려주지 않아
  `codeTrail.contextLines` 만큼만 잘라서 보여준 경우다.

## 설정

| 키 | 기본값 | 설명 |
| --- | --- | --- |
| `codeTrail.clickTarget` | `allSymbols` | 클릭 대상. `callsOnly` 로 바꾸면 호출 지점만 링크가 된다 |
| `codeTrail.childOrder` | `source` | 형제 정렬. `source`=코드 순서, `click`=클릭 순서 |
| `codeTrail.maxCodeLines` | `250` | 노드 하나에 처음 표시할 최대 줄 수. 초과분은 "더 보기" |
| `codeTrail.contextLines` | `40` | 본문 범위를 못 구할 때 보여줄 줄 수 |
| `codeTrail.revealInEditorOnAdd` | `false` | 노드 추가 시 실제 에디터도 같이 이동 |
| `codeTrail.showAbsolutePath` | `false` | 헤더에 절대경로 표시 |
| `codeTrail.fontSize` | `0` | 코드 폰트 크기(px). 0이면 에디터 설정을 따름 |

## 설치

받은 `.vsix` 를 바로 설치하려면:

```
code --install-extension code-trail-0.3.0.vsix
```

또는 VS Code에서 `확장` 패널 → 우측 상단 `⋯` → `VSIX에서 설치…` → 파일 선택.
설치 후 창을 새로고침(`개발자: 창 다시 로드`)하면 명령이 잡힌다.

제거는 `code --uninstall-extension local.code-trail`.

## 소스에서 vsix 빌드하기

Node.js 18 이상이 필요하다. 프로젝트 루트에서:

```
npm install                 # 의존성 (TypeScript, 타입 정의)
npm run compile             # src/*.ts → out/*.js
npx @vscode/vsce package    # → code-trail-<version>.vsix
```

`vsce` 는 따로 설치할 필요 없다. `npx` 가 임시로 받아 실행한다.
전역에 두고 싶으면 `npm install -g @vscode/vsce` 후 `vsce package`.

`vsce package` 는 내부적으로 `vscode:prepublish` 스크립트를 돌리므로
`npm run compile` 은 사실 생략해도 되지만, 타입 오류를 먼저 보려면 따로 돌리는 편이 낫다.

출력 파일명을 지정하려면:

```
npx @vscode/vsce package --out dist/code-trail.vsix
```

버전을 올리려면 `package.json` 의 `version` 을 고치거나
`npx @vscode/vsce package patch` (자동으로 0.3.0 → 0.3.1).

### 빌드가 막힐 때

| 증상 | 원인과 조치 |
| --- | --- |
| `Missing publisher name` | `package.json` 의 `publisher` 필드가 비었다. 아무 문자열이나 넣으면 로컬 설치용으로는 충분하다 |
| `A 'repository' field is missing` 프롬프트 | 마켓플레이스에 올릴 게 아니면 `--allow-missing-repository` 를 붙인다 |
| `LICENSE` 관련 경고 | 무시해도 되고, 굳이 없애려면 `--skip-license` |
| `out/extension.js` 없음 | `npm run compile` 이 실패한 것이다. `npx tsc -p ./ --noEmit` 으로 오류를 먼저 본다 |

`.vscodeignore` 가 `src/`, `test/`, `node_modules/`, 소스맵을 제외하므로
패키지에는 `out/`, `media/`, `package.json`, 문서만 들어간다.

### 디버깅

VS Code로 이 폴더를 열고 `F5` 를 누르면 확장 개발 호스트 창이 뜬다.
`media/` 의 파일만 고쳤을 때는 그 창에서 `개발자: 창 다시 로드` 만 하면 되고,
`src/` 를 고쳤으면 `npm run watch` 를 켜두거나 다시 `F5` 한다.

웹뷰 쪽 오류는 개발 호스트 창에서 `개발자: 웹뷰 개발자 도구 열기` 로 본다.

## 테스트

```
node test/tokenizer.test.js   # 토크나이저 (주석/문자열 오탐, 줄·컬럼 매핑)
node test/ui.test.js          # 웹뷰 렌더링·상호작용 (playwright 필요)
```

UI 테스트는 `npm install --no-save playwright` 후 크로미움 경로를 잡아준다.
`CT_CHROME` 환경변수로 실행 파일을 직접 지정할 수 있다.

## 구조

```
src/symbols.ts   언어 서버 호출 → 심볼의 전체 본문 범위와 코드 추출
src/trail.ts     트레일 트리 모델, 재귀 감지, Markdown/JSON 직렬화
src/panel.ts     웹뷰 패널, 확장↔웹뷰 메시지 처리
src/extension.ts 명령 등록
media/tokenizer.js  하이라이팅 + 식별자에 (줄, 컬럼) 심기
media/main.js       트리 렌더링, 클릭 처리, 툴바
media/style.css     VS Code 테마 변수 기반 스타일
```

식별자 클릭 좌표는 토크나이저가 심어둔 원본 파일 기준 `(줄, 컬럼)`이고,
그 좌표를 그대로 `executeDefinitionProvider`에 넘긴다. 즉 정확도는 토크나이저가 아니라
언어 서버가 책임진다. 토크나이저는 "클릭 후보를 고르고 주석·문자열을 제외하는" 일만 한다.

## 라이선스

MIT
