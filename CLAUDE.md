# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Use **Podman** (not Docker) and **Bun** (not npm/npx). Run `make` targets from the repo root.

**Backend** (`backend/`):
- `make dev-db`: starts the local Postgres container `otus-dev-db` on `127.0.0.1:5433`.
- `cp .env.example .env`: one-time setup; `.env` is gitignored.
- `make seed` (or `cargo run -- seed`): demo data (`src/seed.rs`), safe to re-run. It opens this month's submission period for the whole month and adds the demo users `dongmin` (lands on home) and `seoyeon` (has a re-review request).
- `cargo run`: serves on `127.0.0.1:3000` and applies pending migrations at startup.
- `cargo test`, or `cargo test <name>` for a single test (e.g. `cargo test error_body`).
- `cargo clippy --all-targets` and `cargo fmt`
- `diesel migration generate <name>`, `diesel migration run`, `diesel migration redo -a`: the diesel CLI reads `DATABASE_URL` from `backend/.env` and regenerates `src/schema.rs`. Never edit `schema.rs` by hand.

**Frontend** (`frontend/`):
- `bun install`
- `bun run start`: dev server on `:4200`. `proxy.conf.json` forwards `/api` to `:3000`, so run the backend too.
- `bun run build`
- `bun run test -- --watch=false`: Vitest. For a single file, add `--include src/app/app.spec.ts`.
  - The DOM environment is **happy-dom, not jsdom**. jsdom's workers crash under Bun (Node isn't installed), with "'addEventListener' called on an object that is not a valid instance of EventTarget".
- `bunx ng generate component <name>`

**Pod** (production-like, `https://localhost:8443`):
- `cp deploy/secrets.example.yaml deploy/secrets.yaml`, fill it in, then `make secrets`. `deploy/secrets.yaml` is gitignored.
- `make pod-up`: builds both images and runs `podman kube play --replace deploy/otus-pod.yaml`.
- `make pod-logs`, `make pod-down`
- If the DB password changes, also remove the `otus-pgdata` volume. Postgres only reads the password when it initializes an empty volume.

## Architecture

- **One origin.** Caddy (`deploy/Caddyfile`, `web` container) serves the Angular build and proxies `/api/*` to axum. There's no CORS, and the session cookie stays first-party. Caddy also terminates TLS and sets the CSP and security headers.
- **Pod.** `deploy/otus-pod.yaml` defines the containers `db`, `backend` and `web`. They share the pod's network namespace. Postgres listens on localhost only, and only Caddy's port is published (host `8443`).
- **Secrets.** There are two Podman secrets, so each container gets only what it needs:
  - `otus-db` holds the Postgres superuser password and the app role's password. It's mounted only into `db`.
  - `otus-backend` holds `database-url`, both encryption keys and the 42 credentials. It's mounted only into `backend`.
  - The backend reads `KEY_FILE` before `KEY` (`backend/src/config.rs`). Don't pass secrets as plain env values in the pod spec: Podman exposes those in `podman inspect`.
  - `podman kube play` writes each secret's files into a named volume with the same name, which survives `kube down` and `podman secret rm`. `make demo-clean` removes those volumes, plus the pre-split `otus-secrets`.
- **Backend layout.**
  - Config: `config.rs`, read from the environment.
  - Database: `db.rs`, a diesel-async deadpool pool plus migrations embedded with `embed_migrations!`.
  - Errors: `error.rs`. `AppError` has one variant per `api.md` error code and serializes to `{"error": {"code", "message"}}`. Internal errors are logged in full and return a generic `INTERNAL_ERROR` 500.
  - Axum's own 413 for an oversized body is plain text. Upload handlers must map it to `FILE_TOO_LARGE`.
  - Routes: under `routes/`, all prefixed with `/api`.
  - Body limits: 64 KiB globally. Only the upload route allows `MAX_UPLOAD_BYTES` plus 64 KiB of multipart overhead.
  - Use `extract::ApiJson` instead of `axum::Json` for request bodies, so a malformed body returns the `api.md` error format.
  - Take path IDs as `String` and map a parse failure to `NotFound`, because axum's own rejections are plain text.
  - `domain.rs`: the `text_enum!` macro maps the `api.md` enums (`Kind`, `Status`, `DocType`) directly onto `TEXT` columns. diesel reads `TEXT[]` columns as `Vec<Option<T>>`; flatten them with `domain::non_null`.
  - `kst.rs`: serializes times as `+09:00` with whole seconds and months as `YYYY-MM`.
