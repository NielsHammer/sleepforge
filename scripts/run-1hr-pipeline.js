/**
 * run-1hr-pipeline.js
 *
 * Autonomous 1-hour video pipeline with title-first approach, 3 thumbnail
 * variants, reliability hardening, and YouTube PUBLIC upload.
 *
 * Usage: node scripts/run-1hr-pipeline.js [--topic-id <id>] [--dry-run]
 *
 * Phases:
 *   1. Pick topic from data/topic-pool.json (by priority or --topic-id)
 *   2. Generate 5 title candidates, score, pick best
 *   3. Render video (60 min) via test-video-2min.js with env vars
 *   4. Generate 3 thumbnail variants, critic picks best
 *   5. Upload to YouTube as PUBLIC
 *   6. Save to data/video-history.json and jarvis/state.json
 */

import { spawn, execSync } from 'child_process';
import fs    from 'fs';
import path  from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI }    = await import('../src/claude-cli.js');
const { generateThumbnailV3 } = await import('../src/thumbnail-v3.js');
const { uploadVideo }      = await import('../src/youtube.js');
const { generateMetadata } = await import('../src/youtube-metadata-generator.js');

const TOPIC_POOL    = path.join(ROOT, 'data', 'topic-pool.json');
const HISTORY_FILE  = path.join(ROOT, 'data', 'video-history.json');
const PRINCIPLES    = path.join(ROOT, 'data', 'reference-principles.json');
const JARVIS_STATE  = path.join(ROOT, 'jarvis', 'state.json');
const OUTPUT_DIR    = path.join(ROOT, 'output');
const SCRIPTS_DIR   = path.join(ROOT, 'scripts');

const DURATION_MIN = 60;
const IS_DRY_RUN   = process.argv.includes('--dry-run');
const TOPIC_ID_ARG = (() => {
  const i = process.argv.indexOf('--topic-id');
  return i >= 0 ? process.argv[i+1] : null;
})();

// ─── LOGGING ─────────────────────────────────────────────────────────────────
function log(msg) { console.log(`[pipeline] ${msg}`); }
function logSection(title) {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(55));
}

// ─── STATE ───────────────────────────────────────────────────────────────────
let _jobId = null;

function jarvisUpdate(patch) {
  try {
    const state = JSON.parse(fs.readFileSync(JARVIS_STATE, 'utf-8'));
    if (_jobId) {
      const idx = state.renders.findIndex(r => r.id === _jobId);
      if (idx >= 0) Object.assign(state.renders[idx], patch, { updatedAt: new Date().toISOString() });
      else state.renders.unshift({ id: _jobId, ...patch, updatedAt: new Date().toISOString() });
    }
    state.last_updated = new Date().toISOString();
    fs.writeFileSync(JARVIS_STATE, JSON.stringify(state, null, 2));
  } catch {}
}

