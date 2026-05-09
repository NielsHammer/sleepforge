/**
 * refresh-analytics.js
 *
 * Pulls YouTube Analytics for every entry in data/video-history.json
 * and writes back richer metrics. Also updates data/own-channel-history.json
 * if it exists.
 *
 * Usage:
 *   node scripts/refresh-analytics.js                  # default: 7-day age gate
 *   node scripts/refresh-analytics.js --age-filter 14  # skip videos younger than 14 days
 *   node scripts/refresh-analytics.js --age-filter 0   # include all (day-1 noise possible)
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

const HISTORY_FILE = path.join(ROOT, 'data', 'video-history.json');
const OWN_HISTORY  = path.join(ROOT, 'data', 'own-channel-history.json');
const JARVIS_STATE = path.join(ROOT, 'jarvis', 'state.json');
const CHANNEL_NAME = 'sleepless-philosophers';

const ageFilterIdx    = process.argv.indexOf('--age-filter');
const AGE_FILTER_DAYS = ageFilterIdx !== -1 ? parseInt(process.argv[ageFilterIdx + 1] || '7') : 7;

function log(msg) { console.log(msg); }
function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return fb; } }

async function fetchAnalytics(auth, videoId) {
  const analytics = google.youtubeAnalytics({ version: 'v2', auth });
  const today = new Date().toISOString().split('T')[0];
  // impressions/impressionClickThroughRate not available per-video in Analytics API v2
  const res = await analytics.reports.query({
    ids: 'channel==MINE', startDate: '2020-01-01', endDate: today,
    metrics: 'views,estimatedMinutesWatched,averageViewPercentage,likes,comments',
    dimensions: 'video', filters: `video==${videoId}`,
  });
  const row = res.data.rows?.[0];
  if (!row) return null;
  return { views_analytics: row[1], watch_time_min: row[2], ctr: null, retention_avg: row[3], likes_analytics: row[4], comments_analytics: row[5] };
}

async function fetchBasicStats(youtube, videoId) {
  const res = await youtube.videos.list({ part: ['statistics'], id: [videoId] });
  const s = res.data.items?.[0]?.statistics || {};
  return { views: parseInt(s.viewCount || 0), likes: parseInt(s.likeCount || 0), comments: parseInt(s.commentCount || 0) };
}

function updateJarvis(history) {
  try {
    const state = readJson(JARVIS_STATE, { renders: [], publishes: [], analytics_cache: {} });
    state.analytics_cache = {};
    for (const v of history) {
      if (!v.video_id) continue;
      state.analytics_cache[v.video_id] = { title: v.title_chosen, ctr: v.ctr, retention_avg: v.retention_avg, views_total: v.views_total, refreshed_at: v.refreshed_at };
    }
    state.last_updated = new Date().toISOString();
    fs.writeFileSync(JARVIS_STATE, JSON.stringify(state, null, 2));
    log('  ✓ Jarvis analytics_cache updated');
  } catch (err) { log(`  Jarvis update failed: ${err.message}`); }
}

async function main() {
  log('\n══════════════════════════════════════════════════');
  log('  SleepForge — Refresh Analytics');
  log(`  Age filter: skip videos younger than ${AGE_FILTER_DAYS} days`);
  log('══════════════════════════════════════════════════\n');

  const history = readJson(HISTORY_FILE, []);
  if (!history.length) { log('No videos in video-history.json.'); return; }

  const auth    = await authenticate(CHANNEL_NAME);
  const youtube = google.youtube({ version: 'v3', auth });
  const cutoff  = new Date(Date.now() - AGE_FILTER_DAYS * 86400000);
  let updated = 0, skippedAge = 0, failed = 0;

  for (const entry of history) {
    if (!entry.video_id) continue;
    const uploadedAt = new Date(entry.uploaded_at || 0);
    if (AGE_FILTER_DAYS > 0 && uploadedAt > cutoff) { skippedAge++; continue; }
    try {
      log(`  ${entry.video_id} "${(entry.title_chosen || '').slice(0, 50)}"`);
      const basic = await fetchBasicStats(youtube, entry.video_id);
      let analy = null;
      try { analy = await fetchAnalytics(auth, entry.video_id); } catch {}
      entry.views_total    = basic.views;
      entry.likes          = basic.likes;
      entry.comments       = basic.comments;
      entry.ctr            = null;  // unavailable via Analytics API v2 per-video
      entry.retention_avg  = analy?.retention_avg ?? null;
      entry.watch_time_min = analy?.watch_time_min ?? null;
      entry.refreshed_at   = new Date().toISOString();
      log(`    views=${basic.views} ret=${analy?.retention_avg ?? 'pending'}%`);
      updated++;
    } catch (err) { log(`    Failed: ${err.message}`); failed++; }
    await new Promise(r => setTimeout(r, 400));
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  updateJarvis(history);

  if (fs.existsSync(OWN_HISTORY)) {
    log('\nUpdating own-channel-history.json...');
    const own = readJson(OWN_HISTORY, []);
    let ownUpdated = 0;
    for (const r of own) {
      if (!r.video_id) continue;
      if (AGE_FILTER_DAYS > 0 && new Date(r.published_at || 0) > cutoff) continue;
      try {
        let analy = null;
        try { analy = await fetchAnalytics(auth, r.video_id); } catch {}
        if (analy) {
          r.ctr              = analy.ctr            ?? r.ctr;
          r.avg_view_duration = analy.retention_avg ?? r.avg_view_duration;
          r.watch_time_min   = analy.watch_time_min ?? r.watch_time_min;
          r.impressions      = analy.impressions    ?? r.impressions;
          r.refreshed_at     = new Date().toISOString();
          ownUpdated++;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 200));
    }
    fs.writeFileSync(OWN_HISTORY, JSON.stringify(own, null, 2));
    log(`  ✓ own-channel-history: ${ownUpdated} updated`);
  }

  log(`\n✓ Done — updated: ${updated}, skipped (age): ${skippedAge}, failed: ${failed}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
