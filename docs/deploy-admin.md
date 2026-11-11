# 관리자 앱 배포 (R에게 알릴 것)

관리자 앱(`admin-front/`)은 **별도 이미지가 아니라 `otus-web` 이미지 안**에 들어간다. R이 만든 `deploy/Caddyfile`의 `{$ADMIN_SITE_ADDRESS}` 사이트 블록이 `/srv-admin`을 서빙하는 구조를 그대로 썼고, 그래서 pod에 컨테이너·포트가 늘지 않는다 (Caddy가 SNI로 학생/관리자 사이트를 가른다).

## 바뀐 deploy 파일

| 파일 | 바뀐 것 |
| --- | --- |
| `deploy/web.Containerfile` | 관리자 빌드 단계 추가 (`/src/admin-front` + `/src/shared` 형제 구조, `bun install --frozen-lockfile`). 산출물을 `/srv-admin`으로 복사 |
| `deploy/Caddyfile` | 관리자 사이트 블록: `/api/files/*`에 학생 사이트와 같은 `defer` 엄격 CSP 추가, "아직 비활성" 주석 정리. 라우트·헤더·프록시는 R의 것 그대로 |
| `deploy/otus-pod.yaml` | backend env에 `APP_ORIGINS=https://localhost:8443,https://admin.localhost:8443` (로컬 pod에서 관리자 `https://admin.localhost:8443`). **운영 값이 아니다** (아래 `start-podman.sh`가 항상 덮어쓴다) |
| `deploy/start-podman.sh` | `.env`에서 `APP_ORIGINS`·`FORTY_TWO_ADMIN_REDIRECT_URI`·`STAFF_ROLE_ALLOWLIST`·`ADMIN_SITE_ADDRESS`를 받는다 (전에는 "Unsupported .env variables"로 실패). `APP_ORIGINS`는 운영 렌더에서 **항상** 정한다 (yaml의 로컬 값이 `APP_ORIGIN`을 이겨 운영에 새는 것을 막음) |
| `Makefile` | 주석 한 줄만 (`images`는 `otus-web`이 둘 다 담는다는 설명). 빌드 대상은 그대로 |

## `deploy/.env` 키 (값은 여기에 쓰지 않는다)

| 키 | 설명 |
| --- | --- |
| `APP_ORIGIN` | 학생 앱 origin (기존). `https://호스트[:8443]` |
| `ADMIN_SITE_ADDRESS` | 관리자 앱 호스트. **DNS 이름만** (IP 불가), 학생 호스트와 달라야 한다. `APP_ORIGIN`처럼 이름만 쓰면 `:8443`, 443이면 `https://admin.…`. 로컬 `APP_ORIGIN=https://localhost:8443`에서 생략하면 `https://admin.localhost:8443`이 기본값이다. 공개 배포에서 생략하면 관리자 앱은 외부에 제공되지 않는다 |
| `APP_ORIGINS` | 선택. 쉼표로 학생·관리자 origin. 비우면 학생 주소와 설정된 관리자 주소(로컬 기본값 포함)로 구성한다. 직접 쓰면 두 주소를 모두 포함해야 하며 누락 시 실행 중인 컨테이너를 교체하기 전에 배포를 중단한다 |
| `DEMO_LOGIN_ENABLED` | 해커톤 배포는 `true`. 데모 로그인(`opsdemo`·`accountdemo`·`admindemo`)이 관리자 로그인이다 |
| `DEMO_LOGIN_ALLOW_PUBLIC` | 공개 호스트에서 데모 로그인을 켜려면 `true`도 필요 (둘 다 없으면 `false`로 꺼진다). `OTUS_REQUIRE_OAUTH=true`이면 둘 다 강제로 꺼진다. **`.github/workflows/deploy.yml`이 그 값을 항상 `true`로 export한다** ("Production uses 42 OAuth even if PRODUCTION_ENV contains demo defaults") |
| `FORTY_TWO_CLIENT_ID` / `FORTY_TWO_CLIENT_SECRET` | 42 로그인용 (운영 전환 때). 학생 42 로그인에도 쓴다 |
| `FORTY_TWO_ADMIN_REDIRECT_URI` | 관리자 42 로그인 콜백. 비우고 42 자격이 있으면 `<관리자 origin>/api/auth/42/callback`으로 채운다. **42 앱에도 같은 URI 등록 필요.** 없으면 `/api/auth/42/login?surface=admin`이 404 |
| `STAFF_ROLE_ALLOWLIST` | `login=operator,login2=accountant`처럼 42 로그인 때 직원 역할을 주는 목록 (운영 전환 때). 데모 계정의 역할은 seed가 정한다 |
| `SITE_ADDRESS` | 학생 앱 호스트 (기존) |

