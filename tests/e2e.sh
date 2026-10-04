#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/echosound-e2e-XXXXXX")"
LOG="$TMP_DIR/player.log"
KEEP=0

ok()   { printf '\033[32m[+] %s\033[0m\n' "$*"; }
info() { printf '\033[34m[i] %s\033[0m\n' "$*"; }
warn() { printf '\033[33m[!] %s\033[0m\n' "$*"; }
die()  { printf '\033[31m[x] %s\033[0m\n' "$*" >&2; exit 1; }

[[ "${1:-}" == "--keep" ]] && KEEP=1

cleanup() {
  if [[ "$KEEP" -eq 1 ]]; then
    info "kept: $TMP_DIR"
  else
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

command -v opencode >/dev/null 2>&1 || die "opencode not on PATH"
[[ -f "$REPO_DIR/plugin/soundboard.js" ]] || die "plugin sources missing"

PLUGIN_INSTALLED=0
for candidate in "$CONFIG_DIR/plugin/soundboard.js" "$CONFIG_DIR/plugins/soundboard.js"; do
  [[ -f "$candidate" ]] && PLUGIN_INSTALLED=1
done
[[ "$PLUGIN_INSTALLED" -eq 1 ]] || die "plugin not installed in $CONFIG_DIR (run ./install.sh first)"

PLAYER="$TMP_DIR/fake-player.sh"
cat >"$PLAYER" <<EOF
#!/usr/bin/env bash
printf '%s %s\n' "\$0" "\$*" >> "$LOG"
exit 0
EOF
chmod +x "$PLAYER"

cat >"$TMP_DIR/sounds.json" <<EOF
{
  "enabled": true,
  "player": "$PLAYER",
  "volume": 50,
  "throttleMs": 0,
  "debug": true,
  "events": {
    "session.created": "$REPO_DIR/sounds/startup.wav",
    "session.idle": "$REPO_DIR/sounds/done-soft.wav"
  },
  "commands": {}
}
EOF

ok "fake player:    $PLAYER"
ok "test config:    $TMP_DIR/sounds.json"
info "running one tiny opencode session (this costs a few tokens)"

set +e
ECHOSOUND_CONFIG="$TMP_DIR/sounds.json" opencode run "Reply with exactly: ok" >"$TMP_DIR/run.out" 2>&1
RUN_RC=$?
set -e
[[ "$RUN_RC" -eq 0 ]] || warn "opencode run exited rc=$RUN_RC (see $TMP_DIR/run.out if kept)"

for _ in $(seq 1 20); do
  [[ -s "$LOG" ]] && break
  sleep 0.5
done

if [[ ! -s "$LOG" ]]; then
  die "player was never invoked - lifecycle hooks did not fire (opencode 1.18+ required)"
fi

info "player invocations:"
sed 's/^/    /' "$LOG"

grep -q "done-soft.wav" "$LOG" || die "session.idle hook did not fire"
ok "session.idle hook fired"
grep -q "startup.wav" "$LOG" && ok "session.created hook fired" || warn "session.created did not fire in headless run mode (expected for 'opencode run')"
if grep -v "^$PLAYER " "$LOG" | grep -q .; then
  die "a player other than the fake one was invoked"
fi
ok "only the custom player was used"

ok "e2e green: lifecycle hooks reach a custom player path"
exit 0
