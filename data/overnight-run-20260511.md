# SleepForge — Overnight Run Report
**Date:** 2026-05-11 → 2026-05-12
**Started:** ~20:28 Bangkok time
**Status:** IN PROGRESS
**Last updated:** 2026-05-12T11:22 UTC

---

## Task A — Script Length Fix ✓ DONE

**Problem:** 1-hour pipeline was producing ~45-min videos.
**Root cause:** `WORDS_PER_MINUTE = 110` but actual Kokoro TTS runs at ~150 WPM.
**Fix:** `src/script-generator.js` line 24: `WORDS_PER_MINUTE` changed from `110` → `150`

Proof (confirmed live output from Plato render):
- 150 WPM × 60 min = **9,000 words target** ✓
- **Actual output: 9,040 words, 96 scenes, ~60.3 min** ✓ (was ~45 min before fix)
- Per-scene instruction updated: "55-80 words" → **"75-110 words"**

Additional changes:
- Scene hint: `~${Math.round(WORDS_PER_MINUTE * 37 / 60)} words (37 seconds)` (was wrong "3 minutes" comment)
- `generateScript()` now accepts `channelConfig.target_word_count` override for future channels

---

## Task B — 3 New Philosophy Videos

**Script:** `scripts/run-autopilot-6.js`
**Status:** RUNNING (started ~20:28 Bangkok)

| # | Philosopher | Tradition | Scheduled | Status |
|---|------------|-----------|-----------|--------|
| 6 | Plato | Platonic/Idealist | Mon May 18 8am Bangkok | RENDERING |
| 7 | Epictetus | Stoicism (Roman) | Tue May 19 8am Bangkok | QUEUED |
| 8 | Seneca | Stoicism (Roman) | Wed May 20 8am Bangkok | QUEUED |

### Video 6 — Plato (May 18) ✓ UPLOADED
- Script: 9,040 words, 96 scenes, ~60.3 min ✓
- TTS: ✓ 1283/1283 sentences, 1.19x realtime, 4034s audio
- Whisper: ✓ 9,173 words in 124s
- Director: ✓ 679 clips, 100% library (Plato/Socrates/Aristotle), 26 unique images
- Subtitles: ✓ 2,275 ASS karaoke phrases
- FFmpeg: ✓ final.mp4 — 4036.4s (67.27 min), 628 MB, pipeline 155m 54s total
- Title: "All of Plato's Philosophy Explained | Sleep Meditation" ⚠ draft (Haiku CLI timed out)
- Thumbnails: v1 **8/10** (selected) "SEE NOTHING" Piranesi cave | v2 7/10 red-figure pottery | v3 8/10 classical cave
- **URL: https://www.youtube.com/watch?v=mc2s9AZq2ys**
- Scheduled: Mon May 18 08:00 Bangkok ✓

### Video 7 — Epictetus (May 19) ✓ UPLOADED
- Script: ✓ 9,255 words, 96 scenes, ~61.7 min ⚠ lint: "Enchiridion" (benign book title) ✓
- TTS: ✓ 1477/1477 sentences, 1.28x realtime, 4013.1s audio
- Whisper: ✓ 9,394 words in 140s
- Director: ✓ 679 clips, 100% library (Marcus Aurelius/Epictetus), 32 unique images
- Subtitles: ✓ 2,256 ASS karaoke phrases
- FFmpeg: ✓ final.mp4 — 4015.1s (66.92 min), 607 MB, pipeline 160m 14s total
- Title: "The Most Calming Teachings of Epictetus for Deep Sleep" ✓ (55 chars, Sonnet pick)
- Thumbnails: v1 **7/10** (selected) "MIND STAYS FREE" marble bust→cosmos | v2 ⚠ timeout | v3 ⚠ timeout
- **URL: https://www.youtube.com/watch?v=TjTuo6lL_48**
- Scheduled: Tue May 19 08:00 Bangkok ✓

