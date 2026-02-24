#!/usr/bin/env bash
# ============================================================
# OpinIA — Provider Abstraction CI Check
# Fails if UI components expose LLM provider names.
# Run: bash scripts/check-provider-leak.sh
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

# Directories to scan (UI-facing only)
UI_DIRS=(
  "src/app/dashboard"
  "src/app/onboarding"
  "src/app/(auth)"
  "src/app/page.tsx"
  "src/components"
  "messages"
)

# Patterns that must NOT appear in UI
# Note: case-insensitive, but we exclude:
#   - comments (// or /*)
#   - import paths (from '@/lib/llm')
#   - type annotations
FORBIDDEN_PATTERNS='openai|anthropic|claude|gpt-4|gpt-3|GPT-4o|Anthropic \(Claude\)|OpenAI \(GPT'

FOUND=0
VIOLATIONS=""

for dir in "${UI_DIRS[@]}"; do
  TARGET="$(dirname "$0")/../${dir}"
  if [ ! -e "$TARGET" ]; then continue; fi

  # Grep for forbidden patterns, excluding:
  #   - .test. files
  #   - node_modules
  #   - lines that are clearly imports or type-only
  MATCHES=$(grep -rn -i -E "$FORBIDDEN_PATTERNS" "$TARGET" \
    --include="*.tsx" --include="*.ts" --include="*.json" \
    2>/dev/null \
    | grep -v "node_modules" \
    | grep -v "__tests__" \
    | grep -v ".test." \
    | grep -v "// " \
    | grep -v "import " \
    | grep -v "type.*Provider" \
    || true)

  if [ -n "$MATCHES" ]; then
    FOUND=1
    VIOLATIONS="${VIOLATIONS}\n${MATCHES}"
  fi
done

if [ "$FOUND" -eq 1 ]; then
  echo -e "${RED}❌ PROVIDER LEAK DETECTED in UI components:${NC}"
  echo -e "$VIOLATIONS"
  echo ""
  echo "Fix: Replace provider names with getPublicAiLabel() from '@/lib/ai-label'"
  exit 1
else
  echo -e "${GREEN}✅ No provider names exposed in UI. All references use OpinIA AI.${NC}"
  exit 0
fi
