# Astronomer Analyzer Test Report — 2026-05-17

## What Was Built

Three components shipped in this session:

1. **`src/script-analyzer.js`** — Core library. Scores any script 0-10 across 10 rubric categories using Sonnet. Rewrites failing sections and loops until score ≥ 8.0 or 5 iterations.
2. **`scripts/analyze-script.js`** — CLI wrapper. Run on any `.txt` or `.json` script file: `node scripts/analyze-script.js --file <path> --channel sleepless-astronomer [--rewrite]`
3. **`scripts/test-astronomer-analyzed.js`** — Full pipeline driver for this test render.

---

## Task 1: Intro Audio Confirmed

`assets/intros/sleepless-astronomer/intro-final.mp4` verified by ffprobe:
- Video: H.264, 1920×1080, 30fps, 4.766s
- Audio: AAC stereo, 44100 Hz, 4.757s — **audio stream present and correct**
- File: ~1 MB
- No re-mux required.

---

## Task 2: Script Analyzer

10 scoring categories with Sonnet-powered analysis:

| Category | What It Penalizes |
|---|---|
| INFORMATION_DENSITY | Filler, repetition, vague statements — needs 2+ real facts/min |
| SPECIFICITY | Missing names, dates, numbers, specific objects |
| REPETITION | -2 per repeated fact or concept across scenes |
| PROGRESSION | hook → setup → escalation → revelation → resolution |
| SUSPENSE | Scenes that end with closed statements instead of open tension |
| MYSTERY_TONE | Condescension, excitement cues, diminishing wonder |
| SLEEP_PACING | Rushed rhythm, no sentence length variation |
| VISUAL_DESCRIPTION | "see/look/watch/picture this/on your screen" — hard -3 penalty each |
| AI_SLOP | "in conclusion", em-dash pauses, "furthermore", "it's important to note" |
| INTRO_QUALITY | Missing sleep welcome or breathing cue at top |

Channel targets from `data/channels/sleepless-astronomer.json` tell the scorer what threshold each category must hit. Categories below target are flagged with quoted failures and rewrite suggestions.

---

## Task 3: Test Render — Saturn's Hexagon

**Topic:** Saturn's Hexagon: The Storm That Has Outlasted Civilizations

### Script Iteration History

| Iteration | Score | INFORMATION_DENSITY | SPECIFICITY | REPETITION | PROGRESSION | SUSPENSE | MYSTERY_TONE | SLEEP_PACING | VISUAL_DESCRIPTION | AI_SLOP | INTRO_QUALITY |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 (raw Haiku) | **7.7** | 7 | 10 | 6 | 8 | **4** | 8 | 7 | 8 | 9 | 10 |
| 1 (Sonnet rewrite) | **8.7** | 8 | 10 | 7 | 9 | **9** | 9 | 9 | 8 | 8 | 10 |

**Key failure fixed:** SUSPENSE jumped 4 → 9. Raw script ended scenes with closed declarative statements ("Saturn has had this storm for centuries."). Sonnet rewrote scene endings as open questions and unresolved tension ("Why does it stay? No one, not even the instruments orbiting Saturn right now, can say for certain.").

Only 1 iteration was needed to clear the 8.0 threshold.

---

### Final Render

| Property | Value |
|---|---|
| Output | `output/astronomer-test-v4-analyzed/final.mp4` |
| Resolution | 1920×1080 @ 30fps |
| Duration | 6m 44s (404.8s) |
| File size | 87 MB |
| Codec | H.264 High Profile |
| Intro | 4.754s Astronomer intro (hyperspace → ring bloom) prepended |
| Images | Space library v1 (508 pre-generated images) |
| TTS | Chatterbox CUDA on RTX 3060 |

> **Note:** Script ran longer than the 2-minute target (584 words / 57 sentences ≈ 6.7 min narration). The duration target feeds Haiku's prompt but output length varies. For strict duration control, reduce `target_word_count` in the script generation call or trim after TTS.

---

## Next Step

**Niels watches and judges if quality jumped.** Open `output/astronomer-test-v4-analyzed/final.mp4` and check:
- Does the sleep intro land right (breathing cue, calm welcome)?
- Do scenes build tension and leave open questions?
- Does the Astronomer intro (hyperspace → ring bloom) flow into the narration?
- Is pacing genuinely sleep-friendly or still too energetic?

If quality looks good, this analyzer is production-ready for all Astronomer scripts going forward. Add `--rewrite` to the existing `generate-video.js` pipeline after Haiku script gen.

---

## Running the Analyzer on Any Script

```bash
# Score only
node scripts/analyze-script.js --file scripts/my-script.json --channel sleepless-astronomer

# Score + rewrite until ≥ 8.0
node scripts/analyze-script.js --file scripts/my-script.json --channel sleepless-astronomer --rewrite

# On a raw .txt file
node scripts/analyze-script.js --file data/draft.txt --rewrite --topic my-topic-slug
```

Iterations saved to: `data/script-iterations/<slug>/`
Final winning JSON: `<original>-analyzed.json`
