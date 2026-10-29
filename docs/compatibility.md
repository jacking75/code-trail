# 지원 조합과 검증 기록

## 요구 사항

- **Node.js 22.12 이상.** 소스 빌드 도구(Vite 8)의 요구와 같다.
- **최신 Chromium 계열 브라우저**(Chrome·Edge). 화면은 브라우저에서만 돈다.
- **언어 서버는 사용자가 설치한다.** 우리가 내려받지 않는다.
- 서버·단위·통합·종단 간 시험은 Windows x64 에서만 실제로 돌렸다.

## 언어별 실환경 확인 상태

| 언어 | 어댑터 | 실제 언어 서버 확인 상태 |
| --- | --- | --- |
| C/C++ | clangd | 미확인. 이 기계에 서버가 없다 |
| C# | roslyn-language-server | 미확인. 이 기계에 서버가 없다 |
| Go | gopls | 미확인. 이 기계에 서버가 없다 |
| Rust | rust-analyzer | 미확인. rustup proxy 만 있고 그 toolchain 에 실제 서버가 없다 |
| TypeScript/JavaScript | typescript-language-server | **일부 확인.** Windows x64 · typescript-language-server 5.3.0 · TypeScript 5.9.3 · 이 저장소 자체에서 네 요청의 capability 광고와 `documentSymbol`·`definition` 응답을 확인했다(진단 탭 `지원됨`, `npm run test:lsp`). 다른 운영체제·다른 크기의 프로젝트·JavaScript 만 있는 프로젝트는 미확인이다 |

미확인 조합은 하이라이팅이나 가짜 서버 통합 시험 통과만으로 `지원됨` 이라고 표시하지 않는다.
사용자가 진단 화면에서 `✓ 확인` 을 눌러 실제 샘플의 `documentSymbol` 과 `definition` 이 응답해야
그 실행 세션에 `지원됨` 배지가 붙는다.

## 1.8.0 공개 준비 검증 기록

공개 준비를 마친 커밋을 이 기계에서 다시 검증한 결과다. 위의 `지원됨` 규칙과 마찬가지로 **돌려서 통과한 것만** 적는다.

(최종 검증 뒤에 채운다.)

## 남은 실환경 검증

이 기계·이 사람으로는 할 수 없어 공개 뒤 그 환경이 생길 때 하나씩 닫는다.
각 줄은 "어느 환경에서 어떤 명령으로 확인되는가" 다.

| 항목 | 어느 환경에서 | 어떻게 |
| --- | --- | --- |
| C/C++ 실제 탐색 | clangd 와 `compile_commands.json` 이 있는 프로젝트 | `npm run test:lsp` 와 진단 탭 `✓ 확인`, 헤더·템플릿 정의로 이동 |
| C# 단일·다중 프로젝트 탐색 | roslyn-language-server 와 `.sln`·`.csproj` | 솔루션 고르기, `definition`·`implementation` 이 인터페이스 → 구현으로 가는지 |
| Go 실제 탐색 | gopls 와 `go.mod` 프로젝트 | `npm run test:lsp`, 인터페이스 메서드의 구현 찾기 |
| Rust 실제 탐색 | rust-analyzer 가 실제로 깔린 toolchain 과 `Cargo.toml` | `npm run test:lsp`, 트레이트 메서드의 구현 찾기 |
| TypeScript 확장 확인 | Linux·macOS, 큰 프로젝트, JavaScript 만 있는 프로젝트 | 같은 명령으로 반복 |
| macOS 설치·실행 | macOS | `npm run test:install`, `npx code-trail <경로>`, 브라우저·외부 에디터 열기 |
| Linux 설치·실행 | Linux | 같은 명령과 `npm run test:e2e` |
| 서로 다른 기계 간 공유·회신 | 두 기계 | 공유 묶음을 만들어 보내고 회신을 병합. 충돌이 자동 선택되지 않는지 |
| 실제 Ollama AI 초안 | Ollama 가 있는 기계 | 선택 범위만 전송되는지, 취소·채택·검토 상태 |
| 실제 참여자 사용성 평가 | 참여자 | [`usability-evaluation.md`](usability-evaluation.md) 의 절차 |
| 도입 전후 효과 | 실제 팀 | 같은 문서의 측정표 |
| npm 게시와 소비자 설치 | 저장소 주인의 npm 계정 | [`CONTRIBUTING.md`](../CONTRIBUTING.md) 의 릴리스 절차 |

## 이전 기록 — 1.1.0 인수 환경

2026-09-10 KST 에 Windows x64 / Node 22.17.1 / Google Chrome 에서 다음을 확인했다.

| 명령·검사 | 결과 |
| --- | --- |
| `npm run build`, `npm run typecheck` | 통과했다 |
| `npm test` | 단위 159개, 통합 115개가 모두 통과했다 |
| `npm run test:e2e` | 셸·트레일·분석 기록은 실제 Chrome, 독립 정적 HTML 은 Chrome·Edge 에서 통과했다 |
| `npm run test:perf` | 1,000개 노드 첫 화면 831.1ms, 보드 전환 748.2ms 다 |
| `npm run test:pack`, `npm run test:install` | 1.1.0 네 패키지의 목록·tarball·깨끗한 설치가 통과했다 |
| `npm run test:lsp` | 다섯 언어 모두 환경 부재로 건너뛰었다 |
| 분석 화면 검사 | 1500×950·850×900 Chrome 에서 가로 오버플로와 콘솔 오류가 없었고 코드 비교·내부 링크·재시작 복원이 통과했다 |

실제 사용자 평가는 [`usability-evaluation.md`](usability-evaluation.md) 의 절차만 준비됐으며 아직 실행하지 않았다.
