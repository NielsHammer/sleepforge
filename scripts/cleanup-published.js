/**
 * cleanup-published.js
 *
 * Daily cleanup for scheduled videos. Runs after analytics in the 3am task.
 *
 * Checks every video in data/uploaded-archive/ that:
 *   - Has not been cleaned up yet (manifest.cleanedUp !== true)
 *   - Has a scheduledAt that has already passed (or is null = immediate upload)
 *
 * For each qualifying video, calls videos.list to confirm it went public.
 * If confirmed public: deletes output/<slug>/ render folder, updates manifest.
 * If not yet public: leaves the render folder in place, logs a warning.
 *
 * Usage:  node scripts/cleanup-published.js [--dry-run]
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { getVideoProcessingStatus } = await import('../src/youtube.js');

const ARCHIVE_DIR = path.join(ROOT, 'data', 'uploaded-archive');
const OUTPUT_DIR  = path.join(ROOT, 'output');
const DRY_RUN     = process.argv.includes('--dry-run');

function log(msg) { console.log(msg); }

function dirSizeMb(dir) {
  try {
    let total = 0;
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else try { total += fs.statSync(p).size; } catch {}
      }
    };
    walk(dir);
    return (total / 1024 / 1024).toFixed(0);
  } catch { return '?'; }
}

async function main() {
  log('\n══════════════════════════════════════════════════');
  log('  SleepForge — Cleanup Published Videos');
  if (DRY_RUN) log('  [DRY RUN — no files will be deleted]');
  log('══════════════════════════════════════════════════\n');

  if (!fs.existsSync(ARCHIVE_DIR)) {
    log('No uploaded-archive directory yet. Nothing to clean up.');
    return;
  }

  const videoDirs = fs.readdirSync(ARCHIVE_DIR).filter(f => {
    return fs.statSync(path.join(ARCHIVE_DIR, f)).isDirectory();
  });

  log(`Found ${videoDirs.length} archived video(s).`);

  let cleaned = 0;
  let skipped = 0;
  let notYet  = 0;

  for (const videoId of videoDirs) {
    const archiveDir  = path.join(ARCHIVE_DIR, videoId);
    const manifestPath = path.join(archiveDir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      log(`  [${videoId}] No manifest.json — skipping.`);
      skipped++;
      continue;
    }

    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); }
    catch { log(`  [${videoId}] Corrupt manifest — skipping.`); skipped++; continue; }

    // Already cleaned up
    if (manifest.cleanedUp) {
      log(`  [${videoId}] Already cleaned up — skip.`);
      skipped++;
      continue;
    }

    // Render folder not found (already gone)
    const renderDir = manifest.outputDir || path.join(OUTPUT_DIR, manifest.slug || videoId);
    if (!fs.existsSync(renderDir)) {
      log(`  [${videoId}] Render folder already gone — marking clean.`);
      manifest.cleanedUp = true;
      manifest.cleanedUpAt = new Date().toISOString();
      manifest.cleanedUpReason = 'folder not found (already deleted)';
      if (!DRY_RUN) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      cleaned++;
      continue;
    }

    // Check if scheduledAt has passed (or no schedule = immediate)
    const scheduledAt = manifest.scheduledAt ? new Date(manifest.scheduledAt) : null;
    if (scheduledAt && scheduledAt > new Date()) {
      const minsLeft = Math.ceil((scheduledAt - Date.now()) / 60000);
      log(`  [${videoId}] Scheduled in ${minsLeft} min — not yet time. Keeping render folder.`);
      notYet++;
      continue;
    }

    // Poll YouTube to confirm video is public
    log(`  [${videoId}] Checking status via videos.list...`);
    let status = null;
    try {
      status = await getVideoProcessingStatus(videoId, manifest.channelName);
    } catch (e) {
      log(`  [${videoId}] Status check failed: ${e.message} — skipping.`);
      skipped++;
      continue;
    }

    if (!status) {
      log(`  [${videoId}] Video not found on YouTube — may have been deleted. Skipping.`);
      skipped++;
      continue;
    }

    log(`  [${videoId}] uploadStatus=${status.uploadStatus} | privacyStatus=${status.privacyStatus}`);

    const isPublic    = status.privacyStatus === 'public';
    const isProcessed = status.uploadStatus === 'processed' || status.uploadStatus === 'uploaded';

    if (!isProcessed) {
      log(`  [${videoId}] Not yet processed (${status.uploadStatus}) — keeping render folder.`);
      notYet++;
      continue;
    }

    // If scheduled and not yet public, give it 30 extra minutes grace
    if (scheduledAt && !isPublic) {
      const gracePassed = Date.now() > scheduledAt.getTime() + 30 * 60 * 1000;
      if (!gracePassed) {
        log(`  [${videoId}] Processed but not yet public (within 30min grace) — keeping.`);
        notYet++;
        continue;
      }
      log(`  [${videoId}] Processed but still private after 30min grace — cleaning anyway.`);
    }

    // Delete render folder
    const sizeMb = dirSizeMb(renderDir);
    if (DRY_RUN) {
      log(`  [${videoId}] DRY RUN: would delete ${renderDir} (~${sizeMb} MB)`);
    } else {
      try {
        fs.rmSync(renderDir, { recursive: true, force: true });
        log(`  [${videoId}] ✓ Deleted render folder — freed ~${sizeMb} MB`);
        manifest.cleanedUp    = true;
        manifest.cleanedUpAt  = new Date().toISOString();
        manifest.freedMb      = sizeMb;
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        cleaned++;
      } catch (e) {
        log(`  [${videoId}] ✗ Delete failed: ${e.message}`);
        skipped++;
      }
    }
  }

  log('\n══════════════════════════════════════════════════');
  log(`  Cleaned: ${cleaned} | Not yet: ${notYet} | Skipped: ${skipped}`);
  log('══════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
