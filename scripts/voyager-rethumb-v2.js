/**
 * voyager-rethumb-v2.js — Recovery script
 *
 * V1 "STILL TALKING" already generated (6/10, passed). V2 "47 YEARS GONE" failed
 * (spacecraft image broke). This script:
 *   1. Loads existing V1 thumbnail (no re-generation)
 *   2. Generates V3 "STILL SIGNALS" fresh
 *   3. Compares via callClaudeCLI (no direct SDK — avoids 401 auth issues)
 *   4. Uploads winner to nQIjOBAWMHY
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateThumbnailV3, closeBrowser } from '../src/thumbnail-v3.js';
import { uploadThumbnail } from '../src/youtube.js';
import { callClaudeCLI } from '../src/claude-cli.js';

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

// V1 already generated (passed critic at 6/10)
const V1_PATH = path.join(OUTPUT_BASE, 'rethumb-v1-2026-05-19T23-24-13', 'thumbnail.png');

const V3_HOOK = {
  winner: 'STILL SIGNALS',
  winner_reasoning: 'Implies an ongoing mystery: signals from the farthest human-made object still reaching us — "still" creates the curiosity gap (how is this possible at 24 billion km?)',
  what_is_interesting: "Voyager's radio signals traveling at light speed take 22+ hours to reach Earth from its current position",
  likely_image: 'Deep space starfield with radiating signal waves or antenna dish pointed at stars',
  candidates: [{ hook: 'STILL SIGNALS', curiosity: 8, surprise: 8, clarity: 9, brevity: 9, total: 34 }],
};

async function generateV3() {
  const outDir = path.join(OUTPUT_BASE, `rethumb-v3-${TS}`);
  fs.mkdirSync(outDir, { recursive: true });

  log('\n' + '═'.repeat(60));
  log('Variant 3/3 — hook: "STILL SIGNALS"');
  log('═'.repeat(60));

  try {
    const pngPath = await generateThumbnailV3({
      outputDir:     outDir,
      title:         VIDEO_TITLE,
      scriptText:    SCRIPT_TEXT,
      channelConfig: CHANNEL_CONFIG,
      _lockedHook:   V3_HOOK,
    });
    log(`  ✓ Variant 3 generated: ${pngPath}`);
    return { variantNum: 3, hook: 'STILL SIGNALS', thumbPath: pngPath || path.join(outDir, 'thumbnail.png') };
  } catch (err) {
    log(`  ✗ Variant 3 failed: ${err.message}`);
    return { variantNum: 3, hook: 'STILL SIGNALS', thumbPath: null, error: err.message };
  }
}

async function pickBest(v1Path, v3) {
  const candidates = [{ variantNum: 1, hook: 'STILL TALKING', thumbPath: v1Path }];
  if (v3.thumbPath && fs.existsSync(v3.thumbPath)) candidates.push(v3);

  if (candidates.length === 1) {
    log('  Only V1 available — using it.');
    return candidates[0];
  }

  log(`\n── Comparing ${candidates.length} variants via callClaudeCLI ──`);

  const prompt = `You are a harsh YouTube thumbnail critic and CTR expert. Compare two thumbnails for the video: "${VIDEO_TITLE}" on an astronomy sleep channel.

VARIANT 1 (hook: "STILL TALKING"):
Use the Read tool to view the image at: ${v1Path}

VARIANT 3 (hook: "STILL SIGNALS"):
Use the Read tool to view the image at: ${v3.thumbPath}

Judge which thumbnail will get higher CTR on YouTube. Consider:
1. Is the hook text on-topic for Voyager 1 (traveling 24 billion km, still transmitting)?
2. Does hook + visual create a curiosity gap?
3. Is it clean and readable at mobile thumbnail size (1280x720)?
4. Which hook phrase is more emotionally striking?

Return ONLY this JSON (no other text):
{
  "winner_variant": 1 or 3,
  "reasoning": "2-3 sentences explaining why this variant wins",
  "v1_score": 1-10,
  "v3_score": 1-10
}`;

  try {
    const result = await callClaudeCLI(prompt, {
      model:          'claude-sonnet-4-6',
      timeoutMs:      120000,
      addDirs:        [OUTPUT_BASE],
      allowedTools:   'Read',
      permissionMode: 'acceptEdits',
    });
    const m = result.match(/\{[\s\S]*\}/);
    if (!m) { log('  Judge returned no JSON — using V1'); return candidates[0]; }
    const parsed = JSON.parse(m[0]);
    log(`  Winner: Variant ${parsed.winner_variant} — ${parsed.reasoning}`);
    log(`  V1: ${parsed.v1_score}/10 | V3: ${parsed.v3_score}/10`);
    return candidates.find(c => c.variantNum === parsed.winner_variant) || candidates[0];
  } catch (err) {
    log(`  Judge failed: ${err.message} — using V1`);
    return candidates[0];
  }
}

async function main() {
  log('\n╔══════════════════════════════════════════╗');
  log('║   Voyager 1 — Re-Thumbnail (Recovery)     ║');
  log('╚══════════════════════════════════════════╝');
  log(`  Video ID:  ${VIDEO_ID}`);
  log(`  V1 path:   ${V1_PATH}`);
  log(`  V1 exists: ${fs.existsSync(V1_PATH)}`);

  const v3 = await generateV3();
  await closeBrowser().catch(() => {});

  const winner = await pickBest(V1_PATH, v3);

  log(`\n── Uploading winner to YouTube (video ${VIDEO_ID}) ──`);
  log(`  Hook: "${winner.hook}"`);
  log(`  File: ${winner.thumbPath}`);

  await uploadThumbnail(VIDEO_ID, winner.thumbPath, CHANNEL);

  fs.writeFileSync(
    path.join(ROOT, 'data', `voyager-rethumb-${TS}.json`),
    JSON.stringify({ videoId: VIDEO_ID, title: VIDEO_TITLE, timestamp: new Date().toISOString(), winner, v3 }, null, 2)
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