- **diesel features.** diesel uses `postgres_backend` only, with diesel-async on tokio-postgres. Neither the binary nor the image needs `libpq`, so don't enable diesel's `postgres` feature.
- **Images.** All three runtime images are Alpine.
  - `otus-db` is `postgres:18-alpine` plus `deploy/db-init.sh`.
  - `otus-backend` and `otus-web` are built on `alpine:3`. For `otus-web`, the Caddy binary is copied in with its file capability stripped (see below).
  - The backend is built on `rust:1-alpine`, giving a static musl binary (about 24 MB image). `build-base` and `cmake` are there for aws-lc-sys, rustls' crypto backend.
  - The runtime image needs `ca-certificates` for TLS to the 42 API.
  - Don't switch either backend stage to a glibc base on its own: both stages must stay on musl.
- **Schema.** Enum values match `api.md`.
  - Statuses, kinds, roles and document types are `TEXT` with `CHECK` constraints, not Postgres enums.
  - `submissions.id` is a UUID, and `target_month` is stored as the 1st of the month.
  - A 보완 제출 is its own submission with `kind = 'supplement'` and `parent_id`.
  - Partial unique indexes enforce one draft per (user, kind, month) and one submitted `initial` per user.
  - `submission_files.id` is also the on-disk filename. Re-uploading a doc type adds a new row and sets `superseded_by` on the old one, so files are never deleted.
  - `submission_events` is both the status history and the idempotency record (`idempotency_key` is unique).
  - `sessions` stores only SHA-256 hashes of the session ID and the CSRF token.
  - `submissions.required_doc_types` is fixed when the submission is created. A supplement copies its parent's `revision_doc_types`, or the parent's whole required list when that is empty.
  - `cycles` holds one configurable window per target month, within that KST calendar month (`cycles_within_target_month`). **A month without a row is closed** (`cycle::ensure_open`). `opens_at` is inclusive and `closes_at` is exclusive. Only the current month's open window permits submission, supplements, revision requests and reminders; approvals remain possible after closing.
  - Operators and admins add/edit current and future periods through `/periods` and `PUT /api/admin/cycles/{YYYY-MM}`. Accountants can read periods and history. Updates require `expected_version` and append immutable before/after snapshots to `cycle_changes`. Past months are read-only. There is no automatic monthly registration or delete API. `make seed` inserts a whole-month current window only when no row exists, preserving customized windows.
- **Status transitions**:
  - Finalize (`POST /api/submissions/{id}/finalize`) moves a draft to `pending_review`, or a supplement to `resubmitted` along with its parent.
    - It requires an `Idempotency-Key` UUID header.
    - It takes the `FOR UPDATE` lock first, then checks the key, so a concurrent retry with the same key returns the result instead of failing.
    - It re-reads every required file from disk (`storage::verify`) before committing.
  - Staff review uses `POST /api/admin/submissions/{id}/review` (`routes/admin_review.rs`); the older `POST /api/dev/submissions/{id}/status` remains demo-only.
    - Approving a supplement also approves its `resubmitted` ancestors.
    - A re-review request on a supplement leaves its ancestors as `resubmitted`, and the next supplement chains off that supplement.
  - Every transition inserts a `submission_events` row.
  - Staff decisions store immutable actor/reason snapshots in `admin_review_decisions`. Propagated ancestor approvals link to that decision through `admin_review_event_links`, so profile changes cannot rewrite historical reviewer identities.
