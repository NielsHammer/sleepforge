/**
 * rethumb-all.js
 *
 * Re-thumbnails every video on sleepless-philosophers using the hardened
 * thumbnail-v3 pipeline (56px floor, hook validator, period-authentic rule,
 * critic with feedback retry).
 *
 * 1. Lists all channel videos via YouTube Data API (public + scheduled)
 * 2. Skips videos already at 8/10+ in the uploaded-archive
 * 3. Generates 3 thumbnail variants per video, critic picks best
 * 4. Uploads winner via YouTube API, archives unused 2
 * 5. Logs failures but never stops the batch
 *
 * Usage: node scripts/rethumb-all.js [--dry-run]
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { generateThumbnailV3, closeBrowser } = await import('../src/thumbnail-v3.js');
const { listChannelVideos, uploadThumbnail } = await import('../src/youtube.js');

const CHANNEL     = 'sleepless-philosophers';
const ARCHIVE_DIR = path.join(ROOT, 'data', 'uploaded-archive');
const DRY_RUN     = process.argv.includes('--dry-run');
const SKIP_THRESHOLD = 8; // skip videos already at this score or above

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function logSection(t) {
  log(`\n${'═'.repeat(60)}`);
  log(`  ${t}`);
  log(`${'═'.repeat(60)}`);
}

function getArchivedScore(videoId) {
  const archiveDir = path.join(ARCHIVE_DIR, videoId);
  if (!fs.existsSync(archiveDir)) return null;
  // Check rethumb-targeted-manifest first, then rethumb-manifest, then manifest
  for (const name of ['rethumb-targeted-manifest.json', 'rethumb-manifest.json', 'manifest.json']) {
    try {
      const p = path.join(archiveDir, name);
      if (!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (data.bestVariant?.rating != null) return data.bestVariant.rating;
    } catch {}
  }
  return null;
}

function readCriticScore(dir) {
  try {
    const p = path.join(dir, 'thumbnail-v3-review.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : { rating: 5 };
  } catch { return { rating: 5 }; }
}

async function uploadWithRetry(videoId, thumbPath, maxRetries = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await uploadThumbnail(videoId, thumbPath, CHANNEL);
      return;
    } catch (err) {
      lastErr = err;
      log(`  ⚠ Upload attempt ${attempt}/${maxRetries} failed: ${err.message.slice(0, 120)}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 30000 * attempt));
    }
  }
  throw new Error(`Upload failed after ${maxRetries} attempts: ${lastErr.message}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

log('\n╔════════════════════════════════════════════════════════════╗');
log('║   SleepForge — Re-Thumbnail All Channel Videos             ║');
log('╚════════════════════════════════════════════════════════════╝');
log(`  Channel: ${CHANNEL}`);
log(`  Dry run: ${DRY_RUN}`);
log(`  Skip threshold: ${SKIP_THRESHOLD}/10 or above\n`);

// Step 1: list all videos
log('Fetching video list from YouTube API...');
let allVideos;
try {
  allVideos = await listChannelVideos(CHANNEL);
} catch (e) {
  log(`✗ Could not list videos: ${e.message}`);
  process.exit(1);
}
log(`  Found ${allVideos.length} videos on channel.`);

// Step 2: filter out already-high-scoring ones
const toProcess = [];
const skipped   = [];
for (const v of allVideos) {
  const score = getArchivedScore(v.videoId);
  if (score != null && score >= SKIP_THRESHOLD) {
    skipped.push({ ...v, archivedScore: score });
  } else {
    toProcess.push({ ...v, archivedScore: score });
  }
}
log(`  Skipping ${skipped.length} videos already at ${SKIP_THRESHOLD}/10+.`);
log(`  Processing ${toProcess.length} videos.\n`);

if (skipped.length > 0) {
  log('Skipped (already high-scoring):');
  for (const v of skipped) log(`  ✓ ${v.videoId} — "${v.title.slice(0, 60)}" (${v.archivedScore}/10)`);
}

const results = [];

for (const video of toProcess) {
  const { videoId, title, privacyStatus, scheduledAt } = video;
  const statusLabel = scheduledAt
    ? `scheduled ${new Date(scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok' })}`
    : privacyStatus;

  logSection(`${videoId} — "${title.slice(0, 55)}"`);
  log(`  Status: ${statusLabel}`);

  const outputDir = path.join(ROOT, 'output', '_rethumb-all', videoId);
  fs.mkdirSync(outputDir, { recursive: true });

  const variants = [];

  for (let i = 1; i <= 3; i++) {
    const vDir = path.join(outputDir, `v${i}`);
    fs.mkdirSync(vDir, { recursive: true });
    log(`\n  Generating variant ${i}/3...`);

    let lockedHook = null;
    let lockedMetaphor = null;
    if (i > 1 && variants.length > 0) {
      try {
        const hookPath = path.join(outputDir, 'v1', 'thumbnail-v3-hook.json');
        const metaPath = path.join(outputDir, 'v1', 'thumbnail-v3-metaphor.json');
        if (fs.existsSync(hookPath)) lockedHook     = JSON.parse(fs.readFileSync(hookPath, 'utf-8'));
        if (fs.existsSync(metaPath)) lockedMetaphor = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
    }

    let vPath = null;
    try {
      vPath = await generateThumbnailV3({
        outputDir: vDir,
        title,
        scriptText: '',
        niche: 'philosophy',
        tone: 'calm, meditative, philosophical, period-authentic ancient art, no modern faces, no contemporary makeup, no plucked eyebrows, no current-era hairstyles',
        _lockedHook:     i > 1 ? lockedHook     : null,
        _lockedMetaphor: i > 1 ? lockedMetaphor : null,
      });
    } catch (e) {
      log(`  ⚠ Variant ${i} failed: ${e.message.slice(0, 200)}`);
    }

    const review = readCriticScore(vDir);
    log(`  Variant ${i}: score ${review.rating}/10${vPath ? '' : ' (no PNG)'}`);
    if (vPath) variants.push({ pngPath: vPath, dir: vDir, rating: review.rating, index: i });
  }

  if (variants.length === 0) {
    log(`  ✗ All 3 variants failed — keeping existing thumbnail`);
    results.push({ videoId, title, status: 'failed', error: 'All 3 variants failed' });
    continue;
  }

  variants.sort((a, b) => b.rating - a.rating);
  const best   = variants[0];
  const unused = variants.slice(1);

  log(`\n  Best: v${best.index} (score ${best.rating}/10)`);

  if (DRY_RUN) {
    log('  [DRY RUN] Would upload thumbnail');
  } else {
    log('  Uploading thumbnail to YouTube...');
    try {
      await uploadWithRetry(videoId, best.pngPath);
      log(`  ✓ Uploaded to ${videoId}`);
    } catch (e) {
      log(`  ✗ Upload failed: ${e.message}`);
      results.push({ videoId, title, status: 'upload_failed', error: e.message, rating: best.rating });
      continue;
    }
  }

  // Archive
  const archiveVideoDir = path.join(ARCHIVE_DIR, videoId);
  fs.mkdirSync(archiveVideoDir, { recursive: true });
  fs.copyFileSync(best.pngPath, path.join(archiveVideoDir, 'thumbnail-final.png'));
  for (const u of unused) {
    fs.copyFileSync(u.pngPath, path.join(archiveVideoDir, `thumbnail-unused-rethumb-all-v${u.index}.png`));
  }
  fs.writeFileSync(path.join(archiveVideoDir, 'rethumb-all-manifest.json'), JSON.stringify({
    videoId, title, channel: CHANNEL,
    rethumbnailedAt: new Date().toISOString(),
    bestVariant: { index: best.index, rating: best.rating, path: best.pngPath },
    unusedVariants: unused.map(u => ({ index: u.index, rating: u.rating })),
    dryRun: DRY_RUN,
  }, null, 2));

  results.push({ videoId, title, status: DRY_RUN ? 'dry-run' : 'done', rating: best.rating });
}

await closeBrowser().catch(() => {});

// ─── FINAL REPORT ─────────────────────────────────────────────────────────────

log('\n' + '═'.repeat(60));
log('  RETHUMB-ALL COMPLETE');
log('═'.repeat(60));

const done    = results.filter(r => r.status === 'done' || r.status === 'dry-run');
const failed  = results.filter(r => r.status === 'failed' || r.status === 'upload_failed');

log(`  ✓ ${done.length} uploaded  ✗ ${failed.length} failed  → ${skipped.length} skipped (already 8+/10)`);
log('');

for (const r of results) {
  const icon = r.status === 'done' || r.status === 'dry-run' ? '✓' : '✗';
  log(`  ${icon} ${r.videoId} | ${(r.title || '').slice(0, 50).padEnd(50)} | ${r.rating ?? '-'}/10 | ${r.status}`);
  if (r.error) log(`      ↳ ${r.error}`);
}

const reportPath = path.join(ROOT, 'data', `rethumb-all-report-${Date.now()}.md`);
const lines = [
  '# Re-Thumbnail All — Report',
  `Date: ${new Date().toISOString()}`,
  `Channel: ${CHANNEL}`,
  '',
  `| VideoId | Title | Hook Score | Status |`,
  `|---------|-------|------------|--------|`,
  ...results.map(r => `| ${r.videoId} | ${r.title} | ${r.rating ?? '-'}/10 | ${r.status} |`),
  '',
  `**Skipped (already ${SKIP_THRESHOLD}+/10):** ${skipped.length}`,
  ...skipped.map(v => `- ${v.videoId} — "${v.title}" (${v.archivedScore}/10)`),
];
fs.writeFileSync(reportPath, lines.join('\n'));
log(`\n  Report: ${reportPath}`);
