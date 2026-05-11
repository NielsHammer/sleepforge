/**
 * One-shot recovery for Video 1 (Epicureanism) — generates thumbnails then uploads.
 * Run: node scripts/recover-video1.js
 */
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { generateThumbnailV3, closeBrowser } = await import('../src/thumbnail-v3.js');
const { generateMetadata }                  = await import('../src/youtube-metadata-generator.js');
const { uploadVideo, getVideoProcessingStatus } = await import('../src/youtube.js');

const SLUG       = 'epicureanism-philosophy-true-teachings-of-epicurus-simple-li';
const TITLE      = 'All of Epicureanism Philosophy Explained in 1 Video for Deep Sleep';
const CHANNEL    = 'sleepless-philosophers';
const OUTPUT_DIR = path.join(ROOT, 'output', SLUG);
const VIDEO_PATH = path.join(OUTPUT_DIR, 'final.mp4');
const ARCHIVE_DIR = path.join(ROOT, 'data', 'uploaded-archive');

function log(m) { console.log(m); }

function readCriticScore(dir) {
  try {
    const p = path.join(dir, 'thumbnail-v3-review.json');
    if (!fs.existsSync(p)) return { rating: 5 };
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return { rating: 5 }; }
}

// Load script text for thumbnail context
const scriptJsonPath = path.join(ROOT, 'scripts', `${SLUG}.json`);
let scriptText = '';
if (fs.existsSync(scriptJsonPath)) {
  const scenes = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
  scriptText = scenes.map(s => s.narration || '').join('\n\n');
}

log('\n╔══════════════════════════════════════════╗');
log('║   Video 1 Recovery — Epicureanism         ║');
log('╚══════════════════════════════════════════╝');
log(`  Video: ${VIDEO_PATH}`);
log(`  Size:  ${(fs.statSync(VIDEO_PATH).size / 1024 / 1024).toFixed(0)} MB`);

// ── Generate 3 thumbnail variants ──
const variants = [];

for (let i = 1; i <= 3; i++) {
  const vDir = path.join(OUTPUT_DIR, `thumb-v${i}`);
  log(`\n── Thumbnail variant ${i}/3 ──`);
  let lockedHook = null, lockedMetaphor = null;
  if (i > 1) {
    try {
      const v1Dir = path.join(OUTPUT_DIR, 'thumb-v1');
      const hp = path.join(v1Dir, 'thumbnail-v3-hook.json');
      const mp = path.join(v1Dir, 'thumbnail-v3-metaphor.json');
      if (fs.existsSync(hp)) lockedHook     = JSON.parse(fs.readFileSync(hp, 'utf-8'));
      if (fs.existsSync(mp)) lockedMetaphor = JSON.parse(fs.readFileSync(mp, 'utf-8'));
    } catch {}
  }
  try {
    const vPath = await generateThumbnailV3({
      outputDir:       vDir,
      title:           TITLE,
      scriptText,
      niche:           'philosophy',
      tone:            'calm, meditative, philosophical',
      _lockedHook:     i > 1 ? lockedHook : undefined,
      _lockedMetaphor: i > 1 ? lockedMetaphor : undefined,
      _priorAttempt:   i > 1 && variants[0]
        ? { rating: variants[0].rating, designer_verdict: 'See variant 1', problems: [], fix_instructions: 'Make a STRUCTURALLY DIFFERENT design.' }
        : null,
    });
    const score = readCriticScore(vDir);
    variants.push({ pngPath: vPath, dir: vDir, rating: score.rating, attempt: i });
    log(`  ✓ Variant ${i}: score ${score.rating}/10`);
  } catch (e) {
    log(`  ⚠ Variant ${i} failed: ${e.message}`);
  }
}

await closeBrowser();

if (variants.length === 0) {
  log('\n✗ All thumbnails failed — uploading without thumbnail');
}

variants.sort((a, b) => b.rating - a.rating);
const best   = variants[0] || null;
const unused = variants.slice(1);
if (best) log(`\n  Best thumbnail: variant ${best.attempt} (score ${best.rating}/10)`);

// ── Generate metadata ──
log('\n── Generating YouTube metadata ──');
const scenes = fs.existsSync(scriptJsonPath) ? JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8')) : [];
const meta   = await generateMetadata(TITLE, scenes);
meta.title   = TITLE;
log(`  Tags: ${meta.tags.slice(0, 5).join(', ')}…`);

// ── Upload as PUBLIC ──
log('\n── Uploading as PUBLIC (live now) ──');
const videoId = await uploadVideo({
  channelName:   CHANNEL,
  videoPath:     VIDEO_PATH,
  title:         meta.title,
  description:   meta.description,
  tags:          meta.tags,
  thumbnailPath: best?.pngPath || null,
  scheduledAt:   null,
  privacyStatus: 'public',
});

fs.writeFileSync(path.join(OUTPUT_DIR, 'youtube-metadata.json'), JSON.stringify({
  ...meta, scheduledAt: null, channel: CHANNEL, videoId, privacyStatus: 'public',
}, null, 2));

log(`\n✓ Uploaded: https://www.youtube.com/watch?v=${videoId}`);
log(`  Studio:   https://studio.youtube.com/video/${videoId}/edit`);

// ── Archive ──
const archiveDir = path.join(ARCHIVE_DIR, videoId);
fs.mkdirSync(archiveDir, { recursive: true });
if (best?.pngPath && fs.existsSync(best.pngPath)) {
  fs.copyFileSync(best.pngPath, path.join(archiveDir, 'thumbnail-final.png'));
}
for (const u of unused) {
  if (u.pngPath && fs.existsSync(u.pngPath)) {
    fs.copyFileSync(u.pngPath, path.join(archiveDir, `thumbnail-unused-v${u.attempt}.png`));
  }
}
fs.copyFileSync(path.join(OUTPUT_DIR, 'youtube-metadata.json'), path.join(archiveDir, 'youtube-metadata.json'));
fs.writeFileSync(path.join(archiveDir, 'manifest.json'), JSON.stringify({
  videoId, slug: SLUG, outputDir: OUTPUT_DIR, channelName: CHANNEL,
  scheduledAt: null, privacyStatus: 'public',
  uploadedAt: new Date().toISOString(), recoveryUpload: true,
}, null, 2));

log(`  Archive: ${archiveDir}`);
log('\n╔══════════════════════════════════════════╗');
log('║   ✅ Video 1 Recovery Complete             ║');
log('╚══════════════════════════════════════════╝');
