// Local demo only. Real browser checks for the admin API integrations.
// E2E_SCRIPT=e2e/admin.ts E2E_HEADLESS=1 make e2e-chrome
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const base = process.env.ADMIN_BASE_URL ?? "https://admin.localhost:8443";
const staffLogin = process.env.ADMIN_TEST_LOGIN ?? "accounttest";
if (
  !["localhost", "admin.localhost", "127.0.0.1"].includes(
    new URL(base).hostname,
  )
) {
  throw new Error(
    "This test creates synthetic demo submissions and requires a local origin.",
  );
}
const driver = process.env.WEBDRIVER_URL ?? "http://127.0.0.1:9515";
const artifacts = join(import.meta.dir, "artifacts", "admin");
const downloadDirectory = "/tmp/otus-admin-downloads-" + crypto.randomUUID();
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
async function login() {
  await go("/login");
  await wait("document.querySelector('#demo-login')", "demo login");
  await js(
    "const e = document.querySelector('#demo-login'); e.value = arguments[0]; e.dispatchEvent(new Event('input', {bubbles:true}));",
    staffLogin,
  );
  await clickText("로그인");
  await wait(
    "location.pathname === '/' && document.body.innerText.includes('월별 제출 내역')",
    "admin dashboard",
  );
}
function pdf(): string {
  const content = "BT /F1 18 Tf 72 720 Td (OTUS SYNTHETIC ADMIN TEST) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let file = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [i, object] of objects.entries()) {
    offsets.push(file.length);
    file += i + 1 + " 0 obj\n" + object + "\nendobj\n";
  }
  const xref = file.length;
  file += "xref\n0 6\n0000000000 65535 f \n";
  for (const offset of offsets)
    file += String(offset).padStart(10, "0") + " 00000 n \n";
  return (
    file +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF\n"
  );
}

async function submitFixture(kind: "initial" | "monthly", month: string) {
  const submission = await api("/api/submissions", "POST", {
    kind,
    target_month: month,
  });
  for (const type of submission.required_doc_types) {
    await browser(
      async (id, type, contents) => {
        const form = new FormData();
        form.append("doc_type", type);
        form.append(
          "file",
          new Blob([contents], { type: "application/pdf" }),
          type + ".pdf",
        );
        const csrf =
          document.cookie
            .split("; ")
            .find((c) => c.startsWith("XSRF-TOKEN="))
            ?.slice(11) ?? "";
        const response = await fetch("/api/submissions/" + id + "/files", {
          method: "POST",
          headers: { "X-XSRF-TOKEN": decodeURIComponent(csrf) },
          body: form,
        });
        if (!response.ok)
          throw new Error(
            "upload: " + response.status + " " + (await response.text()),
          );
        return true;
      },
      submission.id,
      type,
      pdf(),
    );
  }
  await api("/api/submissions/" + submission.id + "/finalize", "POST");
  return submission;
}

