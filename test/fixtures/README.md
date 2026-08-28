# 기준선 fixture

`v0.6.0-vscode-extension` 시점, 즉 **VS Code 확장이 마지막으로 만들던 데이터의 모양**을 굳혀 둔 것이다.
독립 프로그램으로 옮긴 값이 같은 정보를 담는지 대조하는 데 쓴다.
자세한 설명은 [`docs/baseline.md`](../../docs/baseline.md) 에 있다.

| 파일 | 내용 | 쓰는 곳 |
| --- | --- | --- |
| `resolved-symbols.json` | 확장의 `ResolvedSymbol` 6종 | `test/unit/shared-independence.test.mjs` |
| `trail-legacy.json` | 확장의 `version: 1` 저장 형식 | 새 스키마와의 비교용 (읽지 않는다) |
| `webview-messages.json` | 확장↔웹뷰 메시지와 각각의 대체 경로 | `test/unit/shared-independence.test.mjs` |
| `preview-state.json` | `test/preview.html` 에 넣는 `setState` | `test/screenshot.js` |

**이 파일들은 과거의 기록이다. 새 기능에 맞춰 고치지 않는다.**
새 형식의 샘플이 필요하면 `test/unit/helpers.mjs` 의 `makeSymbol` · `makeTrail` 을 쓴다.
