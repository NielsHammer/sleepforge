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

  const isAstronomer = channelConfig?.slug === 'sleepless-astronomer' || channelConfig?.thumbnail_style === 'astrokobi';
  const prompt = isAstronomer
    ? buildAstronomerMetadataPrompt(topic, scriptExcerpt, channelConfig)
    : buildPrompt(topic, scriptExcerpt, channelConfig);

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

// ─── ASTRONOMER TITLE CANDIDATES (5 Haiku → Sonnet picks) ────────────────────

export async function generateAstronomerTitleCandidates(topic, channelConfig = null) {
  const topicStr = typeof topic === 'object'
    ? (topic.title + (topic.angle ? '\n\nAngle: ' + topic.angle : ''))
    : String(topic);

  const FORMAT_SIGNALS = [
    '1 Hour for Deep Sleep',
    '60 Minutes of Space Facts',
    'Fall Asleep to the Cosmos',
    'Deep Sleep Astronomy',
  ];

  const haikuPrompt = `Generate 5 YouTube title candidates for a 60-minute astronomy documentary sleep channel video.

TOPIC: ${topicStr}

FORMAT: Each title MUST follow this exact structure:
  "[AstroKobi curiosity hook] | [Format signal]"

The pipe character ( | ) separates the curiosity hook from the format signal.
This signals to YouTube's algorithm that this is a long-form ambient/sleep video.

CURIOSITY HOOK patterns (pick the most natural fit):
  * "What If [extreme space scenario]?"
  * "How Are We Still [doing seemingly impossible thing]?"
  * "Could [cosmic event] Happen [Again / To Us]?"
  * "What Came Before [X]?" / "What Is Outside [X]?"
  * "[N] [Things/Planets/Events] More [Extreme/Strange] Than [X]"
  * "Solving The [Hardest/Biggest] Problem In [Physics/Astronomy]"
  * "This [Specific Object] Is [Shocking Statement]"
  * "The [Object/Event] That [Changed/Broke] Everything"
  * "Scientists [Just Found / Are REALLY Close To] [X]"
  * "[NASA / JWST / Hubble] Just [Verb] [Shocking Object]"

FORMAT SIGNAL options (rotate variety across the 5 candidates):
  "${FORMAT_SIGNALS[0]}"
  "${FORMAT_SIGNALS[1]}"
  "${FORMAT_SIGNALS[2]}"
  "${FORMAT_SIGNALS[3]}"

Hook rules:
- Create a CURIOSITY GAP — viewer must click to get the answer
- Use specific names when applicable: "Voyager 1", "Betelgeuse", "JWST", "Cassini"
- Can use dramatic words: TERRIFYING, NEVER, IMPOSSIBLE, REAL
- Hook portion alone should be 35-55 characters; full title with signal ≤ 80 characters

Examples of correct format:
  "How Are We Still Hearing from Voyager 1? | 1 Hour for Deep Sleep"
  "What Happens at the Edge of a Black Hole? | 60 Minutes of Space Facts"
  "The Star That Will Destroy Its Own Galaxy | Fall Asleep to the Cosmos"

Return ONLY a JSON array of exactly 5 title strings:
["Title 1", "Title 2", "Title 3", "Title 4", "Title 5"]`;

  const raw = await callClaudeCLI(haikuPrompt, { model: MODEL, timeoutMs: 90000 });
  const m = raw.match(/\[[\s\S]*?\]/);
  if (!m) throw new Error('No title array in Haiku response');
  const candidates = JSON.parse(m[0]).map(String).slice(0, 5);

  const sonnetPrompt = `You are a YouTube title expert for astronomy sleep channel "Sleepless Astronomer".

Each candidate follows the format: "[Curiosity hook] | [Format signal]"
Pick the SINGLE BEST title from these candidates. Optimise for:
- Strongest curiosity gap in the hook (viewer MUST click to learn the answer)
- Hook is specific and dramatic, not generic
- Format signal is appropriate for the hook length (total title ≤ 80 chars)
- The pipe format signals ambient/sleep content to YouTube's algorithm

TOPIC: ${topicStr}

Candidates:
${candidates.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

Return ONLY this JSON:
{ "title": "the chosen title", "reason": "one sentence: why this title wins on click probability" }`;

  let winner = candidates[0];
  let reason = '';
  try {
    const raw2 = await callClaudeCLI(sonnetPrompt, { model: 'claude-sonnet-4-6', timeoutMs: 90000 });
    const m2 = raw2.match(/\{[\s\S]*\}/);
    if (m2) {
      const pick = JSON.parse(m2[0]);
      winner = pick.title || candidates[0];
      reason = pick.reason || '';
    }
  } catch (e) {
    console.log('  [Title] Sonnet pick failed — using first Haiku candidate');
  }

  return { candidates, winner, reason };
}

function buildAstronomerMetadataPrompt(topic, scriptExcerpt, channelConfig = null) {
  return `You are a YouTube SEO expert for an astronomy documentary channel "Sleepless Astronomer" styled after AstroKobi.

Generate metadata for a 60-minute astronomy documentary video.

Topic: "${topic}"

Script excerpt:
${scriptExcerpt}

Return a single JSON object:
{
  "title": "Title here",
  "description": "Description here",
  "tags": ["tag1", "tag2", ...]
}

TITLE rules:
- Format: "[Curiosity hook] | [Format signal]" — pipe separates hook from sleep signal
- Hook portion: 35-55 characters; total title ≤ 80 characters
- Format signal options: "1 Hour for Deep Sleep" | "60 Minutes of Space Facts" | "Fall Asleep to the Cosmos" | "Deep Sleep Astronomy"
- AstroKobi-style hook patterns (pick the most natural fit):
  * "What If [extreme space scenario]?"
  * "How Are We Still [doing impossible thing]?"
  * "Could [cosmic event] Happen Again?"
  * "What Came Before [X]?"
  * "The [Object/Event] That [Changed/Broke] Everything"
  * "Solving The Hardest Problem In [Physics/Astronomy]"
  * "This [Object] Is [Shocking Statement]"
  * "Scientists Just Found [X]"
- Create a CURIOSITY GAP — viewer clicks to get the answer
- Use specific names: "Voyager 1", "Betelgeuse", "JWST", "Cassini"

DESCRIPTION rules:
- Line 1-2: compelling hook for astronomy fans — what will they discover in this video?
- Blank line, then 3-4 content bullets starting with ▸
- Blank line, then: "New astronomy documentaries every week. Subscribe and hit the bell 🔔"
- Blank line, then exactly 10 hashtags (#space #astronomy #universe #nasa etc.)
- Total: 350-600 characters
- ZERO mention of sleep anywhere

TAGS rules (15 tags):
- Astronomy-specific: "astronomy", "space", "universe", "nasa", "documentary"
- Include the specific subject (e.g. "voyager 1", "black hole", "betelgeuse", "neutron star")
- Include question searches: "what happens when", "how big is"
- No sleep terms in tags`;
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
