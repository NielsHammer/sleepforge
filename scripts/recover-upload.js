/**
 * recover-upload.js
 *
 * Emergency uploader for videos where the autopilot render completed but
 * thumbnails timed out. Finds the best available thumbnail from attempt-1/
 * directories, generates metadata, and uploads.
 *
 * Usage:
 *   node scripts/recover-upload.js \
 *     --slug <output-folder-slug> \
 *     --title "The YouTube title" \
 *     --channel sleepless-philosophers \
 *     --schedule "2026-05-12T01:00:00Z" \
 *     [--dry-run]
 *
 * The script looks for thumbnails in this order:
 *   output/<slug>/thumb-v1/attempt-1/thumbnail.png  (first-pass v1)
 *   output/<slug>/thumb-v2/attempt-1/thumbnail.png  (first-pass v2)
 *   output/<slug>/thumb-v3/attempt-1/thumbnail.png  (first-pass v3)
 *   output/<slug>/thumb-v1/thumbnail.png            (whatever survived)
 *   output/<slug>/thumb-v2/thumbnail.png
 *   output/<slug>/thumb-v3/thumbnail.png
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { generateMetadata }  = await import('../src/youtube-metadata-generator.js');
const { uploadVideo, getVideoProcessingStatus } = await import('../src/youtube.js');

const ARCHIVE_DIR = path.join(ROOT, 'data', 'uploaded-archive');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { slug: null, title: null, channel: null, schedule: null, dryRun: false, public: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--slug':     opts.slug     = args[++i]; break;
      case '--title':    opts.title    = args[++i]; break;
      case '--channel':  opts.channel  = args[++i]; break;
      case '--schedule': opts.schedule = args[++i]; break;
      case '--dry-run':  opts.dryRun   = true; break;
      case '--public':   opts.public   = true; break;
    }
  }
  return opts;
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

function findBestThumbnail(outputDir) {
  const candidates = [
    path.join(outputDir, 'thumb-v1', 'attempt-1', 'thumbnail.png'),
    path.join(outputDir, 'thumb-v2', 'attempt-1', 'thumbnail.png'),
    path.join(outputDir, 'thumb-v3', 'attempt-1', 'thumbnail.png'),
    path.join(outputDir, 'thumb-v1', 'thumbnail.png'),
    path.join(outputDir, 'thumb-v2', 'thumbnail.png'),
    path.join(outputDir, 'thumb-v3', 'thumbnail.png'),
    path.join(outputDir, 'thumbnail', 'thumbnail-final.png'),
    path.join(outputDir, 'thumbnail', 'thumbnail.png'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function main() {
  const opts = parseArgs();
  if (!opts.slug || !opts.title || !opts.channel) {
    console.error('Usage: node scripts/recover-upload.js --slug <slug> --title "..." --channel <ch> [--schedule ISO] [--dry-run]');
    process.exit(1);
  }

  const outputDir  = path.join(ROOT, 'output', opts.slug);
  const videoPath  = path.join(outputDir, 'final.mp4');
  const scheduledAt = opts.schedule || null;

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   SleepForge — Recovery Upload            ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Slug:      ${opts.slug}`);
  console.log(`  Title:     ${opts.title}`);
  console.log(`  Channel:   ${opts.channel}`);
  console.log(`  Schedule:  ${scheduledAt || '(immediate)'}`);
  console.log(`  Dry run:   ${opts.dryRun}`);

  if (!fs.existsSync(videoPath)) {
    console.error(`\nVideo not found: ${videoPath}`);
    process.exit(1);
  }
  console.log(`\n✓ Video: ${videoPath}`);

  const thumbPath = findBestThumbnail(outputDir);
  if (thumbPath) {
    console.log(`✓ Thumbnail: ${thumbPath}`);
  } else {
    console.log('⚠ No thumbnail found — uploading without one');
  }

  // Load script scenes for metadata context
  const scriptJsonPath = path.join(ROOT, 'scripts', `${opts.slug}.json`);
  const scenes = fs.existsSync(scriptJsonPath) ? JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8')) : [];

  console.log('\n── Generating YouTube metadata (Haiku) ──');
  const meta = await generateMetadata(opts.title, scenes);
  meta.title = opts.title;
  console.log(`  Title: ${meta.title}`);
  console.log(`  Tags:  ${meta.tags.slice(0, 5).join(', ')}…`);

  fs.writeFileSync(path.join(outputDir, 'youtube-metadata.json'), JSON.stringify({
    ...meta, scheduledAt, channel: opts.channel,
  }, null, 2));

  if (opts.dryRun) {
    console.log('\n── DRY RUN — skipping upload ──');
    return;
  }

  console.log('\n── Uploading to YouTube ──');
  const videoId = await uploadVideo({
    channelName:   opts.channel,
    videoPath,
    title:         meta.title,
    description:   meta.description,
    tags:          meta.tags,
    thumbnailPath: thumbPath || null,
    scheduledAt,
    privacyStatus: opts.public ? 'public' : 'private',
  });

  fs.writeFileSync(path.join(outputDir, 'youtube-metadata.json'), JSON.stringify({
    ...meta, scheduledAt, channel: opts.channel, videoId,
  }, null, 2));

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   ✅ Uploaded!                             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`  Video ID: ${videoId}`);
  console.log(`  URL:      https://www.youtube.com/watch?v=${videoId}`);
  console.log(`  Studio:   https://studio.youtube.com/video/${videoId}/edit`);
  if (scheduledAt) console.log(`  Schedule: ${new Date(scheduledAt).toLocaleString()}`);

  // Archive thumbnail + metadata, write manifest
  const archiveVideoDir = path.join(ARCHIVE_DIR, videoId);
  fs.mkdirSync(archiveVideoDir, { recursive: true });
  let archived = 0;
  if (thumbPath) { fs.copyFileSync(thumbPath, path.join(archiveVideoDir, 'thumbnail-final.png')); archived++; }
  const metaPath = path.join(outputDir, 'youtube-metadata.json');
  if (fs.existsSync(metaPath)) { fs.copyFileSync(metaPath, path.join(archiveVideoDir, 'youtube-metadata.json')); archived++; }

  fs.writeFileSync(path.join(archiveVideoDir, 'manifest.json'), JSON.stringify({
    videoId, slug: opts.slug, outputDir, channelName: opts.channel,
    scheduledAt, uploadedAt: new Date().toISOString(),
    archivedFiles: archived, cleanedUp: false,
    recoveryUpload: true,
  }, null, 2));
  console.log(`  Archive:  ${archiveVideoDir}`);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
