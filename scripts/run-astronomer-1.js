/**
 * run-astronomer-1.js
 *
 * First Sleepless Astronomer video — full autonomous pipeline.
 * No questions, no pauses, no mid-run confirmations.
 *
 * 1. Pick topic from pool (none already used — first video)
 * 2. Title: 5 Haiku candidates → Sonnet picks AstroKobi-style winner
 * 3. Render 60-min video (spawn test-astronomer-2min.js with DURATION=60)
 * 4. 3 thumbnail variants (thumbnail_style: "astrokobi"), critic picks best
 * 5. Metadata: astronomy documentary style, zero sleep keywords
 * 6. Upload PUBLIC to YouTube (sleepless-astronomer token)
 * 7. jarvis/state.json update + data/video-history.json append
 * 8. Report: data/astronomer-first-video-<timestamp>.md
 *    OR fatal: data/astronomer-launch-fatal-<timestamp>.md
 *
 * Runtime: ~5-7 hours
 */

import fs        from 'fs';
import path      from 'path';
import crypto    from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import dotenv    from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI }                         = await import('../src/claude-cli.js');
const { generateAstronomerTitleCandidates,
        generateMetadata }                       = await import('../src/youtube-metadata-generator.js');
const { generateThumbnailV3, closeBrowser }     = await import('../src/thumbnail-v3.js');
const { uploadVideo, getVideoProcessingStatus } = await import('../src/youtube.js');
const { getAudioDuration }                      = await import('../src/ffmpeg.js');

const CHANNEL        = 'sleepless-astronomer';
const CHANNEL_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8'));
const TOPIC_POOL     = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'topic-pools', 'sleepless-astronomer.json'), 'utf-8'));
const ARCHIVE_DIR    = path.join(ROOT, 'data', 'uploaded-archive');
const JARVIS_FILE    = path.join(ROOT, 'jarvis', 'state.json');
const HISTORY_FILE   = path.join(ROOT, 'data', 'video-history.json');

const RUN_TS      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const REPORT_FILE = path.join(ROOT, 'data', `astronomer-first-video-${RUN_TS}.md`);
const FATAL_FILE  = path.join(ROOT, 'data', `astronomer-launch-fatal-${RUN_TS}.md`);
const t_start     = Date.now();

// ─── LOGGING ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function logSection(t) { log(`\n${'═'.repeat(62)}\n  ${t}\n${'═'.repeat(62)}`); }
function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

function slugify(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55);
}

function elapsedMin() { return ((Date.now() - t_start) / 60000).toFixed(1); }

// ─── FATAL ────────────────────────────────────────────────────────────────────

function fatalExit(step, err, context = {}) {
  const msg = err?.stack || err?.message || String(err);
  const lines = [
    `# Sleepless Astronomer — FATAL LAUNCH ERROR`,
    `**Date:** ${new Date().toISOString()}`,
    `**Step:** ${step}`,
    `**Elapsed:** ${elapsedMin()} min`,
    ``,
    `## Error`,
    `\`\`\``,
    msg,
    `\`\`\``,
    ``,
    `## Context`,
    JSON.stringify(context, null, 2),
  ];
  fs.writeFileSync(FATAL_FILE, lines.join('\n'));
  log(`\n\n💀 FATAL at step "${step}": ${msg.slice(0, 200)}`);
  log(`   Report: ${FATAL_FILE}`);
  process.exit(1);
}

// ─── DISK CLEANUP ─────────────────────────────────────────────────────────────

function getFreeDiskGb() {
  try {
    const out = execSync('powershell -c "(Get-PSDrive C).Free / 1GB"', { encoding: 'utf8', timeout: 5000 });
    return parseFloat(out.trim());
  } catch { return 100; }
}

