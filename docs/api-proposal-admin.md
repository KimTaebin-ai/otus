# API 제안: 관리자 화면 (대시보드 · 제출 안내 · 사용자 상세 · 서류 검토 · 자료함)

FE(@KimTaebin-ai)가 R(@DavidLee18)에게 넘기는 **제안서**다. `api.md`가 아니다. 합의되면 R이 `api.md`에 옮기고, 그 뒤 FE가 연결한다. 시간 요건·알림은 [`api-proposal-eligibility.md`](api-proposal-eligibility.md)와 같은 enum을 쓴다 (아래 "enum").

대상 화면은 `admin-front/`의 A00 현황 대시보드, A07 제출 안내 보내기, A18 사용자 관리 상세다 (`docs/design/README.md` "관리자"). 화면은 이미 API 없이 만들어 두었고 (`admin-front/src/app/core/admin.models.ts`의 화면용 타입), 이 제안서의 응답이 그 타입을 채운다. 서류 검토(A02·A03)는 아래 "서류 검토"에 있고, 화면용 타입은 같은 파일의 `ReviewView`·`ReviewDecision`이다. 자료함·일괄 다운로드(A12~A14)는 아래 "자료함 · 일괄 다운로드"에 있고, 화면용 타입은 `ArchiveRow`·`ArchiveView`·`ArchiveOptions`·`DownloadStatus`다. 월별 제출 내역(A01)·사용자 목록은 디자인이 아직 없어서 다루지 않는다.

형식은 `api.md` 공통 규칙을 따른다: 시간은 ISO 8601 KST(`+09:00`, 초 단위), 월은 `YYYY-MM`, 에러 body는 `{"error": {"code", "message"}}`, 상태 변경 요청은 `Origin` + `X-XSRF-TOKEN`.

## 정책 (이미 정한 것)

- **발송 대상 규칙은 하나다: 미제출 − 취업 중.** 임시 저장(`draft`)만 한 사용자는 미제출이다. 최종 제출을 끝낸 사용자와 `employed`인 사용자는 뺀다. **"40시간 달성(예상)" 같은 시간 요건 조건은 넣지 않는다.** 서류 마감과 시간 집계가 둘 다 말일이라, 월중에 40시간 미만이던 사람이 말일까지 채우면 알림을 못 받아 서류를 놓칠 수 있다. 이 조건은 화면에도 이 제안서에도 없다
- **발송 채널은 서비스 알림뿐이다.** 메일 발송은 범위 밖이다
- **개별 유예와 개명은 v1.0에 없다.** 응답에 필드를 만들지 않는다
- **세 축은 서로 다른 필드다.** 시간 요건, 서류 상태, 최종 수령 대상을 한 필드로 합치지 않는다. 대시보드도 세 축을 따로 센다 ("달성(예상)"은 월중 시간 요건에만, "확정"은 최종 수령 대상에만 쓴다)
- **원본 열람은 `operator`와 `accountant`만 할 수 있다.** `admin`은 못 연다. FE는 버튼을 비활성으로 두고 안내만 보이지만, 서버가 매 요청 DB의 역할로 다시 확인한다

## 권한

`/api/admin/*`는 `operator`·`accountant`·`admin`만 부를 수 있다. 그 밖의 로그인 사용자는 `403 FORBIDDEN`, 로그인하지 않았으면 `401`이다. FE의 역할별 화면 분기는 편의일 뿐이다.

| 대상 | `operator` | `accountant` | `admin` |
| --- | --- | --- | --- |
| 대시보드 · 사용자 상세 · 기록 | ✅ | ✅ | ✅ |
| 제출 안내 미리보기 · 발송 · 재시도 | ✅ | ✅ | ✅ |
| 원본 열람 (`GET /api/files/{file_id}`) | ✅ (**변경 필요**) | ✅ | ❌ |
| 자료함 목록 (`GET /api/admin/archive/{month}`) | ✅ | ✅ | ✅ |
| ZIP 생성 · 상태 · 내려받기 (`…/exports…`) | ❌ | ✅ | ❌ |

## enum

시간 요건·최종 수령 대상은 `api-proposal-eligibility.md`의 값 그대로다. 서류 상태·`doc_type`·`role`은 `api.md`의 값이다.

| 축 | 필드 | 값 |
| --- | --- | --- |
| 시간 요건 | `phase` | `in_progress` · `awaiting_decision` · `decided` |
| 시간 요건 | `result.status` | `met` · `not_met` · `on_hold` |
| 시간 요건 | `tier` | `tier_1` (40시간, 50만 원) · `tier_2` (80시간, 100만 원) |
| 서류 상태 | `status` | `draft` · `pending_review` · `approved` · `revision_requested` · `resubmitted` |
| 최종 수령 대상 | `final.status` | `undecided` · `eligible` · `not_eligible` |

새로 필요한 enum은 사용자 기록의 `action` 하나다:

| action | 의미 |
| --- | --- |
| `submitted` | 서류 제출 (`initial`, `monthly`) |
| `resubmitted` | 보완 제출 (`supplement`) |
| `approved` | 서류 승인 |
| `revision_requested` | 재검토 요청 |
| `bank_change_requested` | 계좌 변경 요청 |
| `bank_change_approved` | 계좌 변경 승인 |
| `bank_change_rejected` | 계좌 변경 반려 |
| `employment_changed` | 취업 상태 변경 |

## GET /api/admin/dashboard

A00의 숫자. 사람 수다 (제출 건수가 아니다). 한 사람은 달마다 한 줄로 센다.

Query (선택): `month=YYYY-MM` (기본은 이번 달)

