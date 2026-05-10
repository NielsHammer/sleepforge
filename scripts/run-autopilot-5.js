/**
 * run-autopilot-5.js
 *
 * 5-video fully autonomous autopilot — sleepless-philosophers
 * Schedule: Wed May 13 – Sun May 17 2026, 8am Bangkok (01:00 UTC)
 *
 * Pipeline per video:
 *   1. Disk space check + cleanup if needed
 *   2. Render 60-min video (test-video-2min.js)
 *   3. Title refinement: 5 Haiku candidates → Sonnet picks winner
 *   4. Generate 3 thumbnail variants; critic picks best
 *   5. Generate YouTube description + tags (Haiku, 120s timeout)
 *   6. Upload PRIVATE with scheduledAt; retry 5× with 60s backoff
 *   7. Archive best thumbnail + unused variants + metadata
 *   8. Write progress to data/scheduled-batch-<ts>.md
 *
 * Reliability:
 *   - 60s per-sentence Chatterbox hang timeout (CHATTERBOX_TIMEOUT_MS)
 *   - 2 render retries per video (5-hour timeout each)
 *   - On irrecoverable render failure: re-upload last successful render
 *   - Never stops the queue for any single video failure
 *
 * Usage: node scripts/run-autopilot-5.js [--dry-run] [--keep-files]
 */

import fs       from 'fs';
import path     from 'path';
import crypto   from 'crypto';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';
import dotenv   from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI }                          = await import('../src/claude-cli.js');
const { generateThumbnailV3, closeBrowser }      = await import('../src/thumbnail-v3.js');
const { generateMetadata }                       = await import('../src/youtube-metadata-generator.js');
const { uploadVideo, getVideoProcessingStatus }  = await import('../src/youtube.js');

const HAIKU   = 'claude-haiku-4-5-20251001';
const SONNET  = 'claude-sonnet-4-6';
const CHANNEL = 'sleepless-philosophers';
const ARCHIVE_DIR      = path.join(ROOT, 'data', 'uploaded-archive');
const JARVIS_STATE_FILE = path.join(ROOT, 'jarvis', 'state.json');

// ─── 5-VIDEO LINEUP ───────────────────────────────────────────────────────────
// Wed May 13 – Sun May 17 2026, 8am Bangkok = 01:00 UTC each day

const VIDEOS = [
  {
    index:        1,
    scheduledAt:  '2026-05-13T01:00:00Z',
    tradition:    'Ancient Greek (non-Stoic)',
    philosopher:  'Socrates',
    philosophers: 'socrates,plato',
    titlePattern: 'encyclopedic_number',
    draftTitle:   '30 Questions Socrates Asked to Fall Asleep To',
    topic: 'Socratic philosophy: the examined life, Socratic method of questioning, maieutics, dialectic, aporia, Socratic irony, the trial of Socrates, virtue through dialogue',
  },
  {
    index:        2,
    scheduledAt:  '2026-05-14T01:00:00Z',
    tradition:    'Confucianism',
    philosopher:  'Confucius',
    philosophers: 'confucius,zhuangzi',
    titlePattern: 'completeness_claim',
    draftTitle:   'All of Confucius Philosophy for Deep Sleep',
    topic: 'Confucian philosophy: ren (benevolence), li (ritual propriety), yi (righteousness), the Analects, self-cultivation, the junzi (superior person), filial piety, social harmony and virtuous governance',
  },
  {
    index:        3,
    scheduledAt:  '2026-05-15T01:00:00Z',
    tradition:    'Pre-Socratic',
    philosopher:  'Heraclitus',
    philosophers: 'heraclitus,socrates',
    titlePattern: 'duration_list',
    draftTitle:   '1 Hour of Heraclitus: Everything Flows for Deep Sleep',
    topic: 'Heraclitean philosophy: panta rhei (everything flows), unity of opposites, logos as the rational principle, fire as the fundamental substance, change as constant, the Obscure philosopher of Ephesus',
  },
  {
    index:        4,
    scheduledAt:  '2026-05-16T01:00:00Z',
    tradition:    'Aristotelian',
    philosopher:  'Aristotle',
    philosophers: 'aristotle,plato',
    titlePattern: 'superlative_quality',
    draftTitle:   'The Wisest Ideas of Aristotle for Sleep Meditation',
    topic: 'Aristotelian philosophy: virtue ethics, the golden mean, eudaimonia (flourishing), Nicomachean Ethics, teleology, the unmoved mover, phronesis (practical wisdom), the good life, friendship',
  },
  {
    index:        5,
    scheduledAt:  '2026-05-17T01:00:00Z',
    tradition:    'Cynical philosophy',
    philosopher:  'Diogenes',
    philosophers: 'diogenes,socrates',
    titlePattern: 'encyclopedic_number',
    draftTitle:   '(NO ADS) 25 Teachings of Diogenes the Cynic for Deep Sleep',
    topic: 'Cynical philosophy of Diogenes of Sinope: radical simplicity, anaideia (shamelessness), living according to nature, rejecting convention and status, virtue as the only good, askesis, the barrel of Diogenes',
  },
];

