/**
 * render-single.js — Renders and uploads one video for any channel.
 *
 * Usage:
 *   node scripts/render-single.js \
 *     --channel astronomer|philosophers \
 *     --topic "black holes" \
 *     --queue-id <uuid> \
 *     --schedule-date 2026-05-21
 *
 * Scheduling:
 *   today or past → PUBLIC immediately
 *   future        → PRIVATE, scheduled to that date at 08:00 Bangkok (01:00 UTC)
 *
 * On completion prints to stdout:
 *   QUEUE_UPDATE: {"queueId":"...","status":"completed","videoId":"...","url":"..."}
 * On failure prints:
 *   QUEUE_UPDATE: {"queueId":"...","status":"failed","error":"..."}
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

// ─── CLI ARGS ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}

const channelArg  = getArg('channel')  || 'astronomer';
const topic       = getArg('topic')    || 'Unknown Topic';
const queueId     = getArg('queue-id') || null;
const scheduleArg = getArg('schedule-date') || null;

const CHANNEL_SLUG = (channelArg === 'astronomer' || channelArg === 'sleepless-astronomer')
  ? 'sleepless-astronomer'
  : 'sleepless-philosophers';

const CHANNEL_CONFIG = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'channels', `${CHANNEL_SLUG}.json`), 'utf-8')
);

const INTRO_FINAL_PATH = CHANNEL_CONFIG.intro_video_path
  ? path.join(PROJECT_ROOT, CHANNEL_CONFIG.intro_video_path)
  : null;
const HAS_INTRO = !!(INTRO_FINAL_PATH && fs.existsSync(INTRO_FINAL_PATH));

// ─── SCHEDULING ──────────────────────────────────────────────────────────────

function resolveSchedule(scheduleDateStr) {
  if (!scheduleDateStr) return { privacyStatus: 'public', scheduledAt: null };
  const today = new Date().toISOString().slice(0, 10);
  if (scheduleDateStr <= today) return { privacyStatus: 'public', scheduledAt: null };
  const d = new Date(scheduleDateStr + 'T01:00:00.000Z'); // 08:00 Bangkok = 01:00 UTC
  return { privacyStatus: 'private', scheduledAt: d };
}

const { privacyStatus, scheduledAt } = resolveSchedule(scheduleArg);

// ─── DISK SPACE ───────────────────────────────────────────────────────────────

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

// ─── CHATTERBOX ───────────────────────────────────────────────────────────────

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

// ─── TTS ─────────────────────────────────────────────────────────────────────

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
    execSync(
      `ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 2.000 -c:a pcm_s16le "${sil2s}"`,
      { stdio: 'pipe' }
    );
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
  console.log(`  [TTS] All attempts failed — using 2s silence`);
  fs.copyFileSync(sil2s, outputPath);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function topicToSlug(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
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

function emitQueueUpdate(data) {
  if (!queueId) return;
  process.stdout.write('\nQUEUE_UPDATE: ' + JSON.stringify({ queueId, ...data }) + '\n');
}

// ─── PIPELINE ─────────────────────────────────────────────────────────────────

async function run() {
  const slug = topicToSlug(topic);

  const OUTPUT_DIR     = path.join(PROJECT_ROOT, 'output', slug);
  const ASSETS_DIR     = path.join(OUTPUT_DIR, 'assets');
  const SENTENCES_DIR  = path.join(ASSETS_DIR, 'sentences');
  const THUMB_DIR      = path.join(OUTPUT_DIR, 'thumbnail');
  const VOICEOVER_PATH = path.join(ASSETS_DIR, 'voiceover.wav');
  const WHISPER_PATH   = path.join(ASSETS_DIR, 'whisper.json');
  const SLIDESHOW_PATH = path.join(OUTPUT_DIR, 'slideshow.mp4');
  const VOICE_MIX_PATH = path.join(OUTPUT_DIR, 'voice-mix.m4a');
  const BODY_PATH      = path.join(OUTPUT_DIR, 'body.mp4');
  const FINAL_PATH     = path.join(OUTPUT_DIR, 'final.mp4');
  const FINAL_SCENES_PATH = path.join(OUTPUT_DIR, 'final-scenes.json');
  const TITLE_CACHE    = path.join(OUTPUT_DIR, 'title-candidates.json');
  const rawCachePath   = path.join(SCRIPTS_DIR, `${slug}-batch-raw.json`);

  const t0      = Date.now();
  const elapsed = () => Math.round((Date.now() - t0) / 1000);

  const freeGB = getFreeDiskGB();
  console.log(`  [disk] Free: ${freeGB.toFixed(1)} GB`);
  if (freeGB < 5) cleanOldestOutputDir();

  for (const d of [OUTPUT_DIR, ASSETS_DIR, SENTENCES_DIR, THUMB_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // ── Step 1: Title candidates ─────────────────────────────────────────────
  console.log('\n── Step 1: Title candidates ──');
  let VIDEO_TITLE = topic;
  if (CHANNEL_SLUG === 'sleepless-astronomer') {
    let titleResult;
    if (fs.existsSync(TITLE_CACHE)) {
      titleResult = JSON.parse(fs.readFileSync(TITLE_CACHE, 'utf-8'));
      console.log(`  Cached: "${titleResult.winner}"`);
    } else {
      titleResult = await generateAstronomerTitleCandidates({ title: topic, angle: '' }, CHANNEL_CONFIG);
      fs.writeFileSync(TITLE_CACHE, JSON.stringify(titleResult, null, 2));
      console.log(`  Winner: "${titleResult.winner}"`);
    }
    VIDEO_TITLE = titleResult.winner;
  } else {
    console.log(`  Philosophers title will be set during metadata step`);
  }

  // ── Step 2: Script generation ────────────────────────────────────────────
  console.log('\n── Step 2: Script generation ──');
  let rawScenes;
  if (fs.existsSync(rawCachePath)) {
    rawScenes = JSON.parse(fs.readFileSync(rawCachePath, 'utf-8'));
    console.log(`  Cached: ${rawScenes.length} scenes`);
  } else {
    console.log('  Generating 9000-word script...');
    const result = await generateScript(topic, {
      duration:      60,
      output:        SCRIPTS_DIR,
      channelConfig: CHANNEL_CONFIG,
    });
    rawScenes = result.scenes;
    fs.writeFileSync(rawCachePath, JSON.stringify(rawScenes, null, 2));
  }
  console.log(`  Raw: ${rawScenes.length} scenes, ${rawScenes.map(s => s.narration).join(' ').split(/\s+/).length} words`);

  // ── Step 3: Analyze + rewrite ────────────────────────────────────────────
  console.log('\n── Step 3: Analyze + rewrite (target ≥ 8.0) ──');
  let finalScenes, bestScore;
  if (fs.existsSync(FINAL_SCENES_PATH)) {
    finalScenes = JSON.parse(fs.readFileSync(FINAL_SCENES_PATH, 'utf-8'));
    bestScore   = 'cached';
    console.log(`  Cached: ${finalScenes.length} scenes`);
  } else {
    const { finalScenes: fs2, history } = await analyzeAndRewrite(rawScenes, CHANNEL_CONFIG, {
      topicSlug:      slug,
      maxIterations:  5,
      targetScore:    8.0,
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
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${VOICEOVER_PATH}"`, { stdio: 'pipe', maxBuffer: 100 * 1024 * 1024 });
    fs.unlinkSync(concatFile);
  }

  const audioDuration = getAudioDuration(VOICEOVER_PATH);
  console.log(`  Voiceover: ${audioDuration.toFixed(1)}s (${(audioDuration / 60).toFixed(1)} min)`);

  // ── Step 5: Whisper ──────────────────────────────────────────────────────
  console.log('\n── Step 5: Whisper timestamps ──');
  let wordTimestamps = [];
  if (fs.existsSync(WHISPER_PATH)) {
    wordTimestamps = JSON.parse(fs.readFileSync(WHISPER_PATH, 'utf-8'));
    console.log(`  Cached: ${wordTimestamps.length} words`);
  } else {
    const whisperOut = execSync(
      `"${PYTHON_BIN}" -c "import whisper,json;m=whisper.load_model('base');r=m.transcribe(r'${VOICEOVER_PATH}',word_timestamps=True,language='en');words=[{'word':w['word'].strip(),'start':round(w['start'],3),'end':round(w['end'],3)} for seg in r['segments'] for w in seg.get('words',[])];print(json.dumps(words))"`,
      { encoding: 'utf-8', timeout: 600000, maxBuffer: 100 * 1024 * 1024 }
    );
    wordTimestamps = JSON.parse(whisperOut.trim());
    fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTimestamps));
    console.log(`  ${wordTimestamps.length} words`);
  }
  wordTimestamps = filterWhisperSoundEffects(wordTimestamps);

  // ── Step 6: Director ─────────────────────────────────────────────────────
  console.log('\n── Step 6: Director ──');
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
  const kwHits = (matchLog || []).filter(m => m.keyword !== '(fallback)' && m.keyword).length;
  console.log(`  Clips: ${clips.length}  Keyword hits: ${kwHits}`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'match-log.json'), JSON.stringify(matchLog || [], null, 2));

  // ── Step 7: FFmpeg composition ───────────────────────────────────────────
  console.log('\n── Step 7: FFmpeg composition ──');
  const particlesPath = await ensureParticleLoop();
  const smokePath     = ensureSmokeLoop();

  for (const p of [SLIDESHOW_PATH, VOICE_MIX_PATH, BODY_PATH, FINAL_PATH]) {
    if (!fs.existsSync(p)) continue;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { fs.unlinkSync(p); break; }
      catch (e) {
        if (e.code !== 'EBUSY' || attempt === 4) throw e;
        await new Promise(r => setTimeout(r, 2000));
      }
    }
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

  if (HAS_INTRO) {
    prependIntroVideo(INTRO_FINAL_PATH, BODY_PATH, FINAL_PATH);
  } else {
    fs.copyFileSync(BODY_PATH, FINAL_PATH);
  }

  const finalMB  = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);
  const finalSec = parseFloat(
    execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`, { encoding: 'utf-8' }).trim()
  );
  console.log(`  Final: ${finalMB} MB, ${finalSec.toFixed(0)}s (${(finalSec / 60).toFixed(1)} min)`);

  // ── Step 8: Thumbnail ────────────────────────────────────────────────────
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
    console.log(`  Score: ${thumbScore ?? '?'}/10`);
  } catch (err) {
    console.log(`  [Thumbnail] Failed: ${err.message} — continuing`);
  }

  // ── Step 9: Metadata ─────────────────────────────────────────────────────
  console.log('\n── Step 9: YouTube metadata ──');
  const meta = await generateMetadata(topic, finalScenes, CHANNEL_CONFIG);
  if (CHANNEL_SLUG === 'sleepless-astronomer') {
    meta.title = VIDEO_TITLE;
  } else {
    VIDEO_TITLE = meta.title;
  }

  // ── Step 10: Upload ──────────────────────────────────────────────────────
  console.log('\n── Step 10: YouTube upload ──');
  console.log(`  Privacy: ${privacyStatus}${scheduledAt ? ` → ${scheduledAt.toISOString()}` : ' (immediate)'}`);

  let videoId = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      videoId = await uploadVideo({
        channelName:   CHANNEL_SLUG,
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
      if (attempt < 5) await new Promise(r => setTimeout(r, 60000));
      else throw new Error(`Upload failed after 5 attempts: ${err.message}`);
    }
  }

  const url = `https://youtube.com/watch?v=${videoId}`;
  const pipelineSec = elapsed();
  console.log(`\n  ✅ DONE — ${Math.floor(pipelineSec / 60)}m ${pipelineSec % 60}s`);
  console.log(`     URL: ${url}  Privacy: ${privacyStatus}`);
  if (scheduledAt) console.log(`     Schedule: ${scheduledAt.toISOString()}`);

  emitQueueUpdate({ status: 'completed', videoId, url, title: meta.title, pipelineSec });
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────

console.log('═══════════════════════════════════════════════════════════');
console.log(`SleepForge — Single Video Render`);
console.log(`Channel:  ${CHANNEL_SLUG}`);
console.log(`Topic:    ${topic}`);
console.log(`Schedule: ${scheduleArg || 'PUBLIC now'} → ${privacyStatus}`);
console.log('═══════════════════════════════════════════════════════════');

console.log('\n── Starting Chatterbox server ──');
startChatterboxServer();
const cbReady = await waitForChatterbox(300);
if (!cbReady) {
  console.error('FATAL: Chatterbox failed to start in 5 minutes');
  emitQueueUpdate({ status: 'failed', error: 'Chatterbox failed to start' });
  process.exit(1);
}
console.log('  Chatterbox healthy ✓');

try {
  await run();
} catch (err) {
  const msg = err.message || String(err);
  console.error(`\n❌ FATAL: ${msg}`);
  console.error(err.stack || '');
  emitQueueUpdate({ status: 'failed', error: msg });
  process.exit(1);
} finally {
  try { serverProc?.kill(); } catch {}
  try { await closeBrowser(); } catch {}
}