```json
{
  "month": "2026-10",
  "submissions": {
    "targets": 100,
    "employed_excluded": 3,
    "unsubmitted": 10,
    "pending_review": 14,
    "revision_requested": 6
  },
  "time_requirements": {
    "month": "2026-10",
    "phase": "in_progress",
    "as_of": "2026-10-17T14:00:00+09:00",
    "in_progress": 128,
    "thresholds": [
      { "tier": "tier_1", "seconds": 144000, "amount": 500000 },
      { "tier": "tier_2", "seconds": 288000, "amount": 1000000 }
    ],
    "projected": [
      { "tier": "tier_1", "count": 31 },
      { "tier": "tier_2", "count": 12 }
    ]
  },
  "previous": {
    "month": "2026-09",
    "awaiting_decision": 0,
    "result": { "met": 74, "not_met": 20, "on_hold": 8 },
    "final": { "eligible": 70, "not_eligible": 2, "undecided": 30 }
  },
  "tasks": { "bank_change_pending": 1, "notice_failed": 1 }
}
```

- `submissions.targets`: 그 달에 제출해야 하는 교육생 (`student`이고 `initial_submitted`이며 `employed`가 아닌 사람). `employed_excluded`는 같은 조건에서 `employed`라서 뺀 사람 수
- `submissions.unsubmitted`: `targets` 중 그 달 제출이 없거나 `draft`뿐인 사람 (취업 중은 이미 빠져 있다). **A07의 발송 대상 수와 같은 숫자다**
- `submissions.pending_review`: 그 달 최신 제출이 `pending_review` 또는 `resubmitted`인 사람. `revision_requested`: `revision_requested`인 사람 (학생이 보완 제출할 차례)
- `time_requirements`: 이번 달 집계. `thresholds`는 정책 값이고 FE가 40·80시간을 하드코딩하지 않는다. `projected`는 **지금까지 도달한 가장 높은 구간**별 사람 수다 (`tier_2`인 사람은 `tier_1`에 세지 않는다). `in_progress`는 집계 대상 전체 사람 수. 판정이 아니다
- `previous`: 지난달. `awaiting_decision`은 `phase`가 아직 `awaiting_decision`인 사람 수 (다음 달 1일 00:00 ~ `decides_at`). `result`는 판정된 사람, `final`은 운영진의 최종 수령 대상 결정
- `tasks.bank_change_pending`: 검토 대기 중인 계좌 변경 요청 수. `notice_failed`: 발송 실패가 남은 제출 안내 수 (재시도 전)
- 개별 유예·개명 건수는 없다

| 상태 | 에러 |
| --- | --- |
| 400 | `month` 형식 오류 (`INVALID_REQUEST`) |
| 401 · 403 | 로그인 안 됨 · 관리자 아님 |

## 제출 안내 (미제출 알림)

### GET /api/admin/notices/submission-reminder

A07의 미리보기. 보내기 전에 대상과 숫자를 보여 준다. 서버는 문구를 주지 않는다 (알림은 `kind`와 `data`만, 문구는 FE가 쓴다. 학생 벨과 같은 "{M}월 서류, 준비하고 계신가요?").

Query (선택): `month=YYYY-MM` (기본은 이번 달)

```json
{
  "month": "2026-09",
  "months": ["2026-10", "2026-09"],
  "closes_at": "2026-10-01T00:00:00+09:00",
  "unsubmitted": 10,
  "employed_excluded": 3,
  "employed_names": ["박서진", "최시우", "서지민"],
  "targets": [
    { "user_id": 31, "name": "정하늘", "login": "haneul", "employed": false, "status": "missing" },
    { "user_id": 35, "name": "임수빈", "login": "subin", "employed": false, "status": "draft" }
  ]
}
```

- `unsubmitted`: 그 달 미제출 전체 (임시 저장, 취업 중 포함). `employed_excluded`: 그중 취업 중이라 자동으로 뺀 사람. `targets`: 둘을 뺀 **발송 대상**
- `targets[].status`: `missing` (제출 없음) · `draft` (임시 저장만 함)
- `employed_names`: 취업 중이라 빠진 사람의 이름만 (login 등은 주지 않는다)
- `closes_at`: 그 달 접수 마감 (다음 달 1일 00:00, 미포함). FE가 말일 23:59로 표시한다 (`api.md` 접수 기간과 같은 규칙)
- `months`: 월 선택에 보일 달 (최신 먼저). 접수 기간이 있는 달이다 (질문 2)
- `targets`가 비면 FE는 빈 상태("지금은 안내할 분이 없어요")를 보이고 발송 버튼을 막는다

| 상태 | 에러 |
| --- | --- |
| 400 | `month` 형식 오류 · 접수 기간이 없는 달 (`INVALID_REQUEST`) |
| 401 · 403 | 로그인 안 됨 · 관리자 아님 |

### POST /api/admin/notices/submission-reminder

발송. **`Idempotency-Key` 헤더 (UUID) 필수**, 제출 `finalize`와 같은 방식이다: 같은 키로 다시 부르면 같은 결과를 돌려준다.

```json
{ "month": "2026-09", "expected_count": 7 }
```

- 서버는 **발송 시점에 대상을 다시 계산한다** (미리보기 뒤에 제출했거나 취업 상태가 바뀐 사람을 반영). `expected_count`는 화면이 보여 준 `targets` 수다. 다시 계산한 수가 다르면 보내지 않고 `409 INVALID_STATE` ("대상이 바뀌었어요. 다시 확인해 주세요."), FE는 미리보기를 다시 읽는다
- 대상이 0명이면 `409 INVALID_STATE`
- 대상마다 서비스 알림 `submission_reminder`를 만든다 (아래 알림). 메일은 보내지 않는다

Response `200`

```json
{
  "notice_id": 17,
  "month": "2026-09",
  "sent": 7,
  "failed": 0,
  "employed_excluded": 3,
  "sent_at": "2026-09-21T14:30:12+09:00"
}
```

- `sent`: 알림을 만든 사람 수, `failed`: 만들지 못한 사람 수. `employed_excluded`는 미리보기와 같은 뜻
- 요청마다 `notice_id`가 생기고, 발송 이력이 남는다 (누가, 언제, 몇 명에게)

| 상태 | 에러 |
| --- | --- |
| 400 | `Idempotency-Key`·본문 오류, 접수 기간이 없는 달 (`INVALID_REQUEST`) |
| 401 · 403 | 로그인 안 됨 · 관리자 아님 |
| 409 | 대상이 바뀜 · 대상 0명 (`INVALID_STATE`) |
| 429 | 요청 한도 |

