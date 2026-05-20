/**
 * philosophers-channel-analysis.js
 *
 * Pulls every video on sleepless-philosophers via YouTube Data + Analytics API,
 * downloads top-20 thumbnails, analyzes with Sonnet vision, generates report.
 *
 * Outputs:
 *   data/philosophers-channel-analysis-raw.json
 *   data/philosophers-top-10-views.json
 *   data/philosophers-top-10-ctr.json
 *   data/analysis/philosophers-winners/<videoId>.jpg
 *   data/philosophers-winners-analysis.md
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { authenticate } from '../src/youtube.js';
import { callClaudeCLI } from '../src/claude-cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const CHANNEL = 'sleepless-philosophers';
const DATA_DIR = path.join(ROOT, 'data');
const THUMB_DIR = path.join(DATA_DIR, 'analysis', 'philosophers-winners');
fs.mkdirSync(THUMB_DIR, { recursive: true });

const log = msg => console.log(msg);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = (url.startsWith('https') ? https : http).get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlink(dest, () => {});
        downloadFile(res.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    });
    req.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function formatDuration(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
}

// ─── FETCH ALL VIDEOS (Data API) ──────────────────────────────────────────────

async function fetchAllVideos(auth) {
  const yt = google.youtube({ version: 'v3', auth });

  const chanRes = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const uploadsId = chanRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsId) throw new Error('No uploads playlist found');

  const videoIds = [];
  let pageToken;
  do {
    const res = await yt.playlistItems.list({
      part: ['contentDetails'], playlistId: uploadsId, maxResults: 50, pageToken,
    });
    for (const item of res.data.items || []) {
      if (item.contentDetails?.videoId) videoIds.push(item.contentDetails.videoId);
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  log(`  Found ${videoIds.length} video IDs`);

  const videos = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const res = await yt.videos.list({ part: ['snippet', 'statistics', 'contentDetails'], id: batch });
    for (const item of res.data.items || []) {
      const dur = item.contentDetails?.duration || '';
      const hm = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const durationSec = hm ? (parseInt(hm[1]||0)*3600) + (parseInt(hm[2]||0)*60) + parseInt(hm[3]||0) : 0;
      const thumbs = item.snippet?.thumbnails || {};
      const thumbUrl = (thumbs.maxres || thumbs.high || thumbs.medium || thumbs.default)?.url || null;

      videos.push({
        videoId:      item.id,
        title:        item.snippet?.title || '',
        description:  item.snippet?.description || '',
        tags:         item.snippet?.tags || [],
        publishedAt:  item.snippet?.publishedAt || null,
        thumbnailUrl: thumbUrl,
        views:        parseInt(item.statistics?.viewCount || 0),
        likes:        parseInt(item.statistics?.likeCount || 0),
        comments:     parseInt(item.statistics?.commentCount || 0),
        durationSec,
        watchTimeMinutes: null,
        avgViewDurationSec: null,
        avgViewPct:   null,
        ctr:          null,
      });
    }
  }
  return videos;
}

// ─── FETCH ANALYTICS (per-video, for a subset of video IDs) ──────────────────
// YouTube Analytics API only supports per-video queries with filters: video==X.
// We query analytics for the top-N and bottom-N videos by views only.

async function fetchAnalyticsForVideos(auth, videoIds) {
  const analytics = google.youtubeAnalytics({ version: 'v2', auth });
  const today = new Date().toISOString().split('T')[0];
  const byId = {};

  for (const videoId of videoIds) {
    try {
      const res = await analytics.reports.query({
        ids: 'channel==MINE',
        startDate: '2020-01-01',
        endDate: today,
        metrics: 'estimatedMinutesWatched,averageViewDuration,averageViewPercentage',
        dimensions: 'video',
        filters: `video==${videoId}`,
      });
      const row = res.data.rows?.[0];
      if (row) {
        byId[videoId] = {
          watchTimeMinutes:   row[1],
          avgViewDurationSec: row[2],
          avgViewPct:         row[3],
        };
      }
    } catch (err) {
      // skip — analytics might be unavailable for private/deleted videos
    }
    // small delay to stay within quota
    await new Promise(r => setTimeout(r, 100));
  }
  log(`  Analytics: got data for ${Object.keys(byId).length}/${videoIds.length} videos`);
  return byId;
}

// ─── SONNET VISION: BATCH ANALYZE ALL THUMBNAILS ─────────────────────────────
// Sends all images in ONE Claude CLI call — Claude reads each file with the Read
// tool and returns a JSON array. Much faster than 17 sequential calls on Windows.

async function analyzeAllThumbnails(videos) {
  // Split into: already-cached vs needs-analysis
  const needsAnalysis = [];
  for (const v of videos) {
    const cachePath = path.join(THUMB_DIR, `${v.videoId}-analysis.json`);
    const imgPath   = path.join(THUMB_DIR, `${v.videoId}.jpg`);
    if (fs.existsSync(cachePath)) {
      try { v.analysis = JSON.parse(fs.readFileSync(cachePath, 'utf-8')); log(`  ✓ "${v.title.slice(0,55)}" (cached)`); }
      catch { needsAnalysis.push(v); }
    } else if (fs.existsSync(imgPath)) {
      needsAnalysis.push(v);
    } else {
      v.analysis = null;
    }
  }

  if (needsAnalysis.length === 0) { log('  All analyses cached — skipping Claude calls'); return; }
  log(`  Batch-analyzing ${needsAnalysis.length} thumbnails in one Claude CLI call...`);

  const imgList = needsAnalysis.map((v, i) =>
    `[${i+1}] videoId: ${v.videoId}\n    title: "${v.title}"\n    views: ${v.views.toLocaleString()} | avgViewPct: ${v.avgViewPct?.toFixed(1)||'n/a'}%\n    image path: ${path.join(THUMB_DIR, v.videoId + '.jpg')}`
  ).join('\n\n');

  const prompt = `You are analyzing ${needsAnalysis.length} YouTube thumbnails for a philosophy sleep channel (ancient philosophy, calm, chalk-on-blackboard or classical-portrait style).

For each entry below, use the Read tool to read the image file at the given path. Then analyze it.

${imgList}

After reading and analyzing all images, return a JSON array — one object per image, in the same order:
[
  {
    "videoId": "exact videoId from the list",
    "composition": "subject placement, focal element, background — one sentence",
    "typography": "font style, color, size, weight, placement — one sentence",
    "hook_text": "overlay text if visible or null",
    "hook_creates_curiosity": true or false,
    "color_palette": "dominant + 1-2 accent colors",
    "period_style": "ancient/medieval/modern/abstract/chalk-illustration/photoreal",
    "emotional_tone": "mysterious/dramatic/calm/ominous/reverent/serene",
    "click_worthy_reason": "one sentence: what makes this clickable"
  }
]

Return ONLY the JSON array with no markdown fences or explanation.`;

  try {
    const text = await callClaudeCLI(prompt, {
      model: 'claude-sonnet-4-6',
      timeoutMs: 480000, // 8 min for batch read+analysis
      addDirs: [THUMB_DIR],
      allowedTools: 'Read',
      permissionMode: 'acceptEdits',
    });

    const m = text.match(/\[[\s\S]*\]/s);
    if (!m) { log(`  ✗ Batch analysis returned no JSON array. Raw: ${text.slice(0, 200)}`); return; }
    const results = JSON.parse(m[0]);
    log(`  ✓ Received analyses for ${results.length} thumbnails`);

    for (const r of results) {
      const v = needsAnalysis.find(v => v.videoId === r.videoId);
      if (!v) continue;
      v.analysis = r;
      fs.writeFileSync(path.join(THUMB_DIR, `${v.videoId}-analysis.json`), JSON.stringify(r, null, 2));
      log(`  ✓ "${v.title.slice(0,55)}"`);
    }
  } catch (err) {
    log(`  ✗ Batch analysis failed: ${err.message}`);
  }
}

// ─── SONNET: SYNTHESIZE PATTERNS ──────────────────────────────────────────────

async function synthesizePatterns(topByCtr, topByViews, bottomByCtr) {
  const fmtBlock = (arr, n) => arr.slice(0, n).map((v, i) =>
    `${i+1}. "${v.title}"\n   Views: ${v.views.toLocaleString()} | AvgView: ${v.avgViewPct !== null ? v.avgViewPct.toFixed(1)+'%' : 'n/a'} | Watch: ${v.watchTimeMinutes ? Math.round(v.watchTimeMinutes).toLocaleString()+' min' : 'n/a'}\n   Analysis: ${JSON.stringify(v.analysis || {})}`
  ).join('\n\n');

  const prompt = `You are synthesizing YouTube thumbnail performance for a philosophy sleep channel (ancient philosophy, chalk-on-blackboard/classical-portrait style, calm aesthetic, insomniacs audience).

TOP 5 BY RETENTION (avg view %):
${fmtBlock(topByCtr, 5)}

TOP 5 BY VIEWS:
${fmtBlock(topByViews, 5)}

BOTTOM 5 BY RETENTION (lowest avg view %):
${fmtBlock(bottomByCtr, 5)}

Return ONLY valid JSON with no markdown fences:
{
  "ctr_patterns": ["visual/compositional/text pattern ALL top-5-retention thumbnails share", "pattern 2", "pattern 3"],
  "views_patterns": ["pattern ALL top-5-views thumbnails share", "pattern 2", "pattern 3"],
  "anti_patterns": ["something low-retention videos do that high-retention ones avoid", "anti-pattern 2", "anti-pattern 3"],
  "five_rules": [
    "Rule 1: [specific, actionable instruction for the Philosophy thumbnail generator — be concrete]",
    "Rule 2: ...",
    "Rule 3: ...",
    "Rule 4: ...",
    "Rule 5: ..."
  ],
  "bottom_analysis": "2-3 sentences: what specifically are low-retention thumbnails doing wrong?"
}`;

  const text = await callClaudeCLI(prompt, { model: 'claude-sonnet-4-6', timeoutMs: 120000 });
  const m = text.match(/\{[\s\S]*\}/s);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ─── REPORT BUILDER ───────────────────────────────────────────────────────────

function buildVideoBlock(v, rank, suffix) {
  const ctrStr = v.ctr !== null ? v.ctr.toFixed(2) + '%' : 'n/a';
  const viewStr = v.views.toLocaleString();
  const wt = v.watchTimeMinutes ? `${Math.round(v.watchTimeMinutes).toLocaleString()} min` : 'n/a';
  const dur = v.avgViewDurationSec ? formatDuration(Math.round(v.avgViewDurationSec)) : 'n/a';
  const a = v.analysis || {};

  return [
    `### ${rank}. ${v.title}`,
    `**Video:** https://youtube.com/watch?v=${v.videoId} | **Published:** ${v.publishedAt?.split('T')[0] || '?'}`,
    `**Views:** ${viewStr} | **CTR:** ${ctrStr} | **Avg View %:** ${v.avgViewPct !== null ? v.avgViewPct.toFixed(1)+'%' : 'n/a'} | **Avg Duration:** ${dur} | **Watch Time:** ${wt}`,
    a.composition ? `**Composition:** ${a.composition}` : '',
    a.typography  ? `**Typography:** ${a.typography}` : '',
    a.hook_text   ? `**Hook:** "${a.hook_text}" ${a.hook_creates_curiosity ? '✓ curiosity gap' : '✗ no curiosity gap'}` : '**Hook:** none',
    a.color_palette   ? `**Colors:** ${a.color_palette}` : '',
    a.period_style    ? `**Style:** ${a.period_style} | **Tone:** ${a.emotional_tone || 'n/a'}` : '',
    a.click_worthy_reason ? `**Why click:** ${a.click_worthy_reason}` : '',
    '',
  ].filter(l => l !== '').join('\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n╔══════════════════════════════════════════╗');
  log('║   Sleepless Philosophers — Full Analysis   ║');
  log('╚══════════════════════════════════════════╝\n');

  const auth = await authenticate(CHANNEL);
  log('✓ Auth: sleepless-philosophers');

  log('\n── Step 1: Fetching all videos ──');
  const videos = await fetchAllVideos(auth);
  log(`  ✓ ${videos.length} videos fetched`);

  // Pre-sort by views so we know which videos to fetch analytics for
  const byViews = [...videos].sort((a, b) => b.views - a.views);
  const top30ids = byViews.slice(0, 30).map(v => v.videoId);
  const bottom10ids = byViews.slice(-10).map(v => v.videoId);
  const analyticsIds = [...new Set([...top30ids, ...bottom10ids])];

  log(`\n── Step 2: Fetching analytics for ${analyticsIds.length} videos ──`);
  const analyticsMap = await fetchAnalyticsForVideos(auth, analyticsIds);
  for (const v of videos) {
    const a = analyticsMap[v.videoId];
    if (a) { v.watchTimeMinutes = a.watchTimeMinutes; v.avgViewDurationSec = a.avgViewDurationSec; v.avgViewPct = a.avgViewPct; }
  }

  fs.writeFileSync(path.join(DATA_DIR, 'philosophers-channel-analysis-raw.json'), JSON.stringify(videos, null, 2));
  log('  ✓ Raw data saved');

  // Top 10 by views (from Data API statistics — all 343 videos)
  const topByViews  = byViews.slice(0, 10);
  // Top 10 by retention (avg view %) — from the top 30 videos we fetched analytics for
  const top30       = byViews.slice(0, 30).filter(v => v.avgViewPct != null && v.avgViewPct > 0);
  const topByCtr    = [...top30].sort((a, b) => b.avgViewPct - a.avgViewPct).slice(0, 10);
  // Bottom 10 by views (worst performers by size)
  const bottomByCtr = byViews.slice(-10).filter(v => v.avgViewPct != null && v.avgViewPct > 0);

  fs.writeFileSync(path.join(DATA_DIR, 'philosophers-top-10-views.json'), JSON.stringify(topByViews, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'philosophers-top-10-ctr.json'),  JSON.stringify(topByCtr, null, 2));
  log(`  ✓ Top-10 by views:     "${topByViews[0]?.title?.slice(0,50)}" (${topByViews[0]?.views?.toLocaleString()} views)`);
  log(`  ✓ Top-10 by retention: "${topByCtr[0]?.title?.slice(0,50)}" (${topByCtr[0]?.avgViewPct?.toFixed(1)}% avg view)`);

  const top20Ids = new Set([...topByViews.map(v => v.videoId), ...topByCtr.map(v => v.videoId)]);
  const top20    = videos.filter(v => top20Ids.has(v.videoId));
  log(`  ✓ ${top20.length} unique videos in winning pool`);

  log('\n── Step 3: Downloading thumbnails ──');
  for (const v of top20) {
    if (!v.thumbnailUrl) { log(`  ⚠ No thumbnail URL for ${v.videoId}`); continue; }
    const dest = path.join(THUMB_DIR, `${v.videoId}.jpg`);
    if (fs.existsSync(dest)) { log(`  ✓ ${v.videoId}.jpg (cached)`); continue; }
    try { await downloadFile(v.thumbnailUrl, dest); log(`  ✓ Downloaded ${v.videoId}.jpg`); }
    catch (err) { log(`  ✗ ${v.videoId}: ${err.message}`); }
  }

  log('\n── Step 4: Sonnet vision analysis (batch — one CLI call for all) ──');
  await analyzeAllThumbnails(top20);

  const analysisById = Object.fromEntries(top20.map(v => [v.videoId, v]));
  const merge = arr => arr.map(v => ({ ...v, analysis: analysisById[v.videoId]?.analysis || null }));
  const topByCtrA     = merge(topByCtr);
  const topByViewsA   = merge(topByViews);
  const bottomByCtrA  = merge(bottomByCtr);

  log('\n── Step 5: Synthesizing patterns (Sonnet) ──');
  const patterns = await synthesizePatterns(topByCtrA, topByViewsA, bottomByCtrA);

  log('\n── Step 6: Writing report ──');
  const lines = [
    `# Sleepless Philosophers — Channel Performance Analysis`,
    `_Generated: ${new Date().toISOString()} | Channel: @SleeplessPhilosophers | Total videos: ${videos.length}_`,
    '',
    '---',
    '',
    '## TOP 10 BY RETENTION (Avg View %)',
    '_Sorted by average view percentage — viewers who watched the most of the video_',
    '',
    ...topByCtrA.map((v, i) => buildVideoBlock(v, i+1, 'ctr')),
    '',
    '---',
    '',
    '## TOP 10 BY VIEWS',
    '_Sorted by lifetime view count_',
    '',
    ...topByViewsA.map((v, i) => buildVideoBlock(v, i+1, 'views')),
    '',
    '---',
    '',
    '## PATTERN ANALYSIS',
    '',
    '### What the Top 5 Retention Thumbnails ALL Share',
    ...(patterns?.ctr_patterns || ['(synthesis unavailable)']).map(p => `- ${p}`),
    '',
    '### What the Top 5 Views Thumbnails ALL Share',
    ...(patterns?.views_patterns || ['(synthesis unavailable)']).map(p => `- ${p}`),
    '',
    '### Anti-Patterns (What Winners Avoid)',
    ...(patterns?.anti_patterns || ['(synthesis unavailable)']).map(p => `- ${p}`),
    '',
    '---',
    '',
    '## 5 RULES FOR THE PHILOSOPHY THUMBNAIL GENERATOR',
    '',
    ...(patterns?.five_rules || ['(synthesis unavailable)']).map((r, i) => `**${i+1}.** ${r}`),
    '',
    '---',
    '',
    '## BOTTOM 5 BY RETENTION — What\'s Going Wrong',
    '',
    ...bottomByCtrA.slice(0, 5).map((v, i) => buildVideoBlock(v, i+1, 'bottom')),
    '',
    patterns?.bottom_analysis ? `**Diagnosis:** ${patterns.bottom_analysis}` : '',
  ].join('\n');

  const reportPath = path.join(DATA_DIR, 'philosophers-winners-analysis.md');
  fs.writeFileSync(reportPath, lines);

  log('\n╔══════════════════════════════════════════╗');
  log('║   ✅ Analysis Complete                     ║');
  log('╚══════════════════════════════════════════╝');
  log(`  Report: ${reportPath}`);
  log(`  Top retention: "${topByCtr[0]?.title?.slice(0,55)}" — ${topByCtr[0]?.avgViewPct?.toFixed(1)}% avg view`);
  log(`  Top views:     "${topByViews[0]?.title?.slice(0,55)}" — ${topByViews[0]?.views?.toLocaleString()}`);
  log(`  Low retention: "${bottomByCtr[0]?.title?.slice(0,55)}" — ${bottomByCtr[0]?.avgViewPct?.toFixed(1)}% avg view`);
}

main().catch(err => { console.error('\nFatal:', err.message, err.stack); process.exit(1); });
