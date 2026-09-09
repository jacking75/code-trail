# 기여 안내

Node.js 20.11 이상에서 의존성을 설치하고 빌드된 `dist`를 만든 뒤 시험한다.

```powershell
npm install
npm run build
npm run typecheck
npm test
```

CI는 저장소 정책상 두지 않는다. 플랫폼별 검증은 해당 환경에서 수동으로 수행하고 사용한
OS·Node·브라우저·언어 서버 버전과 건너뛴 항목을 변경 설명에 남긴다.

심볼 의미 해석은 `definition`, `documentSymbol`, `implementation`, `typeDefinition` 네 LSP
요청만 사용한다. 공통 계층에 언어별 파서를 넣거나 `references`를 구현 폴백으로 쓰지 않는다.
코드 문자열과 UTF-16 좌표를 변형하지 않으며 브라우저 API는 불투명한 `documentId`만 받는다.

새 명령·이벤트·HTTP 경로·UI 용어·설정·배포 파일을 바꿀 때 함께 고칠 목록은
[`AGENTS.md`](AGENTS.md)의 `바꾸면 같이 고칠 것`을 따른다. 공유 형식은
[`docs/share-format.md`](docs/share-format.md), 저장 복구는
[`docs/data-and-recovery.md`](docs/data-and-recovery.md)를 먼저 읽는다.
