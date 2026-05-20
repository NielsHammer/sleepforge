/**
 * thumbnail-tester.js — fast iteration tool for Niels to test thumbnail variations
 *
 * Usage:
 *   node scripts/thumbnail-tester.js --topic "Voyager 1 still transmitting after 47 years" --channel sleepless-astronomer
 *   node scripts/thumbnail-tester.js --topic "Stoic calm in chaos" --channel sleepless-philosophers
 *
 * Saves to output/thumb-test/<timestamp>/thumbnail.png
 * Opens PNG in default viewer automatically.
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

import { generateThumbnailV3, closeBrowser } from '../src/thumbnail-v3.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ─── Args ────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { topic: null, channel: 'sleepless-astronomer' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--topic')   opts.topic   = args[++i];
    if (args[i] === '--channel') opts.channel = args[++i];
  }
  return opts;
}

const { topic, channel } = parseArgs();
if (!topic) {
  console.error('Usage: node scripts/thumbnail-tester.js --topic "<topic text>" [--channel <slug>]');
  process.exit(1);
}

// ─── Load channel config ─────────────────────────────────────────────────────

const channelConfigPath = path.join(PROJECT_ROOT, 'data', 'channels', `${channel}.json`);
if (!fs.existsSync(channelConfigPath)) {
  console.error(`Channel config not found: ${channelConfigPath}`);
  process.exit(1);
}
const channelConfig = JSON.parse(fs.readFileSync(channelConfigPath, 'utf-8'));

// ─── Output dir ───────────────────────────────────────────────────────────────

const ts      = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir  = path.join(PROJECT_ROOT, 'output', 'thumb-test', ts);
fs.mkdirSync(outDir, { recursive: true });

// ─── Run ──────────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`Thumbnail Tester`);
console.log(`Channel: ${channel}`);
console.log(`Topic:   ${topic}`);
console.log(`Output:  ${outDir}`);
console.log(`${'═'.repeat(60)}\n`);

try {
  const pngPath = await generateThumbnailV3({
    outputDir:     outDir,
    title:         topic,
    scriptText:    '',
    channelConfig,
    niche:         channelConfig.niche,
    tone:          channelConfig.tone,
  });

  // Read back critic score and plan for summary
  let score = '?'; let subject = '?'; let hook = '?'; let verdict = '';
  try {
    const review = JSON.parse(fs.readFileSync(path.join(outDir, 'thumbnail-v3-review.json'), 'utf-8'));
    score   = review.rating ?? '?';
    verdict = review.designer_verdict ?? '';
    if (review.problems?.length) verdict += ' | Problems: ' + review.problems.slice(0, 3).join(' / ');
  } catch {}
  try {
    const plan = JSON.parse(fs.readFileSync(path.join(outDir, 'thumbnail-v3-plan.json'), 'utf-8'));
    subject = plan.primary_subject ?? '?';
    hook    = plan.hook_text ?? '?';
  } catch {}

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Hook:     ${hook}`);
  console.log(`  Subject:  ${subject}`);
  console.log(`  Score:    ${score}/10`);
  if (verdict) console.log(`  Verdict:  ${verdict}`);
  console.log(`  File:     ${pngPath}`);
  console.log(`${'─'.repeat(60)}\n`);

  // Open in default viewer
  try {
    execSync(`powershell -Command "Start-Process '${pngPath.replace(/\\/g, '\\\\')}'"`);
    console.log('  Opened in default viewer.');
  } catch (e) {
    console.log(`  (could not auto-open: ${e.message})`);
  }

} catch (e) {
  console.error('\nFATAL:', e.message);
  process.exit(1);
} finally {
  await closeBrowser();
}