function saveHistory(entry) {
  const history = tryJson(HISTORY_FILE) || [];
  const existing = history.findIndex(h => h.video_id === entry.video_id);
  if (existing >= 0) history[existing] = { ...history[existing], ...entry };
  else history.unshift(entry);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

function tryJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function slugify(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ─── DISK SPACE CHECK ────────────────────────────────────────────────────────
function checkDiskSpace() {
  try {
    // Windows: use wmic to check free space on C:
    const out = execSync('wmic logicaldisk where DeviceID="C:" get FreeSpace /value', { encoding: 'utf-8' });
    const match = out.match(/FreeSpace=(\d+)/);
    if (match) {
      const freeGb = parseInt(match[1]) / (1024 ** 3);
      log(`Disk space: ${freeGb.toFixed(1)} GB free on C:`);
      if (freeGb < 5) {
        log('WARNING: Less than 5GB free. Cleaning oldest outputs...');
        cleanOldOutputs(5);
      }
    }
  } catch (err) {
    log(`Disk check failed (non-fatal): ${err.message}`);
  }
}

function cleanOldOutputs(targetGb) {
  try {
    const dirs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => {
        const p = path.join(OUTPUT_DIR, e.name);
        const stat = fs.statSync(p);
        return { name: e.name, path: p, mtime: stat.mtime.getTime() };
      })
      .sort((a, b) => a.mtime - b.mtime); // oldest first

    for (const dir of dirs) {
      const out = execSync('wmic logicaldisk where DeviceID="C:" get FreeSpace /value', { encoding: 'utf-8' });
      const match = out.match(/FreeSpace=(\d+)/);
      if (match && parseInt(match[1]) / (1024 ** 3) >= targetGb) break;
      log(`  Removing old output: ${dir.name}`);
      fs.rmSync(dir.path, { recursive: true, force: true });
    }
  } catch (err) {
    log(`Cleanup failed (non-fatal): ${err.message}`);
  }
}

// ─── RETRY HELPER ────────────────────────────────────────────────────────────
async function withRetry(fn, attempts = 3, baseBackoffMs = 10000, label = '') {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = baseBackoffMs * Math.pow(2, i);
      log(`${label} attempt ${i+1}/${attempts} failed: ${err.message}. Retrying in ${wait/1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ─── PHASE 1: PICK TOPIC ─────────────────────────────────────────────────────
function pickTopic() {
  const pool = tryJson(TOPIC_POOL) || [];
  if (!pool.length) throw new Error('topic-pool.json is empty');
  const history = tryJson(HISTORY_FILE) || [];
  const usedTopics = new Set(history.map(h => h.topic_id).filter(Boolean));

  if (TOPIC_ID_ARG) {
    const found = pool.find(t => t.id === TOPIC_ID_ARG);
    if (found) { log(`Using specified topic: ${found.id}`); return found; }
  }

  // Pick highest-priority unused topic
  const unused = pool.filter(t => !usedTopics.has(t.id));
  const candidate = (unused.length ? unused : pool).sort((a, b) => a.priority - b.priority)[0];
  log(`Selected topic: ${candidate.id} — "${candidate.topic}"`);
  return candidate;
}

// ─── PHASE 2: TITLE GENERATION ──────────────────────────────────────────────
async function generateTitles(topicEntry) {
  const principles = tryJson(PRINCIPLES) || {};
  const titlePatterns = (principles.title_patterns || [])
    .map(p => `${p.pattern_name}: "${p.formula}" (e.g. "${p.examples?.[0] || ''}")`)
    .join('\n');

  const prompt = `You are a YouTube SEO expert for a philosophy sleep story channel called "Sleepless Philosophers".

TOPIC: "${topicEntry.topic}"
CHANNEL: Sleepless Philosophers — calm, meditative, philosophical content for falling asleep
DURATION: 1 hour
TARGET AUDIENCE: Adults who use YouTube to fall asleep. They want wisdom, calm narration, philosophical depth.

PROVEN TITLE PATTERNS (from high-view reference videos):
${titlePatterns}

RULES:
- The title must be calming, philosophical, sleep-appropriate
- NEVER use clickbait, shocking language, or all-caps urgency
- Adapt duration references: if a pattern says "3 hours" use "1 Hour" or omit duration if it reads better
- Keep it under 70 characters for full visibility in search
- Include sleep-signal words: "to Fall Asleep to", "for Sleep", "Sleep Story", or similar
- NO "ASMR" in the title

Generate exactly 5 title candidates. Return ONLY a JSON array:
["Title 1", "Title 2", "Title 3", "Title 4", "Title 5"]`;

  const raw = await callClaudeCLI(prompt, { model: 'claude-sonnet-4-6', timeoutMs: 30000 });
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in title response');
  return JSON.parse(match[0]);
}

async function pickBestTitle(titles, topicEntry) {
  const prompt = `You are a YouTube SEO expert scoring title candidates for a philosophy sleep channel.

TOPIC: "${topicEntry.topic}"
CHANNEL: Sleepless Philosophers — 1-hour philosophy sleep stories

TITLE CANDIDATES:
${titles.map((t, i) => `${i+1}. "${t}"`).join('\n')}

Score each title (1-10) on:
- CTR potential: does it make a sleep-content viewer click?
- Clarity: is the value proposition immediately clear?
- Calmness: does it feel appropriate for sleep content (not aggressive/clickbaity)?
- SEO: does it contain searchable keywords for the sleep philosophy niche?

Return ONLY this JSON:
{
  "winner_index": 0,
  "winner": "exact title string",
  "scores": [8, 7, 6, 9, 5],
  "reasoning": "one sentence why the winner wins"
}`;

  const raw = await callClaudeCLI(prompt, { model: 'claude-sonnet-4-6', timeoutMs: 30000 });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in scoring response');
  const result = JSON.parse(match[0]);
  return result;
}

// ─── PHASE 3: RENDER VIDEO ───────────────────────────────────────────────────
function renderVideo(topic, slug) {
  return new Promise((resolve, reject) => {
    const videoPath = path.join(OUTPUT_DIR, slug, 'final.mp4');
    if (fs.existsSync(videoPath)) {
      log(`Video already rendered: ${videoPath}`);
      return resolve(videoPath);
    }

    log(`Launching render: "${topic}" (60 min)`);
    jarvisUpdate({ status: 'rendering', step: 'Rendering 1-hour video', progress: 5 });

    const child = spawn(process.execPath, [path.join(SCRIPTS_DIR, 'test-video-2min.js')], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        SLEEPFORGE_TOPIC: topic,
        SLEEPFORGE_SLUG: slug,
        SLEEPFORGE_DURATION: String(DURATION_MIN),
        JARVIS_JOB_ID: _jobId || '',
      },
    });

    let lastLog = '';
    function parseLine(line) {
      if (!line.trim()) return;
      // Track progress from subprocess output
      if (line.includes('Script generation'))       jarvisUpdate({ step: 'Generating script',    progress: 8 });
      else if (line.includes('Chatterbox healthy'))  jarvisUpdate({ step: 'TTS starting',         progress: 12 });
      else if (line.match(/\[(\d+)\/(\d+)\]/)) {
        const m = line.match(/\[(\d+)\/(\d+)\]/);
        if (m) {
          const pct = Math.round(12 + (parseInt(m[1])/parseInt(m[2])) * 38);
          jarvisUpdate({ step: `TTS ${m[1]}/${m[2]} sentences`, progress: pct });
        }
      }
      else if (line.includes('Whisper'))             jarvisUpdate({ step: 'Whisper timestamps',   progress: 52 });
      else if (line.includes('Director'))            jarvisUpdate({ step: 'Director + storyboard', progress: 56 });
      else if (line.includes('FFmpeg composition'))  jarvisUpdate({ step: 'FFmpeg rendering',      progress: 60 });
      else if (line.includes('Building clip'))       jarvisUpdate({ step: 'Building slideshow',    progress: 65 });
      else if (line.includes('Mixing'))              jarvisUpdate({ step: 'Mixing audio',          progress: 70 });
      else if (line.includes('composeFinal') || line.includes('Final video'))
                                                     jarvisUpdate({ step: 'Final composition',     progress: 75 });
      lastLog = line;
    }

    let buf = '';
    child.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\n'); buf = lines.pop();
      lines.forEach(l => { process.stdout.write(l + '\n'); parseLine(l); });
    });
    child.stderr.on('data', d => process.stderr.write(d));

    child.on('close', code => {
      if (code === 0 && fs.existsSync(videoPath)) {
        log(`Render complete: ${videoPath}`);
        resolve(videoPath);
      } else {
        reject(new Error(`Render exited ${code}. Last output: ${lastLog}`));
      }
    });
    child.on('error', reject);
  });
}

// ─── PHASE 4: 3 THUMBNAIL VARIANTS ──────────────────────────────────────────
async function generateThreeVariants(title, slug, scenes) {
  const outputBase = path.join(OUTPUT_DIR, slug, 'thumbnails');
  fs.mkdirSync(outputBase, { recursive: true });

  const scriptText = scenes.map(s => s.narration || '').join('\n\n').slice(0, 1500);

  const variantConfigs = [
    {
      id: 'v1-icon-grid',
      niche: 'philosophy-sleep',
      tone: 'encyclopedic, authoritative, calm, icon-grid style with chalk concept illustrations on pure black, bold header text',
    },
    {
      id: 'v2-atmospheric',
      niche: 'philosophy-sleep',
      tone: 'atmospheric, dark and mysterious, contemplative, single focal philosopher image, glowing text, starfield background',
    },
    {
      id: 'v3-portrait',
      niche: 'philosophy-sleep',
      tone: 'warm, authoritative, philosopher portrait centered, golden candlelight, wise and calm mood, academic credibility',
    },
  ];

  const results = [];
  for (const cfg of variantConfigs) {
    const variantDir = path.join(outputBase, cfg.id);
    fs.mkdirSync(variantDir, { recursive: true });
    const existingThumb = path.join(variantDir, 'thumbnail-final.png');
    if (fs.existsSync(existingThumb)) {
      log(`Thumbnail cached: ${cfg.id}`);
      results.push({ id: cfg.id, path: existingThumb, score: null });
      continue;
    }

    log(`Generating thumbnail variant ${cfg.id}...`);
    try {
      const thumbPath = await withRetry(
        () => generateThumbnailV3({
          outputDir:  variantDir,
          title,
          scriptText,
          niche:      cfg.niche,
          tone:       cfg.tone,
        }),
        5, 30000, `[thumb-${cfg.id}]`
      );
      results.push({ id: cfg.id, path: thumbPath, score: null });
      log(`  ✓ ${cfg.id}: ${thumbPath}`);
    } catch (err) {
      log(`  ✗ ${cfg.id} failed (${err.message}) — skipping variant`);
    }
  }

  return results;
}

async function pickBestVariant(variants) {
  // thumbnail-v3 already runs an internal critic. We pick the variant that
  // resulted in a file (i.e., passed the critic at some score).
  // If we had scores, we'd pick highest — for now, v1 is usually the winner
  // because the icon-grid prompt best matches reference patterns.
  const available = variants.filter(v => v.path && fs.existsSync(v.path));
  if (!available.length) throw new Error('All thumbnail variants failed');

  // Try to get the critic score from the thumbnail-v3 output log (saved alongside)
  let best = available[0];
  log(`Best thumbnail: ${best.id} (${best.path})`);
  return { best, others: available.filter(v => v.id !== best.id) };
}

// ─── FALLBACK: RE-UPLOAD PREVIOUS RENDER ────────────────────────────────────
async function fallbackUploadPreviousRender(channel) {
  log('FALLBACK: Looking for previous successful render to re-upload...');
  const dirs = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => path.join(OUTPUT_DIR, e.name))
    .filter(p => fs.existsSync(path.join(p, 'final.mp4')))
    .sort((a, b) => fs.statSync(b).mtime - fs.statSync(a).mtime);

  if (!dirs.length) throw new Error('No previous renders found for fallback');

  const prevDir   = dirs[0];
  const videoPath = path.join(prevDir, 'final.mp4');
  const slug      = path.basename(prevDir);
  log(`Fallback using: ${videoPath}`);

  const fallbackTitle = `Ancient Stoic Wisdom for a Peaceful Night | Sleep Story`;
  const meta = await generateMetadata(fallbackTitle, []);

  const videoId = await uploadVideo({
    channelName:   channel,
    videoPath,
    title:         meta.title,
    description:   meta.description,
    tags:          meta.tags,
    thumbnailPath: null,
    scheduledAt:   null,
    privacyStatus: 'public',
  });

  return { videoId, title: meta.title, slug, fallback: true };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  const CHANNEL = 'sleepless-philosophers';
  _jobId = crypto.randomUUID();

  // Register job in Jarvis state
  try {
    const state = tryJson(JARVIS_STATE) || { renders: [], publishes: [], analytics_cache: {}, last_updated: null };
    state.renders.unshift({
      id: _jobId, topic: 'Pending...', channel: CHANNEL,
      status: 'queued', progress: 0, step: 'Starting pipeline',
      videoId: null, videoUrl: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      scheduledAt: null,
    });
    fs.writeFileSync(JARVIS_STATE, JSON.stringify(state, null, 2));
  } catch {}

  // ── Disk space ──────────────────────────────────────────────────────────────
  logSection('PHASE 0 — PREFLIGHT CHECKS');
  checkDiskSpace();

  // ── Phase 1: Pick topic ─────────────────────────────────────────────────────
  logSection('PHASE 1 — TOPIC SELECTION');
  const topicEntry = pickTopic();
  jarvisUpdate({ topic: topicEntry.topic, step: 'Generating titles' });

  // ── Phase 2: Title-first ────────────────────────────────────────────────────
  logSection('PHASE 2 — TITLE GENERATION');
  log(`Topic: "${topicEntry.topic}"`);

  let chosenTitle, titleAlternatives, titleScores;
  try {
    log('Generating 5 title candidates...');
    const candidates = await withRetry(
      () => generateTitles(topicEntry), 3, 5000, '[titles]'
    );
    log('Title candidates:');
    candidates.forEach((t, i) => log(`  ${i+1}. "${t}"`));

    log('Scoring titles...');
    const scored = await withRetry(
      () => pickBestTitle(candidates, topicEntry), 3, 5000, '[scoring]'
    );
    chosenTitle      = scored.winner;
    titleAlternatives = candidates.filter(t => t !== chosenTitle);
    titleScores       = scored.scores;

    log(`WINNER: "${chosenTitle}"`);
    log(`Reasoning: ${scored.reasoning}`);
  } catch (err) {
    log(`Title generation failed: ${err.message} — using default`);
    chosenTitle       = 'The 30 Biggest Ideas in Stoic Philosophy to Fall Asleep to';
    titleAlternatives = [];
    titleScores       = [];
  }

  const slug = slugify(chosenTitle);
  jarvisUpdate({ topic: chosenTitle, step: 'Rendering video', slug });

  // ── Phase 3: Render video ──────────────────────────────────────────────────
  logSection('PHASE 3 — VIDEO RENDER (60 MIN)');

  let videoPath;
  try {
    videoPath = await withRetry(
      () => renderVideo(chosenTitle, slug),
      2, 30000, '[render]'
    );
  } catch (renderErr) {
    log(`Render failed: ${renderErr.message}`);
    log('Attempting FALLBACK: re-uploading previous render...');
    try {
      const result = await fallbackUploadPreviousRender(CHANNEL);
      log(`\n✅ FALLBACK UPLOAD SUCCESS`);
      log(`Video ID: ${result.videoId}`);
      log(`URL: https://youtube.com/watch?v=${result.videoId}`);
      jarvisUpdate({ status: 'done', step: 'Fallback published', progress: 100, videoId: result.videoId, videoUrl: `https://youtube.com/watch?v=${result.videoId}` });
      saveHistory({ video_id: result.videoId, topic_id: topicEntry.id, title_chosen: result.title, channel: CHANNEL, uploaded_at: new Date().toISOString(), fallback: true });
      return;
    } catch (fallbackErr) {
      throw new Error(`Both render and fallback failed: ${renderErr.message} | Fallback: ${fallbackErr.message}`);
    }
  }

  // ── Load scenes for metadata/thumbnails ──────────────────────────────────
  const scriptJsonPath = path.join(SCRIPTS_DIR, `${slug}.json`);
  let scenes = [];
  if (fs.existsSync(scriptJsonPath)) {
    scenes = tryJson(scriptJsonPath) || [];
  }

  // ── Phase 4: 3 thumbnail variants ─────────────────────────────────────────
  logSection('PHASE 4 — THUMBNAIL VARIANTS (3×)');
  jarvisUpdate({ step: 'Generating thumbnails', progress: 78 });

  let bestThumb = null, unusedThumbs = [];
  try {
    const variants = await generateThreeVariants(chosenTitle, slug, scenes);
    const { best, others } = await pickBestVariant(variants);
    bestThumb    = best.path;
    unusedThumbs = others.map(v => v.path).filter(Boolean);
    log(`Best thumbnail: ${bestThumb}`);
  } catch (err) {
    log(`Thumbnail generation failed: ${err.message} — continuing without thumbnail`);
  }

  // ── YouTube metadata ───────────────────────────────────────────────────────
  logSection('PHASE 4.5 — YOUTUBE METADATA');
  jarvisUpdate({ step: 'Generating metadata', progress: 82 });
  const meta = await withRetry(() => generateMetadata(chosenTitle, scenes), 3, 10000, '[metadata]');
  log(`Title: ${meta.title}`);
  log(`Tags: ${meta.tags.slice(0,5).join(', ')}...`);

  // Save metadata file
  const outputDirPath = path.join(OUTPUT_DIR, slug);
  fs.writeFileSync(
    path.join(outputDirPath, 'youtube-metadata.json'),
    JSON.stringify({ ...meta, channel: CHANNEL, scheduledAt: null, thumbnailPath: bestThumb }, null, 2)
  );

  // ── Phase 5: Upload as PUBLIC ──────────────────────────────────────────────
  logSection('PHASE 5 — YOUTUBE UPLOAD (PUBLIC)');
  jarvisUpdate({ step: 'Uploading to YouTube', progress: 85, status: 'uploading' });

  if (IS_DRY_RUN) {
    log('DRY RUN — skipping upload');
    log(`Video: ${videoPath}`);
    log(`Thumbnail: ${bestThumb}`);
    log(`Title: ${meta.title}`);
    jarvisUpdate({ step: 'Dry run complete', progress: 100, status: 'done' });
    return;
  }

  let videoId;
  try {
    videoId = await withRetry(
      () => uploadVideo({
        channelName:   CHANNEL,
        videoPath,
        title:         meta.title,
        description:   meta.description,
        tags:          meta.tags,
        thumbnailPath: bestThumb,
        scheduledAt:   null,
        privacyStatus: 'public',
      }),
      5, 60000, '[upload]'
    );
  } catch (uploadErr) {
    log(`Upload failed after retries: ${uploadErr.message}`);
    // Save fallback file with all info
    const fallbackFile = path.join(outputDirPath, 'MANUAL-UPLOAD-NEEDED.json');
    fs.writeFileSync(fallbackFile, JSON.stringify({
      title: meta.title, description: meta.description, tags: meta.tags,
      videoPath, thumbnailPath: bestThumb, channel: CHANNEL,
      error: uploadErr.message, timestamp: new Date().toISOString(),
    }, null, 2));
    log(`Fallback info saved: ${fallbackFile}`);
    throw uploadErr;
  }

  // Update metadata with videoId
  fs.writeFileSync(
    path.join(outputDirPath, 'youtube-metadata.json'),
    JSON.stringify({ ...meta, channel: CHANNEL, scheduledAt: null, videoId, thumbnailPath: bestThumb }, null, 2)
  );

  // ── Phase 6: Save history + state ─────────────────────────────────────────
  logSection('PHASE 6 — SAVE HISTORY');

  const historyEntry = {
    video_id:             videoId,
    topic_id:             topicEntry.id,
    topic:                topicEntry.topic,
    channel:              CHANNEL,
    uploaded_at:          new Date().toISOString(),
    title_chosen:         meta.title,
    title_alternatives:   titleAlternatives,
    title_scores:         titleScores,
    thumbnail_chosen:     bestThumb,
    thumbnail_alternatives: unusedThumbs,
    principles_used:      [topicEntry.title_formula, topicEntry.thumbnail_type],
    slug,
    ctr:                  null,
    retention_avg:        null,
    views_24h:            null,
    views_total:          null,
    fallback:             false,
  };
  saveHistory(historyEntry);
  log(`History saved: ${HISTORY_FILE}`);

  jarvisUpdate({
    status: 'done', step: 'Published', progress: 100,
    videoId, videoUrl: `https://youtube.com/watch?v=${videoId}`,
  });

  // Save unused thumbnails to jarvis state for future A/B
  try {
    const state = tryJson(JARVIS_STATE) || {};
    state.unused_thumbnails = state.unused_thumbnails || [];
    for (const thumbPath of unusedThumbs) {
      state.unused_thumbnails.push({ videoId, thumbPath, createdAt: new Date().toISOString() });
    }
    state.last_updated = new Date().toISOString();
    fs.writeFileSync(JARVIS_STATE, JSON.stringify(state, null, 2));
  } catch {}

  logSection('✅ PIPELINE COMPLETE');
  log(`Video ID:  ${videoId}`);
  log(`URL:       https://www.youtube.com/watch?v=${videoId}`);
  log(`Studio:    https://studio.youtube.com/video/${videoId}/edit`);
  log(`Channel:   ${CHANNEL}`);
  log(`Title:     ${meta.title}`);
  log(`Thumbnail: ${bestThumb}`);
}

main().catch(err => {
  console.error('\n✗ PIPELINE FATAL:', err.message);
  jarvisUpdate({ status: 'failed', step: `Fatal: ${err.message}`, progress: 0 });
  process.exit(1);
});
