/**
 * SleepForge 2-minute test video — Polish Pass 3 (May 2026)
 *
 * Full pipeline end-to-end:
 *   1. Start Chatterbox TTS server
 *   2. Generate 2-min script via Claude Haiku (cached)
 *   3. TTS all sentences via Chatterbox archer voice (cached)
 *   4. Whisper word timestamps (cached)
 *   5. Director: sentence → 4s clip windows
 *   6. Generate 2 chalk images per scene via Flux Schnell (cached)
 *   7. Generate philosophy background image via Flux Schnell (cached once)
 *   8. Assign images to clips
 *   9. ASS karaoke subtitles (word-by-word reveal)
 *  10. Fireplace particles + smoke loops (cached)
 *  11. Render 3 Remotion animations (cached), assign to clips at transitions
 *  12. FFmpeg composition:
 *        - createClipSlideshow: static hold + 1.5s crossfades (NO Ken Burns)
 *        - mixAudio: voice + fire + crickets ONLY (no bgmusic — separate stream)
 *        - composeFinalVideoWithBg: bg(15%) + chalk(85%) + particles(screen) +
 *          smoke(screen) + ASS subs + voice(a:0) + bgmusic@30%(a:1)
 *  13. Extract frame at 30s for particle/layer verification
 *  14. Run auto-critic
 *
 * Usage: node scripts/test-video-2min.js
 */
import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

import { generateScript }   from '../src/script-generator.js';
import { generateASS }      from '../src/subtitles.js';
import { createStoryboard } from '../src/director.js';
import {
  createClipSlideshow,
  mixAudio,
  ensureSmokeLoop,
  ensureParticleLoop,
  ensurePhilosophyFrameSet,
  composeFinalVideoWithBg,
  getAudioDuration,
  generateIntroSting,
  prependIntroSting,
} from '../src/ffmpeg.js';
import { isHealthy, chatterboxTTS, resetHealthCache } from '../src/chatterbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_BIN   = process.env.PYTHON_BIN
  || path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');

const TOPIC        = process.env.SLEEPFORGE_TOPIC || 'Marcus Aurelius on Letting Go of What You Cannot Control';
const DURATION_MIN = parseInt(process.env.SLEEPFORGE_DURATION || '2', 10);
const SLUG         = process.env.SLEEPFORGE_SLUG  || 'marcus-aurelius-2min';
const OUTPUT_DIR   = path.join(PROJECT_ROOT, 'output', SLUG);
const ASSETS_DIR   = path.join(OUTPUT_DIR, 'assets');
const SENTENCES_DIR = path.join(ASSETS_DIR, 'sentences');
const SCRIPTS_DIR  = path.join(PROJECT_ROOT, 'scripts');

const VOICEOVER_PATH = path.join(ASSETS_DIR, 'voiceover.wav');
const WHISPER_PATH   = path.join(ASSETS_DIR, 'whisper.json');
const ASS_PATH       = path.join(ASSETS_DIR, 'subtitles.ass');
const SLIDESHOW_PATH = path.join(OUTPUT_DIR, 'slideshow.mp4');
const VOICE_MIX_PATH = path.join(OUTPUT_DIR, 'voice-mix.m4a');   // voice + fire + crickets + bgmusic
const BG_MUSIC_PATH  = path.join(PROJECT_ROOT, 'assets', 'audio', 'bgmusic.mp3');
const FINAL_PATH     = path.join(OUTPUT_DIR, 'final.mp4');
const FRAME_30S_PATH = path.join(OUTPUT_DIR, 'frame-30s.png');
const FRAME_IMG_PATH = path.join(OUTPUT_DIR, 'verify-image-scene.png');

const STING_PATH     = path.join(ASSETS_DIR, 'intro-sting.wav');
const STING_VOICE_PATH = path.join(ASSETS_DIR, 'voiceover-with-sting.wav');
const INTRO_DURATION   = 2; // seconds of black fade-in + sting before narration

const BG_IMAGE_PATH  = path.join(PROJECT_ROOT, 'assets', 'backgrounds', 'philosophy-bg-1080.jpg');
const BG_PROMPT      = 'ancient Greek philosophy library at dusk, marble columns, candlelight, ' +
                       'atmospheric, cinematic, no people, no text, soft focus, warm tones, ' +
                       'oil lamps glowing, scroll shelves, stone archways, golden hour light';

