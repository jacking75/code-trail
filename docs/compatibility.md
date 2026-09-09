# 지원 및 검증 조합

Node.js 20.11 이상과 최신 Chromium 계열 브라우저를 기준으로 한다. 서버·단위·통합 시험은
Windows x64 / Node 22.17.1에서 확인했다. 브라우저 종단 간 시험과 설치 시험의 실제 결과는
배포 인수 기록에 명령·환경·건너뜀 이유를 함께 남긴다.

| 언어 | 어댑터 | 실제 언어 서버 확인 상태 |
| --- | --- | --- |
| C/C++ | clangd | 이 기계에 없어 미확인이다 |
| C# | roslyn-language-server | 이 기계에 없어 미확인이다 |
| Go | gopls | 이 기계에 없어 미확인이다 |
| Rust | rust-analyzer | rustup proxy만 있고 실제 서버는 없어 미확인이다 |
| TypeScript/JavaScript | typescript-language-server | 어댑터·가짜 진입점·실제 스모크 fixture는 구현했으나 서버가 없어 미확인이다 |

미확인 조합은 하이라이팅이나 가짜 서버 통합 시험 통과만으로 `지원됨`이라고 표시하지 않는다.
사용자가 진단 화면에서 `확인`을 눌러 실제 샘플의 `documentSymbol`과 `definition`이 응답해야
그 실행 세션에 `지원됨` 배지가 붙는다.

## 1.1.0 인수 환경

2026-09-10 KST에 Windows x64 / Node 22.17.1 / Google Chrome에서 다음을 확인했다.

| 명령·검사 | 결과 |
| --- | --- |
| `npm run build`, `npm run typecheck` | 통과했다 |
| `npm test` | 단위 159개, 통합 115개가 모두 통과했다 |
| `npm run test:e2e` | 셸·트레일·분석 기록은 실제 Chrome, 독립 정적 HTML은 Chrome·Edge에서 통과했다 |
| `npm run test:perf` | 1,000개 노드 첫 화면 831.1ms, 보드 전환 748.2ms다 |
| `npm run test:pack`, `npm run test:install` | 1.1.0 네 패키지의 목록·tarball·깨끗한 설치가 통과했다 |
| `npm run test:lsp` | 다섯 언어 모두 위 표의 환경 부재 이유로 건너뛰었다 |
| 분석 화면 검사 | 1500×950·850×900 Chrome에서 가로 오버플로와 콘솔 오류가 없었고 코드 비교·내부 링크·재시작 복원이 통과했다 |

실제 사용자 평가는 [`usability-evaluation.md`](usability-evaluation.md)의 절차만 준비됐으며
아직 실행하지 않았다. 이 때문에 T33·T34·T40은 완료로 표시하지 않는다.
