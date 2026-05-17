/**
 * harvest-space-sleep-longform.js
 *
 * Stage 1A: Harvest 15 high-AVD long-form space sleep YouTube videos.
 * No YouTube Data API key needed — uses yt-dlp's native search.
 *
 * Strategy:
 *   1. Search via yt-dlp flat-playlist mode (fast, gets IDs + titles)
 *   2. Pre-filter by title keywords, dedupe by ID
 *   3. Fetch full metadata for top ~40 candidates (gets duration, views)
 *   4. Filter: duration > 2700s (45 min), views > 50K
 *   5. Dedupe by channel (max 3 per channel), sort by views desc
 *   6. Pick top 15, download transcript + thumbnail for each
 *
 * Output: C:\Users\niels\Desktop\References\by-niche\space_sleep_longform\<videoId>\
 *   - metadata.json
 *   - transcript.txt
 *   - thumbnail.jpg
 *
 * Usage: node scripts/harvest-space-sleep-longform.js
 */

import fs   from 'fs';
import path from 'path';
import https from 'https';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const OUT_DIR      = 'C:\\Users\\niels\\Desktop\\References\\by-niche\\space_sleep_longform';
const LOG_FILE     = path.join(OUT_DIR, 'harvest-log.txt');
const STATE_FILE   = path.join(OUT_DIR, 'harvest-state.json');
const MIN_DURATION = 2700;    // 45 minutes
const MIN_VIEWS    = 50_000;  // relaxed from 100K since sleep channels are niche
const MAX_PER_CHANNEL = 3;
const TARGET_COUNT = 15;
const META_FETCH_LIMIT = 40;  // max full-metadata fetches (time budget)

const SEARCH_QUERIES = [
  '2 hours space facts sleep',
  '1 hour space documentary sleep',
  'sleep space stories cosmos',
  'deep sleep space universe',
  'space facts fall asleep',
];

// Pre-filter: title must contain at least one of these (avoids gaming/music results)
const TITLE_MUST_INCLUDE = [
  'space', 'cosmos', 'universe', 'astronomy', 'nasa', 'galaxy', 'star',
  'planet', 'black hole', 'solar', 'orbit', 'voyager', 'telescope',
  'nebula', 'supernova', 'milky way', 'deep space', 'quantum',
];

// ─── RESOLVE yt-dlp ────────────────────────────────────────────────────────────

