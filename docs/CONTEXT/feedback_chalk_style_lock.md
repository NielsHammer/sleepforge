---
name: chalk-style enforcement for SleepForge images
description: Chalk style for SleepForge image gen must be enforced by code-side prompt templating, not by Claude. Letting Claude write the full prompt produces marble-statue photorealism.
type: feedback
originSessionId: e0b90f3c-6cea-4a03-8229-611734975cf8
---
When generating SleepForge chalkboard images via Flux Schnell, the chalk style MUST be enforced by code-side prompt templating, not by asking Claude to "include the chalk style suffix" in its output.

Empirically: when the LLM writes the full prompt including the chalk style description, Schnell still renders **photorealistic white marble statues** because Claude's expressive subject descriptions (robe folds, hand gestures, sculptural anatomy) read to Flux as "marble sculpture" cues that override the chalk hint.

The working pattern is in `src/thumbnail.js` and now `src/image-prompter.js`:
1. Claude writes ONLY a short **subject+action** (10–25 words: "Epictetus seated on the steps of his Nicopolis school, hands open in his lap")
2. Code wraps it in a hardcoded `CHALK_PREFIX` + `CHALK_SUFFIX` template that explicitly says "NOT a marble statue, NOT a sculpture"
3. Hash the wrapped prompt for the cache key

**Why:** Style consistency was lost in the first contextual-prompter run when Claude was given freedom to write the full prompt. The feedback agent (Sonnet vision) flagged this as the #2 critical issue. Tested by reading actual output frames.

**How to apply:** In any future SleepForge image-generation work, never let Claude write the full Flux prompt. Restrict Claude to subject/action description only and let code apply the locked style template. Same principle applies if we later switch from Schnell to another image model.