for (const d of [OUTPUT_DIR, ASSETS_DIR, SENTENCES_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const t_pipeline = Date.now();
log('═══════════════════════════════════════════');
log('SleepForge — 2-minute test video (polish pass 6)');
log('Topic: ' + TOPIC);
log('Output: ' + OUTPUT_DIR);
log('═══════════════════════════════════════════');

// Force re-render of slideshow/audio on each pass (lightweight; particles-loop is kept)
if (fs.existsSync(SLIDESHOW_PATH))   fs.unlinkSync(SLIDESHOW_PATH);
if (fs.existsSync(VOICE_MIX_PATH))   fs.unlinkSync(VOICE_MIX_PATH);
if (fs.existsSync(STING_VOICE_PATH)) fs.unlinkSync(STING_VOICE_PATH);
if (fs.existsSync(FINAL_PATH))       fs.unlinkSync(FINAL_PATH);

// ── Step 1: Start Chatterbox server ──────────────────────────────────────────
log('\n── Step 1: Starting Chatterbox server ──');
const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
let serverProc   = spawn(PYTHON_BIN, [serverScript], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CHATTERBOX_PORT: '4123' },
});
serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
serverProc.on('error', err => log('Chatterbox server error: ' + err.message));

log('  Waiting for model load...');
const serverReady = waitForChatterbox(300);

// ── Step 2: Script ────────────────────────────────────────────────────────────
log(`\n── Step 2: Script generation (Haiku, ${DURATION_MIN} min) ──`);
const scriptJsonPath = path.join(SCRIPTS_DIR, SLUG + '.json');
let scenes;
if (fs.existsSync(scriptJsonPath)) {
  log('  Using cached script: ' + scriptJsonPath);
  scenes = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
} else {
  const result = await generateScript(TOPIC, {
    duration: DURATION_MIN,
    philosophers: ['marcus-aurelius', 'epictetus', 'seneca'],
    output: SCRIPTS_DIR,
  });
  scenes = result.scenes;
  fs.writeFileSync(scriptJsonPath, JSON.stringify(scenes, null, 2));
}
const scriptText = scenes.map(s => s.narration).join('\n\n');
const wordCount  = scriptText.split(/\s+/).length;
log(`  ${scenes.length} scenes, ${wordCount} words (~${Math.round(wordCount / 110)} min)`);

// ── Step 3: Voiceover ─────────────────────────────────────────────────────────
log('\n── Step 3: Chatterbox TTS (archer voice) ──');
if (fs.existsSync(VOICEOVER_PATH)) {
  const dur = getAudioDuration(VOICEOVER_PATH);
  log(`  Cached voiceover: ${dur.toFixed(1)}s`);
} else {
  const healthy = await serverReady;
  if (!healthy) {
    log('  ERROR: Chatterbox server never became healthy — aborting');
    serverProc.kill();
    process.exit(1);
  }
  log('  Chatterbox healthy ✓');

  const sentences = splitSentences(scriptText);
  log(`  ${sentences.length} sentences to synthesize`);

  const ttsStats = { totalAudio: 0, totalElapsed: 0, count: 0 };
  const partPaths = [];
  const silence350 = path.join(ASSETS_DIR, '_silence-350.wav');
  const silence700 = path.join(ASSETS_DIR, '_silence-700.wav');
  ensureSilence(silence350, 350);
  ensureSilence(silence700, 700);

  let lastHealthCheck = Date.now();
  for (let i = 0; i < sentences.length; i++) {
    const { text, paragraphEnd } = sentences[i];
    const partPath = path.join(SENTENCES_DIR, `s${String(i).padStart(3, '0')}.wav`);

    // Proactive health check every 25 sentences — catches silent server crashes
    if (i > 0 && i % 25 === 0) {
      const healthy = await isHealthy();
      if (!healthy) {
        log(`  [TTS] Server unhealthy at sentence ${i} — restarting...`);
        await restartChatterbox();
      }
      lastHealthCheck = Date.now();
    }

    if (!fs.existsSync(partPath)) {
      const t0 = Date.now();
      await chatterboxTTSWithRetry(text, partPath, 3);
      const elapsed = (Date.now() - t0) / 1000;
      const dur     = getAudioDuration(partPath);
      ttsStats.totalAudio   += dur;
      ttsStats.totalElapsed += elapsed;
      ttsStats.count++;
      const pct = Math.round(100 * (i + 1) / sentences.length);
      log(`  [${i+1}/${sentences.length}] ${pct}% — ${elapsed.toFixed(1)}s → ${dur.toFixed(1)}s audio`);
    }
    partPaths.push(partPath);
    if (i < sentences.length - 1) {
      partPaths.push(paragraphEnd ? silence700 : silence350);
    }
  }

  if (ttsStats.count > 0) {
    const rt = (ttsStats.totalElapsed / ttsStats.totalAudio).toFixed(2);
    log(`  ◆ Chatterbox: ${rt}x realtime`);
  }

  const concatFile = path.join(ASSETS_DIR, '_concat.txt');
  fs.writeFileSync(concatFile, partPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${VOICEOVER_PATH}"`,
    { stdio: 'pipe' }
  );
  fs.unlinkSync(concatFile);
  log(`  Voiceover: ${getAudioDuration(VOICEOVER_PATH).toFixed(1)}s`);
}
const audioDuration = getAudioDuration(VOICEOVER_PATH);
const totalDuration = audioDuration + INTRO_DURATION;

