import {
  createConfigStore,
  createThrottle,
  isDisabled,
  planCommandSound,
  planEventSound,
  playSound,
  resolveEventKey,
  selectPlayer,
} from "./soundboard-core.js"

const baseDirOf = (directory, worktree) => directory || worktree || process.cwd()

export const SoundboardPlugin = async ({ client, directory, worktree, env = process.env } = {}) => {
  const store = createConfigStore({ env, directory })
  const baseDir = baseDirOf(directory, worktree)
  let throttle = null
  let throttleStamp = null
  let playerCache = null
  let playerStamp = null

  const log = async (level, message, extra) => {
    try {
      await client?.app?.log?.({
        body: {
          service: "opencode-echosound",
          level,
          message,
          extra: extra ?? {},
        },
      })
    } catch {
      return
    }
  }

  const runtime = () => {
    const state = store.get()
    const stamp = `${state.path}:${state.error ?? ""}:${state.config.player}:${state.config.throttleMs}`
    if (playerStamp !== stamp) {
      playerCache = selectPlayer(state.config.player, env)
      playerStamp = stamp
    }
    if (throttleStamp !== stamp) {
      throttle = createThrottle({
        globalMs: state.config.throttleMs,
        perKeyMs: state.config.throttleMs,
      })
      throttleStamp = stamp
    }
    return { state, player: playerCache, throttle }
  }

  const announceProblems = async (state, player) => {
    if (state.error) await log("error", state.error)
    if (player?.error) await log("warn", player.error)
  }

  const handle = async (plan, state, player, kind) => {
    if (!plan) return
    if (!plan.exists) {
      await log("warn", `sound file not found for ${kind}: ${plan.path}`)
      return
    }
    const result = playSound({ player, file: plan.path, volume: plan.volume, env })
    if (state.config.debug) {
      await log(
        result.ok ? "info" : "error",
        `${kind} -> ${plan.path} (${plan.volume}%)`,
        result.ok ? { player: player.name } : { error: result.error },
      )
    }
  }

  return {
    event: async ({ event } = {}) => {
      try {
        const type = event?.type
        if (!type) return
        const { state, player, throttle: gate } = runtime()
        const gateState = isDisabled({ config: state.config, env })
        if (gateState.disabled) {
          if (state.config.debug) await log("debug", `skipped ${type}: ${gateState.reason}`)
          return
        }
        const key = resolveEventKey(state.config, type)
        if (!key) return
        if (!gate.allow(key)) return
        await announceProblems(state, player)
        const plan = planEventSound({
          config: state.config,
          eventType: key,
          baseDir,
          player,
        })
        await handle(plan, state, player, type)
      } catch (error) {
        await log("error", "event hook failed", { error: error instanceof Error ? error.message : String(error) })
      }
    },

    "command.execute.before": async (input = {}) => {
      try {
        const command = typeof input.command === "string" ? input.command : null
        if (!command) return
        const { state, player, throttle: gate } = runtime()
        const gateState = isDisabled({ config: state.config, env })
        if (gateState.disabled) return
        const key = `command:${command}`
        if (!gate.allow(key)) return
        const plan = planCommandSound({
          config: state.config,
          command,
          baseDir,
          player,
        })
        await handle(plan, state, player, `command ${command}`)
      } catch (error) {
        await log("error", "command hook failed", { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}
