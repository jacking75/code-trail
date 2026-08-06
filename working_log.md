# 작업 로그

## 2026-08-06 19:15 KST — tasks.json 추가, README에 개발 루프 문서화

- `.vscode/tasks.json` 신규 작성. `npm: compile`(기본 빌드, `$tsc`),
  `npm: watch`(백그라운드, `$tsc-watch`), `test: tokenizer`, `test: ui` 4개 태스크.
  `launch.json` 의 `preLaunchTask: "npm: compile"` 이 npm 자동 감지 설정과 무관하게
  해석되도록 명시적으로 정의했다.
- `README.md` 의 짧은 `### 디버깅` 절을 `## 개발 중 동작 확인` 절로 확장.
  `.vsix` 없이 확인하는 2단계 루프(웹뷰는 `test/preview.html`, 확장 전체는 `F5`),
  변경 대상별 반영 방법 표, 웹뷰 DevTools, CLI 실행법을 정리했다.

## 2026-08-06 18:41 KST — .gitignore 정비 및 초기 소스 커밋

- `.gitignore` 를 VS Code 확장 프로젝트에 맞게 재작성: 의존성(`node_modules/`),
  빌드 산출물(`out/`, `dist/`, `*.tsbuildinfo`), 패키징(`*.vsix`),
  테스트 부산물(`.vscode-test/`, `coverage/`, `preview-*.png`), 로그,
  비밀 파일(`.env*`, `*.pem`, `*.key`), 에디터 개인 설정, OS 잔여 파일 제외.
- `git check-ignore` 로 제외 규칙 동작 확인, 추적 중인 파일 중 무시 대상 없음을 확인.
- 저장소 전체에 자격증명/키 패턴 스캔 — 검출된 항목 없음.
- 확장 소스(`src/`, `media/`, `test/`), 매니페스트, 문서 일체를 커밋.
