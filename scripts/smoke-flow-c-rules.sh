#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"

if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || [ -z "${INTERNAL_HMAC_SECRET:-}" ]; then
  echo "ERROR: falten variables d'entorn."
  echo "Executa: set -a; source .env.local; set +a"
  exit 1
fi

PASS="PASS"
FAIL="FAIL"
GREEN="$(printf '\033[32m')"
RED="$(printf '\033[31m')"
RESET="$(printf '\033[0m')"
FAILURES=0

REQ_CODE=""
REQ_BODY=""

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 25 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 240)"
  FAILURES=$((FAILURES + 1))
}

echo "Flow C smoke tests — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

READY=0
for _ in $(seq 1 60); do
  perform_request "${BASE}/login"
  if [ "${REQ_CODE}" = "200" ]; then
    READY=1
    break
  fi
  sleep 1
done
if [ "${READY}" -eq 1 ]; then
  report_ok "Preflight /login (HTTP 200)"
else
  report_fail "Preflight /login (expected 200)"
  echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
  exit 1
fi

TMP_JSON="$(mktemp)"

if ! node - <<'JS' > "${TMP_JSON}"
const { createClient } = require('@supabase/supabase-js');

function isSchemaMissing(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '42p01' || code === 'pgrst205' || message.includes('does not exist') || message.includes('schema cache');
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks = await Promise.all([
    admin.from('rules').select('id').limit(1),
    admin.from('rule_conditions').select('id').limit(1),
    admin.from('rule_actions').select('id').limit(1),
    admin.from('rule_runs').select('id').limit(1),
  ]);

  if (checks.some((result) => isSchemaMissing(result.error))) {
    process.stdout.write(JSON.stringify({ migration_missing: true }));
    return;
  }

  const schemaError = checks.find((result) => result.error);
  if (schemaError && schemaError.error) {
    throw new Error(`schema_check_failed:${schemaError.error.message || 'unknown'}`);
  }

  const { data: biz, error: bizError } = await admin
    .from('businesses')
    .select('id, org_id, default_signature')
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (bizError || !biz) {
    throw new Error(`business_not_found:${bizError?.message || 'none'}`);
  }

  const stamp = Date.now();
  const { data: rule, error: ruleError } = await admin
    .from('rules')
    .insert({
      org_id: biz.org_id,
      biz_id: biz.id,
      provider: 'google_business',
      name: `smoke-flow-c-${stamp}`,
      status: 'active',
      priority: 1,
      allow_auto_publish: false,
    })
    .select('id')
    .single();

  if (ruleError || !rule) {
    throw new Error(`rule_insert_failed:${ruleError?.message || 'none'}`);
  }

  const { error: conditionError } = await admin
    .from('rule_conditions')
    .insert({
      rule_id: rule.id,
      field: 'rating',
      op: 'gte',
      value: 4,
    });

  if (conditionError) {
    throw new Error(`condition_insert_failed:${conditionError.message}`);
  }

  const { data: action, error: actionError } = await admin
    .from('rule_actions')
    .insert({
      rule_id: rule.id,
      type: 'require_approval',
      template: null,
      template_version: 1,
    })
    .select('id')
    .single();

  if (actionError || !action) {
    throw new Error(`action_insert_failed:${actionError?.message || 'none'}`);
  }

  const reviewId = `smoke-review-${stamp}`;
  const { data: run, error: runError } = await admin
    .from('rule_runs')
    .insert({
      org_id: biz.org_id,
      biz_id: biz.id,
      provider: 'google_business',
      review_id: reviewId,
      status: 'queued',
      decision: {
        review_snapshot: {
          rating: 5,
          text: 'Great service, recommend!',
          language: 'ca',
          reviewer_name: 'Smoke Tester',
        },
      },
    })
    .select('id')
    .single();

  if (runError || !run) {
    throw new Error(`rule_run_insert_failed:${runError?.message || 'none'}`);
  }

  process.stdout.write(JSON.stringify({
    migration_missing: false,
    run_id: run.id,
  }));
}

