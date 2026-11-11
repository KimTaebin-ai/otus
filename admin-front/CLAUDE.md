# OTUS Admin FE

운영 담당자·회계·지정 담당자용 관리자 웹앱. 학생 앱(`frontend/`)과 분리된 별도 Angular 앱. 스택은 `frontend/`와 동일 (Angular 22, signals + RxJS, Bun, Vitest + happy-dom).

## 기준 문서

- 루트 `CLAUDE.md`, `api.md` (유일한 API 기준. 구현이 다르면 구현을 고친다. api.md를 고쳐야 하면 멈추고 묻는다)
- PRD의 A00–A20 화면, RBAC
- 역할: 원본 열람·연속 검토는 `operator`(운영 담당자)와 `accountant`(회계·지정 담당자) 둘 다 가능. 역할은 서버 값(`GET /api/me`)만 믿는다.
- 서비스 이름은 OTUS (`OTUS Admin`).

## 규칙

- `frontend/` 코드는 수정하지 않는다. 학생 앱과 공유하는 것은 복사하지 않고 루트 `shared/`에서 읽는다. `shared/`를 고치면 두 앱 모두 build·test를 돌린다:
  - 디자인 토큰: 루트 `shared/styles/_tokens.scss`. `angular.json`의 `stylePreprocessorOptions.includePaths: ["src/shared"]` → `@use 'styles/tokens'`.
  - TS: 두 앱이 같이 쓰는 코드는 루트 `shared/`에 있고 `@otus/shared/*`로 import한다 (`src/shared` → `../../shared` 심볼릭 링크, 루트 `CLAUDE.md`의 `shared/` 항목). api.md 타입은 `@otus/shared/core/api-types`. 학생 앱 전용 코드(`frontend/src/app`의 서비스·가드·페이지)는 가져오지 않는다. 관리자 쪽은 `src/app/core/`에 따로 둔다.
- 역할 가드(`core/guards.ts`)는 화면 분기일 뿐이다. 관리자 API는 서버가 매 요청 역할을 확인해야 한다.
- Angular·도구 버전은 `frontend/`와 같게 유지한다 (`bun.lock`이 같은 버전을 고정). 올릴 때는 두 앱을 같이.
- bun/bunx만. npm/npx 금지, `package-lock.json`을 만들지 않는다.
- `provideHttpClient`는 `withXhr()` (withFetch 금지). API는 상대 `/api/...` URL만 (Angular가 XSRF 헤더를 상대 URL에만 붙인다).
- 상태는 signals, HTTP는 RxJS. standalone 컴포넌트, 새 control flow(@if, @for).
- 날짜·KST 계산은 서버 값을 그대로 쓴다.
- 요청하지 않은 리팩터링, 라이브러리 추가 금지. 필요하면 먼저 묻는다.
- 작업 끝나면 `bun run build`, 테스트, 브라우저 확인까지 하고 완료라고 말한다.

## 명령어

- `bun install`
- 개발 서버: `bun run start` (http://localhost:4201). 백엔드(`:3000`)도 띄울 것.
  - `proxy.conf.mjs`: `/api` → `http://127.0.0.1:3000`만 한다 (Origin을 바꾸지 않는다). 백엔드가 `:4201`을 허용해야 하므로 `backend/.env`에 `APP_ORIGINS=http://localhost:4200,http://localhost:4201`이 있어야 로그인 POST가 403이 아니다 (`backend/.env.example` 참고).
  - dev에서는 쿠키가 포트를 구분하지 않아 4200과 4201의 세션이 서로 덮어쓴다. `HANDOFF.md` 참고.
- 빌드: `bun run build` (`dist/admin-front/browser`)
- 테스트: `bun run test -- --watch=false` (happy-dom. jsdom은 Bun에서 죽는다)
