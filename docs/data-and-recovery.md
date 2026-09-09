# 데이터 배치와 복구

`.code-trail/` 아래의 의미 데이터와 개인 데이터를 분리한다.

```text
.code-trail/
  settings.json                 공유 가능한 UI·언어 사용·상대 솔루션 설정
  index.json                    트레일 목록 캐시
  trails/<trail-id>.json        트레일 정본
  analysis/<analysis-id>.json   분석 기록 정본
  snapshots/                    불변 코드 기준 자료
  local/settings.json           에디터·언어 서버 실행 값·작성자·로컬 AI 제공자
  local/drafts/                 저장 전 개인 초안
  runtime/                      잠금·언어 서버 로그
```

`local/`과 `runtime/`은 자체 `.gitignore`를 가지며 프로젝트 루트 `.gitignore`는 바꾸지 않는다.
트레일의 보드 좌표·활성 노드 같은 화면 상태는 기존 호환성을 위해 트레일 파일에 남아 있다.
분석 기록 공유 직렬화는 이 화면 상태를 기본 제외하며, 보드 배치를 의도적으로 포함할 때만 넣는다.

정본은 같은 디렉터리의 임시 파일에 쓴 뒤 원자적으로 교체한다. 분석 정본을 바꾸기 전에는
`.bak`을 남기고 교체 뒤 다시 읽어 스키마와 revision을 확인한다. 시작할 때 더 새 임시 파일이나
백업을 발견하면 진단 화면의 복구 후보로 올리며, 알 수 없는 버전을 빈 문서로 덮어쓰지 않는다.

1.0의 단일 `settings.json`을 처음 읽으면 `.pre-local-settings.bak`을 만든다. 실행 파일·인자·
환경 변수·초기화 옵션·에디터 설정은 `local/settings.json`으로 옮기고 공유 파일에는 안전한
값만 남긴다. 이전이 의심스러우면 서버를 끈 뒤 두 파일과 백업을 비교하고 백업 사본을 별도
보관한다. 기존 Git 이력에 들어간 비밀값은 이 이전으로 삭제되지 않으므로 별도로 회전·제거한다.

AI 제공자 endpoint·모델·사용량 제한도 로컬 설정에만 둔다. 공유 묶음과 프로젝트 설정에는
들어가지 않는다. 현재 endpoint는 loopback origin만 허용하며 비밀키 필드는 제공하지 않는다.