// ─── ARGS ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun:     args.includes('--dry-run'),
    keepFiles:  args.includes('--keep-files'),
  };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg)  { console.log(msg); }
function logSection(title) {
  log(`\n${'═'.repeat(54)}`);
  log(`  ${title}`);
  log(`${'═'.repeat(54)}`);
}

function slugify(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ─── DISK ─────────────────────────────────────────────────────────────────────

function getFreeDiskGb() {
  try {
    const out = execSync('powershell -c "(Get-PSDrive C).Free / 1GB"', { encoding: 'utf8', timeout: 5000 });
    return parseFloat(out.trim());
  } catch { return 100; }
}

function cleanOldOutputDirs(minFreeGb = 5) {
  const free = getFreeDiskGb();
  if (free >= minFreeGb) { log(`  Disk: ${free.toFixed(1)} GB free ✓`); return; }
  log(`  ⚠ Disk low (${free.toFixed(1)} GB) — cleaning old output dirs...`);
  const outputBase = path.join(ROOT, 'output');
  const dirs = fs.readdirSync(outputBase, { withFileTypes: true })
    .filter(e => e.isDirectory() && !e.name.startsWith('_'))
    .map(e => ({ name: e.name, mtime: fs.statSync(path.join(outputBase, e.name)).mtime }))
    .sort((a, b) => a.mtime - b.mtime);
  for (const d of dirs) {
    if (getFreeDiskGb() >= minFreeGb) break;
    try {
      fs.rmSync(path.join(outputBase, d.name), { recursive: true, force: true });
      log(`  Deleted output/${d.name} for disk space`);
    } catch {}
  }
}

// ─── JARVIS ───────────────────────────────────────────────────────────────────

function jarvisUpdateJob(jobId, patch) {
  try {
    const s = fs.existsSync(JARVIS_STATE_FILE)
      ? JSON.parse(fs.readFileSync(JARVIS_STATE_FILE, 'utf-8'))
      : { renders: [], publishes: [], analytics_cache: {}, unused_thumbnails: [] };
    const idx = s.renders.findIndex(r => r.id === jobId);
    const now = new Date().toISOString();
    if (idx >= 0) {
      Object.assign(s.renders[idx], patch, { updatedAt: now });
    } else {
      s.renders.unshift({ id: jobId, ...patch, createdAt: now, updatedAt: now });
    }
    s.last_updated = now;
    fs.writeFileSync(JARVIS_STATE_FILE, JSON.stringify(s, null, 2));
  } catch { /* Jarvis state not critical */ }
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
// 5-hour timeout: 60-min video + Chatterbox restarts worst case
// CHATTERBOX_TIMEOUT_MS=60000 → 60s per sentence before auto-restart

function renderVideo(video, slug) {
  const timeoutMs = 18000000; // 5 hours
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
        FRAME_VARIANT:           String(video.index - 1), // vary frame 0-4 across videos
      },
      cwd: ROOT,
    });
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('Render timed out after 5 hours'));
    }, timeoutMs);
    child.on('close', code => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`render exited ${code}`));
    });
    child.on('error', err => { clearTimeout(killTimer); reject(err); });
  });
}

