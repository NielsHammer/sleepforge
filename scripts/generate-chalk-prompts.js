/**
 * Generate Flux Schnell-ready chalk prompts for philosopher scene concepts.
 * Reads docs/CONTEXT/philosopher-scenes.md → writes data/chalk-prompts.json
 *
 * Usage:
 *   node scripts/generate-chalk-prompts.js
 *
 * Cost: ~$0.15 for 500 entries (Claude Haiku, batched 20/call = 25 calls)
 * Does NOT generate images. Review data/chalk-prompts.json first.
 *
 * Expected markdown format (docs/CONTEXT/philosopher-scenes.md):
 *   ## Philosopher Name
 *   1. Scene description
 *   2. Scene description
 *   ...
 */

import Anthropic from "@anthropic-ai/sdk";
import fs        from "fs";
import path      from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

const MD_PATH   = path.join(ROOT, "docs", "CONTEXT", "philosopher-scenes.md");
const OUT_PATH  = path.join(ROOT, "data", "chalk-prompts.json");
const BATCH_SIZE = 20;
const MODEL      = "claude-haiku-4-5-20251001";

const client = new Anthropic();

// ─── PARSE MARKDOWN ──────────────────────────────────────────────────────────
// Accepts two formats:
//   ## Philosopher Name          (H2 section header)
//   1. Scene description         (numbered list item)
//
// Also accepts inline philosopher on each line:
//   Socrates | drinking the hemlock
function parseScenesMarkdown(text) {
  const entries = [];
  let philosopher = null;
  let sceneIndex  = 0;
  let id          = 1;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;

    // Section header: ## Socrates
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) {
      philosopher = h2[1].trim().replace(/\*+/g, "");
      sceneIndex  = 0;
      continue;
    }

    // Numbered list item: 1. Scene description
    const item = line.match(/^\d+\.\s+(.+)/);
    if (item && philosopher) {
      entries.push({
        id:                String(id).padStart(3, "0"),
        philosopher,
        scene_description: item[1].trim(),
        scene_index:       sceneIndex,
      });
      sceneIndex++;
      id++;
      continue;
    }

    // Pipe format: Philosopher | scene description
    const pipe = line.match(/^(.+?)\s*\|\s*(.+)/);
    if (pipe) {
      entries.push({
        id:                String(id).padStart(3, "0"),
        philosopher:       pipe[1].trim(),
        scene_description: pipe[2].trim(),
        scene_index:       0,
      });
      id++;
    }
  }

  return entries;
}

// ─── BUILD CLAUDE BATCH PROMPT ───────────────────────────────────────────────
function buildBatchPrompt(batch) {
  const items = batch
    .map((e, i) =>
      `[${i + 1}] Philosopher: ${e.philosopher}\nScene: ${e.scene_description}`
    )
    .join("\n\n");

  return `You are a chalk-art director creating Flux Schnell image prompts for a sleep-story YouTube channel. Each image is a white chalk figure on a near-black background. The figure will be composited over a separate candlelit Greek library background, so the chalk image must contain ONLY the figure — no environment, no architecture, no background elements.

ABSOLUTE RULES — these override everything:
- Style: white chalk drawing on near-black (#080808) background. Hand-sketched, slight chalk dust, monochrome.
- Subject: SMALL (30–40% of frame height), CENTRED horizontally, lower-centre of frame. Generous black negative space above and to the sides.
- NO architectural elements — no columns, arches, buildings, rooms, walls, floors, tiles, steps, furniture
- NO environmental elements — no sky, clouds, water, ground, grass, trees, rocks
- NO text, labels, scrolls, books showing text, writing implements used
- NO light sources — no candles, flames, lamps, stars, glowing objects, aura
- NO modern objects of any kind
- ONE philosopher, ONE clear pose, ONE action
- Style anchor (start every prompt with exactly this): "white chalk illustration on near-black background, chalkboard art style, hand-sketched monochrome figure, chalk dust texture, subject small and centred with generous negative space —"

For each entry below, respond with a JSON object:
{
  "flux_prompt": "white chalk illustration on near-black background, chalkboard art style, hand-sketched monochrome figure, chalk dust texture, subject small and centred with generous negative space — [40-55 words describing the philosopher's pose and action only, no environment]",
  "tags": {
    "era": "<Ancient Greek | Ancient Roman | Medieval | Renaissance | Enlightenment | Modern>",
    "school_of_thought": "<Stoicism | Platonism | Aristotelianism | Epicureanism | Cynicism | Skepticism | Existentialism | Pragmatism | ...>",
    "action_verb": "<single present-tense verb, e.g. meditating | arguing | gesturing | sitting | standing | reaching>",
    "key_objects": ["<2–4 objects visible on/near the figure, e.g. scroll, cup, staff>"],
    "mood": "<single adjective, e.g. contemplative | defiant | serene | anguished | triumphant>"
  }
}

Respond with a JSON array of exactly ${batch.length} objects, one per entry, in the same order as the input. No extra text.

Entries:
${items}`;
}

