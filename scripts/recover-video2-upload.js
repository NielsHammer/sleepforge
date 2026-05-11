/**
 * Video 2 recovery — Taoism/Lao Tzu. Uses best available thumbnail, uploads as PRIVATE scheduled.
 */
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { uploadVideo } = await import('../src/youtube.js');

const SLUG        = 'taoist-philosophy-the-way-tao-wu-wei-principle-natural-flow-';
const TITLE       = '(NO ADS) 25 Foundational Concepts of Lao Tzu\'s Taoism for Deep Sleep';
const CHANNEL     = 'sleepless-philosophers';
const SCHEDULED   = '2026-05-11T01:00:00Z'; // Monday 8am Bangkok
const OUTPUT_DIR  = path.join(ROOT, 'output', SLUG);
const VIDEO_PATH  = path.join(OUTPUT_DIR, 'final.mp4');
const ARCHIVE_DIR = path.join(ROOT, 'data', 'uploaded-archive');

// Pick best available thumbnail by critic score
function findBestThumb() {
  const candidates = [
    { path: path.join(OUTPUT_DIR, 'thumb-v1', 'thumbnail.png'), v: 1 },
    { path: path.join(OUTPUT_DIR, 'thumb-v2', 'thumbnail.png'), v: 2 },
    { path: path.join(OUTPUT_DIR, 'thumb-v3', 'thumbnail.png'), v: 3 },
    { path: path.join(OUTPUT_DIR, 'thumb-v1', 'attempt-1', 'thumbnail.png'), v: 1 },
    { path: path.join(OUTPUT_DIR, 'thumb-v2', 'attempt-1', 'thumbnail.png'), v: 2 },
    { path: path.join(OUTPUT_DIR, 'thumb-v3', 'attempt-1', 'thumbnail.png'), v: 3 },
  ];
  let best = null, bestScore = -1;
  for (const c of candidates) {
    if (!fs.existsSync(c.path)) continue;
    try {
      const reviewPath = path.join(OUTPUT_DIR, `thumb-v${c.v}`, 'thumbnail-v3-review.json');
      const score = fs.existsSync(reviewPath) ? JSON.parse(fs.readFileSync(reviewPath)).rating || 0 : 0;
      if (score > bestScore) { best = c.path; bestScore = score; }
    } catch { if (!best) best = c.path; }
  }
  return { thumbPath: best, score: bestScore };
}

const DESCRIPTION = `Let the ancient wisdom of Lao Tzu and the Tao Te Ching carry you into peaceful, deep sleep. This advertisement-free video explores 25 foundational concepts of Taoism — the philosophy of natural flow, effortless action, and harmony with the universe.

From wu wei (non-action) to the paradox of strength in softness, these timeless teachings offer a perfect companion for sleep, meditation, and quiet contemplation. No distractions, no advertisements — just philosophy and rest.

Topics covered: The Tao (The Way) · Wu wei (effortless action) · Yin and yang balance · Te (virtue and power) · The water principle · Ziran (naturalness) · Simplicity and non-attachment · The paradox of emptiness · The Tao Te Ching's core passages · And 16 more foundational Taoist concepts.`;

const TAGS = [
  'taoism', 'lao tzu', 'tao te ching', 'philosophy for sleep', 'taoist philosophy',
  'wu wei', 'deep sleep', 'sleep philosophy', 'no ads sleep', 'tao philosophy',
  'ancient chinese philosophy', 'sleep meditation philosophy', 'lao tzu teachings',
  'taoist wisdom', 'philosophy sleep music', 'eastern philosophy sleep',
  'taoism explained', 'sleepless philosophers', 'philosophy bedtime', 'yin yang philosophy',
];

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   Video 2 Recovery — Taoism/Lao Tzu      ║');
console.log('╚══════════════════════════════════════════╝');

const { thumbPath, score } = findBestThumb();
console.log(`  Video:     ${VIDEO_PATH} (${(fs.statSync(VIDEO_PATH).size/1024/1024).toFixed(0)} MB)`);
console.log(`  Thumbnail: ${thumbPath || 'NONE'} (critic score: ${score})`);
console.log(`  Privacy:   PRIVATE → scheduled ${new Date(SCHEDULED).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })} Bangkok`);

const videoId = await uploadVideo({
  channelName:   CHANNEL,
  videoPath:     VIDEO_PATH,
  title:         TITLE,
  description:   DESCRIPTION,
  tags:          TAGS,
  thumbnailPath: thumbPath || null,
  scheduledAt:   SCHEDULED,
  privacyStatus: 'private',
});

const meta = { title: TITLE, description: DESCRIPTION, tags: TAGS, scheduledAt: SCHEDULED, channel: CHANNEL, videoId, privacyStatus: 'private' };
fs.writeFileSync(path.join(OUTPUT_DIR, 'youtube-metadata.json'), JSON.stringify(meta, null, 2));

console.log(`\n✓ Scheduled: https://www.youtube.com/watch?v=${videoId}`);
console.log(`  Studio:    https://studio.youtube.com/video/${videoId}/edit`);
console.log(`  Goes live: Monday 8am Bangkok (${SCHEDULED})`);

const archiveDir = path.join(ARCHIVE_DIR, videoId);
fs.mkdirSync(archiveDir, { recursive: true });
if (thumbPath && fs.existsSync(thumbPath)) fs.copyFileSync(thumbPath, path.join(archiveDir, 'thumbnail-final.png'));
fs.copyFileSync(path.join(OUTPUT_DIR, 'youtube-metadata.json'), path.join(archiveDir, 'youtube-metadata.json'));
fs.writeFileSync(path.join(archiveDir, 'manifest.json'), JSON.stringify({
  videoId, slug: SLUG, outputDir: OUTPUT_DIR, channelName: CHANNEL,
  scheduledAt: SCHEDULED, privacyStatus: 'private',
  uploadedAt: new Date().toISOString(), recoveryUpload: true, cleanedUp: false,
}, null, 2));

console.log(`  Archive:   ${archiveDir}`);
console.log('\n╔══════════════════════════════════════════╗');
console.log('║   ✅ Video 2 Scheduled                    ║');
console.log('╚══════════════════════════════════════════╝');
