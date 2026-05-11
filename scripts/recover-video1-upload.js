/**
 * Minimal Video 1 upload — uses existing thumbnail, hardcoded metadata, no Claude calls.
 */
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { uploadVideo } = await import('../src/youtube.js');

const SLUG        = 'epicureanism-philosophy-true-teachings-of-epicurus-simple-li';
const TITLE       = 'All of Epicureanism Philosophy Explained in 1 Video for Deep Sleep';
const CHANNEL     = 'sleepless-philosophers';
const OUTPUT_DIR  = path.join(ROOT, 'output', SLUG);
const VIDEO_PATH  = path.join(OUTPUT_DIR, 'final.mp4');
const THUMB_PATH  = path.join(OUTPUT_DIR, 'thumb-v1', 'thumbnail.png');
const ARCHIVE_DIR = path.join(ROOT, 'data', 'uploaded-archive');

const DESCRIPTION = `Drift into peaceful sleep as we explore the timeless wisdom of Epicureanism — the ancient Greek philosophy of pleasure, contentment, and living a tranquil life. Epicurus taught that true happiness comes not from wealth or fame, but from simple pleasures, friendship, and freedom from fear. Let these calming philosophical teachings guide you into deep, restful sleep.

This video is completely free of advertisements to give you an uninterrupted sleep experience. Perfect for philosophy lovers, insomniacs, and anyone seeking calm bedtime content.

Topics covered: Epicurus on pleasure and pain · The four-fold cure (tetrapharmakos) · Friendship and community · Ataraxia (tranquility of mind) · Aponia (freedom from bodily pain) · Epicurean ethics and the good life · Death and the absence of fear.`;

const TAGS = [
  'epicureanism', 'epicurus', 'philosophy for sleep', 'sleep philosophy', 'deep sleep',
  'philosophy explained', 'ancient greek philosophy', 'epicurean philosophy', 'sleep meditation',
  'philosophy sleep music', 'ataraxia', 'epicurus philosophy', 'calm philosophy',
  'philosophy bedtime', 'no ads sleep', 'sleep story philosophy', 'greek philosophy sleep',
  'epicureanism explained', 'philosophy and sleep', 'sleepless philosophers',
];

console.log('\n╔══════════════════════════════════════════╗');
console.log('║   Video 1 — Direct Upload Recovery        ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`  Video:     ${VIDEO_PATH} (${(fs.statSync(VIDEO_PATH).size/1024/1024).toFixed(0)} MB)`);
console.log(`  Thumbnail: ${THUMB_PATH}`);
console.log(`  Privacy:   PUBLIC (live immediately)`);

const videoId = await uploadVideo({
  channelName:   CHANNEL,
  videoPath:     VIDEO_PATH,
  title:         TITLE,
  description:   DESCRIPTION,
  tags:          TAGS,
  thumbnailPath: THUMB_PATH,
  scheduledAt:   null,
  privacyStatus: 'public',
});

const meta = { title: TITLE, description: DESCRIPTION, tags: TAGS, scheduledAt: null, channel: CHANNEL, videoId, privacyStatus: 'public' };
fs.writeFileSync(path.join(OUTPUT_DIR, 'youtube-metadata.json'), JSON.stringify(meta, null, 2));

console.log(`\n✓ Live: https://www.youtube.com/watch?v=${videoId}`);
console.log(`  Studio: https://studio.youtube.com/video/${videoId}/edit`);

// Archive
const archiveDir = path.join(ARCHIVE_DIR, videoId);
fs.mkdirSync(archiveDir, { recursive: true });
fs.copyFileSync(THUMB_PATH, path.join(archiveDir, 'thumbnail-final.png'));
fs.copyFileSync(path.join(OUTPUT_DIR, 'youtube-metadata.json'), path.join(archiveDir, 'youtube-metadata.json'));

// Save unused variants if they exist
for (const v of [2, 3]) {
  const p = path.join(OUTPUT_DIR, `thumb-v${v}`, 'thumbnail.png');
  if (fs.existsSync(p)) fs.copyFileSync(p, path.join(archiveDir, `thumbnail-unused-v${v}.png`));
}

fs.writeFileSync(path.join(archiveDir, 'manifest.json'), JSON.stringify({
  videoId, slug: SLUG, outputDir: OUTPUT_DIR, channelName: CHANNEL,
  scheduledAt: null, privacyStatus: 'public',
  uploadedAt: new Date().toISOString(), recoveryUpload: true, cleanedUp: false,
}, null, 2));

console.log(`  Archive: ${archiveDir}`);
console.log('\n╔══════════════════════════════════════════╗');
console.log('║   ✅ Video 1 LIVE on YouTube              ║');
console.log('╚══════════════════════════════════════════╝');
