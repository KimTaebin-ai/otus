# OTUS · Frontend

Angular 22 (signals, RxJS). 패키지 매니저와 실행은 **Bun**을 쓴다 (`npm`·`npx` 대신 `bun`·`bunx`).

API 규격은 저장소 루트의 [`api.md`](../api.md)가 기준이다.

## 실행

백엔드가 같이 떠 있어야 한다. 개발 서버가 `/api`를 `http://127.0.0.1:3000`으로 넘긴다 (`proxy.conf.json`).

```sh
# 저장소 루트에서: 로컬 DB (Podman)
make dev-db

# backend/ 에서: 처음 한 번 cp .env.example .env 후
cargo run

# 데모 데이터: 이번 달 접수 기간(한 달 내내 열림) + 데모 사용자 dongmin(홈), seoyeon(재검토 요청 받음)
# 접수 기간이 없으면 제출·업로드가 모두 422 CYCLE_CLOSED가 된다. 다시 실행해도 된다
make seed

# frontend/ 에서
bun install
bun run start        # http://localhost:4200
```

- 42 로그인(`42 계정으로 로그인`)은 백엔드에 42 OAuth가 설정되어 있을 때만 보인다 (`GET /api/auth/methods`). 페이지 이동으로 동작하고, 실패하면 `/login?error=<code>`로 돌아와 화면에 사유가 나온다.
- 로그인 화면에서 아무 데모 ID(영문 소문자·숫자·`-`·`_`)로 로그인한다. 처음 쓰는 ID면 새 사용자가 만들어져 U02부터 시작한다. `dongmin`은 홈(U03), `seoyeon`은 보완 제출(U05) 시나리오로 시작한다.
- 검토자 화면은 범위 밖이라, 재검토 요청·승인은 `ApiService.devSetStatus()` (`POST /api/dev/submissions/{id}/status`)로 흉내 낸다.
- 세션 쿠키가 `Secure`라서 `http://localhost`에서는 Chrome·Firefox만 동작한다. Safari는 백엔드 pod(`https://localhost:8443`)로 확인한다.

## 구조

```
src/app/
  core/
    api.models.ts             api.md 타입 (enum, 요청·응답, 에러 body). api.md가 바뀌면 같이 고친다
    api.service.ts            엔드포인트 래퍼 + errorMessage()
    auth.service.ts           로그인 사용자 signal (me), 데모 로그인·로그아웃
    guards.ts                 U01 분기 (최초 4종 제출 여부로 /initial ↔ /home)
    unauthorized.interceptor  세션 만료(401) → /login
  layout/shell                로그인 후 공통 헤더·네비게이션
  pages/login                 U01 (데모 로그인)
  pages/placeholder           아직 없는 화면 자리. app.routes.ts에서 화면별로 교체한다
app.routes.ts                 U01–U06 라우트와 가드
src/shared -> ../../shared    관리자 앱과 같이 쓰는 코드 (심볼릭 링크, import는 @otus/shared/*)
  styles/_tokens.scss         디자인 토큰
  core/                       brand, format, time-requirement, api-types (관리자도 쓰는 api.md 타입)
  ui/                         button, card, info-box, status-badge, time-badge, count-pill, hours-bar, notice-panel
```

학생 전용 컴포넌트(upload-slot, drop-panel, employment-choice)는 `src/app/ui/`에 있다. `shared/` 규칙은 루트 `CLAUDE.md`, Windows의 심볼릭 링크 설정은 루트 `README.md`.

## 규칙

- **API는 항상 상대 경로(`/api/...`)로 부른다.** Angular는 상대 경로 요청에만 `X-XSRF-TOKEN` 헤더를 붙이고, 백엔드는 이 헤더가 없는 `POST` 등을 403으로 거절한다. `ApiService`를 쓰면 자동으로 된다.
- 세션 쿠키(`__Host-session`)는 HttpOnly라 프론트에서 읽을 수 없다. 로그인 상태는 `AuthService.me()`로 본다.
- 최초 4종 제출에 성공하면 `AuthService.setMe({ ...me, initial_submitted: true })`(또는 `refresh()`)를 불러야 가드가 홈으로 보낸다.
- 에러 메시지는 `errorMessage(err)`가 api.md 에러 body의 `message`를 꺼낸다. 에러 코드는 `err.error.error.code`.
- 업로드는 `ApiService.uploadFile()`이 진행률 이벤트(`HttpEventType.UploadProgress`)를 낸다. 공용 PDF 업로드 컴포넌트에서 쓴다.

## 테스트·빌드

```sh
bun run test -- --watch=false                                  # 전체
bun run test -- --watch=false --include src/app/core/guards.spec.ts   # 파일 하나
bun run build
bunx prettier --write src
```

테스트 DOM은 jsdom이 아니라 happy-dom이다 (jsdom은 Bun에서 동작하지 않는다).