// ─── CLAUDE CALL ─────────────────────────────────────────────────────────────
async function generateBatch(entries) {
  const res = await client.messages.create({
    model:      MODEL,
    max_tokens: 6000,
    messages:   [{ role: "user", content: buildBatchPrompt(entries) }],
  });

  const raw   = res.content[0].text.trim();
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array in response: ${raw.slice(0, 300)}`);

  const parsed = JSON.parse(match[0]);
  if (!Array.isArray(parsed)) throw new Error("Response is not an array");
  return parsed;
}

// ─── FALLBACK PROMPT for failed batches ──────────────────────────────────────
function fallbackPrompt(entry) {
  return (
    `white chalk illustration on near-black background, chalkboard art style, ` +
    `hand-sketched monochrome figure, chalk dust texture, subject small and centred ` +
    `with generous negative space — ${entry.philosopher}, ${entry.scene_description}, ` +
    `isolated figure with no environment, no architecture, no text`
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(MD_PATH)) {
    console.error(`\nERROR: ${MD_PATH} not found.`);
    console.error("Paste your philosopher-scenes.md into docs/CONTEXT/ first.\n");
    process.exit(1);
  }

  const md  = fs.readFileSync(MD_PATH, "utf-8");
  const raw = parseScenesMarkdown(md);
  console.log(`\nParsed ${raw.length} scenes from philosopher-scenes.md`);

  if (raw.length === 0) {
    console.error("No entries parsed — check the markdown format.");
    process.exit(1);
  }

  // Resume: skip already-generated entries
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  let existing = [];
  if (fs.existsSync(OUT_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf-8"));
      console.log(`Resuming: ${existing.length} entries already done`);
    } catch { existing = []; }
  }
  const doneIds = new Set(existing.map((e) => e.id));
  const todo    = raw.filter((e) => !doneIds.has(e.id));

  console.log(`To generate: ${todo.length} entries`);
  if (todo.length === 0) {
    console.log("All done. Review data/chalk-prompts.json before generating images.");
    return;
  }

  const results   = [...existing];
  let inputTokens = 0;
  let outputTokens = 0;
  const totalBatches = Math.ceil(todo.length / BATCH_SIZE);

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch    = todo.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;

    process.stdout.write(
      `  Batch ${batchNum}/${totalBatches} (entries ${i + 1}–${Math.min(i + BATCH_SIZE, todo.length)})... `
    );

    let claudeResults;
    try {
      claudeResults = await generateBatch(batch);
      console.log("ok");
    } catch (err) {
      console.log(`FAILED (${err.message.slice(0, 60)})`);
      console.log("  Using fallback prompts for this batch.");
      claudeResults = batch.map(() => null);
    }

    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j];
      const cr    = claudeResults[j];
      results.push({
        id:                entry.id,
        philosopher:       entry.philosopher,
        scene_description: entry.scene_description,
        flux_prompt:       cr?.flux_prompt ?? fallbackPrompt(entry),
        tags: {
          philosopher_name:  entry.philosopher,
          era:               cr?.tags?.era               ?? "Ancient",
          school_of_thought: cr?.tags?.school_of_thought ?? "Philosophy",
          action_verb:       cr?.tags?.action_verb       ?? "contemplating",
          key_objects:       cr?.tags?.key_objects       ?? [],
          mood:              cr?.tags?.mood               ?? "contemplative",
        },
      });
    }

    // Save after every batch so interruption loses at most one batch
    fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));

    // Approximate token accounting (~1,200 input + 300 output per batch of 20)
    inputTokens  += 1200;
    outputTokens += Math.min(batch.length * 80, 4000);
  }

  const cost = (inputTokens * 0.80 + outputTokens * 4.0) / 1_000_000;
  console.log(`\n✓ ${results.length} prompts written to data/chalk-prompts.json`);
  console.log(`  Estimated API cost: $${cost.toFixed(4)} (Haiku)`);
  console.log(`\nReview the prompts before running image generation.`);
  console.log(`Image generation script: scripts/generate-chalk-images.js (TBD)`);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
