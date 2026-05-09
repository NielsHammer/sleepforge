/**
 * score-principles.js
 *
 * Reads data/video-history.json (SleepForge-made videos only).
 * For each principle used across videos, computes avg CTR lift and
 * retention lift vs videos that did NOT use that principle.
 *
 * Output: data/principle-scores.json
 *
 * Usage:  node scripts/score-principles.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const HISTORY_FILE = path.join(ROOT, 'data', 'video-history.json');
const OUT_FILE     = path.join(ROOT, 'data', 'principle-scores.json');

function log(msg) { console.log(msg); }

function confidence(n) {
  if (n >= 15) return 'high';
  if (n >= 5)  return 'medium';
  return 'low';
}

function mean(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function main() {
  log('\n══════════════════════════════════════════════════');
  log('  SleepForge — Principle Scorer');
  log('══════════════════════════════════════════════════\n');

  if (!fs.existsSync(HISTORY_FILE)) {
    log('No video-history.json found. Run the pipeline first.');
    process.exit(0);
  }

  const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));

  // Only score videos that have analytics AND were made by sleepforge
  const scored = history.filter(v => v.ctr !== null || v.retention_avg !== null);
  log(`Videos with analytics: ${scored.length} / ${history.length}`);

  if (scored.length === 0) {
    log('No analytics data yet. Run refresh-analytics.js first.');
    const empty = { principles: [], last_updated: new Date().toISOString(), total_videos_analyzed: 0 };
    fs.writeFileSync(OUT_FILE, JSON.stringify(empty, null, 2));
    return;
  }

  // Gather all principle IDs
  const allPrinciples = new Set();
  for (const v of scored) {
    for (const p of (v.principles_used || [])) allPrinciples.add(p);
  }
  log(`Unique principles found: ${allPrinciples.size}`);

  const results = [];

  for (const pid of allPrinciples) {
    const withP    = scored.filter(v => (v.principles_used || []).includes(pid));
    const withoutP = scored.filter(v => !(v.principles_used || []).includes(pid));

    const ctrWith    = withP.map(v => v.ctr).filter(x => x !== null);
    const ctrWithout = withoutP.map(v => v.ctr).filter(x => x !== null);
    const retWith    = withP.map(v => v.retention_avg).filter(x => x !== null);
    const retWithout = withoutP.map(v => v.retention_avg).filter(x => x !== null);

    const avgCtrWith    = mean(ctrWith);
    const avgCtrWithout = mean(ctrWithout);
    const avgRetWith    = mean(retWith);
    const avgRetWithout = mean(retWithout);

    const ctrLift = (avgCtrWith !== null && avgCtrWithout !== null && avgCtrWithout !== 0)
      ? ((avgCtrWith - avgCtrWithout) / avgCtrWithout * 100)
      : null;
    const retLift = (avgRetWith !== null && avgRetWithout !== null && avgRetWithout !== 0)
      ? ((avgRetWith - avgRetWithout) / avgRetWithout * 100)
      : null;

    results.push({
      id:                 pid,
      name:               pid.replace(/_/g, ' '),
      n:                  withP.length,
      ctr_avg_with:       avgCtrWith   !== null ? +avgCtrWith.toFixed(3)   : null,
      ctr_avg_without:    avgCtrWithout !== null ? +avgCtrWithout.toFixed(3) : null,
      ctr_lift_pct:       ctrLift !== null ? +ctrLift.toFixed(1) : null,
      retention_avg_with:    avgRetWith    !== null ? +avgRetWith.toFixed(1)    : null,
      retention_avg_without: avgRetWithout !== null ? +avgRetWithout.toFixed(1) : null,
      retention_lift_pct: retLift !== null ? +retLift.toFixed(1) : null,
      confidence:         confidence(withP.length),
    });
  }

  // Sort by CTR lift descending (nulls last)
  results.sort((a, b) => {
    if (a.ctr_lift_pct === null && b.ctr_lift_pct === null) return 0;
    if (a.ctr_lift_pct === null) return 1;
    if (b.ctr_lift_pct === null) return -1;
    return b.ctr_lift_pct - a.ctr_lift_pct;
  });

  const out = {
    principles:           results,
    last_updated:         new Date().toISOString(),
    total_videos_analyzed: scored.length,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  log('\n── Top principles by CTR lift ──');
  results.slice(0, 5).forEach(p => {
    log(`  ${p.id}: CTR lift=${p.ctr_lift_pct ?? 'n/a'}% ret=${p.retention_lift_pct ?? 'n/a'}% n=${p.n} [${p.confidence}]`);
  });
  log(`\n✓ Saved: ${OUT_FILE}`);
}

main();
