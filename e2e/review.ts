// Local demo only. PDF teardown and continuous review regression checks.
// E2E_SCRIPT=e2e/review.ts E2E_HEADLESS=1 make e2e-chrome
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const base = process.env.ADMIN_BASE_URL ?? "https://admin.localhost:8443";
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
const artifacts = join(import.meta.dir, "artifacts", "review");
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
    "const e = document.querySelector('#demo-login'); e.value = 'accountdemo'; e.dispatchEvent(new Event('input', {bubbles:true}));",
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

async function clickButton(text: string) {
  const element = await wd("POST", sessionPath("/element"), {
    using: "xpath",
    value: "//button[contains(., '" + text + "') and not(@disabled)]",
  });
  await wd(
    "POST",
    sessionPath("/element/" + Object.values(element)[0] + "/click"),
    {},
  );
}
async function pdfReady() {
  await wait(
    "document.querySelector('app-pdf-viewer canvas:not([hidden])')?.width > 0",
    "rendered PDF before leaving",
  );
}
async function checkDocuments() {
  const count = await js(
    "return document.querySelectorAll('[role=tab]').length",
  );
  for (let index = 0; index < count; index++) {
    await js(
      "document.querySelectorAll('[role=tab]')[arguments[0]].click()",
      index,
    );
    await Bun.sleep(150);
    await pdfReady();
  }
}
async function navigationVisible() {
  await wait(
    "document.querySelector('.user-navigation button')",
    "user navigation",
  );
  const valid = await js(
    "const n=document.querySelector('.user-navigation').getBoundingClientRect(); const main=document.querySelector('main').getBoundingClientRect(); return n.right <= main.right && n.left > main.left + main.width / 3 && [...document.querySelectorAll('.user-navigation button')].length === 2",
  );
  if (!valid)
    throw Error("Both navigation buttons must appear at the upper right");
}
try {
  const session = await wd("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "chrome",
        acceptInsecureCerts: true,
        "goog:loggingPrefs": { browser: "ALL" },
        "goog:chromeOptions": {
          binary: process.env.CHROME_BINARY,
          args: [
            "--headless=new",
            "--window-size=1440,1000",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--host-resolver-rules=MAP admin.localhost 127.0.0.1",
          ],
        },
      },
    },
  });
  sid = session.sessionId;
  await wd("POST", sessionPath("/timeouts"), { script: 60000 });
  await login();
  const month = (await api("/api/admin/submissions")).month;
  let submission: { id: string };
  // Review queues change while staff work. Supply two independent synthetic users.
  for (let index = 0; index < 2; index++) {
    await api("/api/auth/demo-login", "POST", {
      login: "review_ui_" + crypto.randomUUID().slice(0, 8),
    });
    submission = await submitFixture("initial", month);
  }
  await api("/api/auth/logout", "POST");
  await login();
  await go("/submissions");
  await textWait("연속 검토 시작");
  await wait(
    "!document.querySelector('.actions button').disabled",
    "review queue loaded",
  );
  await clickButton("연속 검토 시작");
  await wait(
    "document.querySelector('app-submission-review-view h1')",
    "queue first review",
  );
  const firstPath = await js("return location.pathname");
  const firstTitle = await js(
    "return document.querySelector('h1').textContent",
  );
  await pdfReady();
  await navigationVisible();
  await screenshot("01-review-navigation");
  console.log(
    "PASS continuous review starts with rendered PDF and top-right user controls",
  );

  // Reproduce the original failure with a real click after PDF.js has fully loaded.
  for (let pass = 0; pass < 2; pass++) {
    await checkDocuments();
    await clickButton("승인 검토");
    await textWait("승인하기 전에");
    await navigationVisible();
    await screenshot("02-confirm-" + pass);
    await clickButton("돌아가서 다시 확인");
    await pdfReady();
    await clickButton("다음 사용자");
    await wait(
      "location.pathname !== " +
        JSON.stringify(firstPath) +
        " && document.querySelector('app-submission-review-view h1')",
      "next user",
    );
    await pdfReady();
    if (
      (await js("return document.querySelector('h1').textContent")) ===
      firstTitle
    )
      throw Error("Next user did not change");
    await checkDocuments();
    await clickButton("승인 검토");
    await textWait("승인하기 전에");
    await navigationVisible();
    await clickButton("이전 사용자");
    await wait(
      "location.pathname === " +
        JSON.stringify(firstPath) +
        " && document.querySelector('app-submission-review-view h1')",
      "previous user from confirmation",
    );
    await pdfReady();
  }
  console.log(
    "PASS repeated PDF/approval transitions and previous/next user navigation without a blank page",
  );

  // Only mutate a fresh synthetic student, never an existing review in the queue.
  await go("/submissions/" + submission!.id);
  await pdfReady();
  await checkDocuments();
  await clickButton("승인 검토");
  await textWait("승인하기 전에");
  await clickButton("모두 승인하기");
  await textWait("서류를 승인했어요");
  await navigationVisible();
  if (
    (await api("/api/admin/submissions/" + submission!.id)).status !==
    "approved"
  )
    throw Error("Approval was not saved");
  await screenshot("03-approved-navigation");
  await clickButton("이전 사용자");
  await pdfReady();
  console.log("PASS saved approval and user navigation from the result page");
  const errors = (
    await wd("POST", sessionPath("/log"), { type: "browser" })
  ).filter(
    (entry: any) => entry.level === "SEVERE" && entry.source !== "network",
  );
  if (errors.length) throw Error(JSON.stringify(errors));
  console.log("PASS no browser runtime errors");
} catch (error) {
  if (sid) await screenshot("failure").catch(() => {});
  if (sid)
    console.log(
      "FAILURE_STATE",
      await js(
        "return {path:location.pathname, text:document.querySelector('main')?.innerText.slice(0,1000)}",
      ),
    );
  if (sid)
    console.log(
      "BROWSER_ERRORS",
      await wd("POST", sessionPath("/log"), { type: "browser" }),
    );
  throw error;
} finally {
  if (sid) await wd("DELETE", sessionPath("")).catch(() => {});
}
