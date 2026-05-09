/**
 * ingest-own-channel.js
 *
 * Lists ALL videos on the sleepless-philosophers channel via YouTube Data API,
 * marks which were made by SleepForge, pulls available analytics, and saves
 * to data/own-channel-history.json.
 *
 * This is OUTCOME DATA — never used as reference inspiration.
 *
 * Usage:  node scripts/ingest-own-channel.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { authenticate } = await import('../src/youtube.js');

const CHANNEL_NAME   = 'sleepless-philosophers';
const VIDEO_HISTORY  = path.join(ROOT, 'data', 'video-history.json');
const OUT_FILE       = path.join(ROOT, 'data', 'own-channel-history.json');
const STATE_FILE     = path.join(ROOT, 'data', 'own-channel-state.json');

function log(msg) { console.log(msg); }

function loadVideoHistory() {
  try { return JSON.parse(fs.readFileSync(VIDEO_HISTORY, 'utf-8')); }
  catch { return []; }
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { last_run: null }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── LIST ALL CHANNEL VIDEOS (paginated) ─────────────────────────────────────

async function listAllChannelVideos(youtube) {
  const videos = [];

  // Step 1: get the channel's uploads playlist ID
  const chanRes = await youtube.channels.list({ part: ['contentDetails'], mine: true });
  const uploadsPlaylistId = chanRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) throw new Error('Could not find uploads playlist');
  log(`  Uploads playlist: ${uploadsPlaylistId}`);

  // Step 2: page through playlist items
  let pageToken = undefined;
  let page = 0;
  do {
    page++;
    const res = await youtube.playlistItems.list({
      part: ['snippet', 'contentDetails'],
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      pageToken,
    });
    const items = res.data.items || [];
    for (const item of items) {
      const vid = item.contentDetails?.videoId;
      const snip = item.snippet || {};
      if (vid) videos.push({ video_id: vid, title: snip.title, published_at: snip.publishedAt, thumbnail_url: snip.thumbnails?.high?.url || snip.thumbnails?.default?.url || null, description: (snip.description || '').slice(0, 500) });
    }
    pageToken = res.data.nextPageToken;
    log(`  Page ${page}: ${items.length} videos (total so far: ${videos.length})`);
  } while (pageToken);

  return videos;
}

// ─── FETCH STATS IN BATCHES OF 50 ────────────────────────────────────────────

async function fetchVideoStats(youtube, videoIds) {
  const stats = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = await youtube.videos.list({ part: ['statistics', 'contentDetails'], id: batch });
    for (const item of res.data.items || []) {
      const s = item.statistics || {};
      stats[item.id] = {
        views:         parseInt(s.viewCount  || 0),
        likes:         parseInt(s.likeCount  || 0),
        comments:      parseInt(s.commentCount || 0),
        duration:      item.contentDetails?.duration || null,
      };
    }
  }
  return stats;
}

// ─── FETCH ANALYTICS (CTR, retention, watch time) ────────────────────────────

async function fetchAnalyticsForVideos(auth, videoIds, minAgeFilter = 7) {
  const analytics = google.youtubeAnalytics({ version: 'v2', auth });
  const results = {};
  const cutoff  = new Date(Date.now() - minAgeFilter * 86400000).toISOString().split('T')[0];
  const today   = new Date().toISOString().split('T')[0];
  const epoch   = '2020-01-01';

  for (const vid of videoIds) {
    try {
      const res = await analytics.reports.query({
        ids:        'channel==MINE',
        startDate:  epoch,
        endDate:    today,
        metrics:    'views,estimatedMinutesWatched,cardClickRate,averageViewPercentage,likes,comments,impressions',
        dimensions: 'video',
        filters:    `video==${vid}`,
      });
      const row = res.data.rows?.[0];
      if (row) {
        results[vid] = {
          views_analytics:      row[1] || null,
          watch_time_min:       row[2] || null,
          ctr:                  row[3] || null,
          retention_avg:        row[4] || null,
          likes_analytics:      row[5] || null,
          comments_analytics:   row[6] || null,
          impressions:          row[7] || null,
        };
      }
    } catch {
      // Analytics not available (video too new or API not enabled)
    }
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n══════════════════════════════════════════════════');
  log('  SleepForge — Own Channel Ingest');
  log('══════════════════════════════════════════════════\n');

  const state = loadState();
  if (state.last_run) log(`Last run: ${state.last_run}`);

  const sfHistory = loadVideoHistory();
  const sfVideoIds = new Set(sfHistory.map(v => v.video_id).filter(Boolean));
  log(`SleepForge-made videos: ${sfVideoIds.size} (from data/video-history.json)`);

  const auth    = await authenticate(CHANNEL_NAME);
  const youtube = google.youtube({ version: 'v3', auth });

  log('\nListing all channel videos...');
  const allVideos = await listAllChannelVideos(youtube);
  log(`\nTotal videos on channel: ${allVideos.length}`);

  log('\nFetching video statistics...');
  const videoIds = allVideos.map(v => v.video_id);
  const stats    = await fetchVideoStats(youtube, videoIds);

  log('\nFetching analytics (CTR, retention)...');
  const analytics = await fetchAnalyticsForVideos(auth, videoIds);

  // Merge everything
  const records = allVideos.map(v => {
    const s = stats[v.video_id] || {};
    const a = analytics[v.video_id] || {};
    const sfEntry = sfHistory.find(h => h.video_id === v.video_id);

    return {
      video_id:            v.video_id,
      title:               v.title,
      published_at:        v.published_at,
      thumbnail_url:       v.thumbnail_url,
      description:         v.description,
      was_made_by_sleepforge: sfVideoIds.has(v.video_id),
      // Principles used (only for sleepforge-made)
      principles_used:     sfEntry?.principles_used || null,
      // Stats
      views:               s.views     || 0,
      likes:               s.likes     || 0,
      comments:            s.comments  || 0,
      duration:            s.duration  || null,
      // Analytics (may be null if too new/too old)
      ctr:                 a.ctr               ?? null,
      avg_view_duration:   a.retention_avg     ?? null,
      watch_time_min:      a.watch_time_min    ?? null,
      impressions:         a.impressions       ?? null,
      ingested_at:         new Date().toISOString(),
    };
  });

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(records, null, 2));

  // Summary
  const sfMade   = records.filter(r => r.was_made_by_sleepforge);
  const withCtr  = records.filter(r => r.ctr !== null);
  log(`\n── Summary ──`);
  log(`  Total channel videos:   ${records.length}`);
  log(`  SleepForge-made:        ${sfMade.length}`);
  log(`  With CTR data:          ${withCtr.length}`);
  if (withCtr.length > 0) {
    const avgCtr = (withCtr.reduce((s, r) => s + r.ctr, 0) / withCtr.length).toFixed(2);
    log(`  Avg channel CTR:        ${avgCtr}%`);
  }
  log(`\n✓ Saved: ${OUT_FILE}`);

  saveState({ last_run: new Date().toISOString(), total_videos: records.length, sleepforge_made: sfMade.length });
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
