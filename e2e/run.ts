// End-to-end test of the UI against a running OTUS (`make demo`), over plain W3C WebDriver,
// so the same checks drive Safari (safaridriver) and Chrome for Testing (chromedriver).
//
//   WEBDRIVER_URL=http://127.0.0.1:4723 BROWSER=safari bun e2e/run.ts
//   BROWSER: safari | safari-tp | chrome   BASE_URL: default https://localhost:8443
//   CHROME_BINARY: path to a Chrome for Testing binary (chrome only)
//   E2E_HEADLESS=1: run Chrome headless locally too (CI always is)
// Usually through `make e2e-chrome` (a temporary Chrome for Testing, see e2e/chrome.sh) or
// `make e2e-safari` (Safari Technology Preview, so an everyday Safari is never automated).
//
// Needs demo login on and 42 OAuth off (the `make demo` defaults) and an open period
// (`make demo` seeds one). Screenshots go to e2e/artifacts/.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DRIVER = process.env.WEBDRIVER_URL ?? "http://127.0.0.1:4723";
const BROWSER = process.env.BROWSER ?? "chrome";
const BASE = (process.env.BASE_URL ?? "https://localhost:8443").replace(/\/$/, "");
const ARTIFACTS = join(import.meta.dir, "artifacts", BROWSER);
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
// A visible, maximized window when run by hand; headless with a fixed size in CI (GitHub
// sets CI=true) or with E2E_HEADLESS=1, so screenshots stay comparable there.
const HEADLESS = process.env.CI === "true" || process.env.E2E_HEADLESS === "1";

function capabilities(): Record<string, unknown> {
  switch (BROWSER) {
    case "safari":
      return { browserName: "safari", acceptInsecureCerts: true };
    case "safari-tp":
      return { browserName: "Safari Technology Preview", acceptInsecureCerts: true };
    case "chrome":
      return {
        browserName: "chrome",
        acceptInsecureCerts: true,
        "goog:chromeOptions": {
          ...(process.env.CHROME_BINARY ? { binary: process.env.CHROME_BINARY } : {}),
          args: [
            ...(HEADLESS ? ["--headless=new", "--window-size=1366,900"] : ["--start-maximized"]),
            "--no-first-run",
            "--disable-gpu",
            // CI runners (Ubuntu 24.04) block the user namespaces Chrome's sandbox needs
            ...(process.env.CHROME_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
          ],
        },
      };
    default:
      throw new Error(`unknown BROWSER ${BROWSER}`);
  }
}

// ---- a minimal W3C WebDriver client ----

async function wd(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${DRIVER}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${method} ${path}: ${json?.value?.error ?? res.status} ${json?.value?.message ?? ""}`);
  }
  return json.value;
}

const session = await wd("POST", "/session", { capabilities: { alwaysMatch: capabilities() } });
const sid: string = session.sessionId;
const S = (p: string) => `/session/${sid}${p}`;
console.log(`${session.capabilities.browserName} ${session.capabilities.browserVersion} → ${BASE}`);

// fill the display so the run is easy to follow (Safari always shows a real window)
if (!HEADLESS || BROWSER.startsWith("safari")) {
  const rect = await wd("POST", S("/window/maximize"), {});
  console.log(`window maximized to ${rect.width}×${rect.height}`);
}

const go = (url: string) => wd("POST", S("/url"), { url });
const js = (script: string, ...args: unknown[]) => wd("POST", S("/execute/sync"), { script, args });
const find = async (css: string) => (await wd("POST", S("/element"), { using: "css selector", value: css }))[ELEMENT] as string;
const findAll = async (css: string) =>
  ((await wd("POST", S("/elements"), { using: "css selector", value: css })) as any[]).map((e) => e[ELEMENT] as string);
const click = async (css: string) => wd("POST", S(`/element/${await find(css)}/click`), {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(condition: string, label: string, timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if ((await js(`return !!(${condition});`)) === true) return;
    await sleep(250);
  }
  const where = await js("return location.href + ' :: ' + document.body.innerText.slice(0, 300);");
  throw new Error(`timed out waiting for ${label} at ${where}`);
}

async function shot(name: string): Promise<void> {
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(join(ARTIFACTS, `${name}.png`), Buffer.from(await wd("GET", S("/screenshot")), "base64"));
}

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok || detail === undefined ? "" : ` (got ${JSON.stringify(detail)})`}`);
}
const text = (css: string) =>
  js(`const e = document.querySelector(arguments[0]); return e ? e.textContent.trim().replace(/\\s+/g, ' ') : null;`, css);
const bodyHas = (s: string) => js("return document.body.innerText.includes(arguments[0]);", s);
const loginReady = "document.querySelector('button.login') && !document.querySelector('button.login').disabled";

// PDFs to upload: the driver reads them from the local filesystem
const fixtures = mkdtempSync(join(tmpdir(), "otus-e2e-"));
const pdfs = [1, 2, 3, 4].map((n) => {
  const path = join(fixtures, `doc${n}.pdf`);
  writeFileSync(path, `%PDF-1.4\n% e2e ${BROWSER} ${n} ${Date.now()}\n%%EOF\n`);
  return path;
});

