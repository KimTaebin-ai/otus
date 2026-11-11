# HANDOFF — OTUS frontend (branch `front-taebkim`)

Rewritten 2026-10-17, start of day 2; updated after the day-2 time-requirement layout work and the day-3 (2026-10-18) API hookup. Old notes are in git history (`git show 8470a93:HANDOFF.md`).

## 2026-10-18 지원금 검토 기간(학습 월) 개편 — 관리자 앱 + 학생 홈 (커밋 안 됨, 작업 트리)

**목표:** 운영진은 매달 "N월 학습에 대한 지원금 지급 건"을 검토한다. 10월에 검토하면 **9월 학습, 9월 1일~10월 15일 제출분**이다. 15일을 지난 제출은 다음 기간(10월 학습, 10월 1일~11월 15일, 11월에 검토)이다. 이 규칙을 관리자 앱 전체(헤더, 월별 제출 내역, 홈, 서류 승인)와 학생 홈 카드에 반영한다. 사용자가 한 건씩 요청했고 매번 `bun run build`와 `bun run test -- --watch=false`로 확인했다. **서버와 연결한 브라우저로는 한 번도 못 봤다** (백엔드 API는 `curl`로 `opsdemo` 데모 로그인 후 숫자만 대조했다).

**지금 상태:** admin-front 빌드 통과, 264개 중 262개 통과 (실패 2개는 `login.spec.ts`, 커밋 `4a85235`의 운영자 42 로그인 숨김 때문이라 이번 작업과 무관). frontend 빌드 통과, 171개 전부 통과. 백엔드는 이번에 **손대지 않았다**.

**핵심 규칙 (`admin-front/src/app/core/study-hours.ts`가 한 곳):**
- **작업 월(working month)** = 오늘(KST)이 15일 이하면 이번 달, 16일 이상이면 다음 달 (`workingMonthAt`). 10월 18일이면 11월.
- **학습 월** = 작업 월의 전달 (`hoursMonthFor`). 검토 기간 = 학습 월 1일 ~ 작업 월 15일 (`reviewWindow`, 15는 상수 `REVIEW_DEADLINE_DAY`, 서버 설정 아님).
- 1~15일은 두 기간에 걸친다(예: 10월 10일 제출은 9월 학습 기간과 10월 학습 기간 둘 다). 사용자가 준 두 정의를 그대로 따른 결과이고 사용자에게 알렸다.
- **조회 월 필터는 없앴다.** 대신 헤더의 검토 기간 띠(`‹ 10월 학습에 대한 지원금 지급 건 검토 · 10월 1일 ~ 11월 15일 제출분 ›`)에서 `AdminMonth.step(-1|1)`로 이동한다 (`core/admin-month.ts`: `working`, `offset`, `viewing`, `canGoNext`). 오늘 기간보다 뒤로는 못 간다(`offset > 0` 거부, 버튼 비활성). 제출 기간 설정·제출 안내·자료함은 월을 바꿔야 해서 헤더의 월 이동(이름만 "대상 월")을 남겼다.

**한 일 (결정과 이유):**
- **사용자 상세 `/users/:id`** (`core/user-record-api.ts`): 교육생 단위 API가 없어서 월별 목록 + 체인별 `/history`·`/events`로 이번 달 제출, 최초 제출 서류, 검토·변경 기록을 채운다. 받을 계좌는 **관리자용 API가 없어서** "—"와 안내 문구(`bankUnavailable`)만. 조회 실패하면 기본 정보만 있는 화면으로 남는다. 호출이 많다(월 수 + 체인 수 × 2).
- **월별 제출 목록 `listWindow`** (`core/admin-submissions-api.ts`): 서버가 제출 대상 월(`target_month`) 단위라서 작업 월과 그 전달 두 목록을 불러와 학습 기간 안의 체인만 남기고 서류 상태 필터는 **브라우저에서** 적용한다. 같은 방식의 `windowQueue`(연속 검토 시작), `windowRows`(전 페이지, 인원 수용). 커서는 `listSubmitted`와 같은 "두 목록이 모두 확인한 id까지만" 규칙.
- **제출자 필터** = 이 기간에 제출한 모두(검토 상태 무관, `chains.length > 0`). 이전에는 검토 중 + 재검토 대기만이라 카드의 "제출 25명"을 눌러도 19명만 나왔다. 라벨은 "제출자 (검토 상태 전체)".
- **인원 수** (`core/window-counts.ts` `countRows`): 기간 안의 체인이 있는 학생이 제출, 취업 중 제외, 임시 저장은 미제출. 기한 이후 제출은 다음 기간 몫이라 세지 않는다. 홈은 이미 전체를 불러와서 추가 호출 없음, 월별 제출 내역은 `windowRows`로 한 번 더 불러온다.
- **학습 시간 열** (월별 제출 내역, '현재 정보' 앞): `GET /api/admin/notices/submission-reminder?audiences=all`의 `study_hours`(0/40/80) 한 번. 색: 40시간 미만 빨강, 이상 파랑, 80시간 이상 초록, 집계 없음 주황, 취업 중 "제외". **구간만 알 수 있고 정확한 시간은 없다.**
- **서류 승인 확인 화면** (`pages/approve-confirm-view.ts`, `submission-review.ts`): 학습 월의 구간을 보여 주고, 40시간 미만이거나 집계가 없으면 "직접 확인했고 승인을 진행해요" 체크를 해야 승인 버튼이 켜진다(시스템은 제안만, 판단은 운영진). 시간 정보를 불러오기 전에는 승인 불가. 검토 화면의 작업 월은 `workingMonthOf(submitted_at)`(15일까지 그 달, 이후 다음 달).
- **별도 "안내 발송" 호출은 안 넣었다:** 안내 발송 API는 대상 조건 단위라 교육생 한 명에게 못 보낸다. 승인하면 서버가 `submission_approved` 알림을 보낸다. 시간 구간 안내는 기존 '제출 대상 안내' 화면에서.
- **학생 홈 자격 요건 카드** (`frontend/src/app/pages/hours-hero.ts`, `core/hours-hero.ts`): 구간 문구 아래 `다음달(11월) 예상 수령 금액 / 50만 원`. 금액은 `/api/me/time-requirements`의 `projected_tier`에 해당하는 `thresholds[].amount`(프론트가 계산하지 않음), 구간에 못 닿으면 `0원`. 데스크톱은 좌우 2열, 600px 이하는 세로.
- 제출 시각 옆 태그(`검토 기한 내` 등)와 홈 카드의 학습 지원금 띠도 같은 상수에서 나온다.

**안 된 것 / 막힌 길:**
- **교육생 단위 관리자 API 없음:** `api.md`에 계좌·교육생별 제출 이력 엔드포인트가 없다. 팀원이 "만들어뒀다"고 했지만 어느 원격 브랜치에도 없었다(`back-jaehylee`, `deploy`, `feat/users-ordinal-ko-name`, `feature/issue-11-adminpage` 확인). 계좌는 백엔드 담당(@DavidLee18)에게 요청이 필요.
- **서버 월 필터와 학습 기간이 안 맞는 것:** 서버는 제출 대상 월 단위. 그래서 두 달을 합쳐 클라이언트에서 거른다. 서류 상태 필터를 브라우저에서 해서, 결과가 적으면 스크롤로 여러 번 불러올 수 있다. 서버가 "제출 시각 범위" 조회를 주면 `listWindow`·`windowRows`·`windowQueue`가 한 번의 호출로 줄고 정확해진다.
- **검토 화면의 이전/다음 사용자 이동**은 여전히 제출 대상 월 기준(`/navigation`)이라 기간 경계에서 다른 기간의 건으로 넘어갈 수 있다.
- 지난 기간을 보다가 검토 화면에 들어가면 시간 요건 확인은 제출 시각으로 정한 기간 기준이라 헤더에서 보던 기간과 다를 수 있다.
- **제출 대상 55명** (시드 DB 기준: 25 제출 + 30 미제출)에는 최초 4종을 아직 안 낸 30명이 들어 있다 (`initial_submitted`가 true인 사람은 25명). 사용자가 마지막에 "숫자가 틀림"이라고만 하고 어느 숫자가 틀린지 안 알려 줬다. 위 25명 vs 19명 불일치는 고쳤지만, 제출 대상을 "최초 제출 완료자만"으로 바꿀지(그러면 미제출 0명)는 **사용자 답을 기다리는 중**.
- 한 번 `sed -i`(BSD) 실패 뒤 이어진 `python3`가 실행되지 않아 같은 코드가 두 번 들어가는 일이 있었다. macOS에서는 `sed -i ''`를 쓰고 `&&` 뒤 스크립트가 돌았는지 확인할 것.

**테스트 메모:**
- 월별 제출 내역·홈 스펙은 `AdminMonth.working`을 `'2026-10'` / `'2026-11'`로 직접 세팅한다 (오늘 날짜에 의존하면 깨짐). `HttpTestingController`로 작업 월 목록은 **두 요청**(전달 + 작업 월)이다. 스펙 도우미 `open()`/`windowRequests()`가 큰 쪽 월에 본문, 작은 쪽에 빈 응답을 준다. 월별 제출 내역은 목록 응답 뒤에 인원 수용 요청이 또 나가서 도우미가 바로 응답한다.
- 기본 필터(제출자)에서는 기간 안의 체인이 없는 행이 안 보이므로 스펙의 `row()`가 기본으로 `2026-10-10` 제출 체인을 가진다.

**다음 할 일:**
1. 사용자가 `bun run start`(+ 백엔드, `make seed`)로 헤더 띠, `‹ ›` 이동, 목록·카드 숫자, 학습 시간 열 색, 승인 확인 화면, 학생 홈 카드 배치를 눈으로 확인하고 어색한 곳을 알려 주면 수정. 학생 홈은 `/home`에서 40시간 이상 데모 계정(`eligmid` 등)으로.
2. 제출 대상의 범위(55 vs 최초 제출 완료 25) 결정 받기.
3. 백엔드 담당에게 요청: ① 관리자용 교육생 계좌 조회 ② 교육생 단위 제출 이력 ③ 제출 시각 범위·검토 기간 조회 ④ 기수·생년월일(현재 `cohort.ts` 가짜 값).
4. 15일 기한을 서버 설정(정책 값)으로 옮길지 논의 (현재 상수).
5. `login.spec.ts` 2건은 운영자 42 로그인 숨김 커밋 이후 기대값을 고쳐야 한다.
6. `admin-front/HANDOFF.md`는 따로 있고 이번에 갱신하지 않았다.

