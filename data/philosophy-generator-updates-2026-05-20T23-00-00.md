# Philosophy Generator Updates — 2026-05-20T23:00:00

## Summary

Applied 5 philosophy thumbnail/title rules (from 343-video Sleepless Philosophers performance analysis)
to the philosophy generator. These rules apply ONLY to `niche === 'philosophy'`. Astronomer pipeline untouched.

## Changes Made

### 1. `src/youtube-metadata-generator.js` — `buildPrompt()`

**What changed:** Added `isPhilosophy` gate. When `niche === 'philosophy'`, the TITLE rules block is
replaced with philosophy-specific rules drawn from channel performance data.

**Rules injected (philosophy branch):**
- Rule 1: Name a SPECIFIC concept (solipsism, Zeno's paradoxes, determinism) — never generic category
- Rule 2: Active force on viewer's mind ("Will Break / Mess With / Stick In") — never "Most [Adj]" superlatives
- Rule 5: Sleep qualifier in title suffix only ("…to Fall Asleep To") — never as headline value

**Winning title patterns added to prompt:**
- "2 Hours of Philosophy That Will Break Your Beliefs"
- "Philosophy Paradoxes That Prove Time Doesn't Exist"
- "2 Hours of Solipsism and the Fear That Nothing Is Real"

**Losing title patterns added (anti-examples):**
- "2 Hours of Deep Philosophy Ideas to Sleep/Chill to" (generic, sleep-first)
- "The Most Comforting Philosophy to Fall Asleep to" (soft superlative)
- "All Of Stoic Philosophy Explained in 1 Video..." (format-first, no tension)

---

### 2. `src/thumbnail-v3.js` — `buildHookPrompt()`

**What changed:** Added philosophy-specific rule block after the LOSERS section, gated on
`niche === 'philosophy'` using a template literal conditional.

**Rules injected:**
- Rule 1: Name a SPECIFIC concept — hook must distill named philosophical concept/paradox
- Rule 2: Active force on the viewer's mind — happening TO viewer, not describing philosopher
- Anti-patterns: warm/comforting hooks, generic states without concept anchor, sleep-as-hook

**Examples added:**
- ✓ "KNOW NOTHING" — Socratic epistemology, force on viewer
- ✓ "STILL FULL" — Hilbert's paradox distilled
- ✗ "PLATO SAID" — reports fact, zero force
- ✗ "FEEL FREE" — generic, no concept anchor

---

### 3. `src/thumbnail-v3.js` — `buildPlannerPrompt()`

**What changed:** Added `philosophyDesignRules` block injected into the prompt return value when
`niche === 'philosophy'`. Placed before the vision/hook blocks so it contextualizes the design task.

**Rules injected:**
- Rule 3: ONE chalk figure, centered/center-left, deep black (#0a0a0a–#1a2e1a) background, generous negative space
- Rule 4: Ominous cold palette — deep blacks, cool greys, white chalk ONLY. Never warm/amber/gold
- Rule 5: Sleep qualifier never in thumbnail copy
- Winning patterns from 17 top-performer thumbnails
- Failing patterns (warm tone, generic superlatives, sleep-as-visual-signal)

---

### 4. `src/thumbnail-v3.js` — `reviewThumbnail()`

**What changed:**
- Added `niche = null` parameter (4th argument)
- Added `philosophyCriticBlock` injected into the critic prompt when `niche === 'philosophy'`

**Philosophy scoring criteria injected:**
- Instant deductions (−2 each, cap 4/10): warm palette, multiple figures, sleep-as-visual, generic hook, philosopher-describing hook
- Bonuses (+1 each, cap 10): one chalk bust, cold palette, named concept in hook, active-force hook, negative space

---

### 5. `src/thumbnail-v3.js` — `generateThumbnailV3()`

**What changed:** Updated call at Step 5 to pass `niche` as 4th argument to `reviewThumbnail`.

```diff
- const review = await reviewThumbnail(pngPath, title, hookTextFromPlan);
+ const review = await reviewThumbnail(pngPath, title, hookTextFromPlan, niche);
```

## Channel Isolation Confirmed

All changes gate on `niche === 'philosophy'`. The Astronomer pipeline uses `thumbnail_style === 'astrokobi'`
and is routed through dedicated AstroKobi prompts before any of these philosophy blocks are reached.
No Astronomer code paths were modified.
