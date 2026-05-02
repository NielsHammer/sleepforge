#!/usr/bin/env python3
"""Insert silence at sentence/clause boundaries using Whisper word timestamps.

Usage: audio-pauses.py <input.wav> <whisper.json> <output.wav>
                      [--period-ms N] [--comma-ms N] [--paragraph-ms N]

Period/!/? → sentence pause (default 350ms)
Comma/; → clause pause (default 120ms)
Inter-word gap >= 0.5s in original → likely paragraph break, extend to paragraph-ms (default 700ms)
"""
import sys
import json
import argparse
import soundfile as sf
import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input_wav")
    ap.add_argument("whisper_json")
    ap.add_argument("output_wav")
    ap.add_argument("--period-ms", type=int, default=350)
    ap.add_argument("--comma-ms", type=int, default=120)
    ap.add_argument("--paragraph-ms", type=int, default=700)
    args = ap.parse_args()

    audio, sr = sf.read(args.input_wav)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    with open(args.whisper_json) as f:
        words = json.load(f)

    if not words:
        sf.write(args.output_wav, audio, sr)
        print("No words; copied through.", file=sys.stderr)
        return

    period_samples = int(args.period_ms / 1000 * sr)
    comma_samples = int(args.comma_ms / 1000 * sr)
    paragraph_samples = int(args.paragraph_ms / 1000 * sr)

    segments = []
    cursor_sample = 0

    for i, w in enumerate(words):
        end_sample = min(int(w["end"] * sr), len(audio))
        text = (w.get("word") or "").strip()
        # Append audio up to end of this word
        if end_sample > cursor_sample:
            segments.append(audio[cursor_sample:end_sample])
        cursor_sample = end_sample

        # Detect punctuation that ends the word
        last = text[-1] if text else ""

        # Detect paragraph break: large pre-existing gap to next word
        is_paragraph = False
        if i + 1 < len(words):
            gap = words[i + 1]["start"] - w["end"]
            if gap >= 0.5 and last in ".!?":
                is_paragraph = True

        if last in ".!?":
            silence = np.zeros(
                paragraph_samples if is_paragraph else period_samples,
                dtype=audio.dtype,
            )
            segments.append(silence)
        elif last in ",;:":
            segments.append(np.zeros(comma_samples, dtype=audio.dtype))

    # Tail audio after last word (trailing silence in original)
    if cursor_sample < len(audio):
        segments.append(audio[cursor_sample:])

    new_audio = np.concatenate(segments)
    sf.write(args.output_wav, new_audio, sr)

    orig_dur = len(audio) / sr
    new_dur = len(new_audio) / sr
    print(f"orig={orig_dur:.2f}s new={new_dur:.2f}s added={new_dur - orig_dur:.2f}s", file=sys.stderr)


if __name__ == "__main__":
    main()
