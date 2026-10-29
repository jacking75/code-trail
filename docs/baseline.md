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

확장 시절 두 장(트리 모드·보드 모드)은 저장소에 두지 않는다. `git checkout v0.6.0-vscode-extension` 뒤
`npm run screenshot` 으로 다시 만든다. 입력이 `test/fixtures/preview-state.json` 하나뿐이라 결과가 재현된다.
독립 프로그램 두 장(파일 탐색기와 코드 화면, 트레일 화면)은 `npm run test:e2e` 가 `test-results/` 에 만든다.
임시 프로젝트를 만들어 찍으므로 프로젝트 이름 부분만 실행마다 달라진다.
