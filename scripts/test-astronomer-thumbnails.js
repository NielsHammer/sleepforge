/**
 * test-astronomer-thumbnails.js
 *
 * Task 5: Generate 3 Astronomer test thumbnail+title sets
 *
 * For each of 3 topics:
 *   1. 5 Haiku title candidates → Sonnet picks winner
 *   2. 3 thumbnail variants (AstroKobi style) → critic picks best
 *
 * Output: output/astronomer-thumbnail-test/<set>/
 * Report: output/astronomer-thumbnail-test/REPORT.md
 *
 * Usage: node scripts/test-astronomer-thumbnails.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { generateAstronomerTitleCandidates } = await import('../src/youtube-metadata-generator.js');
const { generateThumbnailV3, closeBrowser } = await import('../src/thumbnail-v3.js');

const CHANNEL_CONFIG = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8'
));
const TOPIC_POOL = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'data', 'topic-pools', 'sleepless-astronomer.json'), 'utf-8'
));

const OUTPUT_BASE = path.join(ROOT, 'output', 'astronomer-thumbnail-test');

// ─── TOPICS TO TEST (3 concrete, visually distinct subjects) ──────────────────

const TEST_TOPICS = [
  TOPIC_POOL.topics.find(t => t.title.includes('Voyager')),
  TOPIC_POOL.topics.find(t => t.title.includes('Black Hole')),
  TOPIC_POOL.topics.find(t => t.title.includes('Betelgeuse')),
].filter(Boolean);

if (TEST_TOPICS.length < 3) {
  // Fallback: use first 3 from pool
  TEST_TOPICS.push(...TOPIC_POOL.topics.filter(t => !TEST_TOPICS.includes(t)).slice(0, 3 - TEST_TOPICS.length));
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }
function logSection(t) { log(`\n${'═'.repeat(60)}\n  ${t}\n${'═'.repeat(60)}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

const report = {
  generated: new Date().toISOString(),
  sets: [],
};

log(`\nSleepForge — Astronomer Thumbnail Test`);
log(`Testing ${TEST_TOPICS.length} topics × 3 thumbnail variants each`);
log(`Output: ${OUTPUT_BASE}`);

for (let i = 0; i < TEST_TOPICS.length; i++) {
  const topic = TEST_TOPICS[i];
  const setNum = i + 1;
  logSection(`Set ${setNum}/3 — ${topic.title}`);

  const setSlug = `set-${setNum}-${slugify(topic.title)}`;
  const setDir = path.join(OUTPUT_BASE, setSlug);
  fs.mkdirSync(setDir, { recursive: true });

  const setResult = {
    set: setNum,
    topic: topic.title,
    category: topic.category,
    angle: topic.angle,
    slug: setSlug,
  };

  // ── Step 1: Generate 5 title candidates → Sonnet picks winner ──────────────
  log(`\n[${setNum}] Generating title candidates (5 Haiku → Sonnet picks)...`);
  try {
    const titleResult = await generateAstronomerTitleCandidates(topic, CHANNEL_CONFIG);
    setResult.title_candidates = titleResult.candidates;
    setResult.title_winner = titleResult.winner;
    setResult.title_reason = titleResult.reason;

    log(`  Candidates:`);
    for (const [j, c] of titleResult.candidates.entries()) {
      const marker = c === titleResult.winner ? '★' : ' ';
      log(`  ${marker} ${j + 1}. "${c}"`);
    }
    log(`  Winner: "${titleResult.winner}"`);
    log(`  Reason: ${titleResult.reason}`);

    fs.writeFileSync(path.join(setDir, 'title-candidates.json'), JSON.stringify(titleResult, null, 2));
  } catch (e) {
    log(`  ⚠ Title generation failed: ${e.message}`);
    setResult.title_winner = topic.title;
    setResult.title_candidates = [topic.title];
    setResult.title_error = e.message;
  }

  const finalTitle = setResult.title_winner;

  // ── Step 2: Generate 3 thumbnail variants ──────────────────────────────────
  log(`\n[${setNum}] Generating 3 thumbnail variants for "${finalTitle}"...`);

  const scriptText = `${topic.title}\n\n${topic.angle}`;
  const variants = [];

  for (let v = 1; v <= 3; v++) {
    log(`\n  [Variant ${v}/3]`);
    const varDir = path.join(setDir, `thumb-v${v}`);
    fs.mkdirSync(varDir, { recursive: true });

    try {
      const pngPath = await generateThumbnailV3({
        outputDir: varDir,
        title: finalTitle,
        scriptText,
        channelConfig: CHANNEL_CONFIG,
        _maxAttempts: 2,
      });

      const reviewFile = path.join(varDir, 'thumbnail-v3-review.json');
      let rating = 0;
      let verdict = '';
      if (fs.existsSync(reviewFile)) {
        const rev = JSON.parse(fs.readFileSync(reviewFile, 'utf-8'));
        rating = rev.rating || 0;
        verdict = rev.designer_verdict || '';
      }

      const hookFile = path.join(varDir, 'thumbnail-v3-hook.json');
      let hook = '';
      if (fs.existsSync(hookFile)) {
        const hookData = JSON.parse(fs.readFileSync(hookFile, 'utf-8'));
        hook = hookData.winner || '';
      }

      log(`  Variant ${v}: ${rating}/10 — "${hook}" — ${verdict.slice(0, 80)}`);
      variants.push({ variant: v, path: pngPath, dir: varDir, rating, hook, verdict });
    } catch (e) {
      log(`  Variant ${v} FAILED: ${e.message}`);
      variants.push({ variant: v, error: e.message, rating: 0 });
    }

    if (v < 3) await sleep(2000);
  }

  // ── Step 3: Pick best variant ───────────────────────────────────────────────
  const best = variants.filter(v => !v.error).sort((a, b) => b.rating - a.rating)[0];
  if (best) {
    log(`\n  Best variant: ${best.variant} (${best.rating}/10) — hook: "${best.hook}"`);
    // Copy winner to set root
    try {
      fs.copyFileSync(best.path, path.join(setDir, 'thumbnail-winner.png'));
    } catch {}
  }

  setResult.variants = variants;
  setResult.best_variant = best?.variant || null;
  setResult.best_rating = best?.rating || 0;
  setResult.best_hook = best?.hook || '';
  setResult.best_verdict = best?.verdict || '';
  report.sets.push(setResult);

  log(`\n  Set ${setNum} complete ✓`);
}

await closeBrowser();

// ─── WRITE REPORT ─────────────────────────────────────────────────────────────

fs.writeFileSync(path.join(OUTPUT_BASE, 'report.json'), JSON.stringify(report, null, 2));

const md = [`# Sleepless Astronomer — Thumbnail + Title Test Report`,
  `**Generated:** ${report.generated}`,
  `**Style:** AstroKobi (bold white sans-serif, reaction hooks, photoreal space)`,
  ``,
  `---`,
  ``,
];

for (const s of report.sets) {
  md.push(`## Set ${s.set}: ${s.topic}`);
  md.push(`**Category:** ${s.category}`);
  md.push(`**Angle:** ${s.angle}`);
  md.push(``);

  md.push(`### Title Candidates`);
  if (s.title_candidates) {
    for (const [j, c] of s.title_candidates.entries()) {
      const marker = c === s.title_winner ? '**★ WINNER**' : `${j + 1}.`;
      md.push(`${marker} "${c}"`);
    }
    if (s.title_reason) md.push(`\n*Why:* ${s.title_reason}`);
  }
  md.push(``);

  md.push(`### Thumbnail Variants`);
  for (const v of (s.variants || [])) {
    if (v.error) {
      md.push(`- Variant ${v.variant}: ❌ FAILED — ${v.error}`);
    } else {
      const best = v.variant === s.best_variant ? ' ← **BEST**' : '';
      md.push(`- Variant ${v.variant}: **${v.rating}/10**${best} — hook: "${v.hook}"`);
      md.push(`  ${v.verdict}`);
    }
  }
  md.push(``);

  if (s.best_variant) {
    md.push(`### Winner`);
    md.push(`**Variant ${s.best_variant}** — ${s.best_rating}/10`);
    md.push(`Hook: **"${s.best_hook}"**`);
    md.push(`Verdict: ${s.best_verdict}`);
    md.push(`File: \`output/astronomer-thumbnail-test/${s.slug}/thumbnail-winner.png\``);
  }

  md.push(`\n---\n`);
}

fs.writeFileSync(path.join(OUTPUT_BASE, 'REPORT.md'), md.join('\n'));
log(`\n\nReport written to: ${path.join(OUTPUT_BASE, 'REPORT.md')}`);
log(`\n${'═'.repeat(60)}`);
log(`DONE — 3 sets complete`);
log(`${'═'.repeat(60)}\n`);