- **Uploads** (`storage.rs`, `routes/submissions.rs`):
  1. Check ownership, draft status and the cycle before reading the body.
  2. Receive the PDF **into memory** (`receive_pdf`, held in `Zeroizing`), enforcing the size limit and the `%PDF-` signature as bytes arrive. Plaintext never touches the disk.
  3. Encrypt it with AES-256-GCM under `FILE_ENCRYPTION_KEY`, with associated data `file:<id>`, so a file only decrypts under its own row. Write it to a hidden temp file (mode 600), fsync, rename to the new id, then fsync the directory.
  4. In one transaction, take a `FOR UPDATE` lock on the submission. Re-check that it's still a draft and the cycle is still open, and that the version cap (10 per doc type) isn't reached. Then mark the old current file as superseded and insert the new row with `key_id`.
  - The guards delete the file if any step fails, so a stored row always points at a durable file.
  - `storage::verify` decrypts a file and checks its size and SHA-256. A `key_id` of NULL means a plaintext file from before encryption at rest.
  - The `heavy_io` semaphore (8 permits) bounds how many whole PDFs sit in memory at once.
  - At startup, `sweep_orphans` deletes `.upload-*` temp files, and files older than an hour that no row references.
  - The PRD's per-user public-key envelope scheme is not implemented. This is server-side encryption with keys kept outside the database.
- **Bank accounts** (`crypto.rs`, `routes/account.rs`, table `bank_account_changes`):
  - Account numbers are encrypted with AES-256-GCM, stored as `nonce || ciphertext || tag`. The associated data is `bank_account:<user_id>`, so a ciphertext moved to another user's row fails to decrypt.
  - Only `account_last4` is plaintext. API responses carry only `•••• 1234`. **Never log, return or store the full number anywhere else.**
  - Every change request must include a new bankbook PDF (multipart `file`), stored like submission files (`bankbook_*` columns). The demo approval checks it with `storage::verify` first.
  - Every change is a row. The current account is the latest `approved` row, and a newer request cancels the pending one. That gives the PRD's before/after history and keeps the old account in effect until approval.
  - The key comes from `BANK_ACCOUNT_KEY(_FILE)`: base64, 32 bytes, generated with `openssl rand -base64 32`. The server refuses to start without a valid key. `key_id` is stored per row for future key rotation.
  - Losing the key makes the stored account numbers unrecoverable, so back it up separately from database backups.
  - `FieldCipher::decrypt` exists for the future accountant view and is unused outside tests.
