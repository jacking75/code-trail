# CLAUDE.md

VS Code 확장. 함수 본문을 웹뷰 패널에 인라인으로 펼치고, 코드 안의 식별자를 클릭하면
그 정의가 자식 노드로 중첩되며 쌓이는 코드 탐색 트리.

## 명령

```
npm install
npm run compile                 # tsc → out/
npx @vscode/vsce package        # → code-trail-<version>.vsix
node test/tokenizer.test.js     # 토크나이저
node test/ui.test.js            # 웹뷰 (playwright 필요)
```

`test/ui.test.js` 는 컨테이너의 프리설치 Chromium을 쓴다.
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

**부모-자식 관계는 "클릭한 코드가 어느 노드에 속했는가"로만 정해진다.**
A 안에서 B, C를 클릭하면 둘 다 A의 형제 자식이다. 이 규칙을 깨지 않는다.

## 구조

```
src/symbols.ts    언어 서버 호출 → ResolvedSymbol (본문 코드 + 좌표 + declarationOnly 등)
src/trail.ts      트리 모델, 재귀 감지, Markdown/JSON 직렬화
src/panel.ts      웹뷰 패널, 확장↔웹뷰 메시지 처리, HTML 셸
src/extension.ts  명령 등록
media/tokenizer.js  하이라이팅 + 식별자에 좌표 심기
media/main.js       트리 렌더링, 클릭 처리, 툴바
media/style.css     VS Code 테마 변수 기반 스타일
```

메시지는 `panel.ts` 의 `onMessage`(웹뷰→확장)와 `main.js` 의
`window.addEventListener('message')`(확장→웹뷰) 두 곳에 한 쌍으로 추가한다.

`test/preview.html` 은 `main.js` 를 브라우저에서 그대로 띄우기 위한 하네스다.
`panel.ts` 의 툴바 HTML을 바꾸면 여기도 같이 고쳐야 한다 (안 그러면 `main.js` 가
`getElementById` 에서 null을 잡고 죽는다).

## 언어 서버별 함정

- **Roslyn(C#)** 은 심볼 이름에 시그니처를 통째로 넣는다
  (`Foo(string, int) : Task<T>`). 표시할 때 `(` 앞까지만 잘라 쓴다.
- 일부 C++ 서버는 함수의 `range` 를 한 줄만 준다. 이때 `contextLines` 로
  보정하고 `approximate` 플래그를 세운다.
- 인터페이스 메서드는 정의가 선언뿐이다. 코드에 `{` 가 없으면 `declarationOnly` 로
  표시하고, 사용자가 `⚑` 로 구현을 찾아갈 수 있게 한다.