function resolveYtDlp() {
  try { spawnSync('yt-dlp', ['--version'], { timeout: 5000, encoding: 'utf-8' }); return 'yt-dlp'; } catch {}
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(winget)) {
    for (const pkg of fs.readdirSync(winget)) {
      if (pkg.startsWith('yt-dlp.yt-dlp')) {
        const exe = path.join(winget, pkg, 'yt-dlp.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  throw new Error('yt-dlp not found. Install with: winget install yt-dlp.yt-dlp');
}
const YTDLP = resolveYtDlp();

// ─── LOGGING ─────────────────────────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ─── STATE ───────────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { downloaded: [] }; }
}
function saveState(s) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

// ─── VTT → PLAIN TEXT ────────────────────────────────────────────────────────

function vttToPlainText(vtt) {
  return vtt
    .split('\n')
    .filter(l => !/^WEBVTT|^NOTE|^\d+$|^[\d:.]+\s*-->\s*[\d:.]+/.test(l.trim()))
    .map(l => l.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    .filter(l => l.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── SEARCH (flat mode — fast, just IDs + titles) ────────────────────────────

function searchYouTube(query, count = 20) {
  log(`  Searching: "${query}" (top ${count})...`);
  const result = spawnSync(YTDLP, [
    `ytsearch${count}:${query}`,
    '--flat-playlist',
    '--print-json',
    '--no-download',
    '--quiet',
  ], { timeout: 60000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

  if (result.status !== 0 || !result.stdout) {
    log(`  Search failed: ${(result.stderr || '').slice(0, 200)}`);
    return [];
  }

  const videos = [];
  for (const line of result.stdout.trim().split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    try {
      const v = JSON.parse(line);
      if (v.id && v.title) videos.push({ id: v.id, title: v.title, duration: v.duration, channel_id: v.channel_id, channel: v.channel || v.uploader });
    } catch {}
  }
  log(`  Found ${videos.length} results`);
  return videos;
}

// ─── FETCH FULL METADATA ──────────────────────────────────────────────────────

function fetchMetadata(videoId) {
  const result = spawnSync(YTDLP, [
    `https://www.youtube.com/watch?v=${videoId}`,
    '--dump-json',
    '--no-download',
    '--no-playlist',
    '--quiet',
  ], { timeout: 30000, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });

  if (result.status !== 0 || !result.stdout.trim()) return null;
  try { return JSON.parse(result.stdout.trim()); } catch { return null; }
}

// ─── DOWNLOAD TRANSCRIPT ──────────────────────────────────────────────────────

function downloadTranscript(videoId, outDir) {
  const tmpDir = path.join(outDir, '_vtt_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });

  // Try manual subs first, fall back to auto-subs
  for (const subArg of [['--write-subs'], ['--write-auto-sub']]) {
    const r = spawnSync(YTDLP, [
      ...subArg,
      '--sub-lang', 'en',
      '--sub-format', 'vtt',
      '--skip-download',
      '--no-playlist',
      '--quiet',
      '-o', path.join(tmpDir, 'sub'),
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 90000, encoding: 'utf-8' });

    const vttFiles = fs.existsSync(tmpDir)
      ? fs.readdirSync(tmpDir).filter(f => /\.(vtt|srt)$/i.test(f))
      : [];

    if (vttFiles.length > 0) {
      const raw = fs.readFileSync(path.join(tmpDir, vttFiles[0]), 'utf-8');
      const plain = vttToPlainText(raw);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      return plain;
    }
  }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  return null;
}

// ─── DOWNLOAD THUMBNAIL ───────────────────────────────────────────────────────

function downloadThumbnail(url, destPath) {
  if (!url) return;
  return new Promise((resolve) => {
    const proto = url.startsWith('https') ? https : require('http');
    const file = fs.createWriteStream(destPath);
    const req = proto.get(url, (res) => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', () => { try { fs.unlinkSync(destPath); } catch {} resolve(); });
    req.setTimeout(15000, () => { req.destroy(); resolve(); });
  });
}

// ─── DELAY ───────────────────────────────────────────────────────────────────

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── TITLE FILTER ─────────────────────────────────────────────────────────────

function titleLooksLikeSpaceContent(title) {
  const lower = title.toLowerCase();
  return TITLE_MUST_INCLUDE.some(kw => lower.includes(kw));
}

function titleLooksLongForm(title) {
  const lower = title.toLowerCase();
  return /\d\s*hour|\b(hour|hrs?)\b|full (?:video|documentary|episode)|long version/i.test(lower)
    || /sleep|relax|ambient|calm|meditation|asmr|drift/i.test(lower);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

log('\n══════════════════════════════════════════════════════');
log('  SleepForge — Space Sleep Longform Harvest');
log(`  Target: ${TARGET_COUNT} videos to ${OUT_DIR}`);
log('══════════════════════════════════════════════════════\n');

const state = loadState();
const alreadyDownloaded = new Set(state.downloaded);

// ── Step 1: Search all queries, collect unique candidates ────────────────────
log('── Step 1: Searching YouTube...');
const seen = new Map(); // id → basic info

for (const query of SEARCH_QUERIES) {
  const results = searchYouTube(query, 20);
  for (const v of results) {
    if (!seen.has(v.id)) seen.set(v.id, v);
  }
  await delay(2000); // polite between queries
}
log(`  Total unique candidates: ${seen.size}`);

// ── Step 2: Pre-filter by title ───────────────────────────────────────────────
log('\n── Step 2: Pre-filtering by title...');
const preFiltered = [...seen.values()].filter(v =>
  titleLooksLikeSpaceContent(v.title)
);
// Sort: prefer titles that look long-form
preFiltered.sort((a, b) =>
  (titleLooksLongForm(b.title) ? 1 : 0) - (titleLooksLongForm(a.title) ? 1 : 0)
);
log(`  After title filter: ${preFiltered.length} candidates`);

// ── Step 3: Fetch full metadata for top candidates ────────────────────────────
log(`\n── Step 3: Fetching full metadata (max ${META_FETCH_LIMIT})...`);
const enriched = [];
const toFetch = preFiltered.slice(0, META_FETCH_LIMIT);

for (let i = 0; i < toFetch.length; i++) {
  const v = toFetch[i];
  if (alreadyDownloaded.has(v.id)) { log(`  [${i+1}/${toFetch.length}] ${v.id} — already downloaded, skipping`); continue; }
  log(`  [${i+1}/${toFetch.length}] ${v.id}: "${v.title.slice(0, 60)}"`);
  const meta = fetchMetadata(v.id);
  if (!meta) { log(`    ✗ metadata fetch failed`); continue; }

  const duration = meta.duration || 0;
  const views    = meta.view_count || 0;
  log(`    duration=${Math.round(duration/60)}min views=${(views/1000).toFixed(0)}K channel="${(meta.uploader||'').slice(0,40)}"`);

  if (duration < MIN_DURATION) { log(`    ✗ too short (${Math.round(duration/60)} min)`); continue; }
  if (views > 0 && views < MIN_VIEWS) { log(`    ✗ too few views (${(views/1000).toFixed(0)}K)`); continue; }

  enriched.push({
    id:           meta.id,
    title:        meta.title,
    duration:     meta.duration,
    view_count:   meta.view_count || 0,
    channel:      meta.uploader || meta.channel || '',
    channel_id:   meta.channel_id || meta.uploader_id || '',
    description:  (meta.description || '').slice(0, 500),
    thumbnail_url: (meta.thumbnails || []).find(t => (t.width || 0) >= 320)?.url || meta.thumbnail,
    webpage_url:  meta.webpage_url,
  });
  await delay(3000); // polite between fetches
}
log(`  Passed duration+views filter: ${enriched.length}`);

// ── Step 4: Dedupe by channel, pick top 15 ────────────────────────────────────
log('\n── Step 4: Deduping by channel, ranking by views...');
const channelCount = new Map();
const dedupedList = [];

enriched.sort((a, b) => b.view_count - a.view_count);

for (const v of enriched) {
  const key = v.channel_id || v.channel;
  const count = channelCount.get(key) || 0;
  if (count >= MAX_PER_CHANNEL) { log(`  Skipping ${v.id} — channel "${v.channel}" already has ${count}`); continue; }
  channelCount.set(key, count + 1);
  dedupedList.push(v);
  if (dedupedList.length >= TARGET_COUNT) break;
}

log(`  Final selection: ${dedupedList.length} videos`);
for (const v of dedupedList) {
  log(`  • ${v.id} — "${v.title.slice(0, 60)}" (${Math.round(v.duration/60)}min, ${(v.view_count/1000).toFixed(0)}K views)`);
}

// ── Step 5: Download transcript + thumbnail ───────────────────────────────────
log('\n── Step 5: Downloading transcripts + thumbnails...');
let successCount = 0;

for (let i = 0; i < dedupedList.length; i++) {
  const v = dedupedList[i];
  if (alreadyDownloaded.has(v.id)) { log(`  [${i+1}/${dedupedList.length}] ${v.id} — already done`); successCount++; continue; }

  const videoDir = path.join(OUT_DIR, v.id);
  fs.mkdirSync(videoDir, { recursive: true });

  log(`\n  [${i+1}/${dedupedList.length}] ${v.id}: "${v.title.slice(0, 55)}"`);

  // Save metadata
  fs.writeFileSync(path.join(videoDir, 'metadata.json'), JSON.stringify({
    ...v,
    niche: 'space_sleep_longform',
    harvested_at: new Date().toISOString(),
  }, null, 2));

  // Download transcript
  log(`    Transcript...`);
  const transcript = downloadTranscript(v.id, videoDir);
  if (transcript && transcript.length > 100) {
    fs.writeFileSync(path.join(videoDir, 'transcript.txt'), transcript);
    log(`    ✓ transcript (${transcript.split(' ').length} words)`);
  } else {
    log(`    ✗ no transcript available`);
    fs.writeFileSync(path.join(videoDir, 'transcript.txt'), ''); // empty placeholder
  }

  // Download thumbnail
  if (v.thumbnail_url) {
    log(`    Thumbnail...`);
    try {
      await downloadThumbnail(v.thumbnail_url, path.join(videoDir, 'thumbnail.jpg'));
      log(`    ✓ thumbnail`);
    } catch (e) {
      log(`    ✗ thumbnail failed: ${e.message}`);
    }
  }

  state.downloaded.push(v.id);
  saveState(state);
  alreadyDownloaded.add(v.id);
  successCount++;

  if (i < dedupedList.length - 1) await delay(8000); // polite between videos
}

log(`\n══════════════════════════════════════════════════════`);
log(`  DONE — ${successCount}/${dedupedList.length} videos harvested`);
log(`  Output: ${OUT_DIR}`);
log(`\n  Next: node scripts/learn-space-script-patterns.js`);
log('══════════════════════════════════════════════════════\n');
