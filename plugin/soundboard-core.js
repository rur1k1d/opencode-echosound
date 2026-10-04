import { spawn } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, isAbsolute, join, resolve as resolveFsPath } from "node:path"

export const CONFIG_BASENAME = "sounds.json"
export const CONFIG_ENV = "ECHOSOUND_CONFIG"
export const KILL_SWITCH_ENV = "OPENCODE_ECHOSOUND"
export const OFF_TOKENS = new Set(["off", "none", "no", "false", "0", "disabled"])
export const KNOWN_EVENTS = [
  "session.created",
  "session.idle",
  "session.error",
  "permission.asked",
]

export const EVENT_ALIASES = {
  "permission.ask": "permission.asked",
}

export function resolveEventKey(config, eventType) {
  if (!config || !config.events || typeof config.events !== "object") return null
  if (eventType in config.events) return eventType
  const canonical = EVENT_ALIASES[eventType]
  if (canonical && canonical in config.events) return canonical
  for (const [alias, target] of Object.entries(EVENT_ALIASES)) {
    if (target === eventType && alias in config.events) return alias
  }
  return null
}

export const DEFAULTS = Object.freeze({
  enabled: true,
  player: "auto",
  volume: 70,
  throttleMs: 250,
  events: {},
  commands: {},
})

export const PLAYERS = {
  mpv: (file, volume) => [
    "--really-quiet",
    "--no-terminal",
    `--volume=${clampVolume(volume)}`,
    file,
  ],
  ffplay: (file, volume) => [
    "-nodisp",
    "-autoexit",
    "-loglevel",
    "quiet",
    "-volume",
    String(clampVolume(volume)),
    file,
  ],
  mpg123: (file, volume) => [
    "-q",
    "-f",
    String(Math.max(1, Math.round((32768 * clampVolume(volume)) / 100))),
    file,
  ],
  paplay: (file, volume) => ["--volume=" + clampVolume(volume) + "%", file],
  afplay: (file, volume) => ["-v", (clampVolume(volume) / 100).toFixed(2), file],
  powershell: (file) => [
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-Command",
    `(New-Object Media.SoundPlayer '${escapeForSingleQuotes(file)}').PlaySync(); Start-Sleep -Milliseconds 400`,
  ],
}

export const PLAYER_ORDER = ["mpv", "ffplay", "mpg123", "paplay", "afplay", "powershell"]

export function clampVolume(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULTS.volume
  return Math.min(100, Math.max(0, Math.round(parsed)))
}

export function isOffToken(value) {
  return typeof value === "string" && OFF_TOKENS.has(value.trim().toLowerCase())
}

export function expandPath(input, baseDir) {
  if (typeof input !== "string" || input.length === 0) return null
  let out = input.trim()
  if (out.startsWith("~")) {
    out = join(homedir(), out.slice(1))
  }
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced || bare
    const value = process.env[name]
    return value === undefined ? match : value
  })
  if (isAbsolute(out)) return out
  return resolveFsPath(baseDir, out)
}

export function normalizeEntry(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null
  if (isOffToken(value)) return null
  if (typeof value === "string") {
    const file = value.trim()
    return file.length > 0 ? { file } : null
  }
  if (typeof value === "object" && typeof value.file === "string") {
    const file = value.file.trim()
    if (file.length === 0) return null
    const entry = { file }
    if (value.volume !== undefined) entry.volume = clampVolume(value.volume)
    return entry
  }
  return null
}

export function resolveEntry(entry, options = {}) {
  const normalized = normalizeEntry(entry)
  if (!normalized) return null
  const baseDir = options.baseDir || homedir()
  const path = expandPath(normalized.file, baseDir)
  if (!path) return null
  return {
    file: normalized.file,
    path,
    volume: normalized.volume !== undefined ? normalized.volume : clampVolume(options.defaultVolume ?? DEFAULTS.volume),
    exists: existsSync(path),
  }
}