// ── Step 4: Whisper ───────────────────────────────────────────────────────────
log('\n── Step 4: Whisper word timestamps ──');
let wordTimestamps = [];
if (fs.existsSync(WHISPER_PATH)) {
  wordTimestamps = JSON.parse(fs.readFileSync(WHISPER_PATH, 'utf-8'));
  log(`  Cached: ${wordTimestamps.length} words`);
} else {
  log('  Running Whisper base model...');
  const t0 = Date.now();
  const whisperResult = execSync(
    `"${PYTHON_BIN}" -c "` +
      `import whisper,json;` +
      `m=whisper.load_model('base');` +
      `r=m.transcribe(r'${VOICEOVER_PATH}',word_timestamps=True,language='en');` +
      `words=[{'word':w['word'].strip(),'start':round(w['start'],3),'end':round(w['end'],3)}` +
      ` for seg in r['segments'] for w in seg.get('words',[])];` +
      `print(json.dumps(words))"`,
    { encoding: 'utf-8', timeout: 300000 }
  );
  wordTimestamps = JSON.parse(whisperResult.trim());
  fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTimestamps));
  log(`  ${wordTimestamps.length} words in ${((Date.now()-t0)/1000).toFixed(0)}s`);
}

// ── Step 5: Director + library image assignment ───────────────────────────────
log('\n── Step 5: Director + library image lookup ──');
const { clips } = await createStoryboard(scenes, wordTimestamps, audioDuration, { targetClipSec: 4 });

// Resolve relative library paths → absolute so ffmpeg can find them
for (const clip of clips) {
  if (clip.imagePath && !path.isAbsolute(clip.imagePath)) {
    clip.imagePath = path.join(PROJECT_ROOT, clip.imagePath);
  }
}

const assigned  = clips.filter(c => c.imagePath && fs.existsSync(c.imagePath)).length;
const philsUsed = [...new Set(clips.map(c => c.philosopher).filter(Boolean))];
log(`  ${clips.length} clips | ${assigned}/${clips.length} images from library | no Fal.ai calls`);
log(`  Philosophers in script: ${philsUsed.join(', ')}`);
log('  Sample assignments (first 4 clips):');
for (const clip of clips.slice(0, 4)) {
  const img = clip.imagePath ? path.basename(clip.imagePath) : 'none';
  log(`    [${clip.index}] score=${clip.imageScore ?? '-'} "${(clip.text||'').slice(0,45)}…" → ${img}`);
}

// ── Step 7: Philosophy background image ───────────────────────────────────────
log('\n── Step 7: Philosophy background image ──');
if (!fs.existsSync(BG_IMAGE_PATH)) {
  fs.mkdirSync(path.dirname(BG_IMAGE_PATH), { recursive: true });
  log('  Generating via Flux Schnell (one-time, cached)...');
  log(`  Prompt: ${BG_PROMPT.slice(0, 80)}...`);
  await generateSceneImage(BG_PROMPT, BG_IMAGE_PATH);
  log(`  Background: ${BG_IMAGE_PATH}`);
} else {
  log(`  Cached: ${BG_IMAGE_PATH}`);
}

// ── Step 8: Image assignment handled in Step 5 (createStoryboard) ────────────

// ── Step 9: ASS subtitles ─────────────────────────────────────────────────────
log('\n── Step 9: ASS karaoke subtitles ──');
// Always regenerate — 2-min script has different word timestamps
if (fs.existsSync(ASS_PATH)) fs.unlinkSync(ASS_PATH);
if (wordTimestamps.length > 0) {
  generateASS(wordTimestamps, ASS_PATH, { timeOffsetSec: INTRO_DURATION });
  log(`  Generated: ${ASS_PATH} (+${INTRO_DURATION}s offset for intro sting)`);
} else {
  log('  No timestamps — skipping subtitles');
}

