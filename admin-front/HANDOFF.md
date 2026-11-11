# HANDOFF — OTUS admin frontend (branch `front-taebkim`)

## 2026-10-18 알림 발송 대상에 취업자 추가

- 대상 체크박스에 `취업자`를 전체 학생 앞에 추가했다. 현재 `employed=true`인 학생을 최초 등록·서류 제출·시간 집계와 관계없이 조회한다. 미제출·시간 구간은 기존처럼 최초 등록을 마친 미취업 학생을 대상으로 한다. 여러 조건은 합집합이며 전체 학생을 고르면 다른 체크가 해제된다.
- 직접 작성 API의 `audiences`에 `employed`를 추가했다. 명단·발송·SMTP 작업·재시도에서 같은 조건을 사용하고, 취업 상태가 바뀌면 다른 선택 조건에도 해당하는지 다시 확인한다. 기존 `eligible` 호환을 포함해 최대 7개 조건을 받는다. 기존 단일 `audience=employed` 요청은 지원하지 않는다.
- 마이그레이션 `2026-10-18-090000-0000_notice_employed`는 저장 조건 제약을 확장한다. 취업자 대상으로 발송한 기록이 있으면 되돌리기를 거부해 불변 발송 이력을 보존한다. 컬럼 변경이 없어 생성 스키마는 동일하다.
- 검증: 관리자 프로덕션 빌드·알림 화면 16개 테스트, Rust 103개 테스트·clippy 경고 0·마이그레이션/스키마 비교 및 격리 DB/SMTP 통합 검사 통과. 취업자 중 최초 등록 전·미집계 학생 포함, 직원 제외, 조건 합집합·중복 제거, 동일 인원 상태 교체 시 409, 앱/이메일 전달, 취업 상태 변경 후 재시도 제외와 앱 알림 중복 방지를 확인했다.
- 로컬 VM에 이미지와 마이그레이션을 반영했다. 실제 관리자 HTML·번들에서 취업자 선택지를 확인했고 API·스캐너 정상 상태 및 관리자 Origin 설정을 CLI로 확인했다. 실제 학생에게는 발송하지 않았으며 브라우저 확인은 사용자가 맡는다.

## 2026-10-18 로컬 관리자 요청 403 수정

- 실행 중인 VM에서 `APP_ORIGINS=https://localhost:8443`만 설정되어 관리자 `https://admin.localhost:8443`의 POST가 `FORBIDDEN`으로 거절되는 것을 재현했다. 로컬 `deploy/.env`에 `ADMIN_SITE_ADDRESS`가 없으면 렌더러가 Caddy의 기본 관리자 주소를 허용 목록에서 빠뜨리는 문제였다.
- `deploy/start-podman.sh`는 로컬 기본 주소에서 관리자 주소도 자동 구성한다. `APP_ORIGINS`를 직접 지정하면서 설정된 관리자 주소를 누락하면 컨테이너 교체 전 오류로 중단한다. 공개 배포에 관리자 주소를 설정하지 않은 경우 localhost를 추가하지 않는다. 역할·CSRF 검사는 그대로 적용한다.
- 설정 렌더링 12개 테스트와 셸 문법 검사 통과. 기존 로컬 VM에 스크립트로 반영했고 API·스캐너 정상 상태를 확인했다. 로그인 없는 관리자/학생 POST는 주소 차단 403 대신 인증 필요 401, 빈 login은 입력 검증 400이며 외부/누락 Origin은 계속 403이다. 계정 생성·실제 알림 발송 없이 확인했다. 브라우저 검증은 사용자가 맡는다.

## 2026-10-18 알림 보내기 이전·다음 단계 이동

- `알림 작성 → 채널·대상 선택 → 최종 확인`을 각각 별도 화면으로 구성했다. 상단에 현재 단계를 강조하고 하단에는 이전(왼쪽)·다음(오른쪽)을 같은 위치에 표시한다. 첫 단계의 이전은 비활성화하고 마지막 단계에서는 다음 대신 `최종 발송하기`를 표시한다.
- 최종 확인 팝업을 화면으로 바꿔 기준 월·채널·조건·인원·제목·내용을 확인한다. 이전으로 돌아가도 작성 내용과 체크박스를 유지한다. 작성 화면에서 다시 다음으로 이동하면 명단을 재조회하며, 뒤로 이동할 때 진행 중인 조회를 취소한다. 단계가 바뀌면 단계 제목으로 키보드 포커스를 옮긴다.
- 제목·내용 미입력, 빈 대상·채널, 명단 조회 중에는 다음으로 진행할 수 없다. 발송 중이거나 결과가 불확실하면 이전을 막고 기존 멱등성 키로 결과를 확인한다. 대상 변경 오류는 선택 단계로 돌아가 다시 확인하도록 유지한다.
- 검증: 관리자 프로덕션 빌드와 알림 화면 15개 테스트 통과. 단계 왕복 시 값 유지, 수정 내용과 새 명단으로 발송, 진행 중 조회 취소, 최종 버튼 전 발송 없음, 중복 요청 방지와 오류 재시도를 확인했다. API·백엔드 변경과 배포는 없으며 브라우저 검증은 기존 사용자 지시대로 사용자가 맡는다.

## 2026-10-18 발송 대상 다섯 가지로 정리

- 대상 체크박스는 `미제출 / 40시간 미만 / 40~80시간 구간 / 80시간 이상 / 전체 학생` 순서로 표시한다. 별도 `수령 대상자` 항목을 제거하고 명단과 최종 확인에도 같은 표시명을 사용한다. 40~80시간 구간은 40시간 이상 80시간 미만이다.
- 여러 조건의 중복 제거와 전체 학생 선택 동작은 유지한다. 기존 발송 기록과 재시도 호환을 위해 백엔드의 `eligible` 지원은 유지하며 관리자 화면에는 노출하지 않는다.
- 검증: 관리자 프로덕션 빌드와 알림 화면 13개 테스트 통과. 다섯 선택지의 표시 순서, 여러 조건의 명단 조회·발송, 전체 선택 시 다른 체크 해제를 확인했다. 배포 전이며 브라우저 확인은 기존 사용자 지시대로 사용자가 맡는다.

## 2026-10-18 일괄 다운로드 CSV 학습 시간

- ZIP의 `제출목록.csv` 마지막 열에 `학습 시간`을 추가했다. 해당 학생의 모든 PDF 행에 다운로드 대상 월의 학습 시간 구간을 기록한다. 기존과 같은 기준으로 40시간 미만 `0`, 40시간 이상 80시간 미만 `40`, 80시간 이상 `80`이며 미집계·`on_hold`는 `확인 불가`다.
- 선택한 사용자들의 해당 월 저장 집계를 한 번에 조회해 ZIP 생성 요청의 스냅샷에 저장한다. 생성 후 집계가 바뀌어도 같은 ZIP의 값은 유지되고 새 ZIP에는 갱신된 값이 들어간다. 기존 스냅샷에 필드가 없어도 읽을 수 있다. DB 마이그레이션이나 관리자 화면 변경은 필요하지 않다.
- 기존 CSV의 앞 6개 열·UTF-8 BOM·CRLF·수식 주입 방지는 유지한다. 배포 적용 전이다.
- 검증: Rust 101개 테스트·clippy 경고 0 통과. 격리 DB에서 9명·PDF 33개의 실제 ZIP/CSV를 확인했고 40/80시간 경계, 미집계·보류, 다른 월 집계 제외, 같은 작업의 값 고정과 새 작업의 갱신 반영, 재다운로드까지 통과했다.

## 2026-10-18 제목·내용 작성 후 채널·대상 지정

- `알림 보내기`는 제목·내용 작성 → 별도 채널·대상 선택 화면 → 명단 및 최종 확인 → 발송 순서다. 제목은 120자, 본문은 5,000자까지 입력하며 앱 알림·이메일 모두 원문을 전달한다. 작성 단계에서는 대상 조회나 발송을 하지 않는다.
- 채널은 앱 내부 알림·이메일 체크박스이며 둘 다 선택할 수 있다. 대상은 미제출 / 수령 대상자(40시간 이상) / 40시간 미만 / 40~80시간 / 80시간 이상 / 전체 학생 체크박스다. 여러 조건의 합집합을 사용자 ID로 중복 제거한다. 전체를 선택하면 다른 체크를 해제하며, 최초 등록 전·취업 중인 학생도 포함한다. 나머지 조건은 최초 등록 완료·미취업 학생 기준이고 수령 대상자는 최종 지급 확정과 별개다.
- 조건 변경 시 이전 조회를 취소하고 명단을 비운 뒤 새 명단을 보여준다. 빈 대상·빈 채널·조회 중에는 확인 버튼을 비활성화한다. 명단에서 이름·42 아이디·취업/제출 상태·시간 구간·집계 시각·선택 시 이메일을 확인한다. 최종 확인에는 원문·채널·조건·인원을 표시한다.
- 기존 GET/POST 경로에 `audiences`와 POST의 `title/body`를 추가했다. 직접 작성 알림은 과거 월과 마감 후 미제출자에게도 발송할 수 있다. 기존 단일 `audience` 요청의 자동 문구·마감 제한·멱등 해시는 유지한다. 응답 유실에는 정확히 같은 본문과 키로 결과를 조회하고, 대상 변경 409에는 명단을 새로 읽은 뒤 다시 명시적으로 확인한다.
- `2026-10-18-080000-0000_notice_composer`는 불변 발송 기록의 제목·본문·대상 목록과 `admin_notice` 종류를 추가한다. Diesel CLI로 스키마를 재생성했다. SMTP 작업과 재시도는 저장한 조건의 합집합을 다시 검증하고 저장한 원문을 사용한다. 학생 알림은 일반 텍스트로 표시하며 줄바꿈·중복 문장도 보존한다.
- 검증: 두 앱 프로덕션 빌드 통과. 관리자 전체 234개 중 폼 반영 대기 테스트 2곳을 보완한 뒤 알림 화면 13개 재검증 통과(나머지 221개는 전체 실행에서 통과). 학생 전체 165개 통과 후 추가한 원문 DOM 검사와 최종 스타일 변경을 포함해 알림 관련 30개 재검증 통과(최종 166개 범위). Rust 100개·clippy 경고 0·마이그레이션/스키마 비교·격리 DB/SMTP 통합 검사 통과. 직접 작성 원문, 여러 조건 합집합/중복 제거, 전체 학생, 권한/입력 검증, 대상 변경, 멱등 재요청, 저장한 내용으로 이메일 재시도를 확인했다.
- 배포 이미지 및 운영 DB에는 적용하지 않았다. 기존 사용자 지시대로 CLI에서 검증하고 브라우저는 실행하지 않는다.

