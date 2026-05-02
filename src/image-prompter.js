import fs from "fs";
import path from "path";
import crypto from "crypto";
import { callClaudeCLI } from "./claude-cli.js";
import { generateSceneImage } from "./fal.js";

// ─── Contextual image-prompt system + cache DB ──────────────────────────────
//
// Replaces director.js's keyword-only library lookup with a Claude-driven,
// context-aware system. For each clip Claude reads:
//   - the exact narration text being spoken at that moment
//   - the philosopher + moment + action + setting (from script-generator)
//   - the surrounding clips for continuity
//   - the video bible (era, banned visuals, locked style)
// and writes a single chalk-on-blackboard image description that fits.
//
// Each prompt's content-hash is the cache key. Cache hit → reuse the image.
// Cache miss → generate via Schnell (~$0.003), save image + prompt to the DB.
// Over time the DB grows into a personal library of contextual chalk images.

const DB_DIR = path.resolve("db");
const DB_FILE = path.join(DB_DIR, "image-cache.json");
const LIBRARY_DIR = path.resolve("assets/images/library-v2");
const PROMPTER_MODEL = "claude-haiku-4-5-20251001";

// Chalk style is enforced by code-side templating (NOT in Claude's hands).
// Claude only writes the subject + action — the same gold-standard wrapper
// from thumbnail.js (which produces perfect chalk every time) is applied
// to every output. This prevents Claude from over-describing in ways that
// make Schnell render photorealistic marble statues.

const CHALK_PREFIX =
  "Hand-drawn white chalk illustration on a pure dark blackboard, " +
  "rough imperfect chalk strokes, visible chalk dust and smudges, " +
  "monochrome white and grey chalk only, no color, no warm tones, " +
  "NOT a photograph, NOT photorealistic, NOT a marble statue, NOT a sculpture, " +
  "pure chalk lines hand-drawn on dark slate.";

const CHALK_SUFFIX =
  "Heavy chalk texture on the figure and clothing, atmospheric chalk dust, " +
  "single crumbling Greek Doric column to the side, deep dark background, " +
  "no light sources (no fire, no candle, no lantern, no glow, no flame, no stars), " +
  "no text, no letters, no writing, no signature, no watermark, " +
  "16:9 landscape composition, calm meditative mood.";

function wrapChalkPrompt(subjectAction) {
  return `${CHALK_PREFIX} ${String(subjectAction || "").trim()} ${CHALK_SUFFIX}`;
}

const SUBJECT_INSTRUCTION = `
Each clip needs a SHORT subject+action description (10–25 words). Examples:
  "Epictetus seated calmly on the steps of his school in Nicopolis, hands open in his lap"
  "Seneca leaning over a writing desk, quill in hand, head tilted in thought"
  "Socrates standing in the agora, pointing at a young student"

RULES for the subject+action you write:
- ONE specific philosopher doing ONE specific gesture/pose
- The action must reveal WHO this philosopher is (their famous moment/setting)
- NEVER mention light sources (no fire, candle, lantern, glow, flame, stars)
- NEVER mention any text or writing or signage in the scene
- NEVER mention clothing color or material — just "robe" or "tunic"
- NEVER mention "marble" or "statue" or "sculpted" — that breaks the chalk style
- Skip culturally wrong elements: NO Asian elements, NO modern objects

DO NOT write the chalk style — that's added automatically. Write only the subject+action.`;

function ensureDb() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(LIBRARY_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ version: 1, entries: {} }, null, 2));
  }
}