### POST /api/admin/notices/{notice_id}/retry

그 발송에서 **실패한 대상에게만** 다시 보낸다. 본문 없음, `Idempotency-Key` 필수. 응답은 위 발송 응답과 같은 모양이다 (`sent`·`failed`는 이번 재시도 기준).

| 상태 | 에러 |
| --- | --- |
| 404 | 없는 `notice_id` |
| 409 | 실패한 대상이 없음 (`INVALID_STATE`) |

### 알림 kind 추가

`api-proposal-eligibility.md`의 알림 표에 한 줄을 더한다:

| kind | data | FE 이동 |
| --- | --- | --- |
| `submission_reminder` | `month` | `/submit` |

- 운영진이 직접 보낸 미제출 안내다. 자동으로 가는 `submission_period_opened`(접수 시작)와 구분한다
- 학생 벨의 문구는 FE가 쓴다: 제목 "{M}월 서류, 준비하고 계신가요?"

## 사용자

### GET /api/admin/users

사용자 관리 목록. 화면 디자인이 아직 없어서 필드는 최소로 둔다.

Query (선택): `query` (이름·login 부분 일치), `limit` (기본 20, 최대 50), `before=<id>` (그보다 오래 등록된 사용자). 교육생(`student`)만 나온다.

```json
{
  "items": [
    {
      "id": 12,
      "login": "dongkim2",
      "display_name": "동민",
      "employed": false,
      "initial_submitted": true,
      "current_month": { "month": "2026-09", "status": "pending_review" },
      "last_submitted_at": "2026-09-21T09:41:00+09:00"
    }
  ],
  "next_before": 12
}
```

### GET /api/admin/users/{id}

A18의 머리·카드·최초 서류.

```json
{
  "id": 12,
  "login": "dongkim2",
  "display_name": "동민",
  "employed": false,
  "employment_updated_at": "2026-09-01T10:00:00+09:00",
  "initial_submitted": true,
  "last_submitted_at": "2026-09-21T09:41:00+09:00",
  "bank_account": {
    "bank": "카카오뱅크",
    "account_number_masked": "•••• 1234",
    "bankbook_changed_at": "2026-02-20T09:30:00+09:00"
  },
  "current_month": { "month": "2026-09", "status": "pending_review" },
  "initial_documents": {
    "approved_at": "2026-02-21T11:00:00+09:00",
    "files": [
      { "doc_type": "id_card", "file_id": "uuid", "original_name": "신분증.pdf" },
      { "doc_type": "resident_abstract", "file_id": "uuid", "original_name": "초본.pdf" },
      { "doc_type": "bankbook", "file_id": "uuid", "original_name": "통장사본.pdf" }
    ]
  }
}
```

- `bank_account`: 승인된 현재 계좌 (`GET /api/me/bank-account`의 `current`). 없으면 `null`. **계좌번호는 항상 마스킹**(뒤 4자리)이고 전체 번호는 이 응답에도, 다른 어떤 응답에도 없다
- `current_month.status`: 그 달 최신 제출의 `status`. 제출이 없으면 `null` (FE는 "미제출"로 보인다)
- `initial_documents`: 첫 제출(`initial`)의 현재 서류. 월별 `employment_insurance`는 넣지 않는다 (해당 제출 월에서 본다). `approved_at`은 `initial`이 승인된 시각 (아직이면 `null`)
- 파일을 여는 건 이 응답이 아니라 `GET /api/files/{file_id}`다 (아래 "원본 열람")
- 학생이 아닌 사용자는 `404`

| 상태 | 에러 |
| --- | --- |
| 401 · 403 | 로그인 안 됨 · 관리자 아님 |
| 404 | 없는 사용자, 교육생이 아님 (`NOT_FOUND`) |

### GET /api/admin/users/{id}/records

"검토 및 변경 기록". 최신순.

Query (선택): `limit` (기본 20, 최대 50), `before=<id>`

```json
{
  "items": [
    {
      "id": 904,
      "at": "2026-09-21T09:41:00+09:00",
      "month": "2026-09",
      "action": "submitted",
      "submission_id": "uuid",
      "submission_status": "pending_review",
      "actor": { "name": "동민", "role": "student" }
    },
    {
      "id": 871,
      "at": "2026-08-22T10:10:00+09:00",
      "month": "2026-08",
      "action": "approved",
      "submission_id": "uuid",
      "submission_status": "approved",
      "actor": { "name": "지우", "role": "accountant" }
    },
    {
      "id": 702,
      "at": "2026-02-19T21:00:00+09:00",
      "month": "2026-02",
      "action": "bank_change_requested",
      "submission_id": null,
      "submission_status": null,
      "actor": { "name": "동민", "role": "student" }
    }
  ],
  "next_before": 702
}
```

- `month`: 그 줄이 속한 **대상 월**이다. 일어난 시각의 달이 아니다 (제출 월이 기준, 계좌·취업 변경은 변경한 달)
- `submission_status`: 그 줄이 가리키는 제출의 **현재** `status` (줄이 생긴 때의 상태가 아니다). 제출 줄이 아닌 `bank_change_*`, `employment_changed`는 `null`. FE는 `submitted`·`resubmitted` 줄의 제출이 아직 `pending_review`·`resubmitted`일 때만 "· 검토 대기"를 붙인다
- `actor`: 누가 했는지. 학생이면 이름, 담당자면 `role`로 보인다 (이름은 FE가 쓰지 않는다)
- `submission_id`: 서류 검토 화면으로 이동할 때 쓴다 (그 화면은 아직 없다)
- 소스: 제출 이벤트(`submission_events`), 계좌 변경 요청(`bank_account_changes`), 취업 상태 변경. **취업 상태는 지금 마지막 변경 시각만 있고 이력이 없다** (질문 5)

| 상태 | 에러 |
| --- | --- |
| 401 · 403 | 로그인 안 됨 · 관리자 아님 |
| 404 | 없는 사용자 (`NOT_FOUND`) |

