#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

FAILS=0

ok()  { printf '\033[32m[+] %s\033[0m\n' "$*"; }
bad() { printf '\033[31m[!] %s\033[0m\n' "$*"; FAILS=$((FAILS + 1)); }

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    ok "$desc"
  else
    bad "$desc"
  fi
}

ok "=== shell syntax ==="
check "install.sh" bash -n install.sh
check "tests/run.sh" bash -n tests/run.sh
check "tests/e2e.sh" bash -n tests/e2e.sh

if command -v shellcheck >/dev/null 2>&1; then
  ok "=== shellcheck ==="
  if shellcheck --shell=bash -e SC1090,SC1091 install.sh tests/run.sh tests/e2e.sh; then
    ok "shellcheck clean"
  else
    bad "shellcheck reported issues (run it -f tty to see)"
    FAILS=$((FAILS + 1))
  fi
else
  ok "shellcheck not installed (skipped)"
fi

ok "=== python ==="
check "make_sounds.py compiles" python3 -m py_compile tools/make_sounds.py
check "make_sounds.py --list" python3 tools/make_sounds.py --list
check "example config is valid json" python3 -c "import json,sys; json.load(open('config/sounds.example.json'))"

ok "=== javascript ==="
check "plugin/soundboard.js" node --check plugin/soundboard.js
check "plugin/soundboard-core.js" node --check plugin/soundboard-core.js
check "tests/core.test.mjs" node --check tests/core.test.mjs

ok "=== plugin contract ==="
if node -e '
  import("./plugin/soundboard.js").then((mod) => {
    const names = Object.keys(mod).filter((k) => k !== "default")
    if (names.length !== 1 || names[0] !== "SoundboardPlugin") {
      console.error("opencode calls every export as a plugin; expected only SoundboardPlugin, got:", names.join(","))
      process.exit(1)
    }
    if (typeof mod.SoundboardPlugin !== "function") process.exit(1)
  })
' >/dev/null 2>&1; then
  ok "plugin exports exactly one callable plugin"
else
  bad "plugin must export only SoundboardPlugin"
fi

ok "=== unit tests ==="
if node --test "tests/*.test.mjs" >/tmp/echosound-tests.$$ 2>&1; then
  ok "$(grep -E '^ℹ (tests|pass)' /tmp/echosound-tests.$$ | tr '\n' ' ')"
  rm -f /tmp/echosound-tests.$$
else
  bad "unit tests failed"
  tail -40 /tmp/echosound-tests.$$
  rm -f /tmp/echosound-tests.$$
fi

ok "=== end to end (optional, needs opencode + a model) ==="
if command -v opencode >/dev/null 2>&1; then
  if [[ "${ECHOSOUND_E2E:-0}" == "1" ]]; then
    if ./tests/e2e.sh; then
      ok "e2e: lifecycle hooks fired the custom player"
    else
      bad "e2e failed (set ECHOSOUND_E2E=1 to run: ./tests/e2e.sh)"
    fi
  else
    ok "skipped (run: ECHOSOUND_E2E=1 ./tests/run.sh)"
  fi
else
  ok "opencode not installed (skipped)"
fi

printf '\n'
if [[ "$FAILS" -eq 0 ]]; then
  printf '\033[32m==> all checks passed\033[0m\n'
  exit 0
fi
printf '\033[31m==> %s check(s) failed\033[0m\n' "$FAILS"
exit 1
