// 보완 제출 e2e: a demo student whose newest submission is already `revision_requested`
// (set up through the API and POST /api/dev/submissions/{id}/status) opens the home hero,
// follows it to the supplement screen, uploads the requested documents and submits.
//
//   E2E_USER=<demo login> EXPECT_PATH=/submit/initial EXPECT_SLOTS=1 \
//   E2E_SCRIPT=e2e/revision.ts e2e/chrome.sh   (BASE_URL=http://localhost:4200 for the dev server)
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

const USER = process.env.E2E_USER ?? "";
const EXPECT_PATH = process.env.EXPECT_PATH ?? "/submit";
const EXPECT_SLOTS = Number(process.env.EXPECT_SLOTS ?? "1");
if (!USER) throw new Error("set E2E_USER");

try {
  await go(`${BASE}/login?demo=${USER}`);
  await waitFor(loginReady, "the login button");
  await click("button.login");
  await waitFor("location.pathname === '/home' && document.querySelector('.hero h2')", "home");
  check("hero: 보완이 필요한 서류가 있어요", (await text(".hero h2")) === "보완이 필요한 서류가 있어요", await text(".hero h2"));
  check("tag 서류 보완 필요", (await text(".tag")) === "서류 보완 필요", await text(".tag"));
  await shot("rev-1-home");
  await js("[...document.querySelectorAll('.hero button')].find(b => b.textContent.includes('보완 제출하기')).click();");
  await waitFor(`location.pathname === '${EXPECT_PATH}' && document.querySelector('app-upload-slot')`, `${EXPECT_PATH} with slots`);
  check(`hero → ${EXPECT_PATH}`, true);
  const slots = await findAll("app-upload-slot input[type=file]");
  check(`only the requested documents are shown (${EXPECT_SLOTS})`, slots.length === EXPECT_SLOTS, slots.length);
  check("review comment visible", await bodyHas("보완 요청"));
  await shot("rev-2-supplement");
  for (const [i, input] of slots.entries()) {
    await wd("POST", S(`/element/${input}/value`), { text: pdfs[i] });
    await waitFor(`!document.querySelector('.bar button:last-child')?.disabled`, `upload ${i + 1}`).catch(() => {});
  }
  await waitFor(
    "[...document.querySelectorAll('.bar button')].some(b => b.textContent.includes('다시 제출하기') && !b.disabled)",
    "submit enabled",
  );
  await shot("rev-3-ready");
  await js("[...document.querySelectorAll('.bar button')].find(b => b.textContent.includes('다시 제출하기')).click();");
  // /submit/initial goes home by itself; /submit stays on the U04 done screen
  await waitFor("location.pathname === '/home' || document.body.innerText.includes('홈으로')", "submitted", 30_000);
  await go(`${BASE}/home`);
  await waitFor("document.querySelector('.hero .tag')?.textContent.includes('재검토 대기')", "home 재검토 대기", 30_000);
  check("home shows 재검토 대기", (await text(".tag")) === "재검토 대기", await text(".tag"));
  await shot("rev-4-home-resubmitted");
} catch (e) {
  fail++;
  console.log(`FAIL ${(e as Error).message}`);
  await shot("rev-failure").catch(() => {});
} finally {
  await wd("DELETE", S("")).catch(() => {});
}

console.log(`\n${BROWSER}: passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);
