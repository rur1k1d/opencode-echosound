---
description: Chime on launch (prompt-based fallback, works without the plugin).
---

Play the cue in the background, non-blocking, then continue with the task. Never
wait for the sound and never let a playback problem block the task.

!`nohup mpv --really-quiet --no-terminal "$HOME/.config/opencode/sounds/done-soft.wav" >/dev/null 2>&1 & echo cue`

Extra input from the user, if any: $ARGUMENTS
