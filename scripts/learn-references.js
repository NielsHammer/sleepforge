/**
 * learn-references.js
 *
 * Scans C:\Users\niels\Desktop\Sleepforge references\Done\ for reference
 * videos (imported via import-reference.js or dropped manually as folders).
 * Processes only NEW sources not yet in data/reference-principles.json.
 * Merges extracted patterns and updates the file.
 *
 * Usage:
 *   node scripts/learn-references.js
 *   node scripts/learn-references.js --force   (re-process all sources)
 *
 * Source format expected (per video):
 *   <Done>/<any-folder>/<video-id>/metadata.json   — title, views, tags
 *   <Done>/<any-folder>/<video-id>/transcript.txt  — narration text
 *   <Done>/<any-folder>/<video-id>/thumbnail.jpg   — thumbnail image
 *
 * Also handles flat files dropped directly in Done/:
 *   <Done>/<filename>.txt / .json / .md
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI } = await import('../src/claude-cli.js');

const DONE_DIR        = process.env.REFERENCE_DIR
  || 'C:\\Users\\niels\\Desktop\\Sleepforge references\\Done';
const PRINCIPLES_FILE = path.join(ROOT, 'data', 'reference-principles.json');
const FORCE           = process.argv.includes('--force');

function log(msg) { console.log(msg); }

// ─── LOAD CURRENT PRINCIPLES ─────────────────────────────────────────────────

function loadPrinciples() {
  try {
    const raw = JSON.parse(fs.readFileSync(PRINCIPLES_FILE, 'utf-8'));
    if (!raw.sources) raw.sources = [];
    return raw;
  } catch {
    return { sources: [], thumbnail_patterns: [], title_patterns: [], script_patterns: [], cross_correlations: [] };
  }
}

// ─── DISCOVER SOURCES ────────────────────────────────────────────────────────

function discoverSources(doneDir) {
  if (!fs.existsSync(doneDir)) {
    log(`References folder not found: ${doneDir}`);
    log('Create it and drop reference video folders (from import-reference.js) inside.');
    return [];
  }

  const sources = [];

  // Walk up to 2 levels deep looking for video folders with metadata.json
  for (const entry of fs.readdirSync(doneDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const channelDir = path.join(doneDir, entry.name);
      for (const sub of fs.readdirSync(channelDir, { withFileTypes: true })) {
        if (sub.isDirectory()) {
          const videoDir = path.join(channelDir, sub.name);
          const metaPath = path.join(videoDir, 'metadata.json');
          if (fs.existsSync(metaPath)) {
            sources.push({ type: 'video_folder', id: sub.name, dir: videoDir, metaPath });
          }
        }
      }
      // Also handle if the entry IS a video folder directly (no channel nesting)
      const directMeta = path.join(channelDir, 'metadata.json');
      if (fs.existsSync(directMeta)) {
        sources.push({ type: 'video_folder', id: entry.name, dir: channelDir, metaPath: directMeta });
      }
    }
  }

  // Flat text/json/md files directly in Done/
  for (const entry of fs.readdirSync(doneDir, { withFileTypes: true })) {
    if (entry.isFile() && /\.(txt|json|md)$/i.test(entry.name)) {
      sources.push({ type: 'flat_file', id: entry.name, filePath: path.join(doneDir, entry.name) });
    }
  }

  return sources;
}

// ─── EXTRACT SIGNALS FROM ONE SOURCE ─────────────────────────────────────────

async function extractSignals(source) {
  let content = '';

  if (source.type === 'video_folder') {
    // Title + tags from metadata
    try {
      const meta = JSON.parse(fs.readFileSync(source.metaPath, 'utf-8'));
      content += `TITLE: ${meta.title}\n`;
      content += `VIEWS: ${meta.view_count ?? 'unknown'}\n`;
      content += `TAGS: ${(meta.tags || []).slice(0, 15).join(', ')}\n`;
      if (meta.description) content += `DESCRIPTION EXCERPT: ${meta.description.slice(0, 300)}\n`;
      content += '\n';
    } catch {}

    // Transcript excerpt (first 800 words)
    const transcriptPath = path.join(source.dir, 'transcript.txt');
    if (fs.existsSync(transcriptPath)) {
      const text = fs.readFileSync(transcriptPath, 'utf-8');
      const words = text.split(/\s+/).slice(0, 800);
      content += `TRANSCRIPT EXCERPT:\n${words.join(' ')}\n`;
    }
  } else {
    // Flat file
    try {
      content = fs.readFileSync(source.filePath, 'utf-8').slice(0, 3000);
    } catch {}
  }

  if (!content.trim()) return null;

  const prompt = `You are a YouTube content analyst for a philosophy sleep channel called "Sleepless Philosophers".

Analyze this reference video data and extract actionable patterns for improving CTR and watch time.

REFERENCE DATA:
${content}

Extract patterns in this exact JSON format:
{
  "title_signals": ["pattern or keyword that drives clicks", ...],
  "thumbnail_notes": "one sentence about thumbnail style if inferable from title/context",
  "script_pacing": "fast/slow/medium and what makes it work",
  "hook_pattern": "how the video hooks the viewer in the first 30 seconds",
  "ctr_factors": ["specific element that likely drives CTR", ...],
  "views_tier": "low (<10k) / medium (10k-100k) / high (100k-500k) / viral (500k+)"
}

Be specific and actionable. Focus on what's replicable.`;

  try {
    const raw = await callClaudeCLI(prompt, { model: 'claude-haiku-4-5-20251001', timeoutMs: 30000 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ─── SYNTHESIZE ALL SIGNALS → UPDATE PRINCIPLES ──────────────────────────────

async function synthesizePrinciples(currentPrinciples, allSignals, allSources) {
  if (allSignals.length === 0) return currentPrinciples;

  // Compact signals to a single line per source — keeps prompt well under token limits
  const signalsSummary = allSignals
    .filter(Boolean)
    .map((s, i) =>
      `[${i+1}] titles:${(s.title_signals||[]).slice(0,3).join('|')} ` +
      `ctr:${(s.ctr_factors||[]).slice(0,2).join('|')} ` +
      `views:${String(s.views_tier||'').split(' ')[0]} ` +
      `hook:${String(s.hook_pattern||'').slice(0,60)}`
    )
    .join('\n');

  // Ask only for the DELTA — new insights — and merge them into existing principles.
  // Sonnet is used here because it runs once per learn session, not per video.
  const prompt = `You are a YouTube content strategist for a philosophy sleep channel.

Analyze signals from ${allSignals.filter(Boolean).length} reference videos:
${signalsSummary}

Return ONLY this JSON:
{
  "top_emerging_patterns": ["one-line insight #1", "one-line insight #2", "one-line insight #3"],
  "best_title_formulas": [
    {"formula": "N [Superlative] [Topic] to Fall Asleep to", "signal_count": N},
    {"formula": "All of [Topic] Explained to Fall Asleep to", "signal_count": N}
  ],
  "high_ctr_keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "script_insight": "one sentence about what script style correlates with high views"
}`;

  try {
    const raw = await callClaudeCLI(prompt, { model: 'claude-sonnet-4-6', timeoutMs: 60000 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in synthesis response');
    const delta = JSON.parse(match[0]);

    return {
      ...currentPrinciples,
      top_emerging_patterns: delta.top_emerging_patterns || [],
      high_ctr_keywords:     delta.high_ctr_keywords     || [],
      script_insight:        delta.script_insight        || '',
      sources: allSources,
      sample_count: allSources.length,
      last_updated: new Date().toISOString(),
    };
  } catch (err) {
    log(`  Synthesis failed: ${err.message} — keeping existing principles, updating sources only`);
    return {
      ...currentPrinciples,
      sources: allSources,
      sample_count: allSources.length,
      last_updated: new Date().toISOString(),
    };
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('\n══════════════════════════════════════════');
  log('  SleepForge — Reference Learner');
  log('══════════════════════════════════════════\n');

  const principles = loadPrinciples();
  const processedIds = FORCE ? new Set() : new Set(principles.sources.map(s => s.id));

  log(`Done folder: ${DONE_DIR}`);
  const allSources = discoverSources(DONE_DIR);
  log(`Sources found: ${allSources.length} total`);

  const newSources = allSources.filter(s => !processedIds.has(s.id));
  log(`New (unprocessed): ${newSources.length}`);

  if (newSources.length === 0 && !FORCE) {
    log('\nNo new references to process.');
    log(`Total in principles: ${principles.sources.length} sources`);
    if (principles.title_patterns?.length) {
      log(`\nTop title patterns:`);
      (principles.title_patterns || []).slice(0, 3).forEach((p, i) =>
        log(`  ${i+1}. ${p.pattern_name}: "${p.formula}"`)
      );
    }
    return;
  }

  // Extract signals from each new source
  log('\nExtracting signals...');
  const newSignals = [];
  for (const source of newSources) {
    log(`  Processing: ${source.id}`);
    const signals = await extractSignals(source);
    if (signals) {
      newSignals.push(signals);
      log(`    ✓ views_tier=${signals.views_tier} ctr_factors=${signals.ctr_factors?.length ?? 0}`);
    } else {
      log(`    ✗ No extractable signals (no transcript/metadata?)`);
    }
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }

  // Merge sources list
  const knownSources = FORCE ? [] : principles.sources;
  const mergedSources = [
    ...knownSources,
    ...newSources.map(s => ({ id: s.id, type: s.type, processed_at: new Date().toISOString() })),
  ];

  // Synthesize updated principles
  log('\nSynthesizing patterns from all signals...');
  const allSignals = FORCE
    ? newSignals
    : newSignals; // Only synthesize from new ones — merges with existing in prompt
  const updatedPrinciples = await synthesizePrinciples(principles, allSignals, mergedSources);

  fs.writeFileSync(PRINCIPLES_FILE, JSON.stringify(updatedPrinciples, null, 2));
  log(`\n✓ Principles updated: ${PRINCIPLES_FILE}`);

  // Summary
  log('\n──────────────────────────────────────────');
  log(`Learned from ${newSources.length} new references.`);
  log(`Total: ${mergedSources.length} references in principles.`);
  if (updatedPrinciples.top_emerging_patterns?.length) {
    log('\nTop 3 emerging patterns:');
    updatedPrinciples.top_emerging_patterns.slice(0, 3).forEach((p, i) => log(`  ${i+1}. ${p}`));
  }
  if (updatedPrinciples.high_ctr_keywords?.length) {
    log(`High-CTR keywords: ${updatedPrinciples.high_ctr_keywords.join(', ')}`);
  }
  if (updatedPrinciples.script_insight) {
    log(`Script insight: ${updatedPrinciples.script_insight}`);
  }
  log('──────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
