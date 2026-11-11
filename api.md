# OTUS API

관리자 확장 API(월별 목록·보완 이력·연속 검토·재검토·SMTP 안내·ZIP)는 이 문서 마지막의 **관리자 업무 API**에 정의한다.

이 문서가 기준이다. 구현이 다르면 구현을 고친다.

## 공통

- Base: `/api`
- 인증: 세션 쿠키 `__Host-session` (HttpOnly, 프론트에서 읽을 수 없음). 로그인 응답이 설정한다
- 상태 변경 요청(`POST`·`PUT`·`PATCH`·`DELETE`)
  - `Origin` 헤더가 앱 origin 중 하나와 같아야 한다 (다르거나 없으면 403). 앱 origin은 학생 앱 + 관리자 앱(`APP_ORIGINS`, dev `http://localhost:4200,http://localhost:4201`)이다
  - 로그인 후에는 `X-XSRF-TOKEN` 헤더에 `XSRF-TOKEN` 쿠키 값을 넣는다. Angular `HttpClient`가 상대 경로(`/api/...`) 요청에 자동으로 붙인다
- 시간: ISO 8601, KST (`+09:00`)
- 월: ASCII 숫자의 `YYYY-MM`. 부호·공백·한 자리 월은 허용하지 않는다

### enum

| status | 의미 |
| --- | --- |
| `draft` | 임시 저장 |
| `pending_review` | 검토 대기 |
| `approved` | 승인 완료 |
| `revision_requested` | 재검토 요청 |
| `resubmitted` | 재검토 대기 |

| kind | 의미 | 필요한 서류 |
| --- | --- | --- |
| `initial` | 최초 4종 | 4종 전부 |
| `monthly` | 월별 | `employment_insurance` |
| `supplement` | 보완 | 재검토 요청 받은 서류 |

| doc_type | 의미 |
| --- | --- |
| `id_card` | 신분증 |
| `resident_abstract` | 주민등록초본 |
| `bankbook` | 통장사본 |
| `employment_insurance` | 고용보험가입내역서 |

### 에러 body

```json
{ "error": { "code": "CYCLE_CLOSED", "message": "접수 기간이 아닙니다." } }
```

| code | status |
| --- | --- |
| `INVALID_REQUEST` | 400 |
| `UNAUTHORIZED` | 401 |
| `FORBIDDEN` | 403 |
| `NOT_FOUND` | 404 |
| `INVALID_STATE` | 409 |
| `FILE_TOO_LARGE` | 413 |
| `NOT_PDF` | 415 |
| `CYCLE_CLOSED` | 422 |
| `DOC_TYPE_NOT_ALLOWED` | 422 |
| `MALWARE_DETECTED` | 422 |
| `RATE_LIMITED` | 429 |
| `SCAN_UNAVAILABLE` | 503 |
| `INTERNAL_ERROR` | 500 |

### 요청 제한

넘으면 `429 RATE_LIMITED`와 `Retry-After` 헤더(초)를 돌려준다.

| 대상 | 기준 | 한도 |
| --- | --- | --- |
| 로그인 (`/api/auth/*`) | IP | 분당 10번 |
| 모든 상태 변경 요청 | 세션 | 분당 60번 |
| 파일 업로드 (제출 파일, 통장사본) | 세션 | 연속 20번, 이후 30초에 1번 |
| 원본 파일 내려받기 (`/api/files/*`) | 세션 | 연속 30번, 이후 10초에 1번 |

- 22 MB가 넘는 요청은 프록시(Caddy)가 먼저 막는다. 이때 `413`에 JSON body가 없다

---

## GET /api/auth/methods

로그인 화면(U01)에 보여 줄 로그인 방법. 로그인 없이 부를 수 있다.

```json
{ "forty_two": true, "demo": true }
```

---

## GET /api/auth/42/login

42 계정 로그인 시작. **XHR이 아니라 페이지 이동**으로 연다 (`<a href="/api/auth/42/login">`). 42 로그인 화면으로 보냈다가 `GET /api/auth/42/callback`으로 돌아온다.

- 성공: 세션 쿠키를 설정하고 `/`로 보낸다 (가드가 `/initial` 또는 `/home`으로 보낸다)
- 실패: `/login?error=<code>`로 보낸다

| `error` | 뜻 |
| --- | --- |
| `oauth_denied` | 42 화면에서 취소함 |
| `oauth_state` | 로그인 요청이 만료됨(10분) 또는 위조됨. 다시 시도 |
| `not_campus_member` | 42 경산 캠퍼스 소속이 아님 |
| `oauth_failed` | 42 API 오류 등 |
| `staff_only` | 관리자 도메인에서 교육생 계정으로 로그인함 (세션 없음) |

- 42 OAuth가 설정되지 않은 서버에서는 404
- 주 캠퍼스(primary campus)가 42 경산(42 campus id 69)인 교육생만 로그인할 수 있다. 첫 로그인 때 사용자가 만들어지고, 이후 로그인 때 `login`·`display_name`이 42 기준으로 갱신된다

---

## POST /api/auth/demo-login

데모 로그인. 같은 `login`의 데모 사용자가 없으면 만든다. 데모 사용자는 실제 42 계정과 분리된다. 운영 환경에서는 꺼져 있다 (404).

Request

```json
{
  "login": "dongmin",
  "display_name": "동민"
}
```

- `login`: 영문 소문자·숫자·`-`·`_` 1~32자
- `display_name`: 선택, 1~50자. 없으면 `login`. 새로 만들 때만 쓰인다

Response: `GET /api/me`와 같은 body + `Set-Cookie` (`__Host-session`, `XSRF-TOKEN`)

| status | 언제 |
| --- | --- |
| 200 | 로그인 (이전 세션은 폐기) |
| 400 | `login`·`display_name` 형식 오류 |
| 403 | `Origin` 불일치 |
| 404 | 데모 로그인 꺼짐 |

---

## POST /api/auth/logout

세션 폐기, 쿠키 삭제. body 없음.

| status | 언제 |
| --- | --- |
| 204 | 로그아웃 |
| 401 | 세션 없음·만료 |
| 403 | `Origin` 불일치, `X-XSRF-TOKEN` 없음·불일치 |

---

## GET /api/me

로그인한 사용자. U01 분기에 쓴다.

Response

```json
{
  "id": 1,
  "login": "dongmin",
  "display_name": "동민",
  "role": "student",
  "is_demo": true,
  "employed": false,
  "employment_updated_at": null,
  "initial_submitted": false,
  "study_hours": 0,
  "ordinal": "5",
  "ko_name": "김동민",
  "date_of_birth": "2001-03-14"
}
```

- `role`: `student` · `operator` (운영 담당자) · `accountant` (회계·지정 담당자) · `admin` (관리자)
- 역할 부여는 `STAFF_ROLE_ALLOWLIST`(`login=role`)에 있는 42 계정만 로그인 때 받는다. 목록에서 빠지면 다음 로그인 때 `student`로 돌아간다. 데모 시드에는 `opsdemo`(operator)·`accountdemo`(accountant)·`admindemo`(admin)가 있다
- `employed`: 취업 상태. `employment_updated_at`: 마지막으로 바꾼 시각 (한 번도 안 바꿨으면 `null`)
- `initial_submitted`: `initial` 제출이 `draft`를 벗어났으면 `true` (검토 대기 중 포함). `false` → U02, `true` → U03
- `ordinal`: 42 기수(자유 텍스트 — `5`·`7기`·`8a`·`9기A`처럼 표기가 섞여 있어 문자열이다. 빈 값·50자 초과만 막는다). `ko_name`: 한글 이름. `date_of_birth`: 생년월일(`YYYY-MM-DD`). **42 API 응답에는 셋 다 없어서**(기수 번호가 없고, 표시 이름은 언어가 구분되지 않으며, 생년월일이 없음) 실제 로그인에서는 채워지지 않고 `null`이다. 본인이 `PATCH /api/me/profile`로 입력하는 값이며, 데모 계정만 시드 값이 들어 있다
- `study_hours`: 이번 달 KST 기준 학습 시간 구간. **40시간 미만은 `0`, 40시간 이상 80시간 미만은 `40`, 80시간 이상은 `80`**이다. `ref/time.py`처럼 42 locations에서 이번 달에 시작·종료한 세션과 현재 로그인 중인 세션을 페이지 끝까지 조회하고 ID로 중복을 제거한다. 월 시작~조회 시각으로 자른 뒤 KST 자정 기준으로 나누어 **하루 합계에 최대 12시간 상한**을 적용한다. 해당 월의 인정 초를 합산해 구간을 정하며 반올림하지 않는다 (`/api/me/time-requirements`와 같은 인정 시간 정책).
- 42 연동 미설정·조회 실패·20초 내 조회 미완료 시 `study_hours`는 `null`이며 사용자 정보는 정상 반환한다. 실제 학습 기록이 없으면 `0`이다. 데모 계정은 외부 API를 호출하지 않고 이번 달 저장된 시간 요건의 초를 샘플 학습 시간으로 사용하며, 데이터가 없으면 `0`이다. 데모 로그인·취업 상태 변경 응답에도 같은 필드를 포함한다.
- 세션은 30분 동안 요청이 없거나 로그인 후 12시간이 지나면 만료된다 → 401