## 2026-10-18 관리자 앱 대시보드·제출 내역·알림 작업 (전부 커밋 안 됨, 작업 트리)

**목표:** 관리자 앱(`admin-front/`)의 현황 대시보드, 월별 제출 내역, 사용자 관리를 운영자가 한눈에 보기 좋게 고친다. 사용자가 한 건씩 요청했고 매번 `bun run build`와 `bun run test -- --watch=false`로 확인했다. **브라우저로는 한 번도 못 봤다.**

**지금 상태:** 관리자 앱 빌드 통과, 244개 중 242개 통과. 실패 2개는 `login.spec.ts`("42 계정으로 로그인" 기대)이고 커밋 `4a85235`(운영자 42 로그인 숨김) 때문이라 이번 작업과 무관. 백엔드 `cargo clippy --all-targets` 통과, **백엔드 테스트는 안 돌림**.

**한 일 (결정과 이유):**
- **새 API `GET /api/admin/activity`** (`backend/src/routes/admin.rs`, `routes/mod.rs`, `api.md`에 문서 추가): 최근 30일 취업 상태 변경(`users.employment_updated_at`)과 계좌 변경 요청(`bank_account_changes.requested_at`)을 최신순으로. 마이그레이션 없음, 계좌번호는 절대 안 싣는다. 취업 상태는 이력 테이블이 없어 교육생당 마지막 1건만. api.md는 팀 규칙상 기준 문서라, 새 엔드포인트를 추가한 것을 백엔드 담당(@DavidLee18)이 확인해야 한다.
- **알림 종(우측 상단)과 대시보드 카드 "교육생 취업 여부 및 계좌 정보 변경":** `core/activity.ts`의 `ActivityService`가 30초마다 폴링(푸시 채널 없음). 읽음 여부는 브라우저 `localStorage`(`otus-admin-activity-seen`)에만 저장, 서버에는 없음. 종은 `layout/admin-shell.*`, 카드는 `pages/dashboard.ts`.
- **대시보드 "제출 인원" 카드:** 기존 `GET /api/admin/notices/submission-reminder?audiences=all`의 `targets`로 제출/미제출/제출 대상(취업 중 제외, 임시 저장은 미제출)을 센다. 세 숫자는 밑줄 링크이고 `/submissions?month=&status=submitted|unsubmitted|all`로 간다. 색: 제출 teal, 미제출 red, 제출 대상 blue. 같은 요약이 월별 제출 내역 상단에도 있다.
- **대시보드 하단 "제출 현황":** 제출한 교육생만 최근 제출 순 5명. 백엔드 목록이 user id 순이라 50명씩 끝까지 불러와 클라이언트에서 정렬(`recentSubmitters`). 교육생이 수백 명을 넘으면 백엔드에 "최근 제출 순" 정렬이 필요하다(api.md 계약 변경이라 미룸).
- **월별 제출 내역(`pages/submissions.ts`):** 기본 필터 "제출자"(= `pending_review` + `resubmitted`, **클라이언트에서 조합**: `core/admin-submissions-api.ts`의 `listSubmitted`가 두 상태를 같은 커서로 조회해 합치고 두 목록이 모두 확인한 id까지만 보여준다). 백엔드에 `submitted` 상태를 추가했다가 사용자 지시로 되돌렸다. 필터가 왼쪽·검색(16rem)이 오른쪽, 검색은 입력 후 300ms에 자동, "더 보기" 대신 IntersectionObserver 무한 스크롤, 제목은 필터에 따라 "월별 ◯◯ 제출 내역", 카드 제목에 "· N명(이상)", 번호 열, 세 버튼(연속 검토/일괄 다운로드/제출 대상 안내)은 카드 제목 줄로 이동. `?status=`로 들어오면 그 필터가 선택된다. select는 `[selected]`를 옵션에 직접 바인딩.
- **표현 교체:** "전체 교육생" → "제출 대상자", "교육생 정보 변경" → "교육생 취업 여부 및 계좌 정보 변경".
- **기수·생년월일(임시, 하드코딩):** `core/cohort.ts`의 `cohortOf(login)`, `birthOf(login)`, `studentLabel(name, login)` = `3기B_홍길동(021205)`. 값은 login 해시로 만든 가짜이고 실제 값이 아니다. 백엔드가 기수·생년월일을 주면 이 함수들만 API 필드로 바꾸면 된다. 적용: 월별 제출 내역, 사용자 관리 목록, 사용자 상세 제목(요약 줄에 "인트라 ID · login"), 서류 검토 상단 사용자 줄, 대시보드 제출 현황 표. 이름 아래 줄에 인트라 ID.
- **다운로드 파일명:** 서류 검토 화면 `ui/pdf-slot.ts`의 "↓ 다운로드"가 PDF를 fetch해 `ArchiveFileSaver`로 `기수_이름(생년월일).pdf`로 저장(실패하면 서버 기본 방식으로 새 탭).

**안 된 것 / 주의:**
- 대시보드 "제출 N명"(임시 저장 아닌 제출 전부) 숫자와, 클릭해서 가는 "제출자" 목록(검토 중 + 재검토 대기만)이 **다를 수 있다.** "미제출/제출 대상"도 카드는 취업 중 제외, 목록은 포함. 사용자에게 알렸고 맞출 방향은 미정.
- 카드 제목의 "N명 이상"은 지금까지 불러온 수다. 정확한 총인원은 서버 개수 API가 있어야 한다.
- 파일명에 서류 종류가 없어서 같은 교육생의 서류를 여러 개 받으면 이름이 겹친다(브라우저가 "(1)"을 붙임). 최초 제출은 4개.
- 일괄 다운로드 ZIP 안의 폴더·파일명은 백엔드가 만든다. 미리보기(`core/archive-naming.ts`의 `studentFolder`)는 옛 형식 그대로라 백엔드 수정 때 같이 맞춰야 한다.
- 알림 종 패널의 날짜는 `occurred_at.slice(5, 16)`로 단순 표기.
- `admin-front/HANDOFF.md`도 따로 있다(이 파일과 내용이 다름). 이번에는 루트만 갱신했다.

**다음 할 일:**
1. 사용자가 브라우저에서 `bun run start`(+ 백엔드 재시작, `make seed`)로 확인하고 어색한 곳을 알려 주면 수정. 알림은 교육생 계정으로 취업 상태/계좌를 바꿔 본다.
2. 대시보드 카드 숫자와 목록 인원의 불일치 해결 방향 결정.
3. 백엔드 담당에게 요청: 기수·생년월일 필드, `/api/admin/activity` 검토, (선택) 최근 제출 순 정렬·개수 API, ZIP 이름 규칙, 백엔드 테스트 실행.
4. 커밋·push 여부 확인(지금은 전부 작업 트리).

## 2026-10-18 반응형·모바일 UI 작업 (전부 커밋 안 됨, 위 4a85235 위에 작업 트리로만 있음)

**목표:** 학생 앱(`frontend/`)과 관리자 앱(`admin-front/`)의 반응형, 모바일 앱 같은 UI, 카드 클릭 영역 확대. 사용자가 한 건씩 요청하며 진행했고, 요청 때마다 CLI 빌드·테스트와 headless Chrome 스크린샷으로 확인했다.

**지금 상태:** 학생 앱 빌드 경고 없음, 169개 테스트 통과. 관리자 앱 빌드 경고 없음, 235개 통과 + **2개 실패(`login.spec.ts`, 42 버튼 기대)**: 우리 커밋 `4a85235`가 관리자 42 로그인 버튼을 숨겨서 생긴 것이고 이번 작업과 무관(변경을 stash해도 동일). 고칠지는 사용자 결정. 약 55개 파일이 수정만 된 상태(커밋·push 안 함, 사용자가 요청할 때만).

**한 일 (결정과 이유):**
- **브레이크포인트:** 1100px(오른쪽 열이 아래로), 900px(사이드바 → 상단 가로 메뉴), 720/600px(폰). `@media`는 컴포넌트 CSS 끝에 붙였다. 토큰은 `shared/styles/_tokens.scss` 끝에 600px 이하 글자 크기(`--font-size-page-title` 24px 등)와 `--space-5` 24px 축소.
- **하단 탭 바(600px 이하, 두 앱):** 메뉴를 `position: fixed` 하단 바로 (`shell.css`, `admin-shell.css`). 본문 하단 여백 88px + `env(safe-area-inset-bottom)`. z-index 9(다이얼로그 10보다 아래). 400px 이하는 라벨 10px.
- **학생 상단:** 900px 이하에서 로고와 알림·로그아웃이 한 줄(상단바를 `position: absolute`로 로고 줄 위에 겹침, 높이 `--height-topbar-mobile` 60px). 관리자 앱 상단은 아직 로그아웃이 별도 줄이다(사용자 요청은 학생만).
- **줄바꿈:** 두 앱 `styles.scss` 전역에 `word-break: keep-all` + `overflow-wrap: break-word`, 제목은 `text-wrap: balance`, `p/li`는 `pretty`.
- **관리자 데이터 표:** `app-data-table`에 `overflow-x: auto` + `min-width: 32rem` (모바일에서 가로 스크롤).
- **관리자 월 선택기 CSS**는 크기 예산 때문에 `admin-front/src/styles.scss`로 옮겼다.
- **크기 예산:** 두 앱 `angular.json`의 `anyComponentStyle` 경고를 4kB → 4.5kB로 올렸다(`shell.css`/`admin-shell.css`가 넘어서). 되돌리려면 CSS를 줄여야 한다.
- **관리자 홈(`dashboard.ts`):** 세 버튼을 모두 secondary로, 기본은 연한 녹색 테두리(`color-mix`), hover/focus는 진한 녹색 + 민트 배경 + 2px 상승 + 그림자 + 0.2초 전환(reduced-motion 존중).
- **카드 전체 클릭(학생):** `upload-slot`은 행 어디를 눌러도 파일 선택(upload 모드) 또는 PDF 미리보기(view 모드). 버튼의 자체 `(click)`을 지우고 행 핸들러 `onRowClick`이 받는다(Enter/Space는 버블링). 미리보기 창 클릭은 `closest('app-pdf-preview')`로 무시(안 그러면 닫자마자 다시 열림). `account-card` 통장사본 행들도 같은 방식. 홈 `profile-card`는 stretched link(`.link::after { inset: 0 }`). hover/focus 시 진한 녹색 테두리. 스펙 3개 추가(`upload-slot.spec.ts`).
- **로그인(`login.html/css`, 600px 이하):** 모달/시트 느낌 없이 왼쪽 정렬. 흰 위쪽(로고, 환영 문구, 버튼, 안내 카드) + 검정(`--color-nav`) 푸터에 기능 소개 3줄. `.intro`/`.intro-body`는 `display: contents`로 풀어 `order`로 배치. 헤드라인·lede·eyebrow·hr은 숨김. "이메일로 로그인" 버튼은 **disabled 자리만 잡음**(+ "곧 제공될 예정이에요" 문구, 기능은 추후 개발, 연결 API 없음). 두 버튼에 왼쪽 아이콘(절대 위치), 좌우 padding 동일.
- **홈(제출 완료, `home-submitted`):** 왼쪽 `.main-col`(시간 요건 → 제출 완료 히어로 → 최근 제출 내역), 오른쪽 `.know`(알아두면 편해요) + `app-profile-card`. 1101px 이상에서 `.side-col`을 `display: contents`로 풀고 grid로 FAQ 카드가 왼쪽 스택 높이만큼 늘어나게(위아래 선 정렬), 프로필 카드는 2행. 모바일 순서는 히어로 → 최근 내역 → FAQ → 내 정보.
- **자격 요건 카드(`pages/hours-hero.ts`):** 흰 배경 + 테두리, padding 24px(다른 카드와 동일), 헤드라인에 "(예상)" (`core/hours-hero.ts`: "40시간 이상 (예상)" 등, spec 반영). **프로그레스 바(`app-hours-bar`) 복원:** `HoursHero`가 `ApiService.timeRequirements({limit:2})`를 직접 호출해 이번 달 `recognized_seconds`와 `thresholds`로 바를 그린다. 실패하면 바만 빠진다. 이 때문에 위 3일차 기록의 "홈의 별도 `/api/me/time-requirements` 조회는 제거"는 **더 이상 맞지 않는다.** `home.spec.ts`의 `load()`가 이 요청을 flush하고(취업 중이면 요청 0건 기대), 바 테스트 1개 추가.

