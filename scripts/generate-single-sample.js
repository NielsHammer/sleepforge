/**
 * generate-single-sample.js
 *
 * Generates ONE video preview for Niels' review before daily posting:
 *   1. Picks the single best topic from 350-reference learned principles (Sonnet)
 *   2. Generates 5 candidate titles, picks winner with scoring reasoning (Sonnet)
 *   3. Generates 3 thumbnail variants (full thumbnail-v3 pipeline, critic skipped)
 *   4. Generates description + tags (Haiku)
 *
 * Output: data/samples/preview-<timestamp>/
 *   topic.txt, title.txt, all-5-title-candidates.txt,
 *   description.txt, tags.txt, reasoning.md,
 *   thumbnail-1.png, thumbnail-2.png, thumbnail-3.png
 *
 * Usage: node scripts/generate-single-sample.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI } = await import('../src/claude-cli.js');
const { generateThumbnailV3, closeBrowser } = await import('../src/thumbnail-v3.js');

const PRINCIPLES_FILE = path.join(ROOT, 'data', 'reference-principles.json');
const SAMPLES_DIR     = path.join(ROOT, 'data', 'samples');
const HAIKU  = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

function log(msg) { console.log(msg); }

// ─── TOPIC + TITLE SELECTION (Sonnet) ───────────────────────────────────────

async function selectTopicAndTitles(principles) {
  const contextSummary = JSON.stringify({
    sample_count:           principles.sample_count || 0,
    top_emerging_patterns:  principles.top_emerging_patterns || [],
    high_ctr_keywords:      principles.high_ctr_keywords || [],
    title_patterns:         (principles.title_patterns || []).map(p => ({
      pattern_name: p.pattern_name,
      formula:      p.formula,
      examples:     p.examples?.slice(0, 2),
      avg_views_observed: p.avg_views_observed,
    })),
    script_insight:         principles.script_insight || '',
    sleepless_philosophers_insights: principles.sleepless_philosophers_insights || {},
  }, null, 2);

  const prompt = `You are a YouTube content strategist for "Sleepless Philosophers" — a 1-hour calm sleep story channel covering philosophy, ancient history, mythology, and wisdom traditions.

You have analyzed ${principles.sample_count || 0} reference videos. Here are the key findings:
${contextSummary}

Your task: Select the SINGLE BEST video topic to produce next, then generate 5 competing title candidates and pick the winner.

CHANNEL CONSTRAINTS:
- Topic must work as a 1-hour calm narrated sleep story
- No news, politics, violence, or distressing content
- Chalk-style aesthetic thumbnails — philosophical and serene
- Target audience: adults who want intellectual content while falling asleep

TITLE RULES (apply these strictly):
- "to Fall Asleep to" performs best when the core topic sounds surprising/premium (not just "sleep sounds")
- Named philosopher (Jung, Aurelius, Epictetus, Seneca, Watts, Osho) → stronger than generic "philosophy"
- "(NO ADS)" prefix is the fastest-growing differentiator — include in one candidate
- Numbers 30-50 perform better than 100 for 1-hour videos
- Dual hook = functional sleep promise + specific curiosity anchor = highest view counts

Return ONLY this JSON (no markdown, no commentary):
{
  "topic": "concise internal topic description",
  "sub_niche": "sleep_philosophy or sleep_history",
  "title_pattern_used": "pattern name from reference data",
  "topic_reasoning": "2 sentences: why this topic, what in the data suggested it",
  "title_candidates": [
    "Candidate 1",
    "Candidate 2",
    "Candidate 3",
    "Candidate 4",
    "Candidate 5"
  ],
  "winning_title": "The exact winning candidate repeated here",
  "title_scoring": [
    { "candidate": "Candidate 1", "score": 0, "reasoning": "one sentence" },
    { "candidate": "Candidate 2", "score": 0, "reasoning": "one sentence" },
    { "candidate": "Candidate 3", "score": 0, "reasoning": "one sentence" },
    { "candidate": "Candidate 4", "score": 0, "reasoning": "one sentence" },
    { "candidate": "Candidate 5", "score": 0, "reasoning": "one sentence" }
  ],
  "winner_reasoning": "2-3 sentences: specifically why this title beats the others based on the reference data patterns",
  "thumbnail_style_hint": "one sentence: specific visual direction for the 3 thumbnail variants"
}`;

  log('  Calling Sonnet for topic + title selection...');
  const raw = await callClaudeCLI(prompt, { model: SONNET, timeoutMs: 120000 });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Topic/title selection: no JSON in response');
  return JSON.parse(m[0]);
}

// ─── METADATA GENERATION (Haiku) ────────────────────────────────────────────

async function generateDescription(topic, title) {
  const prompt = `Write a YouTube description for a 1-hour sleep story video.

CHANNEL: Sleepless Philosophers
TITLE: ${title}
TOPIC: ${topic.topic}

Format:
1. Hook paragraph (2-3 sentences — what the viewer will experience while drifting off)
2. What's covered (3-4 bullet points with dashes, not numbers)
3. Perfect for (2-3 bullet points)
4. Final line: "New stories every day. Subscribe so you never miss one."
5. 5-6 hashtags on the very last line

Under 380 words. Calm, slightly literary tone. No ALL CAPS.
Return plain text only.`;

  return callClaudeCLI(prompt, { model: HAIKU, timeoutMs: 30000 });
}

async function generateTags(topic, title) {
  const prompt = `Generate 18 YouTube tags for this sleep story video.
TITLE: ${title}
TOPIC: ${topic.topic}
Mix: 4 broad (sleep story, philosophy for sleep), 8 medium-specific, 6 long-tail phrases.
No hashtag symbols. All lowercase. Return a JSON array of strings only — no commentary.`;

  const raw = await callClaudeCLI(prompt, { model: HAIKU, timeoutMs: 20000 });
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Tags: no JSON array in response');
  return JSON.parse(m[0]);
}

// ─── THUMBNAIL GENERATION (thumbnail-v3) ────────────────────────────────────
// Variant 1: full pass (hook writer + metaphor brainstorm + planner + render, no critic)
// Variants 2+3: reuse hook and alternate metaphor candidates

async function generateThumbnails(topic, title, sampleDir) {
  const niche = topic.sub_niche === 'sleep_history' ? 'history' : 'philosophy';
  const tone  = 'calm, meditative, philosophical, sleep-inducing';
  const paths = [];

  // ── Variant 1 ──
  const v1Dir = path.join(sampleDir, '_variant-1');
  fs.mkdirSync(v1Dir, { recursive: true });
  log('\n  [Thumbnail 1/3] Running full pipeline...');
  let v1Path = null;
  try {
    v1Path = await generateThumbnailV3({ outputDir: v1Dir, title, niche, tone, _skipCritic: true });
    const dest = path.join(sampleDir, 'thumbnail-1.png');
    fs.copyFileSync(v1Path, dest);
    paths.push(dest);
    log('  ✓ thumbnail-1.png');
  } catch (e) {
    log(`  ✗ Thumbnail 1 failed: ${e.message}`);
    paths.push(null);
  }

  // Read hook + metaphor pool from variant 1 for reuse
  let lockedHook   = null;
  let metaphorPool = null;
  try {
    const hookPath = path.join(v1Dir, 'thumbnail-v3-hook.json');
    if (fs.existsSync(hookPath)) lockedHook = JSON.parse(fs.readFileSync(hookPath, 'utf-8'));
    const metaPath = path.join(v1Dir, 'thumbnail-v3-metaphor.json');
    if (fs.existsSync(metaPath)) metaphorPool = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {}

  // ── Variant 2 (reuse hook, second metaphor candidate) ──
  const v2Dir = path.join(sampleDir, '_variant-2');
  fs.mkdirSync(v2Dir, { recursive: true });
  log('\n  [Thumbnail 2/3] Reusing hook, alternate metaphor...');
  const lockedMeta2 = metaphorPool?.candidates?.[1]
    ? { ...metaphorPool, winner: metaphorPool.candidates[1], winner_reasoning: 'Variant 2 — second metaphor candidate' }
    : null;
  try {
    const v2Path = await generateThumbnailV3({
      outputDir: v2Dir, title, niche, tone,
      _lockedHook: lockedHook, _lockedMetaphor: lockedMeta2, _skipCritic: true,
    });
    const dest = path.join(sampleDir, 'thumbnail-2.png');
    fs.copyFileSync(v2Path, dest);
    paths.push(dest);
    log('  ✓ thumbnail-2.png');
  } catch (e) {
    log(`  ✗ Thumbnail 2 failed: ${e.message}`);
    paths.push(null);
  }

  // ── Variant 3 (reuse hook, third metaphor candidate) ──
  const v3Dir = path.join(sampleDir, '_variant-3');
  fs.mkdirSync(v3Dir, { recursive: true });
  log('\n  [Thumbnail 3/3] Reusing hook, third metaphor...');
  const lockedMeta3 = metaphorPool?.candidates?.[2]
    ? { ...metaphorPool, winner: metaphorPool.candidates[2], winner_reasoning: 'Variant 3 — third metaphor candidate' }
    : null;
  try {
    const v3Path = await generateThumbnailV3({
      outputDir: v3Dir, title, niche, tone,
      _lockedHook: lockedHook, _lockedMetaphor: lockedMeta3, _skipCritic: true,
    });
    const dest = path.join(sampleDir, 'thumbnail-3.png');
    fs.copyFileSync(v3Path, dest);
    paths.push(dest);
    log('  ✓ thumbnail-3.png');
  } catch (e) {
    log(`  ✗ Thumbnail 3 failed: ${e.message}`);
    paths.push(null);
  }

  return paths;
}

// ─── SAVE OUTPUT ─────────────────────────────────────────────────────────────

function saveOutput(topic, description, tags, thumbPaths, sampleDir) {
  const title = topic.winning_title;

  fs.writeFileSync(path.join(sampleDir, 'topic.txt'), topic.topic);
  fs.writeFileSync(path.join(sampleDir, 'title.txt'), title);
  fs.writeFileSync(path.join(sampleDir, 'description.txt'), description.trim());
  fs.writeFileSync(path.join(sampleDir, 'tags.txt'), tags.join('\n'));

  // All 5 candidates with scores
  const candidatesLines = (topic.title_scoring || topic.title_candidates.map(c => ({ candidate: c, score: '?', reasoning: '' })))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .map((s, i) => `${i + 1}. [score: ${s.score}] ${s.candidate}\n   ${s.reasoning}`);
  fs.writeFileSync(
    path.join(sampleDir, 'all-5-title-candidates.txt'),
    `WINNING TITLE: ${title}\n\n` +
    `ALL CANDIDATES (sorted by score):\n${candidatesLines.join('\n\n')}`
  );

  // Reasoning document
  const thumbStatus = thumbPaths.map((p, i) => p ? `- thumbnail-${i+1}.png ✓` : `- thumbnail-${i+1}.png ✗ FAILED`).join('\n');
  const scoring = (topic.title_scoring || [])
    .map(s => `**${s.candidate}**\n  Score: ${s.score} — ${s.reasoning}`)
    .join('\n\n');

  const reasoning = `# ${title}

## Topic
${topic.topic}

## Sub-niche
${topic.sub_niche}

## Why This Topic?
${topic.topic_reasoning}

## Title Pattern Used
${topic.title_pattern_used}

## Thumbnail Direction
${topic.thumbnail_style_hint}

---

## Title Candidates (Scored by Sonnet)

${scoring}

## Winner: ${title}
${topic.winner_reasoning}

---

## Thumbnails
${thumbStatus}
`;

  fs.writeFileSync(path.join(sampleDir, 'reasoning.md'), reasoning);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n══════════════════════════════════════════════════');
  log('  SleepForge — Single Sample Generator');
  log('══════════════════════════════════════════════════\n');

  const principles = JSON.parse(fs.readFileSync(PRINCIPLES_FILE, 'utf-8'));
  log(`Reference corpus: ${principles.sample_count || 0} videos analyzed`);
  log(`Top patterns: ${(principles.top_emerging_patterns || []).length} | CTR keywords: ${(principles.high_ctr_keywords || []).slice(0, 4).join(', ')}...\n`);

  const timestamp  = Date.now();
  const sampleDir  = path.join(SAMPLES_DIR, `preview-${timestamp}`);
  fs.mkdirSync(sampleDir, { recursive: true });

  // ── Step 1: Topic + title selection ──
  log('── Step 1: Topic + title selection (Sonnet) ──');
  const topic = await selectTopicAndTitles(principles);
  const title = topic.winning_title;

  log(`\n  Topic:  ${topic.topic}`);
  log(`  Niche:  ${topic.sub_niche}`);
  log(`  Winner: "${title}"`);
  log(`  Pattern: ${topic.title_pattern_used}`);
  log('\n  All 5 candidates:');
  (topic.title_candidates || []).forEach((c, i) => {
    const isWinner = c === title;
    log(`    ${i + 1}. ${isWinner ? '★ ' : '  '}"${c}"`);
  });

  // ── Step 2: Description + tags ──
  log('\n── Step 2: Metadata (Haiku) ──');
  let description = '';
  let tags = [];
  try { description = await generateDescription(topic, title); log(`  ✓ description (${description.trim().split('\n').length} lines)`); }
  catch (e) { description = `[Error: ${e.message}]`; log(`  ✗ description failed: ${e.message}`); }
  try { tags = await generateTags(topic, title); log(`  ✓ tags (${tags.length})`); }
  catch (e) { log(`  ✗ tags failed: ${e.message}`); }

  // Save early so metadata is never lost even if thumbnails fail
  saveOutput(topic, description, tags, [], sampleDir);
  log(`  ✓ metadata saved`);

  // ── Step 3: Thumbnails ──
  log('\n── Step 3: Thumbnails (thumbnail-v3) ──');
  log(`  Style hint: ${topic.thumbnail_style_hint}`);
  const thumbPaths = await generateThumbnails(topic, title, sampleDir);

  // Re-save with thumbnail status
  saveOutput(topic, description, tags, thumbPaths, sampleDir);

  await closeBrowser();

  // ── Summary ──
  const successCount = thumbPaths.filter(Boolean).length;
  log('\n══════════════════════════════════════════════════');
  log('  COMPLETE');
  log('══════════════════════════════════════════════════');
  log(`\n  Topic:  ${topic.topic}`);
  log(`  Title:  "${title}"`);
  log(`  Thumbs: ${successCount}/3 generated`);
  log(`\n  Preview folder:`);
  log(`  ${sampleDir}`);
  log('\n  Files:');
  log('  - title.txt');
  log('  - all-5-title-candidates.txt');
  log('  - reasoning.md');
  log('  - description.txt');
  log('  - tags.txt');
  for (let i = 0; i < 3; i++) {
    log(`  - thumbnail-${i+1}.png ${thumbPaths[i] ? '✓' : '✗ FAILED'}`);
  }
}

main().catch(async err => {
  console.error('\nFatal:', err.message);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