// ── Step 10: Atmosphere layers + philosophy frame ─────────────────────────────
log('\n── Step 10: Generating atmosphere layers + frame ──');
const particlesPath = await ensureParticleLoop();
log(`  Particles: ${particlesPath}`);
const smokePath = ensureSmokeLoop();
log(`  Smoke: ${smokePath}`);

// Philosophy frame set — 10 variants, pick by FRAME_VARIANT env var (0-9)
const framePaths = ensurePhilosophyFrameSet(path.join(PROJECT_ROOT, 'assets', 'frames'));
const frameIdx = parseInt(process.env.FRAME_VARIANT || '0', 10);
const selectedFramePath = framePaths[frameIdx % framePaths.length];
log(`  Frame variant ${(frameIdx % framePaths.length) + 1}/10: ${path.basename(selectedFramePath)}`);

// ── Step 11: (animations removed — all clips are image scenes) ──────────────

// ── Step 12: FFmpeg composition ───────────────────────────────────────────────
log('\n── Step 12: FFmpeg composition ──');

// 12a: Slideshow — all image clips, 1.5s xfade crossfades
log('  Building clip slideshow (image scenes, 1.5s xfade)...');
createClipSlideshow(clips, Math.ceil(audioDuration), SLIDESHOW_PATH, { fadeTime: 1.5 });

// 12b: Intro sting — 2s cinematic swell (60Hz bass + 220Hz pad + 660Hz chime)
log('  Generating intro sting (2s cinematic swell)...');
generateIntroSting(STING_PATH, INTRO_DURATION);
prependIntroSting(STING_PATH, VOICEOVER_PATH, STING_VOICE_PATH);

// 12c: Single mixed audio track — sting + voice (100%) + fire (8%) + bgmusic (25%)
log('  Mixing single audio track (sting + voice + fire + bgmusic, no sidechain)...');
mixAudio(STING_VOICE_PATH, Math.ceil(totalDuration), VOICE_MIX_PATH, {
  includeBgMusic:  true,
  bgMusicVolume:   '0.25',
  fireplaceVolume: '0.08',
});

// 12d: Final compose — bg + chalk + particles + smoke + frame + subs + intro black
// introDuration tells compose to pad 2s of black + fade-in at start of video
log('  Composing final video (single audio track, frame overlay, intro sting)...');
composeFinalVideoWithBg({
  bgImagePath:    BG_IMAGE_PATH,
  slideshowPath:  SLIDESHOW_PATH,
  particlesPath,
  smokePath,
  assPath:        fs.existsSync(ASS_PATH) ? ASS_PATH : null,
  voiceAudioPath: VOICE_MIX_PATH,
  bgMusicPath:    null,  // already in voiceAudioPath — do NOT add again
  framePath:      selectedFramePath,
  outputPath:     FINAL_PATH,
  duration:       audioDuration,
  introDuration:  INTRO_DURATION,
});

// ── Step 13: Verify with ffprobe + extract verification frames ───────────────
log('\n── Step 13: Verification ──');

const probeOutput = execSync(
  `ffprobe -v quiet -show_streams "${FINAL_PATH}"`,
  { encoding: 'utf-8' }
);
const videoStreams = (probeOutput.match(/codec_type=video/g) || []).length;
const audioStreams = (probeOutput.match(/codec_type=audio/g) || []).length;
log(`  Streams: ${videoStreams} video, ${audioStreams} audio`);
if (audioStreams === 1) {
  log('  ✓ Single audio track confirmed (WMP-compatible)');
} else if (audioStreams === 0) {
  log('  ✗ No audio stream detected!');
} else {
  log(`  ⚠ ${audioStreams} audio streams — expected 1`);
}

// Frame at 30s — proof of layers
const frameTs = Math.min(30, audioDuration * 0.4);
execSync(
  `ffmpeg -y -ss ${frameTs.toFixed(1)} -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_30S_PATH}"`,
  { stdio: 'pipe' }
);
const frameOk = fs.existsSync(FRAME_30S_PATH) && fs.statSync(FRAME_30S_PATH).size > 5000;
log(`  Frame at ${frameTs.toFixed(1)}s: ${frameOk ? FRAME_30S_PATH : 'FAILED'}`);

// Image scene verification — frame from early in video (image clip zone)
try {
  execSync(
    `ffmpeg -y -ss 8 -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_IMG_PATH}"`,
    { stdio: 'pipe' }
  );
  log(`  Image scene frame (8s): ${FRAME_IMG_PATH}`);
} catch {}