## 2026-10-18 발송 채널 선택

- `알림 보내기`에서 앱 내부 알림 / 이메일 / 앱 내부 알림·이메일을 선택한다. 기본 선택은 앱 내부 알림이다. SMTP 미설정이면 이메일 선택지를 비활성화하며, 확인·발송·응답 미확인 상태에는 채널 변경을 막는다.
- POST 본문의 `channel`은 `service|email|both`. 기존 요청과 기록은 `both`로 유지한다. `both` 기본값을 요청 해시 직렬화에서 생략해 기존 멱등 응답을 재현한다. 채널이 다른 동일 키 요청은 409다.
- 앱 전용은 이메일 주소·오류가 없고 `email_status=not_requested`, 시도 0으로 기록하며 작업자가 발송하지 않는다. 이메일 전용은 `notifications` 행을 만들지 않고 `notification_id=null`로 저장한다. 재시도도 이메일만 처리한다. 결과 화면은 선택된 채널만 표시하며 이메일 전용에는 앱 알림 전달 성공 문구를 보여주지 않는다.
- `2026-10-18-070000-0000_notice_channels` 마이그레이션을 추가했고 Diesel CLI로 스키마를 재생성했다. 배포 이미지와 운영 DB에는 아직 적용하지 않았다. 브라우저 검증은 기존 사용자 지시대로 생략한다.
- 검증: 관리자 프로덕션 빌드, 전체 테스트 실행 후 수정한 안내 화면·문구 22개 재검증 통과(총 236개 테스트 범위). Rust 100개 테스트·clippy 경고 0·스키마 비교·격리 DB/SMTP 통합 검사 통과. 앱 전용의 메일 발송/실패 없음, 이메일 전용의 앱 알림 없음, 둘 다 발송, 채널 변경 멱등 키 거부, 이메일 전용 실패 재시도와 알림 개수 유지까지 확인했다.


## 2026-10-18 알림 보내기 · 대상 선택

- 운영 메뉴와 페이지 제목을 `알림 보내기`로 변경했다. 대상은 `unsubmitted`(미제출), `under_40`, `hours_40_80`, `at_least_80` 중 하나를 선택한다. 시간 구간은 월별 서류 제출 여부와 무관하며 최초 제출 완료·미취업 학생을 대상으로 한다.
- 기존 `/api/admin/notices/submission-reminder` GET/POST에 `audience`를 추가했다(생략 시 미제출). 시간 구간은 최근 저장 집계로 선정하고, 미집계·판정 보류는 제외 인원을 표시한다. 대상별 집계 시각을 표에 표시한다. 미제출은 열린 접수 기간에서만, 시간 구간은 현재·과거 월에 접수 마감과 무관하게 보낼 수 있다.
- 확인 화면에는 선택한 조건과 알림 내용이 나온다. 대상 변경·월 변경 시 이전 미리보기 요청을 취소한다. 발송 결과 미확인 상태에는 조건 변경을 막고 같은 본문·멱등 키로 확인한다. 이메일 처리·재시도는 최초 선택한 audience의 현재 조건을 재검증한다.
- `2026-10-18-060000-0000_notice_audiences` 마이그레이션이 audience와 새 `study_hours_notice` kind를 추가한다. `schema.rs`는 격리 DB에서 Diesel CLI로 재생성했다. 기존 안내는 `unsubmitted`이며 기존 멱등 요청의 해시 형식도 유지한다.
- 백엔드 검증: Rust 99개 테스트, clippy 경고 0, Diesel 스키마 일치, 격리 PostgreSQL·로컬 SMTP 통합 검사 통과. 40/80시간 경계, 제출 완료자 포함, 미집계·취업자 제외, 동일 인원 수의 대상 교체, 멱등 재요청, 구간 변경 후 재시도 제외, 과거 월·권한 제한을 확인했다. 기존 제출·자료함·접수 기간 검사와 `/api/me` 학습 시간 검사도 통과했다.
- 관리자 프로덕션 빌드 통과. 전체 235개 테스트 중 메뉴명 기대치 2개를 갱신한 뒤 해당 roles 6개 테스트를 재실행해 통과했다(나머지 229개도 전체 실행에서 통과). 브라우저는 기존 사용자 지시대로 실행하지 않았다. 배포 이미지 적용 전이다.


## 2026-10-18 앱 내부 알림 수신 연결

- 제출 안내 화면·발송 확인·결과에 발송 채널을 “앱 내부 알림”으로 명시하고 교육생 상단 알림 벨에서 확인할 수 있음을 안내한다. SMTP가 설정되면 이메일도 함께 전송하며 이메일 실패와 앱 알림 전달 결과는 별도로 표시한다.
- 교육생 앱이 기존 `/api/notifications` 목록·읽음 API에 연결되었다. 최초 등록 화면도 수신 가능하며 읽음 상태는 서버에 저장된다. 기존 제출 일정·계좌 자동 안내는 서버 생성이 모두 구현될 때까지 유지한다. 상세는 루트 `HANDOFF.md`의 최신 알림 항목을 참고한다.
- `scripts/admin-api-smoke.py`에 실제 발송→교육생 수신→개별/전체 읽음, 커서 조회, 재발송, 타인 접근 차단, 이메일 실패와 독립적인 수신 검사를 추가했고 격리 DB·로컬 SMTP에서 통과했다. 학생 172개·관리자 233개 테스트와 두 앱 프로덕션 빌드도 통과했다. 로컬 VM 반영 후 HTTP와 배포 번들 일치를 CLI로 확인했다. 브라우저 검증은 사용자가 맡는다.

## 2026-10-18 공통 조회 월과 제출 기간 편집

- 관리자 공통 상단에 조회 월 입력, 이전·다음 월, 이번 달 복귀를 추가했다. 서버의 현재 월을 기준으로 시작하며 선택한 월은 URL과 메뉴 이동에 유지한다. 대시보드·제출 내역·제출 안내는 월 변경 시 다시 조회하고 이전 요청을 취소한다. 자료함은 해당 월 경로로 이동하며, 서류 검토 중 월을 바꾸면 선택 월의 제출 목록으로 이동한다.
- `/periods`는 연도별 추가·수정 목록 대신 선택한 월의 접수 시작일·마감일 입력란과 저장 버튼을 바로 표시한다. KST 시각, 마감 시각 포함 처리, 버전 충돌 재조회, 변경 이력, 현재·미래 월 편집 및 지난달·회계 담당자 조회 전용 규칙을 유지한다. 저장 중 상단 월 변경을 막고 URL이 별도로 바뀌어도 이전 저장 응답이 새 월 화면을 덮지 않는다.
- 학생 앱·공유 코드·백엔드·API 계약은 변경하지 않았다. 검증은 사용자 요청에 따라 코드 검토와 CLI 빌드·테스트만 진행하며 브라우저 확인은 사용자가 맡는다. 최초 구현 후에는 실행 이미지를 교체하지 않았지만, 후속 확인에서 로컬 VM의 관리자 HTML 해시와 기간·상단 월 선택 번들이 최종 빌드와 일치함을 확인했다.
- CLI 검증: 관리자 프로덕션 빌드와 32개 파일·233개 테스트 통과. 월 전환에 따른 재조회·이전 요청 취소, 연도 이동, 기간 저장 중 월 변경 제한과 URL 변경, 버전 충돌, 지난달·회계 권한 제한을 확인했다.
- 실행 중인 `https://admin.localhost:8443` API도 CLI로 확인했다. 2026-10 기간에서 `opsdemo`·`admindemo`는 `can_manage: true`이며 현재 값 그대로 PUT하면 200, `accountdemo`는 `can_manage: false`이며 PUT은 403이다. 검증 전후 접수 날짜·버전·변경 이력이 동일하며 실제 기간은 바꾸지 않았다. 회계 계정으로는 조회만 가능하다.

## 2026-10-18 관리자 로직·API 문서 점검

- 보완 승인 시 상위 제출에 전파된 이벤트가 현재 사용자 프로필을 읽어 담당자 이름·역할 변경에 따라 과거 이력이 달라지는 문제를 재현했다. `admin_review_event_links`로 원래 결정의 처리자 스냅샷을 참조한다. 신규 마이그레이션 `2026-10-18-040000-0000`은 기존 기록 중 결정·조상 관계·시각·담당자·전파 메모가 일치하는 이력만 연결한다. 당시 스냅샷이 없는 과거/데모 기록은 추정하지 않는다.
- 이메일 재시도가 변경된 login/도메인으로 수신 주소를 덮어쓰던 문제를 수정했다. 이미 확정된 주소가 달라지면 `skipped/recipient_changed`로 남겨 새 미리보기를 요구하고, SMTP 오류에도 기존 주소를 보존한다. 미리보기 지문에도 SMTP 설정 여부·수신 도메인을 포함한다.
- 공통 월 파서가 `2026-+1` 등 부호를 허용하던 문제를 수정했다. ASCII `YYYY-MM`만 받는다. 관리자 권한표, 원본 조회 404, 최초 제출 월의 제외 범위, 탐색 건수, 안내 집계·재시도·오류 코드, 자료함 조회 의미를 `api.md`에 보완했다. 루트 `CLAUDE.md`의 오래된 검토 API·접수 마감 설명도 바로잡았다.
- 검증: Rust 84개 테스트·Clippy·스키마 일치 검사 및 실제 관리자 API 6종 통합 검사 통과. 승인 이력의 프로필 변경·기존 DB 마이그레이션 복원, 주소가 바뀐 실패 수신자의 재발송 제외, 일반 실패 재시도·SMTP 전달, ZIP 파일 보존을 검증했다. 프론트엔드 코드는 변경하지 않았다.
- VM에 새 백엔드와 마이그레이션을 반영하고 Chromium `e2e/admin.ts` 전체를 통과했다. 로그인·보완 이력/PDF·사용자 이동·승인·최초 제출 월 중복 제외·재검토 요청·실제 ZIP 저장·안내 대상 조회를 확인했다. 실제 안내 발송은 하지 않았다.

