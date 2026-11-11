"""Standard-library helpers for the isolated administrator API smoke tests.

Required: DATABASE_URL pointing to otus_admin_test and TEST_BASE_URL pointing to
the already running test backend. TEST_ORIGIN defaults to TEST_BASE_URL; set it
to the backend's configured APP_ORIGIN when the two addresses differ.
No repository .env file is read. SQL is refused against any other database.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import http.cookies
import json
import os
import re
import secrets
import shlex
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid


KST = dt.timezone(dt.timedelta(hours=9))
_today = dt.datetime.now(KST).date()
CURRENT_MONTH = _today.strftime("%Y-%m")
PREVIOUS_MONTH = (_today.replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m")
INITIAL_DOC_TYPES = ("id_card", "resident_abstract", "bankbook", "employment_insurance")
SAMPLE_PDF = (
    b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    b"2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n"
    b"trailer\n<< /Root 1 0 R >>\n%%EOF\n"
)


def new_key() -> str:
    return str(uuid.uuid4())


def quote(value: object) -> str:
    """Quote fixture values, never identifiers. psql receives SQL on stdin."""
    return "'" + str(value).replace("'", "''") + "'"


def _database_url() -> str:
    value = os.environ.get("DATABASE_URL", "")
    if not value:
        raise RuntimeError("DATABASE_URL must explicitly name otus_admin_test")
    if value.startswith(("postgres://", "postgresql://")):
        parsed = urllib.parse.urlsplit(value)
        database = urllib.parse.unquote(parsed.path.removeprefix("/"))
        overrides = urllib.parse.parse_qs(parsed.query)
        if "dbname" in overrides or "service" in overrides:
            raise RuntimeError("Database/service overrides are forbidden in the test URL")
    else:
        try:
            fields = dict(part.split("=", 1) for part in shlex.split(value))
        except ValueError:
            raise RuntimeError("DATABASE_URL must explicitly name otus_admin_test") from None
        database = fields.get("dbname")
        if "service" in fields:
            raise RuntimeError("Database service aliases are forbidden in tests")
    if database != "otus_admin_test":
        raise RuntimeError("Refusing SQL: the database must be otus_admin_test")
    return value


def sql(statement: str) -> str:
    """Run fixture SQL only in otus_admin_test; return unaligned, headerless stdout."""
    database_url = _database_url()
    # Recheck the server's actual database before any supplied fixture statement.
    guard = """DO $test_guard$ BEGIN
      IF current_database() <> 'otus_admin_test' THEN
        RAISE EXCEPTION 'administrator tests require otus_admin_test';
      END IF;
    END $test_guard$;
    """
    env = dict(os.environ, PGCONNECT_TIMEOUT="10")
    result = subprocess.run(
        ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "--dbname", database_url],
        input=guard + statement,
        text=True,
        capture_output=True,
        timeout=30,
        env=env,
    )
    if result.returncode:
        # Do not include argv: a database URL may contain credentials.
        raise RuntimeError("Test fixture SQL failed: " + result.stderr.strip())
    return result.stdout.strip()


def month_window(month: str) -> tuple[str, str]:
    if not re.fullmatch(r"\d{4}-\d{2}", month, flags=re.ASCII):
        raise ValueError("month must be YYYY-MM")
    first = dt.datetime.strptime(month, "%Y-%m").replace(tzinfo=KST)
    following = (first.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return first.isoformat(timespec="seconds"), following.isoformat(timespec="seconds")


def open_cycle(month: str = CURRENT_MONTH) -> None:
    opens, closes = month_window(month)
    sql(
        "INSERT INTO cycles(target_month, opens_at, closes_at) VALUES "
        f"({quote(month + '-01')}, {quote(opens)}, {quote(closes)}) "
        "ON CONFLICT (target_month) DO UPDATE SET "
        "opens_at = EXCLUDED.opens_at, closes_at = EXCLUDED.closes_at;"
    )


def seed_user(login: str, role: str = "student", employed: bool = False) -> int:
    if not re.fullmatch(r"[a-z0-9_-]{1,32}", login):
        raise ValueError("invalid test login")
    if role not in ("student", "operator", "accountant", "admin"):
        raise ValueError("invalid test role")
    return int(sql(
        "INSERT INTO users(login, display_name, role, is_demo, employed) VALUES "
        f"({quote(login)}, {quote(login)}, {quote(role)}, true, {'true' if employed else 'false'}) "
        "ON CONFLICT (login) WHERE is_demo DO UPDATE SET "
        "role = EXCLUDED.role, employed = EXCLUDED.employed RETURNING id;"
    ))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        # A test API request must not send its session cookie to a redirect target.
        return None


class Client:
    """HTTP client with manually managed Secure cookies for local HTTP tests."""

    def __init__(self, login: str | None = None):
        _database_url()
        self.base = os.environ.get("TEST_BASE_URL", "").rstrip("/")
        parsed = urllib.parse.urlsplit(self.base)
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path:
            raise RuntimeError("TEST_BASE_URL must be an explicit HTTP(S) origin")
        self.origin = os.environ.get("TEST_ORIGIN", self.base)
        self.cookies: dict[str, str] = {}
        self.last_status: int | None = None
        self.last_headers = None
        self.me: dict | None = None
        self._opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), _NoRedirect(),
        )
        if login is not None:
            self.me = self.request("POST", "/api/auth/demo-login", {"login": login})

    @classmethod
    def sql_session(cls, user_id: int) -> "Client":
        """Avoid login rate limits and prove the HTTP server uses the guarded DB."""
        client = cls()
        session, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        session_hash = hashlib.sha256(session.encode()).hexdigest()
        csrf_hash = hashlib.sha256(csrf.encode()).hexdigest()
        sql(
            "INSERT INTO sessions(id_hash,user_id,csrf_hash,created_at,last_seen_at,expires_at) "
            f"VALUES(decode({quote(session_hash)},'hex'),{int(user_id)},"
            f"decode({quote(csrf_hash)},'hex'),now(),now(),now()+interval '12 hours');"
        )
        client.cookies = {"__Host-session": session, "XSRF-TOKEN": csrf}
        client.me = client.request("GET", "/api/me")
        if client.me["id"] != int(user_id):
            raise AssertionError("HTTP server is not connected to the fixture database")
        return client

    def _send(self, method, path, data, content_type, expected, key):
        if not path.startswith("/api/") or path.startswith("//"):
            raise ValueError("test requests must use a relative /api/ path")
        headers = {"Accept": "application/json"}
        if self.cookies:
            headers["Cookie"] = "; ".join(f"{name}={value}" for name, value in self.cookies.items())
        if method not in ("GET", "HEAD", "OPTIONS"):
            headers["Origin"] = self.origin
            if "XSRF-TOKEN" in self.cookies:
                headers["X-XSRF-TOKEN"] = self.cookies["XSRF-TOKEN"]
        if content_type:
            headers["Content-Type"] = content_type
        if key is not None:
            headers["Idempotency-Key"] = key
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            response = self._opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            self.last_status = response.status
            self.last_headers = response.headers
            payload = response.read()
            for raw in response.headers.get_all("Set-Cookie", []):
                values = http.cookies.SimpleCookie()
                values.load(raw)
                for name, cookie in values.items():
                    if not cookie.value or cookie["max-age"] == "0":
                        self.cookies.pop(name, None)
                    else:
                        self.cookies[name] = cookie.value
            if "application/json" in response.headers.get("Content-Type", ""):
                result = json.loads(payload)
            else:
                result = payload
        allowed = (expected,) if isinstance(expected, int) else tuple(expected)
        if self.last_status not in allowed:
            # Fixtures contain no real documents, accounts or credentials.
            detail = result.get("error") if isinstance(result, dict) else repr(result[:160])
            raise AssertionError(
                f"{method} {path}: HTTP {self.last_status}, expected {allowed}; {detail}"
            )
        return result

    def request(self, method: str, path: str, body=None, expected=200, key=None):
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        return self._send(method.upper(), path, data, "application/json" if data else None, expected, key)

    def upload(self, submission_id: str, doc_type: str, pdf_bytes: bytes = SAMPLE_PDF) -> dict:
        if doc_type not in INITIAL_DOC_TYPES:
            raise ValueError("unknown fixture document type")
        boundary = "otus-test-" + uuid.uuid4().hex
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"doc_type\"\r\n\r\n{doc_type}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{doc_type}.pdf\"\r\n"
            "Content-Type: application/pdf\r\n\r\n"
        ).encode() + pdf_bytes + f"\r\n--{boundary}--\r\n".encode()
        return self._send(
            "POST", f"/api/submissions/{submission_id}/files", body,
            f"multipart/form-data; boundary={boundary}", 201, None,
        )

    def create_finalize(self, kind="initial", month=CURRENT_MONTH, parent_id=None, doc_types=None):
        body = {"kind": kind, "target_month": month}
        if parent_id is not None:
            body["parent_id"] = parent_id
        draft = self.request("POST", "/api/submissions", body, expected=(200, 201))
        types = draft["required_doc_types"] if doc_types is None else doc_types
        for doc_type in types:
            self.upload(draft["id"], doc_type)
        return self.request("POST", f"/api/submissions/{draft['id']}/finalize", key=new_key())


def upload(client: Client, submission_id: str, doc_type: str, pdf_bytes: bytes = SAMPLE_PDF):
    return client.upload(submission_id, doc_type, pdf_bytes)


def create_finalize(client: Client, kind="initial", month=CURRENT_MONTH, parent_id=None, doc_types=None):
    return client.create_finalize(kind, month, parent_id, doc_types)
