#!/usr/bin/env bash
# Runs the e2e suite (e2e/run.ts) in a temporary Chrome for Testing and its matching
# chromedriver: both are downloaded into a temp directory and deleted afterwards.
# Needs a running OTUS (`make demo`) and Bun. Used locally (`make e2e-chrome`) and in CI.
#   CHROME_VERSION   default "stable" (or a version like 155.0.8059.84)
#   CHROME_NO_SANDBOX=1  for CI runners without unprivileged user namespaces
set -euo pipefail
cd "$(dirname "$0")/.."

work=$(mktemp -d)
driver_pid=
cleanup() {
  if [ -n "$driver_pid" ]; then
    kill "$driver_pid" 2>/dev/null || true
    wait "$driver_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

version=${CHROME_VERSION:-stable}
install() { # prints the installed binary's path
  bunx --bun @puppeteer/browsers install "$1@$version" --path "$work" --format '{{path}}' | tail -1
}
chrome=$(install chrome)
chromedriver=$(install chromedriver)
echo "Chrome for Testing: $("$chrome" --version 2>/dev/null || echo "$chrome")"

# a free port (chromedriver's default 9515 may be taken)
port=$(bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop()')
"$chromedriver" --port="$port" >"$work/chromedriver.log" 2>&1 &
driver_pid=$!
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$port/status" >/dev/null && break
  sleep 0.2
done

WEBDRIVER_URL="http://127.0.0.1:$port" BROWSER=chrome CHROME_BINARY="$chrome" bun "${E2E_SCRIPT:-e2e/run.ts}"
