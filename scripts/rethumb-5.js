/**
 * rethumb-5.js
 *
 * Re-thumbnail the 5 scheduled videos from the overnight batch.
 * Generates 3 NEW variants per video using the hardened pipeline,
 * uploads the best one via YouTube API, archives the unused 2.
 *
 * Does NOT touch title, description, schedule, or privacy status.
 *
 * Usage: node scripts/rethumb-5.js [--dry-run]
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { generateThumbnailV3, closeBrowser } = await import('../src/thumbnail-v3.js');
const { uploadThumbnail }                   = await import('../src/youtube.js');

const CHANNEL     = 'sleepless-philosophers';
const ARCHIVE_DIR = path.join(ROOT, 'data', 'uploaded-archive');
const DRY_RUN     = process.argv.includes('--dry-run');

// ─── 5 VIDEO TARGETS ──────────────────────────────────────────────────────────

const TARGETS = [
  {
    videoId: 'SlugP393zyE',
    title:   '30 Socratic Dialogues for Deep Sleep',
    scheduledAt: '2026-05-13T01:00:00Z',
  },
  {
    videoId: 'rRS4hzDlf1w',
    title:   'All of Confucius Philosophy Explained | Sleep Meditation',
    scheduledAt: '2026-05-14T01:00:00Z',
  },
  {
    videoId: '_IJ2P5S_Rpc',
    title:   '1 Hour of Heraclitus: Everything Flows for Deep Sleep',
    scheduledAt: '2026-05-15T01:00:00Z',
  },
  {
    videoId: 'qXrKvkJhh1I',
    title:   'The Wisest Ideas of Aristotle for Sleep Meditation',
    scheduledAt: '2026-05-16T01:00:00Z',
  },
  {
    videoId: '3wg5ogDyyIY',
    title:   '(NO ADS) 25 Teachings of Diogenes the Cynic for Deep Sleep',
    scheduledAt: '2026-05-17T01:00:00Z',
  },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function logSection(t) {
  log(`\n${'═'.repeat(54)}`);
  log(`  ${t}`);
  log(`${'═'.repeat(54)}`);
}

function readCriticScore(dir) {
  try {
    const p = path.join(dir, 'thumbnail-v3-review.json');
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : { rating: 5 };
  } catch { return { rating: 5 }; }
}

// ─── UPLOAD WITH RETRY ────────────────────────────────────────────────────────

async function uploadThumbnailWithRetry(videoId, thumbPath, maxRetries = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await uploadThumbnail(videoId, thumbPath, CHANNEL);
      return;
    } catch (err) {
      lastErr = err;
      log(`  ⚠ Thumbnail upload attempt ${attempt}/${maxRetries} failed: ${err.message.slice(0, 120)}`);
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 30000 * attempt));
    }
  }
  throw new Error(`Thumbnail upload failed after ${maxRetries} attempts: ${lastErr.message}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

log('\n╔══════════════════════════════════════════════════════╗');
log('║   SleepForge — Re-Thumbnail 5 Scheduled Videos      ║');
log('╚══════════════════════════════════════════════════════╝');
log(`  Channel: ${CHANNEL}`);
log(`  Dry run: ${DRY_RUN}`);
log(`  Pipeline: hardened hook validator + text-presence check`);

const results = [];

for (const target of TARGETS) {
  const { videoId, title, scheduledAt } = target;
  const bkk = new Date(scheduledAt).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Bangkok',
  });

  logSection(`${videoId} — "${title}"`);
  log(`  Scheduled: ${bkk} Bangkok`);

  const thumbOutputDir = path.join(ROOT, 'output', '_rethumb', videoId);
  fs.mkdirSync(thumbOutputDir, { recursive: true });

  const variants = [];

  // Generate 3 variants
  for (let i = 1; i <= 3; i++) {
    const vDir = path.join(thumbOutputDir, `v${i}`);
    fs.mkdirSync(vDir, { recursive: true });
    log(`\n  Generating variant ${i}/3...`);

    let vPath = null;
    // Reuse hook + metaphor from v1 for v2 + v3
    let lockedHook     = null;
    let lockedMetaphor = null;
    if (i > 1 && variants.length > 0) {
      try {
        const hookPath = path.join(thumbOutputDir, 'v1', 'thumbnail-v3-hook.json');
        const metaPath = path.join(thumbOutputDir, 'v1', 'thumbnail-v3-metaphor.json');
        if (fs.existsSync(hookPath)) lockedHook     = JSON.parse(fs.readFileSync(hookPath, 'utf-8'));
        if (fs.existsSync(metaPath)) lockedMetaphor = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
    }

    try {
      vPath = await generateThumbnailV3({
        outputDir: vDir,
        title,
        scriptText: '',  // no script available post-cleanup
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
    log(`  ✗ All 3 variants failed for ${videoId}`);
    results.push({ videoId, title, status: 'failed', error: 'All 3 variants failed' });
    continue;
  }

  // Pick best by score
  variants.sort((a, b) => b.rating - a.rating);
  const best   = variants[0];
  const unused = variants.slice(1);

  log(`\n  Best: v${best.index} (score ${best.rating}/10)`);
  log(`  Path: ${best.pngPath}`);

  // Upload to YouTube
  if (DRY_RUN) {
    log('  [DRY RUN] Would upload thumbnail to YouTube');
  } else {
    log('  Uploading thumbnail to YouTube...');
    try {
      await uploadThumbnailWithRetry(videoId, best.pngPath);
      log(`  ✓ Thumbnail uploaded to ${videoId}`);
    } catch (e) {
      log(`  ✗ Upload failed: ${e.message}`);
      results.push({ videoId, title, status: 'upload_failed', error: e.message, bestPath: best.pngPath });
      continue;
    }
  }

  // Archive: copy best + unused to data/uploaded-archive/<videoId>/
  const archiveVideoDir = path.join(ARCHIVE_DIR, videoId);
  fs.mkdirSync(archiveVideoDir, { recursive: true });

  const bestDest = path.join(archiveVideoDir, 'thumbnail-final.png');
  fs.copyFileSync(best.pngPath, bestDest);
  log(`  Archive best: ${bestDest}`);

  for (const u of unused) {
    const dest = path.join(archiveVideoDir, `thumbnail-unused-rethumbed-v${u.index}.png`);
    fs.copyFileSync(u.pngPath, dest);
    log(`  Archive unused v${u.index}: ${path.basename(dest)}`);
  }

  // Write rethumb manifest
  fs.writeFileSync(path.join(archiveVideoDir, 'rethumb-manifest.json'), JSON.stringify({
    videoId, title, channel: CHANNEL,
    rethumbnailedAt: new Date().toISOString(),
    bestVariant: { index: best.index, rating: best.rating, path: best.pngPath },
    unusedVariants: unused.map(u => ({ index: u.index, rating: u.rating })),
    dryRun: DRY_RUN,
  }, null, 2));

  results.push({ videoId, title, status: DRY_RUN ? 'dry-run' : 'done', rating: best.rating, thumbPath: best.pngPath });
}

await closeBrowser().catch(() => {});

// ─── FINAL REPORT ─────────────────────────────────────────────────────────────

log('\n' + '═'.repeat(54));
log('  RETHUMB COMPLETE');
log('═'.repeat(54));
for (const r of results) {
  const icon = r.status === 'done' || r.status === 'dry-run' ? '✓' : '✗';
  log(`  ${icon} ${r.videoId} — "${r.title}"`);
  if (r.rating)    log(`      Score: ${r.rating}/10`);
  if (r.thumbPath) log(`      Thumb: ${r.thumbPath}`);
  if (r.error)     log(`      Error: ${r.error}`);
}

const reportPath = path.join(ROOT, 'data', `rethumb-5-report-${Date.now()}.md`);
const lines = [
  '# Re-Thumbnail Report — 5 Scheduled Videos',
  `Date: ${new Date().toISOString()}`,
  '',
  '| VideoId | Title | Score | Status |',
  '|---------|-------|-------|--------|',
  ...results.map(r =>
    `| ${r.videoId} | ${r.title} | ${r.rating ?? '-'}/10 | ${r.status} |`
  ),
];
fs.writeFileSync(reportPath, lines.join('\n'));
log(`\n  Report: ${reportPath}`);
