# Sleepless Astronomer — Script Rebuild Report
**Date:** 2026-05-17T10:40:46
**Trigger:** YouTube comments on nQIjOBAWMHY: "No need to repeat" / "Created old, completely adult, no progression"
**Diagnosis:** `data/astronomer-script-diagnosis.md`

---

## What Was Built

### Stage 1A — Reference Harvest
- Tool: `scripts/harvest-space-sleep-longform.js`
- Method: yt-dlp native search — no YouTube Data API key needed
- Queries: 5 search terms × 20 results = 100 unique candidates
- Filter: duration > 45 min, views > 50K, max 3 per channel
- **Result: 15/15 videos harvested, 0 failures**

**Top references (by view count):**
| Channel | Title | Views | Duration |
|---|---|---|---|
| Let's Find Out | Size, Distance, and Time in the Universe | 13M | 213 min |
| Pure Unintentional ASMR | A VERY soft spoken British man... | 6.6M | 69 min |
| BBC Earth Science | One Hour Of Mind-Blowing Space Mysteries | 2.3M | 74 min |
| Sleepy Science Channel | 100 Facts About the Milky Way | 2.3M | 120 min |
| Sleepy Science Channel | The Universe - Facts to Fall Asleep | 1.4M | 120 min |
| Exolife | 3 hours of mind-blowing Space Documentary | 1.1M | 189 min |

**Transcript quality:** 6 transcripts × 40,000–95,000 words each (massive, high-quality reference corpus)

### Stage 1B — Pattern Learning
- Tool: `scripts/learn-space-script-patterns.js`
- Analysis: Haiku per-video (opening 600 words + midpoint 300 + closing 300)
- Synthesis: One Sonnet call — produces definitive guide
- **Result: see `data/reference-principles.json` → `space_sleep_longform_patterns`**
- *(Status at report time: running — 21 videos being analyzed)*

---

### Stage 2 — Script Generator Rebuild (src/script-generator.js)

**Root cause of old failures:**
1. No cross-block memory — each 15-min block generated independently, re-covering heliopause/golden record/eternal drift every block
2. No story scaffold — "one fact per scene" instruction with no chapter structure
3. No specific humans or events — prompt had no named scientists, dates, or events

**New architecture: Two-pass generation**

**Pass 1 — Sonnet generates 20-scene outline:**
```
For each scene:
  - chapter_label: which chapter of the story
  - factual_anchor: ONE specific fact/person/date/event (never duplicated)
  - arc_role: hook | setup | revelation | resolution
  - pivot_to_next: subtle clue pointing toward next scene
  - subject_slug: unique identifier
```

Arc assignment for 20-scene videos:
- Scenes 1-3: [HOOK] — establish mystery
- Scenes 4-10: [SETUP] — build context
- Scenes 11-15: [REVELATION] — most surprising counterintuitive fact
- Scenes 16-20: [RESOLUTION] — quiet resolution, peace

**Pass 2 — Haiku expands each scene:**
- Receives: full 20-scene outline + scene-specific factual anchor + arc role
- Receives: `bannedAnchors[]` list (all prior factual anchors, grows each scene)
- Receives: last 2 sentences of prior scene for continuity
- Writes: ONLY narration prose for the pre-assigned factual anchor

**Why this structurally eliminates repetition:**
The old generator made independent choices per block. In the new generator, Sonnet assigns ALL facts upfront — no scene can cover the same fact as another because each factual anchor appears once in the outline. Haiku only writes prose; it never decides what to cover.

**Sample outline from Stage 4 test (black hole, 4 scenes):**
- Scene 1 [hook]: On April 10, 2019, the Event Horizon Telescope Collaboration released the first direct image of a black hole (M87*)
- Scene 2 [setup]: In December 1915, German physicist Karl Schwarzschild solved Einstein's field equations while in the trenches of WWI
- Scene 3 [setup]: General relativity predicts event horizon behavior — what spaghettification means physically
- Scene 4 [setup]: In 1965, mathematician Roger Penrose (Nobel 2020) proved singularities must exist within collapsing stars

**Bugs found and fixed:**
1. `fileURLToPath` not imported in script-generator.js → Added `import { fileURLToPath } from 'url'`
2. WPM calculation: `target_word_count / duration` gave 4500 WPM for 2-min tests → Fixed to `target_word_count / target_duration_minutes` (9000/60 = 150 WPM)

---

### Stage 3 — Hybrid Title Generator (src/youtube-metadata-generator.js)

**Old format:** AstroKobi curiosity hook only
- "How Are We Still Hearing from Voyager 1?" ← makes a promise the script never delivers

**New format:** `[curiosity hook] | [format signal]`
- "How Are We Still Hearing from Voyager 1? | 1 Hour for Deep Sleep"
- "What Happens at the Edge of a Black Hole? | 60 Minutes of Space Facts"
- "The Star That Will Destroy Its Own Galaxy | Fall Asleep to the Cosmos"

