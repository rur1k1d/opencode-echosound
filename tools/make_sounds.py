#!/usr/bin/env python3
"""Generate the default WAV cues for opencode-echosound (stdlib only, no deps)."""

from __future__ import annotations

import argparse
import math
import struct
import sys
import wave
from pathlib import Path

SAMPLE_RATE = 44100
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "sounds"


def envelope(position: float, total: float, attack: float = 0.02, release: float = 0.35) -> float:
    if position < attack * total:
        return position / max(attack * total, 1e-9)
    tail = (total - position) / max(release * total, 1e-9)
    return max(0.0, min(1.0, tail))


def tone(
    freq: float,
    duration: float,
    volume: float = 0.5,
    harmonics: tuple[float, ...] = (1.0,),
    vibrato: float = 0.0,
) -> list[float]:
    frames = int(SAMPLE_RATE * duration)
    out: list[float] = []
    for index in range(frames):
        t = index / SAMPLE_RATE
        wobble = 1.0 + vibrato * math.sin(2 * math.pi * 5.5 * t)
        sample = 0.0
        for multiple, weight in enumerate(harmonics, start=1):
            sample += weight * math.sin(2 * math.pi * freq * wobble * multiple * t)
        norm = sum(harmonics)
        out.append(volume * sample / max(norm, 1e-9) * envelope(index, frames))
    return out


def silence(duration: float) -> list[float]:
    return [0.0] * int(SAMPLE_RATE * duration)


def mix(*layers: list[float]) -> list[float]:
    length = max((len(layer) for layer in layers), default=0)
    out = [0.0] * length
    for layer in layers:
        for index, value in enumerate(layer):
            out[index] += value
    return [max(-1.0, min(1.0, value)) for value in out]


def sequence(*parts: list[float]) -> list[float]:
    out: list[float] = []
    for part in parts:
        out.extend(part)
    return out


def build(name: str) -> list[float]:
    if name == "startup":
        return sequence(
            tone(587.33, 0.09, 0.42, (1.0, 0.35)),
            silence(0.03),
            tone(880.0, 0.16, 0.46, (1.0, 0.3, 0.12)),
        )
    if name == "done-soft":
        return sequence(
            tone(659.25, 0.11, 0.34, (1.0, 0.25)),
            tone(987.77, 0.22, 0.3, (1.0, 0.2)),
        )
    if name == "error":
        return sequence(
            tone(233.08, 0.16, 0.5, (1.0, 0.6, 0.3)),
            silence(0.05),
            tone(174.61, 0.34, 0.55, (1.0, 0.7, 0.35)),
        )
    if name == "ping":
        return tone(1174.66, 0.13, 0.4, (1.0, 0.2), vibrato=0.004)
    if name == "blip":
        return tone(987.77, 0.06, 0.38, (1.0, 0.25))
    raise SystemExit(f"unknown sound: {name}")


SOUNDS = ("startup", "done-soft", "error", "ping", "blip")


def write_wav(path: Path, samples: list[float]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = bytearray()
    for value in samples:
        frames += struct.pack("<h", int(max(-1.0, min(1.0, value)) * 32767))
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(bytes(frames))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Generate opencode-echosound WAV cues")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT), help="destination directory")
    parser.add_argument("--only", action="append", choices=SOUNDS, help="generate a single sound (repeatable)")
    parser.add_argument("--force", action="store_true", help="overwrite existing files")
    parser.add_argument("--list", action="store_true", help="print sound names and exit")
    args = parser.parse_args(argv)

    if args.list:
        for name in SOUNDS:
            print(name)
        return 0

    out_dir = Path(args.out_dir).expanduser().resolve()
    wanted = tuple(args.only) if args.only else SOUNDS
    written = 0
    skipped = 0
    for name in wanted:
        target = out_dir / f"{name}.wav"
        if target.exists() and not args.force:
            skipped += 1
            print(f"[=] {target} (exists, use --force)")
            continue
        write_wav(target, build(name))
        written += 1
        print(f"[+] {target}")
    print(f"done: {written} written, {skipped} skipped -> {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
