/**
 * analyze-script.js — Script quality scorer + rewrite loop (CLI)
 *
 * Usage:
 *   node scripts/analyze-script.js --file <path.txt|json>
 *   node scripts/analyze-script.js --file <path> --channel sleepless-astronomer
 *   node scripts/analyze-script.js --file <path> --rewrite [--topic my-topic]
 *
 * Output:
 *   Score table printed to console
 *   JSON analysis report saved next to input file (<name>-analysis.json)
 *   If --rewrite: iterations saved to data/script-iterations/<slug>/
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  analyzeScript,
  analyzeAndRewrite,
  printScoreTable,
  printFailures,
} from '../src/script-analyzer.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2);
const get      = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const has      = (flag) => args.includes(flag);

const filePath    = get('--file');
const channelSlug = get('--channel') || 'sleepless-astronomer';
const doRewrite   = has('--rewrite');
let   topicSlug   = get('--topic');

if (!filePath) {
  console.error('Usage: node analyze-script.js --file <path.txt|json> [--channel <slug>] [--rewrite] [--topic <slug>]');
  process.exit(1);
}

const fullPath = path.resolve(filePath);
if (!fs.existsSync(fullPath)) {
  console.error(`File not found: ${fullPath}`);
  process.exit(1);
}

// ─── Load script ──────────────────────────────────────────────────────────────
const rawContent = fs.readFileSync(fullPath, 'utf-8');
let scenes = null;
let narrationText = '';

if (fullPath.endsWith('.json')) {
  scenes = JSON.parse(rawContent);
  narrationText = scenes.map(s => s.narration).join('\n\n\n');
  if (!topicSlug) topicSlug = path.basename(fullPath, '.json');
} else {
  narrationText = rawContent;
  if (!topicSlug) topicSlug = path.basename(fullPath, '.txt');
  // Wrap in minimal scene for rewrite compatibility
  scenes = [{
    subject: 'script', moment: topicSlug, action: '', setting: '',
    philosopher: 'script', arc_role: 'setup', narration: narrationText,
  }];
}

// ─── Load channel config ──────────────────────────────────────────────────────
let channelConfig = null;
const channelPath = path.join(PROJECT_ROOT, 'data', 'channels', `${channelSlug}.json`);
if (fs.existsSync(channelPath)) {
  channelConfig = JSON.parse(fs.readFileSync(channelPath, 'utf-8'));
  console.log(`Channel: ${channelConfig.display_name || channelSlug}`);
} else if (channelSlug !== 'sleepless-astronomer') {
  console.log(`Channel config not found for "${channelSlug}" — scoring without channel context`);
}

console.log(`File:  ${fullPath}`);
console.log(`Words: ${narrationText.trim().split(/\s+/).length}`);
console.log(`Rewrite: ${doRewrite ? 'yes (up to 5 iterations, target ≥ 8.0)' : 'no (score only)'}`);

// ─── Score-only mode ──────────────────────────────────────────────────────────
if (!doRewrite) {
  console.log('\nScoring...');
  const analysis = await analyzeScript(narrationText, channelConfig);
  console.log('\nScore breakdown:');
  printScoreTable(analysis);
  printFailures(analysis);

  const reportPath = fullPath.replace(/\.(txt|json)$/, '') + '-analysis.json';
  fs.writeFileSync(reportPath, JSON.stringify(analysis, null, 2));
  console.log(`\nReport: ${reportPath}`);
  process.exit(0);
}

// ─── Rewrite loop mode ────────────────────────────────────────────────────────
console.log('\nStarting analyze + rewrite loop...');
const { finalScenes, history } = await analyzeAndRewrite(scenes, channelConfig, {
  topicSlug,
  maxIterations: 5,
  targetScore:   8.0,
  saveIterations: true,
});

const best = history.reduce((a, b) => (a.score >= b.score ? a : b));
console.log(`\nBest score: ${best.score}/10 (iteration ${best.iteration})`);
console.log(`Score history: ${history.map(h => h.score).join(' → ')}`);

const iterDir = path.join(PROJECT_ROOT, 'data', 'script-iterations', topicSlug);
console.log(`Iterations saved: ${iterDir}`);

// Save winning script JSON (for pipeline consumption)
if (fullPath.endsWith('.json')) {
  const finalJsonPath = fullPath.replace('.json', '-analyzed.json');
  fs.writeFileSync(finalJsonPath, JSON.stringify(finalScenes, null, 2));
  console.log(`Final script JSON: ${finalJsonPath}`);
}
