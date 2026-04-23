# SleepForge — CLAUDE.md
Read this before doing anything else.

## What This Is
SleepForge is a personal automated video engine for long-form sleep story YouTube channels. Generates complete 1-2 hour videos fully automated.

Owner: Niels
Server: 157.180.124.232
Project root: /opt/sleepforge/
GitHub: NielsHammer/sleepforge
Reference codebase (READ ONLY): /opt/videvo/engine/src/

## Rules — Never Break
1. Always restart PM2 after code changes: pm2 restart sleepforge-worker
2. Always commit after changes: git add -A && git commit -m "..." && git push
3. Never burn API credits without confirming with Niels first
4. Read actual files before editing — never assume
5. Fix root causes not symptoms
6. Subtitles are ASS karaoke format — NEVER SRT
7. TTS is Kokoro or F5-TTS — NEVER ElevenLabs for voiceover
8. Check PM2 logs first when something breaks
9. Background is pre-rendered once per channel — never re-render per video
10. Images are pre-generated — never call Fal.ai live during video generation
11. Every 15 minutes update /opt/sleepforge/PROGRESS.md with timestamp, what was completed, what is in progress, what is next, any problems encountered
12. Before building any module — read the equivalent file in /opt/videvo/engine/src/ first

## VideoForge Reference Files (Read Before Building Equivalent)
- pipeline.js → /opt/videvo/engine/src/pipeline.js
- ffmpeg.js → /opt/videvo/engine/src/ffmpeg.js
- worker.js → /opt/videvo/engine/src/worker.js
- script-generator.js → /opt/videvo/engine/src/script-generator.js
- video-bible.js → /opt/videvo/engine/src/video-bible.js
- remotion-renderer.js → /opt/videvo/engine/src/remotion-renderer.js
- thumbnail.js → /opt/videvo/engine/src/thumbnail-v3.js
- fal.js → /opt/videvo/engine/src/fal.js

## AI Model Rules
- Script writing: Claude Haiku only (claude-haiku-4-5-20251001)
- SEO titles: Claude Haiku only
- Scene keywords: Claude Haiku only
- Metadata: Claude Haiku only
- Thumbnail prompt: Claude Sonnet only (claude-sonnet-4-6)
- NEVER use Opus
- NEVER use Sonnet for bulk tasks
- Target cost: under $0.20 per video

## Voice Sample
Primary: /opt/sleepforge/assets/voice-samples/niels-voice-sample.mp3
This is a 2-hour ElevenLabs Archer voiceover — use for F5-TTS voice cloning

## Cost Budget Per Video
- Claude Haiku: ~$0.10
- TTS: $0.00
- Whisper: $0.00
- Fal.ai thumbnail: ~$0.03
- Pre-gen images amortized: ~$0.02
- Server: ~$0.05
- Total target: ~$0.20
