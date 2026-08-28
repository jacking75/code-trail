# 기준선 — VS Code 확장 마지막 상태

독립 프로그램 전환([`standalone-implementation-plan.md`](standalone-implementation-plan.md)) 의 **단계 0** 산출물이다.
"원래 어떻게 동작했지?" 를 확인할 곳은 여기다.

> **이 문서에 적힌 명령과 파일은 지금 저장소에 없다.** 확장 소스(`src/`, `media/`)와
> 그 테스트(`test/tokenizer.test.js`, `test/shell.test.js`, `test/ui.test.js`,
> `test/screenshot.js`, `test/preview.html`)는 1.0.0(단계 11)에서 지웠다.
> 아래를 실제로 돌려 보려면 먼저 `git checkout v0.6.0-vscode-extension` 을 한다.
> 이 문서는 **그 시점의 기록**이므로 새 프로그램에 맞춰 고치지 않는다.

기록 시각: 2026-08-28 14:38 KST

## 보존점

| 항목 | 값 |
| --- | --- |
| tag | `v0.6.0-vscode-extension` |
| 커밋 | `9aaf300` (문서를 동일하게 한다) |
| `package.json` version | 0.6.0 |
| 패키지 산출물 | `npx @vscode/vsce package` 로 `code-trail-0.6.0.vsix` 를 다시 만들 수 있다 (vsix 는 `.gitignore` 대상) |

```bash
git show v0.6.0-vscode-extension           # 확장 마지막 커밋
git checkout v0.6.0-vscode-extension       # 확장 코드 전체를 그대로 꺼내기
git diff v0.6.0-vscode-extension -- src media   # 전환 후 확장 코드가 어떻게 바뀌었는지
```

## 기준 결과

아래는 `v0.6.0-vscode-extension` 시점에 Windows 11 / Node v22.17.1 / npm 11.16.0 에서 실행한 결과다.

| 명령 | 결과 |
| --- | --- |
| `npm run compile` | 종료 코드 0, 오류·경고 0 |
| `node test/tokenizer.test.js` | `ALL PASS` |
| `node test/shell.test.js` | `ALL PASS` |
| `node test/ui.test.js` | `ALL PASS` |

`test/ui.test.js` 는 브라우저가 필요했다. 컨테이너 밖에서는 `CT_CHROME` 으로 넘겼다.

```bash
CT_CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe" node test/ui.test.js
```

## 기준 스크린샷

| 파일 | 내용 | 다시 만드는 법 |
| --- | --- | --- |
| [`baseline/tree-mode.png`](baseline/tree-mode.png) | **확장** 트리 모드. 부모 위·자식 아래 배치, 진입 링크, 순번, 재귀·근사 배지 | `npm run screenshot` |
| [`baseline/board-mode.png`](baseline/board-mode.png) | **확장** 보드 모드. 노드가 캔버스 직속으로 평평하게 놓이고 연결선이 부모→자식을 잇는다 | `npm run screenshot` |
| [`baseline/standalone-shell.png`](baseline/standalone-shell.png) | **독립 프로그램** 파일 탐색기와 읽기 전용 코드 화면 | `npm run test:e2e` |
| [`baseline/standalone-trail.png`](baseline/standalone-trail.png) | **독립 프로그램** 트레일 화면. 부모 위·자식 아래 배치, 헤더·배지·진입 링크·순번 | `npm run test:e2e` |

앞의 두 장은 입력이 `test/fixtures/preview-state.json` 하나뿐이라 결과가 재현된다
(두 번 돌려 바이트가 같은 것을 확인했다). 뒤의 두 장은 임시 프로젝트를 만들어 찍으므로 프로젝트 이름 부분만 실행마다 달라진다.

브라우저 경로가 다르면 `CT_CHROME` 으로 넘긴다.

```bash
CT_CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe" npm run screenshot
CT_CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe" npm run test:e2e
```

## Fixture

`test/fixtures/` 에 전환 전 데이터 모양을 굳혀 뒀다. 새 구현이 같은 정보를 담는지 대조하는 데 쓴다.

| 파일 | 내용 |
| --- | --- |
| `resolved-symbols.json` | 전환 전 `ResolvedSymbol` 6종. 정상 함수, 한 줄 range 근사, 탭 들여쓰기, Roslyn 시그니처 이름과 선언만, 비ASCII, 워크스페이스 밖 파일 |
| `trail-legacy.json` | 전환 전 `Trail.toJSON()` 이 만들던 `version: 1` 저장 형식. 재귀 노드와 접힌 노드를 포함한다. **새 프로그램은 이 형식을 읽지 않는다**(문서 3.2). 형식이 어떻게 달라졌는지 비교용이다 |
| `webview-messages.json` | 확장↔웹뷰 메시지 전체와, 각각이 어떤 WebSocket 명령·HTTP 경로로 대체되는지 |
| `preview-state.json` | `test/preview.html` 에 넣는 `setState` 메시지. 스크린샷과 UI 테스트의 입력 |

## 함께 볼 것

- [`e2e-port-checklist.md`](e2e-port-checklist.md) — 지금 되는 동작을 새 프로그램에서 무엇으로 확인할지
- [`terms.md`](terms.md) · [`terms.svg`](terms.svg) — 화면 각 부위의 이름. 전환 후에도 같은 이름을 쓴다
