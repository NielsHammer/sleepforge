/**
 * script-analyzer.js — Script quality scorer + rewrite loop
 *
 * Uses Sonnet (via claude CLI) to score narration scripts against a
 * 10-category rubric, then iteratively rewrites failing sections.
 *
 * Exports:
 *   analyzeScript(text, channelConfig)              → analysis JSON
 *   rewriteNarration(text, analysis, scenes, ch, n) → newText (with scene breaks)
 *   analyzeAndRewrite(scenes, channelConfig, opts)  → { finalScenes, history }
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callClaudeCLI } from './claude-cli.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SONNET       = 'claude-sonnet-4-6';

export const CATEGORIES = [
  'INFORMATION_DENSITY',
  'SPECIFICITY',
  'REPETITION',
  'PROGRESSION',
  'SUSPENSE',
  'MYSTERY_TONE',
  'SLEEP_PACING',
  'VISUAL_DESCRIPTION',
  'AI_SLOP',
  'INTRO_QUALITY',
];

// ─── Scoring prompt ───────────────────────────────────────────────────────────

function buildScoringPrompt(narrationText, channelConfig) {
  const wpm = channelConfig?.target_word_count && channelConfig?.target_duration_minutes
    ? Math.round(channelConfig.target_word_count / channelConfig.target_duration_minutes)
    : 150;
  const wordCount  = narrationText.trim().split(/\s+/).length;
  const estMinutes = (wordCount / wpm).toFixed(1);

  const channelBlock = channelConfig ? `CHANNEL: ${channelConfig.display_name || channelConfig.slug}
TONE: ${channelConfig.tone || 'calm documentary'}
AUDIENCE: ${channelConfig.audience || 'sleep listeners'}
` : '';

  return `You are a script quality analyst for a sleep documentary YouTube channel.

${channelBlock}Score this ${wordCount}-word narration script (~${estMinutes} min at ${wpm} wpm) against the rubric below. Return JSON only.

RUBRIC — score each category 0–10:

1. INFORMATION_DENSITY
   Target: 2+ genuinely new, specific facts per minute. Penalize generic filler ("space is vast", "scientists have long wondered").
   10=every 30s has a unique verifiable fact. 5=half specific, half filler. 0=pure narration with no information.

2. SPECIFICITY
   Count specific proper nouns: named scientists, specific years, exact measurements (km, solar masses, K, km/s), named missions or objects.
   Target: 6+ per 1000 words. 10=≥6/1000w. 7=4-5/1000w. 4=2-3/1000w. 0=no specifics.

3. REPETITION
   Start at 10. Deduct 2 for each fact/concept/phrase repeated. Deduct 1 for 3+ consecutive sentences with identical structure.

4. PROGRESSION
   10=clear hook→setup→escalation→revelation→resolution, feels like a journey.
   5=loosely related scenes, could be reordered.
   0=every scene equally weighted, no arc.

5. SUSPENSE
   10=every scene ends with open question or dangling idea pulling forward.
   5=some scenes end on hook, others just stop.
   0=every scene ends with a final closed statement.

6. MYSTERY_TONE
   10=wonder without condescension. Speaks to an equal. No "amazingly", "you might be surprised".
   5=mostly good, occasional over-explaining.
   0=childlike ("Wow! Space is SO big!") or dry textbook.

7. SLEEP_PACING
   10=calm, slow, meditative. Short+long sentences mixed. No urgency. No exclamation energy.
   5=mostly calm but occasional rushed clusters.
   0=frantic, short-sentence-only, or constant urgency words.
   Penalize: "incredibly", "remarkably", "suddenly", "astonishingly".

8. VISUAL_DESCRIPTION
   10=rich audiobook prose through scale, texture, color, motion. Eyes-closed listener can see it.
   5=some imagery, some flat statement delivery.
   0=dry facts, no sensory language.
   HARD PENALIZE (−3 each): "see", "look", "watch", "picture this", "on your screen", "as you can see", "notice how", "this shows", "here we have", "imagine" (as visual cue).

9. AI_SLOP
   Start at 10. Deduct per instance:
   −2: "in conclusion", "to summarize", "as we've seen", "as we've explored"
   −1.5: "furthermore", "additionally", "moreover", "it's important to note", "it's worth noting"
   −1: em dash as dramatic pause (—), "in our universe" (as a filler phrase)
   −0.5: 3+ consecutive sentences starting with same word

10. INTRO_QUALITY
    10=sleep audiobook welcome + breathing cue + description of what listener will drift off to.
    5=opens with content immediately, no sleep setup.
    0=starts mid-topic, zero acknowledgment this is sleep content.

SCRIPT:
---
${narrationText}
---

Return ONLY this JSON (no preamble, no markdown fences, no explanation):
{
  "total_score": <average of 10 categories, 1 decimal>,
  "word_count": ${wordCount},
  "estimated_minutes": ${estMinutes},
  "categories": {
    "INFORMATION_DENSITY": { "score": <0-10>, "failures": [{"quote":"<first 8 words>","problem":"<issue>"}], "suggestion":"<one concrete fix>" },
    "SPECIFICITY":        { "score": ..., "failures": [...], "suggestion": "..." },
    "REPETITION":         { "score": ..., "failures": [...], "suggestion": "..." },
    "PROGRESSION":        { "score": ..., "failures": [...], "suggestion": "..." },
    "SUSPENSE":           { "score": ..., "failures": [...], "suggestion": "..." },
    "MYSTERY_TONE":       { "score": ..., "failures": [...], "suggestion": "..." },
    "SLEEP_PACING":       { "score": ..., "failures": [...], "suggestion": "..." },
    "VISUAL_DESCRIPTION": { "score": ..., "failures": [...], "suggestion": "..." },
    "AI_SLOP":            { "score": ..., "failures": [...], "suggestion": "..." },
    "INTRO_QUALITY":      { "score": ..., "failures": [...], "suggestion": "..." }
  }
}`;
}

// ─── Rewrite prompt ───────────────────────────────────────────────────────────

function buildRewritePrompt(narrationText, analysis, scenes, channelConfig, iterationNum) {
  const failing = CATEGORIES
    .map(name => ({ name, cat: analysis.categories[name] }))
    .filter(({ cat }) => cat && cat.score < 8)
    .sort((a, b) => a.cat.score - b.cat.score);

  const critiqueBlock = failing.map(({ name, cat }) => {
    const failures = (cat.failures || [])
      .slice(0, 3)
      .map(f => `   • "${f.quote}" — ${f.problem}`)
      .join('\n');
    return `${name} (${cat.score}/10) — fix: ${cat.suggestion}${failures ? '\n' + failures : ''}`;
  }).join('\n\n');

  // Build scene-by-scene reference so Sonnet knows what each scene must cover
  const sceneRef = scenes
    .map((s, i) => {
      const role = s.arc_role ? ` [${s.arc_role}]` : '';
      const anchor = s.action || s.moment || '';
      return `Scene ${i + 1}${role}: anchor = "${anchor.slice(0, 80)}"`;
    })
    .join('\n');

  const channelRules = channelConfig ? `CHANNEL RULES (${channelConfig.display_name || channelConfig.slug}):
Tone: ${channelConfig.tone || 'calm documentary'}
Banned topics: ${(channelConfig.banned_topics || []).join(', ')}
` : '';

  return `You are rewriting a sleep space documentary script. This is rewrite iteration ${iterationNum}.

${channelRules}
UNIVERSAL RULES — non-negotiable:
- Calm, wonder-filled. No urgency, no exclamation energy.
- Specific facts only — names, dates, measurements, named objects. Never generic.
- BANNED WORDS: "see", "look", "watch", "picture this", "on your screen", "as you can see",
  "furthermore", "additionally", "moreover", "in conclusion", "it's important to note",
  "as we've seen", "it's worth noting", "imagine" (as visual cue), "incredibly", "remarkably"
- Short sentences mixed with long flowing ones. Sleep audiobook pacing.
- Eyes closed listener. Describe through sound, scale, texture, motion — not visual references.
- Contractions always: it's, you'd, we've, that's, wouldn't
- Present tense for scenes. Numbers as words (twenty-three billion kilometers).
- Preserve ALL specific facts, names, dates, measurements from original — improve HOW they're presented.
- Same approximate word count as original (±10%).
- Same topics — do not change what the script is about.

SCENE STRUCTURE (preserve factual anchors):
${sceneRef}

CATEGORIES NEEDING IMPROVEMENT:
${critiqueBlock}

ORIGINAL NARRATION:
---
${narrationText}
---

Return ONLY the rewritten narration text.
Separate scenes with "---SCENE BREAK---" on its own line (exactly ${scenes.length} sections).
No headers, no brackets, no markdown, no stage directions — pure narration prose only.
Blank lines within a scene are fine (paragraph breaks).`;
}

// ─── Core: analyzeScript ──────────────────────────────────────────────────────

export async function analyzeScript(narrationText, channelConfig = null) {
  const prompt = buildScoringPrompt(narrationText, channelConfig);
  const raw = await callClaudeCLI(prompt, { model: SONNET, timeoutMs: 180000 });
  const clean = raw.trim().replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '').trim();
  const analysis = JSON.parse(clean);
  // Recompute total from category scores for reliability
  const scores = CATEGORIES.map(n => analysis.categories[n]?.score ?? 0);
  analysis.total_score = parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
  return analysis;
}

// ─── Core: rewriteNarration ───────────────────────────────────────────────────

export async function rewriteNarration(narrationText, analysis, scenes, channelConfig = null, iterationNum = 1) {
  const prompt = buildRewritePrompt(narrationText, analysis, scenes, channelConfig, iterationNum);
  const raw = await callClaudeCLI(prompt, { model: SONNET, timeoutMs: 300000 });
  return raw.trim();
}

// ─── Core: analyzeAndRewrite loop ────────────────────────────────────────────

export async function analyzeAndRewrite(scenes, channelConfig = null, opts = {}) {
  const {
    maxIterations = 5,
    targetScore   = 8.0,
    topicSlug     = 'script',
    saveIterations = true,
  } = opts;

  const iterDir = path.join(PROJECT_ROOT, 'data', 'script-iterations', topicSlug);
  if (saveIterations) fs.mkdirSync(iterDir, { recursive: true });

  const history = [];
  let currentScenes = scenes.map(s => ({ ...s }));

  for (let i = 0; i <= maxIterations; i++) {
    const narrationText = currentScenes.map(s => s.narration).join('\n\n\n');

    if (saveIterations) {
      const label = i === 0 ? 'iteration-0-original' : `iteration-${i}`;
      fs.writeFileSync(path.join(iterDir, `${label}.txt`), narrationText, 'utf-8');
    }

    process.stdout.write(`  Iteration ${i}: scoring... `);
    let analysis;
    try {
      analysis = await analyzeScript(narrationText, channelConfig);
    } catch (err) {
      console.error(`\n  Score failed: ${err.message}`);
      break;
    }

    history.push({ iteration: i, score: analysis.total_score, categories: CATEGORIES.reduce((acc, n) => {
      acc[n] = analysis.categories[n]?.score ?? 0; return acc;
    }, {}) });

    if (saveIterations) {
      fs.writeFileSync(path.join(iterDir, 'scores.json'), JSON.stringify(history, null, 2), 'utf-8');
    }

    console.log(`${analysis.total_score}/10`);
    printScoreTable(analysis);

    if (analysis.total_score >= targetScore) {
      console.log(`  ✓ Score ${analysis.total_score} ≥ ${targetScore} — target reached`);
      break;
    }
    if (i === maxIterations) {
      console.log(`  Max iterations (${maxIterations}) reached`);
      break;
    }

    console.log(`  Score ${analysis.total_score} < ${targetScore} — rewriting (iteration ${i + 1})...`);
    let newText;
    try {
      newText = await rewriteNarration(narrationText, analysis, currentScenes, channelConfig, i + 1);
    } catch (err) {
      console.error(`  Rewrite failed: ${err.message}`);
      break;
    }

    // Split rewritten text back into scenes using the requested scene-break markers
    const parts = newText.split(/^---SCENE BREAK---$/im).map(p => p.trim()).filter(Boolean);

    if (parts.length === currentScenes.length) {
      currentScenes = currentScenes.map((scene, idx) => ({ ...scene, narration: parts[idx] }));
    } else {
      // Fallback: split proportionally by sentence
      console.log(`  ⚠ Scene count mismatch (${parts.length} parts vs ${currentScenes.length} scenes) — splitting proportionally`);
      const sentences = newText.split(/(?<=[.!?…])\s+(?=[A-Z])/);
      const perScene  = Math.ceil(sentences.length / currentScenes.length);
      currentScenes = currentScenes.map((scene, idx) => ({
        ...scene,
        narration: sentences.slice(idx * perScene, (idx + 1) * perScene).join(' ').trim() || scene.narration,
      }));
    }
  }

  // Save final narration text
  if (saveIterations) {
    const finalText = currentScenes.map(s => s.narration).join('\n\n\n');
    fs.writeFileSync(path.join(iterDir, 'final.txt'), finalText, 'utf-8');
  }

  return { finalScenes: currentScenes, history };
}

// ─── Console score table ──────────────────────────────────────────────────────

export function printScoreTable(analysis) {
  const cats = analysis.categories;
  for (const name of CATEGORIES) {
    const cat = cats[name];
    if (!cat) continue;
    const score  = Math.max(0, Math.min(10, Math.round(cat.score)));
    const bar    = '█'.repeat(score) + '░'.repeat(10 - score);
    const warn   = cat.score < 7 ? ' ⚠' : '';
    console.log(`    ${name.padEnd(22)} ${bar} ${cat.score.toFixed(1).padStart(4)}/10${warn}`);
  }
  const total = Math.max(0, Math.min(10, Math.round(analysis.total_score)));
  console.log(`    ${'─'.repeat(44)}`);
  console.log(`    TOTAL${' '.repeat(17)} ${'█'.repeat(total)}${'░'.repeat(10 - total)} ${analysis.total_score.toFixed(1).padStart(4)}/10`);
}

export function printFailures(analysis) {
  for (const name of CATEGORIES) {
    const cat = analysis.categories[name];
    if (!cat || !cat.failures?.length) continue;
    console.log(`\n  ${name} (${cat.score}/10):`);
    for (const f of cat.failures.slice(0, 3)) {
      console.log(`    "${f.quote}" → ${f.problem}`);
    }
    if (cat.suggestion) console.log(`  Fix: ${cat.suggestion}`);
  }
}
