#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
PLUGIN_DIR="$CONFIG_DIR/plugins"
SOUNDS_DIR="$CONFIG_DIR/sounds"
PLUGIN_SRC="$REPO_DIR/plugin/soundboard.js"
CORE_SRC="$REPO_DIR/plugin/soundboard-core.js"
CONFIG_PATH="$CONFIG_DIR/sounds.json"
EXAMPLE_CONFIG="$REPO_DIR/config/sounds.example.json"

DRY_RUN=0
FORCE=0
UNINSTALL=0
WITH_SOUNDS=1
WITH_EXAMPLES=0

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
ok()   { printf '%s[+]%s %s\n' "$GREEN" "$OFF" "$*"; }
info() { printf '%s[i]%s %s\n' "$BLUE" "$OFF" "$*"; }
warn() { printf '%s[!]%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '%s[x]%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }
run()  { if [[ "$DRY_RUN" -eq 1 ]]; then info "dry-run: $*"; else "$@"; fi; }

usage() {
  cat <<'EOF'
opencode-echosound installer

Usage: install.sh [options]

Options:
  --dry-run        print what would happen, change nothing
  --force          overwrite existing plugin files
  --no-sounds      do not install the default WAV cues
  --with-examples   also copy prompt-based fallback commands (not auto-enabled)
  --uninstall      remove plugin files installed by this script
  -h, --help       show this help

Environment:
  OPENCODE_CONFIG_DIR   override the opencode config dir (default ~/.config/opencode)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    --no-sounds) WITH_SOUNDS=0; shift ;;
    --with-examples) WITH_EXAMPLES=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown option: $1 (try --help)" ;;
  esac
done

[[ -f "$PLUGIN_SRC" && -f "$CORE_SRC" ]] || die "plugin sources missing in $REPO_DIR/plugin"
[[ -f "$EXAMPLE_CONFIG" ]] || die "example config missing: $EXAMPLE_CONFIG"

if [[ "$UNINSTALL" -eq 1 ]]; then
  info "uninstall target: $CONFIG_DIR"
  for target in "$PLUGIN_DIR/soundboard.js" "$PLUGIN_DIR/soundboard-core.js"; do
    if [[ -f "$target" ]]; then
      run rm -f "$target"
      ok "removed $target"
    else
      info "not present: $target"
    fi
  done
  if [[ -f "$CONFIG_PATH" ]]; then
    run rm -f "$CONFIG_PATH"
    ok "removed $CONFIG_PATH"
  else
    info "not present: $CONFIG_PATH"
  fi
  info "sounds left in place: $SOUNDS_DIR (delete manually if unwanted)"
  exit 0
fi

printf '%s== opencode-echosound installer ==%s\n' "$BOLD" "$OFF"
info "config dir: $CONFIG_DIR"
[[ "$DRY_RUN" -eq 1 ]] && warn "dry-run: nothing will be written"

for target in "$PLUGIN_DIR/soundboard.js" "$PLUGIN_DIR/soundboard-core.js"; do
  if [[ -f "$target" && "$FORCE" -ne 1 ]]; then
    die "already exists: $target (use --force to overwrite)"
  fi
done

run mkdir -p "$PLUGIN_DIR"
ok "plugin dir ready: $PLUGIN_DIR"

run cp "$PLUGIN_SRC" "$PLUGIN_DIR/soundboard.js"
run cp "$CORE_SRC" "$PLUGIN_DIR/soundboard-core.js"
ok "plugin installed: $PLUGIN_DIR/soundboard.js"
ok "core installed:    $PLUGIN_DIR/soundboard-core.js"

if [[ "$WITH_SOUNDS" -eq 1 ]]; then
  run mkdir -p "$SOUNDS_DIR"
  for wav in "$REPO_DIR"/sounds/*.wav; do
    name="$(basename "$wav")"
    if [[ -f "$SOUNDS_DIR/$name" && "$FORCE" -ne 1 ]]; then
      info "sound exists, kept: $SOUNDS_DIR/$name"
      continue
    fi
    run cp "$wav" "$SOUNDS_DIR/$name"
    ok "sound copied: $SOUNDS_DIR/$name"
  done
else
  info "skipped sounds (--no-sounds)"
fi

if [[ -f "$CONFIG_PATH" && "$FORCE" -ne 1 ]]; then
  warn "config kept: $CONFIG_PATH"
else
  run mkdir -p "$CONFIG_DIR"
  run cp "$EXAMPLE_CONFIG" "$CONFIG_PATH"
  ok "config written: $CONFIG_PATH"
fi

if [[ "$WITH_EXAMPLES" -eq 1 ]]; then
  run mkdir -p "$CONFIG_DIR/command"
  for md in "$REPO_DIR"/examples/commands/*.md; do
    name="$(basename "$md")"
    if [[ -f "$CONFIG_DIR/command/$name" && "$FORCE" -ne 1 ]]; then
      info "command exists, kept: $CONFIG_DIR/command/$name"
      continue
    fi
    run cp "$md" "$CONFIG_DIR/command/$name"
    ok "command copied: $CONFIG_DIR/command/$name"
  done
fi

printf '\n%s== done ==%s\n' "$BOLD" "$OFF"
if command -v mpv >/dev/null 2>&1; then
  ok "player detected: mpv"
elif command -v ffplay >/dev/null 2>&1; then
  ok "player detected: ffplay"
elif command -v mpg123 >/dev/null 2>&1; then
  ok "player detected: mpg123"
else
  warn "no supported player found (mpv, ffplay, mpg123, paplay, afplay, powershell)"
  warn "install one, or set \"player\" in $CONFIG_PATH to an absolute path"
fi
info "restart opencode so the plugin is loaded"
info "toggle anytime: OPENCODE_ECHOSOUND=off  or  \"enabled\": false in $CONFIG_PATH"