## 2026-10-18 최초 제출 월의 중복 검토 제외

- 최초 4종은 해당 월의 고용보험 서류를 포함한다. 최초를 최종 제출한 달에는 관리자 월별 목록·대시보드·상태 필터·연속 검토·이전/다음 이동·남은 건수에서 최초 제출과 그 보완본만 표시한다. 같은 달의 별도 월별 제출과 그 보완본은 검토 대상에서 제외한다. 최초가 임시저장이거나 이전 달 제출이면 당월 월별 검토를 유지한다.
- 서버의 공통 검토 대상 조회 조건을 목록과 연속 검토에 적용했다. 기존 제출 상태·파일·보완 이력·자료함 ZIP은 보존하며, 자료함은 전체 제출을 조회한다. 학생 앱·공유 코드·DB 스키마 변경 없이 `api.md`에 조회 기준을 반영했다.
- 검증: Rust 83개 테스트·Clippy, 격리 DB의 실제 관리자 API 6종 통합 검사, 관리자 30개 파일·205개 테스트 및 프로덕션 빌드 통과. `scripts/admin-review-smoke.py`는 최초 임시저장/제출 완료, 이전 달 최초, 다단계 월별 보완본 제외, 상태 필터 및 이전/다음·남은 건수를 검증한다. ZIP 검사는 제외된 월별 원본까지 보존되는지 확인한다.
- VM 이미지를 재빌드·기동한 뒤 Chromium `e2e/admin.ts`를 통과했다. 같은 달의 최초·월별 제출을 가진 새 더미 교육생이 목록에는 최초 1건만 표시되고 연속 검토에 월별 제출이 포함되지 않는 것을 확인했다. 실제 승인·사용자 이동·PDF·보완 요청·ZIP 저장도 정상이다. 화면 캡처: `e2e/artifacts/admin/05-initial-month-only.png`.

## 2026-10-18 연속 검토 화면 전환 수정

- PDF가 로드된 뒤 승인 검토를 누르면 `PDFDocumentProxy.destroy is not a function`으로 Angular의 라우트 종료가 중단되어 본문이 비는 현상을 실제 Chromium에서 재현했다. pdf.js 6의 `PDFDocumentLoadingTask.destroy()`로 정리하고, 수기 인터페이스 대신 패키지 타입을 사용한다. 파일 전환·화면 종료 시 fetch를 취소하고 늦게 도착한 PDF 결과는 무시한다.
- 검토·승인 확인·처리 결과 화면 우측 상단에 `이전 사용자` / `다음 사용자` 버튼을 표시한다. 같은 월의 미처리 제출 순서로 이동하며 같은 사용자의 다른 제출은 건너뛴다. 대상이 없거나 저장 중이면 비활성화한다. 월 선택은 유지하며 새 사용자의 확인한 서류·보완 사유는 초기화한다. 이미 처리한 사용자는 대기 대상에서 빠진다.
- 이동 대상 조회에 실패해도 현재 서류와 승인 확인 화면은 표시한다. API 계약·학생 앱·공유 코드는 변경하지 않았다.
- 관리자 빌드 및 30개 파일·205개 테스트 통과. 배포한 VM에서 `e2e/review.ts`로 PDF 렌더링 완료 후 실제 버튼 클릭·연속 검토 시작·승인 확인·사용자 왕복·새 더미 제출 승인·완료 화면 이동을 검증했고 브라우저 런타임 오류가 없었다. VM 실행 시 `scripts/admin-ui-in-container.sh`에 `E2E_SCRIPT=e2e/review.ts`를 지정한다. 기존 대기 건을 이미 처리했어도 검증할 수 있도록 별도 더미 사용자 두 명을 준비한다.

## 2026-10-18 관리자 API 연결

아래 과거 기록의 “API 없음”, “placeholder”, “미리보기만 가능”은 현재 상태가 아니다. 백엔드 관리자 API 구현 후 실제 화면 연결을 마쳤다.

- `/`는 실제 월별 제출 데이터와 업무 바로가기를 표시한다. 아직 집계 API가 없는 통계나 시간 요건은 임의로 만들지 않는다.
- `/submissions`는 월·검색·상태·페이지 이동, 최초/월별 제출 구분과 보완 횟수를 제공한다. 검토 페이지는 상세·보완 이력·처리자/사유가 포함된 이벤트·이전/다음 미처리 건·실제 PDF에 연결했다.
- 승인/재검토 요청은 확인 버튼에서만 POST하고 서버 성공 후 완료 페이지로 이동한다. 완료 주소를 직접 열어도 실제 상태·이벤트가 없으면 성공으로 표시하지 않는다. 마감 이후나 접수 기간이 없는 달은 승인만 허용한다. 최초 4종은 모든 탭을 확인해야 승인할 수 있다. 저장 API가 없는 운영팀 메모는 실제 화면에서 숨긴다.
- 제출 안내는 실제 대상·이메일 주소·SMTP 설정 상태를 조회하고, 확인 후 발송한다. 발송 결과와 이메일 실패 재시도도 API에 연결했다. 발송 여부가 불확실한 요청의 재시도에는 같은 멱등성 키를 사용한다.
- 자료함은 실제 월별 목록·선택·옵션·ZIP 생성/상태 조회/파일 다운로드에 연결했다. `/download` 주소를 직접 열기만 해서는 생성하지 않는다. 계정 전환 시 상태를 지우며, 응답 유실·권한·만료·대상 변경을 처리한다.
- API 클라이언트는 `core/admin-submissions-api.ts`, `review-api.ts`, `notices-api.ts`, `archive-api.ts`로 분리했다. `ReviewView.period`는 기간 미설정이면 `null`이다. 개발용 `?preview`는 유지하며 미리보기 데이터는 프로덕션 번들에 포함하지 않는다.
- 검증: 관리자 프로덕션 빌드와 29개 파일·198개 테스트 통과. 배포한 VM의 Chromium에서 로그인·목록·보완 이력·PDF 렌더링·연속 검토·승인/재검토 요청 저장·실제 ZIP 파일 저장·안내 대상 조회까지 통과했다. 브라우저 시나리오는 `e2e/admin.ts`, VM 실행법은 루트 README. 새 더미 교육생과 PDF만 만들고 제출 안내 화면에서는 대상 조회만 한다.
- 로컬 VM 접속: `https://admin.localhost:8443/login`, `accountdemo`(회계·ZIP 포함) 또는 `opsdemo`(운영). 소스 변경 후에는 `vagrant reload`만으로 이미지가 갱신되지 않는다. `deploy/start-podman.sh`로 다시 빌드·기동한다.

## 이전 작업 기록

작성 2026-10-17, 2026-10-18에 R의 #9 merge와 로그인 정리를 반영. 같은 날 역할 가드·shell 작업, `shared/` 추출, 관리자 화면 레이아웃(A00·A07·A18·서류 검토·자료함 A12~A14)과 API 제안서 후 갱신. 학생 앱 HANDOFF는 루트 `HANDOFF.md`. 2026-10-18 후반: 역할별 실제 로그인 확인과 `/users`·A18 API 연결(완료 14).

## 목표와 현재 위치

관리자 페이지를 학생 `frontend/`와 분리된 새 앱 `admin-front/`로 만든다. 배포는 별도 서브도메인(`admin.<도메인>`), base href는 `/`.

- **완료 1 (`8378200`):** 기본 세팅 + hello world.
- **완료 2 (`c733a84`):** 역할 가드 + 관리자 shell (메뉴 없음, 대시보드 자리 하나).
  - 라우트 (`app.routes.ts`): `/login`(guestGuard), `/forbidden`(forbiddenGuard), `/`(staffGuard) → `layout/admin-shell` 안에 `pages/dashboard`("현황 대시보드 · 준비 중"), `**` → `/`.
  - `core/guards.ts`: `landingPath(me)`가 로그아웃 → `/login`, student → `/forbidden`, operator·accountant·admin → `/`. 세 가드는 "내 landing이 이 경로면 통과, 아니면 내 landing으로".
  - `core/roles.ts`: `STAFF_ROLES`, `isStaff`, `ROLE_LABELS`(교육생 / 운영 담당자 / 회계·지정 담당자 / 관리자).
  - `core/auth.service.ts`, `core/api.service.ts`(me·authMethods·demoLogin·logout·errorMessage), `core/unauthorized.interceptor.ts`: 학생 앱과 같은 패턴의 관리자용 사본(필요한 것만).
  - `pages/login`: `GET /api/auth/methods`에 따라 "42 계정으로 로그인"과 데모 로그인(login 입력) 표시. `?error=`는 `LOGIN_ERRORS`.
  - `pages/forbidden`: "관리자 권한이 없는 계정이에요" + 계정·역할 + 로그아웃.
  - `layout/admin-shell`: 어두운 사이드바 + 상단바(브레드크럼 "운영 / {data.crumb}", 아바타, 로그아웃). **이 시점에는 메뉴가 없었다. 지금 모양은 완료 5.**
- **검증 (2026-10-17):** `bun run build` (initial 513 kB, 예산 600 kB 안), `bun run test -- --watch=false` 5 파일 20 테스트 통과. `frontend/` build·test(19 파일 117 테스트) 그대로 통과.
  - 브라우저 (4201, headless Chrome, 별도 프로필, CDP): 로그아웃 상태 `/` → `/login` · seed 학생 `dongmin` 데모 로그인 → `/forbidden`("동민 (dongmin) · 교육생") · 학생이 `/` 열면 `/forbidden` · 로그아웃 → `/login`. `dongmin`은 이미 있는 seed 유저라 DB에 새 유저는 안 생겼다.
  - **프록시 Origin 덮어쓰기 확인 완료:** 위 데모 로그인 POST가 4201 프록시를 거쳐 403 없이 성공했다.
  - **staff 화면은 실제 staff 유저로 확인 못 함** (아래 R 확인 사항). shell 모양은 CDP `Fetch`로 브라우저 안에서만 `/api/me`를 가짜 operator로 응답시켜 스크린샷으로 확인 (백엔드엔 아무것도 안 씀).