function loadDb() {
  ensureDb();
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf-8")); }
  catch { return { version: 1, entries: {} }; }
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function hashPrompt(prompt) {
  return crypto.createHash("sha256").update(prompt.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function buildBatchPrompt(clips, videoBible, topic) {
  const bibleBlock = `
VIDEO TOPIC: ${topic}
Era: ${videoBible.era_specific || "Ancient Greece and Rome"}
Banned subjects: ${(videoBible.banned_visuals || []).join(", ") || "modern objects, photographs, Asian calligraphy"}`;

  const clipBlocks = clips.map((c, i) => `
─── Clip ${i + 1} (${c.start_time?.toFixed?.(1) || "?"}s–${c.end_time?.toFixed?.(1) || "?"}s) ───
Philosopher: ${c.philosopher || "—"}
Moment: ${c.moment || "—"}
Action hint: ${c.action || "—"}
Narration: "${(c.text || "").replace(/"/g, "'").slice(0, 280)}"`).join("\n");

  return `You are a chalk-art director for a sleep philosophy channel. For each clip below,
write a SHORT subject+action description (the chalk style is added automatically by code).

${bibleBlock}

${SUBJECT_INSTRUCTION}

INPUT — ${clips.length} clips:
${clipBlocks}

OUTPUT — JSON array of exactly ${clips.length} objects, in clip order:
[
  { "clipIndex": 0, "subject": "Epictetus", "subject_action": "Epictetus seated on the stone steps of his Nicopolis school, hands resting in his lap, looking upward in thought" },
  ...
]

Return ONLY the JSON array. No preamble, no markdown fences. The "subject_action" must be 10-25 words and must NOT include chalk style descriptions or light sources.`;
}

export async function generateContextualPrompts(clips, videoBible, topic) {
  if (!clips.length) return [];

  // Batch in groups of 12 to keep Claude focused per call
  const batchSize = 12;
  const allPrompts = [];

  for (let start = 0; start < clips.length; start += batchSize) {
    const batch = clips.slice(start, start + batchSize);
    const prompt = buildBatchPrompt(batch, videoBible, topic);
    console.log(`  Image prompter: clips ${start + 1}-${start + batch.length}/${clips.length}...`);

    let raw;
    try {
      raw = await callClaudeCLI(prompt, { model: PROMPTER_MODEL, timeoutMs: 120000 });
    } catch (err) {
      console.error(`  Image prompter batch failed: ${err.message}`);
      for (const c of batch) {
        const sa = `${c.philosopher || "an ancient philosopher"} ${c.action || "in quiet contemplation by a stone column"}`;
        allPrompts.push({
          clipIndex: c.index,
          subject: c.philosopher || "philosopher",
          subjectAction: sa,
          prompt: wrapChalkPrompt(sa),
        });
      }
      continue;
    }

    const text = raw.replace(/^```(?:json)?\s*/gm, "").replace(/```\s*$/gm, "").trim();
    let parsed;
    try { parsed = JSON.parse(text); }
    catch (err) {
      console.error(`  Image prompter JSON parse failed: ${err.message}`);
      console.error(`  raw (first 400): ${text.slice(0, 400)}`);
      for (const c of batch) {
        const sa = `${c.philosopher || "an ancient philosopher"} ${c.action || "in quiet contemplation by a stone column"}`;
        allPrompts.push({
          clipIndex: c.index,
          subject: c.philosopher || "philosopher",
          subjectAction: sa,
          prompt: wrapChalkPrompt(sa),
        });
      }
      continue;
    }

    // Wrap each Claude-written subject+action in the enforced chalk-style template
    for (let i = 0; i < batch.length; i++) {
      const entry = parsed[i] || {};
      const sa = String(entry.subject_action || entry.subjectAction || "").trim()
        || `${batch[i].philosopher || "an ancient philosopher"} ${batch[i].action || "in quiet contemplation"}`;
      allPrompts.push({
        clipIndex: batch[i].index,
        subject: entry.subject || batch[i].philosopher || "philosopher",
        subjectAction: sa,
        prompt: wrapChalkPrompt(sa),
      });
    }
  }

  return allPrompts;
}

// Resolve a prompt to an image path. Cache hit → return existing path.
// Cache miss → generate via Schnell, save, record.
export async function resolveImage(promptEntry, slug) {
  if (!promptEntry || !promptEntry.prompt) return null;

  const key = hashPrompt(promptEntry.prompt);
  const db = loadDb();

  // Cache hit
  if (db.entries[key] && fs.existsSync(db.entries[key].imagePath)) {
    return { imagePath: db.entries[key].imagePath, cached: true, key };
  }

  // Cache miss — generate
  const filename = `${key}.png`;
  const imagePath = path.join(LIBRARY_DIR, filename);
  const relPath = path.relative(process.cwd(), imagePath);

  try {
    await generateSceneImage(promptEntry.prompt, relPath);
  } catch (err) {
    console.error(`  Image gen failed for clip: ${err.message}`);
    return null;
  }

  if (!fs.existsSync(imagePath)) {
    console.error(`  Image gen produced no file at ${imagePath}`);
    return null;
  }

  db.entries[key] = {
    prompt: promptEntry.prompt,
    subject: promptEntry.subject,
    imagePath: relPath,
    createdAt: new Date().toISOString(),
    sourceVideo: slug,
  };
  saveDb(db);

  return { imagePath: relPath, cached: false, key };
}

export async function applyContextualImagesToClips(clips, videoBible, topic, slug) {
  console.log(`\n  Contextual image prompter (${clips.length} clips)`);
  const t0 = Date.now();

  const prompts = await generateContextualPrompts(clips, videoBible, topic);
  console.log(`  ${prompts.length} prompts generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  let cacheHits = 0;
  let generated = 0;
  let failed = 0;

  for (const p of prompts) {
    const result = await resolveImage(p, slug);
    if (!result) { failed++; continue; }
    if (result.cached) cacheHits++; else generated++;
    const clip = clips.find((c) => c.index === p.clipIndex);
    if (clip) {
      clip.imagePath = result.imagePath;
      clip.imagePromptHash = result.key;
      clip.imagePrompt = p.prompt;
    }
  }

  console.log(`  Images: ${cacheHits} cache hits, ${generated} generated, ${failed} failed`);
  return { prompts, cacheHits, generated, failed };
}