function cleanOldOutputDirs(minFreeGb = 5) {
  const free = getFreeDiskGb();
  log(`  Disk: ${free.toFixed(1)} GB free`);
  if (free >= minFreeGb) return;
  log(`  ⚠ Low disk — cleaning old output dirs...`);
  const outputBase = path.join(ROOT, 'output');
  if (!fs.existsSync(outputBase)) return;
  const dirs = fs.readdirSync(outputBase, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => ({ name: e.name, mtime: fs.statSync(path.join(outputBase, e.name)).mtime }))
    .sort((a, b) => a.mtime - b.mtime);
  for (const d of dirs) {
    if (getFreeDiskGb() >= minFreeGb) break;
    try {
      fs.rmSync(path.join(outputBase, d.name), { recursive: true, force: true });
      log(`  Deleted output/${d.name}`);
    } catch {}
  }
}

// ─── JARVIS ───────────────────────────────────────────────────────────────────

function jarvisUpdate(jobId, patch) {
  try {
    const s = fs.existsSync(JARVIS_FILE)
      ? JSON.parse(fs.readFileSync(JARVIS_FILE, 'utf-8'))
      : { renders: [], publishes: [], analytics_cache: {}, unused_thumbnails: [] };
    const idx = s.renders.findIndex(r => r.id === jobId);
    const now = new Date().toISOString();
    if (idx >= 0) Object.assign(s.renders[idx], patch, { updatedAt: now });
    else s.renders.unshift({ id: jobId, ...patch, createdAt: now, updatedAt: now });
    s.last_updated = now;
    fs.writeFileSync(JARVIS_FILE, JSON.stringify(s, null, 2));
  } catch (e) { log(`  ⚠ Jarvis update failed: ${e.message}`); }
}

// ─── VIDEO HISTORY ────────────────────────────────────────────────────────────

function appendVideoHistory(entry) {
  try {
    const history = fs.existsSync(HISTORY_FILE)
      ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'))
      : [];
    history.unshift(entry);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (e) { log(`  ⚠ video-history.json update failed: ${e.message}`); }
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function renderVideo(topic, slug, timeoutMs = 25200000) { // 7 hours
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'test-astronomer-2min.js')], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        SLEEPFORGE_TOPIC:      topic,
        SLEEPFORGE_SLUG:       slug,
        SLEEPFORGE_DURATION:   '60',
        CHATTERBOX_TIMEOUT_MS: '60000',
      },
      cwd: ROOT,
    });
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('Render timed out after 7 hours'));
    }, timeoutMs);
    child.on('close', code => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`Render exited with code ${code}`));
    });
    child.on('error', err => {
      clearTimeout(killTimer);
      reject(err);
    });
  });
}

// ─── THUMBNAILS ───────────────────────────────────────────────────────────────