- **완료 3 (`9ee48b0`…`6bb97f0`): 공용 코드를 루트 `shared/`로 옮겼다 (구조 이동만, 관리자 화면은 그대로).** 상세는 루트 `HANDOFF.md`의 `shared/` 항목, 규칙은 루트 `CLAUDE.md`.
  - 관리자는 이제 `@otus/shared/*`만 import한다: `core/api-types`(Me, Role, AuthMethods, LOGIN_ERRORS, ApiErrorBody), `core/brand`, `ui/button`. `@otus/*` → `../frontend/src/app/*` 별칭과 `includePaths: ["../frontend/src"]`는 없앴다.
  - `src/shared` → `../../shared` 심볼릭 링크 + `preserveSymlinks`. 바로 쓸 수 있는 공용 컴포넌트: card, info-box, status-badge, count-pill, notice-panel, time-badge, hours-bar. 유틸: `format.ts`(`dotDate`, `wonText`, `hoursText`, `lastMoment` 등).
  - 검증: build 성공. test는 6 파일 32개 통과(shared의 `time-requirement.spec.ts` 포함). 번들의 `@angular/core`는 한 벌(113 모듈)이고 `../frontend` 입력은 0개다.

- **관리자 화면 레이아웃 (2026-10-17, 2026-10-18 확인: 완료 상태 = 레이아웃·`?preview`까지, API 연결은 `api.md`에 자료함 API가 들어온 뒤).** 관리자 API가 아직 없어서 **API 없이 레이아웃까지만** 만들었다. 화면 = 입력만 받는 순수 컴포넌트 + 화면용 타입(`core/admin.models.ts`) + 문구 순수 함수(`core/*-copy.ts`, 용어 규칙 단위 테스트) + dev 전용 미리보기 상수(`dev/preview-data.ts`). mock interceptor·가짜 서비스는 없다.
  - **완료 4 (`a50b7f4`):** `docs/design/README.md`에 "관리자" 섹션(이미지 역할, 숨김, 정책이 다른 곳, 세 축 표, 화면 메모)과 이미지 6장 커밋. 뒤에 탭 문자가 붙어 있던 파일은 내용이 A07-notice-empty라 `A07-notice-empty.png`로 바꿨다. `A07-notice-compose-old.png`는 참고용으로 남겼다.
  - **완료 5 (`c7dd5ef`) shell:** `core/roles.ts`의 `ADMIN_MENU` 표 하나가 사이드바(`menuFor(role)`)와 `menuGuard`(shell의 `canActivateChild`)를 정한다. 메뉴 4개(현황 대시보드 · 월별 제출 내역 · 사용자 관리 · 제출 안내), "제출 기간 설정"·도움말 카드·알림 벨 없음. 활성 메뉴는 진한 teal(`--admin-nav-*` 별칭 토큰, 값은 이미지에서 잰 기존 토큰과 같다). 사용자 행은 이름(위) + 역할(아래). `/submissions`, `/users`는 제목만 있는 placeholder. `canOpenOriginals()`(operator, accountant)는 A18용.
  - **완료 6 (`c9b6c95`) A00 현황 대시보드:** `/` (`?preview`). 카드 4개(제출 대상 / 미제출 / 검토 대기 / 재검토 요청), 안내 박스, 바로가기 3개, 업무표(정보 변경·발송 실패만). "대상 확정/해당 없음/판단 보류"는 쓰지 않고 이번 달 시간 요건 한 줄(`달성(예상)`) + 지난달 판정·최종 수령 대상 두 줄로 나눴다. 새 컴포넌트 `ui/stat-card`, `ui/data-table`, `ui/page-header`.
  - **완료 7 (`054fe06`) A07 제출 안내:** `/notices` (`?preview`, `?preview=empty`, `=confirm`, `=sent`). 월 선택, 카드 3개, 발송 대상 표 또는 빈 상태, "사용자에게 이렇게 보여요", **확인 단계는 모달**(`pages/notice-confirm`), 발송 완료 모달(`pages/notice-sent`). 새 `ui/dialog`(`--overlay`, `--width-dialog`), `ui/month-select`. 미리보기에서 버튼은 단계만 옮기고 아무것도 보내지 않는다.
  - **완료 8 (`bcf8f88`) A18 사용자 상세:** `/users/:id` (`?preview`). 머리, 카드 3개(받을 계좌는 마스킹), 검토 및 변경 기록 표, 최초 제출 서류 + "열기 ↗"(`/api/files/{id}`, 새 탭). operator·accountant만 활성, admin은 비활성 + 안내.
  - **완료 9 (`ba6a6b6`):** `docs/api-proposal-admin.md` (대시보드 집계, 제출 안내 미리보기·발송·재시도, 사용자 목록·상세·기록, 원본 열람, R에게 묻는 것 8개). `api.md`는 건드리지 않았다. 정리 규칙: 학생 제안서의 enum 그대로, 새 enum은 `RecordAction` 하나.
  - **완료 10 (`25543a5`) 배포 복구:** `deploy/web.Containerfile`이 `frontend/`와 `shared/`를 형제(`/src/frontend`, `/src/shared`)로 COPY한다. `shared/` 링크가 컨테이너에서 끊겨 학생 이미지 빌드가 실패하던 것을 고쳤다 (수정 전 재현, 수정 후 빌드 통과, 이미지 `/srv`가 로컬 빌드와 같음). 상세는 루트 `HANDOFF.md`. 바뀐 deploy 파일은 이 하나뿐이다.
  - **완료 11 (`c0c3426`, `1becbf7`, 제안서 커밋) 서류 검토 (A02 검토·승인, A03 보완 요청):** `/submissions/:id` (`?preview`, 월별은 `?preview=monthly`). 단계는 모달이 아니라 **페이지**다: 검토 `/submissions/:id` → `/approve`(승인 전 확인) → `/approved`, 또는 `/revision`(보완 요청 작성) → `/revision/requested`. 라우트의 `data.stage`로 컨테이너 하나(`pages/submission-review.ts`)가 다섯 화면을 고른다. 최초(탭 4개)와 월별(탭 1개)은 같은 컴포넌트다.
    - 이미지 10장은 `c0c3426`에 커밋했고 `A02-initial-approve.png`는 `A02-initial-approved.png`로 이름을 바로잡았다. 이미지 역할과 정책 차이는 design README "관리자".
    - 화면용 타입 `ReviewView`·`ReviewDoc`·`ReviewEvent`·`ReviewDecision`(`core/admin.models.ts`), 문구 순수 함수 `core/review-copy.ts`(+spec: 유예·고정 날짜·"수령 대상" 없음, 사유 1~1000자, 날짜는 cycle 값과 `lastMoment`), 표시 컴포넌트 `pages/*-view.ts` 5개와 `ui/review-header`·`ui/doc-tabs`·`ui/pdf-slot`.
    - **화면 상태는 서버에 안 저장한다:** `core/review-state.ts`(root 서비스, signals만)가 열어본 탭(= "확인 완료"), 운영팀 메모, 보완 사유, 고른 서류를 라우트 사이에서 들고 있다. 새로고침하면 초기화. API가 생기면 이 서비스만 서버 호출로 바꾼다.
    - **"4종 승인 검토"는 4개 탭을 다 열어야 활성** (월별은 탭 1개라 바로 활성), 안 본 개수를 한 줄로 알린다. "보완 요청"은 언제나 활성. 주의: PDF 뷰어가 없어서 "열어봤다"가 "읽었다"는 아니다. 뷰어가 생긴 뒤에야 의미가 있다.
    - **PDF 영역은 처음엔 자리만이었고 완료 12에서 뷰어가 들어왔다:** (처음 문구 "PDF 미리보기 준비 중"). `GET /api/files/{id}`가 attachment + CSP sandbox라서다. "다운로드"는 operator·accountant만 활성(A18과 같은 `canOpenOriginals`), admin은 비활성 + 안내. 이미지 속 증명서 내용은 만들지 않았다. 뷰어 비교(a inline / b pdf.js / c 다운로드만)와 **추천 (b) pdf.js lazy chunk**는 `docs/api-proposal-admin.md` "원본 PDF 표시". 새 라이브러리라 승인 전에는 안 넣는다.
    - **이미지와 다르게 한 곳:** 배지는 학생 앱 용어(`BADGE_LABELS`: 검토 중 / 서류 승인 / 재검토 요청, 이미지의 "검토 대기"·"승인 완료"·"보완 요청" 배지 아님. 버튼·제목의 "보완 요청"은 행위라 그대로). 처리 담당자는 "역할 + 실제 이름"(예 "운영 담당자 지우"). 유예 문구 삭제, 제출 기간·마감은 cycle(`lastMoment`). 서류 탭에서 이미지의 "확인 완료" 배지는 승인 전 확인 화면에서만 쓴다.
    - **이미지가 없어서 만든 화면:** 월별 검토(최초와 같은 구조, 탭 1개), 최초 4종 보완 요청 작성(서류 4개 체크 카드에서 1개 이상, 선택한 서류만 `revision_doc_types`, 오른쪽 미리보기는 고른 서류명 + 사유 + 마감). 사유가 비었거나 서류를 안 골랐으면 "보완 요청 확정"이 꺼지고 이유를 한 줄로 알린다.
    - **API 제안서에 추가:** 제출 상세, 승인·보완 요청(`review_comment` 필수, `revision_doc_types`, dev API와 같은 모양, `Idempotency-Key`), 운영팀 메모(제출 단위, 학생에게 안 나감), 검토 기록(처리자 역할·이름·시각), 원본 PDF 표시 비교. R 질문 9~12 추가, 7번은 해결로 바꿈. `api.md`는 안 건드렸다.
    - **검증:** admin `bun run build`(경고 없음, initial 535 kB / 예산 600 kB) · `bun run test -- --watch=false` 15 파일 94개, `frontend/` build·test 19 파일 117개(코드 변경 없음). 프로덕션 번들(`dist/`)에서 미리보기 값(`preview-initial`, 파일 id, `신분증_동민`, `흐릿해서` 등)을 원문·`\uXXXX`로 찾아 0건, 대조군(`운영팀 메모`)은 잡힘. 미리보기를 headless Chrome으로 찍어 이미지와 나란히 비교(검토 탭, 승인 전 확인, 승인 완료, 보완 작성, 완료).
  - **완료 12 (`31ce50f`) PDF 뷰어 (사용자 승인):** `ui/pdf-viewer.ts`가 `GET /api/files/{id}`를 같은 출처 `fetch`로 읽어 pdf.js(`pdfjs-dist` 6.4.299, 새 의존성)로 canvas에 그린다. 확대·축소(50~200%), 페이지 이동, 불러오는 중·실패 상태. 서버 변경 없음. pdf.js는 lazy chunk(`pdf` 432 kB, initial은 535 kB 그대로)이고 worker·CMap·표준 폰트·wasm은 `angular.json` `assets`로 `/pdfjs/`에 복사된다. **그래서 `angular.json`을 바꾼 뒤에는 떠 있는 `ng serve`를 다시 띄워야 한다** (안 그러면 worker가 404라 "PDF를 불러오지 못했어요"). 운영 CSP(`default-src 'self'; script-src 'self'…`)를 그대로 붙인 프록시 뒤에서 실제 PDF가 그려지는 것을 확인했다 (worker는 `script-src 'self'`로 허용됨, `blob:` 불필요). pdf.js 6에는 `isEvalSupported` 옵션이 없다. **보안 점검 (2026-10-17):** `bun audit` 취약점 0건(367 패키지). 6.4.299 빌드에는 `eval`/`new Function` 경로가 없다. 스크립트·폼·링크는 canvas `render()`만 쓰고 주석 레이어를 안 만들어 동작하지 않고(`enableScripting`은 뷰어 전용 옵션), `enableXfa: false`와 `annotationMode: 1`(`ENABLE`, 폼 위젯 `ENABLE_FORMS` 아님)을 `PDF_LOAD_OPTIONS`·`PDF_ANNOTATION_MODE`로 명시하고 `pdf-viewer.spec.ts`가 고정한다. admin(원본을 못 여는 역할)은 뷰어 대신 안내만 본다. **operator의 `/api/files/{id}`는 지금 404** (R 확인 사항, 위): 그 전에는 operator도 뷰어가 실패 상태가 된다.
  - **완료 13 (`b69ceb2`, `a6ecbb4`, `78b382a`, `e3375f3`, `81f14b1`) 자료함·일괄 다운로드 (A12~A14, 모두 로컬 커밋, push 안 함):** PRD 최우선 기능이자 데모의 마지막 장면. 관리자 API가 없어서 레이아웃까지만 (화면용 타입 + 순수 표시 컴포넌트 + 문구 순수 함수 + dev 전용 `?preview`).
    - **라우트:** `/archive/:month`(A12), `/archive/:month/options`(A13), `/archive/:month/download`(A14). 활성 메뉴는 "월별 제출 내역": `roles.ts`의 `MenuItem.also`에 `/archive`를 두고, 셸이 `routerLinkActive` 대신 `menuItemFor(url)`로 활성 항목을 정한다. **A01(검토 목록)에서 자료함으로 가는 링크는 없다** (A01 디자인이 없다). 지금은 주소로만 들어간다.
    - **선택·옵션·상태는 `core/archive-state.ts`(root, signals)가 세 화면 사이에서 들고 있다:** 월의 행(`view`), 선택한 교육생(처음엔 전원), 검색, 보기 필터, 옵션(기본 서류 3종·이전 제출본), 다운로드 상태(`status`), `canDownload`. 새로고침하면 초기화. API가 생기면 이 서비스와 컨테이너(`pages/archive*.ts`)만 서버 호출로 바꾼다. 표시 컴포넌트(`*-view`)와 `core/archive-*.ts`는 고치지 않는다.
    - **파일 이름 규칙은 순수 함수다:** `core/archive-naming.ts`(`safeName`: 못 쓰는 문자·제어·Cf(U+202E)·끝의 점/공백·Windows 장치 이름·40자·NFC, `uniqueNames`: NFC·대소문자 무시, `_2`/`_3`, 확장자 앞) + `core/archive-plan.ts`(`planArchive`: 선택 + 옵션 → 폴더·파일·PDF 수). A13 미리보기와 A14 요약이 같은 `planArchive`를 쓰므로 둘이 어긋날 수 없다. 단위 테스트가 규칙을 고정하고, API 제안서가 같은 규칙을 서버에 넘긴다.
    - **정책 (이미지와 다름, design README "A12~A14"):** 기본 포함은 그 달 최종 제출본뿐, draft 없음 · 승인 안 된 계좌 변경 통장사본("통장사본_검토대기.pdf")은 안 들어가고 통장사본은 "기본 서류 3종"을 켤 때 승인된 버전만 · 검토 상태와 상관없이 포함하고 상태는 CSV에 · **내려받기는 accountant만** (`roles.ts` `DOWNLOAD_ARCHIVE_ROLES`). 다른 역할은 자료함을 보고 선택하지만 두 버튼이 비활성 + 안내, A14를 주소로 열어도 "시작했어요"라고 하지 않고 "내려받을 수 없어요"를 보인다 (빈 선택도 같음).
    - **A12:** 행의 이름이 `/users/:id` 링크 (이미지의 "동민 자료 보기" 버튼 대신). 숨김: "변경된 통장사본 보기"(A19 없음), "자료 보관함으로"(A17 없음), A14 "전체 보관함으로". 새 `ui/field`(라벨 + 테두리 상자). 체크박스·라디오는 네이티브 + `accent-color`.
    - **A14:** `?preview`(시작), `?preview=creating`(생성 중, `notice-panel`), `?preview=failed`(실패, 빨간 `info-box`). **실패 화면에 "다시 시도"는 없다:** 보낼 API가 없어서 눌러도 할 일이 없다. "내려받기 옵션으로"가 대신한다. API가 생기면 새 `Idempotency-Key`로 같은 요청을 다시 보내는 버튼으로 바꾼다.
    - **API 제안서 (`docs/api-proposal-admin.md` "자료함 · 일괄 다운로드", `api.md`는 건드리지 않음):** `GET /api/admin/archive/{month}`, `POST …/exports`(`Idempotency-Key`, `expected_pdf_count`) → job, `GET …/exports/{job_id}`(`creating|ready|failed`), `GET …/exports/{job_id}/file`(`filename*=UTF-8''…`), 임시 ZIP 짧게 보관(평문 원본은 디스크에 안 둠), 폴더·파일 이름 규칙, `제출목록.csv`(UTF-8 BOM, `= + - @ \t \r`로 시작하는 셀 앞 `'`, 열 6개), 생성·원본별·내려받기 감사 로그, 권한(목록은 staff 전체, ZIP은 accountant만). R 질문 13~14 추가 (상한, `file_access_log` 구분값).
    - **검증:** 단계마다 admin `bun run build`(경고 없음, initial 533 kB / 예산 600 kB) · `bun run test -- --watch=false` (최종 20 파일 137개) · `frontend/` build·test (21 파일 124개, 코드 변경 없음). 미리보기를 headless Chrome으로 찍어 이미지와 비교 (A12 · A13 기본·옵션 전부 켬 · A14 시작·생성 중·실패·operator). 프로덕션 번들(`dist/`)에서 미리보기 값(`dongkim2`, `seoyeon`, `김하린`, `이서연`, `ARCHIVE_PREVIEW`)을 원문과 `\uXXXX` 두 형태로 찾아 0건 (`harin`은 pdf.js 글꼴 라이선스 파일에서만 나옴: 무관).
    - **미리보기 주소:** `/archive/2026-09?preview`(A12), `/archive/2026-09/options?preview`(A13), `/archive/2026-09/download?preview`(A14, `=creating`, `=failed`). 역할은 `accountant`로 봐야 버튼이 활성이다 (`/api/me`만 바꿔 응답시키는 CDP 방식, 아래 레시피).
  - **완료 14 (`b3b76d0`, 로컬 커밋, push 안 함) 사용자 목록 `/users` + A18 실제 API 연결:** `GET /api/admin/users`(검색 `query`, `limit` 20, `before`/`next_before`로 "더 보기")와 `GET /api/admin/users/{id}`에 연결했다. 이미지 없이 A18·A12 스타일로 만들었다.
    - 응답 → 화면 변환 함수와 단위 테스트를 먼저 썼다: `core/admin-users.ts`(API 타입, `toUserListRow`, `toUserRecordView`, `appendRows`) + spec, `core/users-copy.ts`(문구, 정책으로 뺀 말이 없음을 테스트) + spec. 표시 컴포넌트 `pages/users-view.*`는 입력만 받고, 컨테이너 `pages/users.ts`가 호출한다 (검색은 300 ms 쉬고 새 목록, 지우면 즉시, 검색이 바뀐 뒤 도착한 "더 보기" 응답은 버림). 행의 이름이 `/users/:id` 링크.
    - **A18 상세 응답은 프로필뿐이다** (계좌·제출·기록·서류 id 없음). 그래서 `UserRecordView`에 `profileOnly`를 더하고 `currentMonth`를 null 가능으로 바꿨다. profileOnly면 계좌·이번 달 제출 카드는 "—" + "관리자 API가 준비되면 나와요", 기록 표와 최초 제출 서류 카드는 빈 상태 문구, 요약 줄에서 "최근 제출"은 뺀다 (모르는 것을 "미제출"·"등록된 계좌 없음"이라고 말하지 않는다). 취업 상태 카드와 "최초 서류 등록 완료"는 실제 값. **그래서 실제 데이터의 A18에는 "열기" 링크가 없다** (서류 id가 응답에 없음): 열기·뷰어는 `?preview` 데이터로만 확인한다. `?preview`(전체 레이아웃)는 그대로.
    - `/users/abc`처럼 정수가 아닌 id는 서버에 묻지 않고 "찾을 수 없는 교육생이에요."(404도 같은 문구) + "← 사용자 목록".
    - **검증:** admin `bun run build`(경고 없음) · `bun run test -- --watch=false` 23 파일 154개. 실제 백엔드·세 역할 로그인으로 `/users`(20명 + 더 보기, 검색 "dong" → 2명, 이름 클릭 → `/users/22`, `/users/99999` → 찾을 수 없음)를 headless Chrome으로 확인하고 스크린샷으로 모양을 봤다. `frontend/`는 코드 변경이 없어 돌리지 않았다.
  - **완료 15 (`a8d21f9`) 배포 통합:** 바뀐 deploy 파일 목록·env 키·절차는 **`docs/deploy-admin.md`** (R에게 알릴 것).
    - 관리자 앱은 **별도 `otus-admin` 이미지가 아니라 `otus-web` 이미지 안** (`/srv-admin`). R의 Caddyfile 관리자 블록이 `/srv-admin`을 서빙하는 구조라 그대로 맞췄고, pod에 컨테이너·포트가 늘지 않는다. `web.Containerfile`에 `build-admin` 단계(`/src/admin-front` + `/src/shared` 형제), `start-podman.sh`가 `APP_ORIGINS`·`FORTY_TWO_ADMIN_REDIRECT_URI`·`STAFF_ROLE_ALLOWLIST`·`ADMIN_SITE_ADDRESS`를 받는다 (운영 렌더는 `APP_ORIGINS`를 항상 정해서 `otus-pod.yaml`의 로컬 값이 새지 않는다).
    - **검증:** `podman build -f deploy/web.Containerfile` 통과 (학생·관리자). 이미지의 `/srv-admin/pdfjs/pdf.worker.min.mjs`·`cmaps`·`standard_fonts`·`wasm` 확인, `caddy validate` 통과. 운영과 같은 옵션(읽기 전용, 캡능력 drop)으로 띄워 `localhost` = `OTUS`, `admin.localhost` = `OTUS Admin`, 관리자 쪽 worker `text/javascript` 200, CSP 헤더, SPA 폴백 확인. `start-podman.sh` 렌더는 임시 `.env` 5가지로 확인 (venv에 PyYAML). **전체 pod(`make pod-up`)는 안 띄웠다.**
    - **해커톤 배포의 걸림돌:** CI 배포(`deploy.yml`)는 `OTUS_REQUIRE_OAUTH=true`를 고정해서 데모 로그인을 끈다. `deploy.yml`은 안 건드렸다 (R과 결정).
  - **학생 앱 (`frontend/`, `995309f`): 최초 4종 보완 제출 허용 (사용자 승인).** `/submit/initial` (`pages/initial-revision.ts`)이 `Supplement`를 그대로 재사용한다. `core/revision.ts`에 `chainOutcome(items, kind)`(월별 전용이던 `monthlyOutcome`을 일반화, `monthlyOutcome`은 그 위 한 줄로 남김)와 `revisionPath`(보완 요청이 `/submit`인지 `/submit/initial`인지, 보완 제출의 `parent_id`를 따라 올라감). 홈은 최근 3건이 아니라 전체 이력에서 "재검토 요청 중인 최초 체인"을 맨 앞(히어로)에 두고 링크를 체인별로, 이력의 "보완 제출하기"도 initial은 달 제한 없이 `/submit/initial`로. `Supplement`는 여러 서류(제목 "서류 N개를 보완해주세요", 고용보험 발급일 확인은 고용보험일 때만, 파일명 목록)를 처리하도록 손봤다. 요청한 서류만 받는 것은 백엔드의 `required_doc_types`(supplement = `revision_doc_types`)가 한다. 검증: frontend build, test 21 파일 124개, 가짜 API 응답(CDP)으로 `/submit/initial`을 찍어 확인 (실제 DB는 안 건드림).
  - **검증:** 화면마다 admin `bun run build`(경고 없음)·`bun run test -- --watch=false`와 `frontend/` build·test(19 파일 117개, 그대로). 최종 admin 13 파일 74개 통과. 미리보기를 headless Chrome으로 찍어 A00·A07(empty, sent)·A18을 이미지와 나란히 비교 (아래 레시피).
  - **`?preview`는 dev 빌드에서만 동작한다 (확인 완료):** 세 컨테이너(`dashboard.ts`, `notices.ts`, `user-record.ts`) 모두 `typeof ngDevMode === 'undefined' || ngDevMode` 안에서만 `import('../dev/preview-data')`를 부른다. `bun run build` 결과(`dist/admin-front/browser`)를 정적 서버로 띄워(`/api`는 백엔드로 프록시) 로그인한 뒤 `/?preview`, `/notices?preview`(`=empty`, `=sent`), `/users/1?preview`, `/?preview=1&x`를 열면 전부 "관리자 API가 준비되면…" 문구만 나왔고, 같은 스크립트를 dev 서버(4330)에서 돌리면 미리보기가 떴다 (대조군). 번들 16개 파일(소스맵 없음)에서 미리보기에만 있는 값(이름, login, `카카오뱅크`, 파일 id, 날짜, `PREVIEW`, `preview`)을 원문과 `\uXXXX` 두 형태로 찾았지만 없었다 (`preview`라는 문자열도 없다: 가드째 번들에서 빠진다).
  - **정책으로 이미지와 다르게 한 곳 (사용자 결정, 상세는 design README "관리자"):** 발송 채널 "서비스 알림"만 · 발송 대상 규칙은 하나 **미제출 − 취업 중** (40시간 달성(예상) 조건은 화면에도 제안서에도 넣지 않는다: 서류 마감과 시간 집계가 둘 다 말일이라, 월중에 40시간 미만이던 사람이 말일까지 채우면 알림을 못 받아 서류를 놓칠 수 있다) · 유예·개명·"변경 이력"·"자료 보관함" 숨김 · A00 하단 버튼은 모두 숨김 · "이번 달 서류 검토 →"는 `/submissions` placeholder로.