try {
  mkdirSync(downloadDirectory);
  const session = await wd("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        acceptInsecureCerts: true,
        "goog:loggingPrefs": { browser: "ALL" },
        "goog:chromeOptions": {
          ...(process.env.CHROME_BINARY
            ? { binary: process.env.CHROME_BINARY }
            : {}),
          args: [
            "--headless=new",
            "--window-size=1440,1000",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--host-resolver-rules=MAP admin.localhost 127.0.0.1",
          ],
          prefs: {
            "download.default_directory": downloadDirectory,
            "download.prompt_for_download": false,
          },
        },
      },
    },
  });
  sid = session.sessionId;
  await wd("POST", sessionPath("/timeouts"), { script: 60000 });
  await login();
  const me = await api("/api/me");
  if (!me.is_demo || me.role !== "accountant")
    throw new Error("Seeded demo accountant required");
  const monthly = await api("/api/admin/submissions");
  const month = monthly.month;
  await screenshot("01-dashboard");
  console.log("PASS admin login and real dashboard");

  // Supply a pending user even when staff have already handled the seeded queue.
  const loginName = "ui_" + crypto.randomUUID().slice(0, 8);
  await api("/api/auth/demo-login", "POST", { login: loginName });
  const submission = await submitFixture("initial", month);
  await api("/api/auth/logout", "POST");
  await login();

  await go("/submissions?query=supplementdemo");
  await textWait("보완 1회");
  await screenshot("02-submissions");
  await js("document.querySelector('.chain a').click()");
  await textWait("제출·보완 이력");
  await wait(
    "document.querySelector('app-pdf-viewer canvas:not([hidden])')?.width > 0",
    "actual PDF canvas",
  );
  await screenshot("03-supplement");
  console.log("PASS monthly list, supplement history and PDF viewer");

  const previousPath = await js("return location.pathname");
  await js(
    "const button = document.querySelector('.user-navigation button:not(:disabled)'); if (!button) throw Error('Seeded review queue requires another user'); button.click();",
  );
  await wait(
    "location.pathname !== " +
      JSON.stringify(previousPath) +
      " && document.querySelector('app-submission-review-view h1')",
    "sequential review navigation",
  );
  console.log("PASS navigation to another pending submission");

  // Approve only the fresh synthetic submission; existing demo reviews stay intact.
  await go("/submissions/" + submission.id);
  await textWait("첫 서류를 확인해주세요");
  for (let index = 0; index < 4; index++) {
    await js(
      "document.querySelectorAll('[role=tab]')[arguments[0]].click()",
      index,
    );
    await Bun.sleep(150);
  }
  await clickText("승인 검토");
  await textWait("승인하기 전에");
  await clickText("모두 승인하기");
  await textWait("서류를 승인했어요");
  if (
    (await api("/api/admin/submissions/" + submission.id)).status !== "approved"
  )
    throw new Error("Approval was not persisted");
  await screenshot("04-approved");
  console.log("PASS explicit approval persists before the result page");

  await api("/api/auth/demo-login", "POST", { login: loginName });
  const monthlySubmission = await submitFixture("monthly", month);
  await api("/api/auth/logout", "POST");
  await login();
  await go("/submissions?query=" + loginName);
  await wait(
    "document.querySelector('.chain a')?.getAttribute('href')?.includes(" +
      JSON.stringify(submission.id) +
      ")",
    "initial submission review link",
  );
  const row = await api(
    "/api/admin/submissions?month=" + month + "&query=" + loginName,
  );
  if (
    row.items.length !== 1 ||
    row.items[0].chains.length !== 1 ||
    row.items[0].chains[0].root_submission_id !== submission.id
  )
    throw new Error(
      "Initial-month list must contain only the initial submission chain",
    );
  if (
    (await js("return document.querySelectorAll('.chain a').length")) !== 1 ||
    (await js(
      "return !!document.querySelector('a[href*=\"' + arguments[0] + '\"]')",
      monthlySubmission.id,
    ))
  )
    throw new Error(
      "Duplicate monthly review link appeared in the initial month",
    );
  let after: string | null = null;
  do {
    const queue = await api(
      "/api/admin/review-queue?month=" +
        month +
        "&limit=50" +
        (after ? "&after=" + encodeURIComponent(after) : ""),
    );
    if (
      queue.items.some(
        (item: { id: string }) => item.id === monthlySubmission.id,
      )
    )
      throw new Error(
        "Duplicate monthly submission appeared in the review queue",
      );
    after = queue.next_after;
  } while (after);
  await screenshot("05-initial-month-only");
  console.log(
    "PASS initial-month list and queue omit the redundant monthly review",
  );

  // Retained original records remain accessible through their direct detail URL.
  await go("/submissions/" + monthlySubmission.id);
  await textWait("서류를 확인해주세요");
  await clickText("보완 요청");
  await textWait("보완 사유 · 필수");
  const reason = "더미 서류 검증: 발급일이 보이도록 다시 제출해 주세요.";
  await js(
    "const e = document.querySelector('#reason'); e.value = arguments[0]; e.dispatchEvent(new Event('input', {bubbles:true}));",
    reason,
  );
  await clickText("보완 요청 확정");
  await textWait("보완을 요청했어요");
  const reviewed = await api("/api/admin/submissions/" + monthlySubmission.id);
  if (
    reviewed.status !== "revision_requested" ||
    reviewed.review_comment !== reason
  )
    throw new Error("Revision request was not persisted");
  await screenshot("05-revision");
  console.log("PASS explicit revision request and saved reason");

  await go("/archive/" + month);
  await textWait("보완검토 샘플");
  await js(
    "const e = document.querySelector('input[type=search]'); e.value = arguments[0]; e.dispatchEvent(new Event('input', {bubbles:true}));",
    loginName,
  );
  if (
    await js("return document.querySelector('details.advanced-filters').open")
  )
    throw new Error("Detailed filters should start collapsed");
  if (
    !(await js(
      "return document.querySelector('input[type=search]').getBoundingClientRect().top < document.querySelector('details.advanced-filters').getBoundingClientRect().top",
    ))
  )
    throw new Error("Student search must appear above detailed filters");
  await screenshot("06-archive-collapsed");
  await js(
    "document.querySelector('details.advanced-filters summary').click()",
  );
  await wait(
    "document.querySelector('details.advanced-filters').open",
    "detailed filters opened",
  );
  for (const [name, value] of [
    ["archive-status", "approved"],
    ["archive-status", "revision_requested"],
    ["archive-kind", "initial"],
    ["archive-kind", "monthly"],
  ]) {
    await js(
      "document.querySelector('input[name=' + arguments[0] + '][value=' + arguments[1] + ']').click()",
      name,
      value,
    );
    await wait(
      "!document.querySelector('input[name=archive-status]').matches(':disabled')",
      "checkbox filter applied",
    );
  }
  await textWait("다운로드 대상 1명");
  await screenshot("06-archive-filtered");
  if (
    (await js(
      "return document.querySelectorAll('tbody input[type=checkbox]:checked').length",
    )) !== 1
  )
    throw new Error("Only the new synthetic student may be exported");
  await clickText("내려받기 옵션");
  await textWait("적용 조건: 서류 승인, 재검토 요청 · 최초 4종, 월별 서류");
  await textWait("PDF 5개");
  await clickText("자료함으로 돌아가기");
  await textWait("다운로드 대상 1명");
  await wait(
    "!document.querySelector('input[name=archive-status]').matches(':disabled')",
    "filtered archive reloaded",
  );
  if (
    (await js(
      "return document.querySelectorAll('details input:checked').length",
    )) !== 4
  )
    throw new Error("Selected checkbox conditions were lost on navigation");
  await js(
    "document.querySelector('details.advanced-filters summary').click()",
  );
  await wait(
    "document.querySelector('details.advanced-filters').open",
    "selected filters reopened",
  );
  await js(
    "document.querySelector('details.advanced-filters summary').click()",
  );
  await wait(
    "!document.querySelector('details.advanced-filters').open",
    "selected filters collapsed",
  );
  await textWait("적용 조건: 서류 승인, 재검토 요청 · 최초 4종, 월별 서류");
  await screenshot("06-archive-selected-collapsed");
  // Inject one transient file-response 429, then use the real server response.
  // The server cooldown is separately exercised in the isolated API tests.
  await js(`
    const original = XMLHttpRequest.prototype.open;
    window.archiveFileRequests = 0;
    window.archiveCreateRequests = 0;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      const path = new URL(url, location.origin).pathname;
      if (method === 'POST' && /\\/archive\\/[^/]+\\/exports$/.test(path)) {
        window.archiveCreateRequests++;
        const send = this.send;
        this.send = function(body) {
          window.archiveRequestBody = JSON.parse(body);
          return send.call(this, body);
        };
      }
      if (method === 'GET' && /\\/archive\\/[^/]+\\/exports\\/[^/]+\\/file$/.test(path)) {
        window.archiveFileRequests++;
        if (window.archiveFileRequests === 1) {
          const response = new Blob([JSON.stringify({error: {code: 'RATE_LIMITED', message: '잠시 후 다시 시도해 주세요.'}})], {type: 'application/json'});
          Object.defineProperties(this, {
            status: {get: () => 429},
            statusText: {get: () => 'Too Many Requests'},
            response: {get: () => response}
          });
          this.getAllResponseHeaders = () => 'content-type: application/json\\r\\nretry-after: 3\\r\\n';
          this.getResponseHeader = (name) => name.toLowerCase() === 'retry-after' ? '3' : name.toLowerCase() === 'content-type' ? 'application/json' : null;
        } else {
          XMLHttpRequest.prototype.open = original;
        }
      }
      return original.call(this, method, url, ...rest);
    };
  `);
  await clickText("내려받기");
  await textWait("다운로드 순서를 기다리고 있어요");
  await screenshot("06-zip-wait");
  await textWait("브라우저의 다운로드 목록");
  await textWait("PDF 5개");
  if (
    (await js(
      "return window.archiveRequestBody.user_ids.length === 1 && window.archiveRequestBody.expected_pdf_count === 5 && window.archiveRequestBody.filters.status === 'approved,revision_requested' && window.archiveRequestBody.filters.kind === 'initial,monthly'",
    )) !== true
  )
    throw new Error(
      "Filtered selection and PDF count did not reach the ZIP API",
    );
  if (
    (await js(
      "return window.archiveFileRequests === 2 && window.archiveCreateRequests === 1",
    )) !== true
  )
    throw new Error(
      "Rate-limited file must retry the same ZIP without creating another job",
    );
  const downloadTimeout = Date.now() + 10000;
  while (
    !readdirSync(downloadDirectory).some((name) => name.endsWith(".zip")) &&
    Date.now() < downloadTimeout
  )
    await Bun.sleep(100);
  const downloaded = readdirSync(downloadDirectory).find((name) =>
    name.endsWith(".zip"),
  );
  if (
    !downloaded ||
    readFileSync(join(downloadDirectory, downloaded))
      .subarray(0, 4)
      .toString("hex") !== "504b0304"
  )
    throw new Error("Browser did not save a ZIP file");
  await screenshot("06-zip");
  console.log(
    "PASS checkbox multi-select and disclosure persistence, scoped ZIP preview/create, 429 wait and automatic file retry/download",
  );

  await go("/notices");
  const notice = await api("/api/admin/notices/submission-reminder");
  await textWait("제출 안내");
  if (notice.targets.length) await textWait(notice.targets[0].login);
  await screenshot("07-notices");
  if (
    await js("return document.body.innerText.includes('관리자 API가 준비되면')")
  )
    throw new Error("Placeholder remained");
  console.log(
    "PASS actual reminder targets and SMTP availability (no notice sent)",
  );
} catch (error) {
  if (sid) await screenshot("failure").catch(() => {});
  if (sid)
    console.error(
      await wd("POST", sessionPath("/log"), { type: "browser" }).catch(
        () => "Browser log unavailable",
      ),
    );
  throw error;
} finally {
  if (sid) await wd("DELETE", sessionPath("")).catch(() => {});
  rmSync(downloadDirectory, { recursive: true, force: true });
}
