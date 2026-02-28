#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
FAILURES=0

REQ_CODE=""

check_http() {
  local label="$1"
  local expected="$2"
  local url="$3"

  REQ_CODE="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "${url}" || true)"
  if [ "${REQ_CODE}" = "${expected}" ]; then
    echo "[PASS] ${label} (${REQ_CODE})"
  else
    echo "[FAIL] ${label} expected ${expected}, got ${REQ_CODE}"
    FAILURES=$((FAILURES + 1))
  fi
}

check_http_multi() {
  local label="$1"
  local url="$2"

  REQ_CODE="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 20 "${url}" || true)"
  if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
    echo "[PASS] ${label} (${REQ_CODE})"
  else
    echo "[FAIL] ${label} expected 200/307, got ${REQ_CODE}"
    FAILURES=$((FAILURES + 1))
  fi
}

check_static() {
  local label="$1"
  local cmd="$2"
  if eval "${cmd}"; then
    echo "[PASS] ${label}"
  else
    echo "[FAIL] ${label}"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "Flow D1.5 IKEA smoke — ${BASE_URL}"
echo "────────────────────────────────────────────────────────────────────────"

check_http "Preflight /login" "200" "${BASE_URL}/login"
check_http_multi "Preflight /dashboard/lito" "${BASE_URL}/dashboard/lito"
check_http_multi "Preflight /dashboard/lito/chat" "${BASE_URL}/dashboard/lito/chat"

echo ""
echo "Static checks"
check_static "helper getIkeaChecklist exists" "rg -n \"export function getIkeaChecklist\" src/lib/recommendations/howto.ts >/dev/null"
check_static "Workbench uses getIkeaChecklist" "rg -n \"getIkeaChecklist\\(\" src/components/lito/LitoWorkbenchPane.tsx >/dev/null"
check_static "Chat uses getIkeaChecklist" "rg -n \"getIkeaChecklist\\(\" src/components/lito/LitoChatView.tsx >/dev/null"

for locale_file in messages/ca.json messages/es.json messages/en.json; do
  check_static "${locale_file} has lito ikea title" "rg -n '\"ikea\"\\s*:\\s*\\{' ${locale_file} >/dev/null && rg -n '\"title\"\\s*:\\s*\".*\"' ${locale_file} >/dev/null"
  check_static "${locale_file} has lito ikea channel labels" "rg -n '\"channel\"\\s*:\\s*\\{' ${locale_file} >/dev/null && rg -n '\"instagram\"\\s*:\\s*\".*\"' ${locale_file} >/dev/null && rg -n '\"tiktok\"\\s*:\\s*\".*\"' ${locale_file} >/dev/null"
  check_static "${locale_file} has lito ikea copy keys" "rg -n '\"copyChecklist\"\\s*:\\s*\".*\"' ${locale_file} >/dev/null && rg -n '\"copiedToast\"\\s*:\\s*\".*\"' ${locale_file} >/dev/null"
done

echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All Flow D1.5 IKEA smoke checks passed."
  exit 0
fi

echo "${FAILURES} check(s) failed."
exit 1