### Video 8 — Seneca (May 20) — IN PROGRESS
- Draft title: "1 Hour of Seneca: Letters on Time and Mortality for Sleep"
- Script: ✓ DONE — 8,631 words, 96 scenes, ~57.5 min ⚠ lint: 5 flags (Epicurus/Menoeceus, benign)
- TTS: ✓ 1257/1257 sentences, 1.22x realtime, 3665.0s audio
- Whisper: ✓ 8,619 words in 112s
- Director: ✓ 612 clips, 100% library (Seneca/Epicurus), 70 unique images
- Subtitles: ✓ 2,055 ASS karaoke phrases
- Frame variant 3/10: philosophy-frame-03.png
- FFmpeg: RUNNING — 612 images over 3665s, 31 chunks (started ~14:35 UTC, est. done ~15:35 UTC)
- Upload: QUEUED (est. ~16:00 UTC)
- URL: *(pending upload)*

---

## Task C — Space Channel Harvest

**Channels:** @MilkyStellarSpace, @AstroKobi
**Niche tag:** `space_documentary`
**Output:** `Desktop\References\by-niche\space_documentary\`

| Channel | Videos Found | Status |
|---------|-------------|--------|
| @MilkyStellarSpace | 27 | ✓ DONE |
| @AstroKobi | 841 | ✓ DONE |

**npm run learn:** ✓ COMPLETE — 868 new references, 1,218 total in principles.json

Top 3 space_documentary patterns learned:
1. **Existential pronoun stacking** ('You/We/Our' + cosmic threat) — highest CTR across all view tiers
2. **Authority + mystery pairing** (NASA/JWST + 'Just Found/May Have Discovered') — dominant in viral-tier hooks
3. **Emotional superlative front-loading** ('Scariest,' 'Most Terrifying') — fear/awe = top 2 emotional triggers in niche
High-CTR keywords: Scariest, Just Found, Universe, You'll Never, Terrifying, NASA, Black Hole, Missing, Life, JWST

---

## Task D — Sleepless Astronomer Architecture ✓ DONE

All files committed and pushed.

### New Files
| File | Purpose |
|------|---------|
| `data/channels/sleepless-philosophers.json` | Philosophers channel config |
| `data/channels/sleepless-astronomer.json` | Astronomer config (image_library_status: pending) |
| `data/topic-pools/sleepless-astronomer.json` | 30 AstroKobi-style documentary topics |

### Channel-Aware Module Changes
| Module | Change |
|--------|--------|
| `src/script-generator.js` | `channelConfig` param: target_word_count → effectiveWPM, banned_topics in prompt, niche label override |
| `src/youtube-metadata-generator.js` | `channelConfig` param: niche, audience, display_name, banned_topics in prompt |
| `src/thumbnail-v3.js` | `channelConfig` param: niche/tone fallback defaults from config |

### data/channels/sleepless-astronomer.json summary
```json
{
  "niche": "space_documentary",
  "tone": "calm cinematic documentary, AstroKobi-inspired but sleep-friendly",
  "banned_topics": ["speculative aliens", "UFO", "conspiracy", ...],
  "target_word_count": 9000,
  "image_library_status": "pending"
}
```

### data/topic-pools/sleepless-astronomer.json — 30 Topics
Covers: missions/probes (Voyager, Apollo, Cassini, New Horizons, Mars), stellar phenomena (black holes, neutron stars, UY Scuti, supernovae, Betelgeuse), scale of universe (Pale Blue Dot, cosmic web, observable universe, Oort Cloud), exoplanets (Europa, Titan, JWST discoveries), telescopes (Hubble deep field, LIGO, JWST), cosmology (Big Bang, heat death, Andromeda collision, dark matter), time/space concepts (speed of light, time dilation).

---

## Issues / Notes

- Rate limit: Claude CLI hit the daily rate limit yesterday evening (8:50pm Bangkok). All overnight Claude calls should work since the limit resets after 8:50pm.
- Remaining content sets (Wu Wei, Marcus Aurelius, Aristotle, Schopenhauer): still need thumbnail regeneration via `node scripts/rethumb-content-sets.js`. Not part of tonight's tasks.
- DO NOT generate Astronomer videos until image library is built (500 space images in chalk/cinematic style).

---

*Report last updated: 2026-05-12T14:37 UTC*
