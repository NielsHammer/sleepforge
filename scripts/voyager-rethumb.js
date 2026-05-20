/**
 * voyager-rethumb.js
 *
 * Generates 3 new thumbnail variants for the Voyager 1 video (nQIjOBAWMHY).
 * The current thumbnail (black hole + "IT ANSWERED") is off-topic.
 * Each variant uses a Voyager-appropriate hook with locked topic-matching.
 *
 * Hooks to try:
 *   1. STILL TALKING   (47 years, still transmitting)
 *   2. 47 YEARS GONE   (time-shock — specific, visceral)
 *   3. AFTER ALL THIS  (wonder + time compression)
 *
 * Picks best via Sonnet vision comparison, uploads to nQIjOBAWMHY.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { generateThumbnailV3, closeBrowser } from '../src/thumbnail-v3.js';
import { uploadThumbnail } from '../src/youtube.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VIDEO_ID    = 'nQIjOBAWMHY';
const CHANNEL     = 'sleepless-astronomer';
const VIDEO_TITLE = 'How Are We Still Hearing from Voyager 1?';
const SLUG        = 'voyager-1-the-farthest-human-made-object-and-what-it-te';
const OUTPUT_BASE = path.join(ROOT, 'output', SLUG, 'thumbnails');

const CHANNEL_CONFIG = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8')
);

const SCRIPT_PATH = path.join(ROOT, 'scripts', 'voyager-1-the-farthest-human-made-object-and-what-it-tells-u.json');
const scenes = JSON.parse(fs.readFileSync(SCRIPT_PATH, 'utf-8'));
const SCRIPT_TEXT = scenes.map(s => s.narration).filter(Boolean).join('\n\n');

const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const log = msg => console.log(msg);

// Three candidate hooks — each is a full hook result object that matches
// the shape generateHookCandidates returns (for _lockedHook param)
const HOOK_VARIANTS = [
  {
    winner: 'STILL TALKING',
    winner_reasoning: 'Creates a curiosity gap: 47 years in deep space and it\'s still transmitting — implies an ongoing dialogue with the universe that seems impossible at this distance.',
    what_is_interesting: 'Voyager 1 is 14.5 billion miles away and still sending signals back to Earth',
    likely_image: 'Voyager probe silhouetted against deep space with a faint signal line or Earth in background',
    candidates: [{ hook: 'STILL TALKING', curiosity: 9, surprise: 8, clarity: 9, brevity: 9, total: 35 }],
  },
  {
    winner: '47 YEARS GONE',
    winner_reasoning: 'Time-shock hook — the specific number "47" makes the impossibility visceral and concrete. Combined with a Voyager image it immediately raises "wait, it\'s still working after 47 years?"',
    what_is_interesting: 'Launched in 1977, Voyager 1 has been traveling for 47 years and is now beyond our solar system',
    likely_image: 'Voyager probe against a star field with Earth visible as a pale dot in the far distance',
    candidates: [{ hook: '47 YEARS GONE', curiosity: 9, surprise: 9, clarity: 8, brevity: 9, total: 35 }],
  },
  {
    winner: 'STILL SIGNALS',
    winner_reasoning: 'Implies an ongoing mystery: signals from the farthest human-made object still reaching us — the word "still" creates the curiosity gap (how is this possible?)',
    what_is_interesting: 'Voyager\'s radio signals, traveling at the speed of light, take 22+ hours to reach Earth from its current position',
    likely_image: 'Deep space with Voyager probe and radiating signal waves toward a tiny Earth',
    candidates: [{ hook: 'STILL SIGNALS', curiosity: 8, surprise: 8, clarity: 9, brevity: 9, total: 34 }],
  },
];

async function generateVariant(hook, variantNum) {
  const outDir = path.join(OUTPUT_BASE, `rethumb-v${variantNum}-${TS}`);
  fs.mkdirSync(outDir, { recursive: true });

  log(`\n${'═'.repeat(60)}`);
  log(`Variant ${variantNum}/3 — hook: "${hook.winner}"`);
  log('═'.repeat(60));

  try {
    const pngPath = await generateThumbnailV3({
      outputDir:    outDir,
      title:        VIDEO_TITLE,
      scriptText:   SCRIPT_TEXT,
      channelConfig: CHANNEL_CONFIG,
      _lockedHook:  hook,
    });
    log(`  ✓ Variant ${variantNum} generated: ${pngPath}`);
    return { variantNum, hook: hook.winner, outDir, thumbPath: pngPath || path.join(outDir, 'thumbnail.png') };
  } catch (err) {
    log(`  ✗ Variant ${variantNum} failed: ${err.message}`);
    return { variantNum, hook: hook.winner, outDir, thumbPath: null, error: err.message };
  }
}

async function pickBestVariant(variants, client) {
  const available = variants.filter(v => v.thumbPath && fs.existsSync(v.thumbPath));
  if (available.length === 0) throw new Error('No variants generated successfully');
  if (available.length === 1) { log('  Only 1 variant — using it.'); return available[0]; }

  log(`\n── Comparing ${available.length} variants with Sonnet vision ──`);

  const content = [];
  for (const v of available) {
    const base64 = fs.readFileSync(v.thumbPath).toString('base64');
    content.push({ type: 'text', text: `VARIANT ${v.variantNum} (hook: "${v.hook}"):` });
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } });
  }
  content.push({
    type: 'text',
    text: `Video title: "${VIDEO_TITLE}"

These are ${available.length} thumbnail variants for the same Voyager 1 video. Judge which is best for YouTube CTR on an astronomy sleep channel.

Criteria:
1. Is the hook text on-topic for Voyager 1 (not black holes, not unrelated subjects)?
2. Does the primary visual show a space probe / Voyager subject (not just a galaxy or nebula)?
3. Does hook + visual create a curiosity gap?
4. Is the composition clean and readable at mobile thumbnail size?

Return ONLY this JSON:
{
  "winner_variant": 1, 2, or 3,
  "reasoning": "2-3 sentences: why this variant wins",
  "rankings": [{"variant": N, "score": 1-10, "notes": "one sentence"}]
}`,
  });

  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content }],
  });

  const text = msg.content[0]?.text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) { log('  Judge returned no JSON — picking variant 1'); return available[0]; }
  try {
    const result = JSON.parse(m[0]);
    log(`  Sonnet winner: Variant ${result.winner_variant} — ${result.reasoning}`);
    for (const r of result.rankings || []) log(`    V${r.variant}: ${r.score}/10 — ${r.notes}`);
    return available.find(v => v.variantNum === result.winner_variant) || available[0];
  } catch {
    return available[0];
  }
}

async function main() {
  log('\n╔══════════════════════════════════════════╗');
  log('║   Voyager 1 — Re-Thumbnail                ║');
  log('╚══════════════════════════════════════════╝');
  log(`  Video ID:  ${VIDEO_ID}`);
  log(`  Title:     ${VIDEO_TITLE}`);
  log(`  Hooks:     ${HOOK_VARIANTS.map(h => '"' + h.winner + '"').join(', ')}`);

  const variants = [];
  for (let i = 0; i < HOOK_VARIANTS.length; i++) {
    const v = await generateVariant(HOOK_VARIANTS[i], i + 1);
    variants.push(v);
  }

  await closeBrowser().catch(() => {});

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const winner = await pickBestVariant(variants, client);

  log(`\n── Uploading winner to YouTube (video ${VIDEO_ID}) ──`);
  log(`  Hook: "${winner.hook}"`);
  log(`  File: ${winner.thumbPath}`);

  await uploadThumbnail(VIDEO_ID, winner.thumbPath, CHANNEL);

  // Save result log
  const resultLog = {
    videoId: VIDEO_ID,
    title: VIDEO_TITLE,
    timestamp: new Date().toISOString(),
    winner,
    variants,
  };
  fs.writeFileSync(
    path.join(ROOT, 'data', `voyager-rethumb-${TS}.json`),
    JSON.stringify(resultLog, null, 2)
  );

  log('\n╔══════════════════════════════════════════╗');
  log('║   ✅ Done                                  ║');
  log('╚══════════════════════════════════════════╝');
  log(`  Winner hook: "${winner.hook}"`);
  log(`  Uploaded to: https://studio.youtube.com/video/${VIDEO_ID}/edit`);
}

main().catch(async err => {
  await closeBrowser().catch(() => {});
  console.error('\nFatal:', err.message);
  process.exit(1);
});