## 테스트 계정 (dev DB)

- **`staffdemo`** ("운영 데모", `operator`, 데모): 2026-10-17 사용자 요청으로 만들었다. 데모 로그인 API로 만든 뒤 `UPDATE users SET role='operator' WHERE login='staffdemo' AND is_demo`. 데모 로그인 → `/` shell(사이드바 맨 아래 "운영 데모 / 운영 담당자") 브라우저 확인 완료. seed에는 없어서 DB를 새로 만들면 사라진다. 미리보기 스크린샷은 이 계정으로 찍었다.
- 그 밖의 데모 유저는 전부 `student` → `/forbidden` 확인용 (`dongmin` 등, 루트 HANDOFF "테스트 계정").
- accountant·admin 계정은 아직 없다. A18의 역할별 모양(accountant, admin 비활성)은 스크린샷 스크립트가 **브라우저 안에서만** `/api/me` 응답의 `role`을 바꿔서 확인했다 (아래 레시피). 백엔드·DB는 건드리지 않았다.

## 결정

- 스택·설정은 `frontend/`와 동일 (`package.json`·`bun.lock`·tsconfig·prettier 복사). Angular 22.2.3, TypeScript 6.0.3, Vitest 5.0.5, happy-dom 21.0.3.
- 공유는 복사 대신 루트 `shared/`로 (완료 3): `@otus/shared/*`, 토큰은 `includePaths: ["src/shared"]`. 관리자만 쓰는 것은 `src/app/`에 둔다. 두 앱이 쓰게 되면 그때 `shared/`로 옮긴다. 이미지 빌드 때 `shared/`가 앱 디렉터리의 형제로 있어야 한다 (아래 다음 할 일 3).
- 허용 역할: operator·accountant·admin (사용자 결정). 원본 열람·연속 검토는 operator와 accountant 둘 다.
- 메뉴는 4개 (현황 대시보드 · 월별 제출 내역 · 사용자 관리 · 제출 안내). "제출 기간 설정"은 숨김 (기간은 매달 1일~말일 고정). 역할별 노출은 `ADMIN_MENU` 표 하나. 지금은 staff 세 역할이 모두 같은 4개를 본다.
- 활성 메뉴는 진한 teal 배경 + 흰 글자 (학생 앱의 연한 mint 규칙은 관리자에 적용하지 않는다, 사용자 결정). 사용자 행은 이름 + 역할 (login 없음).
- 시간 요건·서류 상태·최종 수령 대상은 세 축으로 따로 센다. "달성(예상)"은 월중 시간 요건에만, "확정"은 최종 수령 대상에만 쓰고 한 문장에 섞지 않는다 (`dashboard-copy.spec.ts`가 지킨다).
- 원본 열람은 operator, accountant만 (사용자 결정). admin은 "열기"가 비활성이고 "원본은 운영·회계 담당자만 열 수 있어요." 안내가 나온다 (문구는 내가 정했다, 바꿔도 된다).
- 발송 전 확인은 페이지가 아니라 **모달** (사용자 승인). 유예·개인 마감을 빼니 남는 내용이 대상 수, 알림 문구, 발송/취소뿐이다.
- `proxy.conf.mjs`: `/api` → `:3000`만 한다. **Origin 덮어쓰기는 2026-10-18에 없앴다:** `backend/.env`에 `APP_ORIGINS=http://localhost:4200,http://localhost:4201`을 넣고 백엔드를 재시작한 뒤, 4201에서 `opsdemo` 데모 로그인 POST가 403 없이 200이었다. 이 키가 없는 `.env`로는 관리자 dev 로그인이 403이다.

