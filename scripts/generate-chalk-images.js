/**
 * Generate Flux Schnell chalk images from data/chalk-prompts.json
 *
 * Usage:
 *   node scripts/generate-chalk-images.js           # Test: first 10 images (~$0.03)
 *   node scripts/generate-chalk-images.js --all     # All 500 images (~$1.50)
 *
 * Requires: FAL_KEY in .env or shell env
 * Saves:    assets/images/library-v1/<id>-<philosopher-slug>.jpg
 * Updates:  data/chalk-prompts.json       (adds image_path per entry)
 *           assets/images/library-v1/index.json  (pipeline lookup index)
 *
 * Resumable: skips images that already exist on disk.
 */

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// dotenv must run before fal.js is imported — fal.js reads FAL_KEY at module
// init time, so a static import would capture it before dotenv.config() runs.
const __dirname_early = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname_early, "..", ".env") });

const { generateSceneImage } = await import("../src/fal.js");

const ROOT = path.resolve(__dirname_early, "..");

const PROMPTS_PATH = path.join(ROOT, "data", "chalk-prompts.json");
const LIB_DIR      = path.join(ROOT, "assets", "images", "library-v1");
const INDEX_PATH   = path.join(LIB_DIR, "index.json");

const ALL_MODE  = process.argv.includes("--all");
const TEST_COUNT = 10;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // strip accents (René → Rene)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildIndexEntry(entry, relPath, filename) {
  const tags = entry.tags || {};
  return {
    id:               entry.id,
    file:             filename,
    path:             relPath,
    philosopher:      entry.philosopher,
    title:            entry.scene_description,
    idea:             entry.flux_prompt,
    keywords: [
      entry.philosopher.toLowerCase(),
      ...(tags.key_objects || []).map((k) => String(k).toLowerCase()),
      tags.action_verb        || "",
      tags.mood               || "",
      (tags.era               || "").toLowerCase(),
      (tags.school_of_thought || "").toLowerCase(),
    ].filter(Boolean),
    era:               tags.era               || "",
    school_of_thought: tags.school_of_thought || "",
    action_verb:       tags.action_verb       || "",
    mood:              tags.mood              || "",
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.FAL_KEY) {
    console.error("\nERROR: FAL_KEY env var not set.");
    console.error("Add FAL_KEY=your_key to .env or set it in your shell.\n");
    process.exit(1);
  }

  const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8"));
  fs.mkdirSync(LIB_DIR, { recursive: true });

  // Load existing index so we can update it incrementally
  let index = [];
  if (fs.existsSync(INDEX_PATH)) {
    try { index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")); } catch {}
  }
  const indexById = new Map(index.map((e) => [e.id, e]));

  const targets = ALL_MODE ? prompts : prompts.slice(0, TEST_COUNT);
  const modeLabel = ALL_MODE
    ? `all ${prompts.length} images`
    : `first ${TEST_COUNT} images (TEST MODE)`;
  const costEst = (targets.length * 0.003).toFixed(2);

  console.log(`\nFlux Schnell chalk image generator`);
  console.log(`Mode:     ${modeLabel}`);
  console.log(`Cost est: ~$${costEst}`);
  console.log(`Output:   ${LIB_DIR}`);
  console.log(`Images are generated at landscape_16_9 (~1280×720) — pipeline scales as needed.\n`);

  // Count how many are already done
  const alreadyDone = targets.filter((e) => {
    const slug = slugify(e.philosopher);
    return fs.existsSync(path.join(LIB_DIR, `${e.id}-${slug}.jpg`));
  }).length;
  if (alreadyDone > 0) console.log(`Resuming: ${alreadyDone} already on disk, skipping.\n`);

  let generated = 0;
  let skipped   = 0;
  let failed    = 0;
  const startMs = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const entry    = targets[i];
    const slug     = slugify(entry.philosopher);
    const filename = `${entry.id}-${slug}.jpg`;
    const filePath = path.join(LIB_DIR, filename);
    const relPath  = `assets/images/library-v1/${filename}`;
    const prefix   = `  [${i + 1}/${targets.length}] ${entry.id} ${entry.philosopher}`;

    // Resume: skip if file already on disk
    if (fs.existsSync(filePath)) {
      skipped++;
      entry.image_path = relPath;
      if (!indexById.has(entry.id)) {
        indexById.set(entry.id, buildIndexEntry(entry, relPath, filename));
      }
      continue;
    }

    try {
      await generateSceneImage(entry.flux_prompt, filePath);
      entry.image_path = relPath;
      indexById.set(entry.id, buildIndexEntry(entry, relPath, filename));
      generated++;
    } catch (err) {
      // Always print failures immediately
      console.log(`  FAILED [${entry.id}] ${entry.philosopher}: ${err.message.slice(0, 70)}`);
      failed++;
    }

    // Progress summary every 25 generated (and on the last one)
    const done = generated + failed;
    if (done > 0 && (done % 25 === 0 || i === targets.length - 1)) {
      const total   = targets.length;
      const pct     = Math.round(((i + 1) / total) * 100);
      const elapsed = ((Date.now() - startMs) / 60000).toFixed(1);
      console.log(`  --- [${i + 1}/${total}] ${pct}% | gen:${generated} skip:${skipped} fail:${failed} | ${elapsed}min elapsed ---`);
    }

    // Save after every image — losing at most one image on interruption
    const updatedIndex = [...indexById.values()].sort((a, b) => a.id.localeCompare(b.id));
    fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2));
    fs.writeFileSync(INDEX_PATH,   JSON.stringify(updatedIndex, null, 2));
  }

  const finalIndex = [...indexById.values()].sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(INDEX_PATH, JSON.stringify(finalIndex, null, 2));

  console.log(`\n✓ Generated: ${generated}  Skipped: ${skipped}  Failed: ${failed}`);
  console.log(`  chalk-prompts.json — image_path added to each generated entry`);
  console.log(`  index.json         — ${finalIndex.length} entries`);

  if (!ALL_MODE && generated + skipped > 0) {
    const totalCost = (prompts.length * 0.003).toFixed(2);
    console.log(`\nTest complete. Review images in:\n  ${LIB_DIR}`);
    console.log(`\nRun with --all to generate all ${prompts.length} images (~$${totalCost})`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
