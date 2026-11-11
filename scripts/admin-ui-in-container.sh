#!/bin/sh
# For scripts/admin-ui-test.Containerfile, on the local demo VM network only.
set -eu
cd /repo
task_driver_port=$(bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop()')
chromedriver --port="$task_driver_port" >/tmp/otus-admin-driver.log 2>&1 &
task_driver_pid=$!
trap 'kill "$task_driver_pid" 2>/dev/null || true' EXIT HUP INT TERM
export WEBDRIVER_URL="http://127.0.0.1:$task_driver_port"
export CHROME_BINARY=/usr/bin/chromium
task_wait=0
while ! wget -qO- "$WEBDRIVER_URL/status" >/dev/null 2>&1; do
  task_wait=$((task_wait + 1))
  if [ "$task_wait" -gt 20 ]; then cat /tmp/otus-admin-driver.log; exit 1; fi
  sleep 1
done
bun "${E2E_SCRIPT:-e2e/admin.ts}"
