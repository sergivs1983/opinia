#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
PATHNAME="/api/_internal/google/publish"
RAW_BODY=""

if [ -z "${INTERNAL_HMAC_SECRET:-}" ]; then
  echo "ERROR: INTERNAL_HMAC_SECRET no està definit."
  exit 2
fi

http_probe="$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/" || true)"
if [ "${http_probe}" = "000" ]; then
  echo "ERROR: No puc connectar amb ${BASE}. Arrenca 'npm run dev' o passa BASE com a arg."
  exit 2
fi

hmac_lines="$(node scripts/print-hmac.js "${PATHNAME}" "${RAW_BODY}")"
timestamp="$(printf '%s\n' "${hmac_lines}" | sed -n '1p')"
signature="$(printf '%s\n' "${hmac_lines}" | sed -n '2p')"

if [ -z "${timestamp}" ] || [ -z "${signature}" ]; then
  echo "ERROR: No s'ha pogut generar timestamp/signature."
  exit 2
fi

tmp_body="$(mktemp /tmp/opinia-hmac-valid.XXXXXX)"
trap 'rm -f "${tmp_body}"' EXIT

http_code="$(
  curl -sS -o "${tmp_body}" -w "%{http_code}" \
    -X POST "${BASE}${PATHNAME}" \
    -H "Content-Type: application/json" \
    -H "x-opin-timestamp: ${timestamp}" \
    -H "x-opin-signature: ${signature}" \
    --data "${RAW_BODY}"
)"

body="$(cat "${tmp_body}")"

echo "BASE=${BASE}"
echo "HTTP=${http_code}"
echo "BODY=${body}"

if [ "${http_code}" = "200" ]; then
  echo "PASS: valid HMAC -> 200"
  exit 0
fi

if [ "${http_code}" = "500" ] && printf '%s' "${body}" | grep -q "rpc_error"; then
  echo "PASS: valid HMAC -> 500 placeholder amb rpc_error"
  exit 0
fi

echo "FAIL: resposta inesperada (esperat 200 o 500+rpc_error)."
exit 1