**안 된 것 / 주의:**
- 알림 팝오버를 모바일에서 `position: fixed; top: auto`로 두면 flex 정적 위치가 벨 위쪽이라 `margin-top`으로 벨 아래로 밀었다. **실기기·실제 클릭으로는 확인하지 않았다**(스크린샷은 닫힌 상태).
- `home-submitted.css`는 예산에 딱 맞춰져 있다(중복 규칙 제거로 맞춤). 더 추가하면 경고가 난다.
- `home-submitted.html`은 prettier를 돌려서 diff가 크다(들여쓰기).
- 제출 전 홈(`home-due`)의 레이아웃은 건드리지 않았다(자격 요건 카드의 흰 배경·(예상)·바는 함께 적용됨). 취업 중이면 카드·바 모두 숨김(기존 동작).
- hover 애니메이션과 터치 동작은 코드로만 확인했고 브라우저에서 눌러 보지 않았다.
- 검증 도구: 스크래치패드의 `shoot.ts`(CDP로 headless Chrome에 로그인해 폭별 가로 넘침 측정·스크린샷)는 세션 폴더에 있어서 다음 세션에는 없다. 방법: dist를 Bun 정적 서버로 서빙하고 `/api`를 :3000으로 프록시(Origin을 `http://localhost:4200`으로 덮음), `/login`에서 `fetch('/api/auth/demo-login')`으로 로그인.

**다음 할 일:**
1. 사용자가 브라우저/실기기에서 모바일(하단 탭 바, 알림 팝오버, 로그인, 홈)을 확인하고 어색한 곳을 알려 주면 이어서 수정.
2. 변경을 커밋·push할지 사용자에게 확인(지금은 전부 작업 트리). 커밋 때 위 크기 예산 변경(angular.json)을 함께 설명.
3. 관리자 앱 `login.spec.ts` 2개 실패 정리(사용자 결정: 테스트를 숨김 상태에 맞출지).
4. 선택: 관리자 앱 모바일 상단(로그아웃 별도 줄)을 학생처럼 한 줄로, `home-due`에도 같은 정렬 적용 여부, 601~900px에서도 하단 탭 바로 바꿀지.

## 2026-10-18 핸드오프 갱신 (대화 초기화 직후)

- 이 갱신은 새 작업 없이 기록만 맞췄다. `front-taebkim`은 `origin/front-taebkim`과 같고 작업 트리는 깨끗하다 (push할 것 없음).
- 최신 커밋 `4a85235`: 관리자 로그인 화면(`admin-front/src/app/pages/login.html`)의 "42 계정으로 로그인" 버튼을 다시 숨겼다 (운영자는 42 OAuth로 로그인하지 않기로 함). 그래서 `admin-front/HANDOFF.md`의 "42 로그인 버튼 복원" 설명(36ff202)은 이 커밋으로 대체된다. 운영에서 관리자가 로그인하는 방법은 아직 사용자 답을 기다린다.
- 이어서 할 일은 아래 "다음 할 일"을 따른다. 다음 세션은 이 파일 → 관리자 작업이면 `admin-front/HANDOFF.md` 순으로 읽는다.

## 2026-10-18 로컬 관리자 403 설정 수정·VM 반영

- 로컬 `deploy/.env` 사용 시 관리자 주소가 `APP_ORIGINS`에서 누락되어 POST가 403으로 거절되었다. `deploy/start-podman.sh`의 로컬 관리자 기본값을 Caddy와 일치시키고, 명시한 허용 목록에서 관리자 주소가 빠지면 배포 전에 중단한다. 설정 테스트 12개 통과 후 기존 로컬 VM에 반영했다.
- CLI에서 학생·관리자 주소의 요청이 Origin 검사를 통과하고, 외부/누락 Origin은 계속 거부되며 API·스캐너가 정상임을 확인했다. 로그인·발송은 하지 않았고 브라우저는 실행하지 않았다. 상세는 `admin-front/HANDOFF.md`의 최신 항목을 참고한다.

## 2026-10-18 직접 작성한 운영팀 알림 수신

- 관리자 알림 화면이 제목·내용 작성 → 채널·대상 체크 → 명단 확인·최종 발송으로 바뀌었다. `admin_notice`의 `data.title/body`를 학생 알림 벨에 표시한다. HTML을 실행하지 않고 일반 텍스트로 보여주며 줄바꿈·빈 줄·반복 문장을 보존한다.
- 전체 학생 발송에는 최초 등록 전·취업 중인 학생도 포함된다. 기존 최초 등록 화면의 알림 벨에서도 원문을 읽을 수 있다. 자동 제출 안내 및 기존 시간 구간 알림 형식은 계속 지원한다. 상세 계약은 `api.md`, 관리자 흐름은 `admin-front/HANDOFF.md`에 기록했다.
- 학생 프로덕션 빌드 및 전체 165개 테스트 통과 후 원문 일반 텍스트 렌더링 검사를 추가해 알림 관련 30개 재검증 통과(최종 166개 범위). 격리 DB/SMTP에서 원문 전달·중복 제거·이메일 재시도도 확인했다. 브라우저 및 배포 적용은 하지 않았다.

## 2026-10-18 제출 이력의 시간 요건 카드 제거

- 학생 `내가 낸 서류`(`/history`)에서 월별 시간 요건 카드를 제거했다. 해당 화면의 `/api/me/time-requirements?limit=36` 조회와 전용 `history-time.ts`도 제거했다.
- 제출 서류, 접수 정보, 검토 상태와 보완 제출 링크는 유지한다. 화면 설명은 `등록한 서류와 검토 결과를 확인하세요.`로 통일했다. 아래 과거 기록의 이력 화면 시간 요건 표시 설명은 이 변경으로 대체한다.
- CLI 검증: 학생 앱 프로덕션 빌드와 제출 이력 테스트 8개 통과. 배포 이미지 재생성과 적용은 아직 하지 않았다.

## 2026-10-18 시간 구간별 관리자 알림 수신

- 관리자 운영 메뉴는 `알림 보내기`로 바뀌었으며 미제출 / 40시간 미만 / 40시간 이상 80시간 미만 / 80시간 이상 중 하나를 선택해 보낸다.
- 교육생 알림 벨은 새 `study_hours_notice`의 `month`, `study_hours`를 받아 해당 월과 시간 구간을 표시한다. 관리자 미리보기와 학생 알림은 `shared/core/notice-audience.ts`의 문구를 공유한다. 최종 지급 확정과 구분하며 홈으로 연결한다.
- 시간 구간 대상은 최근 저장된 월별 집계로 선정한다. 시간당 집계도 `/api/me`와 같은 42 월별 조회·KST 일별 12시간 상한을 사용한다. 실제 계정에서 42 설정이 없거나 조회가 실패하면 0시간 집계를 새로 만들지 않는다.
- 학생 앱 프로덕션 빌드와 26개 파일·168개 테스트 통과. 기존 사용자 지시대로 CLI에서 검증하고 브라우저 확인은 사용자에게 맡긴다. 이번 변경의 배포 이미지 재생성과 적용은 아직 하지 않았다.


## 2026-10-18 학생 홈 자격 요건 간소화

- 홈 상단은 `자격 요건` 제목과 `40시간 미만`·`40시간 이상`·`80시간 이상` 중 현재 상태 하나만 표시한다. 기준은 `GET /api/me.study_hours`의 `0`·`40`·`80`이며, 진행률·상세 인정 시간·금액·예상 수령 대상·판정 시각은 이 카드에서 제거했다.
- 제출 전·후 홈에 동일하게 적용했다. 홈의 별도 `/api/me/time-requirements?limit=2` 조회는 제거했고, 이력 화면의 상세 시간 조회는 유지한다. 취업 중이면 기존처럼 카드를 숨기며, `study_hours: null`은 0으로 간주하지 않고 조회 실패 안내를 표시한다.
- 아래 과거 기록의 큰 시간 요건 히어로·수령 대상 박스 설명은 이 변경으로 대체한다. 기존 사용자 지시대로 CLI 검증만 수행했으며 학생 앱 프로덕션 빌드와 26개 파일·167개 테스트가 통과했다.

## 2026-10-18 관리자 발송 안내의 앱 내부 수신 연결