main().catch((error) => {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
});
JS
then
  echo "ERROR: no s'han pogut preparar dades de smoke per Flow C."
  rm -f "${TMP_JSON}"
  exit 1
fi

if node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.exit(d.migration_missing ? 0 : 1);" "${TMP_JSON}"
then
  echo "ERROR: cal aplicar migrations a Supabase + NOTIFY pgrst, 'reload schema'"
  rm -f "${TMP_JSON}"
  exit 1
fi

HMAC_DATA="$(node - <<'JS'
const crypto = require('crypto');
const secret = process.env.INTERNAL_HMAC_SECRET;
const path = '/api/_internal/rules/run';
const body = '{}';
const ts = Date.now().toString();
const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
const canonical = `${ts}.POST.${path}.${bodyHash}`;
const sig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
process.stdout.write(`${ts}\n${sig}\n`);
JS
)"

TS="$(printf '%s\n' "${HMAC_DATA}" | sed -n '1p')"
SIG="$(printf '%s\n' "${HMAC_DATA}" | sed -n '2p')"

perform_request -X POST "${BASE}/api/_internal/rules/run" \
  -H "Content-Type: application/json" \
  -H "x-opin-timestamp: ${TS}" \
  -H "x-opin-signature: ${SIG}" \
  --data '{}'

if [ "${REQ_CODE}" = "200" ] && [[ "${REQ_BODY}" == *'"ok":true'* ]]; then
  report_ok "Worker Flow C cridat correctament (200)"
else
  report_fail "Worker Flow C (expected 200 + ok:true)"
fi

VERIFY_OUTPUT="$(node - "${TMP_JSON}" <<'JS'
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin
    .from('rule_runs')
    .select('status, matched_rule_id, matched_action_id, decision')
    .eq('id', payload.run_id)
    .single();

  if (error || !data) {
    throw new Error(`verify_failed:${error?.message || 'no_row'}`);
  }

  const decision = data.decision || {};
  const actionType = decision.action_type || '';
  process.stdout.write(JSON.stringify({
    status: data.status,
    matched_rule_id: data.matched_rule_id,
    matched_action_id: data.matched_action_id,
    action_type: actionType,
  }));
}

main().catch((error) => {
  process.stderr.write(String(error?.message || error));
  process.exit(1);
});
JS
)"

STATUS="$(node -e "const d=JSON.parse(process.argv[1]);process.stdout.write(String(d.status||''));" "${VERIFY_OUTPUT}")"
MATCHED_RULE="$(node -e "const d=JSON.parse(process.argv[1]);process.stdout.write(String(d.matched_rule_id||''));" "${VERIFY_OUTPUT}")"
MATCHED_ACTION="$(node -e "const d=JSON.parse(process.argv[1]);process.stdout.write(String(d.matched_action_id||''));" "${VERIFY_OUTPUT}")"
ACTION_TYPE="$(node -e "const d=JSON.parse(process.argv[1]);process.stdout.write(String(d.action_type||''));" "${VERIFY_OUTPUT}")"

if [ "${STATUS}" = "done" ] && [ -n "${MATCHED_RULE}" ] && [ -n "${MATCHED_ACTION}" ] && [ "${ACTION_TYPE}" = "require_approval" ]; then
  report_ok "rule_run processat a done amb matched_rule/action i decision esperada"
else
  REQ_CODE="${STATUS}"
  REQ_BODY="${VERIFY_OUTPUT}"
  report_fail "Verificació final rule_run (expected done + matches + require_approval)"
fi

rm -f "${TMP_JSON}"

if [ "${FAILURES}" -eq 0 ]; then
  echo -e "${GREEN}All Flow C smoke tests passed.${RESET}"
  exit 0
fi

echo -e "${RED}${FAILURES} test(s) failed.${RESET}"
exit 1