## 원본 열람

새 API는 없고 기존 `GET /api/files/{file_id}`를 쓴다 (`<a href target="_blank">`로 연다, 첨부로 내려온다). **허용 대상만 바꿔 달라:** 지금은 파일의 주인과 `accountant`뿐인데 (`backend/src/routes/files.rs`), `operator`도 열 수 있어야 한다. `admin`은 열 수 없고 지금처럼 404다. 내려받기 기록(누가, 누구의 파일을, 언제, 어떤 권한으로)은 그대로 남기고, 기존 요청 한도(연속 30번, 이후 10초에 1번)도 그대로 둔다.

## 서류 검토

A02(검토·승인)와 A03(보완 요청) 화면이 쓴다. 한 제출(`submission`)을 열어 서류를 보고, 승인하거나 보완을 요청한다. 흐름은 최초 4종과 월별이 같고 서류 수만 다르다 (최초 4종, 월별 1개). 기존 dev 전용 `POST /api/dev/submissions/{id}/status`와 **같은 모양·같은 규칙**으로 만들되, 본인 제출이 아니라 **학생의 제출**을 처리한다.

- `draft`는 학생만 본다. 아래 모든 API는 `draft`인 제출에 `404 NOT_FOUND`를 준다 (스태프에게 안 보임)
- 승인·보완 요청은 `pending_review`, `resubmitted`인 제출만 처리한다. 그 밖의 상태는 `409 INVALID_STATE`
- 승인은 **서류 승인**이다. 시간 요건·최종 수령 대상 판정과 섞지 않는다
- **최초 서류(`kind = initial`)도 보완을 요청할 수 있다고 가정한다** (백엔드는 이미 허용한다: `api.md`의 `revision_doc_types`는 이 제출의 서류 중에서 고른다). 학생 앱이 최초 보완을 아직 받지 못하는 문제는 FE 쪽 작업이다

### GET /api/admin/submissions/{id}

```json
{
  "id": "uuid",
  "user": { "id": 17, "name": "동민", "login": "dongkim2", "employed": false },
  "kind": "initial",
  "target_month": "2026-09",
  "status": "pending_review",
  "submitted_at": "2026-09-21T09:41:00+09:00",
  "required_doc_types": ["id_card", "resident_abstract", "bankbook", "employment_insurance"],
  "files": [
    {
      "id": "uuid",
      "doc_type": "id_card",
      "original_name": "신분증_동민.pdf",
      "size_bytes": 1200000,
      "uploaded_at": "2026-09-21T09:40:12+09:00"
    }
  ],
  "cycle": {
    "opens_at": "2026-09-01T00:00:00+09:00",
    "closes_at": "2026-10-01T00:00:00+09:00",
    "issued_after": "2026-09-01"
  },
  "review_comment": null,
  "revision_doc_types": []
}
```

- `files`: 서류 종류마다 **현재 파일 하나**(`superseded_by`가 없는 것). `required_doc_types` 순서대로
- `cycle`: 대상 월의 접수 기간이다. `closes_at`은 배타 끝이고, 화면은 `lastMoment()`로 마감을 보여준다. 접수 기간은 매달 1일에 시작한다 (화면에 날짜를 박지 않는다)
- 화면의 "발급일 확인"은 **검토자가 서류를 보고 판단**한다. 서버가 PDF를 읽어 발급일을 돌려주지 않는다 (자동 판단이 아니라 제안이므로 필요하면 나중에 `issued_on_hint`를 따로)
- 파일 열기·다운로드는 기존 `GET /api/files/{file_id}` ("원본 열람")

| 상태 | 에러 |
| --- | --- |
| 401 · 403 | 로그인 안 됨 · 관리자 아님 |
| 404 | 없는 제출, `draft` (`NOT_FOUND`) |

### POST /api/admin/submissions/{id}/review

dev 상태 API와 같은 body다.

```json
{ "status": "approved" }
```

```json
{
  "status": "revision_requested",
  "review_comment": "서류 일부가 흐릿해서 내용을 확인하기 어려워요. 모든 페이지가 선명하게 보이는 PDF로 다시 제출해주세요.",
  "revision_doc_types": ["employment_insurance"]
}
```

- `status`: `approved` 또는 `revision_requested`만
- `review_comment`: `revision_requested`일 때 필수, 공백 제외 1~1000자. **학생에게 그대로 보인다** (내부 메모와 다르다)
- `revision_doc_types`: 이 제출의 서류 중에서. 화면은 **1개 이상 고르게 강제**한다 (`api.md`는 비우면 전부로 정해져 있어 그 규칙은 그대로 둔다). 최초 4종은 여러 개, 월별은 1개
- 처리 담당자는 서버가 세션에서 기록한다 (body로 받지 않는다)
- 승인할 때 `resubmitted`인 조상 제출도 승인한다 (dev와 같은 규칙)
- `Idempotency-Key`(UUID) 헤더를 받는다: 같은 키로 다시 와도 같은 결과를 돌려주고 이벤트를 또 만들지 않는다 (더블 클릭 방지, `finalize`와 같은 방식)
- 응답은 `api.md`의 제출(Submission)과 같은 모양에 `reviewed_by`(`{name, role}`)·`reviewed_at`을 더한 것. 화면의 결과 화면이 "처리 담당자"(역할과 실제 이름)와 시각을 보여준다
- 보완 요청 결과 화면의 "재제출 마감"은 `cycle.closes_at`(`lastMoment()`)다. 서버는 별도 마감을 만들지 않는다

| 상태 | 에러 |
| --- | --- |
| 400 | 잘못된 `status`, `review_comment` 없음·1000자 초과, 이 제출에 없는 `revision_doc_types` |
| 401 · 403 | 로그인 안 됨 · 관리자 아님 |
| 404 | 없는 제출, `draft` |
| 409 | `pending_review`·`resubmitted`가 아님 (`INVALID_STATE`) |

### 운영팀 메모 — GET · PUT /api/admin/submissions/{id}/memo

