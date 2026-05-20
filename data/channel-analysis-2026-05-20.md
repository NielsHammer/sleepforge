# SleepForge — Channel Analysis
_Generated: 2026-05-20 | Covers: Sleepless Philosophers (Task 1) + Astronomer Hook Fix (Task 2)_
_Channel isolation: Philosophy findings ONLY apply to Sleepless Philosophers. DO NOT use for Astronomer._

---

# PART 1 — SLEEPLESS PHILOSOPHERS PERFORMANCE ANALYSIS

_Full data: `data/philosophers-winners-analysis.md` | Raw: `data/philosophers-channel-analysis-raw.json`_

## Data Coverage
- **Channel:** @SleeplessPhilosophers
- **Total videos:** 343
- **Videos with analytics:** 39 (top 30 by views + bottom 10)
- **Winning pool:** 17 unique videos (top by views AND/OR top by retention)
- **Thumbnails analyzed:** 17 (Sonnet vision via Claude CLI)

## Top Performers

| Rank | Title | Views | Avg View % |
|------|-------|-------|-----------|
| 1 | 2 Hours of Solipsism and the Fear That Nothing Is Real | 993 | **17.9%** |
| 2 | 2 Hours of Philosophy That Will Break Your Beliefs | 522 | 17.6% |
| 3 | 2 Hours of Philosophy That Will Stick in Your Mind | **2,612** | 16.2% |
| 4 | 2 Hours of Philosophy That Will Change Your Life Path | 482 | 16.2% |
| 5 | Philosophy Paradoxes That Prove Time Doesn't Exist | 602 | 15.6% |

## Bottom Performers (What Failed)

| Title | Views | Notes |
|-------|-------|-------|
| 2 Hours of Deep Philosophy Ideas to Sleep/Chill to | 7 | Generic title, no curiosity hook |
| The Most Comforting Philosophy to Fall Asleep to | 6 | Soft framing, no specific claim |
| All Of Stoic Philosophy Explained in 1 Video... | 4 | Format-first framing, no tension |
| The Most Dangerous Philosophy to Fall Asleep to | 4 | Generic superlative |
| The Most Beautiful Philosophy to Fall Asleep to | 3 | Warm tone = no intellectual stakes |

**Key insight:** Bottom performers had 3–7 views total (effectively zero discovery). High retention % on these is statistically meaningless — almost certainly just the creator watching. The real failure was near-zero CTR, caused by titles/thumbnails that signal generic relaxation content rather than ominous philosophical provocation.

## Pattern Analysis

### What Top-Retention Thumbnails Share
1. **Named concept specificity** — Titles anchor to a specific philosophical claim (solipsism, paradoxes, time) rather than a broad category. The specificity creates unresolved intellectual tension the viewer must click to discharge.
2. **Ominous emotional tone** — The hook implies something will be broken, proven wrong, or permanently lodged in the viewer's mind. Never merely explained.
3. **Single isolated chalk figure** — One chalk-drawn classical philosopher bust, centered against deep black/near-black background with heavy negative space. No decorative elements.

### What Top-Views Thumbnails Share
1. **"2 Hours of Philosophy That Will [active verb] Your [mind]" formula** — Positions the content as an agent acting on the viewer, not a passive format being consumed.
2. **Chalk-rendered classical philosopher bust** — Socrates/Aristotle type, white chalk on blackboard-green or near-black. Consistent art direction = brand recognition + intellectual credibility signal.
3. **Bold white text in lower third only** — Two-line clean layout, philosopher figure visually unobstructed. Legible at mobile thumbnail scale.

### Anti-Patterns (What Winners Avoid)
- Leading with sleep/relaxation as primary value proposition ("to Sleep/Chill to" as headline) — collapses the curiosity gap
- Generic superlatives ("Most Comforting", "Most Dangerous") without a specific philosophical claim — curiosity loop never opens
- Warm, reassuring emotional framing — top thumbnails pair philosophy with cognitive disruption; warmth alone reads as ambient background noise

---

## 5 RULES FOR THE PHILOSOPHY THUMBNAIL GENERATOR

> **CHANNEL ISOLATION:** These rules apply ONLY to Sleepless Philosophers. Do NOT apply to Astronomer.