try {
  // 0. the 42 button in this demo pod (no 42 OAuth configured): it must show
  // the not-configured error and must NOT quietly open a demo session. The
  // separate demo field, typed with a different seeded ID, is the login.
  await go(`${BASE}/login`);
  await waitFor(loginReady, "the login button");
  await click("button.login");
  await waitFor(
    "document.body.innerText.includes('42 로그인이 설정되어 있지 않아요')",
    "not-configured error from the 42 button",
  );
  check(
    "42 button shows not-configured error and stays logged out",
    (await js("return location.pathname;")) === "/login" &&
      (await js(
        "const x = new XMLHttpRequest(); x.open('GET', '/api/me', false); x.send(); return x.status;",
      )) === 401,
  );
  check("demo ID field is shown in demo mode", (await findAll("#demo-login")).length === 1);
  await js(`
    const e = document.querySelector('#demo-login');
    e.value = 'seoyeon';
    e.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await click(".demo button");
  await waitFor("location.pathname === '/home'", "home after demo-field login as seoyeon");
  check(
    "demo field logs in as exactly the typed user (seoyeon)",
    String(
      await js(
        "const x = new XMLHttpRequest(); x.open('GET', '/api/me', false); x.send(); return x.responseText;",
      ),
    ).includes('"login":"seoyeon"'),
  );
  await js("[...document.querySelectorAll('button')].find(b => b.textContent.includes('로그아웃')).click();");
  await waitFor("location.pathname === '/login'", "logout");

  // 1. a seeded student, through the login button. The demo pod has no 42
  // OAuth, and the 42 button no longer falls back to a demo session, so the
  // seeded login goes through the explicit ?demo= testing hook.
  await go(`${BASE}/login?demo=dongmin`);
  await waitFor(loginReady, "the login button");
  check("U01: login button enabled once /api/auth/methods loads", true);
  await shot("1-login");
  await click("button.login");
  await waitFor("location.pathname === '/home' && document.querySelector('h1')", "home after login");
  check("U01 → U03 for an existing student", (await js("return location.pathname;")) === "/home");
  const h1 = await text("h1");
  check("U03 due layout for this month", String(h1).includes("서류를 낼 차례예요"), h1);
  await waitFor("document.body.innerText.includes('미취업')", "내 정보");
  check("U03 내 정보: employment from /api/me", await bodyHas("미취업"));
  check("U03 deadline from the real cycle", await bodyHas("23:59"));
  await shot("2-home-due");

  // 2. the session cookie is HttpOnly: JS never sees it
  check("session cookie hidden from JS", (await js("return document.cookie.includes('__Host-session');")) === false);

  // 3. a fresh student: U02 upload through the slots (scanned + encrypted), then submit
  await js("[...document.querySelectorAll('button')].find(b => b.textContent.includes('로그아웃')).click();");
  await waitFor("location.pathname === '/login'", "logout");
  const fresh = `e2e${BROWSER.replace(/[^a-z]/g, "")}${Date.now() % 1e7}`;
  await go(`${BASE}/login?demo=${fresh}`);
  await waitFor(loginReady, "the login button");
  await click("button.login");
  // First login goes through the one-time profile step (기수·한글 이름·
  // 생년월일, PATCH /api/me/profile) before U02; fill it in like a student.
  await waitFor(
    "location.pathname === '/profile' && document.querySelector('#cohort')",
    "profile step after first login",
  );
  check("new student lands on the profile step first", true);
  await js(`
    const set = (sel, value, event) => {
      const e = document.querySelector(sel);
      e.value = value;
      e.dispatchEvent(new Event(event, { bubbles: true }));
    };
    set('#cohort', '4A', 'change');
    set('#korean-name', '홍길동', 'input');
    set('#birth-date', '2000-01-15', 'input');
  `);
  await js("document.querySelector('form button[type=submit]').click();");
  await waitFor(
    "location.pathname === '/initial' && document.querySelectorAll('app-upload-slot input[type=file]').length === 4",
    "U02 with 4 upload slots",
  );
  check("new student lands on U02 with 4 upload slots", true);
  const inputs = await findAll("app-upload-slot input[type=file]");
  for (const [i, input] of inputs.entries()) {
    await wd("POST", S(`/element/${input}/value`), { text: pdfs[i] });
    await waitFor(`document.querySelector('app-count-pill')?.textContent.includes('${i + 1} / 4')`, `upload ${i + 1}`);
  }
  check("4 uploads stored (through the malware scanner)", String(await text("app-count-pill")).includes("4 / 4"));
  await shot("3-initial-ready");
  // 제출 also needs the payout account (bank · account number · holder),
  // which is sent as a bank-account change request together with finalize.
  await js(`
    const set = (sel, value, event) => {
      const e = document.querySelector(sel);
      e.value = value;
      e.dispatchEvent(new Event(event, { bubbles: true }));
    };
    set('#bank', '국민은행', 'change');
    set('#account-number', '123456789012', 'input');
    set('#holder', '홍길동', 'input');
  `);
  await waitFor(
    "[...document.querySelectorAll('.bar button')].some(b => b.textContent.trim() === '첫 서류 제출하기' && !b.disabled)",
    "submit enabled",
  );
  await js("[...document.querySelectorAll('.bar button')].find(b => b.textContent.trim() === '첫 서류 제출하기').click();");
  await waitFor("location.pathname === '/home' && document.querySelector('.hero h2')", "home after submit", 30_000);
  check("finalize → U03 submitted layout", (await text(".hero h2")) === "첫 서류 4개, 잘 도착했어요", await text(".hero h2"));
  check("status tag 서류 확인 중", (await text(".tag")) === "서류 확인 중", await text(".tag"));
  await shot("4-home-submitted");

  // 4. U05 history from the real list
  await go(`${BASE}/history`);
  await waitFor("location.pathname === '/history' && document.body.innerText.includes('최초')", "history");
  check("U05 history lists the submission", await bodyHas("검토"));
  await shot("5-history");
} catch (e) {
  fail++;
  console.log(`FAIL ${(e as Error).message}`);
  await shot("failure").catch(() => {});
} finally {
  await wd("DELETE", S("")).catch(() => {});
}

console.log(`\n${BROWSER}: passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);
