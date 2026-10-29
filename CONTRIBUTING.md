# 기여 안내

이슈와 PR 은 한글·영어 모두 환영한다. 코드 식별자는 영어, 사람에게 보이는 글은 한글이다.
용어는 [`docs/terms.md`](docs/terms.md) 의 이름만 쓴다.

## 개발 환경

Node.js 22.12 이상이 필요하다(Vite 8 의 요구와 같다).

```powershell
npm install
npm run build        # shared → server → web → cli
npm run typecheck
npm test
```

`npm test` 는 빌드된 `packages/*/dist` 를 불러오므로 먼저 `npm run build` 를 돌린다.

## 테스트

| 명령 | 무엇을 보나 |
| --- | --- |
| `npm test` | 단위 + 통합. 브라우저 불필요 |
| `npm run test:e2e` | 진짜 서버 + 진짜 브라우저. `CT_CHROME` 에 Chrome 실행 파일 경로를 준다 |
| `npm run test:lsp` | 실제 언어 서버 스모크. 설치된 언어만 돌고 나머지는 건너뛴다 |
| `npm run test:pack` | 배포물 파일 목록과 외부 의존성 고지가 설치된 버전과 같은지 |
| `npm run test:install` | tarball 을 깨끗한 폴더에 설치하고 띄워 본다 |
| `npm run release:check` | 브라우저 없이 되는 전부(build · typecheck · test · pack · install) |

```powershell
$env:CT_CHROME = "C:\Program Files\Google\Chrome\Application\chrome.exe"; npm run test:e2e
```

테스트를 새로 만들거나 남기기 전에 "이걸 지우면 어떤 실제 버그를 놓칠까?" 를 묻는다. 답이 명확하지 않으면
만들지 않는다. 구현을 베낀 테스트, 모킹이 스스로 설정한 대로 도는지만 보는 테스트는 두지 않는다.

CI 는 저장소 정책상 두지 않는다. 플랫폼별 검증은 해당 환경에서 손으로 돌리고, 사용한
OS · Node · 브라우저 · 언어 서버 버전과 건너뛴 항목을 변경 설명에 남긴다.

## 지켜야 할 규칙

- 심볼 해석은 언어 서버가 한다. `definition` · `documentSymbol` · `implementation` · `typeDefinition`
  네 요청만 쓰고, `references` 를 구현 폴백으로 쓰지 않는다.
- 코드를 표시할 때 원본 문자열과 UTF-16 좌표를 변형하지 않는다.
- 트레일의 정본은 서버에 있다. 화면은 명령을 보내고 이벤트를 받아서만 바뀐다.
- 브라우저는 파일 경로를 모른다. 불투명한 `documentId` 만 받는다.
- 화면이 사람에게 말하는 통로는 알림 하나다.

전체 규칙과 새 명령·이벤트·HTTP 경로·UI 용어·설정·배포 파일을 바꿀 때 함께 고칠 목록은
[`AGENTS.md`](AGENTS.md) 의 `지켜야 할 것` 과 `바꾸면 같이 고칠 것` 을 따른다.
공유 형식과 저장 복구는
[`docs/data-formats.md`](docs/data-formats.md) 를 먼저 읽는다.

## 릴리스 절차

**게시는 되돌릴 수 없다. 저장소 주인이 직접 실행한다.**

전제: npm 계정(2FA)과 조직 `code-trail` 소유, `npm login` 완료, 깨끗한 작업 트리, 최신 `main`.
`@code-trail` 스코프는 조직을 먼저 만들어야 쓸 수 있다.

1. `CHANGELOG.md` 항목을 쓰고 다섯 `package.json` 의 버전을 올린다.
   `npm version <ver> -ws --include-workspace-root --no-git-tag-version` 뒤에
   `code-trail` · `@code-trail/server` · `@code-trail/web` 의 내부 의존 범위도 같은 버전으로 맞춘다.
2. `npm ci`
3. `npm run release:check`
4. `$env:CT_CHROME = "..."; npm run test:e2e`
5. 커밋하고 태그 `v<ver>` 를 만든다.
6. 의존 순서대로 올린다. 각각 OTP 를 묻는다.

   ```powershell
   npm publish -w @code-trail/shared
   npm publish -w @code-trail/web
   npm publish -w @code-trail/server
   npm publish -w code-trail
   ```

   `--workspaces` 한 번으로 올리지 않는다. 순서가 의존 순서를 보장하지 않고, 하나가 실패하면
   나머지 상태를 알기 어렵다. 빌드하지 않은 체크아웃에서 올리면 `dist` 없는 빈 패키지가 나간다.
7. 빈 폴더에서 `npx --yes code-trail@<ver> --version` 을 돌리고 실제 프로젝트를 열어 본다.
8. `git push --follow-tags` 하고 GitHub Release 에 CHANGELOG 항목을 붙인다.

일부만 올라갔으면 남은 것을 바로 올린다. 잘못된 내용이 올라갔으면 같은 버전은 다시 못 올리므로
패치 버전을 올리고 `npm deprecate <pkg>@<ver> "<이유>"` 를 쓴다.