// ─── THUMBNAIL ────────────────────────────────────────────────────────────────

function readCriticScore(dir) {
  try {
    const p = path.join(dir, 'thumbnail-v3-review.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : { rating: 5 };
  } catch { return { rating: 5 }; }
}

async function generate3Variants(outputDir, video, scriptText) {
  const tone = 'calm, meditative, philosophical, period-authentic ancient art, no modern faces, no contemporary makeup, no plucked eyebrows, no current-era hairstyles, historical accuracy';
  const variants = [];

  // Variant 1 — full pipeline
  const v1Dir = path.join(outputDir, 'thumb-v1');
  log('  Generating thumbnail variant 1 (full pipeline)...');
  let v1Path = null;
  try {
    v1Path = await generateThumbnailV3({
      outputDir: v1Dir,
      title:     video.title,
      scriptText,
      niche: 'philosophy',
      tone,
    });
  } catch (e) {
    log(`  ⚠ Variant 1 failed: ${e.message.slice(0, 200)}`);
  }

  // Lock hook + metaphor from v1 for reuse in v2/v3
  let lockedHook = null, lockedMetaphor = null;
  try {
    const hp = path.join(v1Dir, 'thumbnail-v3-hook.json');
    const mp = path.join(v1Dir, 'thumbnail-v3-metaphor.json');
    if (fs.existsSync(hp)) lockedHook     = JSON.parse(fs.readFileSync(hp, 'utf-8'));
    if (fs.existsSync(mp)) lockedMetaphor = JSON.parse(fs.readFileSync(mp, 'utf-8'));
  } catch {}

  const v1Review = readCriticScore(v1Dir);
  if (v1Path) variants.push({ pngPath: v1Path, dir: v1Dir, rating: v1Review.rating, attempt: 1 });

  // Variants 2 + 3 — locked hook + metaphor, different plan
  for (let i = 2; i <= 3; i++) {
    const vDir = path.join(outputDir, `thumb-v${i}`);
    log(`  Generating thumbnail variant ${i} (locked hook+metaphor)...`);
    let vPath = null;
    try {
      vPath = await generateThumbnailV3({
        outputDir:      vDir,
        title:          video.title,
        scriptText,
        niche: 'philosophy',
        tone,
        _lockedHook:     lockedHook,
        _lockedMetaphor: lockedMetaphor,
      });
    } catch (e) {
      log(`  ⚠ Variant ${i} failed: ${e.message.slice(0, 200)}`);
    }
    const vReview = readCriticScore(vDir);
    if (vPath) variants.push({ pngPath: vPath, dir: vDir, rating: vReview.rating, attempt: i });
  }

  // Fallback: scan all thumb dirs for any .png if all variants threw
  if (variants.length === 0) {
    log('  ⚠ All 3 variants threw — scanning for any thumbnail PNG...');
    for (let i = 1; i <= 3; i++) {
      const vDir = path.join(outputDir, `thumb-v${i}`);
      const pngs = fs.existsSync(vDir)
        ? fs.readdirSync(vDir, { withFileTypes: true })
            .filter(e => !e.isDirectory() && e.name.endsWith('.png'))
            .map(e => path.join(vDir, e.name))
        : [];
      for (const p of pngs) {
        variants.push({ pngPath: p, dir: vDir, rating: 4, attempt: i });
      }
    }
  }

  if (variants.length === 0) throw new Error('No thumbnail could be generated');

  variants.sort((a, b) => b.rating - a.rating);
  const best   = variants[0];
  const unused = variants.slice(1);
  log(`  Best variant: v${best.attempt} (score ${best.rating}/10)`);
  return { best, unused };
}

// ─── TITLE REFINEMENT ─────────────────────────────────────────────────────────

async function refineTitleForTopic(video) {
  const haikuPrompt = `Generate 5 YouTube title candidates for a 1-hour philosophy sleep video.

TOPIC: ${video.topic}
TRADITION: ${video.tradition}
PHILOSOPHER: ${video.philosopher}
DRAFT TITLE: ${video.draftTitle}
TITLE PATTERN TO USE: ${video.titlePattern}

RULES:
- Sleep-focused language (e.g., "to Fall Asleep to", "for Deep Sleep", "Sleep Meditation")
- Include philosopher/tradition name clearly
- One of the 5 must start with "(NO ADS) "
- Pattern meanings: encyclopedic_number = "30 Biggest X", completeness_claim = "All of X Explained", duration_list = "4 Hours of X", superlative_quality = "The Most Calming X"
- Avoid clickbait — audience is calm philosophy enthusiasts
- No title longer than 80 chars

Return ONLY a JSON array of 5 strings:
["title 1", "title 2", "title 3", "title 4", "title 5"]`;

  let candidates = [video.draftTitle];
  try {
    const raw = await callClaudeCLI(haikuPrompt, { model: HAIKU, timeoutMs: 30000 });
    const m   = raw.match(/\[[\s\S]*\]/);
    if (m) candidates = JSON.parse(m[0]);
  } catch (e) {
    log(`  ⚠ Haiku title generation failed (${e.message.slice(0, 80)}) — using draft`);
    return video.draftTitle;
  }

  const sonnetPrompt = `You are a YouTube title expert for a philosophy sleep channel "Sleepless Philosophers".

Pick the single BEST title from these ${candidates.length} candidates. Optimise for: insomniacs searching for calm philosophy, searchability, emotional resonance, 50-70 char ideal.

TOPIC: ${video.topic}
TRADITION: ${video.tradition}

CANDIDATES:
${candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Return ONLY this JSON (no markdown):
{"winner_index": N, "title": "exact title text", "reason": "one sentence"}`;

  try {
    const raw = await callClaudeCLI(sonnetPrompt, { model: SONNET, timeoutMs: 45000 });
    const m   = raw.match(/\{[\s\S]*\}/);
    if (!m) return candidates[0];
    const pick = JSON.parse(m[0]);
    log(`  Title winner: "${pick.title}"`);
    log(`  Reason: ${pick.reason}`);
    return pick.title || candidates[0];
  } catch (e) {
    log(`  ⚠ Sonnet title pick failed — using first candidate`);
    return candidates[0];
  }
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

async function archiveAndCleanup(videoId, slug, outputDir, scheduledAt, bestThumb, unusedThumbs, meta, keepFiles) {
  // Poll for upload confirmation (max 3 min)
  log('  Polling YouTube for upload confirmation...');
  let confirmed = false;
  for (let i = 0; i < 12; i++) {
    await sleep(i === 0 ? 60000 : 15000);
    try {
      const s = await getVideoProcessingStatus(videoId, CHANNEL);
      const ok = s && (s.uploadStatus === 'processed' || s.uploadStatus === 'uploaded');
      log(`    Check ${i + 1}/12: ${s?.uploadStatus || 'unknown'}`);
      if (ok) { confirmed = true; break; }
    } catch (e) {
      log(`    Check ${i + 1}/12: poll error — ${e.message.slice(0, 80)}`);
    }
  }
  if (!confirmed) log('  ⚠ Upload not confirmed after 3 min — keeping render folder');

  const archiveVideoDir = path.join(ARCHIVE_DIR, videoId);
  fs.mkdirSync(archiveVideoDir, { recursive: true });

  // Copy best thumbnail
  if (bestThumb && fs.existsSync(bestThumb)) {
    fs.copyFileSync(bestThumb, path.join(archiveVideoDir, 'thumbnail-final.png'));
  }

  // Copy unused thumbnails
  for (let i = 0; i < unusedThumbs.length; i++) {
    const src = unusedThumbs[i].pngPath;
    if (src && fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(archiveVideoDir, `thumbnail-unused-v${unusedThumbs[i].attempt}.png`));
    }
  }

  // Write metadata
  if (meta) {
    const metaPath = path.join(outputDir, 'youtube-metadata.json');
    if (fs.existsSync(metaPath)) {
      fs.copyFileSync(metaPath, path.join(archiveVideoDir, 'youtube-metadata.json'));
    }
  }

  fs.writeFileSync(path.join(archiveVideoDir, 'manifest.json'), JSON.stringify({
    videoId, slug, outputDir, channelName: CHANNEL,
    scheduledAt, privacyStatus: 'private',
    uploadedAt: new Date().toISOString(), cleanedUp: false,
  }, null, 2));

  if (confirmed && !keepFiles) {
    try {
      const sizeMb = dirSizeMb(outputDir);
      fs.rmSync(outputDir, { recursive: true, force: true });
      log(`  ✓ Render folder deleted (~${sizeMb} MB freed)`);
      const manifest = JSON.parse(fs.readFileSync(path.join(archiveVideoDir, 'manifest.json'), 'utf-8'));
      manifest.cleanedUp   = true;
      manifest.cleanedUpAt = new Date().toISOString();
      fs.writeFileSync(path.join(archiveVideoDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    } catch (e) {
      log(`  ⚠ Could not delete render folder: ${e.message}`);
    }
  }

  log(`  Archive: ${archiveVideoDir}`);
}

function dirSizeMb(dir) {
  try {
    let total = 0;
    const walk = d => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else try { total += fs.statSync(p).size; } catch {}
      }
    };
    walk(dir);
    return (total / 1024 / 1024).toFixed(0);
  } catch { return '?'; }
}

// ─── PROGRESS REPORT ──────────────────────────────────────────────────────────

function writeProgressReport(results, batchFile, startedAt) {
  const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
  const lines = [
    `# SleepForge — 5-Video Scheduled Batch`,
    `Started: ${new Date(startedAt).toISOString()}`,
    `Updated: ${new Date().toISOString()}`,
    `Elapsed: ${elapsedMin} min`,
    `Channel: ${CHANNEL}`,
    '',
    '## Videos',
    '',
  ];
  for (const r of results) {
    const bkk = r.scheduledAt
      ? new Date(r.scheduledAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) + ' Bangkok'
      : 'immediate';
    lines.push(`### Video ${r.index} — ${r.tradition} (${r.philosopher})`);
    lines.push(`- Title: ${r.title || r.draftTitle}`);
    lines.push(`- Scheduled: ${bkk} (${r.scheduledAt})`);
    lines.push(`- Status: ${r.status}`);
    if (r.videoId) {
      lines.push(`- Video ID: ${r.videoId}`);
      lines.push(`- URL: https://www.youtube.com/watch?v=${r.videoId}`);
      lines.push(`- Studio: https://studio.youtube.com/video/${r.videoId}/edit`);
    }
    if (r.bestThumbRating) lines.push(`- Best thumbnail score: ${r.bestThumbRating}/10`);
    if (r.thumbPath)       lines.push(`- Thumbnail: ${r.thumbPath}`);
    if (r.fallback)        lines.push(`- ⚠ FALLBACK: ${r.fallback}`);
    if (r.error)           lines.push(`- Error: ${r.error}`);
    lines.push('');
  }
  fs.mkdirSync(path.dirname(batchFile), { recursive: true });
  fs.writeFileSync(batchFile, lines.join('\n'));
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts      = parseArgs();
  const startedAt = Date.now();
  const batchTs   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const batchFile = path.join(ROOT, 'data', `scheduled-batch-${batchTs}.md`);

  log('\n╔══════════════════════════════════════════════════════╗');
  log('║   SleepForge — 5-Video Autonomous Batch              ║');
  log('╚══════════════════════════════════════════════════════╝');
  log(`  Channel:  ${CHANNEL}`);
  log(`  Dry run:  ${opts.dryRun}`);
  log(`  Report:   ${batchFile}`);
  log('\n  Schedule:');
  for (const v of VIDEOS) {
    const bkk = new Date(v.scheduledAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
    log(`    ${v.index}. [${bkk} BKK] ${v.philosopher} — ${v.draftTitle}`);
  }

  const results = VIDEOS.map(v => ({
    index:       v.index,
    tradition:   v.tradition,
    philosopher: v.philosopher,
    draftTitle:  v.draftTitle,
    title:       null,
    scheduledAt: v.scheduledAt,
    status:      'pending',
    videoId:     null,
    thumbPath:   null,
    bestThumbRating: null,
    error:       null,
    fallback:    null,
  }));

  let lastSuccessfulVideoPath = null; // fallback if render fails

  for (let i = 0; i < VIDEOS.length; i++) {
    const video  = VIDEOS[i];
    const result = results[i];
    const slug   = slugify(video.topic);
    const outputDir  = path.join(ROOT, 'output', slug);
    const videoPath  = path.join(outputDir, 'final.mp4');
    const jobId      = crypto.randomUUID();

    logSection(`VIDEO ${i + 1} / 5 — ${video.tradition} (${video.philosopher})`);
    log(`  Draft title: "${video.draftTitle}"`);
    log(`  Schedule:    ${new Date(video.scheduledAt).toLocaleString('en-US', { weekday: 'short', timeZone: 'Asia/Bangkok' })} Bangkok`);

    jarvisUpdateJob(jobId, {
      id: jobId, topic: video.topic, channel: CHANNEL,
      status: 'rendering', step: 'Starting', progress: 5,
      videoId: null, videoUrl: null, scheduledAt: video.scheduledAt,
    });

    // ── Disk check ──────────────────────────────────────────────────────────
    log('\n── Disk space check ──');
    cleanOldOutputDirs(5);

    // ── Step 1: Render ───────────────────────────────────────────────────────
    let renderOk = false;
    if (fs.existsSync(videoPath)) {
      log('\n── Step 1: Video cached — skipping render ──');
      renderOk = true;
      jarvisUpdateJob(jobId, { step: 'Video cached', progress: 40 });
    } else {
      log('\n── Step 1: Rendering 60-min video ──');
      log(`  Philosophers: ${video.philosophers}`);
      jarvisUpdateJob(jobId, { step: 'Rendering video', progress: 10 });

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await renderVideo(video, slug);
          if (!fs.existsSync(videoPath)) throw new Error(`final.mp4 not found after render`);
          renderOk = true;
          log(`  ✓ Render complete: ${videoPath}`);
          jarvisUpdateJob(jobId, { step: 'Render complete', progress: 40 });
          break;
        } catch (e) {
          log(`  ✗ Render attempt ${attempt}/2 failed: ${e.message.slice(0, 200)}`);
          if (attempt < 2) {
            log('  Retrying render in 30s...');
            await sleep(30000);
          }
        }
      }
    }

    // Fallback: re-upload last successful render with new title
    let usingFallback = false;
    let activeVideoPath = videoPath;

    if (!renderOk) {
      if (lastSuccessfulVideoPath && fs.existsSync(lastSuccessfulVideoPath)) {
        log(`\n  ⚠ Render failed — falling back to last successful render: ${lastSuccessfulVideoPath}`);
        activeVideoPath = lastSuccessfulVideoPath;
        result.fallback = `Re-using ${path.basename(path.dirname(lastSuccessfulVideoPath))} final.mp4 with fresh title`;
        usingFallback   = true;
      } else {
        log(`\n  ✗ Render failed and no fallback available — skipping Video ${i + 1}`);
        result.status = 'failed';
        result.error  = 'Render failed after 2 attempts, no fallback available';
        jarvisUpdateJob(jobId, { status: 'failed', step: 'Render failed', progress: 0 });
        writeProgressReport(results, batchFile, startedAt);
        continue;
      }
    }

    // ── Step 2: Title refinement ─────────────────────────────────────────────
    log('\n── Step 2: Title refinement (5 Haiku → Sonnet picks) ──');
    jarvisUpdateJob(jobId, { step: 'Refining title', progress: 42 });
    video.title  = await refineTitleForTopic(video);
    result.title = video.title;

    // ── Step 3: Thumbnail variants ───────────────────────────────────────────
    log('\n── Step 3: Generating 3 thumbnail variants ──');
    jarvisUpdateJob(jobId, { step: 'Generating thumbnails', progress: 45 });

    let best = null, unused = [];
    const scriptJsonPath = path.join(ROOT, 'scripts', `${slug}.json`);
    let scriptText = '';
    if (fs.existsSync(scriptJsonPath)) {
      try {
        const scenes = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
        scriptText = scenes.map(s => s.narration || '').join('\n\n');
      } catch {}
    }

    try {
      const thumbResult = await generate3Variants(outputDir, video, scriptText);
      best   = thumbResult.best;
      unused = thumbResult.unused;
      result.bestThumbRating = best.rating;
      result.thumbPath       = best.pngPath;
      jarvisUpdateJob(jobId, { step: `Thumbnail done (${best.rating}/10)`, progress: 65 });
    } catch (e) {
      log(`  ⚠ Thumbnail generation failed: ${e.message.slice(0, 200)}`);
      log('  Continuing upload without custom thumbnail...');
      result.bestThumbRating = 0;
      jarvisUpdateJob(jobId, { step: 'Thumbnail failed — uploading without', progress: 65 });
    }

    // ── Step 4: YouTube metadata ─────────────────────────────────────────────
    log('\n── Step 4: Generating YouTube metadata (description + tags) ──');
    jarvisUpdateJob(jobId, { step: 'Generating metadata', progress: 68 });

    let meta = { title: video.title, description: '', tags: [] };
    try {
      const scenes = fs.existsSync(scriptJsonPath)
        ? JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'))
        : [];
      const generated = await generateMetadata(video.topic, scenes);
      meta = { ...generated, title: video.title }; // always use our refined title
      log(`  Tags: ${meta.tags.slice(0, 5).join(', ')}… (${meta.tags.length} total)`);
    } catch (e) {
      log(`  ⚠ Metadata generation failed: ${e.message.slice(0, 200)}`);
      log('  Using minimal fallback metadata...');
      meta.description = `Drift into peaceful sleep with ${video.philosopher}'s philosophy. An hour of calming philosophical wisdom for deep sleep.`;
      meta.tags = [
        video.philosopher.toLowerCase(), video.tradition.toLowerCase(), 'philosophy for sleep',
        'deep sleep', 'sleep meditation', 'no ads sleep', 'philosophy bedtime',
        'sleepless philosophers', 'sleep story', 'ancient philosophy',
      ];
    }

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'youtube-metadata.json'), JSON.stringify({
      ...meta, scheduledAt: video.scheduledAt, channel: CHANNEL,
    }, null, 2));

    // ── Step 5: Upload ───────────────────────────────────────────────────────
    if (opts.dryRun) {
      log('\n── DRY RUN — skipping upload ──');
      log(`  Title:     ${meta.title}`);
      log(`  Thumbnail: ${best?.pngPath || 'none'}`);
      result.status = 'dry-run';
      writeProgressReport(results, batchFile, startedAt);
      continue;
    }

    log('\n── Step 5: Uploading to YouTube (PRIVATE, scheduled) ──');
    log(`  Title:      "${meta.title}"`);
    log(`  Publish at: ${new Date(video.scheduledAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })} Bangkok`);
    jarvisUpdateJob(jobId, { step: 'Uploading to YouTube', progress: 75 });

    let videoId;
    try {
      videoId = await uploadWithRetry({
        channelName:   CHANNEL,
        videoPath:     activeVideoPath,
        title:         meta.title,
        description:   meta.description,
        tags:          meta.tags,
        thumbnailPath: best?.pngPath || null,
        scheduledAt:   video.scheduledAt,
        privacyStatus: 'private',
      });
    } catch (e) {
      log(`  ✗ Upload permanently failed: ${e.message.slice(0, 200)}`);
      result.status = 'failed';
      result.error  = `Upload failed: ${e.message}`;
      jarvisUpdateJob(jobId, { status: 'failed', step: `Upload failed: ${e.message.slice(0, 80)}`, progress: 0 });
      writeProgressReport(results, batchFile, startedAt);
      continue;
    }

    result.videoId = videoId;
    result.status  = 'uploaded';
    lastSuccessfulVideoPath = usingFallback ? lastSuccessfulVideoPath : videoPath;

    // Save metadata with videoId
    fs.writeFileSync(path.join(outputDir, 'youtube-metadata.json'), JSON.stringify({
      ...meta, scheduledAt: video.scheduledAt, channel: CHANNEL, videoId,
      privacyStatus: 'private',
    }, null, 2));

    log(`\n  ✓ Scheduled: https://www.youtube.com/watch?v=${videoId}`);
    log(`  Studio:      https://studio.youtube.com/video/${videoId}/edit`);
    log(`  Goes live:   ${new Date(video.scheduledAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'Asia/Bangkok' })} 8am Bangkok`);

    jarvisUpdateJob(jobId, {
      status: 'done', step: 'Scheduled', progress: 95,
      videoId, videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
    });

    // ── Step 6: Archive + cleanup ────────────────────────────────────────────
    log('\n── Step 6: Archive + cleanup ──');
    jarvisUpdateJob(jobId, { step: 'Archiving', progress: 97 });
    await archiveAndCleanup(
      videoId, slug, outputDir, video.scheduledAt,
      best?.pngPath || null, unused, meta, opts.keepFiles,
    );
    result.status = 'archived';
    jarvisUpdateJob(jobId, { step: 'Complete', progress: 100 });

    // Write progress after each video
    writeProgressReport(results, batchFile, startedAt);
    log(`  Progress report: ${batchFile}`);
  }

  await closeBrowser().catch(() => {});

  // ── Final summary ────────────────────────────────────────────────────────
  writeProgressReport(results, batchFile, startedAt);

  logSection('BATCH COMPLETE');
  const uploaded = results.filter(r => r.videoId);
  log(`  Scheduled: ${uploaded.length} / ${results.length} videos`);
  log('');
  for (const r of results) {
    const icon = r.videoId ? '✓' : '✗';
    const bkk  = new Date(r.scheduledAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' });
    log(`  ${icon} Video ${r.index} [${bkk}]: "${r.title || r.draftTitle}"`);
    if (r.videoId)   log(`      └── ${r.videoId} — https://www.youtube.com/watch?v=${r.videoId}`);
    if (r.fallback)  log(`      └── FALLBACK: ${r.fallback}`);
    if (r.error)     log(`      └── ERROR: ${r.error}`);
  }
  log(`\n  Full report: ${batchFile}`);
  log(`  Runtime: ${Math.round((Date.now() - startedAt) / 60000)} minutes`);

  if (results.some(r => r.status === 'failed')) process.exit(1);
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