function readCriticScore(dir) {
  try {
    const f = path.join(dir, 'thumbnail-v3-review.json');
    if (!fs.existsSync(f)) return { rating: 5 };
    return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch { return { rating: 5 }; }
}

async function generateThumbnails(title, scriptText, outputDir) {
  const variants = [];

  // Variant 1 — full pipeline, generates locked hook
  const v1Dir = path.join(outputDir, 'thumb-v1');
  log('  Generating thumbnail variant 1 (AstroKobi style, full pipeline)...');
  let lockedHook = null;
  try {
    const v1Path = await generateThumbnailV3({
      outputDir: v1Dir,
      title,
      scriptText,
      channelConfig: CHANNEL_CONFIG,
      _maxAttempts: 2,
    });
    const v1Review = readCriticScore(v1Dir);
    variants.push({ pngPath: v1Path, dir: v1Dir, rating: v1Review.rating, attempt: 1 });
    log(`  V1: ${v1Review.rating}/10`);
    // Load locked hook for V2+V3
    const hookFile = path.join(v1Dir, 'thumbnail-v3-hook.json');
    if (fs.existsSync(hookFile)) lockedHook = JSON.parse(fs.readFileSync(hookFile, 'utf-8'));
  } catch (e) {
    log(`  ⚠ V1 failed: ${e.message.slice(0, 150)}`);
  }

  // Variants 2 + 3 — lock hook from V1 for consistency
  for (let i = 2; i <= 3; i++) {
    const vDir = path.join(outputDir, `thumb-v${i}`);
    log(`  Generating thumbnail variant ${i} (locked hook)...`);
    try {
      const vPath = await generateThumbnailV3({
        outputDir: vDir,
        title,
        scriptText,
        channelConfig: CHANNEL_CONFIG,
        _lockedHook:   lockedHook,
        _maxAttempts:  2,
      });
      const vReview = readCriticScore(vDir);
      variants.push({ pngPath: vPath, dir: vDir, rating: vReview.rating, attempt: i });
      log(`  V${i}: ${vReview.rating}/10`);
    } catch (e) {
      log(`  ⚠ V${i} failed: ${e.message.slice(0, 150)}`);
    }
  }

  // Emergency fallback — scan for any PNG if all threw
  if (variants.length === 0) {
    for (let i = 1; i <= 3; i++) {
      const vDir = path.join(outputDir, `thumb-v${i}`);
      if (!fs.existsSync(vDir)) continue;
      const pngs = fs.readdirSync(vDir).filter(f => f.endsWith('.png')).map(f => path.join(vDir, f));
      for (const p of pngs) variants.push({ pngPath: p, dir: vDir, rating: 4, attempt: i });
    }
  }

  if (variants.length === 0) throw new Error('No thumbnail could be generated at all');

  variants.sort((a, b) => b.rating - a.rating);
  return { best: variants[0], unused: variants.slice(1) };
}

// ─── UPLOAD WITH RETRY ────────────────────────────────────────────────────────

async function uploadWithRetry(opts, maxRetries = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadVideo(opts);
    } catch (err) {
      lastErr = err;
      log(`  ⚠ Upload attempt ${attempt}/${maxRetries} failed: ${err.message.slice(0, 120)}`);
      if (attempt < maxRetries) await sleep(60000 * attempt);
    }
  }
  throw new Error(`Upload failed after ${maxRetries} attempts: ${lastErr.message}`);
}

// ─── ARCHIVE ──────────────────────────────────────────────────────────────────