```json
{
  "memo": "신분증 사진이 조금 어둡지만 확인은 돼요.",
  "updated_at": "2026-09-21T10:20:00+09:00",
  "updated_by": { "name": "지우", "role": "operator" }
}
```

- PUT body는 `{ "memo": "..." }` (2000자 이하, 빈 문자열은 지움). 제출마다 하나
- **학생에게 절대 안 나간다.** `GET /api/submissions/*` 응답에 이 필드를 넣지 않는다 (별도 테이블 권장)
- 화면은 지금 서버에 저장하지 않고 화면 상태로만 둔다. 이 API가 생기면 "승인 검토"·"보완 요청"을 누를 때와 입력 후 잠깐 쉴 때 저장한다

### GET /api/admin/submissions/{id}/events

"최근 기록"과 승인·보완 요청 완료 화면의 "검토 기록"이다. 최신순.

```json
{
  "items": [
    {
      "id": 912,
      "at": "2026-09-21T10:32:00+09:00",
      "action": "revision_requested",
      "actor": { "name": "지우", "role": "operator" },
      "review_comment": "서류 일부가 흐릿해서 …",
      "revision_doc_types": ["employment_insurance"]
    },
    {
      "id": 904,
      "at": "2026-09-21T09:41:00+09:00",
      "action": "submitted",
      "actor": { "name": "동민", "role": "student" },
      "review_comment": null,
      "revision_doc_types": []
    }
  ]
}
```

- `action`은 위 enum에서 `submitted` · `resubmitted` · `approved` · `revision_requested` 네 가지만 쓴다
- 소스는 `submission_events`다. 지금 `actor_user_id`만 있으니 이름·역할은 `users`를 조인한다. `review_comment`·`revision_doc_types`는 이벤트가 아니라 제출에 있는 값이라, 이벤트에 남기려면 `note`에 담는 지금 방식 대신 컬럼이 필요하다 (질문 11)
- 학생은 `actor`에 이름이, 담당자는 역할과 이름이 화면에 보인다 (A18 기록과 같은 정책, 처리 담당자는 "실제 처리한 사람")
- A18 "검토 및 변경 기록"의 줄이 이 화면으로 가는 링크는 기록의 `submission_id`를 쓴다

### 원본 PDF 표시

화면의 PDF 영역은 지금 "PDF 미리보기 준비 중" 빈 상태다. `GET /api/files/{id}`는 `Content-Disposition: attachment`에 `Content-Security-Policy: sandbox; default-src 'none'`라서 화면 안에 띄울 수 없다.

| | (a) 스태프용 inline 응답 + iframe/object | (b) pdf.js를 lazy chunk로 | (c) 다운로드만 |
| --- | --- | --- | --- |
| 서버 변경 | 새 경로 + inline 헤더 + 권한 + 접근 기록 | **없음** (기존 `GET /api/files/{id}` + `operator` 허용) | 없음 |
| CSP | sandbox를 풀어야 PDF 뷰어가 뜬다. 사이트 CSP도 `object-src 'none'`, `frame-ancestors 'none'`이라 그 경로만 예외 (Caddyfile `@files`) | `worker-src 'self'` 하나 (worker를 앱 번들에서 서빙) | 그대로 |
| 보안 | 브라우저 내장 뷰어가 PDF의 활성 콘텐츠를 실행 (지금 sandbox가 막는 것) | canvas로만 그림. 스크립트·폼 비활성(`enableScripting: false`) | 지금 설계 유지 |
| 번들 | 0 | 관리자 lazy chunk 약 1 MB (initial은 안 늘어난다, 현재 535 kB / 예산 600 kB) | 0 |
| UX | 확대·페이지 이동은 브라우저 것 | 이미지의 `− 100% +`, `1 / 1 페이지`와 같다 | 검토 중 파일을 열고 돌아와야 한다 |

**(b)로 정했다 (2026-10-17 승인, `admin-front`에 구현됨: `ui/pdf-viewer.ts`).** 기존 `GET /api/files/{id}`를 같은 출처 `fetch`로 읽어 canvas에 그린다. 서버 변경은 없고, 추가로 필요한 것은 `GET /api/files/{id}`에 `operator` 허용("원본 열람")뿐이다. worker·CMap·폰트는 `/pdfjs/` 정적 파일이라 CSP는 `'self'` 그대로다 (운영 CSP와 같은 헤더로 확인함).

처음 추천한 이유: 보안 설계(첨부 + sandbox)를 안 건드리고 서버 작업이 없다. 다만 라이브러리를 추가하는 일이라 FE 팀 승인을 받은 뒤에 한다. 그 전까지는 (c) (다운로드 버튼만)로 쓸 수 있고, 화면은 파일 id 하나만 받으니 (b)로 바꿔도 화면 구조가 그대로다. (a)를 택하면 `GET /api/admin/files/{file_id}/inline`을 따로 만들고, `Content-Security-Policy: default-src 'none'; frame-ancestors 'self'`와 `Content-Type: application/pdf`를 주고, 내려받기와 같은 접근 기록·요청 한도를 적용해 달라.

## 자료함 · 일괄 다운로드

A12(월 자료함), A13(내려받기 옵션), A14(다운로드 시작)가 쓴다. 회계 담당자가 한 달의 최종 제출본을 교육생별 폴더로 묶은 ZIP과 `제출목록.csv`를 한 번에 받는다 (PRD 최우선 기능). **ZIP은 여러 교육생의 원본을 한 번에 꺼내는 일이라 `accountant`만 한다.** 목록은 이름·상태만 보여서 세 역할이 모두 본다.

정책 (화면이 이미 이렇게 동작한다):

- **기본 포함은 그 달의 최종 제출본뿐이다.** 임시 저장(`draft`)은 어떤 옵션으로도 넣지 않고, 목록에도 나오지 않는다
- **검토 상태와 상관없이** 그 달 최종 제출본은 들어간다. 상태는 `제출목록.csv`에 적는다 (승인된 것만 모으지 않는다)
- **승인되지 않은 계좌 변경의 통장사본은 넣지 않는다.** 통장사본은 `include_base_docs`를 켤 때, 그 달에 연결된 **승인된 버전**만 들어간다
- 월은 접수 기간 기준의 **대상 월**이다 (`api.md`의 `target_month`). 받은 날짜가 아니다
- 서버가 매 요청 DB의 역할을 다시 확인한다. FE의 비활성 버튼은 편의다

