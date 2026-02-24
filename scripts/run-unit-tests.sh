#!/usr/bin/env bash
set -euo pipefail

if [ ! -d "src/__tests__" ]; then
  echo "No unit tests found in src/__tests__"
  exit 0
fi

TEST_FILES="$(find src/__tests__ -maxdepth 1 -type f -name "*.test.ts" | sort)"

if [ -z "${TEST_FILES}" ]; then
  echo "No unit tests found in src/__tests__"
  exit 0
fi

echo "${TEST_FILES}" | while IFS= read -r test_file; do
  [ -n "${test_file}" ] || continue
  echo "Running ${test_file}"
  node --import tsx "${test_file}"
done
