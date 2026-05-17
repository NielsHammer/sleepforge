# Sleepless Astronomer — Animated Intro Report
**Date:** 2026-05-17T11:36:51
**Commit:** 9da0fb28

---

## What Was Built

A reusable 2-second animated intro for every Sleepless Astronomer video. Pre-rendered once, prepended to each video via FFmpeg concat.

---

## Task 1 — Logo Fetched

- **Method:** YouTube Data API `channels.list` (part=snippet, mine=true) via existing `authenticate('sleepless-astronomer')` + googleapis
- **Source URL:** `yt3.ggpht.com/dbuz8HKi...=s800-c-k-c0x00ffffff-no-rj` (800px avatar)
- **Output:** `assets/intros/sleepless-astronomer/logo.png` (153 KB)
- **Fallback:** Would use `assets/channel-art/sleepless-astronomer-logo.png` if API fails

---

## Task 2/3 — Animation Design

**File:** `engine/remotion/components/AstronomerIntro.jsx`
**Composition ID:** `AstronomerIntro` (registered in `engine/remotion/index.jsx`)
**Duration:** 60 frames @ 30fps = 2.000s | 1920×1080

### Timeline
| Frames | Seconds | What happens |
|--------|---------|--------------|
| 0–18   | 0–0.6s  | Stars emerge (3 layers, deterministic seeded positions, staggered opacity) |
| 15–30  | 0.5–1.0s | Purple nebula bloom rises from center (radial gradient, 60px blur) |
| 28–46  | 0.93–1.53s | Logo fades in (opacity 0→1) + scales up (0.4→1.0), ease-out cubic |
| 45–60  | 1.5–2.0s | Logo settles; gold ring gets radial bloom (box-shadow 0→22→14px) |
| 0–60   | continuous | Stars drift with 3-layer parallax at different speeds |
| 0–25   | continuous | Vignette fades in (edges darken toward center) |

### Visual elements
- **Background:** `#00000C` deep navy, almost black
- **Stars:** 65 distant (slow, dim), 32 mid (medium), 14 near (faster, bright) — seeded LCG, deterministic per render
- **Nebula:** Purple `rgba(75,35,140)` radial gradient, filtered blur 40px
- **Logo:** 320×320px circular, border-radius 50%, `3px solid rgba(212,168,67, opacity)` gold ring
- **Bloom:** `box-shadow` gold + amber + copper cascade when logo settles
- **Vignette:** Radial gradient transparent→`rgba(0,0,8,0.88)` at edges

---

## Task 4 — Rendered Intro Video

- **Output:** `assets/intros/sleepless-astronomer/intro.mp4`
- **Render time:** 2.8s (Remotion renderMedia, concurrency 4)
- **Codec:** H.264 (Remotion default)
- **Streams:** 1 video, no audio

---

## Task 5 — Boosted Intro Sting

**Base sting** (same 3-tone formula as Philosophy pipeline):
- 60Hz sub-bass swell (0.90 vol, 0.6s fade-in)
- 220Hz atmospheric pad (0.55 vol, 0.4s fade-in)
- 660Hz soft chime at 1.65s (0.32 vol, adelay)

**Boost applied:** `volume=2.5,alimiter=limit=0.95:level=true`
- Output: `assets/intros/sleepless-astronomer/intro-sting.wav`

**Combined:** `assets/intros/sleepless-astronomer/intro-final.mp4`
- 1 video stream (Remotion animation)
- 1 audio stream (boosted sting, AAC 192k)
- Duration: **2.000s exactly**
- File size: 320 KB

---

## Task 6 — Pipeline Wired

### `src/ffmpeg.js` — new export
```javascript
prependIntroVideo(introPath, bodyPath, outputPath)
```
- FFmpeg `concat` filter: `[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`
- Both streams rescaled to 1920×1080 @ 30fps (ensures compat regardless of intro codec)
- Output: H.264 fast crf22 + AAC 192k

### `data/channels/sleepless-astronomer.json`
Two new fields:
```json
"intro_video_path": "assets/intros/sleepless-astronomer/intro-final.mp4",
"intro_duration_seconds": 2
```