용어:

- **최종 제출본**: 사용자의 그 달 제출 체인(`initial`·`monthly`과 그 `supplement`들)에서 현재 파일(`superseded_by`가 없는 것)
- **기본 서류 3종**: 신분증·주민등록초본·통장사본의 승인된 버전. 응답의 `base_docs`는 이미 `files`에 있는 것을 뺀 나머지다 (최초 4종 제출이면 비어 있다)
- **이전 제출본**: 그 달 체인에서 `superseded_by`가 있는 파일, 오래된 것부터

### GET /api/admin/archive/{month}

`month`는 `YYYY-MM`. 최종 제출(`draft`가 아닌 제출)이 있는 사용자만 나온다. 접수 기간 행이 없는 달도 제출이 있었다면 나온다 (조회는 접수 기간과 무관하다).

Response `200`

```json
{
  "month": "2026-09",
  "months": ["2026-10", "2026-09"],
  "rows": [
    {
      "user_id": 1,
      "name": "동민",
      "login": "dongkim2",
      "files": ["employment_insurance"],
      "base_docs": ["id_card", "resident_abstract", "bankbook"],
      "previous": [],
      "submitted_at": "2026-09-21T09:12:00+09:00",
      "status": "pending_review"
    }
  ]
}
```

- 보완 제출은 체인에 합쳐 한 행이다 (`files`는 체인의 현재 파일)
- `files`·`base_docs`·`previous`: `doc_type` 배열. 파일 id와 이름은 주지 않는다 (이름은 ZIP을 만들 때 서버가 정한다)
- `submitted_at`: 체인의 마지막 제출 시각. `status`: 체인의 마지막 제출의 상태 (`draft` 제외)
- `months`: 제출이 있는 달, 최신순 (`dashboard`·`notices`의 `months`와 같은 규칙으로 정해 달라)
- 정렬: `submitted_at` 오름차순 (화면은 순서를 그대로 쓴다)

| 상태 | 에러 |
| --- | --- |
| 400 | `month` 형식 오류 (`INVALID_REQUEST`) |
| 401 · 403 | 로그인 안 됨 · 관리자 아님 |

### POST /api/admin/archive/{month}/exports

ZIP 만들기를 요청한다. **`accountant`만.** **`Idempotency-Key` 헤더 (UUID) 필수**, `finalize`와 같은 방식이다: 같은 키로 다시 부르면 같은 job을 돌려주고 새로 만들지 않는다.

```json
{
  "user_ids": [1, 2, 3],
  "include_base_docs": false,
  "include_previous": false,
  "expected_pdf_count": 3
}
```

- 서버는 **요청 시점에 다시 계산한다.** 다시 센 PDF 수가 `expected_pdf_count`(화면의 미리보기)와 다르면 만들지 않고 `409 INVALID_STATE` ("자료가 바뀌었어요. 다시 확인해 주세요."), FE는 목록을 다시 읽는다 (`submission-reminder`의 `expected_count`와 같은 방식)
- `user_ids`는 1명 이상, 상한은 R이 정한다 (질문 13). 그 달에 최종 제출이 없는 사용자가 있으면 `400 INVALID_REQUEST`
- 폴더·파일 이름은 아래 "폴더·파일 이름"의 규칙, `제출목록.csv`는 아래 "제출목록.csv"의 규칙이다

Response `202`

```json
{ "job_id": "uuid", "status": "creating" }
```

### GET /api/admin/archive/{month}/exports/{job_id}

**`accountant`만, 그리고 그 job을 만든 사람만.** 남의 job과 없는 job은 같은 `404 NOT_FOUND`다.

```json
{
  "job_id": "uuid",
  "status": "ready",
  "zip_name": "2026년 9월_지원금 자료.zip",
  "student_count": 3,
  "pdf_count": 3,
  "expires_at": "2026-09-21T09:30:00+09:00"
}
```

- `status`: `creating` · `ready` · `failed`. 화면의 `DownloadStatus`와 같다
- `failed`면 `error`에 짧은 문구를 담을 수 있다. 내부 오류는 `api.md`처럼 로그에만 남기고 일반 문구를 준다
- `expires_at`: 그 뒤에는 `404`다 (아래 임시 파일). FE는 만료되면 다시 만들게 한다

### GET /api/admin/archive/{month}/exports/{job_id}/file

ZIP을 내려받는다. **`accountant`만, 만든 사람만.** `ready`가 아니면 `409 INVALID_STATE`, 만료됐으면 `404`.

