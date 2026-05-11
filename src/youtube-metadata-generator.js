/**
 * Generate SEO-optimised YouTube metadata from a SleepForge script.
 *
 * generateMetadata(topic, scenes) → { title, description, tags }
 *
 * - Title:       50-65 chars, keyword-first, no clickbait
 * - Description: Hook lines → benefit bullets → CTA → 10 hashtags
 * - Tags:        15 specific tags targeting sleep + philosophy search terms
 *
 * Uses Claude Haiku via callClaudeCLI (subscription auth, no API key).
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { callClaudeCLI } from "./claude-cli.js";

const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
const ROOT2 = path.resolve(__dirname2, '..');
const MODEL = "claude-haiku-4-5-20251001";

// ─── PRINCIPLE SCORES ─────────────────────────────────────────────────────────
// Reads data/principle-scores.json to weight title/metadata generation toward
// proven high-CTR principles and away from negative-lift ones.
// Falls back gracefully if file is missing.

let _principleScores = null;
let _principleScoresTs = 0;
const SCORES_TTL = 3600000; // re-read at most once per hour

function loadPrincipleScores() {
  if (_principleScores && Date.now() - _principleScoresTs < SCORES_TTL) return _principleScores;
  try {
    const f = path.join(ROOT2, 'data', 'principle-scores.json');
    if (fs.existsSync(f)) {
      _principleScores = JSON.parse(fs.readFileSync(f, 'utf-8'));
      _principleScoresTs = Date.now();
    }
  } catch {}
  return _principleScores;
}

// Returns a formatted block of principle performance context for the prompt.
// On every 5th video (by rough clock mod), includes a low-confidence principle
// to avoid local maxima.
let _videoCallCount = 0;
function buildPrincipleContext() {
  const scores = loadPrincipleScores();
  if (!scores?.principles?.length) return '';
  _videoCallCount++;

  const medHigh  = scores.principles.filter(p => ['medium', 'high'].includes(p.confidence));
  const lowConf  = scores.principles.filter(p => p.confidence === 'low');
  const positive = medHigh.filter(p => (p.ctr_lift_pct ?? 0) > 0).sort((a, b) => b.ctr_lift_pct - a.ctr_lift_pct).slice(0, 5);
  const negative = medHigh.filter(p => (p.ctr_lift_pct ?? 0) < -5).sort((a, b) => a.ctr_lift_pct - b.ctr_lift_pct).slice(0, 3);

  const lines = ['\n── PRINCIPLE PERFORMANCE DATA (from own channel) ──'];
  lines.push('Prefer these proven patterns (medium/high confidence):');
  for (const p of positive) lines.push(`  ✓ ${p.name}: CTR lift +${p.ctr_lift_pct}% | ret lift ${p.retention_lift_pct ?? 'n/a'}% (n=${p.n})`);
  if (negative.length) {
    lines.push('Avoid these underperforming patterns:');
    for (const p of negative) lines.push(`  ✗ ${p.name}: CTR lift ${p.ctr_lift_pct}% (n=${p.n})`);
  }
  // Every 5th call: suggest one low-confidence principle to experiment
  if (_videoCallCount % 5 === 0 && lowConf.length > 0) {
    const pick = lowConf[Math.floor(Math.random() * lowConf.length)];
    lines.push(`EXPERIMENT (low confidence, deliberate test): Try "${pick.name}" — data insufficient, explore this.`);
  }
  lines.push('─────────────────────────────────────────────────');
  return lines.join('\n');
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export async function generateMetadata(topic, scenes = [], channelConfig = null) {
  const scriptExcerpt = scenes
    .map((s) => s.narration || "")
    .join("\n\n")
    .slice(0, 2000);

  const prompt = buildPrompt(topic, scriptExcerpt, channelConfig);
  const raw    = await callClaudeCLI(prompt, { model: MODEL, timeoutMs: 120000 });

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in metadata response: ${raw.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  return {
    title:       String(parsed.title       || topic).slice(0, 100),
    description: String(parsed.description || "").slice(0, 5000),
    tags:        Array.isArray(parsed.tags) ? parsed.tags.slice(0, 30).map(String) : [],
  };
}

function buildPrompt(topic, scriptExcerpt, channelConfig = null) {
  const principleCtx = buildPrincipleContext();
  const niche    = channelConfig?.niche    || 'philosophy';
  const audience = channelConfig?.audience || 'adults who use YouTube to fall asleep — they want calm narration, philosophical wisdom, and ambient atmosphere';
  const channelName = channelConfig?.display_name || 'Sleepless Philosophers';
  const bannedTopicsNote = channelConfig?.banned_topics?.length
    ? `\nAVOID THESE TOPICS in description and tags: ${channelConfig.banned_topics.join(', ')}`
    : '';

  return `You are a YouTube SEO expert specialising in sleep, meditation, and ${niche} channels.${principleCtx}

Generate metadata for a sleep story video on the "${channelName}" channel.
Target audience: ${audience}

Topic: "${topic}"

Script excerpt:
${scriptExcerpt}
${bannedTopicsNote}
Return a single JSON object:
{
  "title": "Title here",
  "description": "Description here",
  "tags": ["tag1", "tag2", ...]
}

TITLE rules:
- 50-65 characters
- Lead with the main concept or subject name (for search ranking)
- Evoke calm, wonder, or restful sleep — never clickbait
- Examples: "Marcus Aurelius on Letting Go | Sleep Story", "The Death of Stars | Deep Sleep Documentary"

DESCRIPTION rules:
- Line 1-2: compelling hook (visible before "Show more") — what the viewer will experience
- Blank line, then 3-4 benefit bullets starting with ✦
- Blank line, then CTA: "Subscribe and hit 🔔 for new sleep stories every day."
- Blank line, then a note about the ambient audio/atmosphere
- Blank line, then exactly 10 hashtags on their own lines (e.g. #SleepStory)
- Total: 400-600 characters

TAGS rules (15 tags):
- Mix of: subject name, topic keywords, sleep-specific terms
- Include: "sleep story", "sleep meditation", "${niche} for sleep"
- Be specific
- No hashtags in tags array — plain text only`;
}
