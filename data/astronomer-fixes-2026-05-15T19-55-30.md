# Sleepless Astronomer — 5 Fixes Report
**Generated:** 2026-05-15T19:55:30  
**Status:** ✅ All 5 fixes applied and verified in test render

---

## Test Render Result

**Video:** `output/astronomer-test-v2-2min/final.mp4`  
**Topic:** What's Inside a Black Hole: An Hour of Deep Space Wonder  
**Duration:** 172.5s (2.87 min) — includes 60s sleep intro  
**Clips:** 28 @ ~4s each — all 28 from space library (100% hit rate)  
**File size:** 38 MB | Pipeline: 7m 40s | Streams: 1 video, 1 audio ✓

---

## Fix 1 — Fullscreen (no frame, no bg)

**Files changed:** `src/ffmpeg.js`, `data/channels/sleepless-astronomer.json`

Added `fullscreen: true` param to `composeFinalVideoWithBg()`. When active:
- Slideshow scaled to full `1920×1080` (cover-crop) instead of `1728×972` + black-pad
- Background image skipped entirely
- Gold frame skipped entirely
- Particles still screen-blended at full 1920×1080 ✓

Channel config: `"frame_style": "fullscreen"` (astronomer) / `"frame_style": "framed"` (philosophers — no behavior change)

**Confirmed in render:** `Fullscreen: true | Frame: none (fullscreen mode) | Fullscreen mode — no background image`

---

## Fix 2 — Subtitle/caption bug

**Files changed:** `src/subtitles.js`, `data/channels/sleepless-astronomer.json`

Added `filterWhisperSoundEffects(wordTimestamps)` export to `subtitles.js`. Strips:
- Bracketed tokens: `[music]`, `[laughs]`, `[applause]`, etc.
- Parenthesized tokens: `(music)`, `(laughs)`, etc.
- Standalone sound words: music, laughs, laughter, applause, silence, pause, clapping, cheering, etc.

Channel config: `"show_captions": false` — astronomer gets no captions at all. Philosophers unchanged.

**Confirmed in render:** `Filtered 1 sound-effect tokens` / `Captions disabled (show_captions: false) — skipping`

---

## Fix 3 — Audio-only descriptive script

**File changed:** `src/script-generator.js`

Added `EYES-CLOSED LISTENER — CRITICAL` block to `SPACE_VOICE_RULES` with:
- Explicit ban on visual references: "see", "look", "watch", "this image shows", "as shown", "on your screen", etc.
- 4 BAD/GOOD example pairs showing the required transformation

**Example from generated script (good descriptive style, no visual refs):**

> *"Far beyond any star, in deep space where the Sun is only a memory, something waits. Invisible. Ancient. A black hole, born when a massive star collapsed billions of years ago. You'd approach slowly. Space would soften. Time would slow. Your instruments would whisper: gravity is increasing. The darkness ahead isn't empty — it's the absence of light."*

> *"At the center, mathematics and mystery meet. All the matter ever fallen through the event horizon — stars, dust, light itself — compressed to a point so small it has no size. This singularity exists beyond our ability to observe or understand. No signal escapes it. No thought can reach it."*

---

## Fix 4 — Sleep intro template

**Files changed:** `src/intro-templates.js` (new), `src/script-generator.js`, `data/channels/sleepless-astronomer.json`

Created `src/intro-templates.js` with 3 rotating templates (~150-175 words each, ~60s at 150 wpm). `generateSpaceScript()` prepends the intro as scene 0 when `channelConfig.intro_template === 'sleep_audiobook'`.

Channel config: `"intro_template": "sleep_audiobook"`

**Intro from this render (template variant 3):**

> *"Welcome.*
>
> *Sleepless Astronomer is built for people who find sleep difficult — and who find the universe easier to think about than whatever kept them awake.*
>
> *Before we begin: get comfortable. If you're in bed, pull the covers a little closer. If you're somewhere else, let yourself settle into it. Close your eyes. The screen doesn't matter. Everything that matters tonight comes through sound.*
>
> *We're going to move slowly through What's Inside a Black Hole. You'll hear careful descriptions — the kind you'd want told to you in the dark, with long pauses between thoughts. There are no images you need to look at. Just language, and silence between sentences, and the gradual weight of something very old and very vast settling gently around you.*
>
> *Take a breath. Let your body grow a little heavier.*
>
> *And when you're ready, we'll begin."*

---

## Fix 5 — Test render

**Script:** `scripts/what-s-inside-a-black-hole-an-hour-of-deep-space-wonder.json` — 4 scenes (intro + 3 content)  
**Output:** `output/astronomer-test-v2-2min/final.mp4`  
**Verify frames:** `output/astronomer-test-v2-2min/frame-30s.png` + `verify-image-scene.png`

All 4 fixes active in this render. Philosophers channel untouched.

---

## Files Changed

| File | Change |
|------|--------|
| `src/ffmpeg.js` | `fullscreen` param — space images fill 1920×1080, no bg/frame |
| `src/subtitles.js` | `filterWhisperSoundEffects()` export |
| `src/script-generator.js` | Eyes-closed constraint + examples in `SPACE_VOICE_RULES`; intro prepend |
| `src/intro-templates.js` | New — 3 rotating sleep welcome templates |
| `data/channels/sleepless-astronomer.json` | `frame_style`, `show_captions`, `intro_template` |
| `data/channels/sleepless-philosophers.json` | `frame_style: "framed"` (no behavior change) |
| `scripts/test-astronomer-2min.js` | Black hole topic, v2 output dir, all 4 fixes wired |

---

## What Niels Needs To Do

1. **Watch:** `output/astronomer-test-v2-2min/final.mp4`
   - Verify space images fill the full frame (no black bars, no gold border)
   - Verify no caption text on screen
   - Listen to intro — does it feel right for the channel?
   - Listen to content scenes — does it sound like an audiobook (no "look at this" phrases)?

2. **If approved:** Queue first real 60-minute Astronomer video. The pipeline is fully ready.

3. **Pending from earlier:** Re-upload Seneca (failed DNS error May 11). Render exists — only upload step needed.
