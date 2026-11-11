#!/usr/bin/env python3
"""Verify /api/me study_hours using the isolated test DB and a local 42 API.

Run after scripts/admin-verify-in-container.sh's migrations/build. By default,
only synthetic credentials and sessions are used. Real 42 reads require both
--live-env and --live-login; the database always remains isolated.
"""
import argparse
import base64
import datetime as dt
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
import uuid

from admin_api_testlib import Client, CURRENT_MONTH, KST, PREVIOUS_MONTH, seed_user, sql


class FortyTwoHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def respond(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        assert self.path == "/oauth/token"
        self.respond(200, {"access_token": "synthetic-token"})

    def do_GET(self):
        url = urllib.parse.urlsplit(self.path)
        login = url.path.split("/")[-2]
        query = urllib.parse.parse_qs(url.query)
        if login.startswith("hoursfail_"):
            self.respond(503, {"error": "synthetic failure"})
            return
        assert self.headers["Authorization"] == "Bearer synthetic-token"
        assert query["page[size]"] == ["100"]
        if "range[begin_at]" in query:
            start, end = query["range[begin_at]"][0].split(",")
            assert dt.datetime.fromisoformat(start).astimezone(KST).day == 1
            assert dt.datetime.fromisoformat(end) > dt.datetime.fromisoformat(start)
        # Return the same records from all three query paths: ID deduplication
        # must happen before the daily cap, otherwise the 4h day is overcounted.
        self.respond(200, self.server.rows)


def bucket(seconds):
    return 80 if seconds >= 80 * 3600 else 40 if seconds >= 40 * 3600 else 0


def live_credentials(path):
    """Read only the app credentials; never print or persist their values."""
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip().removeprefix("export ")
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw = line.split("=", 1)
        if key.strip() in ("FORTY_TWO_CLIENT_ID", "FORTY_TWO_CLIENT_SECRET"):
            parts = shlex.split(raw, comments=True)
            if len(parts) == 1:
                values[key.strip()] = parts[0]
    if not all(values.get(key) for key in ("FORTY_TWO_CLIENT_ID", "FORTY_TWO_CLIENT_SECRET")):
        raise RuntimeError("42 app credentials are missing from the supplied env file")
    return values


def exercise_live(login, env):
    """Compare the real Rust /api/me response with an independent daily sum."""
    before = dt.datetime.now(KST)
    user_id = seed_user(login)
    sql(f"UPDATE users SET is_demo=false,intra_id={user_id + 2000000} WHERE id={user_id}")
    client = Client.sql_session(user_id)
    after = dt.datetime.now(KST)
    actual = client.me["study_hours"]
    if actual is None:
        raise AssertionError("real 42 lookup returned study_hours=null")
    print(f"PASS real backend /api/me: login={login}, study_hours={actual}", flush=True)

    def request_json(request):
        request.add_header("User-Agent", "otus-backend")
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                status = error.code
                retry = error.headers.get("Retry-After", "2")
                error.close()
                if status == 429 and attempt < 2:
                    time.sleep(min(int(retry), 60))
                    continue
                raise RuntimeError(f"42 reference request failed: HTTP {status}") from None
        raise RuntimeError("42 reference retry exhausted")

    base = "https://api.intra.42.fr"
    token = request_json(urllib.request.Request(base + "/oauth/token", data=urllib.parse.urlencode({
        "grant_type": "client_credentials", "client_id": env["FORTY_TWO_CLIENT_ID"],
        "client_secret": env["FORTY_TWO_CLIENT_SECRET"],
    }).encode()))["access_token"]
    start = before.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    time_range = start.isoformat() + "," + dt.datetime.now(KST).isoformat()
    locations = {}
    for key, value in (("range[begin_at]", time_range), ("range[end_at]", time_range), ("filter[active]", "true")):
        page = 1
        while True:
            time.sleep(0.6)
            query = urllib.parse.urlencode({key: value, "sort": "begin_at", "page[size]": 100, "page[number]": page})
            rows = request_json(urllib.request.Request(
                base + "/v2/users/" + urllib.parse.quote(login, safe="") + "/locations?" + query,
                headers={"Authorization": "Bearer " + token}))
            locations.update((row["id"], row) for row in rows)
            if len(rows) < 100:
                break
            page += 1

    def recognized(as_of):
        per_day = {}
        for row in locations.values():
            begin = dt.datetime.fromisoformat(row["begin_at"].replace("Z", "+00:00"))
            end = dt.datetime.fromisoformat(row["end_at"].replace("Z", "+00:00")) if row["end_at"] else as_of
            cursor, end = max(begin, start), min(end, as_of)
            while cursor < end:
                day = cursor.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
                stop = min(end, day + dt.timedelta(days=1))
                per_day[day] = per_day.get(day, 0) + int((stop - cursor).total_seconds())
                cursor = stop
        return sum(min(seconds, 12 * 3600) for seconds in per_day.values())

    # A live session may cross a tier during the request; bound it by the
    # timestamps immediately before and after the real backend response.
    expected = {bucket(recognized(before)), bucket(recognized(after))}
    assert actual in expected, f"study_hours mismatch: backend={actual}, reference={sorted(expected)}"
    print(f"PASS real 42 API /api/me: login={login}, study_hours={actual}, "
          f"recognized_seconds={recognized(after)}, unique_sessions={len(locations)}, daily_cap=12h", flush=True)


def exercise(server):
    suffix = uuid.uuid4().hex[:8]
    Client().request("GET", "/api/me", expected=401)
    demo = Client("hoursdemo_" + suffix)
    assert demo.me["study_hours"] == 0
    user_id = demo.me["id"]
    sql(f"INSERT INTO time_requirements(user_id,target_month,recognized_seconds,as_of) "
        f"VALUES({user_id},'{PREVIOUS_MONTH}-01',288000,now())")
    assert demo.request("GET", "/api/me")["study_hours"] == 0, "previous month leaked"
    for seconds in (0, 143999, 144000, 287999, 288000, 400000):
        sql(f"INSERT INTO time_requirements(user_id,target_month,recognized_seconds,as_of) "
            f"VALUES({user_id},'{CURRENT_MONTH}-01',{seconds},now()) "
            f"ON CONFLICT(user_id,target_month) DO UPDATE SET recognized_seconds={seconds}")
        assert demo.request("GET", "/api/me")["study_hours"] == bucket(seconds)
    assert demo.request("PATCH", "/api/me/employment", {"employed": True})["study_hours"] == 80
    assert Client("hoursdemo_" + suffix).me["study_hours"] == 80
    print("PASS /api/me demo buckets: 0, 40h-1s, 40h, 80h-1s, 80h, prior month, login and employment", flush=True)

    # Populate completed days only so the expected result is independent of
    # elapsed seconds during the test. Day 1 has 4h; later days have 20h, capped
    # at 12h. In the first days of a month the expected bucket is naturally 0.
    now = dt.datetime.now(KST)
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    seconds = 0
    server.rows = []
    for day in range(1, min(now.day, 8)):
        begin = start + dt.timedelta(days=day - 1)
        hours = 4 if day == 1 else 20
        server.rows.append({"id": day, "begin_at": begin.isoformat(),
                            "end_at": (begin + dt.timedelta(hours=hours)).isoformat()})
        seconds += min(hours, 12) * 3600
    real_id = seed_user("hoursreal_" + suffix)
    sql(f"UPDATE users SET is_demo=false,intra_id={real_id + 1000000} WHERE id={real_id}")
    real = Client.sql_session(real_id)
    assert real.me["study_hours"] == bucket(seconds), real.me
    assert real.request("PATCH", "/api/me/employment", {"employed": True})["study_hours"] == bucket(seconds)
    server.rows = []
    assert real.request("GET", "/api/me")["study_hours"] == 0
    print("PASS /api/me local 42: monthly filters, ID deduplication, daily 12h cap, empty records", flush=True)

    failed_id = seed_user("hoursfail_" + suffix)
    sql(f"UPDATE users SET is_demo=false,intra_id={failed_id + 1000000} WHERE id={failed_id}")
    failed = Client.sql_session(failed_id)
    assert failed.me["study_hours"] is None
    assert failed.request("PATCH", "/api/me/employment", {"employed": True})["employed"]
    print("PASS /api/me upstream failure: profile/employment remain available, study_hours is null", flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--live-env", help="Explicit opt-in: env file with real 42 app credentials")
    parser.add_argument("--live-login", help="42 login to read when --live-env is supplied")
    args = parser.parse_args()
    if bool(args.live_env) != bool(args.live_login):
        parser.error("--live-env and --live-login must be supplied together")
    # sql() validates both the configured and actual database name.
    sql("SELECT 1")
    with tempfile.TemporaryDirectory(prefix="otus-study-hours-") as directory, \
            ThreadingHTTPServer(("127.0.0.1", 0), FortyTwoHandler) as server:
        server.rows = []
        threading.Thread(target=server.serve_forever, daemon=True).start()
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        origin = f"http://localhost:{port}"
        env = {**os.environ, "BIND_ADDR": f"127.0.0.1:{port}", "APP_ORIGIN": origin,
               "APP_ORIGINS": origin, "DEMO_LOGIN_ENABLED": "true", "UPLOAD_DIR": directory + "/uploads",
               "FORTY_TWO_CLIENT_ID": "synthetic-client", "FORTY_TWO_CLIENT_SECRET": "synthetic-secret",
               "FORTY_TWO_REDIRECT_URI": origin + "/api/auth/42/callback", "FORTY_TWO_CAMPUS_ID": "69",
               "FORTY_TWO_API_BASE": f"http://127.0.0.1:{server.server_port}", "CLAMAV_ADDR": "",
               "BANK_ACCOUNT_KEY": base64.b64encode(bytes([7]) * 32).decode(),
               "FILE_ENCRYPTION_KEY": base64.b64encode(bytes([8]) * 32).decode(),
               "SMTP_HOST": "", "MAIL_RECIPIENT_DOMAIN": "", "TEST_BASE_URL": origin, "TEST_ORIGIN": origin}
        if args.live_env:
            env.update(live_credentials(args.live_env))
            env["FORTY_TWO_API_BASE"] = "https://api.intra.42.fr"
        os.environ.update(env)
        log_path = Path(directory) / "backend.log"
        with log_path.open("wb") as log:
            process = subprocess.Popen([str(Path(args.binary).resolve())], cwd=directory, env=env,
                                       stdout=log, stderr=log)
            try:
                for _ in range(200):
                    if process.poll() is not None:
                        raise RuntimeError(log_path.read_text())
                    try:
                        urllib.request.urlopen(origin + "/api/health", timeout=1).close()
                        break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError("test backend did not start")
                if args.live_env:
                    exercise_live(args.live_login, env)
                else:
                    exercise(server)
            finally:
                process.terminate()
                process.wait(timeout=15)
                server.shutdown()


if __name__ == "__main__":
    main()