// volumedetect on first 5s — confirm voice is audible (FFmpeg writes to stderr)
try {
  const volOut = execSync(
    `ffmpeg -y -i "${FINAL_PATH}" -t 5 -af "volumedetect" -f null NUL 2>&1`,
    { encoding: 'utf-8' }
  );
  const meanVol = volOut.match(/mean_volume:\s*(-[\d.]+)\s*dB/);
  if (meanVol) log(`  Audio mean (first 5s): ${meanVol[1]} dBFS`);
} catch (e) {
  const combined = (e.stdout || '') + (e.stderr || '') + (e.message || '');
  const meanVol = combined.match(/mean_volume:\s*(-[\d.]+)\s*dB/);
  if (meanVol) log(`  Audio mean (first 5s): ${meanVol[1]} dBFS`);
}

// ── Done ──────────────────────────────────────────────────────────────────────
const finalSize = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);
const elapsed   = Math.round((Date.now() - t_pipeline) / 1000);

log('\n═══════════════════════════════════════════');
log('✅ DONE');
log(`   Video:         ${FINAL_PATH}`);
log(`   Duration:      ${totalDuration.toFixed(1)}s (${(totalDuration/60).toFixed(2)} min) [incl. ${INTRO_DURATION}s intro sting]`);
log(`   Clips:         ${clips.length} @ ~4s each (all image scenes)`);
log(`   Audio streams: ${audioStreams} (target: 1 — single mixed track)`);
log(`   File size:     ${finalSize} MB`);
log(`   Pipeline:      ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
log(`   Frame 30s:     ${FRAME_30S_PATH}`);
log(`   Verify image:  ${FRAME_IMG_PATH}`);
log('═══════════════════════════════════════════');

serverProc.kill();
process.exit(0);

// ── HELPERS ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }

async function waitForChatterbox(timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function restartChatterbox() {
  log('  [TTS] Restarting Chatterbox server...');
  try { serverProc.kill('SIGKILL'); } catch {}
  resetHealthCache();
  await new Promise(r => setTimeout(r, 2000));
  const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
  serverProc = spawn(PYTHON_BIN, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CHATTERBOX_PORT: '4123' },
  });
  serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
  serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
  serverProc.on('error', err => log('Chatterbox restart error: ' + err.message));
  const ok = await waitForChatterbox(120);
  if (ok) log('  [TTS] Chatterbox restarted ✓');
  else    log('  [TTS] WARNING: Chatterbox did not recover after restart');
  return ok;
}

// 3 retries with exponential backoff. On total failure writes 2s silence so
// the render continues — a single bad sentence shouldn't abort 600+ others.
async function chatterboxTTSWithRetry(text, outputPath, maxAttempts = 3) {
  const silence2s = path.join(ASSETS_DIR, '_silence-2000.wav');
  ensureSilence(silence2s, 2000);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // If server appears dead, restart before retrying
      if (attempt > 1) {
        const healthy = await isHealthy();
        if (!healthy) await restartChatterbox();
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
      await chatterboxTTS(text, outputPath);
      return;
    } catch (err) {
      lastErr = err;
      log(`  [TTS] Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
  }
  log(`  [TTS] All ${maxAttempts} attempts failed — substituting 2s silence`);
  fs.copyFileSync(silence2s, outputPath);
}

function splitSentences(text) {
  const ABBR = /^(Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|etc|Inc|Co|Ltd|B\.C|A\.D|i\.e|e\.g)$/i;
  const paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const out   = [];
  for (let pi = 0; pi < paras.length; pi++) {
    const parts  = paras[pi].replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/);
    const merged = [];
    let buf = '';
    for (const part of parts) {
      buf = buf ? buf + ' ' + part : part;
      const m = buf.match(/(\S+?)\.\s*$/);
      if (m && ABBR.test(m[1])) continue;
      merged.push(buf); buf = '';
    }
    if (buf) merged.push(buf);
    for (let i = 0; i < merged.length; i++) {
      out.push({ text: merged[i].trim(), paragraphEnd: i === merged.length - 1 && pi < paras.length - 1 });
    }
  }
  return out.filter(s => s.text.length > 0);
}

function ensureSilence(outPath, durationMs) {
  if (fs.existsSync(outPath)) return;
  execSync(
    `ffmpeg -y -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=24000" ` +
    `-t ${(durationMs / 1000).toFixed(3)} -c:a pcm_s16le "${outPath}"`,
    { stdio: 'pipe' }
  );
}
