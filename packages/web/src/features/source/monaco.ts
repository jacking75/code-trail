/**
 * Monaco 를 필요한 만큼만 들여온다.
 *
 * `monaco-editor` 를 통째로 import 하면 90개 언어와 TypeScript·CSS·HTML·JSON
 * 언어 서비스 워커까지 따라온다 (합쳐서 9MB 남짓). 우리는 **읽기 전용 화면**이라
 * 자동 완성도 타입 검사도 쓰지 않는다 — 심볼 해석은 전부 언어 서버가 한다.
 *
 * 그래서 편집기 API 와 문법 강조용 언어 정의만 등록한다. 각 언어의 실제 문법은
 * `register.js` 안에서 지연 로드되므로, 열지 않은 언어는 내려받지도 않는다.
 *
 * 워커는 따로 설정하지 않는다. Monaco 0.56 은 워커를
 * `new URL(..., import.meta.url)` 로 가리키고 Vite 가 그것을 번들에 넣는다 —
 * 그래서 CDN 없이도 같은 origin 에서 온다(CSP `script-src 'self'`).
 */

import * as monaco from 'monaco-editor/editor/editor.api.js';

// Code Trail 이 심볼 해석을 지원하는 언어.
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/csharp/register.js';
import 'monaco-editor/languages/definitions/go/register.js';
import 'monaco-editor/languages/definitions/rust/register.js';

// 프로젝트 안에서 자주 함께 열리는 것들. 문법 강조만 붙는다.
// JSON 은 별도 문법 정의가 없다 — Monaco 에서 언어 서비스와 한 묶음이라
// 여기서는 빼고 plaintext 로 보여준다.
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/shell/register.js';
import 'monaco-editor/languages/definitions/xml/register.js';
import 'monaco-editor/languages/definitions/yaml/register.js';

export { monaco };
