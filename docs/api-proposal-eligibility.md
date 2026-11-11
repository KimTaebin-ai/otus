# API 제안: 시간 요건 · 알림

FE(@KimTaebin-ai)가 R(@DavidLee18)에게 넘기는 **제안서**다. `api.md`가 아니다. 합의되면 R이 `api.md`에 옮기고, 그 뒤 FE가 `api.models.ts`를 맞춘다.

형식은 `api.md` 공통 규칙을 따른다: 시간은 ISO 8601 KST(`+09:00`, 초 단위), 월은 `YYYY-MM`, 에러 body는 `{"error": {"code", "message"}}`, 상태 변경 요청은 `Origin` + `X-XSRF-TOKEN`.

## 정책 (이슈 기준)

- 하루 인정 = min(그날 로그인 합계, 12시간). KST 자정에서 나누고, 초 단위로 반올림하지 않는다
- 월 인정 40시간 이상 → 50만 원 구간, 80시간 이상 → 100만 원 구간, 40시간 미만 → 미충족
- 월중 40·80시간에 처음 도달하면 "달성(예상)" + 알림. 다음 달 1일 09:00에 시간 요건을 판정하고 알림을 보낸다
- 최종 수령 대상 = 시간 요건 충족 + 서류 승인. 운영진이 정한다
- 접속 기록이 없는 달은 0시간이다

기준 시간·금액·판정 시각은 정책(설정)이므로 **응답에 값으로 담는다**. FE는 40·80시간, 50·100만 원, "1일 09:00"을 하드코딩하지 않고 계산하지도 않는다.

## enum (합의 필요)

시간 요건, 서류 상태(`status`), 최종 수령 대상은 **서로 다른 축**이다. 한 필드로 합치지 않는다.

| phase | 의미 |
| --- | --- |
| `in_progress` | 월중 집계 중 (이번 달) |
| `awaiting_decision` | 달이 끝났고 판정 전 (다음 달 1일 00:00 ~ `decides_at`) |
| `decided` | 판정됨 (`result`가 있음) |

| result.status | 의미 |
| --- | --- |
| `met` | 시간 요건 충족 (`tier` 있음) |
| `not_met` | 미충족 (40시간 미만) |
| `on_hold` | 판단 보류 (42 API 실패 등으로 판정하지 못함) |

| tier | 의미 |
| --- | --- |
| `tier_1` | 40시간 이상, 50만 원 구간 |
| `tier_2` | 80시간 이상, 100만 원 구간 |

| final.status | 의미 |
| --- | --- |
| `undecided` | 운영진 확정 전 |
| `eligible` | 수령 대상 (확정) |
| `not_eligible` | 수령 대상 아님 (확정) |

## GET /api/me/time-requirements

로그인한 교육생의 월별 시간 요건. 최신 달부터 정렬한다. 홈은 `limit=2`(이번 달 + 지난달), 이력은 전체를 쓴다.

Query (모두 선택):

- `month=YYYY-MM`: 그 달만
- `limit`: 최대 개수

```json
{
  "items": [
    {
      "month": "2026-10",
      "phase": "in_progress",
      "as_of": "2026-10-17T14:00:00+09:00",
      "recognized_seconds": 189000,
      "thresholds": [
        { "tier": "tier_1", "seconds": 144000, "amount": 500000 },
        { "tier": "tier_2", "seconds": 288000, "amount": 1000000 }
      ],
      "projected_tier": "tier_1",
      "decides_at": "2026-11-01T09:00:00+09:00",
      "result": null,
      "final": { "status": "undecided", "amount": null, "decided_at": null }
    },
    {
      "month": "2026-09",
      "phase": "decided",
      "as_of": "2026-10-01T09:00:00+09:00",
      "recognized_seconds": 112800,
      "thresholds": [
        { "tier": "tier_1", "seconds": 144000, "amount": 500000 },
        { "tier": "tier_2", "seconds": 288000, "amount": 1000000 }
      ],
      "projected_tier": null,
      "decides_at": "2026-10-01T09:00:00+09:00",
      "result": { "status": "not_met", "tier": null, "decided_at": "2026-10-01T09:00:12+09:00" },
      "final": { "status": "undecided", "amount": null, "decided_at": null }
    }
  ]
}
```

필드:

- `as_of`: 마지막으로 집계한 시각. 화면에 "{as_of} 기준"으로 보여준다. 집계 주기(미확정)는 이 값으로만 드러난다
- `recognized_seconds`: 하루 12시간 상한과 자정 분할을 적용한 월 합계, 정수 초. 접속 기록이 없으면 `0` (항목을 빼지 않는다)
- `thresholds`: 그 달에 적용한 기준. `seconds` 오름차순
- `projected_tier`: `in_progress`에서만 쓴다. 지금 합계로 도달한 구간 (`null`, `tier_1`, `tier_2`). 판정이 아니다
- `decides_at`: 그 달의 판정 시각(다음 달 1일 09:00 KST). **FE는 이 값을 그대로 보여주고 계산하지 않는다**. 판정이 늦어지면 서버가 갱신한다
- `result`: `decided`에서만 있다. `tier`는 `met`일 때만
- `final`: 운영진의 최종 수령 대상 결정. `amount`는 `eligible`일 때 지급 금액(원)
- 이번 달에 기록이 아직 없어도 이번 달 항목은 항상 준다 (`phase: "in_progress"`, `recognized_seconds: 0`)