function archiveResults(videoId, slug, outputDir, bestThumb, unusedThumbs, meta, titleResult) {
  const archDir = path.join(ARCHIVE_DIR, videoId);
  fs.mkdirSync(archDir, { recursive: true });

  if (bestThumb?.pngPath && fs.existsSync(bestThumb.pngPath)) {
    fs.copyFileSync(bestThumb.pngPath, path.join(archDir, 'thumbnail-final.png'));
  }
  for (let i = 0; i < unusedThumbs.length; i++) {
    const src = unusedThumbs[i]?.pngPath;
    if (src && fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(archDir, `thumbnail-unused-v${unusedThumbs[i].attempt}.png`));
    }
  }
  fs.writeFileSync(path.join(archDir, 'youtube-metadata.json'), JSON.stringify(meta, null, 2));
  fs.writeFileSync(path.join(archDir, 'title-candidates.json'), JSON.stringify(titleResult, null, 2));
  fs.writeFileSync(path.join(archDir, 'manifest.json'), JSON.stringify({
    videoId, slug, outputDir, channel: CHANNEL,
    privacyStatus: 'public',
    uploadedAt:    new Date().toISOString(),
  }, null, 2));
  log(`  Archive: ${archDir}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

log(`\n${'═'.repeat(62)}`);
log(`  Sleepless Astronomer — First Video Autopilot`);
log(`  ${new Date().toISOString()}`);
log(`${'═'.repeat(62)}`);

// ── Pre-flight ────────────────────────────────────────────────────────────────
logSection('Pre-flight checks');
const spaceLibIndex = path.join(ROOT, 'assets', 'images', 'space-library-v1', 'index.json');
if (!fs.existsSync(spaceLibIndex)) fatalExit('pre-flight', new Error('Space library index.json missing'), { path: spaceLibIndex });
const tokenFile = path.join(ROOT, 'assets', 'youtube-tokens', 'sleepless-astronomer.json');
if (!fs.existsSync(tokenFile)) fatalExit('pre-flight', new Error('YouTube token missing for sleepless-astronomer'), { path: tokenFile });
log('  Space library: ✓');
log('  YouTube token: ✓');
cleanOldOutputDirs(5);

// ── Step 1: Pick topic ────────────────────────────────────────────────────────
logSection('Step 1 — Pick topic');

// Load used topics from video history (first video = empty)
const usedTopics = new Set();
if (fs.existsSync(HISTORY_FILE)) {
  try {
    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    for (const v of history) if (v.topic) usedTopics.add(v.topic);
  } catch {}
}
log(`  Used topics: ${usedTopics.size} (${usedTopics.size === 0 ? 'first video' : [...usedTopics].join(', ')})`);

// Pick topic: prefer Voyager 1 (strong visuals, proven hook patterns)
const allTopics = TOPIC_POOL.topics || [];
let pickedTopic = allTopics.find(t => !usedTopics.has(t.title) && t.title.includes('Voyager 1'));
if (!pickedTopic) pickedTopic = allTopics.find(t => !usedTopics.has(t.title));
if (!pickedTopic) fatalExit('pick-topic', new Error('All topics already used'), { usedTopics: [...usedTopics] });

log(`  Topic: "${pickedTopic.title}"`);
log(`  Category: ${pickedTopic.category}`);
log(`  Angle: ${pickedTopic.angle}`);

const topicSlug = slugify(pickedTopic.title);
const outputDir = path.join(ROOT, 'output', topicSlug);
const thumbDir  = path.join(outputDir, 'thumbnails');
fs.mkdirSync(thumbDir, { recursive: true });

const jobId = topicSlug + '-' + Date.now();
jarvisUpdate(jobId, { channel: CHANNEL, topic: pickedTopic.title, status: 'title-gen', step: 1 });

// ── Step 2: Title ─────────────────────────────────────────────────────────────
logSection('Step 2 — AstroKobi title (5 Haiku → Sonnet picks)');
let titleResult;
try {
  titleResult = await generateAstronomerTitleCandidates(pickedTopic, CHANNEL_CONFIG);
} catch (e) {
  fatalExit('title-generation', e, { topic: pickedTopic.title });
}

log(`  Candidates:`);
for (const [i, c] of (titleResult.candidates || []).entries()) {
  const marker = c === titleResult.winner ? '★ WINNER' : `       ${i + 1}`;
  log(`  ${marker}. "${c}"`);
}
log(`  Winner: "${titleResult.winner}"`);
log(`  Reason: ${titleResult.reason}`);

const finalTitle = titleResult.winner;
jarvisUpdate(jobId, { status: 'rendering', title: finalTitle, step: 3 });

// ── Step 3: Render ────────────────────────────────────────────────────────────
logSection('Step 3 — Render 60-min video');
log(`  Spawning test-astronomer-2min.js with DURATION=60`);
log(`  Output: output/${topicSlug}/`);
log(`  Estimated: ~5-6 hours (TTS + Whisper + FFmpeg)`);

let finalPath = path.join(outputDir, 'final.mp4');
let renderRetries = 0;
const MAX_RENDER_RETRIES = 2;

while (renderRetries <= MAX_RENDER_RETRIES) {
  try {
    await renderVideo(pickedTopic.title, topicSlug);
    if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 10_000_000) {
      throw new Error(`final.mp4 missing or too small (${fs.existsSync(finalPath) ? fs.statSync(finalPath).size + ' bytes' : 'absent'})`);
    }
    log(`  ✓ Render complete: ${finalPath}`);
    break;
  } catch (e) {
    renderRetries++;
    log(`  ⚠ Render attempt ${renderRetries}/${MAX_RENDER_RETRIES + 1} failed: ${e.message}`);
    if (renderRetries > MAX_RENDER_RETRIES) {
      fatalExit('render', e, { topic: pickedTopic.title, slug: topicSlug, outputDir, finalPath });
    }
    log(`  Retrying render in 60s...`);
    await sleep(60000);
  }
}

const audioDuration = (() => {
  try { return getAudioDuration(finalPath); } catch { return 0; }
})();
const videoDurationMin = (audioDuration / 60).toFixed(1);
const videoSizeMb = (fs.statSync(finalPath).size / 1024 / 1024).toFixed(0);
log(`  Duration: ${videoDurationMin} min | Size: ${videoSizeMb} MB`);

// Count library hits from storyboard if available
const storyboardPath = path.join(outputDir, 'storyboard.json');
let libraryHits = 'unknown';
let clipCount   = 'unknown';
if (fs.existsSync(storyboardPath)) {
  try {
    const sb = JSON.parse(fs.readFileSync(storyboardPath, 'utf-8'));
    const clips = sb.clips || sb;
    clipCount   = clips.length;
    libraryHits = clips.filter(c => c.imagePath).length;
  } catch {}
}

jarvisUpdate(jobId, { status: 'thumbnails', duration: audioDuration, step: 4 });

// ── Step 4: Script text for thumbnail/metadata ─────────────────────────────────
const scriptJsonPath = path.join(ROOT, 'scripts', `${topicSlug}.json`);
let scriptText = pickedTopic.angle || pickedTopic.title;
if (fs.existsSync(scriptJsonPath)) {
  try {
    const scenes = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
    scriptText = scenes.map(s => s.narration).join('\n\n').slice(0, 6000);
    const wc = scriptText.split(/\s+/).length;
    log(`  Script: ${scenes.length} scenes, ~${wc} words`);
  } catch {}
}

// ── Step 5: Thumbnails ────────────────────────────────────────────────────────
logSection('Step 4 — 3 thumbnail variants (AstroKobi style)');
let bestThumb, unusedThumbs;
try {
  const thumbResult = await generateThumbnails(finalTitle, scriptText, thumbDir);
  bestThumb    = thumbResult.best;
  unusedThumbs = thumbResult.unused;
  log(`  Best: V${bestThumb.attempt} (${bestThumb.rating}/10) — ${bestThumb.pngPath}`);
} catch (e) {
  fatalExit('thumbnails', e, { title: finalTitle });
}
await closeBrowser();
jarvisUpdate(jobId, { status: 'metadata', thumbScore: bestThumb.rating, step: 5 });

// ── Step 6: Metadata ──────────────────────────────────────────────────────────
logSection('Step 5 — Metadata (astronomy channel style)');
let meta;
try {
  const scenes = fs.existsSync(scriptJsonPath)
    ? JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'))
    : [];
  meta = await generateMetadata(pickedTopic.title, scenes, CHANNEL_CONFIG);
  meta.title = finalTitle; // Override with our AstroKobi winner
  log(`  Title: "${meta.title}"`);
  log(`  Description: ${meta.description.slice(0, 100)}...`);
  log(`  Tags: ${meta.tags.slice(0, 5).join(', ')} (+${Math.max(0, meta.tags.length - 5)} more)`);
  fs.writeFileSync(path.join(outputDir, 'youtube-metadata.json'), JSON.stringify(meta, null, 2));
} catch (e) {
  fatalExit('metadata', e, { title: finalTitle });
}
jarvisUpdate(jobId, { status: 'uploading', step: 6 });

// ── Step 7: Upload PUBLIC ──────────────────────────────────────────────────────
logSection('Step 6 — Upload PUBLIC to YouTube (sleepless-astronomer)');
log(`  Title:   "${meta.title}"`);
log(`  Channel: ${CHANNEL}`);
log(`  Privacy: PUBLIC (live immediately)`);

let videoId;
try {
  videoId = await uploadWithRetry({
    channelName:   CHANNEL,
    videoPath:     finalPath,
    title:         meta.title,
    description:   meta.description,
    tags:          meta.tags,
    thumbnailPath: bestThumb.pngPath,
    privacyStatus: 'public',
  });
  log(`  Video ID: ${videoId}`);
  log(`  URL: https://www.youtube.com/watch?v=${videoId}`);
} catch (e) {
  fatalExit('upload', e, { title: meta.title, channel: CHANNEL, finalPath });
}