- 관리자 발송 API가 저장하는 `submission_reminder`를 교육생 상단 알림 벨에서 실제로 읽는다. 최초 등록 화면에도 같은 벨을 추가했다. 기존 알림 API 계약과 백엔드 전송 로직은 그대로 사용한다.
- 안 읽은 수는 서버 `unread-count`와 남아 있는 자동 안내를 합산한다. 개별 읽음·모두 읽음은 서버 성공 후 반영하고, 받은 알림은 읽은 뒤에도 다시 조회할 수 있다. 이전 알림은 커서로 더 불러온다. 벨 열기·새로고침·화면 이동·탭 복귀 시 조회하며 벨이 닫힌 동안 60초마다 갱신한다. 계정 전환·로그아웃은 기존 요청을 취소하고 목록을 지운다.
- 서버 생성이 아직 없는 접수 시작·계좌 안내와 그 localStorage 읽음 플래그는 유지했다. 같은 달의 서버 제출 안내가 조회되면 자동 제출 안내는 중복 표시하지 않는다. 최초 서류를 이번 달에 이미 제출한 경우에도 자동 월별 안내를 만들지 않는다.
- 과거·마감된 월의 알림은 현재 월 마감일을 붙이지 않고 제출 이력으로 연결한다. 신규 교육생은 `/initial`, 현재 접수 중인 교육생은 `/submit`, 서류 보완 요청은 최초/월별 구분을 확인할 수 있는 `/history`로 이동한다.
- 검증: 학생 26개 파일·172개 테스트, 관리자 32개 파일·233개 테스트와 두 앱 프로덕션 빌드 통과. 격리 DB·로컬 SMTP에서 실제 앱 알림 수신·읽음·페이지 조회·권한을 검증했다. 로컬 VM에 반영한 뒤 두 앱의 알림 번들 HTTP 응답이 컨테이너 파일과 일치하고 `/api/health`가 `status: ok`, `scanner: ready`임을 CLI로 확인했다. 브라우저는 실행하지 않았다.
- 아래 과거 기록의 “알림 벨 미연결”과 알림 API 호출 추가 할 일은 이 변경으로 대체한다. 모든 kind의 서버 생성과 합성 안내의 완전 제거는 후속 과제로 남는다. 검증은 사용자 요청에 따라 CLI만 수행한다.

## 목표와 현재 위치

학생용 프런트엔드(Angular 22, signals + RxJS, Bun)로 배포 URL에서 이 흐름이 끝까지 돈다:
데모 로그인 → 최초 4종 → 홈 "검토 대기" → 월별 제출 → 재검토 요청(dev API) → 보완 제출 → 홈 "재검토 대기".

- **1일차 완료:** U01~U06 전부 (로그인, 최초 4종, 홈, 월별 제출, 이력·보완 제출, 설정·계좌 변경, 알림 벨). 목은 없고 전부 실제 API.
- **2일차:** 시간 요건(로그인 인정 시간)·수령 대상 표시 + 접수 기간 표시 버그 수정. 시간 요건은 42 API의 로그인 시간 기준, 하루 12시간 상한, 월 40시간 이상 50만 원 / 80시간 이상 100만 원. 이슈는 사용자가 준다 (아래 "다음 할 일").
- **3일차 (2026-10-18): R의 #9·#10 merge 후 시간 요건 API 연결 (알림은 막힘).** 사용자 승인 계획의 학생 앱 1~4번 완료, 5번(알림 벨 서버 전환)은 **하지 않았다 — 아래 "R 확인 사항" 3번.**
  - 커밋: `1fd2413` 관리자 42 로그인 죽은 코드·테스트 정리(merge 직후 `admin-front`의 `login.spec` 1개가 깨져 있었다. 원인은 R이 아니라 우리 `0686218`이 42 버튼을 지운 것, 사용자 결정으로 삭제 유지), `218abf3` 타입·호출·변환, `e48743a` 홈, `8f0cf12` 이력, 이어서 이력 정리.
  - **타입·호출:** `api.models.ts`의 `TimeRequirement`·`TimeRequirementList`·`TimeRequirementQuery`, `ApiService.timeRequirements(query)`. 변환은 `core/time-requirement-view.ts`(`toTimeRequirementViews`, `toCurrentView`, `toPreviousView`) + spec. **기준 시간·금액은 응답 `thresholds`만 쓴다** (spec이 다른 정책값으로 40/80시간·50/100만 원이 안 나오는지 고정). 충족 구간 금액은 그 달 thresholds에서 `tier`로 찾는다. 카드 컴포넌트·`shared/core/time-requirement.ts`는 고치지 않았다.
  - **홈:** `home.ts`가 `GET /api/me/time-requirements?limit=2`를 같이 읽어 `home-due`·`home-submitted`에 `time` 입력으로 넘기고, 둘 다 `app-time-requirement-card`를 그린다 (due는 버튼 아래·내 정보 위, submitted는 히어로 아래). **`me().employed`면 요청도 안 하고 카드를 숨긴다** (R 답: 취업 중에도 API는 항목을 준다). 조회 실패는 카드만 숨기고 홈은 그대로.
  - **이력:** `/history`는 `limit=36`으로 읽어 월 그룹 아래에 `pages/history-time.ts`(월별 카드: 집계 중이면 막대·"{월일 시각} 기준", 지난 달이면 판정 문구)를 붙인다. 제출 없이 시간만 있는 달도 그룹으로 나온다. 시간 요건이 있으면 머리글 "서류 검토 결과와 월별 시간 요건을 확인하세요.", 없거나 취업 중이면 옛 문구.
  - **알림 벨은 그대로** (주기 + 제출 목록 + 계좌 합성, 읽음은 localStorage). `otus.notice.read:*` 코드도 그대로 남아 있다. API 타입·호출(`notifications`)도 아직 안 만들었다 (쓰는 곳이 없어서).
  - **검증:** 학생 22 파일 142개, 관리자 20 파일 136개 통과, 학생 build 경고 없음. 브라우저(4300 + headless Chrome, 새 백엔드 :3001)로 실제 API: 시드 4명(`elig0` 미충족 · `eliglow` 충족 tier_1 · `eligmid` 충족 tier_2 · `elighigh` 판단 보류 + 이번 달 집계 상태 4종)의 홈·`/history` 카드 문구, `dongmin`(이번 달 0시간). 회귀: 새 데모 유저로 최초 → 승인 → 같은 달 월별 → `revision_requested` → `e2e/revision.ts`(히어로 → 보완 화면에 요청한 서류 1개만 → 제출 → 홈 "재검토 대기") **6/6 통과**. `e2e/run.ts`는 9/11: 실패 2개("U03 due layout", "deadline from the real cycle")는 **`dongmin`에게 이번 달 월별(`pending_review`, 10-17 20:06 KST 제출)이 이미 있어서** 홈이 due가 아니라 submitted로 나오기 때문이다 (이번 세션 이전 데이터, 코드 문제 아님). e2e를 다시 쓰려면 이 기대를 새 유저로 바꾸거나 그 제출을 정리해야 한다 (정리 SQL은 사용자 승인 필요).
  - **로컬 백엔드 주의:** 사용자가 띄운 :3000 백엔드는 merge 전 빌드라 새 API가 404였다 (재시작 필요). 나는 건드리지 않고 `BIND_ADDR=127.0.0.1:3001 FORTY_TWO_CLIENT_ID= CC=/usr/bin/clang CXX=/usr/bin/clang++ cargo run`으로 따로 띄웠다 (`FORTY_TWO_CLIENT_ID=`로 42 OAuth를 끈다: 켜져 있으면 e2e가 실제 42 로그인 페이지로 간다. dotenvy는 이미 있는 환경변수를 덮지 않는다). dev 서버는 `ng serve --port 4300 --proxy-config <3001로 가는 proxy>`.
  - **시드 (`make seed`, 2026-10-18 실행):** `elig0`·`eliglow`·`eligmid`·`elighigh`(이번 달·지난달 `time_requirements` 행, DB로 확인), `opsdemo`·`accountdemo`·`admindemo`. 이 4명은 최초 4종이 없어서 `/initial`로 가므로 **내가 브라우저에서 최초 4종을 제출했다** (이번 달 `pending_review`, 시간 요건 행은 안 건드림). 새 테스트 유저 `cp2003823`은 `revision.ts`로 보완까지 끝냈다.
  - **홈 "수령 대상" 카드 + 사이드바 도움말 카드 (사용자 요청 2026-10-18, `final/U03-home-due.png`):** 이전에 숨기기로 한 것을 사용자 결정으로 보이게 했다.
    - **2026-10-18 다시 만듦 (사용자: "가장 시각적으로 노출이 많아야 하고, 로그인하자마자 시간을 채웠는지 보여야 한다. 40시간 미만도 숨기지 말고 '40시간 미만'으로"):** 처음 만든 작은 `recipient-card`(홈 due는 통계 칸, submitted는 시간 요건 카드 위 한 줄)는 눈에 안 띄어서 지우고, **홈 제목 바로 아래, 제출 히어로 위에 `pages/hours-hero.ts`** 로 바꿨다 (민트 히어로 스타일). 사용자 지시로 **가로폭은 "서류 제출을 마쳤어요" 히어로와 같다**: submitted는 `.main-col`(왼쪽 열, 오른쪽은 내 정보)에 두 히어로를 쌓고, due는 `.top` 그리드의 첫 칸에 둔다. 처음엔 전폭에 큰 글씨라 너무 커서 헤드라인 20px·숫자 28px·오른쪽 박스 176px로 줄였다. 왼쪽: "{월}월 시간 요건 · {시각} 기준" + 배지, 큰 헤드라인, **큰 숫자 "인정 시간 23시간 10분"**, 막대, 다음 구간까지 남은 시간, 판정 시각. 오른쪽 흰 박스: 이번 달 "수령 대상 · {월}월" (`core/recipient-status.ts`).
    - **헤드라인 (`core/hours-hero.ts` + spec):** 첫 구간 미만이면 "{첫 구간 시간} 미만" (0시간도 숨기지 않음, 시간은 응답 `thresholds[0]`에서), 첫 구간부터는 도달 구간 "50만 원 구간 시간을 채웠어요" + 배지 `달성(예상)` (월중이라 "확정" 아님).
    - **수령 대상 박스는 이번 달 인정 시간 기준이다 (사용자 기획 2026-10-18: "교육생 화면에서 수령 대상자인지는 무조건 이번 달에 채운 시간으로 판단").** 처음엔 지난달 판정으로 만들었고 "지난달 판정이 나오면 여기서 확인할 수 있어요" 문구까지 넣었는데 기획과 달라서 고쳤다. `core/recipient-status.ts`(`recipientStatus(current, final)`): 이번 달 시간이 응답 `thresholds[0]` 미만이면 `대상 아님 (예상)` + "40시간을 채우면 50만 원 구간 대상이 돼요", 첫 구간부터 `대상 (예상)` + 도달 구간, 운영팀이 이번 달 `final`을 정했을 때만 `대상 확정`(금액)·`해당 없음`. 월중이라 "예상"이고 시간만으로 "대상 확정"이라고 하지 않는다 (spec). 지난달 얘기는 박스에 없다 (지난달 판정은 이력의 월별 카드). `TimeRequirementViews.currentFinal`을 더했다.
    - **조회 실패는 숨기지 않고 안내를 보인다** ("시간 요건을 불러오지 못했어요. 잠시 뒤 새로고침해서 다시 확인해주세요."). 처음엔 실패하면 카드를 조용히 숨겼고, 사용자의 :3000 백엔드가 merge 전 빌드라 `/api/me/time-requirements`가 404여서 카드가 아예 안 보였다. **취업 중이면 아무것도 안 보인다** (`time`이 null). 이 결정이 맞는지 확인 필요: 취업 중인 학생에게도 수령 대상 칸은 보여줄지.
    - 이미지의 "제출 대상 / 대상 확정 / 운영팀 확인"은 못 만들었다: 제출 대상 여부를 주는 API가 없고 있는 데이터는 수령 대상(`final`)뿐이다.
    - `layout/help-card.ts`: 사이드바 사용자 행 위 "도움이 필요하신가요? / 준비부터 제출까지 차근차근 안내해드릴게요." **"도움말 보기 →" 링크는 도움말 페이지가 없어서 `layout/shell.ts`의 `HELP_URL`이 빈 문자열인 동안 안 나온다.** URL이 정해지면 그 상수만 채운다 (새 탭, `noopener`). `/initial`의 자체 상단바 shell에는 넣지 않았다.
    - 검증: 학생 25 파일 157개 통과, build 경고 없음, `eliglow`(40시간 미만)·`eligmid`(달성 예상)로 홈 확인. due 레이아웃은 spec으로만 봤다 (dev DB에 due 상태인 시간 요건 유저가 없다: 최초만 낸 새 유저는 `/initial`로 간다).
    - 안 한 것: "제출 대상 안내", "대상 확인 요청" 버튼(API·화면 없음), 홈 submitted 하단 "서류 준비가 막막할 때" 카드(요청 범위 밖).
