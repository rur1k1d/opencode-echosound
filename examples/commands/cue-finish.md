---
description: Run a task, then chime when finished (prompt-based fallback, costs one tool call).
---

Do the task below, then play the cue as your very last action.

Task: $ARGUMENTS

When the work is completely done, run exactly this through the Bash tool, in the
background, and do not wait for it:

`nohup mpv --really-quiet --no-terminal "$HOME/.config/opencode/sounds/done-soft.wav" >/dev/null 2>&1 &`

Notes for the agent: the sound is a side effect, never a gate. If playback fails,
do not debug it and do not mention it in the summary.
