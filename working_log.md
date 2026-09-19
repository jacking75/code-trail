# 작업 로그

## 2026-09-19 09:40 KST — 기능·UX 추가 개선 V01~V23 구현 (1.7.0)

- `docs/feature-ux-improvement-plan.md` 의 23개 태스크를 모두 구현하고 체크박스를 채웠다.
  변경 기준 고르기·노드/hunk 검토 표시·여백 표식·분할 보기·노드 메뉴·안내 순서 재생과
  편집·기록 목록 필터·개인 화면 상태 서버 저장·탭 폭 설정·Markdown 내보내기 일원화.
- 새 명령 넷(`trail.undoPromote`·`trail.resetBoardLayout`·`ui.saveLocalState`와 인자를
  받게 된 `trail.exportMarkdown`), 새 HTTP 경로 둘(`/api/changes/refs`,
  노드 Markdown), 새 순수 모듈 셋(`filter.ts`·`gutterIndex.ts`·`annotationList.ts`).
- 구현 중 잡은 결함: 파일 탐색기의 경로 펼치기가 루프 변수를 클로저로 잡아 마지막 단계만
  열렸다. 세션 부트스트랩이 fragment 를 통째로 지워 노드 링크가 새 탭에서 죽었다.
- 단위 188 · 통합 132 · E2E 넷 모두 통과. 문서는 README·CHANGELOG·용어 표·terms.svg·
  share-format·data-and-recovery·first-review-guide·구현서 14.2/15.1 을 함께 고쳤다.


## 2026-09-18 20:18 KST — 기능·UX 추가 개선 계획 문서 작성

- U01~U20 이 끝난 1.4.0 구현을 리뷰 도구 관점에서 다시 훑어 남은 간극 23개를 찾았다.
- `docs/feature-ux-improvement-plan.md` 를 새로 만들었다. 맨 위에 V01~V23 체크리스트, 근거 표(파일:줄), 배포 단위, 새 용어, 태스크별 목적·파일·구현·검증·완료 기준, 결정이 필요한 것을 담았다.
- 코드 조사 중 확인한 결함: `Alt+↑/↓` 가 도움말·툴팁에만 있고 처리기가 없다(V19), 트레일 본문 `tab-size` 미지정으로 코드 화면(4)과 어긋난다(V20), 개인 화면 상태가 `localStorage` 라 포트가 바뀌는 재시작을 못 견딘다(V18).
- 코드는 바꾸지 않았다. 문서만 추가했다.