- `Content-Type: application/zip`, `Content-Disposition: attachment`
- **한글 파일 이름은 RFC 5987로 준다:** `attachment; filename="download.zip"; filename*=UTF-8''2026%EB%85%84%209%EC%9B%94_%EC%A7%80%EC%9B%90%EA%B8%88%20%EC%9E%90%EB%A3%8C.zip`. `filename=`은 ASCII 대체 이름, `filename*=`은 퍼센트 인코딩한 UTF-8이다. `GET /api/files/{id}`가 이미 하는 방식과 같다 (사용자 입력이 헤더에 들어가지 않게)
- `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. Caddy의 `/api/files/*` 예외와 같은 이유로 이 경로의 CSP·`Referrer-Policy`를 사이트 값으로 덮어쓰지 않게 해 달라
- 다시 내려받으려면 (만료 전) 같은 job의 이 경로를 다시 부르면 된다. 만료 뒤에는 새 job을 만든다

### 임시 파일

- ZIP은 원본을 복호화해서 만들므로 **평문 원본이 디스크에 남는 일이 없어야 한다.** 파일마다 메모리에서 복호화해 ZIP에 바로 쓰고(`storage::verify`로 크기·SHA-256 확인, `heavy_io` 세마포어 안에서), 만들어진 ZIP만 임시 파일(mode 600, `.export-*`)에 둔다
- 임시 ZIP은 **짧게 보관한 뒤 지운다** (제안: 만든 지 15분, `expires_at`). 시작할 때 `sweep_orphans`처럼 오래된 `.export-*`를 지운다
- 만드는 도중 실패하면 임시 파일을 지우고 `failed`로 둔다 ("저장된 행은 항상 있는 파일을 가리킨다"와 같은 원칙)
- 한 사용자가 동시에 만들 수 있는 job과 ZIP 크기 상한은 R이 정한다 (질문 13)

### 폴더·파일 이름

FE의 `admin-front/src/app/core/archive-naming.ts`(단위 테스트 `archive-naming.spec.ts`)와 **같은 규칙**이다. 서버가 같은 규칙으로 만들면 A13의 미리보기가 실제 ZIP과 같다. `archive-naming.spec.ts`의 케이스를 서버 테스트 벡터로 그대로 쓸 수 있다.

| 항목 | 규칙 |
| --- | --- |
| 최상위 폴더 | `{YYYY}년 {M}월` (예: `2026년 9월`). M은 0 없이 |
| ZIP 이름 | `{YYYY}년 {M}월_지원금 자료.zip` |
| 교육생 폴더 | `{이름}_{login}` (예: `동민_dongkim2`), 최상위 폴더 안 |
| 최종 제출본 | `{M}월_{서류명}.pdf` (고용보험가입내역서는 `고용보험`, 나머지는 서류 이름) |
| 기본 서류 | `기본서류_{서류명}.pdf` (`신분증`·`주민등록초본`·`통장사본`) |
| 이전 제출본 | `이전제출본_{M}월_{서류명}.pdf` |
| 목록 | 최상위 폴더 바로 아래 `제출목록.csv` |

한 조각(이름, login)을 안전하게 만드는 규칙 (`safeName`):

1. NFC로 정규화한다 (macOS와 Windows가 한글 이름을 같게 보게)
2. `\ / : * ? " < > |`, 제어 문자(U+0000–001F, U+007F–009F), 보이지 않는 서식 문자(`\p{Cf}`, 예: U+202E bidi override, U+200B)를 `_`로 바꾼다
3. 공백은 하나로 줄이고 앞뒤를 자른다
4. 40자(코드 포인트)에서 자른다
5. 끝의 `.`과 공백을 뗀다 (Windows)
6. 비면 `_`. `.`·`..`도 비는 경우로 처리돼 `_`가 된다
7. Windows 장치 이름(`CON`, `PRN`, `AUX`, `NUL`, `COM1–9`, `LPT1–9`, 확장자가 붙어도)이면 앞에 `_`를 붙인다

같은 폴더 안에서 이름이 겹칠 때 (`uniqueNames`): **NFC로 맞추고 대소문자를 무시하고 비교해서**, 두 번째부터 `_2`, `_3`을 붙인다 (파일은 확장자 앞: `9월_고용보험_2.pdf`). 새로 만든 이름이 이미 있는 이름과 또 겹치면 숫자를 더 올린다. 교육생 폴더에서 겹치는 일은 `login`이 같거나 `safeName`이 서로 다른 이름을 같게 만들 때다 (`A/B`와 `A:B`). 폴더에도 같은 규칙이다.

### 제출목록.csv

- **UTF-8 BOM(`EF BB BF`)으로 시작한다.** 엑셀이 한글을 깨뜨리지 않게 한다. 줄 끝은 `CRLF`
- **열(순서 고정):** `이름`, `login`, `제출 종류`, `파일 종류`, `접수 시각`, `검토 상태`. 첫 줄은 이 머리글
- **파일 하나가 한 줄이다.** 폴더에 들어간 PDF 하나마다 한 줄
- `제출 종류`: `최초` · `월별` · `보완` (그 파일이 속한 제출의 종류)
- `파일 종류`: 서류 이름(`신분증`, `주민등록초본`, `통장사본`, `고용보험가입내역서`). 기본 서류는 `통장사본 (기본 서류)`, 이전 제출본은 `고용보험가입내역서 (이전 제출본)`처럼 뒤에 붙인다
- `접수 시각`: 그 제출의 접수 시각, `YYYY-MM-DD HH:MM` (KST, 엑셀이 날짜로 읽는다)
- `검토 상태`: 학생·관리자 화면과 같은 말 (`검토 중` · `서류 승인` · `재검토 요청` · `재검토 대기`). `draft`는 없다
- **CSV injection 방지:** 셀 값이 `=`, `+`, `-`, `@`, 탭(`\t`), CR(`\r`) 중 하나로 시작하면 **앞에 `'`를 붙인다** (엑셀이 수식으로 실행하지 않게). 이 처리는 따옴표 처리보다 먼저 한다. 이름과 `login`은 사용자 입력이라 모든 문자열 셀에 적용한다
- CSV 인용: 값에 `,` `"` `\r` `\n`이 있으면 `"`로 감싸고 안의 `"`는 `""`로 쓴다
- 주민등록번호·계좌번호는 넣지 않는다 (애초에 이 화면의 값에 없다)

### 감사 로그

PRD: 모든 다운로드를 기록한다. 기존 `file_access_log`(추가만 가능, 트리거가 UPDATE·DELETE·TRUNCATE를 막는다)와 같은 방식이다.

- **ZIP 생성 요청:** 누가(`user_id`, 역할), 어느 달, 대상 사용자 id들, 옵션(`include_base_docs`, `include_previous`), 파일 수, `job_id`, 시각. 요청을 받을 때 **응답 전에** 넣는다
- **ZIP에 넣은 원본마다:** 기존 `file_access_log`에 한 줄 (누가, 누구의 어떤 파일을, 언제, 어떤 권한으로). 사유 구분은 `bulk_export` 같은 값 하나가 있으면 좋다 (질문 14). 낱개 열람과 구분해 센다
- **ZIP 내려받기:** 내려받을 때마다 한 줄 (`job_id`, 시각). 같은 job을 두 번 받으면 두 줄이다
- 실패한 job도 생성 요청 줄은 남는다

| 상태 | 에러 |
| --- | --- |
| 400 | `Idempotency-Key`·본문 오류, 최종 제출이 없는 사용자 (`INVALID_REQUEST`) |
| 401 · 403 | 로그인 안 됨 · `accountant`가 아님 |
| 404 | 없거나 남의 job, 만료된 ZIP (`NOT_FOUND`) |
| 409 | 자료가 바뀜 · `ready`가 아닌 job의 파일 (`INVALID_STATE`) |
| 429 | 요청 한도 (`RATE_LIMITED`) |

## R에게 묻는 것

1. **취업 중 교육생을 시간 요건 집계에서 뺄까?** `api-proposal-eligibility.md` 질문 2와 같은 건이다. 이 제안서에서는 `targets`(제출 대상)에서만 뺐고 `time_requirements.in_progress`·`previous`는 정하지 않았다. 학생 홈이 취업 중이면 시간 요건 카드를 숨기므로, 같은 기준이 좋겠다
2. **`months`에 어느 달을 줄까?** 접수 기간(`cycles`) 행이 있는 달이면 지난달도 보낼 수 있게 되는데, 지난 달에 미제출 안내를 보내는 게 맞는지 정해 달라. 이번 달만 줘도 화면은 그대로 동작한다
3. **중복 전송을 막을까?** 화면은 "같은 안내가 이미 나갔는지 확인한다"고 안내한다. 예: 같은 사용자에게 같은 달 `submission_reminder`가 24시간 안에 이미 갔으면 건너뛰고 응답에 건너뛴 수를 담는다 (지금 응답에는 필드가 없고, 정해지면 FE가 문구를 맞춘다). 막지 않으면 운영진이 두 번 누른 만큼 간다
4. **알림 kind를 `submission_reminder`로 새로 둘까, `submission_period_opened`를 재사용할까?** 새로 두는 편이 낫다고 본다: 자동 접수 시작 안내와 운영진의 수동 독촉은 학생 벨에서 문구가 다르고, 재전송 횟수 제한도 다르다
5. **취업 상태 변경 이력을 남길까?** `employment_changed` 줄과 A18의 "최근 변경"에는 변경 시각 이력이 필요하다. 지금은 `employment_updated_at` 하나뿐이라 줄을 만들 수 없다 (그전까지 FE는 이 줄을 보이지 않는다)
6. **`GET /api/files/{file_id}`에 `operator`를 추가해도 되나?** 위 "원본 열람". 결정은 이미 났다 ("운영·회계 담당자만")
7. **서류 검토 API** (승인·보완 요청, 메모, 검토 기록, 원본 PDF 표시): 위 "서류 검토"에 썼다. 지금은 dev 전용 `POST /api/dev/submissions/{id}/status`뿐이다. 새 enum은 없다
8. **staff 데모 유저 시드:** `operator`와 `accountant` 데모 유저가 시드에 있어야 관리자 화면을 실제 계정으로 확인할 수 있다 (지금은 `staffdemo`를 SQL로 `operator`로 바꿔서 쓴다)
9. **메모를 제출 단위로 둘까, 사용자 단위로 둘까?** 제출 단위로 제안했다. 보완 제출이 새 제출이라 메모가 이어지지 않는데, 사용자 단위면 월을 넘어 이어진다
10. **`POST /api/admin/submissions/{id}/review`에도 `Idempotency-Key`를 받을까?** 더블 클릭으로 같은 요청이 두 번 와도 이벤트가 둘 생기지 않게 하려는 것이다 (`finalize`와 같은 방식)
11. **`submission_events`에 `review_comment`·`revision_doc_types`를 남길까?** 사유는 제출 행의 `review_comment`에만 있고 이벤트의 `note`는 문장 하나라서 (`dev.rs`), 기록 줄만 봐서는 어떤 서류를 왜 요청했는지 읽을 수 없다. 기록 화면이 사유를 보이려면 이벤트 쪽에 값이 있어야 한다
12. **최초 서류(`initial`)의 보완 제출이 백엔드에서 문제없는가?** **로컬 확인 완료 (2026-10-17, R 없이):** 새 데모 유저로 최초 4종 제출 → dev API로 `revision_requested` + `review_comment` + `revision_doc_types=[bankbook]` → 학생 홈 히어로 → `/submit/initial`(통장사본 슬롯 1개만) → 업로드·제출 → 홈 "재검토 대기". DB: supplement의 `parent_id`는 그 `initial`, `required_doc_types={bankbook}`, supplement와 initial 모두 `resubmitted`. 같은 달 `initial`(승인) + `monthly`의 월별 보완도 `/submit`으로 같은 결과(체인이 섞이지 않음). 로컬 dev 백엔드·실제 Postgres 기준이다. **운영 pod(`make demo`, `https://localhost:8443`, ClamAV 스캔·암호화 저장 포함)에서도 같은 흐름이 통과했다** (`e2e/revision.ts`, `GET /api/submissions`로 supplement `parent_id`=initial, `required_doc_types=[bankbook]`, 둘 다 `resubmitted` 확인). R의 코드 검토는 아직.
13. **ZIP 상한을 어떻게 둘까?** 한 번에 선택할 수 있는 사용자 수, ZIP의 총 크기, 한 사용자가 동시에 만들 수 있는 job 수. 화면은 상한 없이 만들어 두었고, 정해지면 A13에서 "n명까지 한 번에 받을 수 있어요"를 보인다. 요청 한도도 업로드처럼 따로 두는 편이 낫다고 본다 (만들기 1건이 원본 수십 개를 복호화한다)
14. **`file_access_log`에 일괄 내려받기를 구분하는 값을 둘까?** 낱개 열람과 ZIP에 묶여 나간 열람을 따로 셀 수 있어야 감사에서 "누가 한 달 치를 통째로 받았나"가 보인다. 컬럼이나 `reason` 값 하나면 된다
