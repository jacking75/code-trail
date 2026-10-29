# 외부 의존성 고지

Code Trail 은 MIT 라이선스다. 배포물(`code-trail`, `@code-trail/server`,
`@code-trail/shared`, `@code-trail/web`)이 실행 시점에 함께 설치하는 패키지와
그 라이선스를 아래에 적는다.

이 목록은 세 패키지의 `dependencies` 를 재귀로 훑어 만든다. 다시 만들려면
`npm run test:pack` 이 쓰는 것과 같은 방식으로 `node_modules` 를 훑으면 된다.
개발용 의존성(TypeScript, Vite, React, Monaco, Playwright 등)은 배포물에
들어가지 않으므로 여기에 없다.

**언어 서버 바이너리(clangd, gopls, rust-analyzer, roslyn-language-server)는
배포물에 들어 있지 않다.** 우리가 내려받지도 않는다. 사용자가 설치한 것을 찾아
쓸 뿐이므로 그 라이선스는 각 배포처를 따른다.

브라우저 화면에는 [Monaco Editor](https://github.com/microsoft/monaco-editor)(MIT)와
[React](https://react.dev)(MIT)가 번들되어 있다. 둘 다 `@code-trail/web` 의
빌드 산출물 안에 들어간다.

| 패키지 | 버전 | 라이선스 |
| --- | --- | --- |
| @fastify/accept-negotiator | 2.1.0 | MIT |
| @fastify/ajv-compiler | 4.0.6 | MIT |
| @fastify/error | 4.2.0 | MIT |
| @fastify/fast-json-stringify-compiler | 5.1.0 | MIT |
| @fastify/forwarded | 3.0.2 | MIT |
| @fastify/merge-json-schemas | 0.2.1 | MIT |
| @fastify/proxy-addr | 5.1.0 | MIT |
| @fastify/send | 4.2.0 | MIT |
| @fastify/static | 10.1.8 | MIT |
| @fastify/websocket | 11.3.4 | MIT |
| @lukeed/ms | 2.0.2 | MIT |
| @pinojs/redact | 0.4.0 | MIT |
| abstract-logging | 2.0.1 | MIT |
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| atomic-sleep | 1.0.0 | MIT |
| avvio | 9.3.0 | MIT |
| balanced-match | 4.0.4 | MIT |
| brace-expansion | 5.0.12 | MIT |
| content-disposition | 3.0.0 | MIT |
| cookie | 1.1.1 | MIT |
| depd | 2.0.0 | MIT |
| dequal | 2.0.3 | MIT |
| duplexify | 4.1.3 | MIT |
| end-of-stream | 1.4.5 | MIT |
| escape-html | 1.0.3 | MIT |
| fast-decode-uri-component | 1.0.1 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-json-stringify | 7.0.1 | MIT |
| fast-querystring | 1.1.2 | MIT |
| fast-uri | 3.1.9 | BSD-3-Clause |
| fast-uri | 4.2.3 | BSD-3-Clause |
| fastify | 5.12.7 | MIT |
| fastify-plugin | 6.0.0 | MIT |
| fastq | 1.20.2 | ISC |
| find-my-way | 9.9.0 | MIT |
| glob | 13.0.6 | BlueOak-1.0.0 |
| http-errors | 2.0.1 | MIT |
| inherits | 2.0.4 | ISC |
| ipaddr.js | 2.5.0 | MIT |
| json-schema-ref-resolver | 3.0.0 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| light-my-request | 6.6.0 | BSD-3-Clause |
| lru-cache | 11.5.2 | BlueOak-1.0.0 |
| mime | 3.0.0 | MIT |
| minimatch | 10.2.6 | BlueOak-1.0.0 |
| minipass | 7.1.3 | BlueOak-1.0.0 |
| on-exit-leak-free | 2.1.2 | MIT |
| once | 1.4.0 | ISC |
| path-scurry | 2.0.2 | BlueOak-1.0.0 |
| pino | 10.3.1 | MIT |
| pino-abstract-transport | 3.0.0 | MIT |
| pino-std-serializers | 7.1.0 | MIT |
| process-warning | 4.0.1 | MIT |
| process-warning | 5.1.0 | MIT |
| quick-format-unescaped | 4.0.4 | MIT |
| readable-stream | 3.6.2 | MIT |
| real-require | 0.2.0 | MIT |
| real-require | 1.0.0 | MIT |
| require-from-string | 2.0.2 | MIT |
| ret | 0.5.0 | MIT |
| reusify | 1.1.0 | MIT |
| rfdc | 1.4.1 | MIT |
| safe-buffer | 5.2.1 | MIT |
| safe-regex2 | 5.1.1 | MIT |
| safe-stable-stringify | 2.5.0 | MIT |
| secure-json-parse | 4.1.0 | BSD-3-Clause |
| semver | 7.8.5 | ISC |
| set-cookie-parser | 2.7.2 | MIT |
| setprototypeof | 1.2.0 | ISC |
| sonic-boom | 4.2.1 | MIT |
| split2 | 4.2.0 | ISC |
| statuses | 2.0.2 | MIT |
| stream-shift | 1.0.3 | MIT |
| string_decoder | 1.3.0 | MIT |
| thread-stream | 4.2.0 | MIT |
| toad-cache | 3.7.4 | MIT |
| toidentifier | 1.0.1 | MIT |
| util-deprecate | 1.0.2 | MIT |
| vscode-jsonrpc | 9.0.3 | MIT |
| vscode-languageserver-protocol | 3.18.4 | MIT |
| vscode-languageserver-types | 3.18.4 | MIT |
| vscode-uri | 3.2.0 | MIT |
| wrappy | 1.0.2 | ISC |
| ws | 8.22.0 | MIT |
| zod | 4.6.7 | MIT |

라이선스 종류별 수: MIT 70, ISC 7, BlueOak-1.0.0 5, BSD-3-Clause 4.
전부 배포와 재배포를 허용하는 라이선스다.