- **3일차 후반 (2026-10-18, 사용자 요청 4건, 아직 push 안 함):** `15066ce` 위로 3커밋이 쌓였다 (`c40c16f`, `28eac34`, `d7212b1`). 빌드 경고 없음, 학생 157 테스트 통과. **브라우저 확인은 사용자가 PDF 모달만 직접 했다** ("잘 뜨네"). 나머지(색상, 홈 카드 배치, 취업 안내)는 build·spec만 봤다.
  - `c40c16f` **PDF 미리보기 모달:** 제출 이력(`/history`, 사이드바 "내가 낸 서류")의 `app-upload-slot mode="view"`에 "미리보기" 버튼과 왼쪽 문서 아이콘 클릭(Enter 포함)으로 `ui/pdf-preview.ts`(`<dialog>` + `showModal`)를 연다. `GET /api/files/{id}`는 attachment + `CSP: sandbox`라 iframe에 바로 못 넣는다 → `ApiService.fileBlob(id)`로 blob을 받아 `URL.createObjectURL(new Blob([b], {type:'application/pdf'}))`를 iframe에 넣고 닫을 때 revoke한다. **`deploy/Caddyfile`의 앱 CSP 두 곳에 `frame-src blob:`을 더했다 (pod를 다시 띄워야 반영, `bun run start`는 영향 없음).** 이 커밋 메시지에 이슈 #8 코멘트 링크(`issues/8#issuecomment-6229629319`)를 넣었다 (사용자 요청, 이전 해시 `39448ca`를 rebase로 바꿈, 이슈에 옛 해시를 적었다면 `c40c16f`로).
  - `28eac34` **시간 요건 색:** `core/recipient-status.ts`에 `tone`(`eligible`/`not-eligible`) 추가, 홈 수령 대상 박스는 대상=청록 바탕·흰 글씨, 해당 없음=붉은 바탕·테두리·글씨. `pages/hours-hero.ts`의 인정 시간·제목 색은 `copy.tone`을 따른다 (충족·대상·달성=청록, 집계 중=호박, 미충족·해당 없음=붉은, 판정 대기·보류=파랑). `shared/ui/hours-bar.ts`는 도달한 단계로 채움 색이 다르다 (40시간 미만 호박 `--hours-bar-fill-low`, 40시간 이상 청록, 80시간 이상 진청록 `--hours-bar-fill-top`, 토큰은 `shared/styles/_tokens.scss`). **hours-bar와 토큰은 shared라 admin-front 막대도 같이 바뀐다.** 제출 이력·홈 카드의 시간 요건은 막대 색만 바뀌고 글자색은 히어로에만 넣었다.
  - `d7212b1` **홈 submitted:** "알아두면 편해요" 카드를 "이번 달 서류 제출을 마쳤어요" 히어로 오른쪽 열로 옮기고, "내 정보" 카드(`app-profile-card`)는 아래 줄의 "최근 제출 내역" 옆으로 내렸다. 취업 상태 문답은 공지 문구로 바꿨다 ("취업 상태, 꼭 확인하세요": 현재 저장 상태 + 해당 없음 회신, 고용보험 45일 지연·미가입 조회여도 제출 금지, 부정수급·전액 환수, 근로 중·가입 예정 제출 금지, 조건 미비·기한 초과 지급 불가, 서류 오류만 개별 연락). 공지의 "기타 문의 불가"는 넣지 않았다. **`home-due`(제출 전)에는 이 안내가 없다.** 사용자에게 넣을지 물어 둔 상태다 (답 없음).
  - 이 세 커밋 전에 만든 것: `d33acc4`~`15066ce` (홈 맨 위 시간 요건·수령 대상 히어로 `pages/hours-hero.ts`, 수령 대상 카드, 사이드바 도움말 카드). 이 부분은 위 3일차 bullet에 이미 있다.
- **관리자 앱 `admin-front/` (2026-10-17 시작, 별도 앱):** 기본 세팅(`8378200`) + 역할 가드·관리자 shell(`c733a84`) 완료. 상태·결정·R 확인 사항·다음 할 일은 **`admin-front/HANDOFF.md`**에 있다. 관리자 작업이면 그 파일부터 읽는다. `frontend/`는 건드리지 않는다.
- **공용 코드 `shared/` (2026-10-17, 구조 이동만):** 두 앱이 같이 쓰는 코드를 루트 `shared/`로 옮겼다. 규칙은 루트 `CLAUDE.md`의 `shared/` 항목.
  - 내용: `styles/_tokens.scss`, `core/`(`brand`, `format`, `time-requirement`(+spec), `api-types`), `ui/`(button, card, info-box, status-badge, time-badge, count-pill, hours-bar, notice-panel).
  - 학생 전용은 그대로: `ui/`의 upload-slot, drop-panel, employment-choice와 `core/`의 api.service, auth.service, guards, profile, account-draft, banks.
  - `core/api.models.ts`는 `shared/core/api-types.ts`(관리자도 쓰는 타입: Role, Me, AuthMethods, LOGIN_ERRORS, 에러 body, 상태·서류 종류와 라벨)를 re-export하고 나머지를 둔다. 둘을 합쳐 api.md mirror다. `api.models`를 import하는 파일은 그대로다.
  - **연결:** 각 앱의 `src/shared`가 `../../shared` 심볼릭 링크이고, tsconfig와 angular.json에 `preserveSymlinks: true`가 있다. 그래서 `@angular/*`는 각 앱의 `node_modules`에서 온다. import는 `@otus/shared/*`, SCSS는 `includePaths: ["src/shared"]`에서 `@use 'styles/tokens'`로 찾는다. shared 안끼리는 상대 경로를 쓴다.
  - **안 된 방법:** tsconfig `paths`로 `@angular/*`를 앱 `node_modules`에 매핑하면 빌드는 되지만 테스트가 전부 깨진다. unit-test 빌더가 `externalPackages: true`(하드코딩)라, 매핑된 import만 번들되어 TestBed와 Angular가 두 벌이 된다 (`getDefaultDocument` null, NG0203).
  - **검증:** 그룹마다 두 앱 build와 test를 돌렸다. 학생 화면(`/home`, `/submit`, `/history`, `/settings`, `/dev/ui`, `dongmin`)은 `c733a84` worktree를 기준으로 headless Chrome 전체 페이지 PNG가 **바이트 단위로 같았다**. 그 시점의 최종 테스트는 학생 19 파일 117개, 관리자 6 파일 32개다(shared spec이 두 앱에서 다 돈다).
  - 커밋: `9ee48b0` 설정·링크, `65c7374` README·CLAUDE.md, `2c09a1a` 토큰, `f81e169` core·api-types, `6bb97f0` ui.
  - **배포 (`25543a5`로 고쳤다):** `shared/` 링크 때문에 `deploy/web.Containerfile`의 학생 이미지 빌드가 깨져 있었다 (`WORKDIR /src`에 `frontend/`만 COPY해서 `src/shared → ../../shared`가 컨테이너의 `/shared`를 가리켰고, `bun run build`가 "Cannot find module '@otus/shared/core/brand'", "Can't find stylesheet to import"로 실패했다. 수정 전 파일로 재현해서 원인을 확인했다).
    - 지금은 빌드 스테이지가 `WORKDIR /src/frontend`에서 돌고 `COPY shared/ /src/shared/`를 더한다. 산출물은 `/src/frontend/dist/frontend/browser`에서 복사한다. **바뀐 deploy 파일은 `deploy/web.Containerfile` 하나**다 (Makefile, `.containerignore`, `deploy.yml`, `e2e.yml`, Caddyfile은 그대로).
    - 확인: `podman build -f deploy/web.Containerfile -t localhost/otus-web .`가 통과하고, 이미지 `/srv`의 파일 목록이 로컬 `bun run build` 결과와 같다 (해시 파일명까지). `shared/` 토큰·브랜드·`index.html`의 `<title>OTUS</title>`와 `<base href="/">`도 들어 있다. pod 전체(`make demo`, CI e2e)는 이번에 돌리지 않았다.
    - `deploy.yml`의 rsync(`-az`)는 심볼릭 링크를 그대로 보내므로 서버에서도 링크가 맞는다. `admin-front`는 아직 이미지가 없다. 만들 때는 같은 형제 구조로 `WORKDIR /src/admin-front`, `COPY shared/ /src/shared/`.