**Rule 1 — Name a specific concept, never a broad category**
Always include a specific philosophical concept, paradox, or claim in the title (solipsism, determinism, Zeno's paradoxes, the problem of other minds). Never use generic descriptors like "deep philosophy ideas" or "philosophy concepts." The named specificity is the curiosity mechanism that drives the click.

**Rule 2 — Frame philosophy as an active force on the viewer's mind**
Use constructions like "Will Break / Mess With / Stick In / Prove / Destroy / Change." Never lead with "Most [Adjective]" superlatives — they are interchangeable across niches and carry zero intellectual specificity.

**Rule 3 — One chalk figure, deep background, generous negative space**
Use exactly one chalk-drawn classical philosopher figure or bust as the sole visual subject, centered or anchored center-left, against a deep black or blackboard-green background (hex range #0a0a0a–#1a2e1a). No multiple figures, no decorative borders, no competing texture elements.

**Rule 4 — Lock the palette to ominous and cold**
Deep blacks, cool dark greys, white chalk highlights only. Never warm tones, amber, gold, or anything that reads as comforting or inviting. The thumbnail should evoke staring into a quiet, slightly unsettling void.

**Rule 5 — Sleep qualifier goes to end of title only, never in thumbnail**
If the sleep qualifier must appear, relegate it strictly to the end of the title as a trailing suffix ("…to Fall Asleep To") and never render it in the thumbnail text itself. The thumbnail copy shows only the philosophical concept and its cognitive effect on the viewer.

---

# PART 2 — ASTRONOMER HOOK QUALITY FIX

_Full diff in `src/thumbnail-v3.js` | Re-thumbnail script: `scripts/voyager-rethumb-v2.js`_

> **CHANNEL ISOLATION:** This section applies ONLY to Sleepless Astronomer. Philosophy rules do NOT cross-apply here.

## What Was Fixed in `src/thumbnail-v3.js`

### New Structural Hook Validator (`validateAstrokobiHookText`)
The existing validator only checked format (2-4 words, UPPERCASE). The rewrite adds three content tests:

**Banned pattern detection:**
- Bare past-tense verbs: ENDED, STOPPED, DIED, FELL, BURNED, CRASHED, FAILED, COLLAPSED, FROZE, BROKE
- SPACE_NOUN + OBSERVATION_VERB pairs: LIGHT LOSES, TIME ENDS, STARS DIE, SIGNAL STOPS, SPACE BREAKS, etc.
- ADJ_NOUN banned pairs: DEAD STAR, DARK SKY, COLD VOID, FOREVER GONE, LOST SIGNAL, etc.

**Why:** These patterns describe past facts rather than opening a curiosity gap. "STARS DIE" is a closed statement; "STILL ALIVE" is a mystery. The validator enforces the hook must imply something ongoing or surprising.

### New LLM Hook Judge (`judgeAstrokobiHook`)
After the structural validator passes, a Sonnet call applies three scored tests (1-10 each, pass threshold 7/10 total):

1. **Story test** — Does the hook imply a story unfolding or a surprising discovery? (not just a fact)
2. **Curiosity gap test** — Does the hook withhold why/how something is possible? (creates a click-to-resolve tension)
3. **Subject connection test** — Is the hook specifically connectable to the video's concrete space topic? (not generic)

If the winner fails, the judge tries runner-up candidates. After 3 failed attempts the thumbnail proceeds with `_llm_judge_failed: true` flagged.

### Approved Hook Pattern Examples
- STILL TALKING ✓ (implies ongoing transmission against odds)
- 47 YEARS GONE ✓ (time-shock with specific number)
- STILL SIGNALS ✓ (ongoing mystery: how is it reaching us?)
- LIGHT ESCAPES ✗ (banned: SPACE_NOUN + OBS_VERB)
- DEAD STAR ✗ (banned: ADJ_NOUN pair — closed statement)

## Voyager 1 Re-Thumbnail

**Video:** https://www.youtube.com/watch?v=nQIjOBAWMHY — "How Are We Still Hearing from Voyager 1?"

**Problem:** Previous thumbnail used a black hole image with "IT ANSWERED" hook — completely off-topic for a Voyager video.

**Hooks tested:**
- V1: "STILL TALKING" — 6/10 critic, passed ✓ (space library images, no spacecraft — library limitation)
- V2: "47 YEARS GONE" — failed (requested Voyager spacecraft image not available in space library; broken image on retry)
- V3: "STILL SIGNALS" — generated fresh _(see upload result in `data/voyager-rethumb-*.json`)_

**Upload:** Winner uploaded to nQIjOBAWMHY via `uploadThumbnail` — see `data/voyager-rethumb-*.json` for final hook and file path.

**Known limitation:** The 500-image space library contains deep space photos but no actual spacecraft photographs. The AstroKobi planner requests "Voyager 1 spacecraft" images that can't be matched from the library. Both V1 and V3 fall back to generic deep space imagery. Critic consistently marks this down ("no spacecraft visible"). Fixing this properly requires either: (a) adding actual spacecraft images to the library, or (b) teaching the planner to request only what's available.

---

# SUMMARY

| Item | Status | Output |
|------|--------|--------|
| Philosophers analytics (39 videos) | ✅ Done | `data/philosophers-channel-analysis-raw.json` |
| Philosophers thumbnail vision analysis (17 videos) | ✅ Done | `data/analysis/philosophers-winners/*.json` |
| Philosophers synthesis + 5 rules | ✅ Done | `data/philosophers-winners-analysis.md` |
| AstroKobi hook validator rewrite | ✅ Done | `src/thumbnail-v3.js` (validateAstrokobiHookText + judgeAstrokobiHook) |
| Voyager re-thumbnail (3 hooks) | ✅ V1+V3 done | `output/voyager-1-*/thumbnails/rethumb-v1-*/thumbnail.png` |
| Voyager thumbnail uploaded to YouTube | ✅ Done | https://www.youtube.com/watch?v=nQIjOBAWMHY |
| Black hole video uploaded (G9owxn3amwc) | ✅ Done | https://www.youtube.com/watch?v=G9owxn3amwc |
