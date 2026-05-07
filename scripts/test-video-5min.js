/**
 * SleepForge 5-minute test video
 *
 * Full pipeline end-to-end:
 *   1. Start Chatterbox server (Python, CUDA)
 *   2. Generate 5-min script via Claude Haiku
 *   3. TTS all sentences via Chatterbox archer voice
 *   4. Whisper word timestamps
 *   5. Generate ~40 chalk images via Flux Schnell (concurrent with TTS)
 *   6. ASS karaoke subtitles
 *   7. FFmpeg compose (slideshow + audio mix + smoke overlay + subs)
 *
 * Usage: node scripts/test-video-5min.js
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync, execFileSync } from 'child_process';

import { generateScript, craftImagePrompt } from '../src/script-generator.js';
import { generateSceneImage } from '../src/fal.js';
import { generateASS } from '../src/subtitles.js';
import { createImageSlideshow, mixAudio, ensureSmokeLoop, getAudioDuration } from '../src/ffmpeg.js';
import { isHealthy, chatterboxTTS } from '../src/chatterbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_BIN = process.env.PYTHON_BIN
  || path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');

const TOPIC = 'Marcus Aurelius on Letting Go of What You Cannot Control';
const DURATION_MIN = 5;
const SLUG = 'marcus-aurelius-letting-go';
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output', SLUG);
const ASSETS_DIR = path.join(OUTPUT_DIR, 'assets');
const IMAGES_DIR = path.join(OUTPUT_DIR, 'images');
const SENTENCES_DIR = path.join(ASSETS_DIR, 'sentences');
const SCRIPTS_DIR = path.join(PROJECT_ROOT, 'scripts');

const VOICEOVER_PATH = path.join(ASSETS_DIR, 'voiceover.wav');
const WHISPER_PATH   = path.join(ASSETS_DIR, 'whisper.json');
const ASS_PATH       = path.join(ASSETS_DIR, 'subtitles.ass');
const SLIDESHOW_PATH = path.join(OUTPUT_DIR, 'slideshow.mp4');
const AUDIO_MIX_PATH = path.join(OUTPUT_DIR, 'mixed-audio.m4a');
const FINAL_PATH     = path.join(OUTPUT_DIR, 'final.mp4');

for (const d of [OUTPUT_DIR, ASSETS_DIR, IMAGES_DIR, SENTENCES_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const t_pipeline = Date.now();
log('═══════════════════════════════════════════');
log('SleepForge — 5-minute test video');
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

// Wait for server to be healthy (polls every 2s, up to 120s for model load)
log('  Waiting for model load...');
const serverReady = waitForChatterbox(300);

// ── Step 2: Script (runs while Chatterbox loads) ──────────────────────────────
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

// ── Step 3: Voiceover ─────────────────────────────────────────────────────────
log('\n── Step 3: Chatterbox TTS (archer voice) ──');
if (fs.existsSync(VOICEOVER_PATH)) {
  const dur = getAudioDuration(VOICEOVER_PATH);
  log(`  Cached voiceover: ${dur.toFixed(1)}s`);
} else {
  // Wait for Chatterbox to be ready now that we need it
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
  const SENTENCE_PAUSE_MS = 350;
  const PARA_PAUSE_MS = 700;

  // Generate silence WAVs for pauses (cached)
  const silence350 = path.join(ASSETS_DIR, '_silence-350.wav');
  const silence700 = path.join(ASSETS_DIR, '_silence-700.wav');
  ensureSilence(silence350, 350);
  ensureSilence(silence700, 700);

  // Sequential TTS (Chatterbox serializes internally, but we also respect that)
  for (let i = 0; i < sentences.length; i++) {
    const { text, paragraphEnd } = sentences[i];
    const partPath = path.join(SENTENCES_DIR, `s${String(i).padStart(3,'0')}.wav`);

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

  // TTS speed summary
  if (ttsStats.count > 0) {
    const overallRT = (ttsStats.totalElapsed / ttsStats.totalAudio).toFixed(2);
    log(`\n  ◆ Chatterbox speed: ${overallRT}x realtime on RTX 3060`);
    log(`    Total audio generated: ${ttsStats.totalAudio.toFixed(1)}s`);
    log(`    Total inference time: ${ttsStats.totalElapsed.toFixed(1)}s`);
  }

  // Concatenate sentence WAVs
  log('\n  Concatenating sentences...');
  const concatFile = path.join(ASSETS_DIR, '_concat.txt');
  fs.writeFileSync(concatFile, partPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${VOICEOVER_PATH}"`,
    { stdio: 'pipe' });
  fs.unlinkSync(concatFile);
  log(`  Voiceover: ${getAudioDuration(VOICEOVER_PATH).toFixed(1)}s`);
}
const audioDuration = getAudioDuration(VOICEOVER_PATH);

// ── Step 4: Whisper timestamps ────────────────────────────────────────────────
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
      `print(json.dumps(words))" `,
    { encoding: 'utf-8', timeout: 300000 }
  );
  wordTimestamps = JSON.parse(whisperResult.trim());
  fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTimestamps));
  log(`  ${wordTimestamps.length} words in ${((Date.now()-t0)/1000).toFixed(0)}s`);
}

// ── Step 5: Images (up to 40 via Flux Schnell) ────────────────────────────────
log('\n── Step 5: Chalk image generation (Flux Schnell) ──');
const imageCount = Math.min(40, scenes.length);
const imagePaths = [];
const imgJobs = [];

for (let i = 0; i < imageCount; i++) {
  const imgPath = path.join(IMAGES_DIR, `scene-${String(i+1).padStart(3,'0')}.png`);
  imagePaths.push(imgPath);
  if (fs.existsSync(imgPath)) continue;
  const scene = scenes[i % scenes.length];
  const prompt = craftImagePrompt(scene);
  imgJobs.push({ i, imgPath, prompt });
}

log(`  ${imageCount - imgJobs.length} cached, ${imgJobs.length} to generate`);

// Generate images with concurrency 6
const IMG_CONCURRENCY = 6;
let imgJobIdx = 0, imgDone = 0;
async function imgWorker() {
  while (true) {
    const j = imgJobs[imgJobIdx++];
    if (!j) return;
    try {
      await generateSceneImage(j.prompt, j.imgPath);
      imgDone++;
      log(`  [${imgDone}/${imgJobs.length}] scene-${j.i+1}.png`);
    } catch (err) {
      log(`  [img ${j.i+1}] FAILED: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: IMG_CONCURRENCY }, imgWorker));
log(`  Images done: ${imagePaths.filter(p => fs.existsSync(p)).length}/${imageCount}`);

// Filter to existing images
const existingImages = imagePaths.filter(p => fs.existsSync(p));

// ── Step 6: ASS subtitles ─────────────────────────────────────────────────────
log('\n── Step 6: ASS karaoke subtitles ──');
if (!fs.existsSync(ASS_PATH) || wordTimestamps.length === 0) {
  if (wordTimestamps.length > 0) {
    generateASS(wordTimestamps, ASS_PATH);
    log(`  Generated: ${ASS_PATH}`);
  } else {
    log('  No word timestamps — skipping subtitles');
  }
} else {
  log(`  Cached: ${ASS_PATH}`);
}

// ── Step 7: FFmpeg compose ────────────────────────────────────────────────────
log('\n── Step 7: FFmpeg composition ──');

// 7a: Slideshow
log('  Creating image slideshow...');
createImageSlideshow(existingImages, Math.ceil(audioDuration), SLIDESHOW_PATH);

// 7b: Audio mix (voice + fireplace + crickets)
log('  Mixing audio...');
mixAudio(VOICEOVER_PATH, Math.ceil(audioDuration), AUDIO_MIX_PATH);

// 7c: Smoke overlay (auto-generated via FFmpeg, cached)
log('  Ensuring smoke loop...');
const smokePath = ensureSmokeLoop();

// 7d: Final compose (slideshow + smoke screen-blend + audio + ASS subs)
log('  Composing final video...');
const hasAss = fs.existsSync(ASS_PATH);
const assFilter = hasAss ? `,ass='${ASS_PATH.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}'` : '';
execSync(
  `ffmpeg -y ` +
  `-i "${SLIDESHOW_PATH}" ` +
  `-stream_loop -1 -i "${smokePath}" ` +
  `-i "${AUDIO_MIX_PATH}" ` +
  `-filter_complex ` +
    `"[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30,format=gbrp[base];` +
     `[1:v]scale=1920:1080,setsar=1,fps=30,format=gbrp[smoke];` +
     `[base][smoke]blend=all_mode=screen:shortest=0,format=yuv420p${assFilter}[v]" ` +
  `-map "[v]" -map 2:a ` +
  `-c:v libx264 -preset fast -crf 22 -c:a copy ` +
  `-t ${Math.ceil(audioDuration)} -movflags +faststart "${FINAL_PATH}"`,
  { stdio: 'pipe', timeout: 1800000 }
);

const finalSize = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);
const elapsed = Math.round((Date.now() - t_pipeline) / 1000);

log('\n═══════════════════════════════════════════');
log('✅ DONE');
log(`   Video: ${FINAL_PATH}`);
log(`   Duration: ${audioDuration.toFixed(1)}s (${(audioDuration/60).toFixed(2)} min)`);
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