| status | 언제 |
| --- | --- |
| 200 | 성공 |
| 401 | 세션 없음·만료 |

---

## POST /api/submissions

제출 생성. 같은 `kind` + `target_month`의 `draft`가 있으면 그걸 반환한다.

Request

```json
{
  "kind": "monthly",
  "target_month": "2026-10",
  "parent_id": null
}
```

- `parent_id`: `supplement`일 때만 필수. 다른 `kind`에 넣으면 400
- `supplement`의 `target_month`는 parent와 같아야 한다
- `required_doc_types`: `initial` = 4종, `monthly` = `employment_insurance`, `supplement` = parent가 재검토 요청 받은 서류 (지정이 없으면 parent의 서류 전부)
- 접수 기간: `target_month`의 접수 기간 안이어야 새로 만들 수 있다. 접수 기간이 설정되지 않은 달은 닫힌 것으로 본다
- **같은 달 최초/월별 중복 차단**: 최초 4종에는 그달 고용보험 서류가 이미 포함되므로, 같은 `target_month`에 `initial`과 `monthly`를 둘 다 제출할 수 없다(양방향). 이미 **제출 완료(draft가 아님)** 된 반대 종류가 있으면 409 `INVALID_STATE`다. 반대 종류의 draft만 있는 경우에는 만들 수 있지만, 그 draft를 최종 제출하는 시점에 같은 검사로 409가 된다(FINAL 제출 항목 참조). `supplement`(보완)는 이 규칙과 무관하다

Response

```json
{
  "id": "uuid",
  "kind": "monthly",
  "target_month": "2026-10",
  "status": "draft",
  "parent_id": null,
  "submitted_at": null,
  "review_comment": null,
  "required_doc_types": ["employment_insurance"],
  "files": [],
  "created_at": "2026-10-16T21:10:00+09:00"
}
```

- 이 모양이 제출(submission) 응답의 공통 형태다. `GET /api/submissions`의 `items`, finalize, dev 상태 변경도 같은 형태를 돌려준다
- `files`: 서류별 현재 파일 (교체된 이전 파일은 빠진다). 항목은 파일 업로드 응답과 같은 형태

| status | 언제 |
| --- | --- |
| 201 | 생성 |
| 200 | 기존 draft 반환 |
| 400 | 필드 오류, `supplement`인데 `parent_id` 없음, `supplement`가 아닌데 `parent_id` 있음, parent와 `target_month` 다름 |
| 404 | `parent_id` 없음 또는 내 것 아님 |
| 409 | parent가 `revision_requested` 아님 / `initial` 이미 제출됨 / 같은 달 `monthly` 이미 제출됨 / **같은 달에 제출 완료된 반대 종류(initial↔monthly)가 있음** |
| 422 | 접수 기간 밖 |

---

## POST /api/submissions/{id}/files

PDF 업로드. 같은 `doc_type` 재업로드 시 교체 (이전 파일은 이력으로 보관).

Request: `multipart/form-data`

| 필드 | 값 |
| --- | --- |
| `doc_type` | doc_type enum |
| `file` | PDF |

- 필드 순서는 상관없지만 `doc_type`을 먼저 넣으면 잘못된 `doc_type`을 파일 전송 전에 거절한다
- PDF 검증: 파일 이름이 `.pdf`로 끝나고, part의 `Content-Type`이 `application/pdf`이고, 내용이 `%PDF-`로 시작해야 한다
- 악성코드 검사: 저장하기 전에 ClamAV로 검사한다. 발견되면 422 `MALWARE_DETECTED`, 검사기를 쓸 수 없으면 503 `SCAN_UNAVAILABLE`이고 둘 다 저장하지 않는다 (통장사본 업로드도 같다)
- 응답의 `file_id`가 서버 저장 파일 이름이다. `original_name`은 경로를 뺀 이름만 남긴다

Response

```json
{
  "file_id": "uuid",
  "doc_type": "employment_insurance",
  "original_name": "고용보험_10월.pdf",
  "size": 183204,
  "uploaded_at": "2026-10-16T21:12:00+09:00"
}
```

| status | 언제 |
| --- | --- |
| 201 | 업로드 (교체 포함) |
| 400 | 필드 누락, 모르는 `doc_type` |
| 404 | 제출 없음 또는 내 것 아님 |
| 409 | 제출이 `draft` 아님, 같은 서류를 이미 10번 올림 |
| 413 | 용량 초과 (상한은 서버 설정 `MAX_UPLOAD_BYTES`, 기본 20 MiB 【확인 필요】) |
| 415 | PDF 아님 (확장자·MIME·매직바이트 중 하나라도 불일치, 빈 파일) |
| 422 | 이 제출에 필요 없는 서류 / 접수 기간 밖 / 악성코드 발견 |
| 503 | 악성코드 검사기를 쓸 수 없음 (잠시 후 다시 시도) |

---

## GET /api/submissions

내 제출 이력. 최신순.

Query (선택)

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `month` | - | 대상 월 필터 |
| `limit` | 전체 | 홈 최근 이력용 |
| `include_drafts` | `false` | draft 포함 여부 |

Response: `items`는 `POST /api/submissions` 응답과 같은 형태 (최신순 = 생성 시각 역순)

```json
{
  "items": [
    {
      "id": "uuid",
      "kind": "monthly",
      "target_month": "2026-10",
      "status": "revision_requested",
      "parent_id": null,
      "submitted_at": "2026-10-16T21:15:00+09:00",
      "review_comment": "10월 1일 이후 발급본이 아닙니다.",
      "required_doc_types": ["employment_insurance"],
      "files": [
        {
          "file_id": "uuid",
          "doc_type": "employment_insurance",
          "original_name": "고용보험_10월.pdf",
          "size": 183204,
          "uploaded_at": "2026-10-16T21:12:00+09:00"
        }
      ],
      "created_at": "2026-10-16T21:10:00+09:00"
    }
  ]
}
```

- `submitted_at`: draft면 `null`
- `review_comment`: `revision_requested`일 때만 값 있음

| status | 언제 |
| --- | --- |
| 200 | 성공 (없으면 `items: []`) |
| 400 | query 형식 오류 |

---

## POST /api/submissions/{id}/finalize

최종 제출. body 없음. 헤더 `Idempotency-Key: <UUID>` 필수. 같은 키로 다시 보내면 처리하지 않고 현재 상태를 돌려준다 (응답이 끊겼을 때 같은 키로 재시도한다).

- 상태 전이: `draft` → `pending_review` (검토 대기). `supplement`는 → `resubmitted` (재검토 대기)이고, parent도 `revision_requested` → `resubmitted`가 된다
- 필요한 서류가 모두 올라가 있고, 서버에 저장된 파일이 기록과 일치하는 것을 확인한 뒤에만 완료한다
- 성공하면 `submitted_at`이 채워진다. `initial`이면 `GET /api/me`의 `initial_submitted`가 `true`가 된다

Response: 제출 응답 형태 (`POST /api/submissions` 참고)

| status | 언제 |
| --- | --- |
| 200 | 최종 제출, 또는 같은 `Idempotency-Key` 재요청 |
| 400 | `Idempotency-Key` 없음·UUID 아님 |
| 404 | 제출 없음 또는 내 것 아님 |
| 409 | `draft` 아님 (이미 제출), 빠진 서류 있음 (message에 서류 이름), 다른 제출에 쓴 `Idempotency-Key`, parent가 이미 보완 제출됨, **같은 달에 제출 완료된 반대 종류(initial↔monthly)가 있음** (생성 시점에 없던 draft를 뒤늦게 제출하는 경우도 차단) |
| 422 | 접수 기간 밖 |
| 500 | 저장된 파일 확인 실패 (완료 처리하지 않음, 다시 업로드 후 재시도) |

---

## GET /api/files/{file_id}

원본 파일(제출 파일, 통장사본) 내려받기. `file_id`는 제출 응답의 `files[].file_id`, 계좌 응답의 `bankbook.file_id`다. **페이지 이동으로 연다** (`<a href="/api/files/...">`). 첨부 파일로 내려온다.