## R 확인 사항 (백엔드, 우리가 고치지 않음)

2026-10-18에 R의 이슈 #9가 merge돼서 아래가 **해결됐다** (`api.md` 반영 확인): staff 시드(`opsdemo` operator · `accountdemo` accountant · `admindemo` admin), operator의 원본 열람(`GET /api/files/{id}`, admin과 남의 파일 교육생은 404), `/api/admin/*` 역할 확인(교육생 403), 다중 origin(`APP_ORIGINS`, dev `:4200`,`:4201`), 관리자 사용자 API(`GET /api/admin/users`, `/{id}`).

- **관리자 로그인 방식 (사용자 결정 2026-10-18):**
  - **해커톤 배포는 데모 로그인** (`opsdemo` operator · `accountdemo` accountant · `admindemo` admin, seed가 만든다). 배포 서버는 `DEMO_LOGIN_ENABLED=true`(공개 호스트면 `DEMO_LOGIN_ALLOW_PUBLIC=true`도)가 필요하다 → **R과 맞출 항목.** 알려진 걸림돌: `.github/workflows/deploy.yml`이 `OTUS_REQUIRE_OAUTH=true`를 고정해서 CI 배포는 데모 로그인을 강제로 끈다 (`docs/deploy-admin.md`).
  - **운영 전환 때는 R의 42 로그인:** `?surface=admin` + `FORTY_TWO_ADMIN_REDIRECT_URI`(42 앱에도 등록) + `STAFF_ROLE_ALLOWLIST`. 관리자 로그인 화면은 `GET /api/auth/methods`의 `forty_two`가 true이면 "42 계정으로 로그인" 버튼(`/api/auth/42/login?surface=admin`)을, `demo`가 true이면 데모 로그인을 보인다 (`36ff202`). 교육생이 42로 들어오면 `/login?error=staff_only`: 문구는 `core/login-errors.ts`(관리자 앱 안, 학생 앱의 `LOGIN_ERRORS` + `staff_only`)가 정하고 단위 테스트로 고정했다. 데모 로그인으로는 `staff_only`가 안 나온다 (교육생은 `/forbidden`).
  - **로컬 주의:** 이 `.env`에는 `FORTY_TWO_ADMIN_REDIRECT_URI`가 없어서 `forty_two`가 true인데도 그 버튼은 `/api/auth/42/login?surface=admin`이 404다 (`/api/auth/methods`가 관리자 표면 가능 여부를 말해 주지 않는다. R에게 물을 것).
