# OTUS · 지원금 서류 제출 플랫폼

<img src="frontend/public/icon.png" alt="" width="80" align="right" />

**OTUS** (Opacity-Transparent Unanimous Subsidy): 투명하고 개방적인 지원금 시스템.

42 경산 교육생 지원금 서류를 메일 대신 웹으로 내고, 접수·검토·보완 상태를 직접 확인하는 서비스다.
(42경산 캠퍼스 환경 개선 서비스 개발 공모전, 팀 이도연짱)

> 이름은 편지를 나르는 올빼미에서 왔다. 메일을 주고받던 지원금 업무를 떠올리게 하는 올빼미의 한 속(屬) *Otus*에서 따서 역두문자(backronym)로 지었다.

## 서비스 소개

지금은 지원금 서류를 메일로 내고 운영진이 손으로 취합한다. 교육생은 서류가 제대로 접수됐는지, 빠진 게 없는지 알 수 없고, 신분증·초본·통장사본 같은 민감한 원본이 메일함에 쌓인다.

OTUS는 이 과정을 하나의 웹 서비스로 옮긴다.

- **42 계정 로그인**: 주 캠퍼스가 42 경산인 교육생만 로그인할 수 있다 (42 Intra OAuth)
- **최초 4종 제출**: 신분증·주민등록초본·통장사본·고용보험가입내역서 PDF
- **월별 제출**: 매달 고용보험가입내역서 1종
- **접수 확인**: 파일 저장이 확인된 뒤에만 "검토 대기"로 표시한다
- **재검토 요청 → 보완 제출**: 사유를 보고 다시 낸 서류는 "재검토 대기"가 된다
- **접수 기간·D-day**: KST 기준. 기간 밖에는 제출이 잠긴다
- **취업 상태·계좌**: 취업 상태는 바로 저장된다. 계좌는 새 통장사본과 함께 변경을 요청하고, 승인 전까지는 기존 계좌가 유지된다
- **개인정보 보호**: 제출한 PDF와 계좌번호는 암호화해서 저장한다 (AES-256-GCM, 키는 DB 밖에 따로). 계좌번호는 화면에 마스킹(`•••• 1234`)해서 보여 준다. 주민등록번호는 입력받지 않는다
- **악성코드 검사**: 올리는 PDF를 모두 ClamAV로 검사하고, 발견되거나 검사할 수 없으면 저장하지 않는다
- **원본 내려받기**: 주인과 회계·지정 담당자만, 요청마다 권한을 확인하고, 내려받기를 모두 기록한다
- **보안**: 서버 세션·CSRF 방지·요청 제한, 최소 권한 DB 계정, 권한을 뺀 읽기 전용 컨테이너 (자세한 내용은 [`CLAUDE.md`](CLAUDE.md))

관리자 앱에서 월별 제출 내역, 연속 검토·승인·재검토 요청, 보완 이력, 제출 안내, 일괄 다운로드와 제출 기간 설정을 사용할 수 있다.

### 관리자 제출 기간 설정

`https://admin.localhost:8443`의 공통 상단에서 **조회 월**을 선택한다. 이전·다음 월 버튼, 월 직접 입력, **이번 달** 복귀를 사용할 수 있으며 메뉴를 이동해도 선택한 월을 유지한다. **제출 기간 설정** 메뉴(`/periods`)에서는 선택한 월의 접수 시작일과 마감일을 바로 수정하고 **제출 기간 저장**을 누른다. 운영 담당자(`opsdemo`)와 관리자(`admindemo`)는 저장할 수 있고, 회계 담당자(`accountdemo`)는 조회만 가능하다.

- 시작과 마감은 한국 시간(KST)으로 입력한다. 입력한 마감 시각까지 접수하며, 대상 월 안에서 설정한다.
- 현재 월과 미래 월을 추가·수정할 수 있다. 지난달은 조회만 가능하고, 다음 달 기간은 미리 등록해야 한다. 자동 월별 생성은 없다.
- 저장하면 교육생의 제출·보완과 관리자의 재검토 요청·제출 안내에 적용된다. 마감 후에는 검토 대기 서류를 승인할 수 있다.
- 변경 전후 시간과 담당자 이력을 확인할 수 있다. 다른 담당자가 먼저 수정했다면 최신 내용을 불러와 다시 확인한다.
- 기존 제출·파일·설정은 유지한다. 데모 시드는 이번 달 설정이 없는 경우에만 한 달 전체 기간을 추가하며, 이미 저장한 기간을 덮어쓰지 않는다.