- **Frontend** (`frontend/src/app`, overview in `frontend/README.md`):
  - `core/api.models.ts` mirrors the `api.md` types, together with `shared/core/api-types.ts` (the types admin-front also uses, re-exported by `api.models.ts`). Keep both in sync with `api.md`.
  - `core/api.service.ts` wraps the endpoints. Always call the API with relative `/api/...` URLs, because Angular only sends `X-XSRF-TOKEN` on relative URLs.
  - `AuthService.me` is a signal holding the logged-in user.
  - `guards.ts` does the U01 branching on `initial_submitted`: `/initial` until the initial 4 documents are submitted, then `/home`.
  - `unauthorizedInterceptor` sends the user to `/login` on a 401.
  - UI (PR #4): the design tokens are in `shared/styles/_tokens.scss` (root `shared/`, also used by admin-front), presentational components in `shared/ui/` (button, card, info box, status badge, time badge, count pill, hours bar, notice panel), student-only components in `ui/` (upload slot with progress, drop panel, employment choice), and the sidebar shell plus the `/initial` onboarding shell in `layout/`. The service name comes from `shared/core/brand.ts`. `/dev/ui` is a component showcase that's dropped from production builds.
  - The pages use only the real API types from `api.models.ts`; there are no mocks any more. Profile text (employment, masked account) comes from `core/profile.ts`, and the `shared/core/format.ts` helpers render a missing time (a month with no period set) as "—".
  - U01's "42 계정으로 로그인" goes to real 42 OAuth when `GET /api/auth/methods` says it's enabled, and runs the demo login otherwise. `?demo=<login>` forces the demo login.
- **Frontend CSP.** The production build sets `inlineCritical: false`, because critical-CSS inlining adds an inline `onload` handler that the CSP's `script-src 'self'` blocks. Component styles need `style-src 'unsafe-inline'`, which is already allowed.
- **`shared/`** (root): code that the student app (`frontend/`) and the admin app (`admin-front/`) **both** use.
  - Put only code that both apps use there: design tokens, presentational `ui/` components, pure helpers, and the `api.md` types both apps need. Code that only one app uses stays in that app, and so does anything that calls the API or holds DI state (services, guards, pages).
  - Import it as `@otus/shared/*` in both apps. Never import it with a relative path through `src/shared`, and never import app code from `shared/`.
  - Each app reaches it through a symlink, `src/shared -> ../../shared`, with `preserveSymlinks` in `tsconfig.json` and `angular.json`. That keeps the files under each app's `src/`, so `@angular/*` resolves from that app's `node_modules`. Don't replace this with a tsconfig `paths` mapping for `@angular/*`: the unit-test builder keeps `node_modules` packages external, so a mapped import bundles a second Angular and every TestBed test fails.
  - Specs live next to their files and run in both apps' test runs.
  - Windows needs `core.symlinks=true` and Developer Mode (root `README.md`). Container builds must copy the app and `shared/` as siblings (`frontend/` + `shared/` in `deploy/web.Containerfile`, built in `/src/frontend`), or the links dangle.

## Auth and sessions

Implemented in `backend/src/session.rs`, `csrf.rs` and `routes/auth.rs`. The endpoints are documented in `api.md`.

- **Server-side sessions** in the `sessions` table. The browser gets two random 256-bit tokens:
  - `__Host-session`: HttpOnly, the session ID.
  - `XSRF-TOKEN`: readable by JS, the CSRF token.
  - Both are `Secure; SameSite=Lax; Path=/` and have no Max-Age. The DB stores only SHA-256 hashes of them.
  - 30-minute idle timeout and 12-hour absolute lifetime. An hourly task deletes expired rows.
  - Every login creates a fresh session ID and deletes the browser's previous session.
- **`CurrentUser` extractor**: put it in a handler to require login.
  - It returns 401 for a missing, unknown or expired session.
  - For a non-GET request, it also requires `X-XSRF-TOKEN` to match the session's CSRF hash, and returns 403 otherwise.
  - Angular's `HttpClient` sends that header automatically for relative URLs.
- **`csrf::require_same_origin`** wraps all routes: every non-GET request must carry `Origin == APP_ORIGIN`. This also protects demo-login, which has no session yet.
- **Dev server caveat**: the `Secure` cookies work on `http://localhost:4200` in Chrome and Firefox, because both treat localhost as a secure context. Safari may drop them, so use the pod (`https://localhost:8443`) there.
- **Demo login** (`POST /api/auth/demo-login`) and the `/api/dev/*` endpoints:
  - Both are gated by `DEMO_LOGIN_ENABLED` and return 404 when it's off. It must be `false` in production.
  - The `/api/dev/*` endpoints also require `user.is_demo`. A real 42 user must never be able to approve their own submission or bank account.
  - With the flag off, existing demo sessions are rejected and deleted.
  - The server refuses to start with demo login on and a non-localhost `APP_ORIGIN`, unless `DEMO_LOGIN_ALLOW_PUBLIC=true`. `seed` refuses to run unless demo login is on.
  - Demo users (`is_demo`) have a separate login namespace (partial unique indexes), so they can't collide with real 42 logins.
- **Roles**: `users.role` is one of `student`, `operator` (운영 담당자), `accountant` (회계·지정 담당자) or `admin` (관리자).
  - Check the role from the DB on every request.
  - Staff roles come only from a whitelist, never from the login flow.
- **42 OAuth** (`routes/oauth.rs`), authorization code with PKCE (S256):
  - `/api/auth/42/login` stores `state.verifier.issued_at` in an HttpOnly `__Host-oauth` cookie (Lax) and redirects to 42.
  - The callback:
    1. Checks the state and rejects logins older than 10 minutes.
    2. Exchanges the code on the server and calls `/v2/me`.
    3. Accepts only users with a `campus_users` entry for `FORTY_TWO_CAMPUS_ID`. **42 Gyeongsan is 69**, from the 42 API `/v2/campus`.
    4. Upserts the user by `intra_id`, never touching `role`.
    5. Rotates the session, drops the 42 token, and redirects to `/`. Any failure redirects to `/login?error=<code>`.
  - Config: OAuth is disabled (404) when `FORTY_TWO_CLIENT_ID` is empty.
    - Required with it: `FORTY_TWO_CLIENT_SECRET(_FILE)`, `FORTY_TWO_REDIRECT_URI` and `FORTY_TWO_CAMPUS_ID`.
    - `FORTY_TWO_API_BASE` points the flow at a mock server in tests.
  - The redirect URI must be registered with the 42 app and match exactly. It's registered for the pod (`https://localhost:8443/api/auth/42/callback`). To log in through `bun run start`, also register `http://localhost:4200/api/auth/42/callback` and use it in `backend/.env`.
  - The request trace span logs only the path, **never the query string**, because OAuth codes and state travel in it. Keep it that way.
- **`backend/.env` holds the real 42 client secret.** Never print, cat or grep its values, and never copy them into other files, logs or commits.

## Browser e2e

- **The suite:** `e2e/run.ts` is a dependency-free W3C WebDriver client (Bun), so the same checks drive any driver. It covers U01 → U03, an HttpOnly-cookie check, U02 uploads through the real upload slots (scanned and encrypted), finalize, and U05.
- **Running it:** against a running `make demo`, the targets are `make e2e-chrome` and `make e2e-safari`.
  - `make e2e-chrome` (`e2e/chrome.sh`) downloads a temporary Chrome for Testing and chromedriver into a temp directory with `@puppeteer/browsers`, picks a free port, and deletes everything afterwards.
  - `make e2e-safari` uses **only Safari Technology Preview's** safaridriver. Never automate `/usr/bin/safaridriver`: it drives the user's everyday Safari. It also exits when started detached, and times out while that Safari is in use.
- **Ports:** don't assume 4444, 9515 and so on are free (an I2P proxy holds 4444 on the dev Mac). The targets ask the OS for a free port.
- **CI:** `.github/workflows/e2e.yml` runs `make demo`, `make smoke` and `make e2e-chrome` on `ubuntu-24.04`, with Podman 4.9.
  - ClamAV signatures are cached per ISO week, through `podman volume export/import`.
  - `CHROME_NO_SANDBOX=1` is set because the runner blocks the user namespaces Chrome's sandbox needs.
  - Screenshots and pod logs are uploaded as an artifact.

## Malware scanning and downloads

- **Scanning** (`scan.rs`, `Received::scan`):
  - Every upload, including bankbook copies, is streamed to clamd (INSTREAM over TCP, `CLAMAV_ADDR`) while still in memory, before it's encrypted or stored.
  - A detection returns 422 `MALWARE_DETECTED` and is logged with the user and the signature. Any scanner error returns 503 `SCAN_UNAVAILABLE`. It **fails closed**: nothing is stored unscanned.
  - Without `CLAMAV_ADDR` the server only starts in demo mode, and warns that uploads aren't scanned. `/api/health` reports `scanner: ready | unavailable | disabled`, and `make pod-seed` waits for `ready`.
  - The `clamav` container (`deploy/clamav*`) is `alpine:3` plus Alpine's ClamAV packages; the official image has no arm64 build. It runs as uid 100 with no capabilities and a read-only root filesystem. Signatures are in the `otus-clamav-db` volume, which `demo-clean` keeps because re-downloading is slow. `freshclam` refreshes them 12 times a day.
  - **Testing:** EICAR is detected inside a PDF stream object, but not when appended after `%%EOF`, because ClamAV matches it at the start of a scanned object. Use the stream form in tests. Signature scanning finds *known* malware; it's a layer, not a guarantee.
- **Downloads** (`GET /api/files/{id}`, `routes/files.rs`):
  - Owner or staff (`operator`, `accountant`, `admin`), re-checked against the DB on every request. Anyone else gets the same 404 as an unknown id.
  - The file is decrypted and its SHA-256 re-checked, then served as an attachment with `Content-Security-Policy: sandbox; default-src 'none'`, `nosniff` and `no-store`.
  - The file name is ASCII-sanitized for `filename=` and percent-encoded for `filename*=` (RFC 5987), so it can't inject into the header.
  - Every download inserts into `file_access_log` **before** responding. That table is append-only: a trigger rejects UPDATE, DELETE and TRUNCATE, even for the app's own role. To reset a dev database, run `SET session_replication_role = replica` as a superuser first.
  - **Caddy's `header` directive replaces upstream values.** The site-wide CSP and Referrer-Policy therefore exclude `/api/files/*`, and that path gets the strict values with `defer`.
- **Podman gotcha:** a container started with `podman run --pod otus` inherits the pod's `restartPolicy: Always`. A `--rm` helper keeps restarting and re-running its command, for example SQL updates, and can bog down the Podman VM. Use `podman exec` into an existing container, or pass `--restart=no`.

## Security hardening

An adversarial review on 2026-10-17 drove most of this. Keep each property; the checks behind them are noted.

- **Abuse limits** (`ratelimit.rs`), in-memory token buckets that return `429 RATE_LIMITED` with `Retry-After`:
  - login endpoints: 10/min per client IP
  - state-changing requests: 60/min per session
  - uploads: a burst of 20, then 1 per 30 s per session
  - The client IP comes from `X-Forwarded-For` only when the peer is loopback, meaning Caddy, which replaces any client-supplied value.
- **Hard caps:**
  - 10 stored versions per document type per submission
  - 5 bank-change requests per user per 24 h, serialized with a `FOR UPDATE` lock on the user row
  - multipart text fields are capped at 1 KiB or less (`storage::small_text`)
  - JSON bodies are capped at 64 KiB
- **Timeouts:**
  - 120 s per request (`TimeoutLayer`)
  - the DB pool: at most 16 connections, a 5 s wait and a 5 s connect timeout
  - Caddy: `read_header` 10 s, `read_body` 2 min
- **Postgres:**
  - SCRAM passwords are required on the socket and on loopback (`POSTGRES_INITDB_ARGS`), because every container in the pod shares loopback.
  - The app connects as `otus`: not a superuser, and the owner of only its own database. It can't use `COPY ... TO PROGRAM` or create roles.
- **Containers** (`securityContext` in `deploy/otus-pod.yaml`):
  - All three: `allowPrivilegeEscalation: false`, a read-only root filesystem, and all capabilities dropped.
  - `db` keeps CHOWN, DAC_OVERRIDE, FOWNER, SETGID and SETUID for its entrypoint. `backend` runs as uid 10001.
  - Caddy listens on 8443 inside the container with no HTTP-redirect listener, so it needs no capability. Its binary's `cap_net_bind_service` file capability is stripped in `web.Containerfile`: exec fails with "Operation not permitted" otherwise.
- **Caddy:**
  - API responses: `Cache-Control: no-store`.
  - Headers: HSTS with `includeSubDomains`, COOP, CORP, `Permissions-Policy`, CSP, no `Server` header.
  - Bodies over 22 MB are rejected before the backend, with a bare 413 and no JSON. The frontend's `errorMessage` maps that.
- **OAuth:** only a `campus_users` entry with `is_primary` and `campus_id == FORTY_TWO_CAMPUS_ID` counts. Piscine and past-campus entries don't.
- **File names:** controls and invisible format (Cf) characters, such as the U+202E bidi override, are stripped.
- **Dependencies:** `cargo audit` reported 0 advisories across 287 crates on 2026-10-17. Rerun it before releases.
- **Known gaps:**
  - Logins and other events are only in the `tracing` log. Only file downloads have a persistent audit table.
  - A cancelled bank-change request keeps its bankbook PDF, because nothing is auto-deleted before a retention policy exists.
  - Migrations run as the app role (there's no separate DDL role).

## Planning sources

When these disagree, **issue #1 wins**:

- **GitHub issue #1 "개발 스택"** (2026-10-16): the agreed stack, scope, and task split for the hackathon. Read it with `gh issue view 1 --json body`.
- **The PRD `42경산 지원금 제출·관리 서비스 PRD & 개발 계획서.docx`** (2026-09-30, at the repo root, untracked and excluded through `.git/info/exclude`): the detailed product spec, including the screens (U01–U11, A00–A20), the state model, RBAC and data classification. Follow its *behaviour*. `api.md` decides API shapes, and the issue decides hackathon scope. Read it with `textutil -convert txt -stdout <file>`.
- **The OTUS development plan PDF** (2026-10-11, not in the repo): the contest proposal. Its product vision and domain rules are summarized below. Its tech stack table (Next.js / NestJS / Prisma / Redis+BullMQ) was a proposal made before the team agreed on a stack (팀 합의 전 제안안), and the issue superseded it.

## Product: OTUS (Opacity-Transparent Unanimous Subsidy)

The service name is **OTUS** everywhere: UI, page titles and docs. The PRD and early drafts call it "42 Support"; don't use that name.

OTUS is an entry for the 42 Gyeongsan campus service contest (team "이도연짱", repo `42gyeongsan-hackathon-2026/42.Zip-team03`). It replaces the email-and-manual-work process for submitting documents for the 42 Gyeongsan student subsidy (교육생 지원금). Students submit documents and see their status. Staff review submissions and download them in bulk.

Domain rules the code must model:

- **First month**: 4 documents (최초 4종):
  - ID card (신분증)
  - resident registration abstract (주민등록초본)
  - bankbook copy (통장사본)
  - employment insurance enrollment record (고용보험가입내역서)
- **Every later month**: 1 document, the 고용보험가입내역서. It must be issued on or after the 1st of the submission month.
- **Submission period** (PRD):
  - Default is the 21st 09:00 to the last day 23:59 of each month, **KST**, adjustable per month.
  - Outside the period, or when no period is set, upload, final submission and supplementary submission are all locked (`CYCLE_CLOSED`).
  - Compute every date and D-day in KST.
- **Drafts**: only the student can see them. A draft is not a submission and must never appear in staff views.
- **Which month a document belongs to**: the target month, not the receipt date. A September document received during an October extension stays in September.
- **Monthly submission**: the 3 unchanged base documents are shown as "유지" (kept) and disabled.
- **Employment status**: the student changes it and it saves immediately. Students who are employed are excluded from missing-submission reminders.
- **Three separate status axes**: eligibility (대상 / 해당 없음 / 판단 보류), document status, and payment status. Never merge them into one field.
- **PDF upload validation** (PRD): check extension, MIME type and magic bytes. The size limit is a config value.
- **Audit logs**: append-only, for views, downloads and notices.
- **Consent**: the PRD requires a privacy consent screen on first login. That's outside the hackathon scope.
- **Supplementary submission**: a submission only goes back to the student when a reviewer requests re-review (재검토 요청). The student then submits a 보완 제출.
- **When a submission counts as received**: show "received" only after the file is confirmed stored.
- **Account and name changes**: a change request takes effect only after its supporting documents are reviewed. The old value stays in effect until approval. Keep before/after history.
- **Automation does not make decisions**: the system computes and suggests, and staff make eligibility (대상 판정) and exception decisions. Policies must be configuration, not code: submission period, issue-date rule, cap on recognized hours (인정 시간 상한).

Full product user flow, from the PDF. Most of it is out of hackathon scope; see below.

operator sets eligibility and submission period → email and in-app notice → student submits PDFs → reviewer does a sequential review (approve / request re-review, next/prev without reopening detail pages; unchanged documents are disabled) → accounting downloads per-student folders as a ZIP plus `제출목록.csv` → retained, with no auto-deletion until a retention policy is set

## Hackathon scope (from issue #1)

**Goal**: this flow works end to end on the **deployed URL**:

demo login → initial 4 documents → monthly submission → re-review request → supplementary submission

Checkpoints:

1. Demo login → 4 documents → home shows "검토 대기" (awaiting review)
2. Monthly submission → re-review request → supplementary submission → home shows "재검토 대기" (awaiting re-review), on the deployed URL
3. Feature freeze, then bug fixes and a handover README

What's in scope:

- In: U01 login branching, U02 initial 4 documents, U03 home, U04 monthly submission, U05 history and supplementary submission, U06 employment status
- Out: U07–U11, sending real email, admin screens
- Re-review is triggered through a dev-only status-change API, not an admin UI.
- If a checkpoint slips by more than 30 minutes, drop U06.
- Demo with anonymized sample data (seed data), never real student documents.

## Stack

- **FE**: Angular 22 (RxJS, signals), built with Bun
- **BE**: Rust (edition 2024), axum 0.8, diesel 2.3 with diesel-async
- **DB**: PostgreSQL 18
- **Deploy**: one Podman pod (Caddy + backend + Postgres). Uploaded files are stored on local disk in the `otus-uploads` volume for now.

## Ownership

Hackathon assignment per issue #1:

- Backend (R): @DavidLee18, the owner of this checkout
- Frontend (F): @KimTaebin-ai

The PDF's roster also lists kdmin1325 (Frontend), RingoKwon (Data / 판별 로직, i.e. eligibility logic) and dodo-sudo455 (Infra / security).

## Team rules

- **`api.md` is the source of truth** for the API: endpoints, plus request/response JSON examples. If the implementation differs from `api.md`, fix the implementation, not the doc.
- **Only the backend owner writes migrations** (diesel migration SQL).
- The frontend develops against the real backend (`make dev-db`, `cargo run`, `make seed`). The PR #4 mock interceptor was removed once every mocked endpoint shipped.
- Planned open-source release (MIT, under review). Keep secrets, real data, and operational config out of the repo. Campus-specific policy goes in config files.

## Backend requirements

- `GET /api/health`, demo login with a session, `GET /api/me`
- Submission creation and file upload:
  - Validate PDFs by magic bytes, not by extension or content type.
  - Store files under UUID filenames.
  - Raise axum's request body limit so uploads fit.
- Submission confirmation:
  - Explicit status transitions.
  - Requests carry an idempotency key.
  - Mark the submission complete only after confirming the file was stored.
- Submission period and D-day API (KST), history API
- Dev status-change endpoint (re-review request) and seed data
- Later: 42 Intra OAuth2 (no separate sign-up), employment status API, bank account encryption, and masking of account numbers in API responses

## Security design (from the PDF)

- **Never newly collect or export resident registration numbers** (주민등록번호).
- **Who can open originals**: only accounting and designated staff (회계·지정 담당자) can open original documents. Every other request is denied.
- **Planned encryption scheme** (envelope encryption):
  - On upload, generate a per-file DEK.
  - Encrypt the file with AES-256-GCM.
  - Wrap the DEK with the uploader's public key and with the staff member's public key.
  - Store the encrypted file together with the wrapped DEKs.
  - On read, check authentication and permission, unwrap the DEK with the requester's private key, then decrypt the file.
- **Retention**: no automatic deletion until a retention policy is finalized.
- **Audit**: keep access and deletion records (audit logs).
