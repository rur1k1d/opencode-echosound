import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync, utimesSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  CONFIG_ENV,
  CONFIG_BASENAME,
  DEFAULTS,
  EVENT_ALIASES,
  KILL_SWITCH_ENV,
  OFF_TOKENS,
  PLAYERS,
  PLAYER_ORDER,
  autoPlayer,
  buildArgs,
  clampVolume,
  createConfigStore,
  createThrottle,
  expandPath,
  findExecutable,
  isDisabled,
  isOffToken,
  mergeConfig,
  normalizeEntry,
  playSound,
  planCommandSound,
  planEventSound,
  readConfigFile,
  resolveConfigPath,
  resolveEntry,
  resolveEventKey,
  selectPlayer,
} from "../plugin/soundboard-core.js"

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)))
const SOUNDS = join(REPO, "sounds")
const existingSound = join(SOUNDS, "ping.wav")

function tmpDir() {
  return mkdtempSync(join(tmpdir(), "echosound-"))
}

function writeConfig(dir, payload) {
  const path = join(dir, CONFIG_BASENAME)
  writeFileSync(path, typeof payload === "string" ? payload : JSON.stringify(payload))
  return path
}

function fakePlayer(dir, name = "player.sh") {
  const path = join(dir, name)
  writeFileSync(path, "#!/bin/sh\nexit 0\n")
  chmodSync(path, 0o755)
  return path
}

test("clampVolume keeps values inside 0-100 and falls back to default", () => {
  assert.equal(clampVolume(0), 0)
  assert.equal(clampVolume(100), 100)
  assert.equal(clampVolume(140), 100)
  assert.equal(clampVolume(-5), 0)
  assert.equal(clampVolume(45.4), 45)
  assert.equal(clampVolume("nope"), DEFAULTS.volume)
  assert.equal(clampVolume(undefined), DEFAULTS.volume)
})

test("isOffToken accepts every documented off spelling", () => {
  for (const token of OFF_TOKENS) assert.equal(isOffToken(token), true)
  assert.equal(isOffToken(" OFF "), true)
  assert.equal(isOffToken("ping.wav"), false)
  assert.equal(isOffToken(null), false)
})

test("expandPath expands ~, env vars and relative paths", () => {
  process.env.ECHOSOUND_TEST_DIR = "/tmp/echosound-env"
  assert.equal(expandPath("~/x.wav", "/base"), join(homedir(), "x.wav"))
  assert.equal(expandPath("$ECHOSOUND_TEST_DIR/x.wav", "/base"), "/tmp/echosound-env/x.wav")
  assert.equal(expandPath("${ECHOSOUND_TEST_DIR}/x.wav", "/base"), "/tmp/echosound-env/x.wav")
  assert.equal(expandPath("rel/x.wav", "/base"), "/base/rel/x.wav")
  assert.equal(expandPath("/abs/x.wav", "/base"), "/abs/x.wav")
  assert.equal(expandPath("", "/base"), null)
  assert.equal(expandPath(null, "/base"), null)
  delete process.env.ECHOSOUND_TEST_DIR
})

test("expandPath keeps unknown env vars literal and never injects undefined", () => {
  const out = expandPath("$ECHOSOUND_DOES_NOT_EXIST/x.wav", "/base")
  assert.ok(out.endsWith("$ECHOSOUND_DOES_NOT_EXIST/x.wav"))
  assert.ok(!out.includes("undefined"))
})

test("normalizeEntry handles string, object, off and junk input", () => {
  assert.deepEqual(normalizeEntry("a.wav"), { file: "a.wav" })
  assert.deepEqual(normalizeEntry({ file: "b.wav", volume: 33 }), { file: "b.wav", volume: 33 })
  assert.deepEqual(normalizeEntry({ file: "c.wav", volume: 999 }), { file: "c.wav", volume: 100 })
  assert.equal(normalizeEntry("off"), null)
  assert.equal(normalizeEntry("none"), null)
  assert.equal(normalizeEntry(false), null)
  assert.equal(normalizeEntry(null), null)
  assert.equal(normalizeEntry(undefined), null)
  assert.equal(normalizeEntry({ nope: 1 }), null)
  assert.equal(normalizeEntry(42), null)
  assert.equal(normalizeEntry({ file: "  " }), null)
})

