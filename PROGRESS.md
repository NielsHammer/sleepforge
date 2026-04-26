# SleepForge Progress Log

## 2026-04-26 — Cost Cut + Quality Pass: Schnell, Cloned Voice, Chalkboard Frame
✅ COST: src/fal.js switched to Flux Schnell ($0.003/img vs Pro's $0.05) — 17x cheaper, chalk style reads better at lower fidelity
✅ FIX: Image switching slowed to 12-15s per slot (was 8-15s), xfade bumped to 2.0s — calmer sleep pacing
✅ FIX: SFX loop clicks — added makeSeamlessLoop(): rotates file by half-length, crossfades the seam, fades file boundaries; cached as *-seamless.mp3. Plus aresample=async=1 on each looped input.
✅ FIX: Voice — pipeline default voice flipped from kokoro-warm (female) to cloned-niels (F5-TTS); analyzePacing() now called before TTS so cloned voice runs at 0.90 sleep speed
✅ FIX: Background — GreekLibraryScene rewritten with 3-deep recessed columns each side, 5 scroll-shelf rows per wall, coffered ceiling tiles, brazier flicker glows, masonry texture, perspective floor lines
✅ FIX: Image frame — ImagePanel now renders rough wooden chalkboard surround with grain knots, chalk-dust corner streaks, and a chalk ledge (with 3 chalk pieces) below the frame
✅ FIX: Smoke wisps — opacity bumped 3-4x, two-layer system (warm rising plumes + cool drifting upper haze)
✅ Re-rendered bg.mp4 (17 MB, 120s @ 30fps)
🔄 Known Issues: Pipeline not yet end-to-end re-tested with the full set of fixes; cloned-niels TTS speed may need tuning by ear
⏭ Next: Run full pipeline, generate one video, verify all six fixes visually + audibly
⚠ Cost projection (60-min video): ~$0.10 script + ~24 images × $0.003 = $0.072 + $0 TTS + $0 Whisper = ~$0.17 total

## 2026-04-26 — Pipeline v2: Remotion Background + Intro + xFade + 8 Scenes!
✅ FIX: Black screen eliminated — xfade slideshow covers full duration, zero black frames
✅ FIX: Scene density — 8 scenes per 5 min (was 2), each 30-45 seconds with unique image prompt
✅ FIX: Image crossfade — 1.5s xfade transitions between images
✅ BUILD: Remotion background — dark Greek library with animated particles, smoke wisps, columns, scroll shelves
✅ BUILD: Opening animation — 12s intro with channel name, video title, subscribe reminder, Greek key corners
✅ BUILD: Image panel overlay — slideshow centered at 60% of screen on top of Remotion background
✅ Full pipeline v2 test passed: 5.5 min video (12s intro + 5.3min content), 8 images, 14MB, 295s build time
🔄 Known Issues: Intro concat may need re-encoding for codec compatibility, image style still slightly photorealistic on some scenes
⏭ Next: Lock image style for 1000-prompt generation, test 60-min video, add YouTube upload
⚠ Cost: ~$0.08 script + $0.24 images (8x Fal.ai) + $0 TTS/Whisper = ~$0.32 total (under budget for 5min test)

## 2026-04-26 — FULL PIPELINE WORKING END-TO-END!
✅ Completed: First full video generated — 5.3 min, 23 MB, with voiceover + images + subtitles + ambience
✅ Completed: src/script-generator.js — Claude Haiku, structured JSON with scene metadata, craftImagePrompt
✅ Completed: src/subtitles.js — ASS karaoke, 4 words/phrase, gold highlight, fixed bottom center
✅ Completed: src/ffmpeg.js — background + image slideshow + audio mix (voice + fireplace + crickets) + subtitle burn
✅ Completed: src/pipeline.js — full orchestrator: script → TTS → Whisper → images → FFmpeg → metadata
✅ Completed: Scene-aware image generation — each image knows WHO (philosopher) and WHAT (moment)
🔄 Known Issues: Images still slightly photorealistic (need stronger chalk enforcement), only 2 images for 5-min video (need more scenes per video)
⏭ Next: Review test video quality, tune image style further, test with 60-min duration, add YouTube upload module
⚠ Notes: Pipeline ran in 166s. Cost estimate: ~$0.10 script (Haiku) + ~$0.06 images (2x Fal.ai) + $0 TTS (Kokoro) + $0 Whisper = ~$0.16 total

## 2026-04-26 — Script Generator Built + Chalk Style Locked!
✅ Completed: Built src/script-generator.js adapted from VideoForge's v40 architecture
✅ Completed: Locked chalk-on-blackboard image style (test10 — seneca-storm reference)
✅ Completed: Built craftImagePrompt() that generates scene-aware image prompts with philosopher name + action + setting wrapped in locked chalk style
✅ Completed: Added generateSceneImage() to src/fal.js for pipeline use
✅ Completed: File server running on port 8080 via PM2 (sleepforge-fileserver)
🔄 In Progress: None
⏭ Next: Test script generator with a real 60-min philosophy topic, then build src/subtitles.js (ASS karaoke subs)
⚠ Notes: Script gen uses Claude Haiku (~$0.10/video), outputs structured JSON with scene metadata. Images will be generated WITH script context so each image matches what the narrator is saying at that moment.

## 2026-04-26 — Chalk Style Iteration (test9 → test10)
✅ Completed: test9 — 10 images with refined prompts (7/10 broke into photorealism due to light sources)
✅ Completed: Root cause identified: fire/candle/lantern/stars trigger Flux into photorealism
✅ Completed: test10 — 5 images with strict no-light-source prompts (5/5 stayed monochrome)
✅ Locked style formula: medium distance, 3/4 body, swirling chalk atmosphere, single Greek column, NO light sources
⚠ Notes: Style is locked but images need script context to feel specific (not generic philosophers). craftImagePrompt solves this.

## 2026-04-25 — Chalkboard Philosophy Candidate Collection Generated!
✅ Completed: Created 500 candidate chalkboard image concepts and selected the top 100 for the channel style
✅ Completed: Generated 10 test chalkboard images from the top 100 selection in `assets/images/test8`
🔄 In Progress: Review the top 100 prompt collection and refine for the next batch
⏭ Next: Confirm preferred top 100 moments and continue generating more chalkboard images
⚠ Notes: Prompts are now focused on single actions or symbolic objects, with no background scenery and a raw chalkboard style

## 2026-04-25 — Branded Philosophy Images in Drawing Styles!
✅ Completed: Generated 10 philosophy images in 10 different drawing styles (chalk, charcoal, ink wash, pencil, conte, pastel, watercolor, etching, woodcut, engraving) for channel branding
🔄 In Progress: None
⏭ Next: Review styles and select preferred one(s) for consistent channel theme
⚠ Notes: All images maintain dark/grey/black palette with ancient Greek elements, action-focused foregrounds

## 2026-04-25 — Philosophy Images with Ancient Greek Vibe!
✅ Completed: Generated new batch of 10 action-focused philosophy pixel-art images with ancient Greek ambience added to backgrounds (test3 folder)
🔄 In Progress: None
⏭ Next: Review new images, potentially refine prompts or proceed to video pipeline integration
⚠ Notes: Added Greek elements like columns, temples, olive trees to backgrounds while maintaining action focus in foreground

## 2026-04-23 — British & American Sleep Voices Generated!
✅ Completed: Created high-quality British (bf_alice) and American (af_nicole) Kokoro sleep voices
🔄 In Progress: Generating F5-TTS cloned Archer voice (running in background)
⏭ Next: Test all voice options and build video pipeline
⚠ Notes: Kokoro voices are fast and excellent quality; F5-TTS takes longer but will sound exactly like your Archer sample

## 2026-04-23 — Philosophy Voice Sample Generated!
✅ Completed: Created 82-second philosophy voiceover sample with Kokoro TTS (warm female voice)
🔄 In Progress: Test F5-TTS cloned voice generation
⏭ Next: Generate F5-TTS sample with cloned Niels voice
⚠ Notes: Kokoro working perfectly for sleep content - calm, meditative delivery

## 2026-04-23 — Voice Cloning Reference Files Generated!
✅ Completed: Fixed clone_voice.py syntax error, generated matched reference audio/text files for F5-TTS
🔄 In Progress: Test F5-TTS voice generation (takes time)
⏭ Next: Build complete TTS module, test video pipeline
⚠ Notes: Reference files created from clean ElevenLabs Archer sample with exact transcript match

## 2026-04-23 — F5-TTS Voice Cloning Complete!
✅ Completed: F5-TTS voice cloning successful - authentic Niels voice generated (32.4s sample)
🔄 In Progress: Ready for next session
⏭ Next: Implement ASS subtitle system implementation
⚠ Notes: Both Kokoro (18.8s) and F5-TTS cloned Niels (32.4s) voices working with sleep-optimized pacing

## 2026-04-23 — Voice Test Successful!
✅ Completed: Voice cloning test passed - generated 18.8-second sleepy voiceover sample
🔄 In Progress: Ready for next session
⏭ Next: Implement ASS subtitle system implementation
⚠ Notes: Kokoro TTS working with sleep-optimized pacing (0.90 speed, calm delivery)

## 2026-04-23 — All Progress Saved to GitHub
✅ Completed: All work committed and pushed to GitHub repository (NielsHammer/sleepforge)
🔄 In Progress: Ready for next session
⏭ Next: Continue with ASS subtitle system implementation
⚠ Notes: Large model files (*.onnx, voices.bin) excluded from git - download at runtime

## 2026-04-23 — Project Initialized
✅ Completed: Folder structure, API keys, git setup, channel config, CLAUDE.md, PROGRESS.md, Kokoro TTS, Whisper, F5-TTS voice cloning, TTS module, SFX files
🔄 In Progress: Test TTS module with cloned voice
⏭ Next: Implement ASS subtitle system, test video pipeline
⚠ Notes: Voice cloned from /opt/sleepforge/assets/voice-samples/niels-voice-sample.mp3, SFX generated procedurally (ElevenLabs API unavailable)