### Pipeline flow (new vs old)

**Old:** `generateIntroSting` → `prependIntroSting` → `composeFinalVideoWithBg(introDuration:2)` → final.mp4
- Sting audio: 3 synthesized tones (quiet)
- Video intro: black screen + 1s fade-in (no animation)

**New:** `composeFinalVideoWithBg(introDuration:0)` → `body.mp4` → `prependIntroVideo(intro-final.mp4, body.mp4, final.mp4)` → final.mp4
- Sting audio: boosted 2.5x (louder, same tones)
- Video intro: animated stars + nebula + logo reveal

**Philosophy channel:** unchanged — old sting/introDuration approach still used

---

## Task 7 — Test Render

**Script:** `scripts/test-astronomer-intro.js`
**Topic:** What's Inside a Black Hole
**Duration flag:** 1 min (generates ~8 min actual video — 1 min main script + sleep intro)
**Output:** `output/astronomer-intro-test/final.mp4`

### Results
| Metric | Value |
|--------|-------|
| Duration | 492.0s (8.2 min) = 2s intro + 490s body |
| File size | 105 MB |
| Video streams | 1 |
| Audio streams | 1 (WMP-compatible) |
| Clips | 68 @ ~4s each |
| Images | 68/68 from space library (0 Fal.ai calls) |
| TTS | 1.06x realtime (Chatterbox RTX 3060) |
| Pipeline | 19m 20s |
| Frame at 1.0s | ✓ Logo mid-fade, stars visible, purple nebula glow, vignette |
| Frame at 4.0s | ✓ Body content (space library galaxy image) |
| Audio concat join | Clean — no click audible |

---

## Files Changed

| File | Change |
|------|--------|
| `engine/remotion/components/AstronomerIntro.jsx` | NEW — 60-frame space animation |
| `engine/remotion/index.jsx` | +AstronomerIntro composition (60 frames) |
| `src/ffmpeg.js` | +`prependIntroVideo()` export |
| `data/channels/sleepless-astronomer.json` | +intro_video_path, intro_duration_seconds |
| `scripts/render-astronomer-intro.js` | NEW — logo fetch + render + sting + mux |
| `scripts/test-astronomer-intro.js` | NEW — 1-min pipeline test with intro |
| `assets/intros/sleepless-astronomer/logo.png` | NEW — 153 KB channel avatar |
| `assets/intros/sleepless-astronomer/intro.mp4` | NEW — Remotion render, video only |
| `assets/intros/sleepless-astronomer/intro-sting.wav` | NEW — boosted sting |
| `assets/intros/sleepless-astronomer/intro-final.mp4` | NEW — video + audio, 2.00s |
| `public/astronomer-logo.png` | NEW — copy for Remotion staticFile() |

---

## What Niels Should Do

1. **Watch `output/astronomer-intro-test/final.mp4`** — first 2 seconds is the intro animation
2. **Watch `assets/intros/sleepless-astronomer/intro-final.mp4`** — the reusable 2-sec clip in isolation
3. **Approve for production** — once approved, every new Astronomer video will start with this intro automatically
4. **To regenerate intro with a new frame:** run `node scripts/render-astronomer-intro.js --force` — re-fetches logo, re-renders, re-muxes
5. **To run future videos:** use `test-astronomer-intro.js` as the template, or wire `prependIntroVideo` into any existing pipeline that reads `CHANNEL_CONFIG.intro_video_path`

---

## Notes

- **Gold ring:** visible at 1.2s (the preview frame), subtle glow at 1.8s (settling phase). The ring gets brighter at 1.7s then settles back — not a flash, a bloom.
- **Audio at join:** sting fades out at 1.7s (0.3s fade-out), body starts at 2.000s. No overlap, no click.
- **Logo source:** re-fetched from YouTube API every time `--force` is passed. Cached otherwise.
- **Philosophy channel:** completely untouched. Sleepless Philosophers keeps its own sting+black-pad intro.
