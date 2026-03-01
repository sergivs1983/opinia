#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
VOICE_SESSION_COOKIE="${VOICE_SESSION_COOKIE:-${LITO_SESSION_COOKIE:-}}"
VOICE_BIZ_ID="${VOICE_BIZ_ID:-${LITO_BIZ_ID:-}}"

PASS="PASS"
FAIL="FAIL"
FAILURES=0
REQ_CODE=""
REQ_BODY=""

perform_request() {
  local resp
  resp="$(curl -sS -w $'\n%{http_code}' --max-time 45 "$@" 2>/dev/null || true)"
  REQ_CODE="$(printf '%s\n' "$resp" | tail -n 1)"
  REQ_BODY="$(printf '%s\n' "$resp" | sed '$d')"
}

report_ok() {
  echo "  [${PASS}] $1"
}

report_fail() {
  echo "  [${FAIL}] $1"
  echo "         HTTP=${REQ_CODE}"
  echo "         BODY=$(printf '%s' "${REQ_BODY}" | head -c 400)"
  FAILURES=$((FAILURES + 1))
}

json_field() {
  local json="$1"
  local path="$2"
  JSON_INPUT="$json" JSON_PATH="$path" node - <<'JS'
const input = process.env.JSON_INPUT || '';
const path = process.env.JSON_PATH || '';
try {
  const data = JSON.parse(input);
  const value = path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), data);
  if (value === undefined || value === null) process.stdout.write('');
  else if (typeof value === 'object') process.stdout.write(JSON.stringify(value));
  else process.stdout.write(String(value));
} catch {
  process.stdout.write('');
}
JS
}

normalize_cookie_header() {
  local raw normalized
  raw="$(printf '%s' "$1" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  if [ -z "$raw" ]; then
    echo ""
    return 1
  fi
  case "$raw" in
    *$'\n'*|*$'\r'*|*$'\t'*)
      echo ""
      return 1
      ;;
  esac
  if printf '%s' "$raw" | grep -Eiq '^cookie:[[:space:]]*'; then
    normalized="$raw"
  else
    normalized="Cookie: $raw"
  fi
  if ! printf '%s' "$normalized" | grep -q '='; then
    echo ""
    return 1
  fi
  printf '%s' "$normalized"
  return 0
}

create_sample_wav() {
  local target="$1"
  node - "$target" <<'JS'
const fs = require('fs');
const path = process.argv[2];
const sampleRate = 16000;
const durationSeconds = 1;
const numSamples = sampleRate * durationSeconds;
const bytesPerSample = 2;
const dataSize = numSamples * bytesPerSample;
const buffer = Buffer.alloc(44 + dataSize);

buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
buffer.writeUInt16LE(bytesPerSample, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);
// remaining payload is silent PCM (already zeroed)
fs.writeFileSync(path, buffer);
JS
}

echo "Flow D2.4 Voice smoke — ${BASE}"
echo "────────────────────────────────────────────────────────────────────────"

perform_request "${BASE}/login"
if [ "${REQ_CODE}" = "200" ] || [ "${REQ_CODE}" = "307" ]; then
  report_ok "Preflight /login (HTTP 200/307)"
else
  report_fail "Preflight /login (expected 200/307)"
fi

echo ""
echo "1) Guards sense sessio"
perform_request -X POST "${BASE}/api/lito/voice/stt" \
  -H "Content-Type: multipart/form-data" \
  -d "biz_id=00000000-0000-0000-0000-000000000000"
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/voice/stt sense sessio (401)"
else
  report_fail "POST /api/lito/voice/stt sense sessio (expected 401)"
fi

perform_request -X POST "${BASE}/api/lito/voice/tts" \
  -H "Content-Type: application/json" \
  -d '{"biz_id":"00000000-0000-0000-0000-000000000000","message_id":"00000000-0000-0000-0000-000000000000"}'
if [ "${REQ_CODE}" = "401" ]; then
  report_ok "POST /api/lito/voice/tts sense sessio (401)"
else
  report_fail "POST /api/lito/voice/tts sense sessio (expected 401)"
fi

echo ""
echo "2) STT/TTS funcional (opcional)"
if [ -z "${OPENAI_API_KEY:-}" ]; then
  report_ok "SKIP funcional (OPENAI_API_KEY no present)"
