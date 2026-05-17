/**
 * learn-space-script-patterns.js
 *
 * Stage 1B: Analyze harvested space_sleep_longform transcripts and extract
 * script-quality patterns (not CTR/thumbnail patterns — those are separate).
 *
 * Extracts:
 *   - avg_wpm: words per minute (calculated from word count / duration)
 *   - info_density: new facts per minute (AI-estimated)
 *   - arc_structure: how the video is organized (AI-analyzed)
 *   - transition_style: how sections connect (AI-analyzed)
 *   - repetition_avoidance: techniques used (AI-analyzed)
 *   - pacing_notes: specific pacing observations
 *
 * Writes results to data/reference-principles.json under key:
 *   "space_sleep_longform_patterns"
 *
 * Usage: node scripts/learn-space-script-patterns.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI } = await import('../src/claude-cli.js');

const LONGFORM_DIR     = 'C:\\Users\\niels\\Desktop\\References\\by-niche\\space_sleep_longform';
const PRINCIPLES_FILE  = path.join(ROOT, 'data', 'reference-principles.json');
const MODEL_ANALYSIS   = 'claude-haiku-4-5-20251001'; // per-video analysis
const MODEL_SYNTHESIS  = 'claude-sonnet-4-6';          // one final synthesis call

function log(msg) { console.log(msg); }

// ─── LOAD PRINCIPLES ─────────────────────────────────────────────────────────

function loadPrinciples() {
  try { return JSON.parse(fs.readFileSync(PRINCIPLES_FILE, 'utf-8')); }
  catch { return {}; }
}

// ─── ANALYZE ONE TRANSCRIPT ──────────────────────────────────────────────────

async function analyzeTranscript(videoDir) {
  const metaPath       = path.join(videoDir, 'metadata.json');
  const transcriptPath = path.join(videoDir, 'transcript.txt');

  if (!fs.existsSync(metaPath) || !fs.existsSync(transcriptPath)) return null;

  const meta       = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  const transcript = fs.readFileSync(transcriptPath, 'utf-8').trim();

  if (transcript.length < 200) {
    log(`  ✗ ${meta.id} — transcript too short or empty`);
    return null;
  }

  const wordCount  = transcript.split(/\s+/).length;
  const durationMin = (meta.duration || 0) / 60;
  const avg_wpm    = durationMin > 0 ? Math.round(wordCount / durationMin) : null;

  // Sample first 600 words and last 300 words for arc analysis
  const words      = transcript.split(/\s+/);
  const opening    = words.slice(0, 600).join(' ');
  const closing    = words.slice(-300).join(' ');
  const midpoint   = words.slice(Math.floor(words.length / 2) - 150, Math.floor(words.length / 2) + 150).join(' ');

  const prompt = `You are analyzing a long-form sleep space documentary YouTube video transcript.

VIDEO:
Title: "${meta.title}"
Channel: "${meta.channel}"
Duration: ${Math.round(durationMin)} minutes
Words: ${wordCount} (~${avg_wpm} wpm)

OPENING (first 600 words):
${opening}

MIDPOINT (300 words from middle):
${midpoint}

CLOSING (last 300 words):
${closing}

Analyze these script quality dimensions and return JSON:

{
  "info_density_per_min": <number: estimated new facts introduced per minute, e.g. 2.5>,
  "arc_structure": "<one sentence: how the video is organized — e.g. 'chronological tour of the solar system, each segment introduces one object then zooms out to cosmic scale'>",
  "transition_style": "<one sentence: how sections connect — e.g. 'each section ends with a scale comparison then pivots to next object with a linking question'>",
  "repetition_avoidance": "<one sentence: how they avoid repeating themselves — e.g. 'each section introduces one new concept that builds on but does not restate prior sections'>",
  "opening_hook_type": "<type: scale_fact | mystery_question | historical_moment | sensory_immersion | direct_address>",
  "pacing_pattern": "<one sentence: how pace varies — e.g. 'starts with 3 short punchy facts, then slows to 2-3 minute deep dives, ends with reflective summary'>",
  "what_works": "<one sentence: the single best thing this script does that ours should copy>",
  "what_to_avoid": "<one sentence: one structural mistake or weakness>"
}`;

  try {
    const raw = await callClaudeCLI(prompt, { model: MODEL_ANALYSIS, timeoutMs: 60000 });
    const m   = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const analysis = JSON.parse(m[0]);
    return { video_id: meta.id, title: meta.title, duration_min: Math.round(durationMin), word_count: wordCount, avg_wpm, ...analysis };
  } catch (e) {
    log(`  ✗ Analysis failed for ${meta.id}: ${e.message}`);
    return null;
  }
}

// ─── SYNTHESIZE ALL ANALYSES ──────────────────────────────────────────────────

async function synthesizePatterns(analyses) {
  const summaries = analyses.map((a, i) =>
    `[${i+1}] "${a.title.slice(0, 50)}" ${a.duration_min}min ${a.avg_wpm}wpm density=${a.info_density_per_min} | arc: ${a.arc_structure?.slice(0, 80)} | works: ${a.what_works?.slice(0, 80)}`
  ).join('\n');

  const prompt = `You are designing the optimal script structure for a long-form sleep space documentary channel.

You've analyzed ${analyses.length} high-performing reference videos:
${summaries}

Based on these patterns, synthesize the definitive guide for our script generator.

Return JSON:
{
  "target_wpm": <number: optimal words per minute for sleep narration>,
  "target_info_density_per_min": <number: new facts per minute that keeps without overwhelming>,
  "recommended_arc": [
    "Scene 1 role and content type",
    "Scenes 2-5 role and content type",
    "Scenes 6-12 role and content type",
    "Scenes 13-17 role and content type",
    "Scenes 18-20 role and content type"
  ],
  "transition_formula": "<exact formula for how to connect scenes — copy the best pattern observed>",
  "anti_repetition_rules": [
    "Rule 1: ...",
    "Rule 2: ...",
    "Rule 3: ..."
  ],
  "opening_hook_formula": "<exact formula for the first 60-90 words of any space sleep video>",
  "fact_introduction_pattern": "<how to introduce a new fact so it feels fresh, not like a list>",
  "closing_formula": "<how the best videos close — what emotional beat and last image they leave>",
  "keywords_that_signal_repetition": ["word or phrase that signals you're retreading covered ground", ...],
  "scene_length_words": <number: optimal words per scene for sleep pacing>
}`;

  const raw = await callClaudeCLI(prompt, { model: MODEL_SYNTHESIS, timeoutMs: 120000 });
  const m   = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in synthesis');
  return JSON.parse(m[0]);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

log('\n══════════════════════════════════════════════════════');
log('  SleepForge — Space Script Pattern Learner');
log(`  Input: ${LONGFORM_DIR}`);
log('══════════════════════════════════════════════════════\n');

if (!fs.existsSync(LONGFORM_DIR)) {
  log(`ERROR: Longform directory not found: ${LONGFORM_DIR}`);
  log('Run harvest-space-sleep-longform.js first.');
  process.exit(1);
}

// Discover video directories
const videoDirs = fs.readdirSync(LONGFORM_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && !e.name.startsWith('_'))
  .map(e => path.join(LONGFORM_DIR, e.name));

log(`Found ${videoDirs.length} video directories`);

if (videoDirs.length === 0) {
  log('No videos to analyze. Run harvest-space-sleep-longform.js first.');
  process.exit(0);
}

// Analyze each transcript
log('\nAnalyzing transcripts...');
const analyses = [];
for (let i = 0; i < videoDirs.length; i++) {
  const dir = videoDirs[i];
  const id  = path.basename(dir);
  log(`  [${i+1}/${videoDirs.length}] ${id}`);
  const result = await analyzeTranscript(dir);
  if (result) {
    analyses.push(result);
    log(`    ✓ wpm=${result.avg_wpm} density=${result.info_density_per_min}`);
  }
}

log(`\nAnalyzed ${analyses.length}/${videoDirs.length} videos successfully`);

if (analyses.length === 0) {
  log('No transcripts could be analyzed. Check that transcript.txt files have content.');
  process.exit(0);
}

// Synthesize patterns
log('\nSynthesizing patterns (Sonnet)...');
let patterns;
try {
  patterns = await synthesizePatterns(analyses);
  log('  ✓ Synthesis complete');
} catch (e) {
  log(`  ✗ Synthesis failed: ${e.message}`);
  // Fall back to simple averages
  const avgWpm     = Math.round(analyses.reduce((s, a) => s + (a.avg_wpm || 0), 0) / analyses.filter(a => a.avg_wpm).length);
  const avgDensity = (analyses.reduce((s, a) => s + (a.info_density_per_min || 0), 0) / analyses.length).toFixed(1);
  patterns = {
    target_wpm: avgWpm || 140,
    target_info_density_per_min: parseFloat(avgDensity) || 2.0,
    recommended_arc: ['hook → setup → escalation → revelation → resolution'],
    anti_repetition_rules: ['Never restate a fact from a prior scene', 'Each scene must introduce at least one new specific detail'],
    scene_length_words: 450,
  };
}

// Write to reference-principles.json
const principles = loadPrinciples();
principles.space_sleep_longform_patterns = {
  analyzed_at:    new Date().toISOString(),
  video_count:    analyses.length,
  individual_analyses: analyses,
  ...patterns,
};

fs.writeFileSync(PRINCIPLES_FILE, JSON.stringify(principles, null, 2));
log(`\n✓ Patterns written to ${PRINCIPLES_FILE}`);
log(`  Key patterns:`);
log(`  • Target WPM: ${patterns.target_wpm}`);
log(`  • Info density: ${patterns.target_info_density_per_min} facts/min`);
log(`  • Scene length: ${patterns.scene_length_words} words`);
if (patterns.anti_repetition_rules) {
  log(`  • Anti-repetition rules: ${patterns.anti_repetition_rules.length}`);
}

log('\n══════════════════════════════════════════════════════');
log('  DONE — Space script patterns learned');
log('  Next: rebuild src/script-generator.js or run test render');
log('══════════════════════════════════════════════════════\n');