- **Git (2026-10-17 확인):** 관리자 화면 작업(`a50b7f4` 디자인 문서·이미지, `c7dd5ef` shell, `c9b6c95` A00, `054fe06` A07, `bcf8f88` A18, `ba6a6b6` API 제안서)과 배포 복구(`25543a5`), 이 HANDOFF 정리까지 `origin/front-taebkim`에 push했다. 관리자 쪽 정리는 `admin-front/HANDOFF.md`. `origin/back-jaehylee`(`d3307c1`)는 `front-taebkim`의 조상이라 merge 필요 없음 (push는 사용자가 요청할 때만).
  - 2일차 커밋: `62af102` HANDOFF 재작성, `280f4a7` closes_at 표시 버그, `045f93c` HANDOFF cycles 문장, `1b8852a` 홈 기간 문구 "1일부터", `c90da6a` 시작 시각 00:00 제거, `36b6c39` HANDOFF, `31528a2` 용어 분리, `fc4b474` 시간 요건 카드, `8a8128a` API 제안서 + HANDOFF.
- **검증 (2026-10-17, 2일차 마지막 커밋):** `bun run build` 경고 없음 (예산 600 kB). `bun run test -- --watch=false` 19 파일 117 테스트 통과. `/initial` 기간 "10.01 – 10.31"도 브라우저로 확인 (새 데모 유저 `u02period`, draft 생성은 차단). 홈(due)과 `/dev/ui` 시간 요건 카드를 headless Chrome으로 확인.
- **2일차 시간 요건 작업 (API 없이 레이아웃까지):**
  - `31528a2` 용어 분리: "승인"은 항상 서류 승인(배지 `서류 승인`, 홈 태그 `서류 확인 중`·`서류 보완 필요`, U04 단계 `서류 승인`). 수령 대상은 "시간 요건과 서류 승인을 보고 운영팀이 확정"으로만 쓴다. 홈 due의 가짜 고정값(`대상 확정`, `운영팀 확인 완료`) 삭제, stat은 2개. `e2e/run.ts` 문구도 맞췄다.
  - `fc4b474` 시간 요건 카드: `pages/time-requirement-card.ts`(순수 표시, input `current`/`previous`), 화면용 타입·상태→문구 `core/time-requirement.ts`, `ui/hours-bar.ts`, `ui/time-badge.ts`, `format.ts`의 `hoursText`(버림)·`wonText`, 토큰 `--badge-hours-*`·`--hours-bar-*`. 12개 예시가 `/dev/ui`에 있다 (데이터는 `dev-ui.ts` 상수). **홈·이력에는 3일차에 연결했다.**
  - 문구 규칙: 월중은 "달성(예상)"까지만, 지난달은 "시간 요건"까지만. `final`이 정해지면 `final` 우선 (단 `not_met` + `not_eligible`은 미충족 표시). 판정 시각은 서버 `decides_at`을 그대로 표시.
  - `/dev/ui`는 열 때 initial draft를 만든다. 브라우저 검증 때 CDP `Network.setBlockedURLs`로 `*/api/submissions*`를 막아 데모 유저 데이터를 지켰다.
  - `8a8128a` `docs/api-proposal-eligibility.md`: 시간 요건·알림 API 제안서. **사용자가 그대로 확정, R에게 넘김.** `api.md`는 안 건드렸다.
- **2일차 작업에서 사용자가 정한 범위·결정:**
  - R이 아직 없어서 **API는 붙이지 않고 레이아웃까지만**. `api.models.ts`·`api.service.ts` 수정, 알림 벨 변경, 이력 변경은 API가 생긴 뒤에. mock interceptor·가짜 서비스는 만들지 않는다.
  - 디자인은 Figma 없이 Angular에서 토큰·기존 컴포넌트로 바로 만든다 (새 상태는 final 이미지가 없어도 됨).
  - 상태 문구 (사용자 지정): final `eligible` → "{월}월 수령 대상으로 확정됐어요" / "{금액} · 지급 일정은 따로 안내해드릴게요", `met`인데 `not_eligible` → "{월}월은 수령 대상이 아니에요" / "운영팀 확인 결과예요. 궁금한 점은 운영팀에 문의해주세요", `awaiting_decision` → 배지 "판정 대기", "{월}월 시간 요건을 판정하고 있어요 · {decides_at}에 결과가 나와요".
  - 내가 정하고 사용자에게 보고한 것 (이견 있으면 바꾼다): `not_met`+`not_eligible`은 미충족 표시, 1분 미만 남으면 "1분 미만 남았어요", 홈 due stat 3→2열 (빈 칸 대신).
- **잘 된 것:** 화면용 타입(`CurrentMonthView`/`PreviousMonthView`)을 API 타입과 분리해서 API 없이 카드·테스트를 끝냈다. 상태→문구를 순수 함수로 빼서 경계(143999/144000/288000초)와 금지어("확정·지급·받아요")를 단위 테스트로 고정. 브라우저 검증은 아래 레시피 그대로 (4300 + headless Chrome) 잘 동작했다.
- **안 된 것 / 주의:** 한국어 긴 줄이 단어 중간("까/지")에서 끊겨 `word-break: keep-all`을 넣었다. **그래도 Chrome은 괄호 앞뒤에서 끊는다** ("구간" / "(80시간)까지", 넣은 뒤엔 "구간(80시간)" / "까지"). 그래서 `shared/core/time-requirement.ts`의 `NO_BREAK`(U+2060 word joiner)로 "구간(40시간)까지"를 한 단어로 묶었다. 1440·1100·820px에서 단어 중간 줄바꿈 0건 확인 (Range로 단어별 줄 수 검사). prettier가 원래 안 맞던 `home-due.html`·`home-submitted.ts`를 손댄 김에 정리했다 (import 줄바꿈 등).

## 먼저 읽을 것

1. `CLAUDE.md` (루트): 명령, 아키텍처, 보안. 사용자 지시가 이긴다.
2. `frontend/CLAUDE.md`, `frontend/README.md`
3. `api.md`: API의 기준. 구현이 다르면 구현이 틀린 것. **api.md는 수정하지 말고 사용자에게 묻는다.**
4. `docs/design/README.md` + `shared/styles/_tokens.scss` + 지금 만드는 화면의 `docs/design/final/` 이미지 한 장. 이미지를 전부 열지 않는다.

## 화면 현황

Routes는 `frontend/src/app/app.routes.ts`. 모두 완성이다.

| 화면              | 라우트                                                                                 | 파일 (`src/app/`)                                                                             |
| ----------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| U01 로그인        | `/login`                                                                               | `pages/login.*`                                                                               |
| U02 최초 4종      | `/initial` (onboarding-shell)                                                          | `pages/initial.*`, `layout/onboarding-shell.ts`                                               |
| U03 홈            | `/home`                                                                                | `pages/home.ts` → `home-submitted.*` / `home-due.*`, `profile-card.ts`                        |
| U04 월별 제출     | `/submit`                                                                              | `pages/monthly.*`, `monthly-done.*`, `ui/drop-panel.*`                                        |
| U05 보완 제출     | `/submit` (월 최신 상태가 `revision_requested`)                                        | `pages/supplement.*`                                                                          |
| U05 이력          | `/history`                                                                             | `pages/history.*`                                                                             |
| U06 내 정보       | `/settings`                                                                            | `pages/settings.*`, `account-card.*`, `ui/employment-choice.ts`                               |
| U06 계좌 흐름     | `/settings/account/review` (guard), `/settings/account/requested`, `/settings/history` | `pages/account-review.*`, `account-requested.*`, `account-history.*`, `core/account-draft.ts` |
| 알림 벨           | Shell 안                                                                               | `layout/notifications.*`                                                                      |
| 컴포넌트 쇼케이스 | `/dev/ui` (개발 빌드만)                                                                | `pages/dev-ui.ts`                                                                             |

- `/home`~`/settings`는 사이드바 shell, `/initial`은 자체 상단바. `initialSubmittedGuard`가 최초 4종 제출 전이면 `/initial`로 보낸다.
- `/submit`의 분기: 같은 달의 `initial`은 무시하고(데모가 한 달에 최초→월별을 한다) monthly + supplement 중 최신으로 판단 (`monthlyOutcome()` in `pages/monthly.ts`).
- `pages/placeholder.ts`는 라우트에서 import하지 않는다 (정리 후보, 지우기 전에 grep).

**접수 기간 표시 (2일차에 고침):** api.md의 기간은 한 달 전체다. `opens_at` = 1일 00:00, `closes_at` = 다음 달 1일 00:00 (**미포함**).
- **마감:** 화면은 항상 `lastMoment(closes_at)`(1초 전, 말일 23:59)로 보여준다. 쓰는 곳은 `home-due`, `home-submitted`, `initial.ts`, `monthly.ts`(`deadline`·`closesAt`), `supplement.ts`(`deadline`), `notifications.ts`. 새 화면에서 `closes_at`을 쓸 때도 반드시 `lastMoment()`를 거친다. 화면에 "11월 1일"이 나오면 버그다.
- **시작:** 시각 없이 날짜만 보여준다 (사용자 결정). 홈 FAQ·안내 "10월 1일부터", 운영팀 안내 "10.01", 벨 머리글 "10월 1일", `/submit`의 접수 시작·upcoming 패널·하단 바.
- **U02 `/initial`:** 기간은 날짜만 "10.01 – 10.31" (`initial.ts` `period`, 사용자 결정으로 통일). 시각은 어느 화면의 기간 표시에도 없다 (마감 시각 "23:59"를 따로 보여주는 곳은 예외).
- **테스트:** spec 고정값은 api.md 형태(`10-01T00:00` / `11-01T00:00`)다. 화면 spec에 "11월 1일"·"00:00"이 없어야 한다는 검사가 있다. 옛 inclusive 고정값(`10-31T23:59:59`)으로 되돌리면 raw `closes_at` 버그를 못 잡는다.

## 디자인 규칙

