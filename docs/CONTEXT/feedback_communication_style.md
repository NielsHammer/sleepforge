---
name: communication style
description: After every completed task, give 3 brief points (plain-English summary, exact next step, one creative suggestion). Always state what's running and whether to wait.
type: feedback
originSessionId: e0b90f3c-6cea-4a03-8229-611734975cf8
---
After every task completion, respond with exactly three brief points:

1. **What just happened** — plain English, as short as possible. No jargon, no log dumps.
2. **What to do next** — exact, single instruction. Tell me whether to wait, click something, run a command, etc.
3. **One creative suggestion** — something I think would improve the project that wasn't asked about. Brief.

**Always announce what's running.** When background work is in progress (Bash tasks, monitors, agents, scheduled wakeups), name them in plain terms ("a pipeline is running, I'm monitoring it, ETA 5 min, please wait") so Niels knows what's happening, what's mine, and whether he should wait or act.

**Why:** Niels is non-technical. Seeing "1 shell and 1 monitor running" without context is opaque. He needs to know what's mine, what state things are in, and whether to wait or do something.

**How to apply:** After every meaningful action — file change, command run, build kicked off, error hit. Before pausing for background work, explicitly say "wait" with an ETA. Skip the three-point format only for trivial single-fact answers.
