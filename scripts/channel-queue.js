// Print scheduled queue + last public video stats for a channel
import 'dotenv/config';
import { listChannelVideos, getVideoStats, authenticate } from '../src/youtube.js';
import { google } from 'googleapis';

const channelName = process.argv[2];
if (!channelName) { console.error('Usage: node channel-queue.js <channelName>'); process.exit(1); }

const videos = await listChannelVideos(channelName);
const now = new Date();

const scheduled = videos
  .filter(v => v.privacyStatus === 'private' && v.scheduledAt && new Date(v.scheduledAt) > now)
  .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));

const published = videos
  .filter(v => v.privacyStatus === 'public')
  .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

console.log(`\n=== ${channelName} ===`);
console.log(`\nScheduled (${scheduled.length}):`);
for (const v of scheduled) {
  console.log(`  ${new Date(v.scheduledAt).toISOString().split('T')[0]}  ${v.title}  [${v.videoId}]`);
}

console.log(`\nPublished (${published.length} total), last 3:`);
for (const v of published.slice(0, 3)) {
  console.log(`  ${v.publishedAt?.split('T')[0]}  ${v.title}  [${v.videoId}]`);
}

if (published.length > 0) {
  const last = published[0];
  console.log(`\nStats for last published [${last.videoId}]:`);
  try {
    const stats = await getVideoStats(last.videoId, channelName);
    console.log(`  views: ${stats.views}  likes: ${stats.likes}  ctr: ${stats.ctr ?? 'n/a'}  retention: ${stats.retention_avg_pct ?? 'n/a'}  watch_min: ${stats.watch_time_minutes ?? 'n/a'}`);
  } catch (e) {
    console.log(`  (stats error: ${e.message})`);
  }
}