- 서비스 이름은 **OTUS**. 이미지의 "42 Support"는 임시 이름. 이름·로고·라우트 타이틀은 `shared/core/brand.ts`에서 온다. `grep -rn "Support\|SUPPORT" frontend/src shared`는 `brand.ts` 주석만 나와야 한다 (`grep -r`은 `src/shared` 링크를 따라가지 않으니 `shared`를 따로 넣는다). "42 계정으로 로그인" 같은 학교 "42"는 그대로.
- `docs/design/final/`이 색·타입·간격·레이아웃·문구의 기준. `wireframe/`은 흐름(화면 순서, 정보)만. 다르면 final이 이긴다. final에 없는 요소는 만들지 말고 묻는다.
  - 2일차부터 새 화면·새 상태(시간 요건 등)는 Figma 없이 토큰·기존 컴포넌트로 바로 만든다 (사용자 결정).
- **숨김(비활성 아님, 자리도 채우지 않는다):** "도움말 보기" 링크(카드는 3일차에 보이게 했고 링크는 `HELP_URL`이 빈 문자열인 동안 없다), "서류 준비 도움말 →", "제출 대상 안내", "대상 확인 요청", U01 "운영팀에 문의하기", 모든 "미리보기", "접수 번호", "개명 정보 제출", "변경 요청 내역 보기"(이력 화면 자신).
- 활성 메뉴는 연한 민트 (`U03-home-due.png`의 짙은 청록은 무시). 보완 제출 화면은 `/submit`이므로 메뉴 "서류 제출".
- 배지 문구: enum은 api.md, 화면 문구는 final. 매핑은 `shared/ui/status-badge.ts`의 `BADGE_LABELS` (`pending_review` → "검토 중"). `STATUS_LABELS`(`shared/core/api-types.ts`)는 api.md 그대로. 월별 카드의 배지는 보완까지 포함한 월 최신 상태.
- 업로드 완료 행은 민트 테두리 + 체크 (`mode="upload"`), 이력은 흰 행 (`mode="view"`).
- 날짜·D-day·접수 여부는 서버 값. 프런트에서 KST를 계산하지 않는다 (`lastMoment()`의 표시용 1초 빼기만 예외).

## 테스트 계정 (dev DB)

**사용자 결정: 정리 SQL을 실행하지 않는다.** 테스트 데이터는 그대로 둔다.

- `dongmin`: 지난달 최초 4종 승인, 이번 달 월별 `pending_review`(2026-10-17 20:06 KST 제출, 2026-10-18 확인), **승인된 계좌(카카오뱅크 •••• 1234, `통장사본_동민.pdf`)가 있는 데모 계정**. 이 상태를 지킨다. 시간 요건은 이번 달 0시간(행이 없어도 항상 준다).
- `seoyeon`: 지난달 최초 승인 + 이번 달 월별 `revision_requested`. 보완 제출 **draft**가 하나 있을 수 있다 (목록엔 안 보임).
- 검증 유저 `s58014894`, `h78658689`, `u04b*`/`u04c*`/`u04d*`, `u06d9vw4o7`, `cp1u2686688`, `uicheck*`, `origincheck`: 10월 최초(`pending_review`) 등이 남아 있다. `u06d9vw4o7`는 승인·반려·취소 계좌 요청이 있다. `dongmin_old`는 seed 때문에 이름을 바꾼 옛 계정.
- 새 흐름 테스트는 **새 데모 유저**로 (`/login?demo=<새 login>`). 계좌 변경은 사용자당 24시간 5회 제한이고, 최초 4종을 먼저 내야 `/settings`가 열린다.

## R 확인 사항 (@DavidLee18, 통합 목록)

1. **재검토 요청 시각·검토자:** api.md에 시간이 없다 (final은 "09.21 10:32 보완 요청"). `reviewed_at`/검토자 이름을 줄 건가? 지금은 시간 없음, "운영 담당자" 고정 문구.
2. **이벤트·이력 목록 API:** 없음 (2026-10-18에도 `api.md`에 없다). "검토 기록"은 최신 요청과 첫 제출만. 취업 변경 이력과 모든 계좌 요청(승인·취소 포함, 종류 포함)의 목록도 같은 질문.
3. **알림: API는 있는데 대부분의 `kind`를 서버가 만들지 않는다 (벨 전환이 막힌 이유).** `api.md`의 `GET /api/notifications`·`unread-count`·읽음 POST는 있다. 하지만 `notify_once` 호출은 `backend/src/routes/time_requirements.rs` 두 곳뿐이라 서버가 만드는 것은 `hours_projected`와 `time_requirement_decided`뿐이다 (dev DB의 `notifications`도 비어 있었다). **`submission_period_opened`·`submission_reminder`·`submission_revision_requested`·`submission_approved`·`bank_account_approved`·`bank_account_rejected`·`final_decided`는 어디서도 만들지 않는다** (`dev.rs`의 상태 변경·계좌 승인 dev API도 알림을 안 만든다). 지금 벨을 서버 알림으로 바꾸면 접수 시작·보완 요청·승인·계좌 결과 알림이 사라진다. 물어볼 것: (a) 위 kind를 만들 건가? 특히 이번 달 `submission_period_opened`(접수 시작, 취업 중 교육생 제외 여부)와 dev 상태 변경·계좌 승인 시 알림, (b) 생성 시점. 사용자 결정: 클라이언트 합성 알림과 `otus.notice.read:*` localStorage 읽음 코드는 서버가 위 kind를 만들게 된 뒤에 **완전히 제거**한다 (지금은 안 지움).
4. **같은 달 initial과 monthly:** 백엔드는 허용(`POST /api/submissions`는 한 달 두 번째 monthly만 막음), 프런트는 막지 않는다. initial에 이미 그 달 고용보험가입내역서가 있어 실제로는 중복이다. 의도된 건가?
5. ~~**`initial`의 `revision_requested`**~~ **해결:** `/submit/initial`이 처리한다 (`995309f`). 실제 백엔드로 로컬 확인 완료 (2026-10-17, `e2e/revision.ts`, `docs/api-proposal-admin.md` 질문 12).
6. **지난 달 주기:** `GET /api/cycles/current`는 이번 달만 준다. 다른 달의 보완은 마감 시각을 못 보여준다 (숨김). `GET /api/cycles?month=` 계획이 있나?
7. **옛 21일 기본값 잔재:** 백엔드는 이미 한 달 전체로 바뀌었다 (마이그레이션 `2026-10-17-000000-0000_cycles_whole_kst_month`, `seed.rs`, `kst::month_window`). 루트 `CLAUDE.md:236` ("Submission period (PRD): Default is the 21st 09:00 …")만 옛 문장이다. 프런트의 예시는 2일차에 고쳤다. **루트 `CLAUDE.md`는 건드리지 않는다** (사용자 지시). 고칠지는 R이 정한다.
8. **계좌:** PUT에 예금주 필드가 없다 (지금 `display_name` 읽기 전용, 서버로 안 보냄). 전체 계좌번호는 읽을 수 없어서 은행만 바꿔도 번호를 다시 입력해야 한다 (은행만 변경 요청이 필요한가?). PUT에 idempotency key가 없다 (응답이 유실되면 pending이 안 보임).
9. **개명·본인 정보 변경 API:** 없음 (화면에서 숨김).
10. **시간 요건 조회 API·알림 API 없음.** FE 제안서: `docs/api-proposal-eligibility.md` (enum, 응답 예시, dev 판정 API, R 질문 3개). R이 합의해 `api.md`에 옮기면 FE가 연결한다.

## Gotchas

**Angular / 코드**

- `provideHttpClient`에 **`withXhr()` 필수, `withFetch()` 금지.** Angular 22 기본 fetch 백엔드는 업로드 진행률이 없다. 브라우저 검증용 mock은 **XHR을 패치**한다 (`XMLHttpRequest.prototype.open`). `window.fetch` 패치는 HttpClient 요청에 안 먹는다 (예외: 검증 스크립트가 직접 부르는 fetch).
- API는 **상대 `/api/...` URL만**. Angular는 상대 URL에만 `X-XSRF-TOKEN`을 붙인다.
- 백엔드 Origin 체크는 `APP_ORIGINS`(없으면 `APP_ORIGIN`)에 있는 origin만 허용한다. 로컬 `backend/.env`에는 `APP_ORIGINS=http://localhost:4200,http://localhost:4201`(학생·관리자 dev)을 넣었다. 다른 포트로 dev 서버를 띄우면 그 origin을 넣거나, 검증용은 repo 밖 프록시에서 `Origin: http://localhost:4200`로 바꾼다. `admin-front/proxy.conf.mjs`의 덮어쓰기는 없앴다.
- 로그인 후 `AuthService.setMe(...)`나 `refresh()`로 `me`를 갱신한다 (최초 제출 후 `initial_submitted`).
- 테스트는 **happy-dom** (jsdom은 Bun에서 죽는다). **bun/bunx만 사용, npm/npx 금지** (`package-lock.json`이 생긴다).
- dev 전용 라우트 조건은 `typeof ngDevMode === 'undefined' || ngDevMode`. `isDevMode()`는 tree-shake가 안 되고, 맨 `ngDevMode`는 dev에서 undefined라 라우트가 등록되지 않는다.
- 사용자가 띄운 `ng serve`(:4200)가 파일 변경을 못 따라가는 일이 있다 (옛 `main.js` 제공). 안 보이면 재시작. 검증은 새 `ng serve --port 4300 --proxy-config …`로.
- 컴포넌트 CSS 예산 4 kB 때문에 큰 화면은 컴포넌트를 쪼갠다 (예산은 그대로).
- 포맷: `bunx prettier --list-different`를 건드린 파일에만. 이미 안 맞는 파일(`pages/history.{ts,html}`, `pages/home-submitted.{css,html}`, `pages/account-review.spec.ts`, `ui/upload-slot.spec.ts`, 2026-10-17 `bunx prettier --check src/app`로 확인)을 관련 없는 커밋에서 정리하지 않는다.
- macOS `sed -i`는 `-i ''`. 여러 줄 수정은 Edit 도구나 python.
- **`shared/`를 고치면 두 앱 모두** `bun run build`와 `bun run test -- --watch=false`를 돌린다. `shared/`에는 API 호출, 서비스, 앱 코드 import를 두지 않는다. 관리자가 안 쓰는 걸 넣지 않는다.
- `shared/.prettierrc`는 앱과 같은 설정이다. 실제 경로(`shared/...`)로 열린 파일에도 같은 포맷이 적용되게 하려고 두었다. 지우면 prettier 기본값(큰따옴표, 80자)이 된다.
- `angular.json`이나 tsconfig를 바꾸면 떠 있는 `ng serve`를 재시작해야 한다 (파일 변경만 따라간다).