test("resolveEntry resolves against baseDir, applies default volume and reports existence", () => {
  const dir = tmpDir()
  const rel = resolveEntry("sounds/ping.wav", { baseDir: REPO })
  assert.equal(rel.path, existingSound)
  assert.equal(rel.exists, true)
  assert.equal(rel.volume, DEFAULTS.volume)

  const obj = resolveEntry({ file: "sounds/ping.wav", volume: 12 }, { baseDir: REPO })
  assert.equal(obj.volume, 12)

  const missing = resolveEntry("nope.wav", { baseDir: dir, defaultVolume: 20 })
  assert.equal(missing.exists, false)
  assert.equal(missing.volume, 20)

  const disabled = resolveEntry("off", { baseDir: REPO })
  assert.equal(disabled, null)
})

test("mergeConfig never loses defaults and rejects non-objects", () => {
  const merged = mergeConfig({ volume: 120, throttleMs: -3, player: " ffplay ", events: { a: "x.wav" } })
  assert.equal(merged.volume, 100)
  assert.equal(merged.throttleMs, 0)
  assert.equal(merged.player, "ffplay")
  assert.deepEqual(merged.events, { a: "x.wav" })
  assert.deepEqual(merged.commands, {})
  assert.equal(mergeConfig(null).enabled, true)
  assert.equal(mergeConfig([1, 2]).enabled, true)
  assert.equal(mergeConfig({ enabled: false }).enabled, false)
  assert.equal(mergeConfig({ enabled: "yes" }).enabled, true)
})

test("readConfigFile fails safe on missing file and on broken JSON", () => {
  const missing = readConfigFile(join(tmpDir(), "nope.json"))
  assert.equal(missing.missing, true)
  assert.equal(missing.config.enabled, false)
  assert.equal(missing.error, null)

  const broken = readConfigFile(writeConfig(tmpDir(), "{not json"))
  assert.equal(broken.missing, false)
  assert.equal(broken.config.enabled, false)
  assert.match(broken.error, /cannot parse/)

  const good = readConfigFile(writeConfig(tmpDir(), { volume: 10 }))
  assert.equal(good.config.enabled, true)
  assert.equal(good.config.volume, 10)
})

test("resolveConfigPath honours ECHOSOUND_CONFIG, then project, then global", () => {
  const projectDir = tmpDir()
  const projectConfig = join(projectDir, ".opencode", CONFIG_BASENAME)
  mkdirSync(join(projectDir, ".opencode"), { recursive: true })
  writeFileSync(projectConfig, JSON.stringify({ volume: 11 }))

  assert.equal(resolveConfigPath({ env: { [CONFIG_ENV]: "/tmp/forced.json" } }), "/tmp/forced.json")
  assert.equal(resolveConfigPath({ env: {}, directory: projectDir }), projectConfig)
  assert.equal(
    resolveConfigPath({ env: {}, directory: tmpDir() }),
    join(homedir(), ".config", "opencode", CONFIG_BASENAME),
  )
})

test("createConfigStore caches by mtime and reloads after a write", async () => {
  const dir = tmpDir()
  const path = writeConfig(dir, { volume: 20 })
  const store = createConfigStore({ env: { [CONFIG_ENV]: path } })

  assert.equal(store.get().config.volume, 20)
  const future = new Date(Date.now() + 5000)
  writeFileSync(path, JSON.stringify({ volume: 80 }))
  utimesSync(path, future, future)
  assert.equal(store.get().config.volume, 80)

  store.invalidate()
  assert.equal(store.path, path)
})

test("isDisabled respects kill switch, CI and config flag", () => {
  assert.equal(isDisabled({ config: { enabled: true }, env: {} }).disabled, false)
  assert.equal(isDisabled({ config: { enabled: false }, env: {} }).reason, "config.enabled=false")
  assert.equal(isDisabled({ config: {}, env: { [KILL_SWITCH_ENV]: "off" } }).disabled, true)
  assert.equal(isDisabled({ config: {}, env: { [KILL_SWITCH_ENV]: "1" } }).disabled, false)
  assert.equal(isDisabled({ config: {}, env: { CI: "true" } }).disabled, true)
  assert.equal(isDisabled({ config: {}, env: { CI: "false" } }).disabled, false)
})

