/**
 * generate-samples.js
 *
 * Selects 5 topics from reference-principles.json, generates metadata,
 * then produces 3 thumbnail variants per topic using the full thumbnail-v3
 * pipeline (hook → metaphor → HTML/CSS planner → Puppeteer → Flux Schnell).
 *
 * Optimisations vs full production pipeline:
 *   - Hook writer runs once per topic; variants 2 and 3 reuse it (_lockedHook)
 *   - Metaphor brainstorm runs once; each variant gets a different candidate
 *   - Critic skipped (_skipCritic=true) — no retry loops for sample generation
 *
 * Usage:  node scripts/generate-samples.js
 * Output: data/samples/<slug>/
 *   topic.txt, title.txt, description.txt, tags.txt, reasoning.md,
 *   thumbnail-1.png, thumbnail-2.png, thumbnail-3.png
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
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 60).replace(/^-|-$/g, '');
}

// ─── TOPIC SELECTION ─────────────────────────────────────────────────────────

async function selectTopics(principles) {
  const summary = JSON.stringify({
    top_emerging_patterns: principles.top_emerging_patterns || [],
    high_ctr_keywords:     principles.high_ctr_keywords     || [],
    script_insight:        principles.script_insight         || '',
    sample_count:          principles.sample_count           || 0,
  }, null, 2);

  const prompt = `You are a YouTube content strategist for "Sleepless Philosophers" — a 1-hour calm sleep story channel covering philosophy, ancient history, mythology, and wisdom traditions.

You analyzed ${principles.sample_count || 0} reference videos. Key findings:
${summary}

Pick exactly 5 video topics optimised for this channel based on the data.

CONSTRAINTS:
- ALL 5 must be different sub-topics (no two from the same tradition or era)
- Each must use a different high-CTR pattern from the reference data
- Must be realistic 1-hour calm sleep story — no news, politics, or violence
- Cover range: at least 2 different civilizations, at least 1 surprising/obscure pick

Return ONLY this JSON:
{
  "topics": [
    {
      "topic": "concise topic description",
      "sub_niche": "sleep_philosophy | sleep_history",
      "title_pattern_used": "pattern name from data",
      "title_candidates": ["Candidate 1", "Candidate 2", "Candidate 3", "Candidate 4", "Candidate 5"],
      "winning_title": "The Winner",
      "title_reasoning": "one sentence why this wins",
      "topic_reasoning": "2 sentences: what in the reference data suggested this",
      "thumbnail_style_hint": "one sentence visual style note"
    }
  ]
}`;

  const raw = await callClaudeCLI(prompt, { model: SONNET, timeoutMs: 300000 });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Topic selection: no JSON');
  const result = JSON.parse(m[0]);
  if (!Array.isArray(result.topics) || result.topics.length !== 5) throw new Error(`Expected 5 topics, got ${result.topics?.length}`);
  return result.topics;
}

// ─── METADATA GENERATION ─────────────────────────────────────────────────────

async function generateDescription(topic, title) {
  const prompt = `Write a YouTube description for a 1-hour sleep story video.

CHANNEL: Sleepless Philosophers
TITLE: ${title}
TOPIC: ${topic.topic}

Format:
1. Hook paragraph (2-3 sentences — what the viewer will experience)
2. What's in this video (3-4 bullet points)
3. Perfect for (2-3 bullet points)
4. End with: "New videos every day. Subscribe so you never miss a story."
5. 5-6 hashtags on the last line

Under 400 words. Calm, slightly literary tone. No ALL CAPS.
Return plain text only.`;
  return callClaudeCLI(prompt, { model: HAIKU, timeoutMs: 30000 });
}

async function generateTags(topic, title) {
  const prompt = `Generate 18 YouTube tags for this sleep story video.
TITLE: ${title}
TOPIC: ${topic.topic}
Mix: 4 broad (sleep, philosophy), 8 medium-specific, 6 long-tail phrases.
No hashtag symbols. All lowercase. Return JSON array only.`;
  const raw = await callClaudeCLI(prompt, { model: HAIKU, timeoutMs: 20000 });
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('Tags: no array');
  return JSON.parse(m[0]);
}

// ─── THUMBNAIL GENERATION ─────────────────────────────────────────────────────
// Variant 1 runs the full pipeline (hook + metaphor + planner + render, no critic).
// Variants 2 and 3 reuse variant 1's hook but use different metaphor candidates.

async function generateThumbnailsForTopic(topic, title, sampleDir) {
  const niche = topic.sub_niche === 'sleep_history' ? 'history' : 'philosophy';
  const tone  = 'calm, meditative, philosophical, sleep-inducing';
  const paths = [];

  // ── Variant 1 (full pass, hook writer runs here) ──
  const v1Dir = path.join(sampleDir, 'thumbnail-variant-1');
  fs.mkdirSync(v1Dir, { recursive: true });
  log(`\n  [Thumbnail 1/3] ${title}`);
  let v1Path = null;
  try {
    v1Path = await generateThumbnailV3({ outputDir: v1Dir, title, niche, tone, _skipCritic: true });
    const dest = path.join(sampleDir, 'thumbnail-1.png');
    fs.copyFileSync(v1Path, dest);
    paths.push(dest);
    log(`  ✓ thumbnail-1.png`);
  } catch (e) {
    log(`  ✗ Thumbnail 1 failed: ${e.message}`);
    paths.push(null);
  }

  // Read hook + metaphor from variant 1 for reuse
  let lockedHook     = null;
  let metaphorPool   = null;
  try {
    const hookPath = path.join(v1Dir, 'thumbnail-v3-hook.json');
    if (fs.existsSync(hookPath)) lockedHook = JSON.parse(fs.readFileSync(hookPath, 'utf-8'));
    const metaPath = path.join(v1Dir, 'thumbnail-v3-metaphor.json');
    if (fs.existsSync(metaPath)) metaphorPool = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {}

  // ── Variant 2 (reuse hook, use metaphor candidate 1) ──
  const v2Dir = path.join(sampleDir, 'thumbnail-variant-2');
  fs.mkdirSync(v2Dir, { recursive: true });
  log(`\n  [Thumbnail 2/3] ${title}`);
  const lockedMetaphor2 = metaphorPool?.candidates?.[1]
    ? { ...metaphorPool, winner: metaphorPool.candidates[1], winner_reasoning: 'Variant 2 — second metaphor candidate' }
    : null;
  try {
    const v2Path = await generateThumbnailV3({ outputDir: v2Dir, title, niche, tone, _lockedHook: lockedHook, _lockedMetaphor: lockedMetaphor2, _skipCritic: true });
    const dest = path.join(sampleDir, 'thumbnail-2.png');
    fs.copyFileSync(v2Path, dest);
    paths.push(dest);
    log(`  ✓ thumbnail-2.png`);
  } catch (e) {
    log(`  ✗ Thumbnail 2 failed: ${e.message}`);
    paths.push(null);
  }

  // ── Variant 3 (reuse hook, use metaphor candidate 2) ──
  const v3Dir = path.join(sampleDir, 'thumbnail-variant-3');
  fs.mkdirSync(v3Dir, { recursive: true });
  log(`\n  [Thumbnail 3/3] ${title}`);
  const lockedMetaphor3 = metaphorPool?.candidates?.[2]
    ? { ...metaphorPool, winner: metaphorPool.candidates[2], winner_reasoning: 'Variant 3 — third metaphor candidate' }
    : null;
  try {
    const v3Path = await generateThumbnailV3({ outputDir: v3Dir, title, niche, tone, _lockedHook: lockedHook, _lockedMetaphor: lockedMetaphor3, _skipCritic: true });
    const dest = path.join(sampleDir, 'thumbnail-3.png');
    fs.copyFileSync(v3Path, dest);
    paths.push(dest);
    log(`  ✓ thumbnail-3.png`);
  } catch (e) {
    log(`  ✗ Thumbnail 3 failed: ${e.message}`);
    paths.push(null);
  }

  return paths;
}

// ─── SAVE METADATA ────────────────────────────────────────────────────────────

function saveMetadata(topic, title, description, tags, thumbnailPaths, sampleDir) {
  fs.writeFileSync(path.join(sampleDir, 'topic.txt'),       topic.topic);
  fs.writeFileSync(path.join(sampleDir, 'title.txt'),       title);
  fs.writeFileSync(path.join(sampleDir, 'description.txt'), description.trim());
  fs.writeFileSync(path.join(sampleDir, 'tags.txt'),        tags.join('\n'));

  const reasoning = `# ${title}

## Topic
${topic.topic}

## Sub-niche
${topic.sub_niche}

## Title Selection — Pattern: ${topic.title_pattern_used}

### 5 Candidates
${topic.title_candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}

**Winner:** ${topic.winning_title}
**Why:** ${topic.title_reasoning}

## Why This Topic?
${topic.topic_reasoning}

## Thumbnail Style
${topic.thumbnail_style_hint}

## Thumbnails
${thumbnailPaths.map((p, i) => p ? `- thumbnail-${i + 1}.png ✓` : `- thumbnail-${i + 1}.png ✗ FAILED`).join('\n')}
`;
  fs.writeFileSync(path.join(sampleDir, 'reasoning.md'), reasoning);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n══════════════════════════════════════════════════');
  log('  SleepForge — Sample Generator (thumbnail-v3)');
  log('══════════════════════════════════════════════════\n');

  const principles = JSON.parse(fs.readFileSync(PRINCIPLES_FILE, 'utf-8'));
  log(`Principles: ${principles.sample_count || 0} sources | ${(principles.top_emerging_patterns||[]).length} patterns`);
  log(`CTR keywords: ${(principles.high_ctr_keywords || []).join(', ')}\n`);

  fs.mkdirSync(SAMPLES_DIR, { recursive: true });

  log('── Step A: Topic selection (Sonnet) ──');
  const topics = await selectTopics(principles);
  log('\nTopics:');
  topics.forEach((t, i) => log(`  ${i + 1}. "${t.winning_title}"`));

  const results = [];

  for (let i = 0; i < topics.length; i++) {
    const topic = topics[i];
    const title = topic.winning_title;
    const slug  = slugify(title);
    const sampleDir = path.join(SAMPLES_DIR, slug);
    fs.mkdirSync(sampleDir, { recursive: true });

    log(`\n══════════════════════════════════════════════════`);
    log(`  Sample ${i + 1}/5: ${title}`);
    log(`══════════════════════════════════════════════════`);

    // Metadata (save early so it's never lost)
    let description = '';
    let tags = [];
    try { description = await generateDescription(topic, title); } catch (e) { description = `[Error: ${e.message}]`; }
    try { tags = await generateTags(topic, title); } catch (e) { log(`  Tags failed: ${e.message}`); }
    log(`  ✓ metadata (${tags.length} tags)`);

    // Thumbnails
    const thumbPaths = await generateThumbnailsForTopic(topic, title, sampleDir);

    // Save all
    saveMetadata(topic, title, description, tags, thumbPaths, sampleDir);
    log(`  ✓ saved → ${sampleDir}`);
    results.push({ title, dir: sampleDir, thumbs: thumbPaths.filter(Boolean).length });
  }

  await closeBrowser();

  log('\n══════════════════════════════════════════════════');
  log('  COMPLETE');
  log('══════════════════════════════════════════════════\n');
  for (const r of results) {
    log(`📁 ${r.dir}`);
    log(`   "${r.title}"  — ${r.thumbs}/3 thumbnails`);
  }
  log(`\nOpen: ${SAMPLES_DIR}`);
}

main().catch(async err => {
  console.error('\nFatal:', err.message);
  await closeBrowser().catch(() => {});
  process.exit(1);
});
