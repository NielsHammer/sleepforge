---
name: Videvo.io project context
description: Videvo.io is a premium AI video SaaS at /opt/videvo/ — pipeline, infra, and hard rules to never break
type: project
originSessionId: e0b90f3c-6cea-4a03-8229-611734975cf8
---
**What it is:** Videvo.io — premium AI video generation SaaS (faceless YouTube videos from a topic prompt). Same VideoForge engine as TubeAutomate but rebranded as an independent SaaS. Fully automated, no manual review.

**Infrastructure:**
- VPS: 157.180.124.232 (Hetzner CPX42, Helsinki, Ubuntu 24.04)
- Code: `/opt/videvo/src/`
- PM2 process name: `videvo-worker`
- Supabase project: zddrgpbcethmoevjorlo.supabase.co
- Frontend: Next.js on Vercel (videvo.io)
- Repo: NielsHammer/videvo on GitHub

**Hard rules (from CLAUDE.md — never break):**
1. Banned text animations: kinetic_text, typewriter_reveal, neon_sign, glitch_text, news_breaking, word_scatter, news_headline, bold_claim, text_flash, overlay_caption
2. Subtitles MUST be ASS karaoke (never SRT). MarginV=120, 4 words/phrase, yellow highlight on current word
3. Image style: documentary/candid/realistic — never clickbait/fitness models/luxury stock
4. Auto-requeue is permanently disabled — failed orders stay failed
5. Never include package.json in archives (Remotion 4.0.0 breaks npm install)
6. Always restart PM2 after code changes (`pm2 restart videvo-worker`)
7. Always commit and push after changes
8. File expiry is 10 days — never shorten
9. Credit changes ALWAYS logged in credit_logs table

**Why:** These rules came from real production incidents. CLAUDE.md is the source of truth — re-read it before working.

**How to apply:** When working on Videvo, treat CLAUDE.md as authoritative. The pipeline flow, key source files, and animation component list are all documented there.
