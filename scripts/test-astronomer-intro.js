/**
 * test-astronomer-intro.js  — 1-min Sleepless Astronomer render with animated intro
 *
 * Differences from test-astronomer-2min.js:
 *   - 1 minute (not 2)
 *   - Pre-rendered intro-final.mp4 prepended instead of audio sting + black pad
 *   - No introDuration in composeFinalVideoWithBg — body starts from frame 0
 *   - prependIntroVideo(intro-final.mp4, body.mp4, final.mp4) as final step
 *
 * Usage:
 *   node scripts/test-astronomer-intro.js
 *   SLEEPFORGE_TOPIC="..." node scripts/test-astronomer-intro.js
 *
 * Prerequisite: run `node scripts/render-astronomer-intro.js` once first
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

import { generateScript }              from '../src/script-generator.js';
import { generateASS, filterWhisperSoundEffects } from '../src/subtitles.js';
import { createStoryboard }            from '../src/director.js';
import {
  createClipSlideshow,
  mixAudio,
  ensureSmokeLoop,
  ensureParticleLoop,
  ensurePhilosophyFrameSet,
  composeFinalVideoWithBg,
  getAudioDuration,
  prependIntroVideo,
} from '../src/ffmpeg.js';
import { isHealthy, chatterboxTTS, resetHealthCache } from '../src/chatterbox.js';
import { generateSceneImage } from '../src/fal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_BIN   = process.env.PYTHON_BIN
  || path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');

const TOPIC        = process.env.SLEEPFORGE_TOPIC || "What's Inside a Black Hole: An Hour of Deep Space Wonder";
const DURATION_MIN = parseInt(process.env.SLEEPFORGE_DURATION || '1', 10);
const SLUG         = process.env.SLEEPFORGE_SLUG  || 'astronomer-intro-test';
const OUTPUT_DIR   = path.join(PROJECT_ROOT, 'output', SLUG);
const ASSETS_DIR   = path.join(OUTPUT_DIR, 'assets');
const SENTENCES_DIR = path.join(ASSETS_DIR, 'sentences');
const SCRIPTS_DIR  = path.join(PROJECT_ROOT, 'scripts');

const VOICEOVER_PATH = path.join(ASSETS_DIR, 'voiceover.wav');
const WHISPER_PATH   = path.join(ASSETS_DIR, 'whisper.json');
const ASS_PATH       = path.join(ASSETS_DIR, 'subtitles.ass');
const SLIDESHOW_PATH = path.join(OUTPUT_DIR, 'slideshow.mp4');
const VOICE_MIX_PATH = path.join(OUTPUT_DIR, 'voice-mix.m4a');
const BODY_PATH      = path.join(OUTPUT_DIR, 'body.mp4');   // composed without intro
const FINAL_PATH     = path.join(OUTPUT_DIR, 'final.mp4');  // intro prepended
const FRAME_30S_PATH = path.join(OUTPUT_DIR, 'frame-30s.png');
const FRAME_IMG_PATH = path.join(OUTPUT_DIR, 'verify-image-scene.png');

const CHANNEL_CONFIG = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8')
);
const INTRO_FINAL_PATH = path.join(PROJECT_ROOT, CHANNEL_CONFIG.intro_video_path);
const INTRO_SEC        = CHANNEL_CONFIG.intro_duration_seconds || 2;

const FULLSCREEN    = CHANNEL_CONFIG.frame_style === 'fullscreen';
const SHOW_CAPTIONS = CHANNEL_CONFIG.show_captions !== false;

const SPACE_LIB_PATH = path.join(PROJECT_ROOT, 'assets', 'images', 'space-library-v1', 'index.json');
const BG_IMAGE_PATH  = path.join(PROJECT_ROOT, 'assets', 'backgrounds', 'astronomer-bg-1080.jpg');
const BG_PROMPT      = 'deep space observatory at night, vast star field, Milky Way arc, ' +
                       'telescope dome silhouette, dark blue atmosphere, cinematic, no people, ' +
                       'no text, soft focus, nebula glow in background, cosmic scale, serene';

for (const d of [OUTPUT_DIR, ASSETS_DIR, SENTENCES_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const t_pipeline = Date.now();
log('═══════════════════════════════════════════════════');
log('SleepForge — Astronomer intro test (1 min)');
log('Topic: ' + TOPIC);
log('Output: ' + OUTPUT_DIR);
log(`Fullscreen: ${FULLSCREEN} | Captions: ${SHOW_CAPTIONS}`);
log('═══════════════════════════════════════════════════');

// Force re-render of composed outputs each pass
for (const p of [SLIDESHOW_PATH, VOICE_MIX_PATH, BODY_PATH, FINAL_PATH]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

if (!fs.existsSync(SPACE_LIB_PATH)) {
  log(`\nERROR: Space image library not found: ${SPACE_LIB_PATH}`);
  process.exit(1);
}

// ── Step 0: Ensure intro-final.mp4 exists ──────────────────────────────────────
log('\n── Step 0: Ensure animated intro exists ──');
if (!fs.existsSync(INTRO_FINAL_PATH) || fs.statSync(INTRO_FINAL_PATH).size < 10000) {
  log('  Intro not found — building now (takes ~2 min first time)...');
  execSync(`node "${path.join(SCRIPTS_DIR, 'render-astronomer-intro.js')}"`, {
    stdio: 'inherit',
    cwd: PROJECT_ROOT,
    timeout: 300000,
  });
} else {
  const sz = Math.round(fs.statSync(INTRO_FINAL_PATH).size / 1024);
  log(`  ✓ intro-final.mp4 cached (${sz} KB): ${INTRO_FINAL_PATH}`);
}

// ── Step 1: Start Chatterbox server ──────────────────────────────────────────
log('\n── Step 1: Starting Chatterbox server ──');
const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
let serverProc = spawn(PYTHON_BIN, [serverScript], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CHATTERBOX_PORT: '4123' },
});
serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
serverProc.on('error', err => log('Chatterbox server error: ' + err.message));

log('  Waiting for model load...');
const serverReady = waitForChatterbox(300);

// ── Step 2: Script ────────────────────────────────────────────────────────────
log(`\n── Step 2: Script generation (space niche, ${DURATION_MIN} min) ──`);
const scriptJsonPath = path.join(SCRIPTS_DIR, SLUG + '.json');
let scenes;
if (fs.existsSync(scriptJsonPath)) {
  log('  Using cached script: ' + scriptJsonPath);
  scenes = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
} else {
  const result = await generateScript(TOPIC, {
    duration:      DURATION_MIN,
    output:        SCRIPTS_DIR,
    channelConfig: CHANNEL_CONFIG,
  });
  scenes = result.scenes;
  fs.writeFileSync(scriptJsonPath, JSON.stringify(scenes, null, 2));
}
const scriptText = scenes.map(s => s.narration).join('\n\n');
const wordCount  = scriptText.split(/\s+/).length;
const hasIntro   = scenes[0]?.subject === 'intro';
log(`  ${scenes.length} scenes, ${wordCount} words${hasIntro ? ' (incl. sleep intro)' : ''}`);

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

  for (let i = 0; i < sentences.length; i++) {
    const { text, paragraphEnd } = sentences[i];
    const partPath = path.join(SENTENCES_DIR, `s${String(i).padStart(3, '0')}.wav`);

    if (i > 0 && i % 25 === 0) {
      const healthy = await isHealthy();
      if (!healthy) await restartChatterbox();
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
const totalDuration = audioDuration + INTRO_SEC;

// ── Step 4: Whisper + sound-effect filter ────────────────────────────────────
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
const beforeFilter = wordTimestamps.length;
wordTimestamps = filterWhisperSoundEffects(wordTimestamps);
if (wordTimestamps.length < beforeFilter) {
  log(`  Filtered ${beforeFilter - wordTimestamps.length} sound-effect tokens`);
}

// ── Step 5: Director + space library image assignment ─────────────────────────
log('\n── Step 5: Director + space library image lookup ──');
const { clips } = await createStoryboard(scenes, wordTimestamps, audioDuration, {
  targetClipSec: 4,
  libraryPath:   SPACE_LIB_PATH,
});
for (const clip of clips) {
  if (clip.imagePath && !path.isAbsolute(clip.imagePath)) {
    clip.imagePath = path.join(PROJECT_ROOT, clip.imagePath);
  }
}
const assigned     = clips.filter(c => c.imagePath && fs.existsSync(c.imagePath)).length;
const subjectsUsed = [...new Set(clips.map(c => c.philosopher).filter(Boolean))];
log(`  ${clips.length} clips | ${assigned}/${clips.length} images from space library`);
log(`  Subjects: ${subjectsUsed.join(', ')}`);
for (const clip of clips.slice(0, 4)) {
  const img = clip.imagePath ? path.basename(clip.imagePath) : 'none';
  log(`    [${clip.index}] "${(clip.text||'').slice(0,45)}…" → ${img}`);
}

// ── Step 7: Background ────────────────────────────────────────────────────────
log('\n── Step 7: Background image ──');
if (FULLSCREEN) {
  log('  Fullscreen mode — no background image');
} else if (!fs.existsSync(BG_IMAGE_PATH)) {
  await generateSceneImage(BG_PROMPT, BG_IMAGE_PATH);
  log(`  Background: ${BG_IMAGE_PATH}`);
} else {
  log(`  Cached: ${BG_IMAGE_PATH}`);
}

// ── Step 9: ASS subtitles ─────────────────────────────────────────────────────
log('\n── Step 9: Subtitles ──');
if (!SHOW_CAPTIONS) {
  log('  Captions disabled — skipping');
} else {
  if (wordTimestamps.length > 0) {
    // No time offset — intro video is concatenated externally, ASS timestamps are relative to body
    generateASS(wordTimestamps, ASS_PATH, { timeOffsetSec: 0 });
    log(`  Generated: ${ASS_PATH}`);
  } else {
    log('  No timestamps — skipping');
  }
}

// ── Step 10: Atmosphere layers ────────────────────────────────────────────────
log('\n── Step 10: Atmosphere layers ──');
const particlesPath = await ensureParticleLoop();
log(`  Particles: ${particlesPath}`);
const smokePath = ensureSmokeLoop();
log(`  Smoke: ${smokePath}`);
const framePaths    = ensurePhilosophyFrameSet(path.join(PROJECT_ROOT, 'assets', 'frames'));
const selectedFrame = FULLSCREEN ? null : framePaths[0];
if (FULLSCREEN) log('  Frame: none (fullscreen mode)');

// ── Step 12: FFmpeg composition ───────────────────────────────────────────────
log('\n── Step 12: FFmpeg composition ──');

log('  Building clip slideshow...');
createClipSlideshow(clips, Math.ceil(audioDuration), SLIDESHOW_PATH, { fadeTime: 1.5 });

// NOTE: No intro sting in audio — the intro video carries its own sting audio.
// Mix raw voiceover (no sting prepended).
log('  Mixing audio (voice + fire + bgmusic — no sting)...');
mixAudio(VOICEOVER_PATH, Math.ceil(audioDuration), VOICE_MIX_PATH, {
  includeBgMusic:  true,
  bgMusicVolume:   '0.25',
  fireplaceVolume: '0.08',
});

// Compose body WITHOUT intro padding — body starts at t=0
log(`  Composing body video (no intro padding)...`);
composeFinalVideoWithBg({
  bgImagePath:    FULLSCREEN ? null : BG_IMAGE_PATH,
  slideshowPath:  SLIDESHOW_PATH,
  particlesPath,
  smokePath,
  assPath:        SHOW_CAPTIONS && fs.existsSync(ASS_PATH) ? ASS_PATH : null,
  voiceAudioPath: VOICE_MIX_PATH,
  bgMusicPath:    null,
  framePath:      selectedFrame,
  outputPath:     BODY_PATH,
  duration:       audioDuration,
  introDuration:  0,          // No black pad — intro video handles the opening
  fullscreen:     FULLSCREEN,
});
log(`  Body composed: ${BODY_PATH}`);

// Prepend animated intro to body
log(`  Prepending intro (${INTRO_SEC}s) to body...`);
prependIntroVideo(INTRO_FINAL_PATH, BODY_PATH, FINAL_PATH);
log(`  ✓ Final: ${FINAL_PATH}`);

// ── Step 13: Verification ─────────────────────────────────────────────────────
log('\n── Step 13: Verification ──');
const probeOutput = execSync(`ffprobe -v quiet -show_streams "${FINAL_PATH}"`, { encoding: 'utf-8' });
const videoStreams = (probeOutput.match(/codec_type=video/g) || []).length;
const audioStreams = (probeOutput.match(/codec_type=audio/g) || []).length;
log(`  Streams: ${videoStreams} video, ${audioStreams} audio`);
if (audioStreams === 1) log('  ✓ Single audio track (WMP-compatible)');

const actualDur = execSync(
  `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`,
  { encoding: 'utf-8' }
).trim();
log(`  Actual duration: ${parseFloat(actualDur).toFixed(1)}s (expected ~${totalDuration.toFixed(1)}s)`);

const frameTs = Math.min(4, totalDuration * 0.1);
execSync(
  `ffmpeg -y -ss ${frameTs.toFixed(1)} -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_30S_PATH}"`,
  { stdio: 'pipe' }
);
const frameOk = fs.existsSync(FRAME_30S_PATH) && fs.statSync(FRAME_30S_PATH).size > 5000;
log(`  Frame at ${frameTs.toFixed(1)}s (inside intro): ${frameOk ? '✓' : 'FAILED'}`);

try {
  // Frame from inside the body content
  const bodyTs = INTRO_SEC + 5;
  execSync(`ffmpeg -y -ss ${bodyTs} -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_IMG_PATH}"`, { stdio: 'pipe' });
  log(`  Frame at ${bodyTs}s (body content): ${FRAME_IMG_PATH}`);
} catch {}

try {
  const volOut = execSync(`ffmpeg -y -i "${FINAL_PATH}" -t 5 -af "volumedetect" -f null NUL 2>&1`, { encoding: 'utf-8' });
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

log('\n═══════════════════════════════════════════════════');
log('✅ DONE — Astronomer intro test');
log(`   Intro:         ${INTRO_FINAL_PATH}`);
log(`   Final:         ${FINAL_PATH}`);
log(`   Duration:      ${totalDuration.toFixed(1)}s (${(totalDuration/60).toFixed(2)} min)`);
log(`   Clips:         ${clips.length} @ ~4s each`);
log(`   Audio:         ${audioStreams} stream`);
log(`   File size:     ${finalSize} MB`);
log(`   Pipeline:      ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
log(`   Frame (intro): ${FRAME_30S_PATH}`);
log(`   Frame (body):  ${FRAME_IMG_PATH}`);
log('═══════════════════════════════════════════════════');

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
  serverProc = spawn(PYTHON_BIN, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CHATTERBOX_PORT: '4123' },
  });
  serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
  serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
  const ok = await waitForChatterbox(120);
  if (ok) log('  [TTS] Chatterbox restarted ✓');
  else    log('  [TTS] WARNING: Chatterbox did not recover');
  return ok;
}

async function chatterboxTTSWithRetry(text, outputPath, maxAttempts = 3) {
  const silence2s = path.join(ASSETS_DIR, '_silence-2000.wav');
  ensureSilence(silence2s, 2000);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        const healthy = await isHealthy();
        if (!healthy) await restartChatterbox();
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
      await chatterboxTTS(text, outputPath);
      return;
    } catch (err) {
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
    const words = paras[pi].split(' ');
    let buf = '';
    for (let wi = 0; wi < words.length; wi++) {
      buf += (buf ? ' ' : '') + words[wi];
      const endsWithPunct = /[.!?…]["']?$/.test(words[wi]);
      const nextWord      = words[wi + 1] || '';
      const nextIsCapital = /^[A-Z"']/.test(nextWord);
      const isAbbr        = ABBR.test(words[wi].replace(/[.!?]$/, ''));
      if (endsWithPunct && nextIsCapital && !isAbbr && buf.split(' ').length >= 3) {
        out.push({ text: buf.trim(), paragraphEnd: wi === words.length - 1 && pi < paras.length - 1 });
        buf = '';
      }
    }
    if (buf.trim()) {
      out.push({ text: buf.trim(), paragraphEnd: pi < paras.length - 1 });
    }
  }
  return out;
}

function ensureSilence(outputPath, durationMs) {
  if (fs.existsSync(outputPath)) return;
  const d = (durationMs / 1000).toFixed(3);
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 ` +
    `-t ${d} -c:a pcm_s16le "${outputPath}"`,
    { stdio: 'pipe' }
  );
}
