// Local demo only. Period settings UI checks without changing configured periods.
// Save/concurrency/deadline integration is tested in scripts/admin_periods_test.py.
// E2E_SCRIPT=e2e/periods.ts E2E_HEADLESS=1 make e2e-chrome
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.ADMIN_BASE_URL ?? "https://admin.localhost:8443";
if (
  !["localhost", "admin.localhost", "127.0.0.1"].includes(
    new URL(base).hostname,
  )
) {
  throw new Error(
    "This test uses demo staff accounts and requires a local origin.",
  );
}
const driver = process.env.WEBDRIVER_URL ?? "http://127.0.0.1:9515";
const artifacts = join(import.meta.dir, "artifacts", "periods");
let sid = "";
async function wd(method: string, path: string, body?: unknown): Promise<any> {
  const response = await fetch(driver + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json()) as any;
  if (!response.ok) throw new Error(JSON.stringify(data.value));
  return data.value;
}
const sessionPath = (path: string) => "/session/" + sid + path;
const go = (path: string) =>
  wd("POST", sessionPath("/url"), { url: base + path });
const js = (script: string, ...args: unknown[]) =>
  wd("POST", sessionPath("/execute/sync"), { script, args });
async function browser<T>(
  fn: (...args: any[]) => Promise<T>,
  ...args: unknown[]
): Promise<T> {
  const result = await wd("POST", sessionPath("/execute/async"), {
    script:
      "const done = arguments[arguments.length - 1]; (" +
      fn.toString() +
      ")(...Array.from(arguments).slice(0, -1)).then(value => done({value}), error => done({error: String(error)}));",
    args,
  });
  if (result.error) throw new Error(result.error);
  return result.value;
}
async function api(path: string, method = "GET", body?: unknown): Promise<any> {
  return browser(
    async (path, method, body) => {
      const csrf =
        document.cookie
          .split("; ")
          .find((c) => c.startsWith("XSRF-TOKEN="))
          ?.slice(11) ?? "";
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-XSRF-TOKEN": decodeURIComponent(csrf),
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body == null ? undefined : JSON.stringify(body),
      });
      if (!response.ok)
        throw new Error(
          path + ": " + response.status + " " + (await response.text()),
        );
      return response.status === 204 ? null : response.json();
    },
    path,
    method,
    body ?? null,
  );
}
async function wait(expression: string, label: string, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await js("return !!(" + expression + ")")) return;
    await Bun.sleep(100);
  }
  throw new Error(
    "Timed out: " +
      label +
      " :: " +
      (await js("return document.body.innerText.slice(-1600)")),
  );
}
async function textWait(text: string) {
  await wait(
    "document.body.innerText.includes(" + JSON.stringify(text) + ")",
    text,
  );
}
async function clickText(text: string) {
  await js(
    "const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(arguments[0]) && !b.disabled); if (!b) throw Error('Missing enabled button: ' + arguments[0]); b.click();",
    text,
  );
}
async function screenshot(name: string) {
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    join(artifacts, name + ".png"),
    Buffer.from(await wd("GET", sessionPath("/screenshot")), "base64"),
  );
}
async function login(login: string) {
  await go("/login");
  await wait("document.querySelector('#demo-login')", "demo login");
  await js(
    "const e = document.querySelector('#demo-login'); e.value = arguments[0]; e.dispatchEvent(new Event('input', {bubbles:true}));",
    login,
  );
  await clickText("로그인");
  await wait(
    "location.pathname === '/' && document.body.innerText.includes('월별 제출 내역')",
    "admin dashboard",
  );
}
async function input(selector: string, value: string) {
  await js("const e=document.querySelector(arguments[0]); e.value=arguments[1]; e.dispatchEvent(new Event('input',{bubbles:true}));", selector, value);
}
async function openMonth(month: string) {
  await js("document.querySelector('button[aria-label=\"' + arguments[0] + ' 제출 기간\"]').click()", month);
  await wait("document.querySelector('#period-start')", "period editor");
}
async function periodPage() {
  await go("/periods");
  await wait("document.querySelectorAll('tbody tr').length === 12", "twelve months");
}
try {
  const session = await wd("POST", "/session", {
    capabilities: { alwaysMatch: {
      browserName: "chrome", acceptInsecureCerts: true,
      "goog:loggingPrefs": { browser: "ALL" },
      "goog:chromeOptions": { binary: process.env.CHROME_BINARY, args: [
        "--headless=new", "--window-size=1440,1000", "--no-sandbox",
        "--disable-dev-shm-usage", "--host-resolver-rules=MAP admin.localhost 127.0.0.1",
      ] },
    } },
  });
  sid = session.sessionId;
  await wd("POST", sessionPath("/timeouts"), { script: 60000 });
  await login("opsdemo");
  await js("document.querySelector('a[href=\"/periods\"]').click()");
  await wait("document.querySelectorAll('tbody tr').length === 12", "periods menu");
  const page = await api("/api/admin/cycles");
  if (!page.can_manage) throw Error("Operator has no manage permission");
  const current = page.items.find((p: any) => p.target_month === page.current_month);
  if (!current?.version) throw Error("Expected seeded current period");
  await screenshot("01-year");
  await openMonth(current.target_month);
  const kst = (iso: string, offset = 0) => new Date(Date.parse(iso) + 9 * 3600000 + offset).toISOString().slice(0, 19);
  // Browser datetime-local normalizes zero seconds away.
  if (!(await js("return Date.parse(document.querySelector('#period-start').value + '+09:00') === arguments[0] && Date.parse(document.querySelector('#period-end').value + '+09:00') === arguments[1]", Date.parse(current.opens_at), Date.parse(current.closes_at) - 1000))) throw Error("Saved KST period was not displayed accurately");
  await wait("document.querySelector('#period-editor button[type=submit]').disabled", "unchanged save disabled");
  await input("#period-start", "");
  await wait("document.querySelector('#period-editor button[type=submit]').disabled", "empty time rejected");
  await input("#period-start", kst(current.opens_at));
  await screenshot("02-existing-period");
  await periodPage();
  const futureYear = page.year + 1;
  await input("#period-year", String(futureYear));
  await clickText("조회");
  await wait("document.querySelector('button[aria-label=\"" + futureYear + "-01 제출 기간\"]')", "future year loaded");
  const future = await api("/api/admin/cycles?year=" + futureYear);
  const unset = future.items.find((p: any) => p.version === null);
  if (!unset) throw Error("Expected an unconfigured future month");
  await openMonth(unset.target_month);
  await textWait("제출 기간 추가");
  await input("#period-start", unset.target_month + "-21T09:00:00");
  await input("#period-end", unset.target_month + "-28T18:00:00");
  await wait("!document.querySelector('#period-editor button[type=submit]').disabled", "valid new window accepted");
  await screenshot("03-add-period");
  await input("#period-end", unset.target_month + "-20T18:00:00");
  await wait("document.querySelector('#period-editor button[type=submit]').disabled", "reversed window rejected");
  await textWait("대상 월 안에서 시작과 마감 시각을 확인해 주세요.");
  // Leave this input unsaved; real database writes run against the isolated API-test DB.
  await periodPage();
  const past = page.items.find((p: any) => p.target_month < page.current_month);
  if (past) {
    await openMonth(past.target_month);
    await textWait("지난달 기간은 조회만 가능합니다.");
    await wait("document.querySelector('#period-editor fieldset').disabled && !document.querySelector('#period-editor button[type=submit]')", "past month read only");
  }
  console.log("PASS operator menu, 12-month list, KST edit values, future addition form, validation and past-month read only");
  await api("/api/auth/logout", "POST");
  await login("accountdemo");
  await periodPage();
  await openMonth(page.current_month);
  await wait("document.querySelector('#period-editor fieldset').disabled && !document.querySelector('#period-editor button[type=submit]')", "accountant read only");
  await screenshot("04-accountant-readonly");
  const after = await api("/api/admin/cycles");
  if (JSON.stringify(after.items) !== JSON.stringify(page.items)) throw Error("Browser check unexpectedly changed periods");
  const logs = await wd("POST", sessionPath("/log"), { type: "browser" });
  const errors = logs.filter((entry: any) => entry.level === "SEVERE" && entry.source !== "network");
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log("PASS accountant read only, no changes to configured periods, no browser runtime errors");
} catch (error) {
  if (sid) await screenshot("failure").catch(() => {});
  throw error;
} finally {
  if (sid) await wd("DELETE", sessionPath("")).catch(() => {});
}
