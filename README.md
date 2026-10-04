# opencode-echosound

Non-blocking sound hooks for [opencode](https://opencode.ai): a chime when a
session starts, a softer one when the agent goes idle, an alert on errors, and a
ping when it waits for your approval.

The whole point: **the sound is a side effect, never a gate.** Audio is spawned
detached with stdio ignored, so no prompt, tool call, or model turn ever waits
for it. Zero dependencies, zero API keys, MIT.

```
session.created  ->  startup.wav      opencode is up
session.idle     ->  done-soft.wav    the agent stopped working
session.error    ->  error.wav        something broke
permission.asked ->  ping.wav         it needs your yes
```

## Why not just put a shell command in a custom command?

You can, and it works, but then the sound costs a model turn: the agent has to
decide to run it, spend a tool call, and can forget or skip it. This plugin hooks
opencode's own event stream, so playback is deterministic, instant, and free.

## Requirements

- opencode 1.18 or newer (uses the documented plugin hooks)
- one audio player: `mpv`, `ffplay`, `mpg123`, `paplay`, `afplay`, or
  PowerShell on Windows
- Node.js only if you want to run the tests

## Install

```bash
git clone https://github.com/rur1k1d/opencode-echosound.git
cd opencode-echosound
./install.sh
```

Restart opencode afterwards. The installer copies the plugin into
`~/.config/opencode/plugins/`, copies the default cues into
`~/.config/opencode/sounds/`, and writes `~/.config/opencode/sounds.json` only if
that file does not exist yet.

| Flag | Effect |
|---|---|
| `--dry-run` | print every action, write nothing |
| `--force` | overwrite an existing plugin or config |
| `--no-sounds` | skip the WAV cues |
| `--with-examples` | also copy the prompt-based fallback commands |
| `--uninstall` | remove the plugin files and the config |

## Configuration

`~/.config/opencode/sounds.json` is optional: without it the plugin stays quiet.

```json
{
  "enabled": true,
  "player": "auto",
  "volume": 70,
  "throttleMs": 250,
  "debug": false,
  "events": {
    "session.created": "sounds/startup.wav",
    "session.idle": "sounds/done-soft.wav",
    "session.error": { "file": "sounds/error.wav", "volume": 90 },
    "permission.asked": { "file": "sounds/ping.wav", "volume": 70 }
  },
  "commands": {}
}
```

| Key | Meaning |
|---|---|
| `enabled` | master switch, same as `"enabled": false` |
| `player` | `auto`, a player name, or an absolute path to your own player script |
| `volume` | default 0-100, used when an event has no volume of its own |
| `throttleMs` | ignore repeats of the same sound inside this window |
| `debug` | log every playback decision to the opencode log |
| `events` | event name to sound, or `null` / `"off"` to mute one event |
| `commands` | optional slash-command name to sound |

Event names: `session.created`, `session.idle`, `session.error`,
`permission.asked`. The alias `permission.ask` works in the config too, and both
spellings can be mapped.

Paths are resolved relative to the config file's directory, and `~` plus `$VARS`
are expanded. The config is re-read whenever it changes on disk, so edits apply
without a restart.

### Change the sound

Three ways, no code required:

1. **Replace a file.** Drop your own audio at `~/.config/opencode/sounds/done-soft.wav`
   and the next idle already plays it. Same name wins, no config edit.
2. **Point somewhere else.** Use any path, absolute or relative:
   `"session.idle": "/home/me/audio/coin.wav"`, or `"~/Music/chime.mp3"`.
3. **Generate your own.** `tools/make_sounds.py` is stdlib-only Python:

   ```bash
   python3 tools/make_sounds.py --out-dir ~/.config/opencode/sounds --force
   python3 tools/make_sounds.py --list
   ```

Per-event volume is the usual reason to reach for the object form, so a
finished task stays quiet while an error cuts through:

```json
"events": {
  "session.idle": { "file": "sounds/done-soft.wav", "volume": 35 },
  "session.error": { "file": "sounds/error.wav", "volume": 95 }
}
```

### Sound for a specific command

```json
"commands": {
  "deploy": "sounds/blip.wav",
  "review": { "file": "sounds/ping.wav", "volume": 50 }
}
```

Unknown command names are ignored, so this can never break a command.

### Kill switch

```bash
OPENCODE_ECHOSOUND=off opencode     # this run only
```

`"enabled": false` in the config, or any `CI` value other than `0`/`false`,
also disables playback. Handy on remote boxes and in pipelines.

## Non-invasive by design

- It only ever **adds** a file in the documented plugin directory. It does not
  patch the opencode binary, your `opencode.json`, or any existing command.
- It **never** changes prompt content, model parameters, tool arguments, or
  permission decisions. `permission.asked` is read as an event only, so an
  approval prompt stays exactly as opencode rendered it.
- Every failure path is swallowed: a broken config, a missing sound, or a missing
  player logs a warning at most and playback is skipped.
- Playback is `spawn(..., { detached: true, stdio: "ignore" })` plus `unref()`, so
  no file descriptors leak into opencode and nothing waits on the sound.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| No sound at all | Set `"debug": true`, then `opencode --print-logs --log-level DEBUG` and look for `opencode-echosound` lines. |
| `no audio player found on PATH` | Install `mpv` or `ffplay`, or set `"player"` to an absolute path of any executable. |
| `sound file not found` | Paths resolve relative to `sounds.json`; `sounds/x.wav` means `~/.config/opencode/sounds/x.wav`. |
| Silent on a remote box | No audio device, or PipeWire is not running for that user. Check with `mpv sounds/startup.wav`. |
| Sound plays twice | Something else also plays it: a prompt-injected cue command, or a `commands` entry plus a manual cue. Pick one mechanism. |
| PowerShell only plays WAV | `System.Media.SoundPlayer` is WAV-only. Use mpv or ffplay for mp3/m4a on Windows. |

## Tests

```bash
./tests/run.sh              # syntax, plugin contract, 24 unit tests
ECHOSOUND_E2E=1 ./tests/run.sh   # plus a real opencode session (costs a few tokens)
```

`tests/e2e.sh` points `player` at a fake player script that logs its argv, runs
one throwaway opencode session, and asserts the lifecycle hooks really fire. It
is the check that the hooks are alive on your opencode version, so run it once
after upgrading opencode.

## Uninstall

```bash
./install.sh --uninstall
```

Sound files are left in place; delete `~/.config/opencode/sounds/` if you want
them gone.

## License

MIT, see [LICENSE](LICENSE). Not affiliated with opencode. The generated WAV cues
are synthesized from scratch by `tools/make_sounds.py`, so there are no
third-party audio assets or licensing questions.