| 구분 | 기술 |
| --- | --- |
| Frontend | Angular 22 (signals, RxJS), Bun |
| Backend | Rust (axum, diesel-async) |
| DB | PostgreSQL 18 |
| 배포 | Podman pod: Caddy (HTTPS, 정적 파일, `/api` 프록시) + 백엔드 + PostgreSQL, (선택)vagrant, (선택)virtualbox |

## 설치 및 실행

Linux와 macOS에서 실행한다. 환경과 목적에 맞는 방법을 선택한다.

| 방법 | 권장 용도 | 준비할 도구 | 사용 포트 |
| --- | --- | --- | --- |
| [A. 개발 환경 실행](#방법-a-개발-환경-실행) | Vagrant VM에서 전체 서비스 실행 | Vagrant, VM provider, git | `8443` |
| [B. 컨테이너 실행](#방법-b-컨테이너-실행-검증용-권장) | 전체 기능 검증·데모, macOS에서 실행 | Podman, git, make, curl, openssl | `8443` |

두 방법 모두 Podman 컨테이너로 서비스를 실행한다. **방법 A는 VM 안에 Podman을 자동 설치**하고, **방법 B는 호스트에 준비된 Podman**을 사용한다. 호스트에 Podman을 설치하거나 사용하기 어려우면 방법 A를 따른다.

### 공통: 저장소 받기

```sh
git clone https://github.com/42gyeongsan-hackathon-2026/42.Zip-team03.git
cd 42.Zip-team03
switch deploy
```
만약 방법 A로 실행할 경우 deploy/install.txt 지침을 통해서 설치부터 실행까지 가능합니다.

이후 명령은 별도 안내가 없으면 **저장소 루트(`42.Zip-team03/`)**에서 실행한다. 새 터미널을 열 때도 이 디렉터리에서 시작한다.

학생 앱과 관리자 앱은 `shared/`를 심볼릭 링크(`frontend/src/shared`, `admin-front/src/shared` → `../../shared`)로 읽는다. macOS와 Linux에서는 별도 설정이 필요 없다.

<details>
<summary>Windows에서 저장소를 받는 경우: 심볼릭 링크 설정</summary>

개발자 모드(설정 → 개발자용)를 켜고, 위 clone 명령 대신 다음 명령을 사용한다.

```sh
git clone -c core.symlinks=true https://github.com/42gyeongsan-hackathon-2026/42.Zip-team03.git
cd 42.Zip-team03
```

이미 clone했다면 저장소 루트에서 다음 명령을 실행한다.

```sh
git config core.symlinks true
git checkout -- frontend/src/shared admin-front/src/shared
```

링크가 경로 문자열만 든 일반 파일로 받아지면 두 앱의 빌드와 테스트가 깨진다.

</details>

### 방법 A. 개발 환경 실행

#### 1. 도구 준비

Vagrant 설치 및 virtualbox.
인터넷 연결과 이미지·빌드 캐시를 저장할 수 GB의 여유 공간이 필요하다. **메모리 4 GB 이상**과 **vCPU 2개**가 기본 환경 입니다.

만약 제한된 환경이라면(클러스터 pc) 지정된 저장공간을 통해서 설치를 권장합니다.
이 경우 deploy/install.txt 내 명령어를 통해 빠르게 배포 환경을 구성할 수 있습니다.
각 단계에 맞춰서 진행하면 됩니다.

#### 2. 서비스 시작

```sh
cd deploy
vagrant up
```

환경 변수는 [`deploy/.env.example`](deploy/.env.example)을 참고해 `deploy/.env`에 지정하면 VM 안의 배포 스크립트가 적용한다. 파일이 없으면 로컬 데모 설정으로 실행한다.

#### 3. 접속 및 종료

- 교육생 앱: `https://localhost:8443`
- 관리자 앱: `https://admin.localhost:8443`

로컬 자체 서명 인증서로 인한 브라우저 경고가 나오면 **고급 → 계속 진행**을 선택한다. 로그인 화면의 **데모 로그인**에 `dongmin`(교육생) 또는 `accountdemo`(회계)를 입력한다. 전체 계정은 [테스트 계정](#테스트-계정)을 참고한다.
```sh
vagrant halt
```

### 방법 B. 컨테이너 실행 (검증용 권장)

#### 1. 도구 준비

Podman이 설치되어 있거나, 필요한 경우 `sudo` 권한으로 설치할 수 있는 환경에서 진행한다.

| 도구 | 확인한 버전 | 비고 |
| --- | --- | --- |
| Podman | 6.1.4 | `podman kube play` 사용 |
| git, make, curl, openssl | 시스템 기본 | macOS는 Xcode Command Line Tools 사용 |

인터넷 연결과 이미지·빌드 캐시를 저장할 수 GB의 여유 공간이 필요하다. macOS에서는 Podman VM에 **메모리 4 GB 이상**을 할당한다.

Podman VM이 없는 macOS 환경에서는 처음 한 번 생성한 뒤 시작한다.

```sh
podman machine init --memory 4096
podman machine start
```

이미 VM이 있다면 메모리 설정을 확인하고, 중지된 경우 `podman machine start`로 시작한다. Linux에서는 VM 생성 단계를 건너뛴다.

#### 2. 서비스 시작

```sh
make demo
```

이 명령은 다음 과정을 자동으로 수행한다.

1. `deploy/secrets.yaml`이 없으면 DB 비밀번호와 암호화 키를 생성한다. 기존 파일은 유지한다.
2. Podman secret을 생성하고 서비스 이미지를 빌드한다.
3. DB·백엔드·웹·ClamAV 컨테이너를 실행한다.
4. API와 악성코드 검사기가 준비되면 데모 데이터를 넣는다.

첫 실행은 이미지 다운로드, Rust·Angular 빌드, ClamAV 시그니처 다운로드(수백 MB)로 수 분 걸린다. **`make demo`가 완료될 때까지 기다린다.** 검사기가 준비되기 전에는 업로드가 503으로 거절된다. 시그니처는 볼륨에 저장되어 다음 실행에서 재사용한다.

#### 3. 접속 및 종료

- 교육생 앱: `https://localhost:8443`
- 관리자 앱: `https://admin.localhost:8443`

로컬 자체 서명 인증서로 인한 브라우저 경고가 나오면 **고급 → 계속 진행**을 선택한다. 로그인 화면의 **데모 로그인**에 `dongmin`(교육생) 또는 `accountdemo`(회계)를 입력한다. 전체 계정은 [테스트 계정](#테스트-계정)을 참고한다.

| 명령 | 하는 일 |
| --- | --- |
| `make pod-logs` | 로그 보기 |
| `make pod-down` | 서비스 중지. 데이터는 유지하며, `make demo`로 다시 실행한다 |
| `make demo-clean` | **초기화:** pod, DB·업로드 데이터, secret, `deploy/secrets.yaml` 삭제. ClamAV 시그니처는 유지한다 |

<details>
<summary>컨테이너 구성과 이미지 용량 참고</summary>

서비스 컨테이너는 모두 Alpine 기반이다. 아래 크기는 기존 확인값이며 빌드에 따라 달라질 수 있다.

| 컨테이너 | 이미지 | 크기 |
| --- | --- | --- |
| `db` | `localhost/otus-db` (`postgres:18-alpine` + 앱 전용 DB 계정 초기화 스크립트) | 301 MB |
| `backend` | `localhost/otus-backend` (`alpine:3` + 정적 musl 바이너리) | 24 MB |
| `web` | `localhost/otus-web` (`alpine:3` + Caddy + Angular 빌드) | 58.5 MB |
| `clamav` | `localhost/otus-clamav` (`alpine:3` + ClamAV) | 43.4 MB |

빌드 전용 이미지도 내려받는다: `rust:1-alpine` 992 MB, `oven/bun:1-alpine` 95.9 MB, `caddy:2-alpine` 64.2 MB. ClamAV는 메모리를 1 GB 이상 사용한다.

</details>

#### 선택: Vagrant로 Linux VM에서 실행

Vagrant와 `bento/ubuntu-24.04`를 지원하는 VM provider를 설치한 뒤, 저장소 루트에서 실행한다. VM 안의 패키지 설치와 서비스 시작은 자동으로 진행한다.

```sh
cd deploy
vagrant up
```

- 최소 권장 사양은 **메모리 4 GB·CPU 2개**다. VirtualBox에는 이 값이 설정되어 있으며, 다른 provider도 메모리를 4 GB 이상으로 설정한다.
- 저장소를 VM의 `/vagrant`에 공유하고 `start-podman.sh`를 일반 사용자로 실행한다. VM을 시작할 때마다 이미지를 빌드하고 pod를 다시 생성하며, 기존 비밀값과 데이터 볼륨은 유지한다.
- API 상태 확인과 데모 데이터 입력이 끝나면 호스트의 `https://localhost:8443`으로 접속한다.
- 기존 VM에 프로비저닝 변경을 적용하려면 `deploy/`에서 `vagrant provision`을 실행한다.

Podman과 필수 도구가 준비된 환경에서는 저장소 루트의 `./deploy/start-podman.sh`로 같은 시작 절차를 실행할 수 있다. 이 스크립트는 `deploy/.env`가 있으면 해당 배포 설정을 적용한다.

## 환경 변수

비밀값은 저장소에 없다. 방법 A는 VM 안의 배포 스크립트가, 방법 B는 `make demo`가 DB 비밀번호와 암호화 키를 `deploy/secrets.yaml`에 자동 생성한다. 기존 파일이 있으면 재사용한다.

### 방법 A·B의 배포 설정: `deploy/.env`

방법 A에서 주소·OAuth·이메일 등을 설정하려면 [`deploy/.env.example`](deploy/.env.example)을 참고해 `deploy/.env`를 작성한다. 이 파일을 사용하는 배포 스크립트에는 `python3`와 `PyYAML`이 필요하다. 로컬 데모 주소와 로그인을 유지하려면 다음 값을 사용하고, 예시의 도메인·OAuth 콜백도 로컬 주소에 맞춘다.

```dotenv
APP_ORIGIN=https://localhost:8443
ADMIN_SITE_ADDRESS=https://admin.localhost:8443
APP_ORIGINS=https://localhost:8443,https://admin.localhost:8443
DEMO_LOGIN_ENABLED=true
```

방법 A는 `deploy/`에서 `vagrant provision`으로 변경 내용을 적용한다. 방법 B에서 `deploy/.env`를 적용하려면 저장소 루트에서 `./deploy/start-podman.sh`를 실행한다. `make demo`는 `deploy/.env`를 읽지 않는다.

<details>
<summary>참고: 백엔드를 직접 실행할 때의 backend/.env</summary>

아래는 컨테이너 밖에서 `cargo run`과 프론트엔드 개발 서버를 직접 실행할 때의 설정이다. 방법 A·B의 접속 주소는 모두 HTTPS `8443`이며, `backend/.env`를 읽지 않는다. 직접 실행용 파일은 `make dev-env`로 생성하며, 예시는 [`backend/.env.example`](backend/.env.example)에 있다. `deploy/.env`에는 [`deploy/.env.example`](deploy/.env.example)에 안내된 지원 항목만 사용한다.

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 주소. `make dev-db`의 DB와 맞춰 두었다 |
| `BIND_ADDR` | 백엔드가 듣는 주소 (기본 `127.0.0.1:3000`) |
| `APP_ORIGIN` | 브라우저 origin. 이 origin이 아닌 상태 변경 요청은 거절한다 (CSRF 방지). 개발 서버는 `http://localhost:4200` |
| `APP_ORIGINS` | 허용할 origin을 쉼표로 구분한다. 교육생·관리자 개발 서버를 함께 쓰면 `http://localhost:4200,http://localhost:4201`. `APP_ORIGIN`보다 우선한다 |
| `UPLOAD_DIR`, `MAX_UPLOAD_BYTES` | 업로드 PDF 저장 위치, 파일당 최대 크기 (기본 20 MiB) |
| `DEMO_LOGIN_ENABLED` | 데모 로그인과 `/api/dev/*` 사용 여부. 운영에서는 `false`. 켜면 `APP_ORIGIN`이 localhost일 때만 서버가 시작한다 |
| `DEMO_LOGIN_ALLOW_PUBLIC` | `true`면 localhost가 아닌 주소에서도 데모 로그인을 허용한다 (공개 데모용, 비밀번호 없는 로그인이 열린다는 뜻) |
| `BANK_ACCOUNT_KEY` | 계좌번호 암호화 키 (32바이트 base64, `openssl rand -base64 32`). 없거나 잘못되면 서버가 시작하지 않는다 |
| `FILE_ENCRYPTION_KEY` | 제출 PDF 암호화 키. 형식은 위와 같고, 계좌번호 키와 다른 값이어야 한다 |
| `FORTY_TWO_CLIENT_ID`, `FORTY_TWO_CLIENT_SECRET` | 42 OAuth 앱. 비워 두면 42 로그인이 꺼지고 데모 로그인만 보인다 |
| `FORTY_TWO_REDIRECT_URI` | 42 앱에 등록한 callback 주소와 정확히 같아야 한다 |
| `FORTY_TWO_CAMPUS_ID` | 로그인을 허용할 42 캠퍼스 ID (주 캠퍼스 기준). 42 경산은 `69` |
| `MAIL_RECIPIENT_DOMAIN` | 제출 안내 이메일의 도메인. 수신자는 `42 login@도메인` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM` | SMTP 서버와 발신 주소. 도메인·서버·발신 주소를 모두 설정해야 이메일을 사용한다 |
| `SMTP_TLS` | `tls`(기본), `starttls`, `none`. `none`은 로컬 더미 SMTP에만 허용한다 |
| `SMTP_USERNAME`, `SMTP_PASSWORD_FILE` | SMTP 인증 정보. 비밀번호는 파일로 주입하며 로컬에서는 `SMTP_PASSWORD`도 지원한다 |
| `MAX_EXPORT_USERS`, `MAX_EXPORT_BYTES` | ZIP 생성 상한. 기본 100명·256 MiB |
| `EXPORT_TTL_SECONDS`, `EXPORT_REQUEST_INTERVAL_SECONDS` | ZIP 만료 및 사용자별 생성 간격. 기본 900초·300초 |

</details>

### 배포 시 이메일 설정: `deploy/.env`

[`deploy/.env.example`](deploy/.env.example)의 이메일 항목을 채우면 `./deploy/start-podman.sh`가 백엔드에 전달한다. GitHub Actions에서는 같은 내용을 `PRODUCTION_ENV` secret에 넣는다.

```dotenv
MAIL_RECIPIENT_DOMAIN=students.example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_TLS=starttls
SMTP_FROM="OTUS <noreply@example.com>"
SMTP_USERNAME=noreply@example.com
SMTP_PASSWORD='replace-with-smtp-password'
```

`SMTP_FROM`은 발신 주소, `SMTP_USERNAME`은 SMTP 로그인 계정이다. SMTP 서비스가 제공한 서버·계정·비밀번호를 사용한다. 465 포트는 `SMTP_TLS=tls`로 설정한다. 수신자는 `<42 login>@MAIL_RECIPIENT_DOMAIN`으로 정해진다.

배포 스크립트는 비밀번호를 `deploy/secrets.yaml`의 `otus-backend` secret에 저장하고 `SMTP_PASSWORD_FILE`로 연결한다. YAML을 직접 수정할 필요는 없다. `SMTP_PASSWORD`를 바꾸면 다음 배포에 반영되고, 생략하면 저장된 값을 재사용한다. 빈 값은 저장된 비밀번호를 지운다. 인증을 끄려면 `SMTP_USERNAME`도 비운다. 이메일 발송을 끄려면 `MAIL_RECIPIENT_DOMAIN`, `SMTP_HOST`, `SMTP_FROM`을 모두 생략하거나 비운다.

설정 반영 후 관리자 화면에서 안내 발송을 실행한다. 배포 설정 변환은 `python3 scripts/deploy-env-test.py`로 검증할 수 있다 (`PyYAML` 필요, 실제 배포·메일 발송 없음).

### 방법 A·B의 비밀값: `deploy/secrets.yaml` (예시: [`deploy/secrets.example.yaml`](deploy/secrets.example.yaml))

비밀값을 두 개의 secret으로 나눠서, 각 컨테이너가 자기에게 필요한 것만 받는다.

| secret | 키 | 설명 |
| --- | --- | --- |
| `otus-db` (DB 컨테이너만) | `postgres-password` | PostgreSQL 관리자(superuser) 비밀번호. 처음 DB를 만들 때만 쓴다 |
| | `app-password` | 앱이 쓰는 DB 계정 `otus`의 비밀번호 (superuser 아님) |
| `otus-backend` (백엔드만) | `database-url` | `app-password`와 같은 비밀번호를 넣는다 |
| | `bank-account-key`, `file-encryption-key` | 계좌번호·PDF 암호화 키 |
| | `forty-two-client-id`, `forty-two-client-secret` | 42 OAuth 앱. 비워 두면 42 로그인이 꺼진다 |

- **암호화 키는 DB와 따로 백업한다.** 키를 잃으면 저장된 계좌번호와 PDF를 다시 읽을 수 없다.

- 비밀값이 아닌 기본 설정(`APP_ORIGIN`, `FORTY_TWO_REDIRECT_URI`, `FORTY_TWO_CAMPUS_ID` 등)은 [`deploy/otus-pod.yaml`](deploy/otus-pod.yaml)에 있다. 배포 스크립트를 사용하면 `deploy/.env`의 설정을 적용한다.
- 비밀값은 파일로 마운트되므로 `podman inspect`에 나오지 않는다.
- DB 비밀번호를 바꿨다면 `make demo-clean`으로 DB 볼륨도 지워야 한다. PostgreSQL은 처음 만들 때만 비밀번호를 읽는다. 이전 버전(secret 하나, `otus-secrets`)으로 띄운 적이 있어도 `make demo-clean` 후 `make demo`로 다시 만든다.

## 접속 및 확인

| | 방법 A (Vagrant VM) | 방법 B (컨테이너) |
| --- | --- | --- |
| 서비스 | `https://localhost:8443` | `https://localhost:8443` |
| 관리자 | `https://admin.localhost:8443` | `https://admin.localhost:8443` |
| API 상태 | `https://localhost:8443/api/health` | `https://localhost:8443/api/health` |

두 방법 모두 호스트 브라우저에서 위 주소로 접속한다. 로컬용 자체 서명 인증서라서 브라우저가 경고를 띄우면 "고급 → 계속 진행"을 누른다.

### 테스트 계정

로그인 화면의 **데모 로그인**에 ID를 입력한다 (비밀번호 없음). 로컬 데모 설정에서는 방법 A의 `vagrant up`과 방법 B의 `make demo`가 아래 계정과 이번 달 접수 기간(한 달 내내 열림)을 만들어 둔다.

| ID | 상태 | 로그인하면 |
| --- | --- | --- |
| `dongmin` (동민) | 지난달 최초 4종 승인됨 | 홈 (U03) |
| `seoyeon` (이서연) | 이번 달 월별 서류에 재검토 요청을 받음 | 홈. 보완 제출 시나리오 |
| `reviewdemo` (최초검토 샘플) | 이번 달 최초 4종 검토 대기 | 홈. 관리자 승인·재검토 시나리오 |
| `supplementdemo` (보완검토 샘플) | 이번 달 월별 서류 보완 재제출 | 홈. 관리자 보완 이력·이전본 다운로드 시나리오 |
| `employeddemo` (취업제외 샘플) | 최초 제출 완료·취업 중·당월 미제출 | 홈. 제출 안내 제외 시나리오 |
| `opsdemo`, `accountdemo`, `admindemo` | 운영·회계·관리자 역할 | 관리자 화면. ZIP 다운로드는 `accountdemo` |
| `case01`–`case15` | 시나리오별 케이스 15종 | [docs/demo-cases.md](docs/demo-cases.md)의 매트릭스 |
| 아무 새 ID (영문 소문자·숫자·`-`·`_`) | 처음 쓰는 사용자 | 최초 4종 제출 (U02) |

42 계정 로그인 버튼은 42 OAuth를 설정했을 때만 보인다. 검증 환경에서는 데모 로그인을 쓴다.

### 핵심 흐름 확인 (API)

로그인 이후 화면(U02~U06)은 개발 중이다. 체크포인트 흐름은 API로 확인한다:

두 방법 모두 서비스가 준비된 뒤 호스트의 저장소 루트에서 실행한다 (`bash`, `curl` 필요).

```sh
bash scripts/smoke.sh https://localhost:8443   # 방법 A·B 공통
```

방법 A에서 VM 내부로 실행하려면 `deploy/`에서 `vagrant ssh -c 'cd /vagrant && make smoke'`를 사용한다. 방법 B에서는 저장소 루트의 `make smoke`로도 실행할 수 있다.

스크립트가 새 데모 사용자로 아래 흐름을 실행하고 단계마다 `PASS`/`FAIL`을 출력한다.

1. 최초 4종 업로드 → 최종 제출 → "검토 대기"
2. 월별 제출 → 재검토 요청 → 보완 제출 → "재검토 대기"

API 명세는 [`api.md`](api.md)에 있다.

### 관리자 API 확인

보완본·이력, 월별 제출 목록, 연속 검토, 재검토 요청, 제출 안내, 일괄 ZIP 다운로드를 제공한다. 경로와 권한은 [`api.md`의 관리자 업무 API](api.md#관리자-업무-api)에 정리했다. 마감 후에는 승인만 가능하고, 안내 이메일은 24시간 재발송 제한 없이 SMTP로 발송한다.

최초 4종에는 해당 월의 고용보험 서류가 포함된다. 최초 4종을 최종 제출한 달에는 최초 제출과 그 보완본만 목록·연속 검토·이전/다음 이동에 표시하며, 월별 서류는 다음 달부터 검토한다. 같은 달에 별도로 제출된 월별 서류의 원본·이력과 자료함 파일은 보존한다.

자료함 상단의 교육생 검색·보기와, 상세 조건 토글 안의 검토 상태·최근 제출 종류(최초 4종/월별/보완) 체크박스를 조합해 내려받을 수 있다. 상세 조건은 복수 선택할 수 있으며 같은 항목 안에서는 OR, 상태와 종류 사이는 AND로 적용한다. 선택하지 않은 항목은 전체로 조회하고, 상세 조건을 접어도 선택은 유지된다. 검색 결과에서 선택한 교육생만 포함하며, 상태·종류 조건은 서버에서도 ZIP 생성 시 다시 확인한다. 예를 들어 승인된 최초 서류와 미승인 월별 서류가 함께 있어도 승인 조건에서는 최초 서류만 들어간다. 대상 인원·PDF 수·폴더 미리보기와 적용 조건을 확인한 뒤 다운로드하고, 조건에 맞는 대상이 없으면 다운로드할 수 없다.

Podman 환경에서 다음 명령으로 관리자 업무와 제출 기간 설정을 함께 검증한다.

```sh
sh scripts/admin-test.sh
# Vagrant 환경에서는 deploy/에서:
vagrant ssh -c 'cd /vagrant && sh scripts/admin-test.sh'
```

전용 임시 PostgreSQL, 더미 사용자·PDF, `example.test` 주소, 로컬 SMTP 수신 서버를 자동 생성한다. 기존 pod·DB·`.env`를 사용하지 않는다. 마이그레이션·Rust 테스트·Clippy와 실제 HTTP 요청으로 검토 충돌, 보완 이력, SMTP 실패·재시도, 앱 알림 수신·읽음·권한·페이지 조회, ZIP 내용·권한·만료, 제출 기간 저장·동시 수정·마감 제한·메일 마감 시각을 확인하며 테스트 컨테이너는 종료 시 정리한다.

수동 SMTP 확인용 값은 [`backend/.env.example`](backend/.env.example)에 있다. 안내를 보내면 교육생 앱 상단 알림 벨에도 전달된다. 최초 서류 등록 화면에서도 확인할 수 있고 개별·전체 읽음 상태는 서버에 저장한다. SMTP를 설정하지 않으면 앱 내부 알림만 전달하고 이메일은 미설정 상태로 표시한다. 운영에서는 실제 도메인과 TLS SMTP 서버·인증 정보를 별도로 설정한다.

관리자 화면은 위 API에 연결되어 있다. `https://admin.localhost:8443/login`에서 `accountdemo`로 로그인하면 월별 제출 목록에서 보완 이력·연속 검토·승인·재검토 요청과 자료함을 열 수 있다. 제출 안내는 사이드바 메뉴에서 연다. VM의 소스만 갱신했거나 `vagrant reload`만 실행했다면 웹 이미지가 갱신되지 않으므로 `deploy/`에서 `vagrant ssh -c 'cd /vagrant && ./deploy/start-podman.sh'`로 다시 빌드·기동한다.

### 브라우저 E2E

방법 A 또는 B로 띄운 상태에서 실제 브라우저로 로그인 → 홈 → 최초 4종 업로드(악성코드 검사 포함) → 제출 → 이력까지 확인한다. 두 방법 모두 `https://localhost:8443`을 대상으로 하며, 아래 명령은 Bun이 설치된 호스트의 저장소 루트에서 실행한다. W3C WebDriver를 쓰는 같은 테스트([`e2e/run.ts`](e2e/run.ts))를 브라우저만 바꿔 실행한다.

```sh
make e2e-chrome    # 임시 Chrome for Testing을 내려받아 실행하고 지운다 (Bun 필요)
make e2e-safari    # macOS: Safari Technology Preview (평소 쓰는 Safari는 건드리지 않는다)
```

- 직접 실행하면 브라우저 창이 화면 전체로 커져서 진행 과정을 볼 수 있다. CI에서는 창 없이(headless) 실행한다. 로컬에서도 창 없이 돌리려면 `E2E_HEADLESS=1 make e2e-chrome`.
- Safari Technology Preview는 처음 한 번 원격 자동화를 켠다: `"/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver" --enable`
- GitHub Actions([`.github/workflows/e2e.yml`](.github/workflows/e2e.yml))가 push·PR마다 Linux에서 `make demo`, `make smoke`, `make e2e-chrome`을 실행한다. 스크린샷과 pod 로그는 실행 결과의 artifact로 남는다.

관리자 브라우저 검증은 실제 로그인·월별 목록·보완 이력·PDF 표시·연속 검토·승인/재검토 요청 저장·ZIP 다운로드·제출 안내 대상 조회를 확인한다. 로컬 데모 환경에 새 더미 교육생과 PDF를 만들며, 실제 안내 이메일은 발송하지 않는다. 검증은 seed가 만드는 전용 `accounttest` 계정(`ADMIN_TEST_LOGIN`으로 변경 가능)을 사용하므로 사용자의 `accountdemo` ZIP 생성 한도에 영향을 주지 않는다. 같은 검증 계정으로 반복할 때는 기본 5분 생성 간격을 둔다. 브라우저 검증은 파일 응답에 429를 한 번 주입해 대기 후 자동 다운로드를 확인하고, 격리된 API 검증은 실제 제한·남은 `Retry-After`와 9명·PDF 33개 ZIP을 확인한다.

```sh
E2E_SCRIPT=e2e/admin.ts E2E_HEADLESS=1 make e2e-chrome
# PDF 로드 후 승인 화면 전환과 이전/다음 사용자 이동 회귀 검증:
E2E_SCRIPT=e2e/review.ts E2E_HEADLESS=1 make e2e-chrome
# 기간 설정 화면·입력 검증·역할별 권한 확인 (설정값은 변경하지 않음):
E2E_SCRIPT=e2e/periods.ts E2E_HEADLESS=1 make e2e-chrome
# Bun/Chrome이 없는 Vagrant VM에서는 deploy/에서:
vagrant ssh -c 'cd /vagrant && podman build -f scripts/admin-ui-test.Containerfile -t localhost/otus-admin-ui-tools .'
vagrant ssh -c 'podman run --rm --network host --shm-size=256m -v /vagrant:/repo localhost/otus-admin-ui-tools sh /repo/scripts/admin-ui-in-container.sh'
```

## 더 보기

- [`api.md`](api.md): API 명세 (기준 문서)
- [`frontend/README.md`](frontend/README.md): 프론트엔드 구조와 규칙
- [`CLAUDE.md`](CLAUDE.md): 아키텍처, 보안 설계, 개발 명령 (영문)

## 팀

| 이름 | 역할 |
| --- | --- |
| 김태빈 (taebkim) | PM / 기획·발표 |
| 김동민 (dongkim2) | Frontend |
| 이재현 (jaehylee) | Backend |
| 권혁준 (huckwon) | Data / 판별 로직 |
| 이도연 (doyelee) | Infra / 보안 |