else
  if [ -z "${VOICE_SESSION_COOKIE}" ] || [ -z "${VOICE_BIZ_ID}" ]; then
    report_ok "SKIP funcional (defineix VOICE_SESSION_COOKIE/LITO_SESSION_COOKIE i VOICE_BIZ_ID/LITO_BIZ_ID)"
  else
    COOKIE_HEADER="$(normalize_cookie_header "${VOICE_SESSION_COOKIE}" || true)"
    if [ -z "${COOKIE_HEADER}" ]; then
      REQ_CODE="cookie"
      REQ_BODY="VOICE_SESSION_COOKIE invalid"
      report_fail "cookie de sessio invalida"
    else
      report_ok "cookie format validat (redacted)"

      perform_request -X POST "${BASE}/api/lito/threads" \
        -H "Content-Type: application/json" \
        -H "${COOKIE_HEADER}" \
        -d "{\"biz_id\":\"${VOICE_BIZ_ID}\",\"title\":\"Voice smoke\"}"
      if [ "${REQ_CODE}" != "200" ] && [ "${REQ_CODE}" != "201" ]; then
        report_fail "crear thread per smoke voice (expected 200/201)"
      else
        THREAD_ID="$(json_field "${REQ_BODY}" "thread.id")"
        if [ -z "${THREAD_ID}" ]; then
          REQ_CODE="shape"
          REQ_BODY="thread.id buit"
          report_fail "crear thread retorna thread.id"
        else
          report_ok "thread creat/reutilitzat"

          perform_request -X POST "${BASE}/api/lito/threads/${THREAD_ID}/messages" \
            -H "Content-Type: application/json" \
            -H "${COOKIE_HEADER}" \
            -d '{"content":"Prova per TTS al smoke D2.4"}'

          if [ "${REQ_CODE}" != "200" ]; then
            report_fail "afegir missatge al thread (expected 200)"
          else
            MESSAGE_ID="$(json_field "${REQ_BODY}" "messages.1.id")"
            if [ -z "${MESSAGE_ID}" ]; then
              MESSAGE_ID="$(json_field "${REQ_BODY}" "messages.0.id")"
            fi
            if [ -z "${MESSAGE_ID}" ]; then
              REQ_CODE="shape"
              REQ_BODY="message id no trobat"
              report_fail "response missatge te id"
            else
              report_ok "missatge al thread OK"

              perform_request -X POST "${BASE}/api/lito/voice/tts" \
                -H "Content-Type: application/json" \
                -H "${COOKIE_HEADER}" \
                -d "{\"biz_id\":\"${VOICE_BIZ_ID}\",\"message_id\":\"${MESSAGE_ID}\",\"lang\":\"ca\"}"

              if [ "${REQ_CODE}" = "200" ]; then
                AUDIO_URL="$(json_field "${REQ_BODY}" "audio_url")"
                if [ -n "${AUDIO_URL}" ]; then
                  report_ok "TTS retorna audio_url"
                else
                  REQ_CODE="shape"
                  REQ_BODY="audio_url buit"
                  report_fail "TTS retorna audio_url"
                fi
              elif [ "${REQ_CODE}" = "503" ] && printf '%s' "${REQ_BODY}" | grep -q '"error":"voice_unavailable"'; then
                report_ok "TTS contracte voice_unavailable (503)"
              else
                report_fail "TTS funcional (expected 200 o 503 voice_unavailable)"
              fi
            fi
          fi

          SAMPLE_WAV="/tmp/opinia-d24-sample.wav"
          create_sample_wav "${SAMPLE_WAV}"
          perform_request -X POST "${BASE}/api/lito/voice/stt" \
            -H "${COOKIE_HEADER}" \
            -H "x-request-id: smoke-d24-stt" \
            -F "biz_id=${VOICE_BIZ_ID}" \
            -F "thread_id=${THREAD_ID}" \
            -F "lang=ca" \
            -F "audio=@${SAMPLE_WAV};type=audio/wav"

          if [ "${REQ_CODE}" = "200" ]; then
            TRANSCRIPT="$(json_field "${REQ_BODY}" "transcript")"
            if [ -n "${TRANSCRIPT}" ]; then
              report_ok "STT retorna transcript"
            else
              REQ_CODE="shape"
              REQ_BODY="transcript buit"
              report_fail "STT retorna transcript"
            fi
          elif [ "${REQ_CODE}" = "503" ] && printf '%s' "${REQ_BODY}" | grep -q '"error":"voice_unavailable"'; then
            report_ok "STT contracte voice_unavailable (503)"
          else
            report_fail "STT funcional (expected 200 o 503 voice_unavailable)"
          fi

          rm -f "${SAMPLE_WAV}" 2>/dev/null || true
        fi
      fi
    fi
  fi
fi

echo ""
echo "────────────────────────────────────────────────────────────────────────"
if [ "${FAILURES}" -eq 0 ]; then
  echo "All D2.4 voice smoke tests passed."
  exit 0
fi

echo "${FAILURES} test(s) failed."
exit 1
