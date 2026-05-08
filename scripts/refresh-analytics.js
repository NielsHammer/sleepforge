/**
 * refresh-analytics.js
 * Pulls YouTube Analytics for every entry in data/video-history.json
 * and writes back ctr, retention_avg, views_24h.
 *
 * Usage: node scripts/refresh-analytics.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { getVideoStats } = await import('../src/youtube.js');

const HISTORY_FILE = path.join(ROOT, 'data', 'video-history.json');
const JARVIS_STATE = path.join(ROOT, 'jarvis', 'state.json');

function readHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); }
  catch { return []; }
}

function writeHistory(data) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2));
}

function updateJarvisAnalytics(history) {
  try {
    const state = JSON.parse(fs.readFileSync(JARVIS_STATE, 'utf-8'));
    const cache = {};
    for (const entry of history) {
      if (entry.video_id) {
        cache[entry.video_id] = {
          title:         entry.title_chosen,
          ctr:           entry.ctr,
          retention_avg: entry.retention_avg,
          views_24h:     entry.views_24h,
          views_total:   entry.views_total,
          refreshed_at:  entry.refreshed_at,
        };
      }
    }
    state.analytics_cache = cache;
    state.last_updated = new Date().toISOString();
    fs.writeFileSync(JARVIS_STATE, JSON.stringify(state, null, 2));
    console.log('  ✓ Jarvis analytics_cache updated');
  } catch (err) {
    console.warn('  Analytics cache update failed:', err.message);
  }
}

async function main() {
  const history = readHistory();
  if (!history.length) {
    console.log('No videos in history yet.');
    return;
  }

  console.log(`\nRefreshing analytics for ${history.length} video(s)...\n`);
  let updated = 0;
  let skipped = 0;

  // Group by channel to avoid re-authenticating per video
  const byChannel = {};
  for (const entry of history) {
    if (!entry.video_id || !entry.channel) { skipped++; continue; }
    if (!byChannel[entry.channel]) byChannel[entry.channel] = [];
    byChannel[entry.channel].push(entry);
  }

  for (const [channel, entries] of Object.entries(byChannel)) {
    console.log(`Channel: ${channel}`);
    for (const entry of entries) {
      try {
        console.log(`  ${entry.video_id} "${entry.title_chosen?.slice(0,50)}..."`);
        const stats = await getVideoStats(entry.video_id, channel);

        entry.views_total     = stats.views;
        entry.views_24h       = stats.views;   // rough — first day
        entry.ctr             = stats.ctr;
        entry.retention_avg   = stats.retention_avg_pct;
        entry.watch_time_min  = stats.watch_time_minutes;
        entry.likes           = stats.likes;
        entry.refreshed_at    = new Date().toISOString();

        console.log(`    views=${stats.views} likes=${stats.likes} ctr=${stats.ctr ?? 'pending'} retention=${stats.retention_avg_pct ?? 'pending'}`);
        updated++;
      } catch (err) {
        console.warn(`    Failed: ${err.message}`);
      }
      // Avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }
  }

  writeHistory(history);
  updateJarvisAnalytics(history);

  console.log(`\n✓ Updated: ${updated}  Skipped: ${skipped}`);
  console.log(`  Written: ${HISTORY_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
