/**
 * Video 3 recovery — Neoplatonism/Plotinus. Uses best available thumbnail, PRIVATE scheduled Tuesday.
 */
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { uploadVideo } = await import('../src/youtube.js');

const SLUG        = 'neoplatonic-philosophy-the-one-emanation-spiritual-hierarchy';
const TITLE       = '1 Hour of Plotinus: The One and Spiritual Hierarchy for Deep Sleep';
const CHANNEL     = 'sleepless-philosophers';
const SCHEDULED   = '2026-05-12T01:00:00Z'; // Tuesday 8am Bangkok
const ARCHIVE_DIR = path.join(ROOT, 'data', 'uploaded-archive');

// Slug may vary — find the actual output dir
function findOutputDir() {
  const outputBase = path.join(ROOT, 'output');
  const candidates = fs.readdirSync(outputBase).filter(d =>
    d.toLowerCase().includes('plotinus') || d.toLowerCase().includes('neoplatonism') || d.toLowerCase().includes('one-and-spiritual')
  );
  if (candidates.length > 0) return path.join(outputBase, candidates[0]);
  // fallback: most recently modified dir with final.mp4
  const dirs = fs.readdirSync(outputBase, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, mtime: fs.statSync(path.join(outputBase, e.name)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const d of dirs) {
    if (fs.existsSync(path.join(outputBase, d.name, 'final.mp4'))) return path.join(outputBase, d.name);
  }
  return null;
}

function findBestThumb(outputDir) {
  const candidates = [
    { p: path.join(outputDir, 'thumb-v1', 'thumbnail.png'), v: 1 },
    { p: path.join(outputDir, 'thumb-v2', 'thumbnail.png'), v: 2 },
    { p: path.join(outputDir, 'thumb-v3', 'thumbnail.png'), v: 3 },
    { p: path.join(outputDir, 'thumb-v1', 'attempt-1', 'thumbnail.png'), v: 1 },
    { p: path.join(outputDir, 'thumb-v2', 'attempt-1', 'thumbnail.png'), v: 2 },
    { p: path.join(outputDir, 'thumb-v3', 'attempt-1', 'thumbnail.png'), v: 3 },
  ];
  let best = null, bestScore = -1;
  for (const c of candidates) {
    if (!fs.existsSync(c.p)) continue;
    try {
      const rp = path.join(outputDir, `thumb-v${c.v}`, 'thumbnail-v3-review.json');
      const score = fs.existsSync(rp) ? (JSON.parse(fs.readFileSync(rp)).rating || 0) : 0;
      if (score > bestScore) { best = c.p; bestScore = score; }
    } catch { if (!best) best = c.p; }
  }
  return { thumbPath: best, score: bestScore };
}

const DESCRIPTION = `Drift into peaceful sleep with the profound philosophy of Plotinus and the Neoplatonic tradition. For over an hour, explore the mystical hierarchy of existence — The One, Intellect, and Soul — and how ancient philosophers understood the nature of reality, consciousness, and spiritual return.

Plotinus taught that all existence emanates from a single source of perfection, and that through contemplation and inner stillness, the soul can ascend back toward unity. These ideas, both deeply philosophical and profoundly calming, make the perfect companion for deep sleep.

Topics covered: The One and absolute unity · Emanation and the hierarchy of being · The role of Intellect (Nous) · The World Soul · Individual soul and its descent · Beauty and the ascent to the Good · Plotinus on time and eternity · The Enneads · Porphyry and the Neoplatonic school.`;

const TAGS = [
  'plotinus', 'neoplatonism', 'philosophy for sleep', 'the one plotinus', 'deep sleep philosophy',
  'neoplatonic philosophy', 'sleep meditation philosophy', 'ancient philosophy sleep',
  'plotinus enneads', 'philosophy bedtime', 'spiritual philosophy sleep', 'the one emanation',
  'neoplatonism explained', 'sleepless philosophers', 'philosophy sleep music',
  'mystical philosophy sleep', 'plotinus teachings', 'no ads sleep philosophy',
  'greek philosophy deep sleep', 'soul philosophy sleep',
];

const outputDir = findOutputDir();
if (!outputDir) { console.error('Could not find Video 3 output dir'); process.exit(1); }
const videoPath = path.join(outputDir, 'final.mp4');
if (!fs.existsSync(videoPath)) { console.error(`No final.mp4 at ${videoPath}`); process.exit(1); }

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   Video 3 Recovery — Plotinus/Neoplatonism║');
console.log('╚══════════════════════════════════════════╝');

const { thumbPath, score } = findBestThumb(outputDir);
console.log(`  Output:    ${outputDir}`);
console.log(`  Video:     ${(fs.statSync(videoPath).size/1024/1024).toFixed(0)} MB`);
console.log(`  Thumbnail: ${thumbPath || 'NONE'} (score: ${score})`);
console.log(`  Privacy:   PRIVATE → ${new Date(SCHEDULED).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })} Bangkok`);

const videoId = await uploadVideo({
  channelName:   CHANNEL,
  videoPath,
  title:         TITLE,
  description:   DESCRIPTION,
  tags:          TAGS,
  thumbnailPath: thumbPath || null,
  scheduledAt:   SCHEDULED,
  privacyStatus: 'private',
});

const meta = { title: TITLE, description: DESCRIPTION, tags: TAGS, scheduledAt: SCHEDULED, channel: CHANNEL, videoId, privacyStatus: 'private' };
fs.writeFileSync(path.join(outputDir, 'youtube-metadata.json'), JSON.stringify(meta, null, 2));

console.log(`\n✓ Scheduled: https://www.youtube.com/watch?v=${videoId}`);
console.log(`  Studio:    https://studio.youtube.com/video/${videoId}/edit`);
console.log(`  Goes live: Tuesday 8am Bangkok (${SCHEDULED})`);

const archiveDir = path.join(ARCHIVE_DIR, videoId);
fs.mkdirSync(archiveDir, { recursive: true });
if (thumbPath && fs.existsSync(thumbPath)) fs.copyFileSync(thumbPath, path.join(archiveDir, 'thumbnail-final.png'));
fs.writeFileSync(path.join(archiveDir, 'manifest.json'), JSON.stringify({
  videoId, slug: path.basename(outputDir), outputDir, channelName: CHANNEL,
  scheduledAt: SCHEDULED, privacyStatus: 'private',
  uploadedAt: new Date().toISOString(), recoveryUpload: true, cleanedUp: false,
}, null, 2));
console.log(`  Archive:   ${archiveDir}`);
console.log('\n╔══════════════════════════════════════════╗');
console.log('║   ✅ Video 3 Scheduled                    ║');
console.log('╚══════════════════════════════════════════╝');
