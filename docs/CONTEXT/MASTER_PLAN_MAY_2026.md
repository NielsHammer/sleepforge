# SleepForge — Master Plan & State (May 2026)

**Last updated:** 2026-05-09  
**Platform:** Windows 11, RTX 3060 12GB, Node v24.14  
**Channel:** sleepless-philosophers (YouTube)  
**Owner:** Niels

---

## Current State: What's Built

### Core Pipeline
| Module | Status | Notes |
|--------|--------|-------|
| `src/pipeline.js` | ✓ Production | End-to-end video generation |
| `src/worker.js` | ✗ MISSING | `package.json` references it but file doesn't exist |
| `src/ffmpeg.js` | ✓ | FFmpeg assembly |
| `src/tts.js` | ✓ Kokoro only | Runs on RTX 3060 CUDA, ~1.21x realtime |
| `src/script-generator.js` | ✓ | Claude Haiku, <$0.10/video |
| `src/thumbnail-v3.js` | ✓ | Full HTML/CSS → Puppeteer pipeline |
| `src/youtube-metadata-generator.js` | ✓ | Haiku, principle-score injected |
| `src/youtube.js` | ✓ | OAuth, upload, scheduling |

### Performance Learning Loop (all built May 9)
| Phase | Script | Output |
|-------|--------|--------|
| 1. Ingest | `scripts/ingest-own-channel.js` | `data/own-channel-history.json` |
| 2. Refresh | `scripts/refresh-analytics.js` | updates both history files |
| 3. Score | `scripts/score-principles.js` | `data/principle-scores.json` |
| 4. Benchmark | `scripts/channel-benchmark.js` | `data/channel-benchmark.json` |
| 5. Inject | `src/thumbnail-v3.js` + `src/youtube-metadata-generator.js` | principle scores → prompts |
| 6. Dashboard | Jarvis analytics panel | 4 API routes + CSS |
| 7. Scheduler | `scripts/install-scheduler.ps1` | 3am nightly task |

### Jarvis Dashboard
- **URL:** `http://localhost:3001`
- **Status:** Running (PID rotates; kill old with `Get-NetTCPConnection -LocalPort 3001`)
- **Start:** `npm run jarvis`
- **Broken:** `/api/jarvis/speak` — Edge TTS WebSocket returning 400 (token expired)

### Reference Intelligence
- 335 references harvested (sleep_philosophy + sleep_history niches)
- `data/reference-principles.json` — 350-source learning, 3 top patterns
- **Pending:** sleep_lit, sleep_ambient, spoken_word_calm (quota exhausted May 9, harvests tomorrow)

---

## Channel Baseline (May 9, 2026)

| Metric | Value |
|--------|-------|
| Total videos on channel | 333 |
| SleepForge-made videos | 1 (published May 8) |
| Retention p10 | 8.5% |
| Retention p25 | 11.0% |
| **Retention median** | **14.1%** |
| Retention p75 | 17.6% |
| Retention p90 | 24.1% |
| Thumbnail CTR | N/A — not available per-video via YouTube Analytics API v2 |

**SleepForge video #1** (`_EJ1oGNKdcs`): Published May 8, analytics pending (YouTube API delay).  
**Top channel video:** 2,610 views, 16.3% retention — "2 Hours of Philosophy That Will Stick in Your Mind"

---

## Key File Paths

