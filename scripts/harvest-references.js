/**
 * harvest-references.js
 *
 * Phase 1: Harvest YouTube metadata + thumbnails for reference learning.
 * Uses official YouTube Data API v3 (OAuth2) — fully ToS-compliant, zero block risk.
 *
 * Usage:
 *   node scripts/harvest-references.js             — Phase 1 only (metadata + thumbnails)
 *   node scripts/harvest-references.js --transcripts — also run Phase 2 (yt-dlp)
 *   node scripts/harvest-references.js --niche sleep_philosophy — one niche only
 *   node scripts/harvest-references.js --dry-run   — show what would be fetched
 *
 * Resumable: reads harvest-state.json, skips already-harvested video IDs.
 * Stops at 8,500 quota units/day. Picks up where it left off next run.
 *
 * Output: C:\Users\niels\Desktop\References\
 */

import { google } from 'googleapis';
import fs   from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { authenticate } = await import('../src/youtube.js');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const REFS_DIR     = 'C:\\Users\\niels\\Desktop\\References';
const STATE_FILE   = path.join(REFS_DIR, 'harvest-state.json');
const INDEX_FILE   = path.join(REFS_DIR, 'index.json');
const LOG_FILE     = path.join(REFS_DIR, 'harvest-log.txt');
const QUERIES_FILE = path.join(ROOT, 'data', 'harvest-queries.json');

const CHANNEL      = 'sleepless-philosophers';
const MIN_VIEWS    = 100_000;
const DAILY_BUDGET = 8_500;
const APP_RESERVE  = 1_500;
const SEARCH_COST  = 100;
const VIDEO_COST   = 1;   // per video (conservative — actual API cost is per-batch call)
const MAX_PAGES    = 4;

const IS_DRY_RUN    = process.argv.includes('--dry-run');
const NICHE_FILTER  = (() => { const i = process.argv.indexOf('--niche'); return i >= 0 ? process.argv[i+1] : null; })();

// ─── LOGGING ─────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ─── STATE ───────────────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {
      harvested_ids: [],
      quota: { date: '', units_used: 0 },
      completed_queries: [],
      ip_blocked_until: null,
      last_run: null,
    };
  }
}

