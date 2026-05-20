/**
 * overnight-batch-2026-05-20.js — Queue 4 Videos (2 Philosophy + 2 Astronomer)
 *
 * All uploaded PRIVATE with publishAt:
 *   Philosophy 1: Zeno's Paradoxes        → 2026-05-21T01:00:00Z (8am Bangkok)
 *   Philosophy 2: Nietzsche's Philosophy  → 2026-05-22T01:00:00Z
 *   Astronomer 1: JWST Discoveries        → 2026-05-21T01:00:00Z
 *   Astronomer 2: Neutron Stars           → 2026-05-22T01:00:00Z
 *
 * Philosophy: spawn test-video-2min.js → 3 thumbnail variants → metadata → upload
 * Astronomer: direct pipeline calls (script → TTS → FFmpeg → thumbnail → upload)
 *
 * Usage: node scripts/overnight-batch-2026-05-20.js [--dry-run]
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const { callClaudeCLI }                          = await import('../src/claude-cli.js');
const { generateThumbnailV3, closeBrowser }      = await import('../src/thumbnail-v3.js');
const { generateMetadata, generateAstronomerTitleCandidates } = await import('../src/youtube-metadata-generator.js');
const { uploadVideo }                            = await import('../src/youtube.js');

// Astronomer-specific pipeline imports
const { generateScript }                         = await import('../src/script-generator.js');
const { analyzeAndRewrite }                      = await import('../src/script-analyzer.js');
const { filterWhisperSoundEffects }              = await import('../src/subtitles.js');
const { createStoryboard }                       = await import('../src/director.js');
const {
  createClipSlideshow, mixAudio,
  ensureSmokeLoop, ensureParticleLoop,
  composeFinalVideoWithBg, getAudioDuration, prependIntroVideo,
} = await import('../src/ffmpeg.js');
const { isHealthy, chatterboxTTS, resetHealthCache } = await import('../src/chatterbox.js');

const HAIKU   = 'claude-haiku-4-5-20251001';
const SONNET  = 'claude-sonnet-4-6';
const SCRIPTS_DIR  = path.join(ROOT, 'scripts');
const ARCHIVE_DIR  = path.join(ROOT, 'data', 'uploaded-archive');
const PYTHON_BIN   = process.env.PYTHON_BIN || path.join(ROOT, '.venv', 'Scripts', 'python.exe');

const ASTRO_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8'));
const PHIL_CONFIG  = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'channels', 'sleepless-philosophers.json'), 'utf-8'));
const INTRO_PATH   = path.join(ROOT, ASTRO_CONFIG.intro_video_path);

const DRY_RUN = process.argv.includes('--dry-run');

// ─── VIDEO LINEUP ─────────────────────────────────────────────────────────────

const VIDEOS = [
  {
    channel:     'sleepless-philosophers',
    scheduledAt: '2026-05-21T01:00:00Z',
    tradition:   'Pre-Socratic Greek',
    philosopher: "Zeno of Elea",
    philosophers: 'socrates,plato',
    topic:       "Zeno's Paradoxes: Achilles and the Tortoise, the Arrow Paradox, and What Motion and Infinity Really Mean",
    angle:       "The paradoxes that stopped philosophers dead in their tracks — Achilles who can never catch the tortoise, the arrow that cannot move, the race course that cannot be completed. What Zeno was really arguing about infinity, motion, and the nature of reality. How these puzzles are still debated today in mathematics and physics.",
    draftTitle:  "Zeno's Paradoxes: The Philosopher Who Proved Motion Is Impossible | Sleep",
    titlePattern:'specific_claim',
  },
  {
    channel:     'sleepless-philosophers',
    scheduledAt: '2026-05-22T01:00:00Z',
    tradition:   'German Idealism / Existentialism',
    philosopher: 'Friedrich Nietzsche',
    philosophers: 'nietzsche',
    topic:       "Nietzsche's Philosophy: The Will to Power, Eternal Recurrence, the Übermensch, and God Is Dead",
    angle:       "The philosopher who declared God is Dead. The Will to Power as life's fundamental drive. Eternal Recurrence — would you live your life again exactly as it was? The Übermensch as an ideal of self-overcoming. Nietzsche's critique of herd morality and slave morality.",
    draftTitle:  "2 Hours of Nietzsche's Philosophy That Will Change How You See Yourself",
    titlePattern:'active_force',
  },
  {
    channel:     'sleepless-astronomer',
    scheduledAt: '2026-05-21T01:00:00Z',
    title:       "The James Webb Space Telescope's Most Astounding Discoveries",
    angle:       "JWST's first year of images — deep field, exoplanet atmospheres, the earliest galaxies, and how it rewrote our timeline of the universe. What we expected to find vs. what actually appeared.",
  },
  {
    channel:     'sleepless-astronomer',
    scheduledAt: '2026-05-22T01:00:00Z',
    title:       "Neutron Stars: The Densest Objects You Can Actually Touch",
    angle:       "A teaspoon weighs a billion tons. Pulsars, magnetars, and the physics of collapsed stellar cores — what happens when a star runs out of fuel and its core collapses in less than a second.",
  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(msg) { console.log(msg); }
function logSection(t) { log('\n' + '═'.repeat(56) + '\n  ' + t + '\n' + '═'.repeat(56)); }

function slugify(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function getFreeDiskGb() {
  try {
    const out = execSync('powershell -c "(Get-PSDrive C).Free / 1GB"', { encoding: 'utf8', timeout: 5000 });
    return parseFloat(out.trim());
  } catch { return 100; }
}

function cleanOldestOutputDir() {
  const outputBase = path.join(ROOT, 'output');
  if (!fs.existsSync(outputBase)) return;
  const entries = fs.readdirSync(outputBase, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, mtime: fs.statSync(path.join(outputBase, e.name)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  if (entries.length > 0) {
    const d = path.join(outputBase, entries[0].name);
    log(`  [disk] Removing: ${entries[0].name}`);
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
}

function readCriticScore(dir) {
  try {
    const p = path.join(dir, 'thumbnail-v3-review.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : { rating: 5 };
  } catch { return { rating: 5 }; }
}

async function uploadWithRetry(opts, retries = 5) {
  for (let i = 1; i <= retries; i++) {
    try { return await uploadVideo(opts); }
    catch (err) {
      log(`  ⚠ Upload attempt ${i}/${retries}: ${err.message.slice(0, 100)}`);
      if (i < retries) await sleep(60000 * i);
      else throw err;
    }
  }
}

// ─── CHATTERBOX ───────────────────────────────────────────────────────────────

let cbProc = null;

function startChatterbox() {
  const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
  cbProc = spawn(PYTHON_BIN, [serverScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CHATTERBOX_PORT: '4123' },
  });
  cbProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
  cbProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
  cbProc.on('exit', c => { if (c) log(`[CB] exited ${c}`); });
}

async function waitForChatterbox(secs) {
  const deadline = Date.now() + secs * 1000;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await sleep(2000);
  }
  return false;
}

async function restartChatterbox() {
  try { cbProc?.kill('SIGKILL'); } catch {}
  resetHealthCache();
  await sleep(3000);
  startChatterbox();
  return waitForChatterbox(120);
}

async function ttsSentence(text, outPath) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; reject(new Error('TTS timeout 60s')); } }, 60000);
    chatterboxTTS(text, outPath)
      .then(() => { if (!done) { done = true; clearTimeout(t); resolve(); } })
      .catch(e  => { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}

async function ttsWithRetry(text, outPath, silDir, maxAttempts = 3) {
  const sil2s = path.join(silDir, '_silence-2000.wav');
  if (!fs.existsSync(sil2s)) {
    execSync(`ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 2.000 -c:a pcm_s16le "${sil2s}"`, { stdio: 'pipe' });
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) await restartChatterbox();
      await ttsSentence(text, outPath);
      return;
    } catch (err) {
      log(`  [TTS] Attempt ${attempt}/${maxAttempts}: ${err.message}`);
    }
  }
  log(`  [TTS] All failed — using silence for: "${text.slice(0, 50)}..."`);
  fs.copyFileSync(sil2s, outPath);
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
      const nextIsCapital  = /^[A-Z"']/.test(words[wi + 1] || '');
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

function ensureSilence(p, ms) {
  if (fs.existsSync(p)) return;
  execSync(`ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${(ms/1000).toFixed(3)} -c:a pcm_s16le "${p}"`, { stdio: 'pipe' });
}

// ─── PHILOSOPHY PIPELINE ──────────────────────────────────────────────────────

function spawnRender(video, slug) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'test-video-2min.js')], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        SLEEPFORGE_TOPIC:        video.topic,
        SLEEPFORGE_SLUG:         slug,
        SLEEPFORGE_DURATION:     '60',
        SLEEPFORGE_PHILOSOPHERS: video.philosophers,
        CHATTERBOX_TIMEOUT_MS:   '60000',
        FRAME_VARIANT:           '0',
      },
      cwd: ROOT,
    });
    const kill = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} reject(new Error('Render timeout 5h')); }, 18000000);
    child.on('close', c => { clearTimeout(kill); c === 0 ? resolve() : reject(new Error(`render exit ${c}`)); });
    child.on('error', e => { clearTimeout(kill); reject(e); });
  });
}

async function generate3PhilosophyVariants(outputDir, video, scriptText) {
  const tone = 'calm, meditative, philosophical, period-authentic ancient art, no modern faces, no contemporary makeup, no plucked eyebrows';
  const variants = [];

  const v1Dir = path.join(outputDir, 'thumb-v1');
  log('  Generating thumbnail variant 1...');
  let v1Path = null;
  try {
    v1Path = await generateThumbnailV3({ outputDir: v1Dir, title: video.title, scriptText, niche: 'philosophy', tone });
  } catch (e) { log(`  ⚠ Variant 1 failed: ${e.message.slice(0, 160)}`); }

  let lockedHook = null, lockedMetaphor = null;
  try {
    const hp = path.join(v1Dir, 'thumbnail-v3-hook.json');
    const mp = path.join(v1Dir, 'thumbnail-v3-metaphor.json');
    if (fs.existsSync(hp)) lockedHook     = JSON.parse(fs.readFileSync(hp, 'utf-8'));
    if (fs.existsSync(mp)) lockedMetaphor = JSON.parse(fs.readFileSync(mp, 'utf-8'));
  } catch {}

  const v1Score = readCriticScore(v1Dir);
  if (v1Path) variants.push({ pngPath: v1Path, dir: v1Dir, rating: v1Score.rating, attempt: 1 });

  for (let i = 2; i <= 3; i++) {
    const vDir = path.join(outputDir, `thumb-v${i}`);
    log(`  Generating thumbnail variant ${i}...`);
    let vPath = null;
    try {
      vPath = await generateThumbnailV3({ outputDir: vDir, title: video.title, scriptText, niche: 'philosophy', tone, _lockedHook: lockedHook, _lockedMetaphor: lockedMetaphor });
    } catch (e) { log(`  ⚠ Variant ${i} failed: ${e.message.slice(0, 160)}`); }
    const vScore = readCriticScore(vDir);
    if (vPath) variants.push({ pngPath: vPath, dir: vDir, rating: vScore.rating, attempt: i });
  }

  if (variants.length === 0) throw new Error('No philosophy thumbnail generated');
  variants.sort((a, b) => b.rating - a.rating);
  log(`  Best: variant ${variants[0].attempt} (${variants[0].rating}/10)`);
  return variants[0].pngPath;
}

async function refineTitlePhilosophy(video) {
  const prompt = `Generate 5 YouTube title candidates for a 1-hour philosophy sleep video.

TOPIC: ${video.topic}
TRADITION: ${video.tradition}
PHILOSOPHER: ${video.philosopher}
DRAFT TITLE: ${video.draftTitle}

PHILOSOPHY TITLE RULES (from 343-video channel analysis):
- Rule 1: NAME A SPECIFIC CONCEPT (solipsism, Zeno's paradoxes, determinism, Will to Power, Eternal Recurrence)
- Rule 2: Frame as ACTIVE FORCE: "Will Break / Mess With / Stick In / Prove / Change" — NOT "Most [Adj]"
- Rule 5: Sleep qualifier ONLY at end as suffix if needed ("...to Fall Asleep To") — never as headline

WINNING patterns (study these):
  "2 Hours of Philosophy That Will Break Your Beliefs"
  "Philosophy Paradoxes That Prove Time Doesn't Exist"
  "Zeno's Paradoxes: The Philosopher Who Proved Motion Is Impossible"
  "2 Hours of Nietzsche That Will Change How You See Yourself"
LOSING patterns (avoid):
  "The Most Calming Nietzsche for Sleep" (generic soft superlative)
  "Philosophy to Fall Asleep to" (sleep-first generic)

Return ONLY a JSON array of 5 strings:
["title 1", "title 2", "title 3", "title 4", "title 5"]`;

  let candidates = [video.draftTitle];
  try {
    const raw = await callClaudeCLI(prompt, { model: HAIKU, timeoutMs: 45000 });
    const m   = raw.match(/\[[\s\S]*\]/);
    if (m) candidates = JSON.parse(m[0]);
  } catch (e) { log(`  ⚠ Haiku title failed: ${e.message.slice(0, 80)}`); return video.draftTitle; }

  const pickPrompt = `You are a YouTube title expert for philosophy sleep channel "Sleepless Philosophers".
Pick the SINGLE BEST title. Optimise for: named concept, active intellectual force, 50-70 chars ideal.

PHILOSOPHY RULES: Title must name a SPECIFIC concept (Zeno paradoxes, Will to Power, Eternal Recurrence).
Never use generic soft superlatives. Never make sleep the headline.

CANDIDATES:
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return ONLY: {"winner_index": N, "title": "exact title", "reason": "one sentence"}`;

  try {
    const raw = await callClaudeCLI(pickPrompt, { model: SONNET, timeoutMs: 45000 });
    const m   = raw.match(/\{[\s\S]*\}/);
    if (!m) return candidates[0];
    const pick = JSON.parse(m[0]);
    log(`  Title: "${pick.title}" — ${pick.reason}`);
    return pick.title || candidates[0];
  } catch { return candidates[0]; }
}

async function processPhilosophyVideo(video, index) {
  logSection(`PHILOSOPHY ${index + 1}/2 — ${video.philosopher}`);
  const slug = slugify(video.topic);
  const outputDir = path.join(ROOT, 'output', slug);
  const finalPath = path.join(outputDir, 'final.mp4');
  const thumbDir  = path.join(outputDir, 'thumbnails');

  log(`  Slug: ${slug}`);
  log(`  Schedule: ${video.scheduledAt}`);

  // Disk check
  const free = getFreeDiskGb();
  log(`  Disk: ${free.toFixed(1)} GB free`);
  if (free < 10) { log('  Low disk — cleaning oldest output...'); cleanOldestOutputDir(); }

  // Step 1: Render via test-video-2min.js
  log('\n── Step 1: Render (60-min philosophy video) ──');
  if (fs.existsSync(finalPath)) {
    log(`  Cached final.mp4 found (${Math.round(fs.statSync(finalPath).size / 1024 / 1024)}MB)`);
  } else {
    if (DRY_RUN) { log('  [dry-run] Skipping render'); }
    else {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          log(`  Render attempt ${attempt}/2...`);
          await spawnRender(video, slug);
          if (!fs.existsSync(finalPath)) throw new Error('final.mp4 not found after render');
          break;
        } catch (e) {
          log(`  ✗ Render attempt ${attempt} failed: ${e.message.slice(0, 120)}`);
          if (attempt === 2) throw new Error(`All render attempts failed for ${video.topic}`);
        }
      }
    }
  }

  // Step 2: Title refinement
  log('\n── Step 2: Title refinement (5 Haiku → Sonnet) ──');
  const title = DRY_RUN ? video.draftTitle : await refineTitlePhilosophy(video);
  video.title = title;

  // Step 3: Thumbnails
  log('\n── Step 3: Philosophy thumbnails (3 variants, philosophy rules applied) ──');
  fs.mkdirSync(thumbDir, { recursive: true });
  let thumbnailPath = null;
  if (DRY_RUN) { log('  [dry-run] Skipping thumbnails'); }
  else {
    try {
      const scriptCachePath = path.join(ROOT, 'scripts', slug + '.json');
      let scriptText = '';
      if (fs.existsSync(scriptCachePath)) {
        const scenes = JSON.parse(fs.readFileSync(scriptCachePath, 'utf-8'));
        const sceneArr = Array.isArray(scenes) ? scenes : Object.values(scenes);
        scriptText = sceneArr.map(s => s.narration || '').join('\n\n').slice(0, 3000);
      }
      thumbnailPath = await generate3PhilosophyVariants(thumbDir, video, scriptText);
    } catch (e) { log(`  ⚠ Thumbnail generation failed: ${e.message}`); }
  }

  // Step 4: Metadata
  log('\n── Step 4: YouTube metadata ──');
  let meta = { title, description: '', tags: [] };
  try {
    meta = await generateMetadata(video.topic, [], PHIL_CONFIG);
    meta.title = title;
  } catch (e) { log(`  ⚠ Metadata failed: ${e.message}`); }

  // Step 5: Upload
  log('\n── Step 5: Upload (PRIVATE + publishAt) ──');
  log(`  Title: "${meta.title}"`);
  log(`  Schedule: ${video.scheduledAt}`);

  if (DRY_RUN) {
    log('  [dry-run] Upload skipped');
    return { topic: video.topic, title: meta.title, videoId: 'DRY_RUN', url: null, scheduledAt: video.scheduledAt, channel: video.channel };
  }

  if (!fs.existsSync(finalPath)) throw new Error(`final.mp4 missing: ${finalPath}`);

  const videoId = await uploadWithRetry({
    channelName:   'sleepless-philosophers',
    videoPath:     finalPath,
    title:         meta.title,
    description:   meta.description,
    tags:          meta.tags,
    thumbnailPath,
    scheduledAt:   new Date(video.scheduledAt),
    privacyStatus: 'private',
  });

  const url = `https://youtube.com/watch?v=${videoId}`;
  log(`  ✅ Uploaded: ${url} (private, scheduled: ${video.scheduledAt})`);
  return { topic: video.topic, title: meta.title, videoId, url, scheduledAt: video.scheduledAt, channel: video.channel };
}

// ─── ASTRONOMER PIPELINE ──────────────────────────────────────────────────────

async function processAstronomerVideo(video, index) {
  logSection(`ASTRONOMER ${index + 1}/2 — ${video.title}`);
  const slug = slugify(video.title);

  const OUTPUT_DIR    = path.join(ROOT, 'output', slug);
  const ASSETS_DIR    = path.join(OUTPUT_DIR, 'assets');
  const SENTENCES_DIR = path.join(ASSETS_DIR, 'sentences');
  const THUMB_DIR     = path.join(OUTPUT_DIR, 'thumbnail');
  const VOICEOVER     = path.join(ASSETS_DIR, 'voiceover.wav');
  const WHISPER_PATH  = path.join(ASSETS_DIR, 'whisper.json');
  const SLIDESHOW     = path.join(OUTPUT_DIR, 'slideshow.mp4');
  const VOICE_MIX     = path.join(OUTPUT_DIR, 'voice-mix.m4a');
  const BODY          = path.join(OUTPUT_DIR, 'body.mp4');
  const FINAL         = path.join(OUTPUT_DIR, 'final.mp4');
  const SCENES_CACHE  = path.join(OUTPUT_DIR, 'final-scenes.json');
  const TITLE_CACHE   = path.join(OUTPUT_DIR, 'title-candidates.json');
  const RAWSCRIPT     = path.join(SCRIPTS_DIR, `${slug}-batch-raw.json`);

  log(`  Slug: ${slug}`);
  log(`  Schedule: ${video.scheduledAt}`);

  for (const d of [OUTPUT_DIR, ASSETS_DIR, SENTENCES_DIR, THUMB_DIR]) fs.mkdirSync(d, { recursive: true });

  const free = getFreeDiskGb();
  log(`  Disk: ${free.toFixed(1)} GB free`);
  if (free < 10) { log('  Low disk — cleaning oldest output...'); cleanOldestOutputDir(); }

  // Step 1: Title candidates
  log('\n── Step 1: Title candidates ──');
  let titleResult;
  if (fs.existsSync(TITLE_CACHE)) {
    titleResult = JSON.parse(fs.readFileSync(TITLE_CACHE, 'utf-8'));
    log(`  Cached: "${titleResult.winner}"`);
  } else {
    titleResult = await generateAstronomerTitleCandidates({ title: video.title, angle: video.angle }, ASTRO_CONFIG);
    fs.writeFileSync(TITLE_CACHE, JSON.stringify(titleResult, null, 2));
    log(`  Winner: "${titleResult.winner}"`);
  }
  const VIDEO_TITLE = titleResult.winner;

  // Step 2: Script
  log('\n── Step 2: Script generation ──');
  let rawScenes;
  if (fs.existsSync(RAWSCRIPT)) {
    rawScenes = JSON.parse(fs.readFileSync(RAWSCRIPT, 'utf-8'));
    log(`  Cached: ${rawScenes.length} scenes`);
  } else {
    const result = await generateScript(video.title, { duration: 60, output: SCRIPTS_DIR, channelConfig: ASTRO_CONFIG });
    rawScenes = result.scenes;
    fs.writeFileSync(RAWSCRIPT, JSON.stringify(rawScenes, null, 2));
    log(`  Generated: ${rawScenes.length} scenes`);
  }

  // Step 3: Analyze + rewrite
  log('\n── Step 3: Analyze + rewrite ──');
  let finalScenes;
  if (fs.existsSync(SCENES_CACHE)) {
    finalScenes = JSON.parse(fs.readFileSync(SCENES_CACHE, 'utf-8'));
    log(`  Cached: ${finalScenes.length} scenes`);
  } else {
    const { finalScenes: fs2, history } = await analyzeAndRewrite(rawScenes, ASTRO_CONFIG, {
      topicSlug: slug, maxIterations: 5, targetScore: 8.0, saveIterations: true,
    });
    finalScenes = fs2;
    const bestScore = history.reduce((a, b) => a.score >= b.score ? a : b).score;
    log(`  Best score: ${bestScore}/10`);
    fs.writeFileSync(SCENES_CACHE, JSON.stringify(finalScenes, null, 2));
  }

  // Step 4: TTS
  log('\n── Step 4: Chatterbox TTS ──');
  if (!fs.existsSync(VOICEOVER)) {
    if (!(await waitForChatterbox(5))) {
      if (!(await restartChatterbox())) throw new Error('Chatterbox unavailable');
    }
    const sentences = splitSentences(finalScenes.map(s => s.narration).join('\n\n'));
    log(`  ${sentences.length} sentences`);
    const sil350 = path.join(ASSETS_DIR, '_silence-350.wav');
    const sil700 = path.join(ASSETS_DIR, '_silence-700.wav');
    ensureSilence(sil350, 350);
    ensureSilence(sil700, 700);
    const parts = [];
    for (let i = 0; i < sentences.length; i++) {
      const { text, paragraphEnd } = sentences[i];
      const p = path.join(SENTENCES_DIR, `s${String(i).padStart(3, '0')}.wav`);
      if (!fs.existsSync(p)) await ttsWithRetry(text, p, ASSETS_DIR, 3);
      parts.push(p);
      if (i < sentences.length - 1) parts.push(paragraphEnd ? sil700 : sil350);
      if ((i + 1) % Math.ceil(sentences.length / 10) === 0) {
        log(`  TTS: ${Math.round(100 * (i + 1) / sentences.length)}% (${i + 1}/${sentences.length})`);
      }
    }
    const concat = path.join(ASSETS_DIR, '_concat.txt');
    fs.writeFileSync(concat, parts.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concat}" -c:a pcm_s16le "${VOICEOVER}"`, { stdio: 'pipe' });
    fs.unlinkSync(concat);
  }
  const audioDur = getAudioDuration(VOICEOVER);
  log(`  Voiceover: ${audioDur.toFixed(1)}s (${(audioDur / 60).toFixed(1)} min)`);

  // Step 5: Whisper timestamps
  log('\n── Step 5: Whisper timestamps ──');
  let wordTs = [];
  if (fs.existsSync(WHISPER_PATH)) {
    wordTs = JSON.parse(fs.readFileSync(WHISPER_PATH, 'utf-8'));
    log(`  Cached: ${wordTs.length} words`);
  } else {
    const out = execSync(
      `"${PYTHON_BIN}" -c "import whisper,json;m=whisper.load_model('base');r=m.transcribe(r'${VOICEOVER}',word_timestamps=True,language='en');words=[{'word':w['word'].strip(),'start':round(w['start'],3),'end':round(w['end'],3)} for seg in r['segments'] for w in seg.get('words',[])];print(json.dumps(words))"`,
      { encoding: 'utf-8', timeout: 600000 }
    );
    wordTs = JSON.parse(out.trim());
    fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTs));
    log(`  ${wordTs.length} words`);
  }
  wordTs = filterWhisperSoundEffects(wordTs);

  // Step 6: Director storyboard
  log('\n── Step 6: Director storyboard ──');
  const { clips, matchLog } = await createStoryboard(finalScenes, wordTs, audioDur, {
    targetClipSec:      4,
    imageMatching:      ASTRO_CONFIG.image_matching,
    minClipDurationSec: ASTRO_CONFIG.min_clip_duration_seconds,
    maxClipDurationSec: ASTRO_CONFIG.max_clip_duration_seconds,
  });
  for (const clip of clips) {
    if (clip.imagePath && !path.isAbsolute(clip.imagePath)) clip.imagePath = path.join(ROOT, clip.imagePath);
  }
  const kwHits = (matchLog || []).filter(m => m.keyword !== '(fallback)').length;
  log(`  Clips: ${clips.length}  Keyword hits: ${kwHits}/${clips.length} (${Math.round(100 * kwHits / clips.length)}%)`);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'match-log.json'), JSON.stringify(matchLog || [], null, 2));

  // Step 7: FFmpeg
  log('\n── Step 7: FFmpeg composition ──');
  const particlesPath = await ensureParticleLoop();
  const smokePath     = ensureSmokeLoop();
  for (const p of [SLIDESHOW, VOICE_MIX, BODY, FINAL]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  createClipSlideshow(clips, Math.ceil(audioDur), SLIDESHOW, { fadeTime: 1.5 });
  mixAudio(VOICEOVER, Math.ceil(audioDur), VOICE_MIX, { includeBgMusic: true, bgMusicVolume: '0.25', fireplaceVolume: '0.08' });
  composeFinalVideoWithBg({
    bgImagePath: null, slideshowPath: SLIDESHOW, particlesPath, smokePath,
    assPath: null, voiceAudioPath: VOICE_MIX, bgMusicPath: null, framePath: null,
    outputPath: BODY, duration: audioDur, introDuration: 0, fullscreen: true,
  });
  prependIntroVideo(INTRO_PATH, BODY, FINAL);
  const finalMB = Math.round(fs.statSync(FINAL).size / 1024 / 1024);
  log(`  Final: ${finalMB} MB`);

  // Step 8: Thumbnail (AstroKobi, 3 attempts)
  log('\n── Step 8: AstroKobi thumbnail ──');
  let thumbnailPath = null;
  let thumbScore    = null;
  try {
    const scriptText = finalScenes.map(s => s.narration).join('\n\n').slice(0, 3000);
    thumbnailPath = await generateThumbnailV3({ outputDir: THUMB_DIR, title: VIDEO_TITLE, scriptText, channelConfig: ASTRO_CONFIG });
    const rf = path.join(THUMB_DIR, 'thumbnail-v3-review.json');
    if (fs.existsSync(rf)) thumbScore = JSON.parse(fs.readFileSync(rf, 'utf-8')).rating;
    log(`  Score: ${thumbScore ?? '?'}/10`);
  } catch (e) { log(`  ⚠ Thumbnail failed: ${e.message}`); }

  // Step 9: Metadata
  log('\n── Step 9: YouTube metadata ──');
  const meta = await generateMetadata(video.title, finalScenes, ASTRO_CONFIG);
  meta.title = VIDEO_TITLE;

  // Step 10: Upload
  log('\n── Step 10: Upload (PRIVATE + publishAt) ──');
  log(`  Title: "${meta.title}"`);
  log(`  Schedule: ${video.scheduledAt}`);

  if (DRY_RUN) {
    log('  [dry-run] Upload skipped');
    return { topic: video.title, title: meta.title, videoId: 'DRY_RUN', url: null, scheduledAt: video.scheduledAt, channel: video.channel };
  }

  const videoId = await uploadWithRetry({
    channelName:   'sleepless-astronomer',
    videoPath:     FINAL,
    title:         meta.title,
    description:   meta.description,
    tags:          meta.tags,
    thumbnailPath,
    scheduledAt:   new Date(video.scheduledAt),
    privacyStatus: 'private',
  });

  const url = `https://youtube.com/watch?v=${videoId}`;
  log(`  ✅ Uploaded: ${url} (private, scheduled: ${video.scheduledAt})`);
  return { topic: video.title, title: meta.title, videoId, url, scheduledAt: video.scheduledAt, channel: video.channel, thumbScore, finalMB };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const BATCH_TS    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const REPORT_PATH = path.join(ROOT, 'data', `overnight-may19-${BATCH_TS}.md`);
const batchStart  = Date.now();

log('═'.repeat(58));
log('SleepForge — Overnight Batch 2026-05-20');
log(`Videos: 4 (2 Philosophy + 2 Astronomer)  DRY_RUN: ${DRY_RUN}`);
log(`Start: ${new Date().toISOString()}`);
log('═'.repeat(58));

// Start Chatterbox (shared by both channels)
log('\n── Starting Chatterbox server ──');
startChatterbox();
const cbReady = await waitForChatterbox(300);
if (!cbReady) { log('FATAL: Chatterbox failed to start'); process.exit(1); }
log('  Chatterbox healthy ✓');

const results = [];
const errors  = [];

// Process Philosophy videos first
const philVideos = VIDEOS.filter(v => v.channel === 'sleepless-philosophers');
for (let i = 0; i < philVideos.length; i++) {
  try {
    const r = await processPhilosophyVideo(philVideos[i], i);
    results.push(r);
  } catch (err) {
    log(`\n✗ PHILOSOPHY ${i + 1} FATAL: ${err.message}`);
    errors.push({ channel: 'philosophers', index: i + 1, error: err.message });
    const errorLog = path.join(ROOT, 'data', `overnight-fatal-phil-${i + 1}-${BATCH_TS}.md`);
    fs.writeFileSync(errorLog, `# Fatal Error — Philosophy ${i + 1}\n\n${err.stack}`);
  }
}

// Process Astronomer videos
const astroVideos = VIDEOS.filter(v => v.channel === 'sleepless-astronomer');
for (let i = 0; i < astroVideos.length; i++) {
  try {
    const r = await processAstronomerVideo(astroVideos[i], i);
    results.push(r);
  } catch (err) {
    log(`\n✗ ASTRONOMER ${i + 1} FATAL: ${err.message}`);
    errors.push({ channel: 'astronomer', index: i + 1, error: err.message });
    const errorLog = path.join(ROOT, 'data', `overnight-fatal-astro-${i + 1}-${BATCH_TS}.md`);
    fs.writeFileSync(errorLog, `# Fatal Error — Astronomer ${i + 1}\n\n${err.stack}`);
  }
}

await closeBrowser();
try { cbProc?.kill('SIGKILL'); } catch {}

// Write final report
const totalSec  = Math.round((Date.now() - batchStart) / 1000);
const reportLines = [
  `# SleepForge — Overnight Batch 2026-05-20`,
  `Generated: ${new Date().toISOString()}`,
  `Duration: ${Math.floor(totalSec / 60)}m ${totalSec % 60}s`,
  ``,
  `## Results (${results.length}/4 successful)`,
  ``,
];

for (const r of results) {
  reportLines.push(`### ${r.channel} — ${r.title}`);
  reportLines.push(`- **Video ID:** ${r.videoId}`);
  if (r.url) reportLines.push(`- **URL:** ${r.url}`);
  reportLines.push(`- **Scheduled:** ${r.scheduledAt}`);
  if (r.thumbScore != null) reportLines.push(`- **Thumb score:** ${r.thumbScore}/10`);
  if (r.finalMB)  reportLines.push(`- **File size:** ${r.finalMB} MB`);
  reportLines.push('');
}

if (errors.length > 0) {
  reportLines.push(`## Errors (${errors.length})`);
  for (const e of errors) reportLines.push(`- ${e.channel} ${e.index}: ${e.error}`);
}

fs.writeFileSync(REPORT_PATH, reportLines.join('\n'));
log(`\n✅ Batch complete. Report: ${REPORT_PATH}`);
log(`   Results: ${results.length}/4  Errors: ${errors.length}`);