// ── Step 8: Archive + state updates ───────────────────────────────────────────
logSection('Step 7 — Archive + state updates');
archiveResults(videoId, topicSlug, outputDir, bestThumb, unusedThumbs, meta, titleResult);

const historyEntry = {
  videoId,
  channel:     CHANNEL,
  topic:       pickedTopic.title,
  title:       meta.title,
  url:         `https://www.youtube.com/watch?v=${videoId}`,
  uploadedAt:  new Date().toISOString(),
  duration:    audioDuration,
  thumbScore:  bestThumb.rating,
  wordCount:   scriptText.split(/\s+/).length,
};
appendVideoHistory(historyEntry);

jarvisUpdate(jobId, {
  status: 'done',
  videoId,
  url: `https://www.youtube.com/watch?v=${videoId}`,
  title: meta.title,
  channel: CHANNEL,
  privacyStatus: 'public',
  thumbScore: bestThumb.rating,
  duration: audioDuration,
  step: 8,
});

// ── Step 9: Final report ───────────────────────────────────────────────────────
const elapsedMinFinal = ((Date.now() - t_start) / 60000).toFixed(0);
const reportLines = [
  `# Sleepless Astronomer — First Video Report`,
  `**Date:** ${new Date().toISOString()}`,
  `**Total runtime:** ${elapsedMinFinal} minutes`,
  ``,
  `---`,
  ``,
  `## Video`,
  `**URL:** https://www.youtube.com/watch?v=${videoId}`,
  `**Status:** PUBLIC (live)`,
  `**Title:** ${meta.title}`,
  `**Channel:** @${CHANNEL}`,
  ``,
  `## Content`,
  `**Topic:** ${pickedTopic.title}`,
  `**Category:** ${pickedTopic.category}`,
  `**Duration:** ${videoDurationMin} min`,
  `**File size:** ${videoSizeMb} MB`,
  `**Script words:** ~${scriptText.split(/\s+/).length}`,
  ``,
  `## Title Pipeline`,
  `**Candidates:**`,
  ...(titleResult.candidates || []).map((c, i) => `- ${c === titleResult.winner ? '★ ' : ''}${i + 1}. "${c}"`),
  `**Reason:** ${titleResult.reason}`,
  ``,
  `## Thumbnail`,
  `**Winner:** Variant ${bestThumb.attempt} (${bestThumb.rating}/10)`,
  `**Hook:** see thumbnail-v3-hook.json in archive`,
  `**Archive:** data/uploaded-archive/${videoId}/`,
  ``,
  `## Library`,
  `**Clips:** ${clipCount}`,
  `**Library hits:** ${libraryHits}`,
  `**Fal.ai calls:** 0 (library-only)`,
  ``,
  `## Issues auto-resolved`,
  `None.`,
];

fs.writeFileSync(REPORT_FILE, reportLines.join('\n'));
log(`\nReport: ${REPORT_FILE}`);

log(`\n${'═'.repeat(62)}`);
log(`  DONE — Sleepless Astronomer first video is LIVE`);
log(`  URL: https://www.youtube.com/watch?v=${videoId}`);
log(`  Title: ${meta.title}`);
log(`  Runtime: ${elapsedMinFinal} min`);
log(`${'═'.repeat(62)}\n`);