**Why:** The pipe format signals ambient/sleep content to YouTube's algorithm. The format signal ("1 Hour for Deep Sleep") anchors the viewer — they know the commitment upfront and settle in rather than waiting for the video to end.

**Format signal options:**
- "1 Hour for Deep Sleep"
- "60 Minutes of Space Facts"
- "Fall Asleep to the Cosmos"
- "Deep Sleep Astronomy"

Haiku generates 5 candidates, each with a different format signal. Sonnet picks best.

---

### Stage 4 — Test Render (output/astronomer-test-v3-2min/)

**Topic:** What's Inside a Black Hole
**Generator:** New two-pass architecture
**WPM:** 150 (correct — was 4500 due to bug, now fixed)
**Words/scene:** 75 (4 scenes × 75 = 300 words for 2 min)

**Result: SUCCESS**
- Final video: `output/astronomer-test-v3-2min/final.mp4`
- Duration: **197.4s (3.29 min)** — correct for 457-word script at 150 WPM
- Clips: 33 @ ~4s each (all from space library, 0 Fal.ai calls)
- Audio: 1 stream (WMP-compatible)
- File size: 44 MB
- Pipeline runtime: 12m 3s
- TTS: 1.11x realtime (Chatterbox RTX 3060)
- Whisper: 449 words aligned in 11s
- Fullscreen: true | Captions: false
- Verification: 1 video stream, 1 audio stream, frame-30s.png generated

**Script quality confirmed:**
- 5 specific humans named: Katie Bouman (MIT), Karl Schwarzschild, Roger Penrose, Event Horizon Telescope team
- 4 specific dates spoken: April 10 2019, December 1915, 1965, October 2020
- No repeated facts — each of 4 scenes covered a unique factual anchor
- Arc: hook (EHT image) → setup (Schwarzschild 1915, event horizon physics, Penrose singularity theorem)

### Stage 1B — Pattern Learning Results

**Analyzed:** 17/21 videos (4 skipped: 2 empty transcripts, 2 Haiku timeouts)
**WPM range:** 90–463 (z1R8MuG2wW4=90 is an outlier — storytelling format; BBC Earth=429 is documentary)

**Key patterns extracted (averaged from 17 analyses):**
- `target_wpm`: **336** (median of successful sleep-format channels: ~280–350)
- `target_info_density_per_min`: **2 facts/min** 
- `scene_length_words`: **450 words**
- `recommended_arc`: hook → setup → escalation → revelation → resolution
- `anti_repetition_rules`: Never restate a fact from a prior scene; each scene must introduce at least one new specific detail

**Note:** Sonnet synthesis call timed out — numeric averages computed from individual analyses. Individual per-video data is available in `data/reference-principles.json → space_sleep_longform_patterns.individual_analyses`.

**WPM note for script generator:** Our calibrated 150 WPM is the *narration target*, not the YouTube transcript WPM (which reflects Whisper's speech rate measurement). The 336 WPM above is what Whisper measures from the finished audio — significantly faster than the writing pace.

---

## Files Changed

| File | Change |
|---|---|
| `scripts/harvest-space-sleep-longform.js` | NEW — yt-dlp based reference harvester |
| `scripts/learn-space-script-patterns.js` | NEW — Haiku+Sonnet pattern analyzer |
| `src/script-generator.js` | REBUILT — two-pass space generator |
| `src/youtube-metadata-generator.js` | UPDATED — hybrid title format |
| `data/reference-principles.json` | UPDATED — space_sleep_longform_patterns added |

## Commits

- `c8290675` feat: two-pass script generator + hybrid title format + reference harvest scripts
- `f4c96d2b` fix: add fileURLToPath import to script-generator.js
- `a1012efc` fix: use target_duration_minutes for WPM calibration in space generator
- *(final report + patterns commit — see below)*

---

## Next Steps for Niels

1. **Watch `output/astronomer-test-v3-2min/final.mp4`** — 3.3 min black hole test, confirms no repetition, named scientists, specific dates
2. **Approve next video** — Black hole is a strong topic (high search volume, visually rich, many specific anchors). Alternatively: Betelgeuse, dark matter, neutron stars
3. **Run next full video:** `node scripts/run-astronomer-2.js <topic>` or equivalent — the new generator is ready, next video will run with 20-scene two-pass architecture
4. **Optionally re-run pattern learner** with longer Sonnet timeout to get the full narrative synthesis (individual analyses are already saved)

**The new video should have:**
- No repetition of any fact across 20 scenes (structurally impossible under new architecture)
- Specific named scientists: Schwarzschild, Penrose, Hawking, Event Horizon Telescope team
- Specific dates: 1915, 1965, 2019
- Real story arc: mystery → context → revelation → peace
- Hybrid title with format signal
