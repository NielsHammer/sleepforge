# Thumbnail System Diagnosis — May 2026

## What the 3 winners have in common

**"STILL DREAMING" (Zhuangzi/Taoism) • "KNOW NOTHING" (Socrates) • "NEED NOTHING" (Epicurus)**

Pattern: 2 ultra-common words. Present-tense or present-state phrase. Direct distillation
of the philosophy. Creates a slight paradox the viewer has to resolve. Every word a 5-year-old knows.

Trait         | Winner                      | Loser
--------------|-----------------------------|-----------------------------------------
Words         | Top 100 common English      | Uncommon forms (FREER, OBEYED, NODDING)
Tense         | Present (KNOW, NEED, DREAM) | Past tense without subject (DIED, OBEYED)
Tone          | Calming, paradoxical        | Morbid (DIED), aggressive (KINGS OBEYED)
Connection    | IS the philosophy           | Was an event (Seneca's death, Stoic kings)
Grammar       | Complete phrase             | Incomplete (FREER alone, KINGS OBEYED)

## Why the hook writer picks bad hooks

The hook prompt examples are borrowed from the factual/drama niche:
"MISSILES STARVED", "STILL KILLING", "PUNCHED THROUGH" — these reward visceral, morbid,
dramatic language. The scoring axes (clarity, promise, emotion) don't penalize:
- Death/morbid language on a SLEEP channel
- Comparative adjectives without a referent ("FREER" alone)
- Past-tense verbs without a subject ("KINGS OBEYED")

"DIED NODDING" scored 26/26 because emotion=9, promise=9, clarity=8 — the scorer
correctly detected "specific historical event, eerie, visceral". But for a sleep
channel called Sleepless Philosophers, "DIED NODDING" is actively off-putting.

## Why the critic didn't catch them

1. No text-presence hard rule. The critic prompt says "rate 1-3 for hard defects" but
   "no visible text" is not listed as a hard defect. Claude rates composition quality
   even when the hook text is absent or tiny.

2. No coherence check. The critic sees the image and rates it aesthetically. It doesn't
   ask "does the hook word make grammatical/semantic sense next to this title?"

3. The CSS legibility checks catch font-size < 36px and missing word-spacing but not:
   - Text with near-zero opacity
   - Text behind an image z-layer
   - Text outside the viewport

## Why CSS rules are sometimes ignored

The planner prompt has MANDATORY rules (word-spacing >= 0.15em, font-size >= 36px) but
Claude as planner treats them as strong suggestions, not enforced constraints. The
checkHtmlLegibility function catches violations POST-hoc but only applies a rating cap
(≤4), not a regeneration trigger.

## Before/after example: "KINGS OBEYED"

**Current pipeline:**
- Hook writer generates: "KINGS OBEYED" (score 25/26 — "emotional", "visceral", "specific")
- Validator: passes (no typo check catches "obeyed")
- Planner: designs thumbnail with large "KINGS OBEYED" text
- Critic: rates 6-7/10 (composition looks fine, doesn't flag grammar)
- Ships to YouTube

**Hardened pipeline:**
- Hook writer generates: "KINGS OBEYED"
- New validator: FAILS — "obeyed" starts with past-tense verb, not in COMMON_WORDS as first word without subject
- Feedback: "KINGS OBEYED fails: past-tense verb as first word with no subject reads oddly. Use present-tense or imperative. Try: STILL KING, RULES ALL, NO THRONE."
- Hook writer regenerates: "STILL KING" (present tense, 2 common words, philosophical)
- Passes validator, ships

## Changes required (Phases 2 + 3)

1. Add MORBID_WORDS set — block death/violence language in hooks
2. Add hook validator — catches comparative-without-than, past-tense-first-word, not-common-words
3. Add regeneration loop — up to 2 retries with explicit feedback string
4. Update hook prompt — add sleep-channel rule + bad examples from actual failures
5. Update critic prompt — add text-presence hard rule + coherence check
6. Add text-presence check — extract visible text from HTML, verify hook words present
7. Add fallback template — guaranteed legible design when all 3 variants fail