- **아직 `api.md`에 없는 관리자 API (`docs/api-proposal-admin.md`):** 대시보드 집계, 제출 안내(미리보기·발송·재시도), `users/{id}/records`, 서류 검토(상세·승인/보완·메모·이벤트·PDF 표시), 자료함·ZIP job. "R에게 묻는 것" 14개 중 6번(operator 원본)·8번(staff 시드)만 해결. 나머지(1·2·3·5·9~14: 취업자 집계 제외, 월 선택, 중복 전송 기준, 취업 변경 이력, 메모 단위, 검토 Idempotency-Key, 이벤트 사유, ZIP 상한, 감사 구분)는 R 답을 기다린다.
- **알림 kind `submission_reminder`:** `api.md`에 kind는 있지만 서버가 만들지 않는다 (아래 루트 HANDOFF의 알림 항목).

## 잘 된 것

- 같은 버전 보장: `frontend/bun.lock`을 복사(이름만 바꿈)한 뒤 `bun install` → `bun pm ls`로 버전 일치 확인. `^` 범위만 두고 새로 설치하면 더 새 22.x가 잡힐 수 있다.
- ~~워크스페이스 밖 공유가 문제없이 됐다~~ → **문제가 있었다 (완료 3에서 발견, 해결):** `@otus/*` → `../frontend/src/app/*`로 가져온 `ui/button`이 `frontend/node_modules`의 `@angular/core`를 끌어와, 관리자 번들에 Angular가 두 벌 있었다 (stats.json에서 133 + 73 모듈). 앱 디렉터리 밖 파일의 bare import는 그 파일 위치에서 resolve된다. 지금은 `shared/` 링크 + `preserveSymlinks`로 한 벌이다. 의존성 중복은 `bun run build -- --configuration development --stats-json`의 `browser-stats.json`에서 `node_modules/@angular/core/` 경로를 세어 확인한다.
- 가드를 "내 landing 경로 = 이 경로면 통과" 하나(`onlyFor`)로 만들어 세 가드와 `landingPath`의 분기가 어긋날 수 없다.
- 브라우저 검증: Bun 스크립트로 headless Chrome에 CDP 직접 연결 (WebDriver 없이). `Fetch.fulfillRequest`로 `/api/me`만 바꿔 staff shell을 백엔드 변경 없이 확인.
- 미리보기 방식이 잘 됐다: 실제 라우트에 `?preview`가 있을 때만 `import('../dev/preview-data')`를 `typeof ngDevMode === 'undefined' || ngDevMode` 뒤에서 부른다. 실제 라우트, 사이드바 활성 상태, 브레드크럼, 가드를 그대로 쓰면서 프로덕션 번들에는 미리보기 값이 없다 (`bun run build` 후 `dist/`에서 미리보기에만 있는 문자열을 찾아 확인).
- 문구를 순수 함수로 빼고 단위 테스트로 용어 규칙("달성(예상)"과 "확정"을 안 섞음, 계좌는 뒤 4자리만, 정책으로 뺀 말(메일·유예·개명·도움말)이 없음)을 고정했다.
- 이미지에서 색·크기를 눈대중이 아니라 PNG를 디코드해서 쟀다 (아래 레시피). 사이드바 색, 배경막(`rgba(10, 32, 33, 0.4)`)이 그렇게 나왔다.
- 데모 로그인 전에 대상 유저가 dev DB에 이미 있는지 읽기 전용 쿼리로 확인 (루트 HANDOFF의 `podman exec otus-dev-db sh -c 'psql …'`).

## 안 된 것 / 주의

- `TaskStop`으로 `bun run start`를 멈추면 bun만 죽고 자식 `ng serve`(node)는 남아 포트를 잡고 있을 수 있다. 다시 띄우다 "Port 4201 is already in use"가 나면 `lsof -nP -iTCP:4201 -sTCP:LISTEN` → `ps -o lstart,command`로 누가 띄운 건지 먼저 본다. 2026-10-17에는 사용자가 대화형 셸에서 띄운 4201 서버가 있어서 죽이지 않고 그대로 썼다 (watch 모드라 새 코드 반영).
- 루트에서 `bunx prettier --write admin-front/...`를 돌리면 "Saved lockfile"이 찍히지만 루트에 `bun.lock`·`package-lock.json`은 안 생긴다 (확인함). 그래도 커밋 전 `git status`로 확인.
- curl로 `POST /api/auth/demo-login`을 치는 검증은 하지 않는다 (사용자 결정): XSRF 때문에 Origin과 무관하게 403이 날 수 있고, 성공하면 dev DB에 유저가 생긴다. Origin 확인은 브라우저 로그인 흐름으로 했다.
- 관리자 42 로그인은 아직 실제로 못 쓴다 (콜백이 학생 origin으로 감, R 확인 사항).
- **프로덕션 번들에서 한글 검색:** esbuild가 `${}`가 든 템플릿 리터럴의 한글을 `\uXXXX`로 바꿔 내보낸다. `grep "문구"`로 못 찾았다고 번들에 없는 게 아니다. 원문과 `\uXXXX`(대소문자) 둘 다 찾는다. 반대로 "없어야 하는 것"을 확인할 때도 두 형태로 찾아야 한다. 나는 한 번 이걸로 잘못된 결론을 낼 뻔했다.
- 동적 import로 읽는 미리보기 데이터는 `whenStable()`이 기다려 주지 않는다. spec에서는 `await vi.waitFor(() => { harness.detectChanges(); expect(...) })`.
- `angular.json`·tsconfig를 바꾸면 떠 있는 `ng serve`를 다시 띄운다. 사용자의 4201 서버는 건드리지 않고 `ng serve --port 4330`을 따로 띄웠다.
- 전체 페이지 캡처에서 `position: fixed` 배경막은 **창 높이**만 덮는다. 이미지(1040)와 같은 높이로 비교하려면 headless 창을 `이미지 높이 + 143`(1183)으로 띄운다.
- tsconfig `paths`로 `@angular/*`를 앱 `node_modules`에 매핑하는 방법은 쓰지 않는다. 빌드는 되지만 unit-test 빌더(`externalPackages: true` 하드코딩)에서 Angular가 두 벌이 되어 테스트가 전부 깨진다 (완료 3에서 확인).

## 다음 할 일