export function mergeConfig(raw) {
  const base = { ...DEFAULTS, events: {}, commands: {} }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base
  const merged = {
    ...base,
    ...raw,
    events: { ...base.events, ...(raw.events && typeof raw.events === "object" ? raw.events : {}) },
    commands: { ...base.commands, ...(raw.commands && typeof raw.commands === "object" ? raw.commands : {}) },
  }
  merged.enabled = raw.enabled === undefined ? base.enabled : raw.enabled !== false
  merged.volume = clampVolume(raw.volume ?? base.volume)
  merged.throttleMs = clampNumber(raw.throttleMs, 0, 10000, base.throttleMs)
  merged.player = typeof raw.player === "string" && raw.player.trim() ? raw.player.trim() : base.player
  return merged
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function readConfigFile(configPath) {
  if (!configPath || !existsSync(configPath)) {
    return { config: { ...DEFAULTS, enabled: false }, error: null, missing: true }
  }
  try {
    const raw = readFileSync(configPath, "utf8")
    return { config: mergeConfig(JSON.parse(raw)), error: null, missing: false }
  } catch (error) {
    return {
      config: { ...DEFAULTS, enabled: false },
      error: `cannot parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      missing: false,
    }
  }
}

export function resolveConfigPath({ env = process.env, directory } = {}) {
  const explicit = env[CONFIG_ENV]
  if (explicit && explicit.trim()) return resolveFsPath(expandPath(explicit.trim(), process.cwd()))
  if (directory) {
    const projectPath = join(directory, ".opencode", CONFIG_BASENAME)
    if (existsSync(projectPath)) return projectPath
  }
  return join(homedir(), ".config", "opencode", CONFIG_BASENAME)
}

export function createConfigStore(options = {}) {
  const env = options.env || process.env
  let cached = null
  let signature = null

  return {
    get path() {
      return resolveConfigPath({ env, directory: options.directory })
    },
    get() {
      const path = resolveConfigPath({ env, directory: options.directory })
      let stamp = "missing"
      try {
        const stats = statSync(path)
        stamp = `${stats.mtimeMs}:${stats.size}`
      } catch {
        stamp = "missing"
      }
      if (cached && stamp === signature) return cached
      const result = readConfigFile(path)
      cached = { ...result, path }
      signature = stamp
      return cached
    },
    invalidate() {
      cached = null
      signature = null
    },
  }
}

export function isDisabled({ config, env = process.env } = {}) {
  const kill = env[KILL_SWITCH_ENV]
  if (typeof kill === "string" && kill.trim() && !["1", "true", "on", "yes"].includes(kill.trim().toLowerCase())) {
    return { disabled: true, reason: `${KILL_SWITCH_ENV}=${kill}` }
  }
  const ci = env.CI
  if (typeof ci === "string" && ci.trim() && !["0", "false", "off"].includes(ci.trim().toLowerCase())) {
    return { disabled: true, reason: `CI=${ci}` }
  }
  if (config && config.enabled === false) {
    return { disabled: true, reason: "config.enabled=false" }
  }
  return { disabled: false, reason: null }
}

export function findExecutable(name, env = process.env) {
  if (typeof name !== "string" || name.length === 0) return null
  if (name.includes("/") || name.includes("\\")) {
    const direct = expandPath(name, process.cwd())
    return direct && isExecutableFile(direct) ? direct : null
  }
  const paths = (env.PATH || "").split(delimiter).filter(Boolean)
  for (const dir of paths) {
    const candidate = join(dir, name)
    if (isExecutableFile(candidate)) return candidate
  }
  return null
}

function isExecutableFile(path) {
  try {
    const stats = statSync(path)
    if (!stats.isFile()) return false
    if (process.platform !== "win32") {
      const mode = stats.mode & 0o111
      return mode !== 0
    }
    return true
  } catch {
    return false
  }
}

function looksLikePath(value) {
  return value.includes("/") || value.includes("\\") || value.startsWith(".")
}

function escapeForSingleQuotes(value) {
  return value.replace(/'/g, "''")
}

export function selectPlayer(preferred, env = process.env) {
  const wanted = typeof preferred === "string" && preferred.trim() ? preferred.trim() : "auto"
  if (wanted !== "auto" && looksLikePath(wanted)) {
    const resolved = findExecutable(wanted, env)
    return resolved
      ? { name: "custom", command: resolved, build: (file) => [file] }
      : { name: null, command: null, build: null, error: `player not executable: ${wanted}` }
  }
  if (wanted !== "auto") {
    const build = PLAYERS[wanted.toLowerCase()]
    const resolved = build ? findExecutable(wanted.toLowerCase(), env) : null
    if (build && resolved) {
      return { name: wanted.toLowerCase(), command: resolved, build }
    }
    if (!build) {
      return { ...autoPlayer(env), error: `unknown player "${wanted}", falling back to auto` }
    }
  }
  return autoPlayer(env)
}

export function autoPlayer(env = process.env) {
  for (const name of PLAYER_ORDER) {
    const resolved = findExecutable(name, env)
    if (resolved) return { name, command: resolved, build: PLAYERS[name] }
  }
  return { name: null, command: null, build: null, error: "no audio player found on PATH" }
}

export function buildArgs(player, file, volume) {
  if (!player || typeof player.build !== "function") return null
  const args = player.build(file, volume)
  if (!Array.isArray(args)) return null
  return args.filter((part) => typeof part === "string")
}

export function playSound({ player, file, volume, env = process.env }) {
  const args = buildArgs(player, file, volume)
  if (!player || !player.command || !args || args.length === 0) {
    return { ok: false, error: "nothing to play" }
  }
  try {
    const child = spawn(player.command, args, {
      detached: true,
      stdio: "ignore",
      env,
    })
    child.unref()
    return { ok: true, pid: child.pid ?? null, command: player.command, args }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function createThrottle({ globalMs = DEFAULTS.throttleMs, perKeyMs = DEFAULTS.throttleMs } = {}) {
  const stamps = new Map()
  let lastGlobal = 0
  return {
    allow(key, now = Date.now()) {
      if (globalMs > 0 && now - lastGlobal < globalMs) return false
      if (perKeyMs > 0) {
        const previous = stamps.get(key) ?? 0
        if (now - previous < perKeyMs) return false
      }
      stamps.set(key, now)
      lastGlobal = now
      return true
    },
    reset() {
      stamps.clear()
      lastGlobal = 0
    },
  }
}

export function planEventSound({ config, eventType, baseDir, player }) {
  if (!config || config.enabled === false) return null
  if (!config.events || typeof config.events !== "object") return null
  if (!(eventType in config.events)) return null
  const resolved = resolveEntry(config.events[eventType], {
    baseDir,
    defaultVolume: config.volume,
  })
  if (!resolved) return null
  const args = buildArgs(player, resolved.path, resolved.volume)
  if (!player || !player.command || !args) return null
  return {
    key: eventType,
    eventType,
    path: resolved.path,
    volume: resolved.volume,
    exists: resolved.exists,
    args,
  }
}

export function planCommandSound({ config, command, baseDir, player }) {
  if (!config || config.enabled === false) return null
  if (!config.commands || typeof config.commands !== "object") return null
  if (!command || !(command in config.commands)) return null
  const resolved = resolveEntry(config.commands[command], {
    baseDir,
    defaultVolume: config.volume,
  })
  if (!resolved) return null
  const args = buildArgs(player, resolved.path, resolved.volume)
  if (!player || !player.command || !args) return null
  return {
    key: `command:${command}`,
    command,
    path: resolved.path,
    volume: resolved.volume,
    exists: resolved.exists,
    args,
  }
}
