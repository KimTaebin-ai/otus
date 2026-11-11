// API-level e2e coverage against a running OTUS (`make demo`), no browser:
// the permission/rejection paths and server-only features the UI suite cannot
// see (issue #9 RBAC + originals, whole-KST-month cycle rule, issue #10
// eligibility + notifications, multi-origin CSRF). Run with:
//   bun e2e/api-coverage.ts        (or `make e2e-api`)
//   BASE_URL: default https://localhost:8443
// Needs demo login on and the seeded pod (`make demo`): dongmin/opsdemo/
// accountdemo/admindemo/elig* fixtures. Assumes a freshly seeded pod, like
// scripts/smoke.sh (the dev-decide step consumes eliglow's last-month row).

const BASE = (process.env.BASE_URL ?? "https://localhost:8443").replace(/\/$/, "");
const ADMIN_ORIGIN = "https://admin.localhost:8443";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || detail === undefined ? "" : ` (got ${JSON.stringify(detail)})`}`);
}

type Reply = { status: number; body: any; text: string };

class Client {
  cookies = new Map<string, string>();
  constructor(private origin: string = BASE) {}
  async call(method: string, path: string, body?: unknown): Promise<Reply> {
    const xsrf = this.cookies.get("XSRF-TOKEN") ?? "";
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Origin: this.origin,
        ...(this.cookies.size
          ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
          : {}),
        ...(method === "GET" ? {} : { "X-XSRF-TOKEN": decodeURIComponent(xsrf) }),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      tls: { rejectUnauthorized: false },
    } as RequestInit);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const text = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* binary (PDF) replies */ }
    return { status: res.status, body: parsed, text };
  }
  async login(login: string): Promise<Reply> {
    // The auth rate limiter is per-IP and shared with the browser suite:
    // back off once instead of starving (or failing on) a neighbouring login.
    let reply = await this.call("POST", "/api/auth/demo-login", { login });
    if (reply.status === 429) {
      await new Promise((r) => setTimeout(r, 7000));
      reply = await this.call("POST", "/api/auth/demo-login", { login });
    }
    return reply;
  }
}

function kstMonths(): { current: string; last: string } {
  const now = new Date(Date.now() + 9 * 3600_000);
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { current: fmt(now), last: fmt(last) };
}

const { current, last } = kstMonths();
const anon = new Client();
const student = new Client();
const otherStudent = new Client();
const ops = new Client();
const accountant = new Client();
const admin = new Client();
const elig = new Client();

try {
  // --- boot / auth surface -------------------------------------------------
  check("health 200", (await anon.call("GET", "/api/health")).status === 200);
  const methods = await anon.call("GET", "/api/auth/methods");
  check("auth methods: demo on, 42 off in demo pod",
    methods.status === 200 && methods.body.demo === true && methods.body.forty_two === false, methods.body);
  check("anon → /api/admin/users 401", (await anon.call("GET", "/api/admin/users")).status === 401);
  // 42 callback with a bogus code: clean failure, no session, no 500 — with or
  // without 42 configured (404 unconfigured; 302 to /login?error=… configured).
  const cbRes = await fetch(`${BASE}/api/auth/42/callback?code=bogus-code&state=bogus-state`, {
    redirect: "manual",
    tls: { rejectUnauthorized: false },
  } as RequestInit);
  const cbLocation = cbRes.headers.get("location") ?? "";
  const cbSetsSession = cbRes.headers.getSetCookie().some((c) => c.startsWith("__Host-session="));
  check("42 callback with bogus code fails cleanly (no session)",
    !cbSetsSession && (cbRes.status === 404 || (cbRes.status === 302 && cbLocation.includes("/login?error="))),
    `${cbRes.status} ${cbLocation}`);
  check("still anon after bogus 42 callback", (await anon.call("GET", "/api/me")).status === 401);
  check("anon → /api/me 401", (await anon.call("GET", "/api/me")).status === 401);

  // --- multi-origin (issue #9): admin origin accepted, foreign rejected --
  const adminOriginLogin = new Client(ADMIN_ORIGIN);
  check("demo-login from admin origin 200", (await adminOriginLogin.login("dongmin")).status === 200);
  const evil = await new Client("https://evil.example").login("dongmin");
  check("demo-login from unlisted origin 403", evil.status === 403, evil.status);

  // --- #9 RBAC: admin users API --------------------------------------------
  check("student login (dongmin)", (await student.login("dongmin")).status === 200);
  check("student → /api/admin/users 403", (await student.call("GET", "/api/admin/users")).status === 403);
  check("ops login", (await ops.login("opsdemo")).status === 200);
  const users = await ops.call("GET", "/api/admin/users?query=dongmin");
  check("operator → /api/admin/users 200 with dongmin",
    users.status === 200 && users.body.items?.some((u: any) => u.login === "dongmin"), users.body);
  const dongminId = users.body.items.find((u: any) => u.login === "dongmin").id;
  const detail = await ops.call("GET", `/api/admin/users/${dongminId}`);
  check("operator → /api/admin/users/{id} 200 role student",
    detail.status === 200 && detail.body.role === "student", detail.body);
  check("admin login", (await admin.login("admindemo")).status === 200);
  check("admin → /api/admin/users 200", (await admin.call("GET", "/api/admin/users")).status === 200);
  // student search: partial intra ID, partial Korean name, wildcard literals
  const byIntra = await admin.call("GET", "/api/admin/users?query=dong");
  check("search partial intra 'dong' finds dongmin",
    (byIntra.body?.items ?? []).some((u: any) => u.login === "dongmin"), byIntra.body);
  const byKorean = await admin.call("GET", "/api/admin/users?query=동민");
  check("search partial ko_name '동민' finds dongmin",
    (byKorean.body?.items ?? []).some((u: any) => u.login === "dongmin" && u.ko_name === "김동민"), byKorean.body);
  const byKimdong = await admin.call("GET", "/api/admin/users?query=%EA%B9%80%EB%8F%99");
  check("search '김동' matches via ko_name only (display_name has no 김동)",
    (byKimdong.body?.items ?? []).some((u: any) => u.login === "dongmin" && u.ko_name === "김동민" && !u.display_name.includes("김동")), byKimdong.body);
  const unfiltered = await admin.call("GET", "/api/admin/users");
  check("search without query returns the unfiltered student list",
    (unfiltered.body?.items ?? []).length >= 10 && unfiltered.body?.next_before !== null, unfiltered.body);
  const byWildcard = await admin.call("GET", "/api/admin/users?query=%25");
  check("search '%' is literal, not a wildcard (no full list)",
    byWildcard.status === 200 && (byWildcard.body?.items ?? []).length === 0, byWildcard.body);
  const noMatch = await admin.call("GET", "/api/admin/users?query=zzz-no-such-user");
  check("search non-match returns empty items",
    noMatch.status === 200 && (noMatch.body?.items ?? []).length === 0, noMatch.body);
  check("search as student 403",
    (await student.call("GET", "/api/admin/users?query=dong")).status === 403);
  check("search without login 401",
    (await anon.call("GET", "/api/admin/users?query=dong")).status === 401);
  check("accountant login", (await accountant.login("accountdemo")).status === 200);

  // --- #9 originals: owner + all staff (policy widened in 739ae90), others 404 ---
  const subs = await student.call("GET", `/api/submissions?month=${last}`);
  const fileId = subs.body?.items?.[0]?.files?.[0]?.file_id ?? subs.body?.[0]?.files?.[0]?.file_id;
  check("seeded dongmin submission has a file", typeof fileId === "string", subs.body);
  check("owner → /api/files/{id} 200", (await student.call("GET", `/api/files/${fileId}`)).status === 200);
  check("operator → original 200 (audit-logged server-side)", (await ops.call("GET", `/api/files/${fileId}`)).status === 200);
  check("accountant → original 200", (await accountant.call("GET", `/api/files/${fileId}`)).status === 200);
  // Admin originally could not open originals, but 739ae90 widened
  // GET /api/files/{id} to all staff (access_basis=admin, see api.md's role
  // matrix); students other than the owner still get the hiding 404.
  check("admin → original 200 (staff-wide since 739ae90)", (await admin.call("GET", `/api/files/${fileId}`)).status === 200);
  check("other student login", (await otherStudent.login("seoyeon")).status === 200);
  check("other student → original 404", (await otherStudent.call("GET", `/api/files/${fileId}`)).status === 404);
  check("unknown file id → 404", (await ops.call("GET", "/api/files/00000000-0000-4000-8000-000000000000")).status === 404);

  // --- cycle: whole KST month, exclusive close, closed month rejected -----
  const cycle = await student.call("GET", "/api/cycles/current");
  check("current cycle open", cycle.status === 200 && cycle.body.state === "open", cycle.body);
  const opens = String(cycle.body.opens_at ?? "");
  const closes = String(cycle.body.closes_at ?? "");
  check("cycle opens on the 1st 00:00 KST", opens.startsWith(`${current}-01T00:00:00`), opens);
  const next = new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)), 1));
  const nextStr = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01T00:00:00`;
  check("cycle closes next 1st 00:00 KST (exclusive)", closes.startsWith(nextStr), closes);
  const closed = await student.call("POST", "/api/submissions", { kind: "monthly", target_month: "2020-01" });
  check("submission for a closed month 422 CYCLE_CLOSED",
    closed.status === 422 && closed.body?.error?.code === "CYCLE_CLOSED", closed.body);

  // --- duplicate month block: initial this month ⇒ monthly create 409 -----
  const case16 = new Client();
  check("case16 login", (await case16.login("case16")).status === 200);
  const dup = await case16.call("POST", "/api/submissions", { kind: "monthly", target_month: current });
  check("monthly after same-month initial 409 INVALID_STATE",
    dup.status === 409 && dup.body?.error?.code === "INVALID_STATE", dup.body);
  const mine16 = await case16.call("GET", "/api/submissions");
  check("case16 initial chain still listed",
    (mine16.body?.items ?? []).some((s: any) => s.kind === "initial" && s.status === "pending_review"), mine16.body);

  // --- profile write: PATCH /api/me/profile tri-state + validation --------
  check("profile patch without login 401",
    (await anon.call("PATCH", "/api/me/profile", { ordinal: "5" })).status === 401);
  const prof = new Client();
  check("profile user login", (await prof.login("profileprobe")).status === 200);
  const wrote = await prof.call("PATCH", "/api/me/profile",
    { ordinal: "9기A", ko_name: "한지민", date_of_birth: "2003-04-21" });
  check("profile write 200 reflects values",
    wrote.status === 200 && wrote.body?.ordinal === "9기A" && wrote.body?.ko_name === "한지민" && wrote.body?.date_of_birth === "2003-04-21", wrote.body);
  const afterWrite = await prof.call("GET", "/api/me");
  check("GET /api/me shows written values",
    afterWrite.body?.ordinal === "9기A" && afterWrite.body?.date_of_birth === "2003-04-21", afterWrite.body);
  const partial = await prof.call("PATCH", "/api/me/profile", { ko_name: "김하은" });
  check("partial update leaves other fields",
    partial.status === 200 && partial.body?.ko_name === "김하은" && partial.body?.ordinal === "9기A" && partial.body?.date_of_birth === "2003-04-21", partial.body);
  const cleared = await prof.call("PATCH", "/api/me/profile", { ordinal: null });
  check("explicit null clears, others intact",
    cleared.status === 200 && cleared.body?.ordinal === null && cleared.body?.ko_name === "김하은" && cleared.body?.date_of_birth === "2003-04-21", cleared.body);
  for (const [label, body] of [
    ["blank ordinal 400", { ordinal: "   " }],
    ["over-long ko_name 400", { ko_name: "가".repeat(51) }],
    ["future date_of_birth 400", { date_of_birth: "2999-01-01" }],
    ["pre-1900 date_of_birth 400", { date_of_birth: "1899-12-31" }],
    ["impossible date 400", { date_of_birth: "2026-02-30" }],
    ["bad date format 400", { date_of_birth: "2026/10/18" }],
  ] as const) {
    const r = await prof.call("PATCH", "/api/me/profile", body);
    check(label, r.status === 400 && r.body?.error?.code === "INVALID_REQUEST", r.body);
  }
  check("no admin profile write surface (PATCH admin user 405)",
    (await prof.call("PATCH", "/api/admin/users/1", { ordinal: "5" })).status === 405);
  const otherProf = new Client();
  check("second user login", (await otherProf.login("profileother")).status === 200);
  const otherMe = await otherProf.call("GET", "/api/me");
  check("own-only: other user's profile untouched (nulls)",
    otherMe.body?.ordinal === null && otherMe.body?.ko_name === null && otherMe.body?.date_of_birth === null, otherMe.body);

  // --- #10 eligibility: tiers from seeded seconds ---------------------------
  check("eliglow login", (await elig.login("eliglow")).status === 200);
  const tr = await elig.call("GET", "/api/me/time-requirements");
  const items: any[] = tr.body?.items ?? [];
  const cur = items.find((i) => i.month === current);
  const prev = items.find((i) => i.month === last);
  check("time-requirements 200, current month always present", tr.status === 200 && !!cur, tr.body);
  check("thresholds are 144000/288000 from the server",
    JSON.stringify(cur?.thresholds?.map((t: any) => t.seconds)) === "[144000,288000]", cur?.thresholds);
  check("eliglow current 83400s → no projected tier", cur?.recognized_seconds === 83400 && cur?.projected_tier === null, cur);
  check("eliglow last month met tier_1, final undecided (never auto-filled)",
    prev?.result?.status === "met" && prev?.result?.tier === "tier_1" && prev?.final?.status === "undecided", prev);
  check("bad month 400", (await elig.call("GET", "/api/me/time-requirements?month=2026-13")).status === 400);

  // --- #10 notifications via dev decide (same path as the 1st-09:00 job) ---
  const before = await elig.call("GET", "/api/notifications/unread-count");
  const decided = await elig.call("POST", "/api/dev/time-requirements/decide", { month: last });
  check("dev decide 200 → met tier_1", decided.status === 200 && decided.body?.result?.status === "met" && decided.body?.result?.tier === "tier_1", decided.body);
  const list = await elig.call("GET", "/api/notifications");
  const note = list.body?.items?.find((n: any) => n.kind === "time_requirement_decided");
  check("decision notification listed", !!note, list.body);
  const after = await elig.call("GET", "/api/notifications/unread-count");
  check("unread-count grew after decide", (after.body?.count ?? 0) >= (before.body?.count ?? 0), { before: before.body, after: after.body });
  check("other student reading my notification 404",
    (await otherStudent.call("POST", `/api/notifications/${note.id}/read`)).status === 404);
  check("read-one 204", (await elig.call("POST", `/api/notifications/${note.id}/read`)).status === 204);
  check("read-one idempotent 204", (await elig.call("POST", `/api/notifications/${note.id}/read`)).status === 204);
  check("read-all 204 → unread 0",
    (await elig.call("POST", "/api/notifications/read-all")).status === 204 &&
    (await elig.call("GET", "/api/notifications/unread-count")).body?.count === 0);
} catch (e) {
  fail++;
  console.log(`FAIL ${(e as Error).message}`);
}

console.log(`\napi-coverage: passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);