- 내려받을 수 있는 사람: 파일의 주인, 운영 담당자(`operator`), 회계·지정 담당자(`accountant`). 요청마다 서버가 DB의 역할을 확인한다 (IP로 판단하지 않음). `admin`과 남의 파일을 여는 교육생은 404
- 제출이 `draft`인 동안에는 주인만 원본을 열 수 있다. 관리자 제출 상세의 파일 ID 필드는 `files[].id`이며 같은 다운로드 경로에 사용한다
- 그 밖의 사람에게는 없는 파일과 똑같이 404를 준다 (파일이 있는지 알 수 없게)
- 내려받기는 모두 기록된다 (누가, 누구의 파일을, 언제, 어떤 권한으로)
- 응답 헤더: `Content-Type: application/pdf`, `Content-Disposition: attachment; filename*=UTF-8''<원래 이름>`, `Content-Security-Policy: sandbox; default-src 'none'`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`

| status | 언제 |
| --- | --- |
| 200 | PDF |
| 401 | 세션 없음·만료 |
| 404 | 없는 파일, 또는 권한 없음 |
| 429 | 내려받기 한도 초과 |

---

## GET /api/cycles/current

이번 달(KST) 접수 기간과 D-day.

Response

```json
{
  "target_month": "2026-10",
  "state": "open",
  "opens_at": "2026-10-01T00:00:00+09:00",
  "closes_at": "2026-11-01T00:00:00+09:00",
  "d_day": 15,
  "issued_after": "2026-10-01"
}
```

- 접수 기간은 관리자가 대상 월 안에서 설정한다. `opens_at`은 포함, `closes_at`은 **미포함** 경계다. 화면의 마감 시각은 `closes_at` 1초 전이다. 위 예시는 한 달 전체를 여는 경우이며, 시작·마감은 월중 시각일 수도 있다
- `state`: `not_set` (접수 기간 미설정 → 모두 잠금) · `upcoming` · `open` · `closed`
- `d_day`: 오늘(KST)부터 설정된 마감일(`closes_at` 1초 전의 KST 날짜)까지 남은 날 수. 0이면 오늘 마감, 음수면 지남. `not_set`이면 `null` (`opens_at`·`closes_at`도 `null`). 접수 가능 여부는 날짜가 아니라 `state`로 판단한다
- `issued_after`: 발급 기준. 이 날짜 이후 발급본만 받는다

| status | 언제 |
| --- | --- |
| 200 | 성공 |
| 401 | 세션 없음·만료 |

---

## GET /api/me/time-requirements

내 월별 시간 요건 (issue #10). 최신 달부터. 이번 달 항목은 기록이 없어도 항상 있다 (`recognized_seconds: 0`).

- 하루 인정 = min(그날 로그인 합계, 12시간), KST 자정 분할, 초 단위·반올림 없음. 42 `locations`를 client credentials로 가져오며 429는 `Retry-After`를 따른다
- `thresholds`·금액·`decides_at`(다음 달 1일 09:00 KST)는 서버가 값으로 준다. FE는 계산하지 않는다
- 세 축(시간 요건 `result`, 서류 `status`, 최종 수령 대상 `final`)은 섞지 않는다. `final`은 운영진이 정하며 자동 확정하지 않는다
- 취업 중인 교육생도 항목을 준다 (카드를 숨길지는 FE가 `employed`로 정한다). 판정 보류(`on_hold`)는 자동 재시도하지 않고 dev/운영 재실행으로 다시 판정한다

Query (선택): `month=YYYY-MM`, `limit`(기본 12, 최대 36)

```json
{ "items": [{ "month": "2026-10", "phase": "in_progress", "as_of": "2026-10-17T14:00:00+09:00",
  "recognized_seconds": 189000,
  "thresholds": [{ "tier": "tier_1", "seconds": 144000, "amount": 500000 }, { "tier": "tier_2", "seconds": 288000, "amount": 1000000 }],
  "projected_tier": "tier_1", "decides_at": "2026-11-01T09:00:00+09:00", "result": null,
  "final": { "status": "undecided", "amount": null, "decided_at": null } }] }
