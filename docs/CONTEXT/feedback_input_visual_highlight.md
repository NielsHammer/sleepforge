---
name: Visual highlight when waiting for user input
description: When asking Niels a question or needing yes/no/decision, render a clearly-distinguishable visual box at the start so it's obvious he must respond before work continues
type: feedback
originSessionId: e0b90f3c-6cea-4a03-8229-611734975cf8
---
When the response requires Niels to actually interact (answer yes/no, pick A/B/C, confirm something risky, supply missing info), open the message with a hard-to-miss block. Default format:

```
> ⚠️ **NEED YOUR INPUT** ⚠️
> <one-line question>
```

Then any context underneath. Don't bury the question at the end of a long status update.

**Why:** Niels often steps away for hours. When he comes back he needs to spot in 1 second whether I'm just reporting progress (no action needed) or actually blocked on his answer (action needed). Mixing them makes him miss prompts.

**How to apply:**
- Use the box ONLY when I genuinely need his input. Status updates, progress reports, "running for ~10min" messages do NOT get the box — they're informational.
- If the question is rhetorical or self-answered later in the same message, no box.
- After the box, still give the full context so he can decide — but the question must be visible above the fold.
- This applies regardless of language (Danish or English).
