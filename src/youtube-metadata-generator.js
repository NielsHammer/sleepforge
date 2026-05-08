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

import { callClaudeCLI } from "./claude-cli.js";

const MODEL = "claude-haiku-4-5-20251001";

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export async function generateMetadata(topic, scenes = []) {
  const scriptExcerpt = scenes
    .map((s) => s.narration || "")
    .join("\n\n")
    .slice(0, 2000);

  const prompt = buildPrompt(topic, scriptExcerpt);
  const raw    = await callClaudeCLI(prompt, { model: MODEL, timeoutMs: 60000 });

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in metadata response: ${raw.slice(0, 200)}`);

  const parsed = JSON.parse(match[0]);

  // Validate and normalise
  return {
    title:       String(parsed.title       || topic).slice(0, 100),
    description: String(parsed.description || "").slice(0, 5000),
    tags:        Array.isArray(parsed.tags) ? parsed.tags.slice(0, 30).map(String) : [],
  };
}

// ─── PROMPT ──────────────────────────────────────────────────────────────────

function buildPrompt(topic, scriptExcerpt) {
  return `You are a YouTube SEO expert specialising in sleep, meditation, and philosophy channels.

Generate metadata for a sleep story video. The target audience is adults who use YouTube to fall asleep — they want calm narration, philosophical wisdom, and ambient atmosphere.

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
- 50-65 characters
- Lead with the philosopher name or concept keyword (for search ranking)
- Evoke calm, wisdom, or restful sleep — never clickbait
- Examples: "Marcus Aurelius on Letting Go | Sleep Story", "Stoic Wisdom for a Restful Mind"

DESCRIPTION rules:
- Line 1-2: compelling hook (visible before "Show more") — what wisdom the viewer will absorb
- Blank line, then 3-4 benefit bullets starting with ✦
- Blank line, then CTA: "Subscribe and hit 🔔 for new sleep stories every week."
- Blank line, then a note about the ambient audio/atmosphere
- Blank line, then exactly 10 hashtags on their own lines (e.g. #SleepStory)
- Total: 400-600 characters

TAGS rules (15 tags):
- Mix of: philosopher name, topic keywords, sleep-specific terms
- Include: "sleep story", "sleep meditation", "philosophical sleep", "stoicism for sleep"
- Be specific: "marcus aurelius stoicism" beats "philosophy"
- No hashtags in tags array — plain text only`;
}
