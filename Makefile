# Podman helpers. Run from the repo root. Works with GNU make (Linux) and BSD make (macOS).
.PHONY: demo demo-dev-db demo-secrets demo-secrets-file demo-clean pod-seed smoke dev-env dev-db dev-db-stop seed \
	images secrets pod-up pod-down pod-logs

# --- Run the whole service (only Podman needed) ------------------------------------------

# Build, start and seed the pod, then print where to open it. Also make sure
# the local dev DB container is up (see demo-dev-db) for `cargo run` work
# next to the pod.
demo: demo-dev-db demo-secrets secrets pod-up pod-seed
	@echo
	@echo "OTUS is running: https://localhost:8443"
	@echo "Demo accounts: dongmin (home), seoyeon (re-review requested), or any new ID"
	@echo "Admin app: https://admin.localhost:8443"
	@echo "Demo admin account: admindemo / password: none (demo login takes the ID only)"

# Start the dev DB only if it is not already running. A dev DB that is up
# (e.g. in use by a `cargo run` session) is left untouched: no restart, no
# recreate. `dev-db` itself starts the existing container when it exists.
demo-dev-db:
	@if podman ps --filter status=running --format '{{.Names}}' | grep -qx otus-dev-db; then \
		echo "dev DB (otus-dev-db) is already running, leaving it as is"; \
	else \
		echo "dev DB (otus-dev-db) is not running, starting it"; \
		$(MAKE) dev-db; \
	fi

# deploy/secrets.yaml with random values, unless it already exists. Afterwards,
# if the repo-root .env (or the environment) names FORTY_TWO_CLIENT_ID and
# FORTY_TWO_CLIENT_SECRET, they are copied into the backend secret so the demo
# also offers the real 42 login (demo login stays on). Unset: 42 login stays
# off, exactly as before. Copy .env.example to .env to enable it.
demo-secrets: demo-secrets-file
	@python3 scripts/apply-demo-42-env.py

demo-secrets-file:
	@if [ -f deploy/secrets.yaml ]; then \
		echo "deploy/secrets.yaml exists, keeping it"; \
	else \
		umask 077; \
		sed -e "s|CHANGE_ME_DB_SUPERUSER_PASSWORD|$$(openssl rand -hex 24)|" \
			-e "s|CHANGE_ME_DB_APP_PASSWORD|$$(openssl rand -hex 24)|g" \
			-e "s|CHANGE_ME_BANK_ACCOUNT_KEY|$$(openssl rand -base64 32)|" \
			-e "s|CHANGE_ME_FILE_ENCRYPTION_KEY|$$(openssl rand -base64 32)|" \
			deploy/secrets.example.yaml > deploy/secrets.yaml; \
		echo "created deploy/secrets.yaml with random values"; \
	fi

# Demo data inside the running pod (safe to re-run). Fails if the service never comes up.
# Waits for the malware scanner too: the first start downloads its signatures (minutes).
pod-seed:
	@echo "waiting for the service and the malware scanner (first start: a few minutes)"; \
	for i in $$(seq 1 300); do \
		curl -skf https://localhost:8443/api/health 2>/dev/null | grep -q '"scanner":"ready"' && exit 0; \
		sleep 2; \
	done; \
	echo "the service didn't become healthy at https://localhost:8443; containers:"; \
	podman ps -a --pod --filter pod=otus --format '  {{.Names}}  {{.Status}}'; \
	echo "logs: make pod-logs"; exit 1
	podman exec otus-backend otus-backend seed

# Checkpoint 1 and 2 through the API against the pod (or: scripts/smoke.sh <base-url>)
smoke:
	scripts/smoke.sh

# The browser e2e suite (e2e/run.ts) against the running pod
e2e-chrome:
	e2e/chrome.sh

# API-level e2e coverage (e2e/api-coverage.ts) against the running pod: RBAC /
# originals / cycle / eligibility / notifications paths the browser cannot see
e2e-api:
	bun e2e/api-coverage.ts

# Safari Technology Preview only: its driver never takes over an everyday Safari.
# Enable once with: "/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver" --enable
e2e-safari:
	@driver="/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver"; \
	port=$$(bun -e 'const s = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }); console.log(s.port); s.stop()'); \
	"$$driver" -p $$port & pid=$$!; trap "kill $$pid 2>/dev/null" EXIT; sleep 2; \
	WEBDRIVER_URL=http://127.0.0.1:$$port BROWSER=safari-tp bun e2e/run.ts

# Stop the pod and delete its data, secrets and generated secrets file (to start over).
# Also removes the dev DB container AND its data volume (otus-dev-pgdata): a full
# teardown, so the next `make demo` starts the dev DB from an empty database.
# `kube play` writes each secret's files into a volume of the same name that outlives the
# pod. otus-secrets is the single secret used before it was split in two.
# The scanner's signature volume (otus-clamav-db) is kept: re-downloading it is slow.
demo-clean:
	-podman kube down deploy/otus-pod.yaml
	-podman rm -f otus-dev-db
	-podman volume rm otus-pgdata otus-uploads otus-caddy-data otus-db otus-backend otus-secrets otus-dev-pgdata
	-podman secret rm otus-db otus-backend otus-secrets
	rm -f deploy/secrets.yaml

# --- Local development (Rust + Bun) ------------------------------------------------------

# backend/.env from .env.example with fresh encryption keys, unless it already exists
dev-env:
	@if [ -f backend/.env ]; then \
		echo "backend/.env exists, keeping it"; \
	else \
		umask 077; \
		sed -e "s|^BANK_ACCOUNT_KEY=$$|BANK_ACCOUNT_KEY=$$(openssl rand -base64 32)|" \
			-e "s|^FILE_ENCRYPTION_KEY=$$|FILE_ENCRYPTION_KEY=$$(openssl rand -base64 32)|" \
			backend/.env.example > backend/.env; \
		echo "created backend/.env"; \
	fi

# Local Postgres for `cargo run` / diesel CLI (matches backend/.env.example)
dev-db:
	podman start otus-dev-db 2>/dev/null || podman run -d --name otus-dev-db \
		-p 127.0.0.1:5433:5432 \
		-e POSTGRES_USER=otus -e POSTGRES_PASSWORD=otus_dev -e POSTGRES_DB=otus \
		-v otus-dev-pgdata:/var/lib/postgresql \
		docker.io/library/postgres:18-alpine

dev-db-stop:
	podman stop otus-dev-db

# Demo data: this month's submission period (open all month) + demo users dongmin, seoyeon.
# Safe to re-run.
seed:
	cd backend && cargo run -q -- seed

# --- Pod building blocks -----------------------------------------------------------------

# The otus-web image holds both the student and the admin app (deploy/web.Containerfile).
images:
	podman build -f deploy/db.Containerfile -t localhost/otus-db:latest .
	podman build -f deploy/backend.Containerfile -t localhost/otus-backend:latest .
	podman build -f deploy/clamav.Containerfile -t localhost/otus-clamav:latest .
	podman build -f deploy/web.Containerfile -t localhost/otus-web:latest .

# Creates/replaces the otus-db and otus-backend Podman secrets from deploy/secrets.yaml
secrets:
	podman kube play --replace deploy/secrets.yaml

pod-up: images
	podman kube play --replace deploy/otus-pod.yaml

pod-down:
	podman kube down deploy/otus-pod.yaml

pod-logs:
	podman pod logs -f otus