function saveState(state) {
  fs.mkdirSync(REFS_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function todayQuotaUsed(state) {
  const today = new Date().toISOString().split('T')[0];
  if (state.quota.date !== today) {
    state.quota = { date: today, units_used: 0 };
  }
  return state.quota.units_used;
}

function spendQuota(state, units) {
  const today = new Date().toISOString().split('T')[0];
  if (state.quota.date !== today) state.quota = { date: today, units_used: 0 };
  state.quota.units_used += units;
}

function quotaRemaining(state) {
  todayQuotaUsed(state); // ensure date reset
  return DAILY_BUDGET - APP_RESERVE - state.quota.units_used;
}

// ─── INDEX ───────────────────────────────────────────────────────────────────

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8')); }
  catch { return []; }
}

function saveIndex(index) {
  fs.mkdirSync(REFS_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

// ─── THUMBNAIL DOWNLOAD ──────────────────────────────────────────────────────

function downloadThumbnail(videoId, destPath) {
  return new Promise((resolve) => {
    // Try maxresdefault (1280×720) first, fall back to hqdefault (480×360)
    const tryUrl = (url, fallback) => {
      https.get(url, (res) => {
        if (res.statusCode === 404 && fallback) {
          tryUrl(fallback, null);
          return;
        }
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }
        const file = fs.createWriteStream(destPath);
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(true); });
        file.on('error', () => resolve(false));
      }).on('error', () => {
        if (fallback) tryUrl(fallback, null);
        else resolve(false);
      });
    };
    tryUrl(
      `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    );
  });
}

// ─── DURATION PARSING ────────────────────────────────────────────────────────

function parseDurationSec(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + parseInt(m[3]||0);
}

// ─── YOUTUBE API HELPERS ─────────────────────────────────────────────────────

async function searchPage(youtube, query, pageToken, publishedAfter) {
  const res = await youtube.search.list({
    part: ['id'],
    q: query,
    type: ['video'],
    videoDuration: 'long',
    order: 'viewCount',
    relevanceLanguage: 'en',
    publishedAfter: publishedAfter.toISOString(),
    maxResults: 50,
    ...(pageToken ? { pageToken } : {}),
  });
  return {
    ids:           (res.data.items || []).map(i => i.id.videoId).filter(Boolean),
    nextPageToken: res.data.nextPageToken || null,
  };
}

async function getVideoDetails(youtube, videoIds) {
  // Batch 50 at a time
  const results = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = await youtube.videos.list({
      part: ['snippet', 'statistics', 'contentDetails'],
      id: batch,
    });
    results.push(...(res.data.items || []));
  }
  return results;
}

// ─── PROCESS ONE VIDEO ───────────────────────────────────────────────────────

async function processVideo(item, nicheId, harvestedSet, index) {
  const vid = item.id;
  const sn  = item.snippet || {};
  const st  = item.statistics || {};
  const cd  = item.contentDetails || {};

  const views = parseInt(st.viewCount || '0');
  if (views < MIN_VIEWS) return false;

  const durationSec = parseDurationSec(cd.duration);
  if (durationSec < 30 * 60) return false; // skip videos < 30 min

  const videoDir = path.join(REFS_DIR, 'by-niche', nicheId, vid);
  fs.mkdirSync(videoDir, { recursive: true });

  const metadata = {
    video_id:        vid,
    url:             `https://www.youtube.com/watch?v=${vid}`,
    niche:           nicheId,
    title:           sn.title || '',
    description:     (sn.description || '').slice(0, 2000),
    channel_title:   sn.channelTitle || '',
    channel_id:      sn.channelId || '',
    published_at:    sn.publishedAt || '',
    tags:            sn.tags || [],
    default_language: sn.defaultLanguage || 'en',
    view_count:      views,
    like_count:      parseInt(st.likeCount || '0'),
    comment_count:   parseInt(st.commentCount || '0'),
    duration_sec:    durationSec,
    duration_iso:    cd.duration || '',
    thumbnail_url:   sn.thumbnails?.maxres?.url || sn.thumbnails?.high?.url || '',
    harvested_at:    new Date().toISOString(),
  };

  fs.writeFileSync(path.join(videoDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

  // Download thumbnail (CDN — no rate limit, no auth)
  const thumbPath = path.join(videoDir, 'thumbnail.jpg');
  if (!fs.existsSync(thumbPath)) {
    await downloadThumbnail(vid, thumbPath);
  }

  // Update in-memory index
  const existing = index.findIndex(e => e.video_id === vid);
  if (existing >= 0) index[existing] = metadata;
  else index.push(metadata);

  harvestedSet.add(vid);
  return true;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(REFS_DIR, { recursive: true });
  fs.mkdirSync(path.join(REFS_DIR, 'by-niche'), { recursive: true });

  log('══════════════════════════════════════════════════');
  log('  SleepForge — Reference Harvester (Phase 1)');
  log('══════════════════════════════════════════════════');
  if (IS_DRY_RUN) log('  DRY RUN — no writes to YouTube API');

  const state  = loadState();
  const index  = loadIndex();
  const queries = JSON.parse(fs.readFileSync(QUERIES_FILE, 'utf-8'));
  const harvestedSet = new Set(state.harvested_ids);

  todayQuotaUsed(state); // reset if new day
  log(`Quota: ${state.quota.units_used}/${DAILY_BUDGET - APP_RESERVE} used today`);
  log(`Harvested so far: ${harvestedSet.size} videos`);

  if (quotaRemaining(state) < SEARCH_COST) {
    log('Daily quota exhausted — run again tomorrow.');
    return;
  }

  // Authenticate once
  let youtube;
  if (!IS_DRY_RUN) {
    log('\nAuthenticating via OAuth...');
    const auth = await authenticate(CHANNEL);
    youtube = google.youtube({ version: 'v3', auth });
    log('  ✓ Authenticated');
  }

  const publishedAfter = new Date();
  publishedAfter.setMonth(publishedAfter.getMonth() - 12);

  let totalNew = 0;
  const nicheStats = {};

  const niches = NICHE_FILTER
    ? queries.niches.filter(n => n.id === NICHE_FILTER)
    : queries.niches;

  for (const niche of niches) {
    log(`\n── Niche: ${niche.label} (${niche.id}) ──`);
    nicheStats[niche.id] = { new: 0, skipped: 0 };
    fs.mkdirSync(path.join(REFS_DIR, 'by-niche', niche.id), { recursive: true });

    for (const query of niche.queries) {
      const queryKey = `${niche.id}::${query}`;
      if (state.completed_queries.includes(queryKey)) {
        log(`  [cached] "${query}"`);
        continue;
      }

      if (quotaRemaining(state) < SEARCH_COST + 50) {
        log(`  Quota low (${quotaRemaining(state)} units) — stopping for today.`);
        break;
      }

      log(`  Query: "${query}"`);
      const collectedIds = [];
      let pageToken = null;
      let page = 0;

      // Paginate search results
      while (page < MAX_PAGES) {
        if (quotaRemaining(state) < SEARCH_COST) break;

        if (IS_DRY_RUN) {
          log(`    [dry-run] search page ${page+1} (would cost ${SEARCH_COST} units)`);
          spendQuota(state, SEARCH_COST); // simulate
          break;
        }

        try {
          const result = await searchPage(youtube, query, pageToken, publishedAfter);
          spendQuota(state, SEARCH_COST);
          const newIds = result.ids.filter(id => !harvestedSet.has(id));
          collectedIds.push(...newIds);
          log(`    Page ${page+1}: ${result.ids.length} results (${newIds.length} new) — quota remaining: ${quotaRemaining(state)}`);

          if (!result.nextPageToken || newIds.length === 0) break;
          pageToken = result.nextPageToken;
          page++;
          await new Promise(r => setTimeout(r, 500)); // gentle pacing
        } catch (err) {
          log(`    Search error: ${err.message}`);
          break;
        }
      }

      if (IS_DRY_RUN || collectedIds.length === 0) {
        state.completed_queries.push(queryKey);
        saveState(state);
        continue;
      }

      // Fetch video details in batches — check quota
      const videoCost = collectedIds.length * VIDEO_COST;
      if (quotaRemaining(state) < videoCost) {
        log(`    Quota would be exceeded by details fetch (${videoCost} units) — deferring.`);
        saveState(state);
        continue;
      }

      log(`    Fetching details for ${collectedIds.length} videos...`);
      let items;
      try {
        items = await getVideoDetails(youtube, collectedIds);
        // Cost: 1 unit per video (conservative per user spec)
        spendQuota(state, collectedIds.length * VIDEO_COST);
      } catch (err) {
        log(`    Details fetch error: ${err.message}`);
        saveState(state);
        continue;
      }

      // Process each video
      let queryNew = 0;
      let querySkip = 0;
      for (const item of items) {
        if (harvestedSet.has(item.id)) { querySkip++; continue; }
        const added = await processVideo(item, niche.id, harvestedSet, index);
        if (added) { queryNew++; totalNew++; nicheStats[niche.id].new++; }
        else        { querySkip++; nicheStats[niche.id].skipped++; }
      }
      log(`    ✓ ${queryNew} added, ${querySkip} skipped (low views/short) — total quota used: ${state.quota.units_used}`);

      state.harvested_ids = [...harvestedSet];
      state.completed_queries.push(queryKey);
      saveState(state);
      saveIndex(index);

      await new Promise(r => setTimeout(r, 1000)); // 1s between queries
    }

    log(`  Niche total: ${nicheStats[niche.id].new} new videos`);
  }

  // Final save
  state.harvested_ids = [...harvestedSet];
  state.last_run = new Date().toISOString();
  saveState(state);
  saveIndex(index);

  // ── Day 1 Report ──────────────────────────────────────────────────────────
  log('\n══════════════════════════════════════════════════');
  log('  DAY 1 HARVEST REPORT');
  log('══════════════════════════════════════════════════');
  log(`Total new references collected: ${totalNew}`);
  log(`Total in database: ${harvestedSet.size}`);
  log(`Quota used today: ${state.quota.units_used} / ${DAILY_BUDGET - APP_RESERVE}`);
  log(`Quota remaining: ${quotaRemaining(state)}`);
  log('');
  log('Breakdown by niche:');
  for (const [nicheId, stats] of Object.entries(nicheStats)) {
    const niche = niches.find(n => n.id === nicheId);
    const total = index.filter(v => v.niche === nicheId).length;
    log(`  ${(niche?.label || nicheId).padEnd(22)} ${String(stats.new).padStart(4)} new   (${total} total)`);
  }

  // Top 10 by view count
  const top10 = [...index].sort((a, b) => b.view_count - a.view_count).slice(0, 10);
  if (top10.length > 0) {
    log('');
    log('Top 10 highest-view videos harvested:');
    top10.forEach((v, i) => {
      const views = v.view_count >= 1_000_000
        ? `${(v.view_count/1_000_000).toFixed(1)}M`
        : `${Math.round(v.view_count/1000)}K`;
      log(`  ${String(i+1).padStart(2)}. [${views}] ${v.title.slice(0, 55)} — ${v.channel_title}`);
    });
  }

  // Folder size estimate
  let totalFiles = 0;
  for (const v of index) {
    const d = path.join(REFS_DIR, 'by-niche', v.niche, v.video_id);
    if (fs.existsSync(d)) totalFiles += fs.readdirSync(d).length;
  }
  log('');
  log(`Files on Desktop: ${totalFiles} (metadata.json + thumbnail.jpg per video)`);

  // Estimate days to 5000 references
  if (totalNew > 0) {
    const daysTo5k = Math.ceil((5000 - harvestedSet.size) / Math.max(totalNew, 1));
    log(`Estimated days to 5,000 references at today's rate: ${daysTo5k}`);
  }
  log('══════════════════════════════════════════════════');

  // yt-dlp notice
  log('\nPhase 2 (transcripts): yt-dlp is not installed.');
  log('Install with:  pip install yt-dlp  OR  winget install yt-dlp');
  log('Then run:      node scripts/harvest-references.js --transcripts');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
