/**
 * harvest-status.js
 *
 * Quick overview of the reference harvest database.
 *
 * Usage: node scripts/harvest-status.js
 */

import fs   from 'fs';
import path from 'path';

const REFS_DIR   = 'C:\\Users\\niels\\Desktop\\References';
const INDEX_FILE = path.join(REFS_DIR, 'index.json');
const STATE_FILE = path.join(REFS_DIR, 'harvest-state.json');

const DAILY_BUDGET = 8_500;
const APP_RESERVE  = 1_500;

function fmtViews(n) {
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${Math.round(n/1000)}K`;
  return String(n);
}

function fmtDur(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

function main() {
  console.log('══════════════════════════════════════════════════');
  console.log('  SleepForge — Reference Harvest Status');
  console.log('══════════════════════════════════════════════════\n');

  if (!fs.existsSync(REFS_DIR)) {
    console.log('References folder not found. Run harvest-references.js first.');
    return;
  }

  // Quota state
  const state = fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
    : { quota: { date: '', units_used: 0 }, ip_blocked_until: null };

  const today = new Date().toISOString().split('T')[0];
  const quotaToday = state.quota?.date === today ? (state.quota?.units_used || 0) : 0;
  const quotaLimit = DAILY_BUDGET - APP_RESERVE;
  const quotaRemaining = quotaLimit - quotaToday;

  console.log(`Quota today:    ${quotaToday} / ${quotaLimit} units used`);
  console.log(`Remaining:      ${quotaRemaining} units`);
  if (state.ip_blocked_until) {
    const blockedUntil = new Date(state.ip_blocked_until);
    console.log(`IP block:       until ${blockedUntil.toLocaleString()}`);
  }
  console.log('');

  // Index stats
  if (!fs.existsSync(INDEX_FILE)) {
    console.log('No index.json yet. Run harvest-references.js first.');
    return;
  }

  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  console.log(`Total references: ${index.length}`);
  console.log('');

  // By niche
  const niches = {};
  for (const v of index) {
    if (!niches[v.niche]) niches[v.niche] = { total: 0, withTranscript: 0, views: [] };
    niches[v.niche].total++;
    niches[v.niche].views.push(v.view_count);
    const tp = path.join(REFS_DIR, 'by-niche', v.niche, v.video_id, 'transcript.txt');
    if (fs.existsSync(tp)) niches[v.niche].withTranscript++;
  }

  console.log('By niche:');
  const nicheLabels = {
    sleep_philosophy: 'Sleep Philosophy',
    sleep_history:    'Sleep History',
    sleep_lit:        'Sleep Literature',
    sleep_ambient:    'Sleep Ambient',
    spoken_word_calm: 'Spoken Word Calm',
  };
  for (const [nicheId, stats] of Object.entries(niches)) {
    const label = nicheLabels[nicheId] || nicheId;
    const avgViews = Math.round(stats.views.reduce((a,b)=>a+b,0)/stats.views.length);
    const transcriptPct = Math.round(100 * stats.withTranscript / stats.total);
    console.log(`  ${label.padEnd(22)} ${String(stats.total).padStart(4)} videos | ` +
                `transcripts: ${stats.withTranscript}/${stats.total} (${transcriptPct}%) | ` +
                `avg views: ${fmtViews(avgViews)}`);
  }

  // Overall transcript coverage
  const withTranscript = index.filter(v =>
    fs.existsSync(path.join(REFS_DIR, 'by-niche', v.niche, v.video_id, 'transcript.txt'))
  ).length;
  console.log(`\nTranscript coverage: ${withTranscript}/${index.length} (${Math.round(100*withTranscript/Math.max(index.length,1))}%)`);

  // Top 10
  const top10 = [...index].sort((a, b) => b.view_count - a.view_count).slice(0, 10);
  if (top10.length > 0) {
    console.log('\nTop 10 by view count:');
    top10.forEach((v, i) => {
      const hasTx = fs.existsSync(path.join(REFS_DIR, 'by-niche', v.niche, v.video_id, 'transcript.txt'));
      console.log(`  ${String(i+1).padStart(2)}. [${fmtViews(v.view_count).padStart(5)}] [${fmtDur(v.duration_sec).padStart(5)}] ${hasTx?'📝':'  '} ${v.title.slice(0, 55)} — ${v.channel_title}`);
    });
  }

  // Estimates
  if (index.length > 0) {
    const daysTo5k = Math.ceil(Math.max(0, 5000 - index.length) / Math.max(1, index.length));
    if (index.length < 5000) {
      // Better estimate: look at recent growth from state
      const completedQueries = state.completed_queries?.length || 0;
      const totalQueries = 27; // 5 niches × avg 5-7 queries
      console.log(`\nEstimated days to 5,000: depends on daily run — est. ${Math.ceil(5000/Math.max(index.length,1))} more runs`);
    } else {
      console.log('\n✓ 5,000 reference target reached!');
    }
  }

  // Folder size
  let fileSizeBytes = 0;
  let fileCount = 0;
  const byNicheDir = path.join(REFS_DIR, 'by-niche');
  if (fs.existsSync(byNicheDir)) {
    for (const niche of fs.readdirSync(byNicheDir)) {
      const nicheDir = path.join(byNicheDir, niche);
      if (!fs.statSync(nicheDir).isDirectory()) continue;
      for (const vid of fs.readdirSync(nicheDir)) {
        const vidDir = path.join(nicheDir, vid);
        if (!fs.statSync(vidDir).isDirectory()) continue;
        for (const file of fs.readdirSync(vidDir)) {
          fileCount++;
          try { fileSizeBytes += fs.statSync(path.join(vidDir, file)).size; } catch {}
        }
      }
    }
  }
  const sizeMb = (fileSizeBytes / 1024 / 1024).toFixed(1);
  console.log(`\nFolder size: ${sizeMb} MB across ${fileCount} files`);
  console.log('══════════════════════════════════════════════════');
}

main();