```

- `phase`: `in_progress` · `awaiting_decision` · `decided`. `result.status`: `met` · `not_met` · `on_hold`(42 API 실패 등). `tier`는 `met`일 때만
- 월중 집계는 시간당 작업이 `/api/me`와 같은 월별 42 세션 조회·KST 일별 12시간 상한으로 갱신하고, 40·80시간 첫 도달 시 `hours_projected` 알림을 한 번씩 보낸다. 다음 달 1일 09:00 판정 작업이 `result`를 정한다 (실패 시 `on_hold`)

| status | 언제 |
| --- | --- |
| 200 | 성공 |
| 400 | `month` 형식 오류 |
| 401 | 세션 없음·만료 |

---

## 알림

서버는 `kind`와 `data`를 준다. 자동 안내 문구는 FE가 쓰고, `admin_notice`는 운영자가 작성한 제목·본문을 그대로 표시한다. 읽음 상태는 서버가 가진다.

| kind | data |
| --- | --- |
| `hours_projected` | `month`, `tier` |
| `time_requirement_decided` | `month`, `status`, `tier` |
| `final_decided` | `month`, `status` |
| `submission_period_opened` | `month` |
| `submission_reminder` | `month` |
| `study_hours_notice` | `month`, `study_hours` (`0`, `40`, `80`): 운영자가 해당 시간 구간을 선택해 보낸 안내. 최종 지급 확정 알림이 아님 |
| `admin_notice` | `month`, `title`, `body`: 운영자가 직접 작성한 알림. 제목과 본문은 HTML이 아닌 일반 텍스트로 표시하며 본문의 줄바꿈을 유지한다 |
| `submission_revision_requested` · `submission_approved` | `submission_id`, `month` |
| `bank_account_approved` | (없음) |
| `bank_account_rejected` | `decision_note` |

### GET /api/notifications

Query: `limit`(기본 20, 최대 50), `before`. Response: `{ "items": [{ "id", "kind", "created_at", "read_at", "data" }], "next_before": null }` (최신순)

### GET /api/notifications/unread-count

`{ "count": 3 }`

### POST /api/notifications/{id}/read · POST /api/notifications/read-all

둘 다 204. 이미 읽었어도 204(멱등). 없는 id·남의 알림은 404.

---

## POST /api/dev/time-requirements/decide

데모용. 그 달의 1일 09:00 판정을 지금 실행한다 (실제 작업과 같은 경로, 알림 포함). 데모 로그인이 꺼져 있거나 데모 사용자가 아니면 404.

Request: `{ "month": "2026-09" }` → Response: 시간 요건 항목 하나

데모 시드: `elig0`(0시간·지난달 미충족), `eliglow`(40 미만·지난달 tier_1 충족), `eligmid`(40~80·지난달 tier_2 충족), `elighigh`(80 이상·지난달 판단 보류).

---

### 42 로그인의 관리자 표면 (issue #9)

- 관리자 서브도메인에서 시작하는 로그인은 `GET /api/auth/42/login?surface=admin`으로 시작한다. 콜백은 `FORTY_TWO_ADMIN_REDIRECT_URI`(42 앱에도 등록 필요)를 쓰고, 세션 쿠키는 그 호스트에만 생긴다
- 관리자 표면에서 교육생 역할로 로그인하면 세션을 만들지 않고 `/login?error=staff_only`로 보낸다

---

## GET /api/admin/activity

운영·회계 담당자용. 최근 30일의 교육생 취업 상태 변경과 계좌 변경 요청을 최신순으로 준다 (읽기 전용). Query: `limit`(기본 20, 최대 50).

```json
{ "items": [
  { "id": "employment:12:1760760000000", "kind": "employment_changed",
    "user": { "id": 12, "login": "dongmin", "display_name": "동민" },
    "occurred_at": "2026-10-18T12:00:00+09:00", "data": { "employed": true } },
  { "id": "bank:7", "kind": "bank_account_requested",
    "user": { "id": 12, "login": "dongmin", "display_name": "동민" },
    "occurred_at": "2026-10-18T11:00:00+09:00", "data": { "status": "pending" } }
] }
```

`id`는 폴링 사이에 바뀌지 않는다. 취업 상태는 교육생당 마지막 변경 한 건만 남는다. 계좌번호는 어떤 형태로도 싣지 않는다. 교육생 세션은 403, 세션 없음은 401.

---

## GET /api/admin/users

관리자용 교육생 목록. `operator`·`accountant`·`admin`만 부를 수 있다 (교육생 403, 미로그인 401).

Query (선택): `query`(교육생 검색 — `login`(인트라 ID)·표시 이름·`ko_name`(한글 이름) 중 하나라도 부분 일치하면 포함. 대소문자 무시(ILIKE), `%`·`_`는 와일드카드가 아니라 글자 그대로 매칭), `limit`(기본 20, 최대 50), `before`(그 id보다 오래된 사용자)

Response: `{ "items": [{ "id", "login", "display_name", "employed", "initial_submitted", "ordinal", "ko_name", "date_of_birth" }], "next_before": 12 | null }` (`ordinal`·`ko_name`·`date_of_birth`는 입력 전이면 `null`)

## GET /api/admin/users/{id}

교육생 한 명. 교육생이 아니거나 없으면 404. 권한 규칙은 목록과 같다.

Response: `{ "id", "login", "display_name", "role", "employed", "employment_updated_at", "initial_submitted", "ordinal", "ko_name", "date_of_birth" }`

## GET /api/admin/users/{id}/bank-account

교육생 한 명의 계좌. `operator`·`accountant`·`admin`만 부를 수 있다 (교육생 403, 미로그인 401, 교육생이 아니거나 없으면 404). 응답은 `GET /api/me/bank-account`와 같은 body이며 `current`·`pending`·`last_rejected` 안의 계좌번호는 항상 마스킹(`•••• 1234`)이다. `bankbook.file_id`는 `GET /api/files/{id}`로 연다.

## POST /api/admin/users/{id}/bank-account/review

교육생의 검토 대기(`pending`) 계좌 변경을 승인하거나 반려한다. `operator`·`accountant`만 부를 수 있다(교육생 403, `admin` 403, 미로그인 401, 교육생이 아니거나 없으면 404). 상태 변경이므로 Origin·CSRF 검증을 적용한다.

Request

```json
{ "request_id": 11, "decision": "rejected", "note": "통장사본의 계좌번호와 입력한 계좌번호가 달라요." }
```

- `request_id`: 결정할 요청의 id. 계좌 응답의 `pending.id`다. 교육생이 그사이 새로 요청해 `pending`이 바뀌었으면 다른 id이므로 409다(옛 요청을 잘못 승인하지 않는다).
- `decision`: `approved` 또는 `rejected`. 그 밖의 값은 400.
- `note`: 반려에는 필수(앞뒤 공백 제거 후 1~1000자, 교육생에게 그대로 보인다). 승인에는 쓸 수 없다(400).
- 승인하면 그 요청이 지급에 쓰는 계좌(`current`)가 된다. 반려하면 기존 계좌가 그대로 쓰인다. 승인 전에 통장사본을 디스크에서 읽어 크기·해시를 다시 확인한다.
- 결정은 한 번의 조건부 갱신(`status='pending'`)으로 기록하고 `decided_by`·`decided_at`을 남긴다. 다른 담당자가 먼저 처리했으면 409다.

Response: `GET /api/admin/users/{id}/bank-account`와 같은 body

| status | 언제 |
| --- | --- |
| 200 | 처리됨 |
| 400 | `decision` 값 오류, 반려 사유 없음·1000자 초과, 승인에 사유 포함 |
| 403 | 교육생·`admin` |
| 404 | 교육생이 아니거나, 그 교육생의 `request_id`가 없음 |
| 409 | 이미 처리됐거나 새 요청으로 바뀜 |

### 역할별 접근 규칙

| 대상 | student | operator | accountant | admin |
| --- | --- | --- | --- | --- |
| 교육생·월별 제출·보완 이력·자료함 목록·제출 안내 | 403 | ✅ | ✅ | ✅ |
| 연속 검토 목록·이전/다음 탐색·승인·재검토 요청 | 403 | ✅ | ✅ | 403 |
| ZIP 생성·상태·다운로드 | 403 | 403 | 생성자 본인만 | 403 |
| 원본 파일 `GET /api/files/{file_id}` (남의 완료 제출) | 404 (본인 것만 허용) | ✅ | ✅ | ✅ |
| 원본 열람·다운로드 기록 | - | 감사 로그(`file_access_log`, 추가만 가능)에 `access_basis=operator/accountant/admin`로 남는다 | ✅ | ✅ |

---

## POST /api/dev/submissions/{id}/status

데모용. 검토자 대신 내 제출의 상태를 바꾼다. 데모 로그인이 꺼져 있거나 데모 사용자가 아니면(42 계정) 404.

Request

```json
{
  "status": "revision_requested",
  "review_comment": "10월 1일 이후 발급본이 아닙니다.",
  "revision_doc_types": ["employment_insurance"]
}
```

- `status`: `approved` 또는 `revision_requested`
- `review_comment`: `revision_requested`일 때 필수 (1000자 이하)
- `revision_doc_types`: 선택. 보완 제출에서 다시 낼 서류 (이 제출의 서류 중에서). 비우면 전부
- `pending_review`·`resubmitted`인 제출만 바꿀 수 있다. 보완 제출을 승인하면 `resubmitted`인 parent도 함께 승인된다

Response: 제출 응답 형태

| status | 언제 |
| --- | --- |
| 200 | 변경 |
| 400 | 잘못된 `status`, `review_comment` 없음, 이 제출에 없는 `revision_doc_types` |
| 404 | 제출 없음·내 것 아님, 데모 꺼짐 |
| 409 | 검토 대기 상태가 아님 |

---

## PATCH /api/me/profile

내 프로필(기수·한글 이름·생년월일) 부분 수정. 경로에 id가 없어 본인 것만 바꿀 수 있다. `PATCH /api/me/employment`와 같은 방식이며, 응답은 갱신된 `GET /api/me`와 같다.

Request (전부 선택; **생략 = 유지, `null` = 비우기, 값 = 교체**)

```json
{ "ordinal": "9기A", "ko_name": "한지민", "date_of_birth": "2003-04-21" }
```

- `ordinal`: 자유 텍스트 기수(`1`·`3a`·`4기A` 등). 앞뒤 공백을 제거해 저장하며, 공백 제거 후 1~50자가 아니면 400
- `ko_name`: 앞뒤 공백 제거 후 1~50자, 아니면 400
- `date_of_birth`: `YYYY-MM-DD` 실제 날짜, `1900-01-01`부터 오늘(KST)까지가 아니면 400
- 잘못된 값은 DB 제약 오류(500)가 아니라 아래 400 `INVALID_REQUEST`로 돌아온다

| status | 언제 |
| --- | --- |
| 200 | 성공 (응답 = 갱신된 `Me`) |
| 400 | 빈 값·50자 초과·날짜 형식/범위 오류, JSON 형식 오류 |
| 401 | 세션 없음·만료 |

관리자 쪽 쓰기 API는 없다: `GET /api/admin/users[/{id}]`는 조회 전용이며, 직원이 남의 프로필을 바꾸는 경로는 아직 만들지 않았다(필요하면 별도 합의 후 추가).

---

## PATCH /api/me/employment

취업 상태 변경. 바로 저장된다 (검토 없음). 취업 중이면 미제출 알림 대상에서 빠진다.

Request

```json
{ "employed": true }
```

Response: `GET /api/me`와 같은 body

| status | 언제 |
| --- | --- |
| 200 | 저장 |
| 400 | `employed`가 boolean 아님 |
| 401 | 세션 없음·만료 |

---

## GET /api/me/bank-account

내 계좌. 계좌번호는 항상 마스킹되어 나온다 (뒤 4자리만). 원문은 서버에 암호화되어 있고 교육생에게는 내려가지 않는다.

Response

```json
{
  "current": {
    "id": 11,
    "bank": "신한은행",
    "account_number_masked": "•••• 6789",
    "status": "approved",
    "requested_at": "2026-10-16T23:13:10+09:00",
    "decided_at": "2026-10-16T23:20:00+09:00",
    "decision_note": null,
    "bankbook": {
      "file_id": "uuid",
      "original_name": "통장사본.pdf",
      "size": 183204
    }
  },
  "pending": null,
  "last_rejected": null
}
```

- 계좌 객체(`current`·`pending`·`last_rejected`)의 `id`는 그 변경 요청의 id다.
- `current`: 승인되어 지급에 쓰는 계좌. 승인된 적이 없으면 `null`
- `pending`: 검토 대기 중인 변경 요청. 승인 전까지는 `current`가 그대로 쓰인다
- `last_rejected`: `current`보다 나중에 반려된 요청 (반려 사유는 `decision_note`). 없으면 `null`
- `bankbook`: 요청과 함께 낸 통장사본

| status | 언제 |
| --- | --- |
| 200 | 성공 |
| 401 | 세션 없음·만료 |

---

## PUT /api/me/bank-account

계좌 등록·변경 요청. 새 통장사본 PDF를 함께 낸다. 바로 반영되지 않고 `pending`이 된다. 이미 `pending`이 있으면 새 요청으로 바뀐다 (이전 요청과 파일은 이력으로 남는다).

Request: `multipart/form-data`

| 필드 | 값 |
| --- | --- |
| `bank` | 은행 이름, 1~30자 |
| `account_number` | `-`·공백을 뺀 숫자 8~20자리 |
| `file` | 통장사본 PDF (검증·용량 상한은 파일 업로드와 같다) |

Response: `GET /api/me/bank-account`와 같은 body

| status | 언제 |
| --- | --- |
| 200 | 요청 접수 |
| 400 | 필드 누락·형식 오류, multipart 아님 |
| 401 | 세션 없음·만료 |
| 409 | 하루 요청 한도(5번) 초과 |
| 413 | 용량 초과 |
| 415 | 통장사본이 PDF 아님 |
| 422 | 통장사본에서 악성코드 발견 |
| 503 | 악성코드 검사기를 쓸 수 없음 |

---

## POST /api/dev/me/bank-account/review

데모용. 회계·지정 담당자 대신 내 `pending` 계좌 변경을 처리한다. 데모 로그인이 꺼져 있거나 데모 사용자가 아니면(42 계정) 404.

Request

```json
{ "decision": "rejected", "note": "통장사본과 계좌번호가 다릅니다." }
```

- `decision`: `approved` (→ `current`가 된다) 또는 `rejected` (기존 `current` 유지)
- `note`: `rejected`일 때 필수
- 승인 전에 저장된 통장사본을 다시 확인한다. 파일이 기록과 다르면 500이고 `pending`으로 남는다

Response: `GET /api/me/bank-account`와 같은 body

| status | 언제 |
| --- | --- |
| 200 | 처리 |
| 400 | 잘못된 `decision`, 반려인데 `note` 없음 |
| 404 | 데모 꺼짐 |
| 409 | `pending` 없음 |

---

## 관리자 업무 API

2026-10-18 확정: 보완 기능은 재제출본 조회와 이력 확인이다. 관리자 대리 업로드·문서 비교·내부 메모는 이번 확장에 포함하지 않는다. 기존 학생 API는 유지한다.

| 기능 | 허용 역할 |
| --- | --- |
| 월별 목록·제출 상세·보완 이력·자료함 목록·제출 안내 | `operator`, `accountant`, `admin` |
| 연속 검토·승인·재검토 요청 | `operator`, `accountant` |
| ZIP 생성·상태·다운로드 | `accountant`, 생성자 본인의 작업만 |
| 제출 기간·변경 이력 조회 | `operator`, `accountant`, `admin` |
| 제출 기간 추가·수정 | `operator`, `admin` |

매 요청 DB의 현재 역할을 검사한다. 미로그인은 401, 역할 부족은 403이다. 관리자에게 `draft` ID·파일·본문을 노출하지 않으며, draft 상세와 원본은 소유자 외 404다. 날짜는 KST, 월은 `YYYY-MM`이다. 잘못된 경로 ID는 404, 잘못된 본문·조회 조건은 공통 JSON 400이다. 상태 변경에는 Origin·CSRF 검증을 적용한다.

### GET /api/admin/cycles

Query: `year`(기본 KST 올해, 정수 1~9998). 알 수 없는 조회 필드는 400이다. 해당 연도의 12개월을 오름차순으로 모두 반환한다.

```json
{
  "current_month": "2026-10",
  "year": 2026,
  "can_manage": true,
  "items": [
    {"target_month":"2026-01","opens_at":null,"closes_at":null,"version":null,"state":"not_set"},
    {"target_month":"2026-10","opens_at":"2026-10-21T09:00:00+09:00","closes_at":"2026-11-01T00:00:00+09:00","version":1,"state":"upcoming"}
  ]
}
```

예시의 `items`는 생략한 달이 있다. 실제 응답은 항상 12개다. `state`는 `not_set`·`upcoming`·`open`·`closed`이고 서버 현재 시각으로 계산한다. `can_manage`는 역할에 따른 편집 권한이며, `true`여도 `target_month < current_month`인 달은 편집할 수 없다.

### PUT /api/admin/cycles/{month}

월별 기간 추가 또는 수정. 경로 `month`는 `YYYY-MM`, 연도 1~9998이다. 현재·미래 월만 저장할 수 있다.

```json
{
  "opens_at": "2026-11-21T09:00:00+09:00",
  "closes_at": "2026-12-01T00:00:00+09:00",
  "expected_version": null
}
```

- 시간대가 포함된 ISO 8601 시각을 초 단위로 받는다. 대상 월 KST 1일 00:00 ≤ `opens_at` < `closes_at` ≤ 다음 달 1일 00:00이어야 한다. 월을 넘기는 연장은 지원하지 않는다.
- 화면은 입력한 마감 시각까지 포함하므로, API에는 그 시각에 1초를 더한 `closes_at`을 보낸다.
- 추가는 `expected_version: null` 또는 생략, 수정은 조회한 양수 `version`을 보낸다. 다른 담당자가 먼저 추가·수정했거나 버전이 다르면 409 `INVALID_STATE`로 거절한다. 클라이언트는 최신 값을 다시 불러와 확인한다.
- 성공은 200이며 목록의 항목 하나와 같은 형식이다. 최초 버전은 1, 실제 수정마다 1 증가한다. 일치하는 버전과 동일한 시간으로 다시 저장하면 버전·이력을 추가하지 않는다. 이 API는 `Idempotency-Key` 대신 버전으로 동시 변경을 제어한다.
- 기간 변경과 변경 이력은 한 트랜잭션으로 저장한다. 기존 제출·파일은 유지한다. 저장한 시간은 제출 생성·업로드·최종 제출·보완·재검토 요청·제출 안내에 적용하며, 마감 후에도 검토 대기 서류 승인은 가능하다. 당월 마감된 기간도 당월 범위 안에서 다시 열 수 있다.
- 형식 오류·알 수 없는 본문 필드·범위를 벗어난 기간·지난달 변경은 400 `INVALID_REQUEST`, 권한 부족은 403이다.
- 미래 월은 미리 등록해야 한다. 월 변경 시 자동으로 새 기간을 만들지 않으며, 삭제 API는 제공하지 않는다.

### GET /api/admin/cycles/{month}/history

변경 이력을 버전 내림차순으로 최근 50건 반환한다. 추가·수정 당시 담당자 이름·역할과 변경 전후 시각을 보존하며, 담당자 이름이 바뀌어도 이력은 바뀌지 않는다. 미설정 월이나 변경 기록이 없는 기존 기간은 빈 배열이다. 잘못된 월 형식은 400이다.

```json
[
  {
    "version": 1,
    "actor_name": "운영 담당자",
    "actor_role": "operator",
    "previous_opens_at": null,
    "previous_closes_at": null,
    "opens_at": "2026-11-21T09:00:00+09:00",
    "closes_at": "2026-12-01T00:00:00+09:00",
    "created_at": "2026-10-18T12:00:00+09:00"
  }
]
```

### GET /api/admin/submissions

월별 교육생 목록. Query: `month`(기본 이번 달), `query`(이름/login 부분검색, 100자 이하), `status`(`all`, `unsubmitted`, `pending_review`, `approved`, `revision_requested`, `resubmitted`), `limit`(기본 20, 1~50), `before`(양수 user ID).

```json
{"month":"2026-10","months":["2026-10","2026-09"],"items":[{
  "user":{"id":1,"login":"demo","display_name":"데모","employed":false,"initial_submitted":true,"ordinal":"5","ko_name":"김동민","date_of_birth":"2001-03-14"},
  "chains":[{"root_submission_id":"uuid","root_kind":"initial","latest_submission_id":"uuid","latest_kind":"supplement","status":"resubmitted","submitted_at":"2026-10-18T12:00:00+09:00","supplement_count":1}],
  "last_submitted_at":"2026-10-18T12:00:00+09:00"
}],"next_before":null}
```

- 교육생당 한 행. 그달 말 이전 등록한 교육생을 대상으로 최초 제출 미완료자·취업자·미제출자도 표시한다. `employed`와 `initial_submitted`는 현재 값이며 과거 시점의 취업 여부를 추정하지 않는다.
- 최초 4종을 최종 제출한 달에는 고용보험 서류를 포함한 **최초 제출 체인만** 검토 대상으로 표시한다. 같은 달에 별도로 제출된 월별 체인과 그 보완본은 목록·상태 필터에서 제외한다. 최초가 draft뿐인 경우나 다른 달의 최초 제출은 월별 검토를 제외하지 않는다.
- 각 체인의 마지막 **완료 제출**만 상태를 대표하며, 아직 제출하지 않은 보완 draft는 제외한다. 최초와 월별의 원본·이력은 독립적으로 보존한다. 검토 대상인 공개 제출이 없으면 `chains: []`, `last_submitted_at: null`이다.
- 상태 필터는 체인 중 하나라도 일치하면 포함한다. `unsubmitted`는 조회 조건이며 저장되는 제출 상태 enum이 아니다. 정렬은 user ID 내림차순이다.
- `months`는 완료 제출이 있는 달과 기간이 등록된 달에 이번 달과 요청한 달을 더한 내림차순 목록이다. 미리 등록한 미래 월도 선택할 수 있다. `next_before`가 `null`이면 마지막 페이지다. 검색·상태 필터를 바꾸면 커서를 초기화한다.

### GET /api/admin/submissions/{id}

제출 상세. `user`(`id`, `name`, `login`, `employed`), `id`, `kind`, `target_month`, `status`, `parent_id`, `root_id`, `root_kind`, `latest_submission_id`, `submitted_at`, `created_at`, `required_doc_types`, `review_comment`, `revision_doc_types`, `files`, `cycle`을 반환한다.

`files[]`는 해당 제출이 실제 제출한 현재 파일이며 `{id,doc_type,original_name,size_bytes,uploaded_at}` 형식이다. 보완 제출에는 다시 낸 서류만 들어간다. `cycle`은 `{opens_at,closes_at,issued_after}`이며 해당 월 설정이 없으면 `null`이다. 원본은 기존 `/api/files/{id}`로 연다.

최초 제출 월의 중복 월별 체인을 목록에서 제외해도 기존 상세·이력·원본 URL은 유효하다. 제외는 목록과 연속 검토 대상 선정 규칙이며, 개별 검토 API의 상태·권한 조건을 변경하지 않는다.

### GET /api/admin/submissions/{id}/history

`{root_id,root_kind,latest_submission_id,items}`. 같은 최초/월별 제출 체인의 완료 제출들을 최신순으로 반환한다. 각 항목은 ID·종류·부모·월·상태·시각·필수/보완 서류·해당 제출 파일을 담는다. 다른 체인과 draft는 포함하지 않는다.

### GET /api/admin/submissions/{id}/events

`{root_id,items}`. 체인 전체의 제출·재제출·승인·재검토 요청 이벤트를 최신순으로 반환한다. 항목: `id`, `submission_id`, `at`, `action`, `from_status`, `to_status`, `actor:{name,role}`, `review_comment`, `revision_doc_types`.

새 검토 결정은 당시 처리자 이름·역할·사유·요청 서류를 영구 보존한다. 보완 승인으로 상위 제출에 전파된 승인 이벤트도 같은 결정의 처리자 스냅샷을 사용한다. 기존 이벤트 중 저장된 결정과 연결할 수 있는 전파 이력은 마이그레이션으로 복원한다. 스냅샷이 없는 과거·데모 이벤트의 처리자만 현재 프로필을 사용하며, 당시 사유/요청 서류를 현재 제출값으로 추정하지 않는다. 부모에 전파된 상태 변경도 원래 `submission_id`와 상태 전이로 구분된다.

### GET /api/admin/review-queue

Query: `month`(기본 이번 달), `limit`(기본 20, 1~50), `after`(이 응답의 불투명 커서). 응답: `{month,items,next_after}`. `items[]`는 `{id,user:{id,name,login,employed,ordinal,ko_name,date_of_birth},kind,target_month,status,submitted_at}`. `GET /api/admin/submissions/{id}`의 `user`도 같은 필드를 가진다(`ordinal`·`ko_name`·`date_of_birth`는 입력 전이면 `null`).

`pending_review`·`resubmitted`인 완료 체인의 말단만 포함한다. 최초 4종을 최종 제출한 달은 최초 체인과 그 보완본만 포함하며, 같은 달의 별도 월별 체인·보완본은 제외한다. 보완의 부모를 중복 검토하지 않는다. 취업 중인 학생도 이미 제출한 서류는 검토한다. 접수 시각 오름차순, 같은 시각은 UUID 오름차순이다.

### GET /api/admin/submissions/{id}/navigation

Query: `month`(생략하면 이번 달). `{previous_id,next_id,remaining_count}`를 반환한다. 연속 검토 목록과 같은 제외 기준을 적용한 해당 월의 미처리 건만 이전·다음 대상과 남은 건수에 포함하며, 방금 처리한 제출도 탐색 기준점으로 사용할 수 있다.

- 정렬 기준은 `(submitted_at, id)`이며 이전/다음 대상이 없으면 해당 ID는 `null`이다. `remaining_count`는 현재 제출을 제외한 그달의 전체 검토 대기 제출 건수다. 현재 위치 이후의 건수만 세는 값이 아니다.
- 조회 월이 현재 제출의 `target_month`와 다르면 404다. 과거 월을 탐색할 때는 `month`를 명시한다. API는 제출 단위이며, 화면의 이전/다음 사용자 이동은 동일 사용자를 건너뛴다.

### POST /api/admin/submissions/{id}/review

`Idempotency-Key: <UUID>` 필수. Body는 `{"status":"approved"}` 또는 다음 형식이다.

```json
{"status":"revision_requested","review_comment":"선명한 PDF로 다시 제출해주세요.","revision_doc_types":["bankbook"]}
```

- 사유는 앞뒤 공백 제거 후 1~1000자이며 학생에게 보인다. 요청 서류는 해당 제출의 필수 서류 중에서 선택하고, 생략·빈 배열은 전체를 의미한다.
- 보완본의 필수 서류는 그 보완본에서 다시 제출한 항목이다. 변경하지 않은 상위 제출의 다른 서류를 보완 요청에 추가할 수는 없다. 승인 시에는 상위 제출에서 유지되는 원본도 함께 무결성을 검사한다.
- 완료 체인의 말단이며 `pending_review`·`resubmitted`인 경우만 처리한다. 다른 담당자가 먼저 처리하거나 오래된 부모를 처리하면 409다. 화면을 여는 동안 독점 배정하지 않는다.
- **마감 후에는 승인만 허용한다.** 재검토 요청은 학생의 보완 제출과 같은 당월 접수 기간을 따르며, 닫혔으면 422 `CYCLE_CLOSED`다.
- 승인 전 보완 체인의 현재 유효 원본을 무결성 확인하고, `resubmitted`인 조상을 함께 승인한다. 실패하면 상태·이력·알림을 모두 되돌린다.
- 응답은 기존 제출 응답에 `reviewed_by:{name,role}`, `reviewed_at`을 추가한 형식이다. 상태·감사 스냅샷·학생 알림을 한 트랜잭션으로 기록한다.
- **이메일**: 승인·재검토 요청 알림(`submission_approved`·`submission_revision_requested`)은 같은 트랜잭션에서 이메일 대기열(`event_emails`)에도 들어가고, 별도 작업이 `{login}@{MAIL_RECIPIENT_DOMAIN}`으로 보낸다. 재검토 요청 메일에는 보완할 서류와 검토 의견이 들어간다. 시간 요건 알림(`hours_projected`·`time_requirement_decided`)도 같은 방식으로 메일이 나간다. SMTP가 설정되지 않았으면 `skipped`(`smtp_not_configured`)로 남고 앱 알림에는 영향이 없다. 전송 중 응답이 불확실하면 `failed`(`delivery_unknown`)이고 자동으로 재시도하지 않는다. 관리자 '알림 보내기'는 기존 `channel` 규칙을 그대로 따른다.
- 같은 키·담당자·대상·정규화된 본문은 **최초 응답을 그대로** 반환한다. 이후 상태가 바뀌거나 마감돼도 재시도는 가능하다. 다른 본문/담당자/대상 또는 finalize에서 사용한 키면 409다.

### GET /api/admin/notices/submission-reminder

관리자 메뉴명은 **알림 보내기**다. 제목·내용 작성 → 채널·대상 선택 및 명단 확인 → 최종 확인 → 발송 순서다. 기존 경로를 유지한다. Query: `month`(기본 이번 달), `audiences`(쉼표로 구분한 대상 조건). 여러 조건은 **합집합**이며 사용자 ID로 중복을 제거한다. 조건은 1~7개이고 중복 조건은 정리해 반환한다. 빈 값·알 수 없는 조건은 400이다.

관리자 화면의 대상 선택지는 **미제출 / 40시간 미만 / 40~80시간 구간 / 80시간 이상 / 취업자 / 전체 학생** 순서다. 40~80시간 구간은 40시간 이상 80시간 미만이다.

`audiences`는 아래 네 가지와 `employed`(취업자), `all`(전체 학생)을 지원한다. `employed`는 현재 `employed=true`인 모든 `student` 계정이며 최초 서류 등록·월별 제출·학습 시간과 관계없이 포함한다. 기존 `eligible`(40시간 이상 수령 대상자) API 지원도 유지하지만 화면 선택지에는 표시하지 않는다. `eligible`은 최초 서류 등록을 마친 미취업 학생의 최근 월별 인정 시간 40시간 이상이며 최종 지급 확정을 뜻하지 않는다. `all`은 최초 등록 전·취업 중인 학생도 포함하는 모든 `student` 계정이다. 직원은 포함하지 않는다. 화면에서 전체 학생을 고르면 다른 조건을 해제한다.

직접 작성 알림은 현재·과거 월을 선택할 수 있고 접수 기간이 닫혀도 미제출 명단을 조회·발송할 수 있다. 미래 월은 400이다. `audiences`를 생략하면 기존 단일 `audience` 방식(기본 `unsubmitted`)으로 동작하며 아래의 접수 기간 제한과 자동 안내 문구를 유지한다. `eligible`, `employed`, `all`은 `audiences`로만 지정할 수 있다.

| audience | 대상 |
|---|---|
| `unsubmitted` | 해당 월 완료 제출이 없는 학생. 임시 저장 포함. 현재 열려 있는 접수 기간에만 가능 |
| `under_40` | 해당 월 인정 시간이 40시간 미만 |
| `hours_40_80` | 40시간 이상 80시간 미만 |
| `at_least_80` | 80시간 이상 |

`all`·`employed` 외의 조건은 최초 제출을 완료한 `student`에서 취업자를 제외한다. 취업자 조건을 함께 고르면 해당 학생도 합집합에 포함하며 중복 발송하지 않는다. 시간 구간은 해당 월 서류 제출 여부와 별개로 선택하며, 서버 `time_requirements`의 최근 집계(한국 시간 일별 최대 12시간)를 사용한다. 실시간 42 조회를 전체 학생에게 수행하지 않는다. 집계가 없거나 `on_hold`인 학생은 0시간으로 간주하지 않고 시간 조건에서 제외한다. 다른 선택 조건에 해당하면 명단에 포함된다. 최종 지원금 지급 판정은 변경하지 않는다.

응답: `month`, `months`, `audience`, `audiences`, `closes_at`, `unsubmitted`, `matched`, `hours_unknown`, `employed_excluded`, `employed_names`, `targets`, `target_fingerprint`, `email_available`. `audiences`는 정렬·중복 제거한 조건 목록이며 기존 단일 요청은 빈 배열이다. 직접 작성 방식에서는 `audiences`가 대상 기준이고 `audience`는 기존 호환 필드다.

- `targets[]`: `{user_id,name,login,employed,status,study_hours,as_of,email}`. `status`는 `missing`, `draft`, `submitted`. 시간 구간 선택 시 제출 완료자도 포함된다. `study_hours`는 `0|40|80|null`, `as_of`는 저장된 집계 시각(KST) 또는 `null`이다. draft 파일이나 ID는 반환하지 않는다.
- `matched`: 선택한 조건에 맞는 취업자 제외 전 인원. `targets.length = matched - employed_excluded`. `employed` 또는 `all`을 포함하면 취업자를 제외하지 않으므로 `employed_excluded`는 0이다.
- `unsubmitted`: 취업자 제외 전 전체 미제출 인원으로 기존 의미를 유지한다.
- `hours_unknown`: 최초 제출을 완료한 미취업 학생 중 해당 월 시간 집계가 없거나 보류된 인원.
- `months`에는 조회한 달이 들어간다. `closes_at`은 기존 단일 미제출 안내의 마감 미포함 경계이며 직접 작성 방식과 시간 구간 안내에서는 `null`이다.
- `email`은 `{login}@{MAIL_RECIPIENT_DOMAIN}`. SMTP 미설정·유효하지 않은 login이면 `null`이다. `email_available`은 SMTP 설정 여부이며 전달 성공을 보장하지 않는다.

### POST /api/admin/notices/submission-reminder

`Idempotency-Key: <UUID>` 필수. 직접 작성 Body: `{month,audiences,title,body,channel,expected_count,target_fingerprint}`. `audiences`·`title`·`body`는 함께 제공해야 한다. 제목은 공백만 아닌 1~120자이며 줄바꿈·제어 문자를 허용하지 않는다. 본문은 공백만 아닌 1~5000자이며 줄바꿈·탭 외 제어 문자를 허용하지 않는다. HTML이나 템플릿으로 해석하지 않는다. 앱 알림(`admin_notice`)과 이메일 제목·본문 모두 작성한 원문을 사용한다. 최초 작성 내용과 대상 조건은 발송 기록에 저장하며 재시도 시에도 동일하다.

기존 Body `{month,audience,channel,expected_count,target_fingerprint}`도 유지하며 `audience` 생략 시 `unsubmitted`다. 발송 직전에 대상 집합을 재검증하며, 수가 같아도 사람이 바뀌었으면 409다. 0명도 409다. 선택한 채널의 발송 항목과 감사 기록을 한 트랜잭션으로 저장한다.

`channel`은 `service`(앱 내부 알림), `email`(이메일), `both`(둘 다) 중 하나다. 기존 API 요청과의 호환성을 위해 생략 시 `both`이며 `null`·빈 문자열·그 외 값은 400이다. 화면은 앱 내부 알림·이메일 체크박스를 제공하며 둘 다 선택하면 `both`다. 기본은 앱 내부 알림이고 하나 이상 선택해야 한다. SMTP 미설정이면 이메일을 선택할 수 없다. 발송 확인 중이거나 응답이 불확실하면 작성 내용·대상·채널을 변경할 수 없다.

- `service`: 앱 알림만 생성한다. 수신 기록의 `email_status`는 `not_requested`, 이메일 주소·오류는 `null`, 시도 수는 0이며 SMTP 대기에 넣지 않는다. 이메일 집계는 모두 0이고 이메일 재시도는 409다.
- `email`: 앱 알림을 생성하지 않는다(`notification_id: null`). `service.sent/failed`와 최상위 `sent/failed`는 0이며 이메일 진행 상태로 결과를 확인한다.
- `both`: 앱 알림과 이메일 대기를 함께 생성한다. 이메일 장애가 앱 알림 전달 결과를 바꾸지 않는다.

미리보기의 대상 집합은 채널과 무관하다. 같은 멱등 키로 채널을 바꾸면 409이며, 결과를 확인할 때는 최초 본문과 키를 그대로 재사용한다. 이메일을 선택했는데 SMTP 설정이 없거나 주소가 유효하지 않으면 해당 이메일을 `failed`로 기록하며 성공으로 집계하지 않는다.

`expected_count`는 `targets.length`다. `target_fingerprint`는 미리보기에서 받은 불투명 값으로, 월·선택한 audience·대상 ID/login·마감 시각·SMTP 설정 여부·수신 도메인을 포함한다. 미리보기 후 마감 시각·수신 도메인·SMTP 설정 여부가 바뀌어도 409로 다시 확인하게 한다. 미제출 안내의 SMTP 작업은 전송 직전 현재 접수 기간을 재검증하고 메일에 설정된 마감을 안내한다. 시간 구간은 최신 저장 집계를 재검증하며, 내용에는 월·시간 구간·일별 12시간 상한·최종 지급 확정과의 구분을 안내한다. 앱 알림은 각각 `submission_reminder`, `study_hours_notice`로 저장한다.

위 자동 문구·마감 규칙은 기존 단일 대상 방식에 해당한다. 직접 작성 방식의 fingerprint는 월·정규화한 `audiences`·대상 ID/login·SMTP 수신 도메인을 포함한다. SMTP 작업과 재시도는 저장된 여러 조건의 합집합을 재검증하며, 더 이상 어느 조건에도 해당하지 않는 수신자는 제외한다. `all`은 취업 여부와 무관하다. 내용은 최초 작성 원문을 유지한다.

**24시간 중복 발송 제한은 없다.** 새 키의 요청은 같은 날 같은 대상에게 다시 보낼 수 있다. 동일 키 재시도는 새 알림이나 이메일을 만들지 않는다.

응답: `{notice_id,month,audience,audiences,title,body,channel,sent,failed,service:{sent,failed},email:{pending,sending,sent,failed,skipped},employed_excluded,sent_at}`. 기존 단일 방식의 `audiences`는 `[]`, `title/body`는 `null`이다. 최상위 `sent/failed`는 서비스 알림 결과다. 작성 내용·대상·`channel`은 최초 선택한 값이며 상태 조회·재시도에서도 유지된다. `not_requested`는 이메일 집계에 포함하지 않는다. 이메일은 비동기로 처리하며 SMTP 서버가 수락한 경우 `sent`다. 실제 받은편지함 도착을 의미하지 않는다. SMTP 미설정·실패를 발송 성공으로 표시하지 않는다.

### GET /api/admin/notices/{id}

위 응답과 `recipients[]`를 반환한다. 수신자 항목: `id`, `user_id`, `email_recipient`, `email_status`, `email_attempts`, `email_sent_at`, `last_error_code`. 상태가 바뀌어도 최초 POST의 멱등 응답은 처음 값이며, 진행 상황은 이 GET으로 확인한다.

### POST /api/admin/notices/{id}/retry

Body 없음, 새 `Idempotency-Key: <UUID>` 필수. 이메일을 선택한 발송의 실패한 이메일만 다시 시도하며 원래 선택한 audience 조건·취업 상태를 재검증한다. 미제출은 제출·접수 기간을, 시간 구간은 최신 저장 집계를 확인한다. 취업자는 현재 취업 상태를 확인하며, 미취업으로 바뀌었고 함께 선택한 다른 조건에도 해당하지 않으면 제외한다. 서비스 알림은 다시 만들지 않는다. 이메일 전용 발송을 재시도해도 앱 알림이 생기지 않는다. 응답은 발송 결과 형식에 `retried`를 더하고 최상위 `sent`와 `service.sent`는 0이다. `retried`는 재검증한 실패 대상 수로, 자격 변경으로 `skipped`가 되거나 SMTP 미설정으로 `failed`에 남은 대상도 포함한다. 실제 진행 상황은 `email` 집계와 상태 GET으로 확인한다. 재시도할 실패 대상이 없으면 409다.

이미 기록된 수신 주소가 현재 login/도메인으로 계산한 주소와 다르면 기존 주소를 보존하고 `skipped`·`recipient_changed`로 처리한다. SMTP 오류가 나도 기존 주소를 지우지 않는다. 처음부터 SMTP 미설정 등으로 주소가 없었던 대상은 재시도 시 처음 주소를 계산할 수 있다.

SMTP 전송 도중 프로세스가 중단되면 수락 여부가 불명확할 수 있다. 오래된 `sending`은 `delivery_unknown` 실패로 남겨 자동 재발송하지 않고 운영자의 재시도를 기다린다. 아직 시도하지 않은 `pending`은 재시작 후 처리한다.

미제출 안내는 마감 후 새로운 발송·재시도가 422 `CYCLE_CLOSED`이며, 이미 처리한 키의 응답 재현은 가능하다. 시간 구간 알림은 마감 후에도 보낼 수 있다. 작업자는 SMTP 전송 직전에도 원래 선택한 audience 조건·취업·역할과 필요한 접수 기간을 재검증한다. 대상 자격이나 로그인/도메인 주소가 바뀌면 `skipped`로 남긴다. `recipient_changed` 대상은 새 미리보기와 새 발송으로 처리한다.

`notice_id`·수신자 `id`는 정수다. 이메일 상태는 `not_requested`, `pending`, `sending`, `sent`, `failed`, `skipped`이며, `last_error_code`는 `smtp_not_configured`, `invalid_recipient`, `invalid_message`, `smtp_failed`, `delivery_unknown`, `cycle_closed`, `no_longer_target`, `recipient_changed` 또는 `null`이다. SMTP 인증 정보나 원문 오류는 반환하지 않는다.

### GET /api/admin/archive/{month}

`{month,months,rows}`. 각 행은 `{user_id,name,login,files,base_docs,previous,submitted_at,status,kinds}`이며 세 파일 필드는 doc_type 배열이다. `name`은 `n기_이름(생년월일6자)` 형식의 교육생 표기다(예: `9기A_한지민(030421)`; 기수가 없으면 앞부분, 생년월일이 없으면 뒷부분을 뺀다. 한글 이름이 없으면 42 표시 이름). ZIP 폴더와 `제출목록.csv`의 이름도 같은 표기를 쓴다. 알림 대상 목록(`GET /api/admin/notices/...`의 `targets[].name`)도 같다. 접수 기간 행이 없어도 조회할 수 있다.

선택 query: `status`(`pending_review|approved|revision_requested|resubmitted`), `kind`(`initial|monthly|supplement`). 각 값은 쉼표로 구분해 복수 선택할 수 있다(예: `status=approved,resubmitted&kind=initial,supplement`). 같은 필터의 값끼리는 OR, 상태와 종류 사이는 AND다. 생략 또는 단독 `all`은 전체다. 빈 값·빈 항목·공백·`all`과 개별 값의 혼합은 400이다. 각 제출 체인의 **최근 완료 제출**의 상태·종류로 먼저 필터한 후 교육생별로 묶는다. `kinds`는 포함된 체인의 최근 제출 종류를 중복 없이 반환한다. 보완 체인은 `supplement`에 해당하며 유지된 조상 파일을 포함한다. 최초와 월별 체인이 모두 있는 교육생도 승인 필터에서는 승인된 체인의 파일만 포함된다. draft·미제출·잘못된 필터는 400이다. 필터와 무관하게 `months`는 전체 접수 월을 반환한다.

- 필터가 없으면 학생별로 최초·월별 두 체인의 실제 제출 파일을 모두 보존하며, 각 체인은 보완된 파일과 유지된 조상 파일을 합친다. 같은 종류가 두 체인에 있으면 배열에도 두 번 들어간다.
- `submitted_at`과 `status`는 그 학생의 해당 월 체인 중 가장 최근 접수된 완료 제출을 기준으로 한다. 행은 접수 시각·user ID 오름차순이다. 검토 목록에서 제외된 중복 월별 체인도 자료함에는 포함된다. `months`는 완료 제출이 있는 달만 내림차순으로 반환한다.
- `previous`는 보완으로 교체된 **실제로 접수한** 파일이다. 최종 제출 전에 교체한 업로드나 draft는 포함하지 않는다.
- `base_docs`는 현재 파일에 없는 승인 기본 서류 3종이다. 지난달은 해당 월 말까지, 이번 달은 현재까지 승인된 버전을 사용한다. 미승인 계좌 변경 통장사본은 제외한다.

### POST /api/admin/archive/{month}/exports

회계 담당자만 가능. `Idempotency-Key: <UUID>` 필수. Body: `{user_ids,include_base_docs,include_previous,expected_pdf_count,filters?}`. 선택 `filters`는 `{status?,kind?}`로 목록 query와 같은 값·규칙을 사용한다. 생략하면 기존 전체 자료 동작이며 `all`은 생략과 같은 요청으로 정규화한다. 복수 값은 정렬하고 중복을 제거하므로 선택 순서가 달라도 같은 요청이다. 기존 단일 값 요청도 그대로 지원한다. 필터도 멱등 요청의 일부다. 대상 사용자를 중복 선택할 수 없고 각 사용자에게 해당 월 완료 제출이 있어야 한다. 계산한 PDF 수가 다르거나 필터 적용 후 선택한 교육생의 자료가 없어지면 409다. 개수만 비교하므로 동일 개수의 내용 변경을 검출하는 토큰은 제공하지 않는다. 요청 시점의 DB 스냅샷으로 조건을 재검증하고 실제 파일 구성을 고정한다.

관리자 화면은 교육생 검색·보기를 상단에, 상태·종류 체크박스는 기본으로 접힌 상세 조건에 둔다. 각 그룹에서 아무것도 선택하지 않으면 해당 조건 전체를 조회하며, 접어도 선택 조건은 유지한다. 이름·Intra ID 검색과 교육생 체크박스 선택은 `user_ids`를 결정한다. 검색으로 숨겨진 교육생은 선택 표시가 남아 있어도 요청 대상에서 제외된다. 상태·종류 조건은 서버에서 파일 구성을 필터한다. `include_previous`는 조건에 맞는 체인의 교체 전 제출본만 추가하며, `include_base_docs`는 선택한 교육생의 승인된 기본 서류를 별도로 추가한다. 추가 자료의 상태·종류에 현재 제출 필터를 다시 적용하지 않는다.

202: `{"job_id":"uuid","status":"creating"}`. 같은 키·같은 요청은 같은 job을 반환하고, 다른 요청이면 409다. 기본 상한은 100명·원본 합계 및 ZIP 각각 256 MiB·생성 요청 5분 간격·계정당 생성 중 1개다. 생성과 다운로드는 서버 전체에서 메모리 작업 하나만 진행하며 혼잡 시 429다. 한도는 환경변수로 설정한다.

같은 키 재요청의 `status`는 해당 job의 현재 상태다. 만료된 키를 재사용하면 404이며, 새 작업에는 새 키를 사용한다.

생성 간격 제한의 `429 RATE_LIMITED`는 `Retry-After`에 **남은 초(올림)**를 반환한다. 재요청할 때마다 전체 간격을 다시 기다리게 하지 않는다. 서버의 ZIP 메모리 작업이 혼잡하면 `Retry-After: 30`이다. 관리자 화면은 이 시간 동안 남은 초를 표시하고 같은 키·본문으로 최대 3회 자동 재시도한다. 대기를 취소하거나 계정·대상 월을 바꾸면 재시도를 중단한다.

### GET /api/admin/archive/{month}/exports/{id}

회계 담당자이면서 생성자만 조회한다. `{job_id,status,zip_name,student_count,pdf_count,expires_at}`. 상태는 `creating`, `ready`, `failed`이며 실패 시 일반적인 `error` 문구가 추가된다. 남의 job·없는 job·만료된 job은 404다.

### GET /api/admin/archive/{month}/exports/{id}/file

같은 권한으로 ZIP 첨부를 반환한다. 준비 전은 409, 만료 후는 404다. 한글 RFC 5987 파일명, `application/zip`, `no-store`, `nosniff`, CSP sandbox, `no-referrer`를 적용한다.

ZIP 파일 GET도 다른 ZIP 메모리 작업이 진행 중이면 429와 `Retry-After`를 반환할 수 있다. 화면은 대기 후 **같은 job의 파일 GET만** 재시도하며 새 ZIP을 만들지 않는다. ZIP에 포함된 PDF 개수는 개별 원본 다운로드의 요청 횟수 제한에 합산하지 않는다.

- `{YYYY}년 {M}월/{이름}_{login}/` 아래 PDF와 루트의 `제출목록.csv`를 넣는다. 안전한 Unicode 파일명, 대소문자 무시 중복 이름의 `_2` 접미사를 적용한다.
- CSV는 UTF-8 BOM·CRLF이며 열은 `이름,login,제출 종류,파일 종류,접수 시각,검토 상태,학습 시간`이다. `학습 시간`은 다운로드 대상 월의 최근 저장 집계(일별 최대 12시간)를 기존 기준으로 구간화한 시간 값으로, 40시간 미만 `0`, 40시간 이상 80시간 미만 `40`, 80시간 이상 `80`이다. 미집계·판정 보류(`on_hold`)는 `확인 불가`로 표시한다. ZIP 생성 요청 시 파일 목록과 함께 저장하므로 이후 집계가 갱신되어도 같은 작업의 값은 바뀌지 않는다. 학생의 모든 파일 행에 동일한 대상 월 값을 기록한다. 수식 주입을 방지한다. 승인 계좌 변경에서 가져온 기본 통장사본의 제출 종류는 `계좌 변경`, 접수 시각은 변경 요청 시각이다. 주민등록번호·전체 계좌번호는 추가하지 않는다.
- PDF와 ZIP 평문은 디스크에 저장하지 않는다. 완성 ZIP도 기존 파일 키로 암호화하며 완성 후 기본 15분이 지나면 삭제한다. 원본과 감사 기록은 유지한다. 전체 버퍼 암호화의 순간 메모리는 설정된 ZIP 상한의 약 3배까지 필요할 수 있다.
- 생성 요청·포함 원본별 접근·다운로드를 감사 기록으로 남긴다. 기록 저장에 실패하면 다운로드하지 않는다. 재시작 시 생성 중이던 작업은 실패 처리하고 새 키로 재요청한다.