FE 표시 규칙 (참고): 월중은 "달성(예상)"까지만 말한다. 지난달은 `final`이 `undecided`가 아니면 `final`을 먼저 보여준다. 단, `not_met`이면서 `not_eligible`이면 미충족을 보여준다.

| 상태 | 에러 |
| --- | --- |
| 401 | 로그인 안 됨 |
| 400 | `month` 형식 오류 (`INVALID_REQUEST`) |

## 알림

서버는 `kind`와 `data`만 주고, 화면 문구는 FE가 쓴다. "달성(예상)"과 "확정"을 섞지 않는 문구 규칙을 한 곳에서 지키기 위해서다. 읽음 상태는 서버가 가진다. 지금 벨이 쓰는 localStorage는 이 API가 생기면 없앤다.

| kind | data | FE 이동 |
| --- | --- | --- |
| `hours_projected` | `month`, `tier` | `/home` |
| `time_requirement_decided` | `month`, `status`, `tier` | `/home` |
| `final_decided` | `month`, `status` | `/history` |
| `submission_period_opened` | `month` | `/submit` |
| `submission_revision_requested` | `submission_id`, `month` | `/submit` |
| `submission_approved` | `submission_id`, `month` | `/history` |
| `bank_account_approved` | (없음) | `/settings` |
| `bank_account_rejected` | `decision_note` | `/settings` |

- `hours_projected`: 월중 40·80시간에 **처음** 도달했을 때 한 번씩. 같은 달 같은 `tier`는 다시 보내지 않는다
- `submission_period_opened`: 지금 클라이언트에서 만드는 "서류 제출 안내"를 대신한다. 취업 중인 교육생에게는 보내지 않는다 (미제출 안내 제외 규칙)
- 계좌번호는 `data`에 넣지 않는다 (마스킹 값도 `GET /api/me/bank-account`에서 읽는다)

### GET /api/notifications

Query: `limit` (기본 20, 최대 50), `before=<id>` (그 알림보다 오래된 것)

```json
{
  "items": [
    {
      "id": 1042,
      "kind": "time_requirement_decided",
      "created_at": "2026-10-01T09:00:12+09:00",
      "read_at": null,
      "data": { "month": "2026-09", "status": "not_met", "tier": null }
    },
    {
      "id": 1031,
      "kind": "hours_projected",
      "created_at": "2026-09-19T22:14:03+09:00",
      "read_at": "2026-09-20T08:02:41+09:00",
      "data": { "month": "2026-09", "tier": "tier_1" }
    }
  ],
  "next_before": 1031
}
```

- 최신순. `next_before`가 `null`이면 마지막 페이지

### GET /api/notifications/unread-count

```json
{ "count": 3 }
```

벨의 점과 "새 알림 n개"에만 쓴다. 화면을 이동할 때마다 부르므로 가벼워야 한다.

### POST /api/notifications/{id}/read

응답 `204`. 이미 읽은 알림이어도 `204` (멱등).

| 상태 | 에러 |
| --- | --- |
| 404 | 없는 id, 다른 사람의 알림 (`NOT_FOUND`, 둘을 구분하지 않는다) |

### POST /api/notifications/read-all

응답 `204`. 벨을 열면 FE가 보이는 알림을 읽음 처리한다. 이 요청 하나로 처리하거나 id별로 보낸다 (R이 정해도 된다).

## dev · 데모 (R 작업, 참고)

`DEMO_LOGIN_ENABLED`와 `user.is_demo`로 막는 기존 `/api/dev/*` 규칙을 따른다.

### POST /api/dev/time-requirements/decide

```json
{ "month": "2026-09" }
```

그 달의 1일 09:00 판정을 지금 실행한다. 결과와 `time_requirement_decided` 알림이 실제 작업과 같은 경로로 생긴다. 응답은 `GET /api/me/time-requirements?month=`의 항목 하나.

### 시드 데모 유저 (체크포인트 1)

| 상태 | 이번 달 `recognized_seconds` 예 |
| --- | --- |
| 0시간 | `0` |
| 40 미만 | `83400` (23시간 10분) |
| 40~80 | `189000` (52시간 30분) |
| 80 이상 | `309600` (86시간) |

지난달 결과(미충족, 충족 50·100만 원 구간, 판단 보류)도 한 명씩 있으면 홈 카드의 지난달 상태를 모두 확인할 수 있다.

## R에게 묻는 것

1. **판단 보류는 자동으로 재시도하나?** 하면 `decides_at`을 다음 시도 시각으로 갱신하고 `phase`를 `awaiting_decision`으로 돌려주면 된다. 안 하면 운영진이 처리할 때까지 `on_hold`로 둔다.
2. **취업 중인 교육생에게는 시간 요건 카드를 보여주지 않는다** (FE 계획). 미제출 안내 제외 규칙과 같은 맥락이다. 이 경우에도 API는 항목을 줄지, 비울지 정해 달라. FE는 `GET /api/me`의 `employed`로 숨긴다.
3. **이슈의 미확정 두 개**
   - 자동 확정 vs 운영진 재확정: 위 `final` 모양이면 둘 다 담긴다. 자동이면 `final`이 판정과 함께 정해진다.
   - 월중 집계 주기: FE는 `as_of`만 보여준다. 주기는 화면에 쓰지 않는다.
