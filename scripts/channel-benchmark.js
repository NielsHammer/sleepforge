/**
 * channel-benchmark.js
 *
 * Reads data/own-channel-history.json. Computes channel-wide CTR and
 * retention baselines (median, top/bottom 10%), then ranks each SleepForge
 * video vs the baseline.
 *
 * Output: data/channel-benchmark.json
 *
 * Usage:  node scripts/channel-benchmark.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const OWN_HISTORY = path.join(ROOT, 'data', 'own-channel-history.json');
const OUT_FILE    = path.join(ROOT, 'data', 'channel-benchmark.json');

function log(msg) { console.log(msg); }

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(arr) { return percentile(arr, 50); }

function rankLabel(val, p10, p25, p75, p90) {
  if (val >= p90) return 'top 10%';
  if (val >= p75) return 'top 25%';
  if (val >= p25) return 'above median';
  if (val >= p10) return 'below median';
  return 'bottom 10%';
}

function main() {
  log('\n══════════════════════════════════════════════════');
  log('  SleepForge — Channel Benchmark');
  log('══════════════════════════════════════════════════\n');

  if (!fs.existsSync(OWN_HISTORY)) {
    log('own-channel-history.json not found. Run ingest-own-channel.js first.');
    process.exit(0);
  }

  const records = JSON.parse(fs.readFileSync(OWN_HISTORY, 'utf-8'));
  log(`Total channel videos: ${records.length}`);

  // CTR baseline (all videos with data)
  const ctrAll = records.map(r => r.ctr).filter(x => x !== null).sort((a, b) => a - b);
  const retAll = records.map(r => r.avg_view_duration).filter(x => x !== null).sort((a, b) => a - b);

  const ctrBaseline = {
    n:      ctrAll.length,
    median: median(ctrAll),
    p10:    percentile(ctrAll, 10),
    p25:    percentile(ctrAll, 25),
    p75:    percentile(ctrAll, 75),
    p90:    percentile(ctrAll, 90),
  };
  const retBaseline = {
    n:      retAll.length,
    median: median(retAll),
    p10:    percentile(retAll, 10),
    p25:    percentile(retAll, 25),
    p75:    percentile(retAll, 75),
    p90:    percentile(retAll, 90),
  };

  log(`\n── CTR Baseline (n=${ctrBaseline.n}) ──`);
  log(`  Median: ${ctrBaseline.median?.toFixed(2) ?? 'n/a'}%`);
  log(`  p25: ${ctrBaseline.p25?.toFixed(2) ?? 'n/a'}%  p75: ${ctrBaseline.p75?.toFixed(2) ?? 'n/a'}%  p90: ${ctrBaseline.p90?.toFixed(2) ?? 'n/a'}%`);

  log(`\n── Retention Baseline (n=${retBaseline.n}) ──`);
  log(`  Median: ${retBaseline.median?.toFixed(1) ?? 'n/a'}%`);
  log(`  p25: ${retBaseline.p25?.toFixed(1) ?? 'n/a'}%  p75: ${retBaseline.p75?.toFixed(1) ?? 'n/a'}%`);

  // Per-video ranking (sleepforge-made only)
  const sfVideos = records.filter(r => r.was_made_by_sleepforge);
  log(`\n── SleepForge videos: ${sfVideos.length} ──`);

  const sfRanked = sfVideos.map(v => {
    const ctrRank = v.ctr !== null && ctrBaseline.n > 0
      ? rankLabel(v.ctr, ctrBaseline.p10, ctrBaseline.p25, ctrBaseline.p75, ctrBaseline.p90)
      : null;
    const retRank = v.avg_view_duration !== null && retBaseline.n > 0
      ? rankLabel(v.avg_view_duration, retBaseline.p10, retBaseline.p25, retBaseline.p75, retBaseline.p90)
      : null;

    if (v.ctr !== null) {
      log(`  ${v.video_id} "${v.title?.slice(0, 50)}" CTR=${v.ctr?.toFixed(2) ?? 'n/a'}% (${ctrRank}) ret=${v.avg_view_duration?.toFixed(0) ?? 'n/a'}% (${retRank})`);
    }

    return {
      video_id:         v.video_id,
      title:            v.title,
      published_at:     v.published_at,
      ctr:              v.ctr,
      ctr_rank:         ctrRank,
      retention_avg:    v.avg_view_duration,
      retention_rank:   retRank,
      views:            v.views,
      principles_used:  v.principles_used,
    };
  });

  const out = {
    ctr_baseline:       ctrBaseline,
    retention_baseline: retBaseline,
    sleepforge_videos:  sfRanked,
    all_video_count:    records.length,
    last_updated:       new Date().toISOString(),
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  log(`\n✓ Saved: ${OUT_FILE}`);
}

main();
