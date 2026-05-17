/**
 * astronomer-overnight.js — 5 Sleepless Astronomer videos, batch render + upload
 *
 * Runs fully unattended. Topics are processed sequentially.
 * Fatal errors per video are logged to data/astronomer-batch-fatal-N-<ts>.md
 * and the batch continues to the next video.
 *
 * Schedule:
 *   Video 1 — PUBLIC immediately
 *   Videos 2-5 — PRIVATE, scheduled 08:00 Bangkok (UTC+7) = 01:00 UTC on days +1/+2/+3/+4
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

import { generateScript }                                from '../src/script-generator.js';
import { analyzeAndRewrite }                             from '../src/script-analyzer.js';
import {
  generateAstronomerTitleCandidates,
  generateMetadata,
} from '../src/youtube-metadata-generator.js';
import { filterWhisperSoundEffects }                     from '../src/subtitles.js';
import { createStoryboard }                              from '../src/director.js';
import {
  createClipSlideshow, mixAudio,
  ensureSmokeLoop, ensureParticleLoop,
  composeFinalVideoWithBg, getAudioDuration, prependIntroVideo,
} from '../src/ffmpeg.js';
import { isHealthy, chatterboxTTS, resetHealthCache }    from '../src/chatterbox.js';
import { generateThumbnailV3, closeBrowser }             from '../src/thumbnail-v3.js';
import { uploadVideo }                                   from '../src/youtube.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_BIN   = process.env.PYTHON_BIN
  || path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');
const SCRIPTS_DIR  = path.join(PROJECT_ROOT, 'scripts');

const CHANNEL_CONFIG = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8')
);
const INTRO_FINAL_PATH = path.join(PROJECT_ROOT, CHANNEL_CONFIG.intro_video_path);

// ─── Topics ──────────────────────────────────────────────────────────────────

const TOPICS = [
  {
    title: "What's Inside a Black Hole: An Hour of Deep Space Wonder",
    angle: "Event horizons, singularities, spaghettification, Hawking radiation — what we know and what remains mystery",
  },
  {
    title: "The James Webb Space Telescope's Most Astounding Discoveries",
    angle: "JWST's first year of images — deep field, exoplanet atmospheres, the earliest galaxies, and how it rewrote our timeline of the universe",
  },
  {
    title: "Neutron Stars: The Densest Objects You Can Actually Touch",
    angle: "A teaspoon weighs a billion tons. Pulsars, magnetars, and the physics of collapsed stellar cores",
  },
  {
    title: "The Andromeda Collision: When Our Galaxy Merges in 4 Billion Years",
    angle: "The slow-motion collision already in progress — what it will look like, what survives, and why most stars never actually collide",
  },
  {
    title: "UY Scuti and the Largest Stars Ever Discovered",
    angle: "Hypergiant stars so vast our sun is invisible inside them — stellar lifecycles, supernovae, and the scale that makes distances meaningless",
  },
];

// ─── Scheduling ──────────────────────────────────────────────────────────────

function bangkokSchedule(daysAhead) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(1, 0, 0, 0); // 08:00 Bangkok = 01:00 UTC
  return d;
}

// ─── Disk space ───────────────────────────────────────────────────────────────

function getFreeDiskGB() {
  try {
    const stat = fs.statfsSync(PROJECT_ROOT);
    return (stat.bfree * stat.bsize) / 1e9;
  } catch {
    return Infinity;
  }
}

function cleanOldestOutputDir() {
  const outputDir = path.join(PROJECT_ROOT, 'output');
  if (!fs.existsSync(outputDir)) return;
  const entries = fs.readdirSync(outputDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => {
      const p = path.join(outputDir, e.name);
      return { name: e.name, path: p, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
  if (entries.length > 0) {
    console.log(`  [disk] Removing oldest output dir: ${entries[0].name}`);
    fs.rmSync(entries[0].path, { recursive: true, force: true });
  }
}

// ─── Chatterbox server ────────────────────────────────────────────────────────

let serverProc = null;

function startChatterboxServer() {
  const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
  serverProc = spawn(PYTHON_BIN, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CHATTERBOX_PORT: '4123' },
  });
  serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
  serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
  serverProc.on('exit', code => {
    if (code !== null && code !== 0) console.log(`[CB] Server exited with code ${code}`);
  });
}

async function waitForChatterbox(timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function restartChatterboxServer() {
  console.log('  [CB] Restarting Chatterbox server...');
  try { serverProc?.kill('SIGKILL'); } catch {}
  resetHealthCache();
  await new Promise(r => setTimeout(r, 3000));
  startChatterboxServer();
  const ok = await waitForChatterbox(120);
  if (ok) console.log('  [CB] Server restarted ✓');
  else    console.log('  [CB] Server restart FAILED');
  return ok;
}

// ─── TTS with 60s timeout + retry ────────────────────────────────────────────

async function ttsSentence(text, outputPath) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; reject(new Error('TTS timed out after 60s')); }
    }, 60000);
    chatterboxTTS(text, outputPath)
      .then(() => { if (!done) { done = true; clearTimeout(timer); resolve(); } })
      .catch(err => { if (!done) { done = true; clearTimeout(timer); reject(err); } });
  });
}

async function ttsWithRetry(text, outputPath, silenceDir, maxAttempts = 3) {
  const sil2s = path.join(silenceDir, '_silence-2000.wav');
  if (!fs.existsSync(sil2s)) {
    execSync(`ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 2.000 -c:a pcm_s16le "${sil2s}"`, { stdio: 'pipe' });
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        await restartChatterboxServer();
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
      await ttsSentence(text, outputPath);
      return;
    } catch (err) {
      console.log(`  [TTS] Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
  }
  console.log(`  [TTS] All attempts failed — using 2s silence for: "${text.slice(0, 50)}..."`);
  fs.copyFileSync(sil2s, outputPath);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function topicToSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function splitSentences(text) {
  const ABBR = /^(Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|etc|Inc|Co|Ltd|B\.C|A\.D|i\.e|e\.g)$/i;
  const paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const out = [];
  for (let pi = 0; pi < paras.length; pi++) {
    const words = paras[pi].split(' ');
    let buf = '';
    for (let wi = 0; wi < words.length; wi++) {
      buf += (buf ? ' ' : '') + words[wi];
      const endsWithPunct  = /[.!?…]["']?$/.test(words[wi]);
      const nextWord       = words[wi + 1] || '';
      const nextIsCapital  = /^[A-Z"']/.test(nextWord);
      const isAbbr         = ABBR.test(words[wi].replace(/[.!?]$/, ''));
      if (endsWithPunct && nextIsCapital && !isAbbr && buf.split(' ').length >= 3) {
        out.push({ text: buf.trim(), paragraphEnd: wi === words.length - 1 && pi < paras.length - 1 });
        buf = '';
      }
    }
    if (buf.trim()) out.push({ text: buf.trim(), paragraphEnd: pi < paras.length - 1 });
  }
  return out;
}

function ensureSilence(outputPath, durationMs) {
  if (fs.existsSync(outputPath)) return;
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${(durationMs / 1000).toFixed(3)} -c:a pcm_s16le "${outputPath}"`,
    { stdio: 'pipe' }
  );
}

// ─── Per-video pipeline ───────────────────────────────────────────────────────

async function renderAndUpload(topicObj, videoIndex) {
  const { title: topicTitle, angle } = topicObj;
  const slug = topicToSlug(topicTitle);

  const OUTPUT_DIR    = path.join(PROJECT_ROOT, 'output', slug);
  const ASSETS_DIR    = path.join(OUTPUT_DIR, 'assets');
  const SENTENCES_DIR = path.join(ASSETS_DIR, 'sentences');
  const THUMB_DIR     = path.join(OUTPUT_DIR, 'thumbnail');

  const VOICEOVER_PATH = path.join(ASSETS_DIR, 'voiceover.wav');
  const WHISPER_PATH   = path.join(ASSETS_DIR, 'whisper.json');
  const SLIDESHOW_PATH = path.join(OUTPUT_DIR, 'slideshow.mp4');
  const VOICE_MIX_PATH = path.join(OUTPUT_DIR, 'voice-mix.m4a');
  const BODY_PATH      = path.join(OUTPUT_DIR, 'body.mp4');
  const FINAL_PATH     = path.join(OUTPUT_DIR, 'final.mp4');
  const FINAL_SCENES_PATH = path.join(OUTPUT_DIR, 'final-scenes.json');
  const TITLE_CACHE    = path.join(OUTPUT_DIR, 'title-candidates.json');

  const t0      = Date.now();
  const elapsed = () => Math.round((Date.now() - t0) / 1000);

  // Disk check
  const freeGB = getFreeDiskGB();
  console.log(`  [disk] Free: ${freeGB.toFixed(1)} GB`);
  if (freeGB < 5) {
    console.log('  [disk] < 5 GB — cleaning oldest output dir');
    cleanOldestOutputDir();
  }

  for (const d of [OUTPUT_DIR, ASSETS_DIR, SENTENCES_DIR, THUMB_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // ── Step 1: Title candidates ─────────────────────────────────────────────
  console.log('\n── Step 1: Title candidates ──');
  let titleResult;
  if (fs.existsSync(TITLE_CACHE)) {
    titleResult = JSON.parse(fs.readFileSync(TITLE_CACHE, 'utf-8'));
    console.log(`  Cached: "${titleResult.winner}"`);
  } else {
    titleResult = await generateAstronomerTitleCandidates(topicObj, CHANNEL_CONFIG);
    fs.writeFileSync(TITLE_CACHE, JSON.stringify(titleResult, null, 2));
    console.log(`  Winner: "${titleResult.winner}"`);
    if (titleResult.reason) console.log(`  Reason: ${titleResult.reason}`);
  }
  const VIDEO_TITLE = titleResult.winner;

  // ── Step 2: Script generation ────────────────────────────────────────────
  console.log('\n── Step 2: Script generation (60 min) ──');
  // Check both raw cache paths (batch-raw takes priority, then prior generateScript output)
  const rawCachePath = path.join(SCRIPTS_DIR, `${slug}-batch-raw.json`);
  const priorRawPath = path.join(SCRIPTS_DIR, `${slug}.json`);
  let rawScenes;

  if (fs.existsSync(rawCachePath)) {
    rawScenes = JSON.parse(fs.readFileSync(rawCachePath, 'utf-8'));
    console.log(`  Cached raw (${rawCachePath.split('\\').pop()}): ${rawScenes.length} scenes`);
  } else if (fs.existsSync(priorRawPath)) {
    rawScenes = JSON.parse(fs.readFileSync(priorRawPath, 'utf-8'));
    console.log(`  Using prior script (${priorRawPath.split('\\').pop()}): ${rawScenes.length} scenes`);
    // Copy to batch-raw so we know this was used as raw input
    fs.writeFileSync(rawCachePath, JSON.stringify(rawScenes, null, 2));
  } else {
    console.log('  Generating 9000-word script...');
    const result = await generateScript(topicTitle, {
      duration:      60,
      output:        SCRIPTS_DIR,
      channelConfig: CHANNEL_CONFIG,
    });
    rawScenes = result.scenes;
    fs.writeFileSync(rawCachePath, JSON.stringify(rawScenes, null, 2));
  }
  const rawWords = rawScenes.map(s => s.narration).join(' ').split(/\s+/).length;
  console.log(`  Raw: ${rawScenes.length} scenes, ${rawWords} words`);

  // ── Step 3: Analyze + rewrite ────────────────────────────────────────────
  console.log('\n── Step 3: Analyze + rewrite (target ≥ 8.0) ──');
  let finalScenes, bestScore;
  if (fs.existsSync(FINAL_SCENES_PATH)) {
    finalScenes = JSON.parse(fs.readFileSync(FINAL_SCENES_PATH, 'utf-8'));
    bestScore   = 'cached';
    console.log(`  Cached: ${finalScenes.length} scenes`);
  } else {
    const { finalScenes: fs2, history } = await analyzeAndRewrite(rawScenes, CHANNEL_CONFIG, {
      topicSlug:     slug,
      maxIterations: 5,
      targetScore:   8.0,
      saveIterations: true,
    });
    finalScenes = fs2;
    bestScore   = history.reduce((a, b) => (a.score >= b.score ? a : b)).score;
    console.log(`  Best score: ${bestScore}/10`);
    fs.writeFileSync(FINAL_SCENES_PATH, JSON.stringify(finalScenes, null, 2));
  }

  // ── Step 4: Chatterbox TTS ───────────────────────────────────────────────
  console.log('\n── Step 4: Chatterbox TTS ──');
  if (!fs.existsSync(VOICEOVER_PATH)) {
    const healthy = await waitForChatterbox(5);
    if (!healthy) {
      const ok = await restartChatterboxServer();
      if (!ok) throw new Error('Chatterbox server unavailable');
    }

    const scriptText = finalScenes.map(s => s.narration).join('\n\n');
    const sentences  = splitSentences(scriptText);
    console.log(`  ${sentences.length} sentences`);

    const silence350 = path.join(ASSETS_DIR, '_silence-350.wav');
    const silence700 = path.join(ASSETS_DIR, '_silence-700.wav');
    ensureSilence(silence350, 350);
    ensureSilence(silence700, 700);

    const partPaths = [];
    const ttsT0 = Date.now();
    let ttsAudioSec = 0;
    for (let i = 0; i < sentences.length; i++) {
      const { text, paragraphEnd } = sentences[i];
      const partPath = path.join(SENTENCES_DIR, `s${String(i).padStart(3, '0')}.wav`);
      if (!fs.existsSync(partPath)) {
        await ttsWithRetry(text, partPath, ASSETS_DIR, 3);
        try { ttsAudioSec += getAudioDuration(partPath); } catch {}
      }
      partPaths.push(partPath);
      if (i < sentences.length - 1) partPaths.push(paragraphEnd ? silence700 : silence350);
      if ((i + 1) % Math.ceil(sentences.length / 10) === 0) {
        const pct = Math.round(100 * (i + 1) / sentences.length);
        console.log(`  TTS: ${pct}% (${i + 1}/${sentences.length})`);
      }
    }

    const ttsElapsed = (Date.now() - ttsT0) / 1000;
    if (ttsAudioSec > 0) console.log(`  TTS rate: ${(ttsElapsed / ttsAudioSec).toFixed(2)}x realtime`);

    const concatFile = path.join(ASSETS_DIR, '_concat.txt');
    fs.writeFileSync(concatFile, partPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${VOICEOVER_PATH}"`, { stdio: 'pipe' });
    fs.unlinkSync(concatFile);
  }

  const audioDuration = getAudioDuration(VOICEOVER_PATH);
  console.log(`  Voiceover: ${audioDuration.toFixed(1)}s (${(audioDuration / 60).toFixed(1)} min)`);

  // ── Step 5: Whisper timestamps ───────────────────────────────────────────
  console.log('\n── Step 5: Whisper timestamps ──');
  let wordTimestamps = [];
  if (fs.existsSync(WHISPER_PATH)) {
    wordTimestamps = JSON.parse(fs.readFileSync(WHISPER_PATH, 'utf-8'));
    console.log(`  Cached: ${wordTimestamps.length} words`);
  } else {
    const whisperOut = execSync(
      `"${PYTHON_BIN}" -c "import whisper,json;m=whisper.load_model('base');r=m.transcribe(r'${VOICEOVER_PATH}',word_timestamps=True,language='en');words=[{'word':w['word'].strip(),'start':round(w['start'],3),'end':round(w['end'],3)} for seg in r['segments'] for w in seg.get('words',[])];print(json.dumps(words))"`,
      { encoding: 'utf-8', timeout: 600000 }
    );
    wordTimestamps = JSON.parse(whisperOut.trim());
    fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTimestamps));
    console.log(`  ${wordTimestamps.length} words`);
  }
  wordTimestamps = filterWhisperSoundEffects(wordTimestamps);

  // ── Step 6: Director — keyword_semantic matching ─────────────────────────
  console.log('\n── Step 6: Director — keyword_semantic matching ──');
  const { clips, matchLog } = await createStoryboard(finalScenes, wordTimestamps, audioDuration, {
    targetClipSec:      4,
    imageMatching:      CHANNEL_CONFIG.image_matching,
    minClipDurationSec: CHANNEL_CONFIG.min_clip_duration_seconds,
    maxClipDurationSec: CHANNEL_CONFIG.max_clip_duration_seconds,
  });

  for (const clip of clips) {
    if (clip.imagePath && !path.isAbsolute(clip.imagePath)) {
      clip.imagePath = path.join(PROJECT_ROOT, clip.imagePath);
    }
  }

  const usedPaths = clips.map(c => c.imagePath).filter(Boolean);
  const dupCount  = usedPaths.length - new Set(usedPaths).size;
  const kwHits    = (matchLog || []).filter(m => m.keyword !== '(fallback)' && m.keyword).length;
  console.log(`  Clips: ${clips.length}  Keyword hits: ${kwHits}/${clips.length} (${Math.round(100 * kwHits / clips.length)}%)  Duplicates: ${dupCount}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'match-log.json'), JSON.stringify(matchLog || [], null, 2));

  // ── Step 7: FFmpeg composition ───────────────────────────────────────────
  console.log('\n── Step 7: FFmpeg composition ──');
  const particlesPath = await ensureParticleLoop();
  const smokePath     = ensureSmokeLoop();

  for (const p of [SLIDESHOW_PATH, VOICE_MIX_PATH, BODY_PATH, FINAL_PATH]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  createClipSlideshow(clips, Math.ceil(audioDuration), SLIDESHOW_PATH, { fadeTime: 1.5 });
  mixAudio(VOICEOVER_PATH, Math.ceil(audioDuration), VOICE_MIX_PATH, {
    includeBgMusic: true, bgMusicVolume: '0.25', fireplaceVolume: '0.08',
  });
  composeFinalVideoWithBg({
    bgImagePath:    null,
    slideshowPath:  SLIDESHOW_PATH,
    particlesPath,
    smokePath,
    assPath:        null,
    voiceAudioPath: VOICE_MIX_PATH,
    bgMusicPath:    null,
    framePath:      null,
    outputPath:     BODY_PATH,
    duration:       audioDuration,
    introDuration:  0,
    fullscreen:     true,
  });
  prependIntroVideo(INTRO_FINAL_PATH, BODY_PATH, FINAL_PATH);

  const finalMB  = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);
  const finalSec = parseFloat(
    execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`, { encoding: 'utf-8' }).trim()
  );
  console.log(`  Final: ${finalMB} MB, ${finalSec.toFixed(0)}s (${(finalSec / 60).toFixed(1)} min)`);

  // ── Step 8: Thumbnail (AstroKobi, up to 3 attempts, critic picks best) ───
  console.log('\n── Step 8: Thumbnail ──');
  let thumbnailPath = null;
  let thumbScore    = null;
  try {
    const scriptText = finalScenes.map(s => s.narration).join('\n\n').slice(0, 3000);
    thumbnailPath = await generateThumbnailV3({
      outputDir:     THUMB_DIR,
      title:         VIDEO_TITLE,
      scriptText,
      channelConfig: CHANNEL_CONFIG,
    });
    const reviewFile = path.join(THUMB_DIR, 'thumbnail-v3-review.json');
    if (fs.existsSync(reviewFile)) {
      thumbScore = JSON.parse(fs.readFileSync(reviewFile, 'utf-8')).rating;
    }
    console.log(`  Thumbnail: ${path.basename(thumbnailPath || 'none')}  Score: ${thumbScore ?? '?'}/10`);
  } catch (err) {
    console.log(`  [Thumbnail] Failed: ${err.message} — continuing without thumbnail`);
  }

  // ── Step 9: YouTube metadata ─────────────────────────────────────────────
  console.log('\n── Step 9: YouTube metadata ──');
  const meta = await generateMetadata(topicTitle, finalScenes, CHANNEL_CONFIG);
  meta.title = VIDEO_TITLE; // override with AstroKobi title candidate winner

  // ── Step 10: YouTube upload (retry 5×, 60s backoff) ─────────────────────
  console.log('\n── Step 10: YouTube upload ──');
  let privacyStatus, scheduledAt;
  if (videoIndex === 0) {
    privacyStatus = 'public';
    scheduledAt   = null;
    console.log('  Privacy: PUBLIC (immediate)');
  } else {
    privacyStatus = 'private';
    scheduledAt   = bangkokSchedule(videoIndex);
    console.log(`  Privacy: PRIVATE, scheduled: ${scheduledAt.toISOString()}`);
  }

  let videoId = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      videoId = await uploadVideo({
        channelName:   CHANNEL_CONFIG.slug,
        videoPath:     FINAL_PATH,
        title:         meta.title,
        description:   meta.description,
        tags:          meta.tags,
        thumbnailPath,
        scheduledAt,
        privacyStatus,
      });
      break;
    } catch (err) {
      console.log(`  [Upload] Attempt ${attempt}/5 failed: ${err.message}`);
      if (attempt < 5) {
        console.log('  Waiting 60s before retry...');
        await new Promise(r => setTimeout(r, 60000));
      } else {
        throw new Error(`Upload failed after 5 attempts: ${err.message}`);
      }
    }
  }

  const url       = `https://youtube.com/watch?v=${videoId}`;
  const pipelineSec = elapsed();
  console.log(`\n  ✅ VIDEO ${videoIndex + 1} DONE`);
  console.log(`     URL:      ${url}`);
  console.log(`     Privacy:  ${privacyStatus}`);
  if (scheduledAt) console.log(`     Schedule: ${scheduledAt.toISOString()}`);
  console.log(`     Pipeline: ${Math.floor(pipelineSec / 60)}m ${pipelineSec % 60}s`);

  return {
    videoIndex:   videoIndex + 1,
    topic:        topicTitle,
    title:        meta.title,
    videoId,
    url,
    privacyStatus,
    scheduledAt:  scheduledAt?.toISOString() || null,
    scriptScore:  bestScore,
    thumbScore,
    kwHits:       `${kwHits}/${clips.length} (${Math.round(100 * kwHits / clips.length)}%)`,
    finalMB,
    durationMin:  (finalSec / 60).toFixed(1),
    pipelineSec,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const BATCH_TS   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const REPORT_PATH = path.join(PROJECT_ROOT, 'data', `astronomer-batch-${BATCH_TS}.md`);
const batchStart = Date.now();

const results = [];
const errors  = [];

console.log('═══════════════════════════════════════════════════════════');
console.log('SleepForge — Astronomer Overnight Batch');
console.log(`Videos: ${TOPICS.length}`);
console.log(`Start: ${new Date().toISOString()}`);
console.log('Schedule: Video 1 PUBLIC now; Videos 2-5 → 08:00 Bangkok +1/+2/+3/+4 days');
console.log('═══════════════════════════════════════════════════════════');

// Start Chatterbox
console.log('\n── Starting Chatterbox server ──');
startChatterboxServer();
const cbReady = await waitForChatterbox(300);
if (!cbReady) {
  console.error('FATAL: Chatterbox failed to start in 5 minutes');
  process.exit(1);
}
console.log('  Chatterbox healthy ✓');

// Process videos sequentially
for (let i = 0; i < TOPICS.length; i++) {
  const topicObj = TOPICS[i];
  console.log(`\n\n${'═'.repeat(60)}`);
  console.log(`VIDEO ${i + 1}/5: ${topicObj.title}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('═'.repeat(60));

  try {
    const result = await renderAndUpload(topicObj, i);
    results.push(result);
  } catch (err) {
    const errMsg = err.message || String(err);
    console.error(`\n❌ VIDEO ${i + 1} FATAL: ${errMsg}`);
    console.error(err.stack || '');

    const fatalPath = path.join(PROJECT_ROOT, 'data', `astronomer-batch-fatal-${i + 1}-${BATCH_TS}.md`);
    fs.writeFileSync(fatalPath, [
      `# Fatal Error — Video ${i + 1}`,
      ``,
      `**Topic:** ${topicObj.title}`,
      `**Time:** ${new Date().toISOString()}`,
      ``,
      `\`\`\``,
      err.stack || errMsg,
      `\`\`\``,
    ].join('\n'));

    errors.push({ videoIndex: i + 1, topic: topicObj.title, error: errMsg });
    console.log(`  Fatal log: ${fatalPath}`);
    console.log('  Continuing to next video...');
  }
}

// Clean up
try { serverProc?.kill(); } catch {}
try { await closeBrowser(); } catch {}

// ── Final report ──────────────────────────────────────────────────────────────

const batchSec = Math.round((Date.now() - batchStart) / 1000);

const lines = [
  `# Astronomer Batch Report — ${BATCH_TS.replace('T', ' ')}`,
  ``,
  `## Videos`,
  ``,
  `| # | Title | URL | Privacy | Scheduled | Script | Thumb | Duration | MB | Keywords | Pipeline |`,
  `|---|-------|-----|---------|-----------|--------|-------|----------|----|----------|----------|`,
];

for (const r of results) {
  const sched = r.scheduledAt
    ? new Date(r.scheduledAt).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }) + ' Bangkok'
    : 'PUBLIC NOW';
  lines.push(
    `| ${r.videoIndex} | ${r.title} | [watch](${r.url}) | ${r.privacyStatus} | ${sched} | ${r.scriptScore ?? '?'}/10 | ${r.thumbScore ?? '?'}/10 | ${r.durationMin} min | ${r.finalMB} MB | ${r.kwHits} | ${Math.floor(r.pipelineSec / 60)}m ${r.pipelineSec % 60}s |`
  );
}

if (errors.length > 0) {
  lines.push(``, `## Errors`, ``);
  for (const e of errors) {
    lines.push(`- **Video ${e.videoIndex}** (${e.topic}): ${e.error}`);
  }
}

lines.push(
  ``,
  `## Summary`,
  ``,
  `- Completed: ${results.length}/${TOPICS.length}`,
  `- Failed: ${errors.length}`,
  `- Batch start: ${new Date(batchStart).toISOString()}`,
  `- Batch end: ${new Date().toISOString()}`,
  `- Total time: ${Math.floor(batchSec / 3600)}h ${Math.floor((batchSec % 3600) / 60)}m ${batchSec % 60}s`,
  ``,
  `## URLs`,
  ``,
  ...results.map(r => `- ${r.title}: ${r.url}`),
);

fs.writeFileSync(REPORT_PATH, lines.join('\n'));

console.log(`\n\n${'═'.repeat(60)}`);
console.log(`BATCH COMPLETE — ${results.length}/${TOPICS.length} videos uploaded`);
if (errors.length > 0) console.log(`ERRORS: ${errors.length} — see astronomer-batch-fatal-* in data/`);
console.log(`Report: ${REPORT_PATH}`);
console.log(`Total: ${Math.floor(batchSec / 3600)}h ${Math.floor((batchSec % 3600) / 60)}m`);
console.log('═'.repeat(60));

process.exit(0);