test("findExecutable resolves PATH entries and explicit paths only", () => {
  assert.ok(findExecutable("sh"))
  assert.equal(findExecutable("definitely-not-a-real-binary-xyz"), null)
  const dir = tmpDir()
  assert.equal(findExecutable(join(dir, "ghost.sh")), null)
  assert.equal(findExecutable(fakePlayer(dir)), join(dir, "player.sh"))
  assert.equal(findExecutable(""), null)
})

test("selectPlayer picks a working player automatically", () => {
  const player = autoPlayer({ PATH: "/usr/bin:/bin" })
  assert.ok(player.name, "expected mpv/ffplay/mpg123 on this box")
  assert.ok(PLAYER_ORDER.includes(player.name))
  assert.equal(player.error ?? null, null)

  assert.equal(selectPlayer("auto", { PATH: "/nonexistent" }).error, "no audio player found on PATH")
  assert.equal(selectPlayer("mpv", { PATH: "/nonexistent" }).error, "no audio player found on PATH")
  const unknown = selectPlayer("winamp", { PATH: "/usr/bin:/bin" })
  assert.match(unknown.error, /unknown player "winamp", falling back to auto/)
  assert.ok(unknown.command)
})

test("selectPlayer accepts an absolute custom player path", () => {
  const dir = tmpDir()
  const script = fakePlayer(dir)
  const player = selectPlayer(script, {})
  assert.equal(player.name, "custom")
  assert.equal(player.command, script)
  assert.deepEqual(buildArgs(player, "/x.wav", 50), ["/x.wav"])

  const ghost = selectPlayer(join(dir, "ghost.sh"), {})
  assert.equal(ghost.command, null)
  assert.match(ghost.error, /player not executable/)
})

