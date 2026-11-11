# OTUS FE

교육생용 지원금 서류 제출 웹앱. Angular + RxJS + signals.

## 기준 문서

- `api.md`가 유일한 API 기준. 타입·필드명·상태값은 여기서만 가져온다. 구현이 api.md와 다르면 구현을 고친다. api.md를 고쳐야 하면 멈추고 나에게 묻는다.
- 서비스 이름은 OTUS. 디자인 이미지의 "42 Support"는 임시 이름이므로 루트 `shared/core/brand.ts` 상수를 쓴다. 42 학교·계정을 가리키는 "42"는 유지.
- 범위: U01 로그인 분기, U02 최초 4종, U03 홈, U04 월별 제출, U05 이력·보완, U06 취업 상태. 그 외 화면은 만들지 않는다.

## 규칙

- 상태는 signals, HTTP·업로드 스트림은 RxJS. 둘을 섞을 때는 toSignal/toObservable로 경계를 명확히.
- standalone 컴포넌트, 새 control flow(@if, @for).
- 날짜·D-day·접수 기간 열림 여부는 서버 값을 그대로 쓴다. FE에서 KST 계산하지 않는다.
- HttpClient에 withFetch() 쓰지 않는다 (업로드 진행률 이벤트가 안 나옴).
- 요청하지 않은 리팩터링, 라이브러리 추가, 파일 이동 금지. 필요하면 먼저 묻는다.
- 작업 끝나면 `bun run build`와 해당 화면 브라우저 확인까지 하고 완료라고 말한다.

## 명령어

- 개발 서버: `bun run start` (http://localhost:4200, proxy: /api → http://127.0.0.1:3000)
- 빌드: `bun run build`
