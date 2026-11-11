#!/usr/bin/env bash
# Smoke test of the hackathon checkpoints against a running server, through the API:
#   1. demo login → 최초 4종 → 검토 대기 (같은 달 월별은 409로 차단됨을 확인)
#   2. 다른 사용자: 월별 제출 → 재검토 요청 → 보완 제출 → 재검토 대기
# Usage: scripts/smoke.sh [base-url]    (default https://localhost:8443, the pod)
#        scripts/smoke.sh http://localhost:4200    (dev server)
# Needs: bash, curl, sed. Requires demo login and an open submission period (make seed).
set -u
BASE=${1:-https://localhost:8443}
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
JAR=$WORK/jar BODY=$WORK/body PDF=$WORK/sample.pdf
printf '%%PDF-1.4\nsmoke test\n%%%%EOF\n' > "$PDF"
MONTH=$(TZ=Asia/Seoul date +%Y-%m)
LOGIN="smoke-$(date +%s)-$RANDOM"   # a run takes under a second
pass=0 fail=0

check() { # label actual expected
  if [ "$2" = "$3" ]; then pass=$((pass + 1)); echo "PASS $1"
  else fail=$((fail + 1)); echo "FAIL $1 (expected [$3], got [$2])"; sed 's/^/     /' "$BODY"; echo; fi
}
get() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p" "$BODY" | head -1; }
getraw() { sed -n "s/.*\"$1\":\([a-z0-9]*\).*/\1/p" "$BODY" | head -1; }
xsrf() { awk '$6 == "XSRF-TOKEN" { print $7 }' "$JAR"; }
call() { # method path [curl args...] → prints the HTTP status
  local method=$1 path=$2; shift 2
  curl -sk -b "$JAR" -c "$JAR" -o "$BODY" -w '%{http_code}' -X "$method" \
    -H "Origin: $BASE" -H "X-XSRF-TOKEN: $(xsrf)" "$@" "$BASE$path"
}
json() { call "$1" "$2" -H 'Content-Type: application/json' -d "$3"; }
upload() { call POST "/api/submissions/$1/files" -F "doc_type=$2" -F "file=@$PDF;type=application/pdf"; }
uuid() { od -An -N16 -tx1 /dev/urandom | tr -d ' \n' | sed -E 's/^(.{8})(.{4}).(.{3}).(.{3})(.{12})$/\1-\2-4\3-8\4-\5/'; }
finalize() { call POST "/api/submissions/$1/finalize" -H "Idempotency-Key: $(uuid)"; }

echo "== $BASE"
check "health" "$(curl -sk -o "$BODY" -w '%{http_code}' "$BASE/api/health")" 200
touch "$JAR"
# JSON bodies are built with printf first: macOS bash 3.2 mangles \" inside "$( )"
body=$(printf '{"login":"%s"}' "$LOGIN")
check "demo login ($LOGIN)" "$(json POST /api/auth/demo-login "$body")" 200
check "  starts at U02 (initial_submitted=false)" "$(getraw initial_submitted)" false
check "submission period open ($MONTH)" "$(call GET /api/cycles/current):$(get state)" "200:open"

echo "== checkpoint 1"
body=$(printf '{"kind":"initial","target_month":"%s"}' "$MONTH")
check "create 최초 4종" "$(json POST /api/submissions "$body")" 201
INIT=$(get id)
for t in id_card resident_abstract bankbook employment_insurance; do
  check "  upload $t" "$(upload "$INIT" $t)" 201
done
check "finalize → 검토 대기" "$(finalize "$INIT"):$(get status)" "200:pending_review"
check "  now goes to home (initial_submitted=true)" "$(call GET /api/me >/dev/null; getraw initial_submitted)" true

echo "== checkpoint 2"
# 같은 달에 최초 4종(고용보험 포함)을 제출한 사용자는 월별을 또 만들 수 없다.
body=$(printf '{"kind":"monthly","target_month":"%s"}' "$MONTH")
check "create 월별 제출 (같은 달 최초 제출 있음 → 409)" "$(json POST /api/submissions "$body")" 409
check "  error code INVALID_STATE" "$(get code)" INVALID_STATE
# 월별→보완 체인은 최초를 제출하지 않은 다른 사용자로 확인한다.
LOGIN2="smoke-monthly-$(date +%s)-$RANDOM"
body=$(printf '{"login":"%s"}' "$LOGIN2")
check "demo login ($LOGIN2)" "$(json POST /api/auth/demo-login "$body")" 200
body=$(printf '{"kind":"monthly","target_month":"%s"}' "$MONTH")
check "create 월별 제출" "$(json POST /api/submissions "$body")" 201
MON=$(get id)
check "  upload employment_insurance" "$(upload "$MON" employment_insurance)" 201
check "  finalize → 검토 대기" "$(finalize "$MON"):$(get status)" "200:pending_review"
check "재검토 요청 (demo reviewer)" "$(json POST "/api/dev/submissions/$MON/status" '{"status":"revision_requested","review_comment":"smoke test","revision_doc_types":["employment_insurance"]}'):$(get status)" "200:revision_requested"
body=$(printf '{"kind":"supplement","target_month":"%s","parent_id":"%s"}' "$MONTH" "$MON")
check "create 보완 제출" "$(json POST /api/submissions "$body")" 201
SUP=$(get id)
check "  upload replacement" "$(upload "$SUP" employment_insurance)" 201
check "  finalize → 재검토 대기" "$(finalize "$SUP"):$(get status)" "200:resubmitted"
# the original and its supplement are both 재검토 대기 (resubmitted)
check "history: original and supplement are 재검토 대기" "$(call GET "/api/submissions?month=$MONTH" >/dev/null; grep -o '"status":"resubmitted"' "$BODY" | wc -l | tr -d ' ')" 2

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]