**백엔드·DB**

- 로컬 실행: `make dev-db` → `backend/`에서 `cargo run` → `frontend/`에서 `bun run start`. `cycles` 행이 없으면 업로드·제출이 422 `CYCLE_CLOSED` (SQL은 `frontend/README.md`).
- **`CC=/usr/bin/clang CXX=/usr/bin/clang++ make seed`** (루트에서). 이 Mac은 PATH의 `x86_64-elf-gcc` 때문에 `aws-lc-sys` 빌드가 실패한다.
- **seed는 기존 데모 유저를 덮지 않는다.** 새 `dongmin`이 필요하면 `UPDATE users SET login='dongmin_old' WHERE login='dongmin' AND is_demo;` 후 seed (이미 한 번 했다).
- **정리 SQL (사용자 승인 없이는 실행 금지, 지금은 실행하지 않기로 결정):** 한 트랜잭션에서 임시 테이블로 submission id를 고르고 `submission_events` → `submission_files` → `submissions` 순으로 DELETE. **`UPDATE submission_files SET superseded_by = NULL`은 하지 않는다** (현재 파일이 여러 개가 되어 `submission_files_current_idx`가 깨진다). `superseded_by`는 DEFERRABLE이라 파일을 바로 지워도 된다. `file_access_log`는 append-only라 건드리지 않는다. 실행 전에 SQL을 사용자에게 보여준다. 실행은 `podman exec -i otus-dev-db psql -U otus -d otus`.
- DB 확인 (비밀번호 불필요, `backend/.env`를 읽지 않음): `podman exec otus-dev-db sh -c 'psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-$POSTGRES_USER}" -c "…"'`.
- **기본 브랜치는 `back-jaehylee`** (`main` 없음). `git pull`에 `main`을 기대하지 않는다. 푸시는 사용자가 요청할 때만.
- **dev DB의 `cycles` 행은 한 달 전체다** (2026-10-17 확인): 2026-09, 2026-10 두 행. 2026-10은 10/01 00:00 ~ 11/01 00:00 KST(미포함). 11월이 되면 11월 행이 없어 `CYCLE_CLOSED`(`not_set`)가 되니, `CC=/usr/bin/clang CXX=/usr/bin/clang++ make seed`(이번 달·지난달 행을 만든다)를 다시 돌리거나 행을 직접 넣는다.
- `backend/.env`는 실제 42 시크릿이 있다. 값을 출력·복사·grep하지 않는다 (마스킹하려면 `sed`). 쿠키는 포트를 구분하지 않아서 pod(8443)와 dev(4200) 세션이 `__Host-session`을 덮어쓴다. 하나에서 로그아웃하고 다른 걸 테스트.
- 42 OAuth(dev): `.env.example` 기본값은 `http://localhost:4200`. 실제 42 로그인은 사용자가 브라우저에서 해야 하고 **아직 결과를 못 받았다** (콜백 → `/home` → 새로고침 → 로그아웃). 요청 시 `/login?error=<code>`와 백엔드 로그를 본다. Safari는 `Secure` 쿠키 때문에 pod(`https://localhost:8443`)에서.

**브라우저 검증 레시피**

- 사용자의 Chrome을 건드리지 않는다. `e2e/chrome.sh`를 복사해 `BASE_URL=http://localhost:4200`(또는 4300) `E2E_HEADLESS=1`로 쓰면 임시 Chrome for Testing + W3C WebDriver 스크립트가 돈다. 포트는 OS가 고른다 (4444는 I2P가 쓴다).
- 어떤 요청이 나갔는지는 `performance.getEntriesByType('resource')` (`responseStatus` 포함). 모든 요청이 같은 origin의 `/api/*`여야 한다. **로그인 전 `/api/me`의 401은 정상이다** (guard). "모든 응답이 2xx"를 요구하지 말고 그 한 요청만 허용한다.
- chromedriver `POST /session/{id}/goog/cdp/execute`로 CDP: `Network.emulateNetworkConditions`(오프라인, `uploadThroughput`로 진행률), `Page.addScriptToEvaluateOnNewDocument`(console 래핑해서 민감 값 로그 확인, API 응답 재작성). 숨겨진 `<input type=file>`은 `/element/{id}/value`에 로컬 경로. 드롭은 `DataTransfer` + `DragEvent('drop')`. 페이지 안에서 `X-XSRF-TOKEN`(쿠키 `XSRF-TOKEN`)을 읽어 `fetch`로 dev API를 불러 유저를 준비한다.
- **2일차에 쓴 방식 (잘 동작함):**
  - `ng serve --port 4300 --proxy-config <scratchpad>/proxy.json`을 띄운다. proxy는 `{"/api": {"target": "http://127.0.0.1:3000", "secure": false, "headers": {"Origin": "http://localhost:4200"}}}`이다.
  - `e2e/chrome.sh`를 scratchpad로 복사하고 마지막 줄의 `bun e2e/run.ts`를 내 스크립트 경로로 바꾼다.
  - 스크립트는 fetch로 W3C WebDriver를 직접 부른다 (`/session`, `/url`, `/execute/sync`, `/execute/async`, `/screenshot`).
  - 로그인은 `/login?demo=<login>`으로 가서 "42 계정으로 로그인" 버튼을 누른다. 로그아웃은 "로그아웃" 버튼이다.
  - 스크립트는 세션 scratchpad에 있어서 다음 세션에는 없다. 새로 쓴다.
- **함정:**
  - `<dt>`/`<dd>` 쌍의 `textContent`는 공백 없이 붙는다 ("마감일10월 31일 23:59"). `.aside dl > div`에서 dt와 dd를 따로 읽는다.
  - Resource Timing의 `responseStatus` 0은 이동할 때 취소된 요청이다. 벨이 NavigationEnd마다 `switchMap`으로 다시 부른다. 실패로 세지 말고 4xx/5xx만 센다.
  - `dongmin`과 `seoyeon`은 이번 달 draft(monthly, supplement)가 이미 있다. 그래서 `/submit`을 열어도 새 행이 생기지 않는다 (POST가 기존 draft를 돌려준다). 화면 확인은 이 둘로 하면 DB가 바뀌지 않는다.
  - 검증 범위를 요청보다 넓게 잡으면 엉뚱한 FAIL이 난다 (예: 페이지 전체에서 "00:00" 검색). 실패하면 어느 요소인지부터 본다.

## 배포 URL 체크리스트

- `APP_ORIGIN` = 배포 origin (아니면 모든 POST 403: finalize, 업로드, 로그아웃, 계좌 PUT).
- `https://`에서만 `__Host-session`(Secure)이 동작한다. 새로고침 후 세션 유지, XSRF 헤더 전송 확인.
- 42 redirect URI는 `https://<host>/api/auth/42/callback`와 정확히 일치, 캠퍼스 69. `DEMO_LOGIN_ENABLED`는 운영에서 false지만 데모 배포에선 켜고 `DEMO_LOGIN_ALLOW_PUBLIC` 확인.
- CSP: `/home`, `/history`, `/settings`, 검토 화면 콘솔에 위반이 없어야 한다 (벨·select는 인라인 스크립트/외부 에셋 없음). 프로덕션 빌드를 Caddy로 서빙해서 확인한 적은 아직 없다.
- 접수 기간: `GET /api/cycles/current`가 1일 00:00 ~ 다음 달 1일 00:00(미포함)인지. 오래된 행이면 화면에 옛 날짜가 나온다. `cycles` 행이 없으면 미제출 카드·벨 알림이 없고 업로드는 잠긴다.
- 벨의 localStorage는 브라우저/프로필별 (시크릿 창은 매번 안 읽음, 의도된 동작). 다른 유저는 다른 키.
- 한도: 계좌 변경 24시간 5회, 업로드 연속 20회 후 30초 1회, 22 MB 초과는 Caddy의 JSON 없는 413 (`errorMessage`가 처리). 서버 메시지가 그대로 보이는지.
- 아직 검증 안 한 것: Safari, pod(`https://localhost:8443`), 실제 42 OAuth 로그인, 프로덕션 빌드의 CSP.

## 다음 할 일

**R이 알림 kind를 만들게 된 뒤에 (위 R 확인 사항 3번, 이 순서로):**
1. `api.models.ts`·`api.service.ts`에 알림 타입(`id`, `kind`, `created_at`, `read_at`, `data`, `next_before`)과 `notifications`·`unreadCount`·`markRead`·`markAllRead` 호출 추가 (+ spec).
2. `layout/notifications.*`를 서버로 전환: 클라이언트 합성(접수 기간·계좌·보완 요청)과 localStorage 읽음(`otus.notice.read:*`) 코드를 **전부 제거**, `kind`별 문구(FE가 쓴다, `data`의 `month`·`tier`·`submission_id`)와 이동(`submission_revision_requested` → `/submit`, `bank_account_*` → `/settings`, 시간 요건 → `/home`), 읽음은 `POST /{id}/read`·`read-all`, 배지는 `unread-count`.
3. 취업 중 교육생에게 `submission_reminder`·`submission_period_opened`가 안 가는지 R 구현을 확인 (홈·이력의 시간 요건 카드는 FE가 `employed`로 숨기지만 알림은 서버 몫).
4. 회귀: 새 데모 유저로 체크포인트 2 흐름 + 벨이 같이 맞는지.

**그 전에 할 수 있는 것:**
- 3일차 후반 변경(색상, 홈 카드 배치, 취업 안내)을 브라우저로 확인하고, pod(`make pod-up`)에서 PDF 미리보기가 실제로 뜨는지 확인 (`frame-src blob:` CSP). 그 다음 `front-taebkim`을 push.
- `home-due`에도 취업 상태 안내를 넣을지 사용자에게 확인.
- e2e `run.ts`의 `dongmin` due 기대 정리 (위 3일차 검증).
- 시간 요건 상태를 운영 pod(`https://localhost:8443`)와 Safari에서 확인 (아직 로컬 dev만 확인).

**관리자 앱은 새 세션에서** (`admin-front/HANDOFF.md`의 "다음 할 일", `/users`·A18 연결, staff 실계정 확인, proxy Origin 덮어쓰기 제거, 배포 통합은 끝남).

**사용자 답을 기다리는 것:**
- 운영에서 관리자가 로그인하는 방법 (42 OAuth는 쓰지 않기로 했다).
