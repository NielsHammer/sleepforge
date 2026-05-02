import { callClaudeCLI } from "./claude-cli.js";

// ─── SleepForge Metadata Generator ──────────────────────────────────────────
// Claude Haiku writes title, description, tags. Chapters built locally from
// the director's clips at ~5-minute intervals (or per philosopher change).

const MODEL = "claude-haiku-4-5-20251001"; // CLAUDE.md rule: Haiku for metadata

function formatYouTubeTimestamp(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Build chapters every ~5 minutes, snapping to the nearest clip boundary
// where the philosopher (or moment) changes.
function buildChapters(clips, totalDuration, intervalSec = 300) {
  if (!clips || clips.length === 0) {
    return [{ time: 0, title: "Begin" }];
  }
  const chapters = [{ time: 0, title: clips[0].philosopher || "Opening" }];
  let lastChapterTime = 0;
  let lastPhilosopher = clips[0].philosopher || "";

  for (const clip of clips) {
    const elapsedSinceLast = clip.start_time - lastChapterTime;
    const philosopherChanged = clip.philosopher && clip.philosopher !== lastPhilosopher;
    if (elapsedSinceLast >= intervalSec || (philosopherChanged && elapsedSinceLast >= 120)) {
      const title = clip.philosopher
        ? `${clip.philosopher}${clip.moment ? " — " + clip.moment.slice(0, 60) : ""}`
        : (clip.text || "").slice(0, 60);
      chapters.push({ time: clip.start_time, title });
      lastChapterTime = clip.start_time;
      lastPhilosopher = clip.philosopher || lastPhilosopher;
    }
  }
  return chapters;
}

async function generateTitleDescTags(topic, scenes, totalDuration) {
  const philosophers = [...new Set((scenes || []).map((s) => s.philosopher).filter(Boolean))];
  const sample = (scenes || [])
    .slice(0, 3)
    .map((s) => s.narration)
    .join("\n")
    .slice(0, 1500);

  const prompt = `You write YouTube metadata for a calming long-form sleep story video on a philosophy channel called "Sleepless Philosophers".

Topic: "${topic}"
Featured philosophers: ${philosophers.join(", ") || "various"}
Duration: ${(totalDuration / 60).toFixed(0)} minutes
Sample narration:
"${sample}..."

Write a JSON object with these fields:
{
  "title": "...",        // SEO-friendly, under 70 chars, includes "Sleep Story" or "Bedtime Story" or "Sleep Meditation"
  "description": "...",  // 2-3 paragraphs, gentle and calming, ~600-900 chars, ends with: "Drift off, and let the philosophers guide you."
  "tags": [...]          // 15-20 tags as short strings: single words and 2-3 word phrases
}

Return ONLY valid JSON, no markdown fences, no commentary.`;

  try {
    let text = await callClaudeCLI(prompt, { model: MODEL, timeoutMs: 60000 });
    text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(text);
    return {
      title: String(parsed.title || "").slice(0, 100),
      description: String(parsed.description || "").slice(0, 4000),
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 25).map(String) : [],
    };
  } catch (err) {
    console.log(`  Metadata via Claude failed (${err.message}); using fallback`);
    return {
      title: `${topic} — A Calming Sleep Story | Sleepless Philosophers`.slice(0, 100),
      description:
        `A gentle, long-form sleep story exploring ${topic.toLowerCase()}. ` +
        `Featuring the wisdom of ${philosophers.slice(0, 4).join(", ") || "ancient philosophers"}. ` +
        `Lower the lights, settle in, and let the slow chalk-on-blackboard imagery and calm narration carry you toward rest.\n\n` +
        `Drift off, and let the philosophers guide you.`,
      tags: [
        "sleep story", "bedtime story", "philosophy", "stoicism", "meditation",
        "relaxation", "calm", "deep sleep", "ancient wisdom", "philosophy sleep",
        ...philosophers.map((p) => p.toLowerCase()),
      ],
    };
  }
}

export async function generateMetadata(topic, scenes, clips, totalDuration) {
  const { title, description, tags } = await generateTitleDescTags(topic, scenes, totalDuration);
  const chapters = buildChapters(clips || [], totalDuration);

  const chaptersBlock = chapters
    .map((c) => `${formatYouTubeTimestamp(c.time)} ${c.title}`)
    .join("\n");

  return {
    title,
    description: `${description}\n\nChapters:\n${chaptersBlock}`,
    tags,
    chapters,
  };
}