test("buildArgs maps volume per player", () => {
  assert.deepEqual(PLAYERS.mpv("/x.wav", 70), ["--really-quiet", "--no-terminal", "--volume=70", "/x.wav"])
  assert.deepEqual(PLAYERS.ffplay("/x.wav", 70), ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", "70", "/x.wav"])
  assert.deepEqual(PLAYERS.mpg123("/x.wav", 100), ["-q", "-f", "32768", "/x.wav"])
  assert.deepEqual(PLAYERS.paplay("/x.wav", 45), ["--volume=45%", "/x.wav"])
  assert.deepEqual(PLAYERS.afplay("/x.wav", 45), ["-v", "0.45", "/x.wav"])
  assert.equal(buildArgs(null, "/x.wav", 70), null)
  assert.equal(buildArgs({ build: () => null }, "/x.wav", 70), null)
})

test("powershell argv escapes single quotes in the path", () => {
  const args = PLAYERS.powershell("/tmp/it's/x.wav")
  assert.ok(args.at(-1).includes("''"))
})

test("playSound spawns detached and reports failure instead of throwing", () => {
  const dir = tmpDir()
  const script = fakePlayer(dir)
  const ok = playSound({ player: { command: script, build: (file) => [file] }, file: existingSound, volume: 50 })
  assert.equal(ok.ok, true)
  assert.ok(ok.args.includes(existingSound))
  assert.equal(playSound({ player: null, file: existingSound }).ok, false)
})

test("createThrottle blocks bursts globally and per key", () => {
  const gate = createThrottle({ globalMs: 100, perKeyMs: 100 })
  assert.equal(gate.allow("a", 1000), true)
  assert.equal(gate.allow("a", 1050), false)
  assert.equal(gate.allow("b", 1050), false)
  assert.equal(gate.allow("b", 1200), true)
  gate.reset()
  assert.equal(gate.allow("a", 1201), true)

  const open = createThrottle({ globalMs: 0, perKeyMs: 0 })
  assert.equal(open.allow("a", 1), true)
  assert.equal(open.allow("a", 1), true)
})

test("resolveEventKey maps the permission alias in both directions", () => {
  const config = mergeConfig({ events: { "permission.asked": "p.wav" } })
  assert.equal(resolveEventKey(config, "permission.asked"), "permission.asked")
  assert.equal(resolveEventKey(config, "permission.ask"), "permission.asked")
  assert.equal(resolveEventKey(config, "session.idle"), null)

  const aliasConfig = mergeConfig({ events: { "permission.ask": "p.wav" } })
  assert.equal(resolveEventKey(aliasConfig, "permission.asked"), "permission.ask")
  assert.ok(EVENT_ALIASES["permission.ask"])
})

test("planEventSound produces argv only for mapped events with an existing player", () => {
  const player = selectPlayer("auto", { PATH: "/usr/bin:/bin" })
  const config = mergeConfig({ volume: 60, events: { "session.idle": "sounds/done-soft.wav" } })

  const plan = planEventSound({ config, eventType: "session.idle", baseDir: REPO, player })
  assert.equal(plan.path, join(SOUNDS, "done-soft.wav"))
  assert.equal(plan.volume, 60)
  assert.equal(plan.exists, true)
  assert.equal(plan.args.at(-1), join(SOUNDS, "done-soft.wav"))

  assert.equal(planEventSound({ config, eventType: "session.error", baseDir: REPO, player }), null)
  assert.equal(planEventSound({ config, eventType: "session.idle", baseDir: REPO, player: null }), null)
  assert.equal(
    planEventSound({ config: mergeConfig({ enabled: false }), eventType: "session.idle", baseDir: REPO, player }),
    null,
  )
})

test("planEventSound honours per-event volume and off switch", () => {
  const player = selectPlayer("auto", { PATH: "/usr/bin:/bin" })
  const config = mergeConfig({ volume: 30, events: { "session.error": { file: "sounds/error.wav", volume: 95 } } })
  const plan = planEventSound({ config, eventType: "session.error", baseDir: REPO, player })
  assert.equal(plan.volume, 95)

  const off = mergeConfig({ events: { "session.idle": "off" } })
  assert.equal(planEventSound({ config: off, eventType: "session.idle", baseDir: REPO, player }), null)
})

test("planCommandSound stays empty unless commands are mapped", () => {
  const player = selectPlayer("auto", { PATH: "/usr/bin:/bin" })
  const empty = mergeConfig({ events: {} })
  assert.equal(planCommandSound({ config: empty, command: "deploy", baseDir: REPO, player }), null)

  const mapped = mergeConfig({ commands: { deploy: "sounds/blip.wav" } })
  const plan = planCommandSound({ config: mapped, command: "deploy", baseDir: REPO, player })
  assert.equal(plan.key, "command:deploy")
  assert.equal(plan.path, join(SOUNDS, "blip.wav"))
  assert.equal(planCommandSound({ config: mapped, command: "", baseDir: REPO, player }), null)
})

test("planCommandSound reports missing files instead of guessing", () => {
  const player = selectPlayer("auto", { PATH: "/usr/bin:/bin" })
  const config = mergeConfig({ commands: { deploy: "ghost.wav" } })
  const plan = planCommandSound({ config, command: "deploy", baseDir: tmpDir(), player })
  assert.equal(plan.exists, false)
})

test("repo sounds are valid 16-bit mono 44.1 kHz wav files", async () => {
  const { readFileSync } = await import("node:fs")
  for (const name of ["startup", "done-soft", "error", "ping", "blip"]) {
    const buffer = readFileSync(join(SOUNDS, `${name}.wav`))
    assert.equal(buffer.subarray(0, 4).toString("ascii"), "RIFF")
    assert.equal(buffer.subarray(8, 12).toString("ascii"), "WAVE")
    assert.equal(buffer.readUInt16LE(22), 1, `${name} channels`)
    assert.equal(buffer.readUInt16LE(34), 16, `${name} bits`)
    assert.equal(buffer.readUInt32LE(24), 44100, `${name} rate`)
    assert.ok(buffer.length > 1000, `${name} has audio data`)
  }
})
