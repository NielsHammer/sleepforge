/**
 * astronomer-single.js — One Sleepless Astronomer video, render + upload PUBLIC
 *
 * Topic: What's Inside a Black Hole: An Hour of Deep Space Wonder
 * Upload: PUBLIC immediately
 * Report: data/astronomer-single-<timestamp>.md
 *
 * Diagnosis context baked in:
 *   - Claude CLI took 94s for 2 sentences last night → 180s timeout was too short
 *   - Fixes applied: claude-cli.js default 600s + 3-retry, outline/scorer bumped to 600s
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

const TOPIC = {
  title: "What's Inside a Black Hole: An Hour of Deep Space Wonder",
  angle: "Event horizons, singularities, spaghettification, Hawking radiation — what we know and what remains mystery",
};
const SLUG = "what-s-inside-a-black-hole-an-hour-of-deep-space-wonder";

const OUTPUT_DIR     = path.join(PROJECT_ROOT, 'output', SLUG);
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

const TS_START = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const t0       = Date.now();
const elapsed  = () => Math.round((Date.now() - t0) / 1000);

for (const d of [OUTPUT_DIR, ASSETS_DIR, SENTENCES_DIR, THUMB_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

function log(msg) { console.log(msg); }

log('═══════════════════════════════════════════════════════════');
log('SleepForge — Astronomer Single Video');
log(`Topic:  ${TOPIC.title}`);
log(`Output: ${OUTPUT_DIR}`);
log(`Start:  ${new Date().toISOString()}`);
log('Fixes:  claude-cli default 600s + 3-retry, outline 600s, scorer 600s');
log('═══════════════════════════════════════════════════════════');

// ── Helpers ──────────────────────────────────────────────────────────────────

function splitSentences(text) {
  const ABBR = /^(Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|etc|Inc|Co|Ltd|B\.C|A\.D|i\.e|e\.g)$/i;
  const paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const out = [];
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

// ── Chatterbox ────────────────────────────────────────────────────────────────

let serverProc = null;

function startChatterboxServer() {
  const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
  serverProc = spawn(PYTHON_BIN, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CHATTERBOX_PORT: '4123' },
  });
  serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
  serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
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
  log('  [CB] Restarting server...');
  try { serverProc?.kill('SIGKILL'); } catch {}
  resetHealthCache();
  await new Promise(r => setTimeout(r, 3000));
  startChatterboxServer();
  const ok = await waitForChatterbox(120);
  log(ok ? '  [CB] Restarted ✓' : '  [CB] Restart FAILED');
  return ok;
}

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

async function ttsWithRetry(text, outputPath, maxAttempts = 3) {
  const sil2s = path.join(ASSETS_DIR, '_silence-2000.wav');
  ensureSilence(sil2s, 2000);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        await restartChatterboxServer();
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
      await ttsSentence(text, outputPath);
      return;
    } catch (err) {
      log(`  [TTS] Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
  }
  log(`  [TTS] All failed — silence for: "${text.slice(0, 50)}"`);
  fs.copyFileSync(sil2s, outputPath);
}

// ── PIPELINE ─────────────────────────────────────────────────────────────────

// Step 1: Title candidates
log('\n── Step 1: Title candidates ──');
let titleResult;
if (fs.existsSync(TITLE_CACHE)) {
  titleResult = JSON.parse(fs.readFileSync(TITLE_CACHE, 'utf-8'));
  log(`  Cached: "${titleResult.winner}"`);
} else {
  titleResult = await generateAstronomerTitleCandidates(TOPIC, CHANNEL_CONFIG);
  fs.writeFileSync(TITLE_CACHE, JSON.stringify(titleResult, null, 2));
  log(`  Winner: "${titleResult.winner}"`);
  if (titleResult.reason) log(`  Reason: ${titleResult.reason}`);
}
const VIDEO_TITLE = titleResult.winner;

// Step 2: Script generation
log('\n── Step 2: Script generation (60 min, two-pass) ──');
// Prefer batch-raw, then check if existing slug.json is a usable raw script
const rawCachePath = path.join(SCRIPTS_DIR, `${SLUG}-batch-raw.json`);
const priorRawPath = path.join(SCRIPTS_DIR, `${SLUG}.json`);
let rawScenes;

if (fs.existsSync(rawCachePath)) {
  rawScenes = JSON.parse(fs.readFileSync(rawCachePath, 'utf-8'));
  log(`  Cached raw (batch-raw): ${rawScenes.length} scenes`);
} else if (fs.existsSync(priorRawPath)) {
  const candidate = JSON.parse(fs.readFileSync(priorRawPath, 'utf-8'));
  const wordCount = candidate.map(s => s.narration || '').join(' ').split(/\s+/).filter(Boolean).length;
  if (candidate.length > 0 && candidate[0].narration && wordCount >= 5000) {
    rawScenes = candidate;
    log(`  Using prior script: ${rawScenes.length} scenes, ${wordCount} words`);
    fs.writeFileSync(rawCachePath, JSON.stringify(rawScenes, null, 2));
  } else {
    log(`  Prior script rejected (${wordCount} words < 5000 min) — regenerating`);
    rawScenes = null;
  }
} else {
  rawScenes = null;
}

if (!rawScenes) {
  log('  Generating 9000-word script...');
  const result = await generateScript(TOPIC.title, {
    duration:      60,
    output:        SCRIPTS_DIR,
    channelConfig: CHANNEL_CONFIG,
  });
  rawScenes = result.scenes;
  fs.writeFileSync(rawCachePath, JSON.stringify(rawScenes, null, 2));
}
const rawWords = rawScenes.map(s => s.narration).join(' ').split(/\s+/).length;
log(`  Raw: ${rawScenes.length} scenes, ${rawWords} words`);

// Step 3: Analyze + rewrite
log('\n── Step 3: Analyze + rewrite (target ≥ 8.0) ──');
let finalScenes, bestScore;
if (fs.existsSync(FINAL_SCENES_PATH)) {
  finalScenes = JSON.parse(fs.readFileSync(FINAL_SCENES_PATH, 'utf-8'));
  bestScore   = 'cached';
  log(`  Cached final: ${finalScenes.length} scenes`);
} else {
  const { finalScenes: fs2, history } = await analyzeAndRewrite(rawScenes, CHANNEL_CONFIG, {
    topicSlug:      SLUG,
    maxIterations:  5,
    targetScore:    8.0,
    saveIterations: true,
  });
  finalScenes = fs2;
  bestScore   = history.length > 0
    ? history.reduce((a, b) => (a.score >= b.score ? a : b)).score
    : 'unknown';
  log(`  Best score: ${bestScore}/10`);
  fs.writeFileSync(FINAL_SCENES_PATH, JSON.stringify(finalScenes, null, 2));
}

// Step 4: Chatterbox TTS
log('\n── Step 4: Chatterbox TTS ──');
if (!fs.existsSync(VOICEOVER_PATH)) {
  startChatterboxServer();
  const cbReady = await waitForChatterbox(300);
  if (!cbReady) { log('ERROR: Chatterbox unavailable'); serverProc?.kill(); process.exit(1); }
  log('  Chatterbox healthy ✓');

  const scriptText = finalScenes.map(s => s.narration).join('\n\n');
  const sentences  = splitSentences(scriptText);
  log(`  ${sentences.length} sentences`);

  const silence350 = path.join(ASSETS_DIR, '_silence-350.wav');
  const silence700 = path.join(ASSETS_DIR, '_silence-700.wav');
  ensureSilence(silence350, 350);
  ensureSilence(silence700, 700);

  const partPaths = [];
  const ttsT0     = Date.now();
  let ttsAudioSec = 0;

  for (let i = 0; i < sentences.length; i++) {
    const { text, paragraphEnd } = sentences[i];
    const partPath = path.join(SENTENCES_DIR, `s${String(i).padStart(3, '0')}.wav`);
    if (!fs.existsSync(partPath)) {
      await ttsWithRetry(text, partPath, 3);
      try { ttsAudioSec += getAudioDuration(partPath); } catch {}
    }
    partPaths.push(partPath);
    if (i < sentences.length - 1) partPaths.push(paragraphEnd ? silence700 : silence350);
    if ((i + 1) % Math.ceil(sentences.length / 10) === 0) {
      log(`  TTS: ${Math.round(100 * (i + 1) / sentences.length)}% (${i + 1}/${sentences.length})`);
    }
  }

  if (ttsAudioSec > 0) {
    log(`  TTS rate: ${((Date.now() - ttsT0) / 1000 / ttsAudioSec).toFixed(2)}x realtime`);
  }

  const concatFile = path.join(ASSETS_DIR, '_concat.txt');
  fs.writeFileSync(concatFile, partPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${VOICEOVER_PATH}"`, { stdio: 'ignore' });
  fs.unlinkSync(concatFile);
} else {
  log('  Cached: voiceover.wav exists, skipping TTS');
}
const audioDuration = getAudioDuration(VOICEOVER_PATH);
log(`  Voiceover: ${audioDuration.toFixed(1)}s (${(audioDuration / 60).toFixed(1)} min)`);

// Step 5: Whisper
log('\n── Step 5: Whisper timestamps ──');
let wordTimestamps = [];
if (fs.existsSync(WHISPER_PATH)) {
  wordTimestamps = JSON.parse(fs.readFileSync(WHISPER_PATH, 'utf-8'));
  log(`  Cached: ${wordTimestamps.length} words`);
} else {
  const whisperOut = execSync(
    `"${PYTHON_BIN}" -c "import whisper,json;m=whisper.load_model('base');r=m.transcribe(r'${VOICEOVER_PATH}',word_timestamps=True,language='en');words=[{'word':w['word'].strip(),'start':round(w['start'],3),'end':round(w['end'],3)} for seg in r['segments'] for w in seg.get('words',[])];print(json.dumps(words))"`,
    { encoding: 'utf-8', timeout: 600000, maxBuffer: 128 * 1024 * 1024 }
  );
  wordTimestamps = JSON.parse(whisperOut.trim());
  fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTimestamps));
  log(`  ${wordTimestamps.length} words`);
}
wordTimestamps = filterWhisperSoundEffects(wordTimestamps);

// Step 6: Director
log('\n── Step 6: Director — keyword_semantic matching ──');
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
const kwHits    = (matchLog || []).filter(m => m.keyword && m.keyword !== '(fallback)').length;
log(`  Clips: ${clips.length}  Keyword hits: ${kwHits}/${clips.length} (${Math.round(100 * kwHits / clips.length)}%)  Duplicates: ${dupCount}`);
fs.writeFileSync(path.join(OUTPUT_DIR, 'match-log.json'), JSON.stringify(matchLog || [], null, 2));

// Step 7: FFmpeg composition
log('\n── Step 7: FFmpeg composition ──');
const particlesPath = await ensureParticleLoop();
const smokePath     = ensureSmokeLoop();

// Only rebuild body.mp4 if it doesn't exist — saves 45+ min on restart
if (!fs.existsSync(BODY_PATH)) {
  for (const p of [SLIDESHOW_PATH, VOICE_MIX_PATH, BODY_PATH]) {
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
} else {
  log('  Cached: body.mp4 exists, skipping slideshow + mix + compose');
}

// Always re-run prependIntroVideo if final.mp4 missing or too small (<100MB)
const finalExists = fs.existsSync(FINAL_PATH) && fs.statSync(FINAL_PATH).size > 100 * 1024 * 1024;
if (!finalExists) {
  if (fs.existsSync(FINAL_PATH)) fs.unlinkSync(FINAL_PATH);
  prependIntroVideo(INTRO_FINAL_PATH, BODY_PATH, FINAL_PATH);
} else {
  log('  Cached: final.mp4 exists, skipping intro prepend');
}

const finalMB  = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);
const finalSec = parseFloat(
  execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`, { encoding: 'utf-8' }).trim()
);
log(`  Final: ${finalMB} MB, ${finalSec.toFixed(0)}s (${(finalSec / 60).toFixed(1)} min)`);

// Step 8: Thumbnail (AstroKobi, up to 3 attempts, critic picks best)
log('\n── Step 8: Thumbnail (3 AstroKobi attempts) ──');
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
  log(`  Thumbnail: ${path.basename(thumbnailPath || 'none')}  Score: ${thumbScore ?? '?'}/10`);
} catch (err) {
  log(`  [Thumbnail] Failed: ${err.message} — continuing without thumbnail`);
}

// Step 9: YouTube metadata
log('\n── Step 9: YouTube metadata ──');
const meta = await generateMetadata(TOPIC.title, finalScenes, CHANNEL_CONFIG);
meta.title = VIDEO_TITLE;

// Step 10: Upload PUBLIC
log('\n── Step 10: YouTube upload (PUBLIC) ──');
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
      scheduledAt:   null,
      privacyStatus: 'public',
    });
    break;
  } catch (err) {
    log(`  [Upload] Attempt ${attempt}/5 failed: ${err.message}`);
    if (attempt < 5) {
      log('  Waiting 60s...');
      await new Promise(r => setTimeout(r, 60000));
    } else {
      throw new Error(`Upload failed after 5 attempts: ${err.message}`);
    }
  }
}
const url = `https://youtube.com/watch?v=${videoId}`;
log(`  Uploaded: ${url}`);

// Archive unused thumbnail attempts
const archiveDir = path.join(PROJECT_ROOT, 'data', 'uploaded-archive', videoId);
fs.mkdirSync(archiveDir, { recursive: true });
for (let a = 1; a <= 3; a++) {
  const attemptThumb = path.join(THUMB_DIR, `attempt-${a}`, 'thumbnail.png');
  if (fs.existsSync(attemptThumb)) {
    fs.copyFileSync(attemptThumb, path.join(archiveDir, `thumbnail-attempt-${a}.png`));
  }
}
if (thumbnailPath && fs.existsSync(thumbnailPath)) {
  fs.copyFileSync(thumbnailPath, path.join(archiveDir, 'thumbnail-final.png'));
}
log(`  Thumbnails archived: data/uploaded-archive/${videoId}/`);

// Kill Chatterbox + close Puppeteer
try { serverProc?.kill(); } catch {}
try { await closeBrowser(); } catch {}

// ── Report ───────────────────────────────────────────────────────────────────

const totalSec = elapsed();
const reportPath = path.join(PROJECT_ROOT, 'data', `astronomer-single-${TS_START}.md`);

fs.writeFileSync(reportPath, [
  `# Astronomer Single Video — ${TS_START.replace('T', ' ')}`,
  ``,
  `## Diagnosis`,
  ``,
  `**Problem:** All 5 overnight videos failed with "claude CLI timed out after 180000ms"`,
  ``,
  `**Root cause:** Claude CLI startup on Windows takes 60-90s (Node.js cold start + cmd.exe wrapper). A 20-scene outline + scoring prompt takes 5-10 minutes total. The 180s timeout was always going to fail.`,
  ``,
  `**Confirmed:** \`echo "Write 2 sentences about Voyager 1." | claude -p --model claude-sonnet-4-6\` took **94 seconds** for a trivial response.`,
  ``,
  `**Fixes applied:**`,
  `- \`src/claude-cli.js\`: default timeoutMs 180000 → 600000 (10 min), added 3-retry on timeout with 30s pause`,
  `- \`src/script-generator.js\`: outline call 180000 → 600000; scene expand 90000 → 300000`,
  `- \`src/script-analyzer.js\`: scoring call 180000 → 600000`,
  ``,
  `## Video`,
  ``,
  `**Title:** ${VIDEO_TITLE}`,
  `**URL:** ${url}`,
  `**Privacy:** PUBLIC (immediate)`,
  ``,
  `## Scores`,
  ``,
  `- Script score: ${bestScore}/10`,
  `- Thumbnail score: ${thumbScore ?? '?'}/10`,
  `- Keyword hits: ${kwHits}/${clips.length} (${Math.round(100 * kwHits / clips.length)}%)`,
  `- Duplicate images: ${dupCount}`,
  ``,
  `## Render stats`,
  ``,
  `- Duration: ${(finalSec / 60).toFixed(1)} min (${finalSec.toFixed(0)}s)`,
  `- File size: ${finalMB} MB`,
  `- Total pipeline: ${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m ${totalSec % 60}s`,
  ``,
  `## Thumbnail archive`,
  ``,
  `- \`data/uploaded-archive/${videoId}/\``,
].join('\n'));

log('\n═══════════════════════════════════════════════════════════');
log('✅ DONE — Astronomer Single Video');
log(`   URL:       ${url}`);
log(`   Title:     ${VIDEO_TITLE}`);
log(`   Script:    ${bestScore}/10`);
log(`   Thumbnail: ${thumbScore ?? '?'}/10`);
log(`   Duration:  ${(finalSec / 60).toFixed(1)} min`);
log(`   Pipeline:  ${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m ${totalSec % 60}s`);
log(`   Report:    ${reportPath}`);
log('═══════════════════════════════════════════════════════════');

process.exit(0);
