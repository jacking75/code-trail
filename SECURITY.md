# 보안 정책

Report vulnerabilities privately through GitHub's **Report a vulnerability** (Security Advisories) on this
repository. Please do not post reproduction details in a public issue.

## 지원 버전

가장 최근의 마이너 버전만 고친다.

## 신뢰 경계

- Code Trail 은 로컬 전용이다. 서버는 `127.0.0.1` 에만 바인딩하고, 모든 API 와 WebSocket 이
  프로세스가 사는 동안만 쓰는 세션 토큰을 요구한다.
- **브라우저는 신뢰 경계 밖**이다. 파일 경로는 서버가 발급한 불투명한 `documentId` 로만 오가고,
  오류 응답에 절대경로·코드 본문·환경 변수·토큰을 담지 않는다.
- 언어 서버와 외부 에디터는 사용자가 설치하고 설정한 프로그램이다. 셸 없이 실행하지만,
  그 프로그램 자체의 취약점은 이 저장소의 범위 밖이다.

범위 안의 예: 토큰 없이 API 에 접근, 프로젝트 밖 파일 읽기, 경로 탈출, 셸 인자 주입, 토큰이 로그·URL·오류에 남는 것.

## 보고 방법

저장소의 **Security → Report a vulnerability** 로 비공개 보고를 올린다.
재현 방법, 영향받는 버전, 가능하면 운영체제와 Node 버전을 함께 적는다.

## 기대할 수 있는 것

개인 프로젝트라 응답 기한을 약속하지 않는다. 고친 내용은 [`CHANGELOG.md`](CHANGELOG.md) 에 적는다.
