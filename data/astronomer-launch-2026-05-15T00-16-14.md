# Sleepless Astronomer — Launch Readiness Report
**Generated:** 2026-05-15T00:16:14  
**Status:** ✅ READY TO LAUNCH

---

## What Was Built

The full Sleepless Astronomer image pipeline and script generator, enabling autopilot operation identical to Sleepless Philosophers.

---

## Tasks Completed

### Task 1 — Space Prompts (data/space-prompts.json)
- **507 prompts** generated via Claude Sonnet (claude-sonnet-4-6)
- All 507 are Sonnet-crafted — zero fallbacks remain
- Each prompt: style anchor + 40-60 words of specific visual description + 5-8 tags
- Resumed twice due to rate limit; all gaps filled cleanly
- Cost: ~$0.12

### Task 2 — Space Image Library (assets/images/space-library-v1/)
- **507 images** generated via Flux Schnell
- Zero failures in final run (507/507)
- Generated in 19.5 minutes at ~$0.003/image
- Cost: ~$1.52
- Index: `assets/images/space-library-v1/index.json` — 507 entries
- Each entry: `philosopher = primary_subject` so existing library scoring (+5 match) works unchanged

### Task 3 — Pipeline Wiring (src/)
| File | Change |
|------|--------|
| `src/library.js` | `let _cache = null` → `const _cacheByPath = new Map()` — philosopher + space libraries coexist in one process |
| `src/director.js` | `loadLibrary()` → `loadLibrary(brief.libraryPath \|\| null)` — channel-specific library per render |
| `src/script-generator.js` | Added `generateSpaceScript()` + `buildSpaceDocumentaryPrompt()` — routes when `niche === 'space_documentary'`, maps `scene.subject → scene.philosopher` for director compatibility |

### Task 4 — Channel Config Updated
`data/channels/sleepless-astronomer.json`
- `image_library_status`: `"pending"` → `"ready"`
- `image_library_path`: `"assets/image-library-astronomer"` → `"assets/images/space-library-v1/"`

### Task 5 — 2-Minute Test Render ✅
**Topic:** Voyager 1: The Farthest Human-Made Object and What It Tells Us  
**Output:** `output/astronomer-voyager-2min/final.mp4`

| Metric | Result |
|--------|--------|
| Duration | 123.4s (2.06 min) |
| Scenes | 3 (space_documentary niche via Haiku) |
| Words | 286 (~1.9 min narration) |
| TTS sentences | 41 via Chatterbox CUDA |
| Clips | 21 @ ~4s each |
| Library hits | 21/21 (100% — zero fallbacks) |
| Image scores | 1.0–2.9 (keyword + subject matching) |
| Unique images used | 21 of 507 |
| Audio streams | 1 (WMP-compatible ✓) |
| File size | 26 MB |
| Pipeline time | 5m 56s |
| Background | astronomer-bg-1080.jpg (generated, cached) |
| Subtitles | ASS karaoke, 66 phrases from 288 words |

**Verification frames:**
- `output/astronomer-voyager-2min/frame-30s.png`
- `output/astronomer-voyager-2min/verify-image-scene.png`

---

## New Files

```
scripts/generate-space-prompts.js   — generates data/space-prompts.json (Sonnet)
scripts/generate-space-images.js    — generates space-library-v1/ (Fal.ai, resumable)
scripts/test-astronomer-2min.js     — 2-min test render, no upload
data/space-prompts.json             — 507 Flux Schnell prompts with tags
assets/images/space-library-v1/    — 507 cinematic space images + index.json
assets/backgrounds/astronomer-bg-1080.jpg — channel background (generated once)
```

---

## Cost Summary

| Item | Cost |
|------|------|
| Claude Sonnet — 507 prompts | ~$0.12 |
| Fal.ai Flux Schnell — 507 images | ~$1.52 |
| Fal.ai — astronomer background | ~$0.003 |
| Claude Haiku — test script (2 min) | ~$0.01 |
| **Total** | **~$1.65** |

---

## What Niels Needs To Do

1. **Watch the test render:** `output/astronomer-voyager-2min/final.mp4`
   - Check: do space images look right for sleep content?
   - Check: does the narration feel calm and documentary-like (not lecture-y)?
   - Check: library matching — are the images vaguely thematically appropriate?

2. **If test render looks good:** Queue first real astronomer video via Jarvis or manually:
   ```
   node jarvis/server.js   # if not already running
   ```
   Then add a job from the topic pool (`data/topic-pools/sleepless-astronomer.json`).

3. **Philosophy gap:** Seneca upload failed (DNS error May 11). Re-upload:
   ```
   # Check if render still exists
   ls output/seneca*/final.mp4
   # Re-run upload step only
   ```
   Also queue 3+ new philosophy videos — gap opens after May 20.

---

## Notes

- The space script generator (`generateSpaceScript`) produces scenes with `subject` slugs (e.g. `voyager-1-probe`, `black-hole`, `saturn-rings`) instead of philosopher names. These are mapped to `scene.philosopher` so all downstream code works unchanged.
- Library image matching for space uses the same scoring as philosophers: `subject` exact match = +5, keyword overlap = +1 each. With 507 diverse images, all 21 clips in the test got unique images with scores > 0.
- The gold frame (`philosophy-frame-01.png`) is reused for astronomer — the frame is channel-agnostic. If a space-specific frame is wanted later, generate one and set `FRAME_VARIANT` env var.
- Background (`astronomer-bg-1080.jpg`) is now cached — never regenerated per video per CLAUDE.md rule 9.