| File | Purpose |
|------|---------|
| `data/own-channel-history.json` | All 333 channel videos + analytics |
| `data/video-history.json` | SleepForge-made videos only |
| `data/channel-benchmark.json` | Retention percentiles for whole channel |
| `data/principle-scores.json` | CTR/retention lift per title principle |
| `data/reference-principles.json` | Learned patterns from 350 reference videos |
| `data/chalk-prompts.json` | 500 chalk image prompts for library |
| `data/harvest-queries.json` | YouTube harvest niche + query config |
| `assets/images/library-v1/` | 500 chalk images + index.json |
| `assets/youtube-tokens/sleepless-philosophers.json` | OAuth token |
| `C:\Users\niels\Desktop\References\` | 335 harvested reference videos |
| `C:\Users\niels\Desktop\References\index.json` | Reference video index |
| `jarvis/state.json` | Jarvis render/publish queue + analytics cache |
| `jarvis/public/` | Dashboard frontend (HTML/CSS/JS) |

---

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `jarvis` | `node jarvis/server.js` | Start dashboard on port 3001 |
| `learn` | `node scripts/learn-references.js` | Process references into principles |
| `harvest` | `node scripts/harvest-references.js` | YouTube API harvest (8500 units/day) |
| `harvest:transcripts` | `node scripts/harvest-transcripts.js` | yt-dlp transcripts (1am–7am only) |
| `harvest:status` | `node scripts/harvest-status.js` | Print harvest progress |
| `ingest` | `node scripts/ingest-own-channel.js` | Pull all channel analytics |
| `analytics` | `node scripts/refresh-analytics.js` | Refresh SleepForge video analytics |
| `score` | `node scripts/score-principles.js` | Score title principles by CTR/retention |
| `benchmark` | `node scripts/channel-benchmark.js` | Compute channel retention percentiles |
| `samples` | `node scripts/generate-samples.js` | Generate 5 sample thumbnail+metadata sets |
| `worker` | `node src/worker.js` | **BROKEN — file missing** |
| `dashboard` | `node dashboard/server.js` | Legacy dashboard (not Jarvis) |

---

## Known Issues / Flagged by Niels

### Critical
1. **`src/worker.js` is missing** — `npm run worker` will fail. The video production worker doesn't exist yet on Windows (was on the Linux server).
2. **Edge TTS token expired** — `/api/jarvis/speak` returns 500. Token `6A5AA1D4EAFF4E9FB37E23D68491D6F4` needs refreshing. Monitor [edge-tts library](https://github.com/rany2/edge-tts) for current token.

### API Limitations
3. **YouTube thumbnail CTR not available per-video** — `impressions` and `impressionClickThroughRate` are YouTube Studio-only. The Analytics API v2 only returns `averageViewPercentage` (retention) per video. All CTR fields will remain null.

### Pending
4. **Day 2 harvest blocked** — YouTube API quota exhausted on May 9 (6986/7000 units). sleep_lit, sleep_ambient, spoken_word_calm niches not yet harvested. Run `npm run harvest` after midnight Pacific.
5. **Sample thumbnails in progress** — `generate-samples.js` running in background (PID 22536). May hit rate limit again; re-run `npm run samples` if needed.
6. **yt-dlp health check threshold too tight** — 3s threshold causes "slow" classification on cold network connections. Consider raising to 5–6s.
7. **SleepForge video analytics pending** — Published May 8, retention data will appear in 48–72h. Re-run `npm run ingest` then `npm run benchmark` on May 11.
8. **Nightly scheduler not installed** — `scripts/install-scheduler.ps1` exists but hasn't been run. Run it as Administrator to register the 3am analytics task.

---

## Next 5 Priorities

1. **Run Day 2 harvest** (midnight May 9 / morning May 10): `npm run harvest` → then `npm run learn` to update reference-principles.json with sleep_lit/ambient/spoken_word patterns.
2. **Fix Edge TTS token** — Update `TTS_TOKEN` in `jarvis/server.js` to restore voice responses.
3. **Build `src/worker.js`** — Windows-adapted production worker. Reference: `/opt/sleepforge/src/worker.js` on the server.
4. **Install nightly scheduler** — Run `scripts/install-scheduler.ps1` as Administrator to register 3am analytics pipeline.
5. **Re-run analytics on May 11** — SleepForge video will have 48h of data: `npm run ingest && npm run score && npm run benchmark`.

---

## Architecture Notes

### Two Data Streams (Never Mix)
- **Reference data** (`Desktop\References\`) — Top YouTube videos in niche. Used for learning what works. NEVER used as performance feedback.
- **Outcome data** (`data/own-channel-history.json`) — SleepForge channel performance. Used for principle scoring and benchmarking.

### AI Model Rules (from CLAUDE.md)
- Haiku only for: scripts, metadata, SEO titles, scene keywords
- Sonnet only for: thumbnail planning/critique, complex design
- Never Opus. Target cost: <$0.20/video.

### TTS Rules
- Kokoro only on RTX 3060 CUDA
- Never ElevenLabs (credits), never F5-TTS (removed)
- Voice sample: `assets/voice-samples/niels-voice-sample.mp3`