1. **관리자 API가 생기면** (`docs/api-proposal-admin.md`가 `api.md`에 반영된 뒤에만): `core/api.service.ts`에 호출을 더하고, 각 컨테이너(`pages/dashboard.ts`, `notices.ts`, `user-record.ts`)가 `?preview` 대신 응답으로 `view` 신호를 채운다. **표시 컴포넌트(`*-view`)와 문구 함수는 고치지 않는다.** 응답 → 화면 타입 변환 함수와 단위 테스트를 먼저. 발송은 `Idempotency-Key`(UUID)를 보낸다. `expected_count`가 다르면 409 → 미리보기를 다시 읽는다.
2. **이미지가 없는 화면 — 사용자 결정 2026-10-18: 이미지 없이 바로 만든다** (Figma 없이 토큰·기존 컴포넌트, 기존 관리자 화면 A18·A12 스타일로): 사용자 목록(`/users`)과 검토 목록(`/submissions`). 지금은 제목만 있는 placeholder다 (서류 검토 화면의 "← 검토 목록"이 `/submissions`로 온다). `/users`는 이미 있는 `GET /api/admin/users`(`query`·`limit`·`before`/`next_before`, 항목 `{id, login, display_name, employed, initial_submitted}`)로 **실제 API에 바로 연결**하고, 행을 누르면 `/users/:id`(A18)로 간다. `/submissions`는 목록 API가 없으니 `?preview` 패턴으로 레이아웃만. **`/users`는 완료 14로 실제 API에 연결했다.** 남은 것은 `/submissions`(검토 목록, `?preview` 레이아웃만).
2-0. **진행 상황 (2026-10-18):** `APP_ORIGINS` 적용·Origin 덮어쓰기 제거, 역할 확인(아래 표), `/users` + A18 연결(완료 14), 42 로그인 버튼·`staff_only` 복원, 배포 통합(완료 15)까지 끝났다. 남은 것: 운영 로그인(위) 맞추기, `docs/deploy-admin.md`를 R에게 알리기, push 후 실제 서버 확인.
2-1. ~~최초 서류 보완 요청을 허용할지~~ **허용으로 결정, 학생 앱 구현 완료 (완료 12). R 질문 12는 로컬 확인 완료 (2026-10-17):** 실제 백엔드·DB로 최초 보완(`revision_doc_types=[bankbook]`) 전 구간이 통과했다 (`e2e/revision.ts`, 결과는 `docs/api-proposal-admin.md` 질문 12). 운영 pod(`https://localhost:8443`)에서도 통과했다. 관리자 쪽은 이미 최초 4종 보완 작성 화면까지 만들어 두었다. 허용하면 **학생 앱에 할 일**(`frontend/`, 이번엔 안 건드림):
2-2. ~~PDF 뷰어 (b) pdf.js~~ 구현 완료 (완료 12). 남은 일: operator의 원본 권한(R), 실제(스캔 가능한) PDF로 운영 pod에서 뷰어 확인.
2-4. **자료함 API가 생기면:** `core/archive-state.ts`가 `view`·`status`를 응답으로 채우고, `pages/archive*.ts`가 `?preview` 대신 `GET /archive/{month}`와 job 호출을 부른다. 선택한 월이 라우트 `:month`와 다르면 새로 읽는다 (지금은 `state.view`가 한 번 차면 그대로다). 응답 → `ArchiveRow` 변환 함수와 단위 테스트가 먼저. 내려받기는 `POST …/exports`(`Idempotency-Key` UUID, `expected_pdf_count`가 다르면 409 → 목록을 다시 읽음) → 상태 폴링 → `/file`. A01에서 자료함으로 가는 링크는 A01 디자인이 생길 때 같이 정한다.
2-3. **서류 검토 API가 생기면:** `pages/submission-review.ts`가 `?preview` 대신 응답으로 `view`·`decision`을 채우고, `core/review-state.ts`의 메모·결정을 서버 호출로 바꾼다. 표시 컴포넌트와 `review-copy.ts`는 고치지 않는다 (응답 → `ReviewView` 변환 함수와 단위 테스트 먼저).
3. **사용자 답을 기다리는 것:** `docs/api-proposal-admin.md`의 R 질문 8개 중 정책에 걸린 것(월 선택에 줄 달, 중복 전송 기준). A18 admin 안내 문구("원본은 운영·회계 담당자만 열 수 있어요.")와 A07의 문구들은 내가 정한 것이다.
4. ~~실제 staff 계정 확인~~ 완료 (2026-10-18, 실제 백엔드, 데모 로그인, headless Chrome). 새 `ng serve`(4330)에서 확인한 표:

   | 항목 | operator `opsdemo` | accountant `accountdemo` | admin `admindemo` | student `dongmin` |
   | --- | --- | --- | --- | --- |
   | 착지 | `/` | `/` | `/` | `/forbidden` ("동민 (dongmin) · 교육생") |
   | 사이드바 | 4개 + "운영 담당자" | 4개 + "회계·지정 담당자" | 4개 + "관리자" | 없음 |
   | `GET /api/admin/users` | 200 | 200 | 200 | 403 |
   | `GET /api/files/{남의 파일}` | 200 | 200 | 404 | 404 (본인 것은 200) |
   | A18 "열기" (`?preview` 데이터) | 활성 3개, 안내 없음 | 활성 3개, 안내 없음 | 비활성 3개 + "원본은 운영·회계 담당자만 열 수 있어요." | - |
   | 서류 검토 PDF 뷰어 (`?preview`, 파일 id를 seed 파일로 바꿔 응답) | 그려짐 (canvas, 오류 없음) | 그려짐 | 뷰어 대신 안내 | - |

   - 열기·뷰어는 `?preview` 화면에 **실제 로그인 세션**으로 확인했다 (실제 A18은 응답에 서류 id가 없어 "열기"가 없다). CDP `Fetch`로 `/api/files/<미리보기 id>` 요청의 URL만 seed 파일 id로 바꿨고 백엔드·DB에는 아무것도 쓰지 않았다.
   - **`staff_only` 문구는 확인할 수 없다:** 교육생이 데모 로그인하면 `staff_only`가 아니라 `/forbidden`이다. `staff_only`는 42 OAuth(`?surface=admin`) 콜백 전용이고 관리자는 42를 안 쓰기로 했다.
   - **사용자의 4201 서버는 옛 서버라 PDF 뷰어가 "불러오지 못했어요"가 된다** (`/pdfjs/pdf.worker.min.mjs` 404, 4201 서버가 `angular.json` assets 추가 전에 떠 있음). 파일은 200 `%PDF-1.4`로 정상. 새 서버(4330)에서는 그려졌다. 4201을 다시 띄우면 된다.
5. ~~배포 통합~~ 완료 15. 서버에서 실제로 돌려 보는 것만 남았다.
6. 위 완료 4~10의 커밋과 두 HANDOFF 정리는 `origin/front-taebkim`에 push했다. 이후 push 시점은 사용자가 정한다.

## dev 세션 주의

쿠키는 포트를 구분하지 않는다. `localhost:4200`과 `localhost:4201`이 같은 `__Host-session`·`XSRF-TOKEN`을 공유해서, 한쪽에서 로그인하면 다른 쪽 세션이 바뀐다 (로그인할 때마다 이전 세션은 삭제됨). 동시에 테스트하려면:
- 브라우저 프로필 분리 (Chrome 프로필 2개, 또는 한쪽은 시크릿 창. headless는 `--user-data-dir`을 따로)
- 또는 호스트를 다르게: 학생은 `http://localhost:4200`, 관리자는 `http://127.0.0.1:4201` (쿠키는 호스트별). 단 Secure 쿠키를 `127.0.0.1`에서도 받는지 확인 필요.
- 또는 다른 브라우저 (Chrome / Firefox).

## 브라우저 검증 레시피

스크립트는 세션 scratchpad에 있어서 다음 세션에는 없다. 새로 쓴다 (몇십 줄이다).

- **프로덕션 빌드 확인:** `bun run build` 뒤 `dist/admin-front/browser`를 SPA 폴백이 있는 정적 서버로 띄운다 (Bun `Bun.serve` 20줄: 파일이 없으면 `index.html`, `/api/*`는 `127.0.0.1:3000`으로 프록시하면서 `Origin: http://localhost:4200`로 덮어쓴다). 같은 로그인 스크립트로 `/?preview` 등을 열어 `main`의 `innerText`를 본다. dev 서버에서 같은 스크립트를 돌려 대조군으로 쓴다 (프로덕션에서만 안 뜨는지 확인하려면 dev에서는 뜬다는 것도 확인해야 한다).
- **서버:** `cd admin-front && bun run start -- --port 4330` (또는 `bunx ng serve --port 4330`). 백엔드 `.env`의 `APP_ORIGINS`에 사용하는 포트가 들어 있어야 로그인 POST가 통과한다 (4330을 쓰면 4330도 넣거나 4201 서버를 쓴다). 사용자의 4201 서버는 건드리지 않는다. `angular.json`·tsconfig를 바꾸면 재시작.
- **브라우저:** `bunx --bun @puppeteer/browsers install chrome@stable --path <scratchpad>/browsers`와 `chromedriver@stable`로 임시 Chrome for Testing을 받고, chromedriver를 빈 포트에 띄운다 (`e2e/chrome.sh` 방식. 사용자의 Chrome은 건드리지 않는다). 옵션 `--headless=new --window-size=1440,<높이> --hide-scrollbars --force-device-scale-factor=1`.
- **서류 검토 캡처 (이번에 쓴 간단한 방식):** 설치한 Chrome을 `--headless=new --remote-debugging-port=<빈 포트> --user-data-dir=<임시>`로 띄우고 Bun 스크립트가 CDP 웹소켓에 직접 붙었다. `Fetch.enable`로 `/api/me`만 `operator` JSON으로 응답시켜서 백엔드·로그인 없이 shell과 가드를 통과한다. 응답 body를 base64로 줄 때 `btoa`는 한글 `display_name`에서 죽으니 `Buffer.from(...).toString('base64')`를 쓴다. 사용자의 4201 서버(watch 모드)를 그대로 썼다.
- **높이:** 이미지 높이 + 143 (A07·A18은 1040 → 1183, A00은 1120 → 1263). 안 그러면 모달 배경막과 사이드바가 이미지보다 짧다.
- **로그인:** `/login`에서 `#demo-login`에 `staffdemo`를 넣고(`input` 이벤트) `form.demo button[type=submit]`을 누른다 (W3C WebDriver `execute/sync`).
- **캡처:** `POST /session/{id}/goog/cdp/execute`로 `Page.captureScreenshot { format: "png", captureBeyondViewport: true }`. 폰트는 `document.fonts.ready` 뒤에 찍는다.
- **미리보기 주소:** `/?preview`(A00), `/notices?preview`, `/notices?preview=empty`, `/notices?preview=confirm`, `/notices?preview=sent`(A07), `/users/1?preview`(A18), `/submissions/p?preview`(서류 검토, 월별은 `?preview=monthly`), `/submissions/p/approve?preview`, `…/approved?preview`, `…/revision?preview`, `…/revision/requested?preview`. 주소에 `?`와 `=`가 있으니 셸에서 따옴표로 감싼다 (zsh는 `?`를 glob으로 읽는다).
- **역할 바꿔 보기:** `Page.addScriptToEvaluateOnNewDocument`로 `XMLHttpRequest.prototype`의 `open`을 감싸 `GET /api/me`를 표시하고, `response`·`responseText` getter에서 JSON의 `role`·`display_name`만 바꿔 돌려준다 (Angular가 XHR을 쓴다, `withFetch` 금지). A18의 accountant·admin이 이렇게 나왔다. 백엔드에는 아무것도 안 쓴다.
- **이미지에서 색·크기 재기:** Bun으로 PNG를 읽어 (`node:zlib`의 `inflateSync` + 필터 해제, 8-bit RGB/RGBA) 픽셀을 샘플한다. PIL·ImageMagick이 없다. 두 바탕(흰색, `#faf9f6`) 위의 색으로 배경막의 알파와 색을 역산했다.
- **비교:** 같은 폰트·토큰이라도 문구가 정책으로 달라서 바이트 비교는 안 된다. 두 이미지를 나란히 열어 간격(카드 높이, 표 행 높이, 모달 높이)을 숫자로 맞춘다. 예전 스타일 이미지(A00, A08)는 배치만 대조한다.
- 데모 로그인은 이미 있는 유저(`staffdemo`)만 쓴다 (새 login을 넣으면 dev DB에 유저가 생긴다).
