/**
 * SleepForge 5-minute test video — Polish Pass 2 (May 2026)
 *
 * Full pipeline end-to-end:
 *   1. Start Chatterbox server (Python, CUDA)
 *   2. Generate 5-min script via Claude Haiku (cached)
 *   3. TTS all sentences via Chatterbox archer voice (cached)
 *   4. Whisper word timestamps (cached)
 *   5. Director: sentence → 4s clip windows
 *   6. Generate 3 chalk images per scene via Flux Schnell (~24 images, cached)
 *   7. Assign images to clips (round-robin per scene)
 *   8. ASS karaoke subtitles (natural phrase breaks, \kf word highlight)
 *   9. Fireplace particles loop (FFmpeg geq, cached)
 *  10. Smoke loop (FFmpeg lavfi, cached)
 *  11. FFmpeg compose:
 *        - createClipSlideshow: Ken Burns zoom + 1.5s crossfades per clip
 *        - mixAudio: voice + bgmusic(12%) + fireplace(6%) + crickets(5%), sidechain duck
 *        - composeVideo: slideshow → particles (screen) → smoke (screen) → ASS subs
 *
 * Usage: node scripts/test-video-5min.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

import { generateScript, craftImagePrompt } from '../src/script-generator.js';
import { generateSceneImage } from '../src/fal.js';
import { generateASS } from '../src/subtitles.js';
import { buildTimedClips } from '../src/director.js';
import {
  createClipSlideshow,
  mixAudio,
  ensureSmokeLoop,
  ensureParticleLoopLegacy,
  getAudioDuration,
} from '../src/ffmpeg.js';
import { isHealthy, chatterboxTTS } from '../src/chatterbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_BIN = process.env.PYTHON_BIN
  || path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');

const TOPIC = 'Marcus Aurelius on Letting Go of What You Cannot Control';
const DURATION_MIN = 5;
const SLUG = 'marcus-aurelius-letting-go';
const OUTPUT_DIR   = path.join(PROJECT_ROOT, 'output', SLUG);
const ASSETS_DIR   = path.join(OUTPUT_DIR, 'assets');
const IMAGES_DIR   = path.join(OUTPUT_DIR, 'images');
const SENTENCES_DIR = path.join(ASSETS_DIR, 'sentences');
const SCRIPTS_DIR  = path.join(PROJECT_ROOT, 'scripts');

const VOICEOVER_PATH  = path.join(ASSETS_DIR, 'voiceover.wav');
const WHISPER_PATH    = path.join(ASSETS_DIR, 'whisper.json');
const ASS_PATH        = path.join(ASSETS_DIR, 'subtitles.ass');
const SLIDESHOW_PATH  = path.join(OUTPUT_DIR, 'slideshow.mp4');
const AUDIO_MIX_PATH  = path.join(OUTPUT_DIR, 'mixed-audio.m4a');
const FINAL_PATH      = path.join(OUTPUT_DIR, 'final.mp4');

const IMGS_PER_SCENE = 3; // generate 3 Flux images per scene → 24 total for 8 scenes

for (const d of [OUTPUT_DIR, ASSETS_DIR, IMAGES_DIR, SENTENCES_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const t_pipeline = Date.now();
log('═══════════════════════════════════════════');
log('SleepForge — 5-minute test video (polish pass 2)');
log('Topic: ' + TOPIC);
log('Output: ' + OUTPUT_DIR);
log('═══════════════════════════════════════════');

// ── Step 1: Start Chatterbox server ──────────────────────────────────────────
log('\n── Step 1: Starting Chatterbox server ──');
const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
const serverProc = spawn(PYTHON_BIN, [serverScript], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CHATTERBOX_PORT: '4123' },
});
serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
serverProc.on('error', err => { log('Chatterbox server error: ' + err.message); });

log('  Waiting for model load...');
const serverReady = waitForChatterbox(300);

// ── Step 2: Script (runs while Chatterbox loads) ───────────────────────────
log('\n── Step 2: Script generation (Haiku, 5 min) ──');
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
const wordCount = scriptText.split(/\s+/).length;
log(`  ${scenes.length} scenes, ${wordCount} words (~${Math.round(wordCount / 110)} min)`);

// ── Step 3: Voiceover ────────────────────────────────────────────────────────
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

    if (!fs.existsSync(partPath)) {
      const t0 = Date.now();
      await chatterboxTTS(text, partPath);
      const elapsed = (Date.now() - t0) / 1000;
      const dur = getAudioDuration(partPath);
      ttsStats.totalAudio += dur;
      ttsStats.totalElapsed += elapsed;
      ttsStats.count++;
      const pct = Math.round(100 * (i + 1) / sentences.length);
      log(`  [${i+1}/${sentences.length}] ${pct}% — ${elapsed.toFixed(1)}s to gen ${dur.toFixed(1)}s audio (${(elapsed/dur).toFixed(2)}x RT)`);
    }

    partPaths.push(partPath);
    if (i < sentences.length - 1) {
      partPaths.push(paragraphEnd ? silence700 : silence350);
    }
  }

  if (ttsStats.count > 0) {
    const rt = (ttsStats.totalElapsed / ttsStats.totalAudio).toFixed(2);
    log(`\n  ◆ Chatterbox speed: ${rt}x realtime on RTX 3060`);
    log(`    Total audio: ${ttsStats.totalAudio.toFixed(1)}s  Inference: ${ttsStats.totalElapsed.toFixed(1)}s`);
  }

  log('\n  Concatenating sentences...');
  const concatFile = path.join(ASSETS_DIR, '_concat.txt');
  fs.writeFileSync(concatFile, partPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${VOICEOVER_PATH}"`,
    { stdio: 'pipe' });
  fs.unlinkSync(concatFile);
  log(`  Voiceover: ${getAudioDuration(VOICEOVER_PATH).toFixed(1)}s`);
}
const audioDuration = getAudioDuration(VOICEOVER_PATH);

// ── Step 4: Whisper timestamps ───────────────────────────────────────────────
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

// ── Step 5: Director — sentence-aligned 4s clip windows ─────────────────────
log('\n── Step 5: Director — building clip windows ──');
const clips = buildTimedClips(scenes, wordTimestamps, audioDuration, 4);
log(`  ${clips.length} clips at ~4s each covering ${audioDuration.toFixed(1)}s audio`);

// ── Step 6: Images — 3 per scene via Flux Schnell ───────────────────────────
log('\n── Step 6: Chalk image generation (Flux Schnell, 3/scene) ──');
const totalImages = scenes.length * IMGS_PER_SCENE;
const allImagePaths = [];
const imgJobs = [];

for (let si = 0; si < scenes.length; si++) {
  for (let vi = 0; vi < IMGS_PER_SCENE; vi++) {
    const idx = si * IMGS_PER_SCENE + vi;
    const imgPath = path.join(IMAGES_DIR, `scene-${String(si+1).padStart(3,'0')}-v${vi}.png`);
    allImagePaths.push(imgPath);
    if (!fs.existsSync(imgPath)) {
      const prompt = craftImagePrompt(scenes[si], vi);
      imgJobs.push({ idx, si, vi, imgPath, prompt });
    }
  }
}
log(`  ${totalImages - imgJobs.length} cached, ${imgJobs.length} to generate`);

const IMG_CONCURRENCY = 6;
let imgJobIdx = 0, imgDone = 0;
async function imgWorker() {
  while (true) {
    const j = imgJobs[imgJobIdx++];
    if (!j) return;
    try {
      await generateSceneImage(j.prompt, j.imgPath);
      imgDone++;
      log(`  [${imgDone}/${imgJobs.length}] scene-${j.si+1}-v${j.vi}.png`);
    } catch (err) {
      log(`  [img scene-${j.si+1}-v${j.vi}] FAILED: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: IMG_CONCURRENCY }, imgWorker));
log(`  Images done: ${allImagePaths.filter(p => fs.existsSync(p)).length}/${totalImages}`);

// ── Step 7: Assign images to clips ──────────────────────────────────────────
log('\n── Step 7: Assigning images to clips ──');
const sceneDuration = audioDuration / scenes.length;

for (const clip of clips) {
  const clipMid = (clip.start_time + clip.end_time) / 2;
  const sceneIdx = Math.min(scenes.length - 1, Math.floor(clipMid / sceneDuration));
  // Track which image variation to use for this scene (cycle through variants)
  if (!clip._sceneImageCounter) clip._sceneImageCounter = 0;
}

// Count clips per scene to distribute variants evenly
const clipsPerScene = new Array(scenes.length).fill(0);
const clipSceneIdx = clips.map(clip => {
  const mid = (clip.start_time + clip.end_time) / 2;
  return Math.min(scenes.length - 1, Math.floor(mid / sceneDuration));
});
const sceneClipCounters = new Array(scenes.length).fill(0);

for (let ci = 0; ci < clips.length; ci++) {
  const si = clipSceneIdx[ci];
  const variantIdx = sceneClipCounters[si] % IMGS_PER_SCENE;
  const imgPath = allImagePaths[si * IMGS_PER_SCENE + variantIdx];
  clips[ci].imagePath = fs.existsSync(imgPath) ? imgPath : null;
  sceneClipCounters[si]++;
}

// Fallback: if any clip has no image, use the nearest valid image
const firstValidImg = allImagePaths.find(p => fs.existsSync(p));
for (const clip of clips) {
  if (!clip.imagePath) clip.imagePath = firstValidImg;
}

const assignedCount = clips.filter(c => c.imagePath).length;
log(`  Assigned: ${assignedCount}/${clips.length} clips have images`);

// ── Step 8: ASS karaoke subtitles ────────────────────────────────────────────
log('\n── Step 8: ASS karaoke subtitles (natural phrase breaks) ──');
if (!fs.existsSync(ASS_PATH)) {
  if (wordTimestamps.length > 0) {
    generateASS(wordTimestamps, ASS_PATH);
    log(`  Generated: ${ASS_PATH}`);
  } else {
    log('  No word timestamps — skipping subtitles');
  }
} else {
  log(`  Cached: ${ASS_PATH}`);
}

// ── Step 9: Particles + Smoke ────────────────────────────────────────────────
log('\n── Step 9: Generating atmosphere layers ──');
const particlesPath = ensureParticleLoopLegacy();
log(`  Particles: ${particlesPath}`);
const smokePath = ensureSmokeLoop();
log(`  Smoke: ${smokePath}`);

// ── Step 10: FFmpeg compose ───────────────────────────────────────────────────
log('\n── Step 10: FFmpeg composition ──');

// 10a: Clip slideshow — Ken Burns zoom + 1.5s crossfades
log('  Creating clip slideshow (Ken Burns + 1.5s crossfades)...');
const usableClips = clips.filter(c => c.imagePath);
createClipSlideshow(usableClips, Math.ceil(audioDuration), SLIDESHOW_PATH, { fadeTime: 1.5 });

// 10b: Audio mix — voice + bgmusic(18%) + fireplace(6%) + crickets(5%), gentle sidechain duck
log('  Mixing audio with bgmusic + sidechain ducking...');
mixAudio(VOICEOVER_PATH, Math.ceil(audioDuration), AUDIO_MIX_PATH);

// 10c: Final compose — slideshow → particles (screen) → smoke (screen) → ASS subs
log('  Composing final video...');
const hasAss = fs.existsSync(ASS_PATH);
const assFilter = hasAss
  ? `,ass='${ASS_PATH.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
  : '';

execSync(
  `ffmpeg -y ` +
  `-i "${SLIDESHOW_PATH}" ` +
  `-stream_loop -1 -i "${particlesPath}" ` +
  `-stream_loop -1 -i "${smokePath}" ` +
  `-i "${AUDIO_MIX_PATH}" ` +
  `-filter_complex ` +
    `"[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30,format=gbrp[base];` +
     `[1:v]scale=1920:1080,setsar=1,fps=30,format=gbrp[parts];` +
     `[base][parts]blend=all_mode=screen:shortest=0[withParts];` +
     `[2:v]scale=1920:1080,setsar=1,fps=30,format=gbrp[smoke];` +
     `[withParts][smoke]blend=all_mode=screen:shortest=0,format=yuv420p${assFilter}[v]" ` +
  `-map "[v]" -map 3:a ` +
  `-c:v libx264 -preset fast -crf 22 -c:a copy ` +
  `-t ${Math.ceil(audioDuration)} -movflags +faststart "${FINAL_PATH}"`,
  { stdio: 'pipe', timeout: 1800000 }
);

const finalSize = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);
const elapsed   = Math.round((Date.now() - t_pipeline) / 1000);

log('\n═══════════════════════════════════════════');
log('✅ DONE');
log(`   Video: ${FINAL_PATH}`);
log(`   Duration: ${audioDuration.toFixed(1)}s (${(audioDuration/60).toFixed(2)} min)`);
log(`   Clips: ${clips.length} @ ~4s each`);
log(`   Images: ${totalImages} Flux Schnell (${IMGS_PER_SCENE}/scene)`);
log(`   File size: ${finalSize} MB`);
log(`   Total pipeline time: ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
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

function splitSentences(text) {
  const ABBR = /^(Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|etc|Inc|Co|Ltd|B\.C|A\.D|i\.e|e\.g)$/i;
  const paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const out = [];
  for (let pi = 0; pi < paras.length; pi++) {
    const parts = paras[pi].replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/);
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