## 해커톤 배포 (데모 로그인) — R과 맞출 것

**지금 `deploy` 브랜치의 GitHub Actions 배포로는 데모 로그인이 안 켜진다.** `deploy.yml`이 `OTUS_REQUIRE_OAUTH=true`를 고정해서 `start-podman.sh`가 데모 로그인·데모 seed를 끄고 42 자격이 없으면 실패시킨다. 해커톤 데모를 이 워크플로로 배포하려면 R(또는 인프라 담당)이 정해야 한다: (a) `deploy.yml`에서 이 export를 빼거나 `PRODUCTION_ENV`로 켜고 끌 수 있게 하거나, (b) 서버에서 `start-podman.sh`를 직접 실행한다 (`OTUS_REQUIRE_OAUTH` 없이). 이 작업은 `deploy.yml`을 건드리지 않았다.

1. `deploy/.env`: `APP_ORIGIN`, `ADMIN_SITE_ADDRESS`(DNS 이름), `DEMO_LOGIN_ENABLED=true`, `DEMO_LOGIN_ALLOW_PUBLIC=true`. 관리자 호스트의 DNS A 레코드가 서버를 가리켜야 한다.
2. seed(`otus-backend seed`)가 `opsdemo`·`accountdemo`·`admindemo`를 만든다 (`start-podman.sh`는 데모 로그인이 켜져 있으면 seed를 돌린다).
3. 관리자 로그인 화면에는 42 버튼도 보인다 (`/api/auth/methods`의 `forty_two`가 true일 때). `FORTY_TWO_ADMIN_REDIRECT_URI`가 없으면 그 버튼은 404다. 해커톤에서 42 로그인을 안 쓰면 42 자격을 비우면 된다 (그러면 버튼이 안 나온다).

## 운영 전환 (42 로그인)

`DEMO_LOGIN_ENABLED=false`, 42 자격 + `ADMIN_SITE_ADDRESS` (+ `FORTY_TWO_ADMIN_REDIRECT_URI`를 42 앱에 등록) + `STAFF_ROLE_ALLOWLIST`. 직원이 아닌 계정은 `/login?error=staff_only`로 돌아오고 세션은 안 만들어진다.

## 로컬에서 확인한 것 (2026-10-18)

- `podman build -f deploy/web.Containerfile`: 학생·관리자 빌드 모두 통과. 이미지의 `/srv-admin/pdfjs/pdf.worker.min.mjs`, `cmaps`, `standard_fonts`, `wasm` 있음. `caddy validate` 통과.
- `otus-web` 이미지를 운영과 같은 옵션(읽기 전용, 캡능력 전부 drop)으로 띄워: `localhost` → `<title>OTUS`, `admin.localhost` → `<title>OTUS Admin`, 관리자 쪽 `/pdfjs/pdf.worker.min.mjs`가 `text/javascript` 200, 두 사이트 모두 CSP 헤더, SPA 폴백 200.
- `start-podman.sh`의 렌더 코드를 임시 `.env` 다섯 가지로 돌려 `APP_ORIGINS`·`ADMIN_SITE_ADDRESS`·`FORTY_TWO_ADMIN_REDIRECT_URI` 결과 확인 (IP 관리자 주소와 `APP_ORIGIN` 빠진 `APP_ORIGINS`는 에러). **전체 pod(`make pod-up`)는 로컬에서 안 띄웠다** (clamav·db 포함, 실제 호스트 DNS 필요).
