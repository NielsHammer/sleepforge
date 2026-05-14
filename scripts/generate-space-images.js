/**
 * Generate Flux Schnell cinematic space images from data/space-prompts.json
 *
 * Usage:
 *   node scripts/generate-space-images.js           # Test: first 10 images (~$0.03)
 *   node scripts/generate-space-images.js --all     # All 500 images (~$1.50)
 *
 * Requires: FAL_KEY in .env or shell env
 * Saves:    assets/images/space-library-v1/<id>-<category>.jpg
 * Updates:  assets/images/space-library-v1/index.json (pipeline lookup index)
 *
 * Resumable: skips images that already exist on disk.
 */

import fs   from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// dotenv must run before fal.js is imported — fal.js reads FAL_KEY at module init
const __dirname_early = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname_early, "..", ".env") });

const { generateSceneImage } = await import("../src/fal.js");

const ROOT = path.resolve(__dirname_early, "..");

const PROMPTS_PATH = path.join(ROOT, "data", "space-prompts.json");
const LIB_DIR      = path.join(ROOT, "assets", "images", "space-library-v1");
const INDEX_PATH   = path.join(LIB_DIR, "index.json");

const ALL_MODE   = process.argv.includes("--all");
const TEST_COUNT = 10;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildIndexEntry(entry, relPath, filename) {
  return {
    id:          entry.id,
    file:        filename,
    path:        relPath,
    // "philosopher" = primary_subject so lookupLibraryImageRotating's +5 match works
    philosopher: entry.primary_subject,
    title:       entry.scene_description,
    idea:        entry.flux_prompt,
    keywords: [
      entry.primary_subject,
      entry.category.replace(/_/g, "-"),
      ...(entry.tags || []).map((t) => String(t).toLowerCase()),
    ].filter(Boolean),
    category:        entry.category,
    primary_subject: entry.primary_subject,
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.FAL_KEY) {
    console.error("\nERROR: FAL_KEY env var not set.");
    console.error("Add FAL_KEY=your_key to .env or set it in your shell.\n");
    process.exit(1);
  }

  if (!fs.existsSync(PROMPTS_PATH)) {
    console.error(`\nERROR: ${PROMPTS_PATH} not found.`);
    console.error("Run: node scripts/generate-space-prompts.js\n");
    process.exit(1);
  }

  const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8"));
  fs.mkdirSync(LIB_DIR, { recursive: true });

  // Load existing index for incremental updates
  let index = [];
  if (fs.existsSync(INDEX_PATH)) {
    try { index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8")); } catch {}
  }
  const indexById = new Map(index.map((e) => [e.id, e]));

  const targets   = ALL_MODE ? prompts : prompts.slice(0, TEST_COUNT);
  const modeLabel = ALL_MODE
    ? `all ${prompts.length} images`
    : `first ${TEST_COUNT} images (TEST MODE)`;
  const costEst   = (targets.length * 0.003).toFixed(2);

  console.log(`\nFlux Schnell space image generator`);
  console.log(`Mode:     ${modeLabel}`);
  console.log(`Cost est: ~$${costEst}`);
  console.log(`Output:   ${LIB_DIR}`);
  console.log(`Images are generated at landscape_16_9 (~1280×720) — pipeline scales as needed.\n`);

  // Count already done for resume report
  const alreadyDone = targets.filter((e) =>
    fs.existsSync(path.join(LIB_DIR, `${e.id}-${slugify(e.category)}.jpg`))
  ).length;
  if (alreadyDone > 0) console.log(`Resuming: ${alreadyDone} already on disk, skipping.\n`);

  let generated = 0;
  let skipped   = 0;
  let failed    = 0;
  const startMs = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const entry    = targets[i];
    const catSlug  = slugify(entry.category);
    const filename = `${entry.id}-${catSlug}.jpg`;
    const filePath = path.join(LIB_DIR, filename);
    const relPath  = `assets/images/space-library-v1/${filename}`;

    // Resume: skip if already on disk
    if (fs.existsSync(filePath)) {
      skipped++;
      if (!indexById.has(entry.id)) {
        indexById.set(entry.id, buildIndexEntry(entry, relPath, filename));
      }
      continue;
    }

    try {
      await generateSceneImage(entry.flux_prompt, filePath);
      indexById.set(entry.id, buildIndexEntry(entry, relPath, filename));
      generated++;
    } catch (err) {
      console.log(`  FAILED [${entry.id}] ${entry.primary_subject}: ${err.message.slice(0, 70)}`);
      failed++;
    }

    // Progress every 25 and on final
    const done = generated + failed;
    if (done > 0 && (done % 25 === 0 || i === targets.length - 1)) {
      const total   = targets.length;
      const pct     = Math.round(((i + 1) / total) * 100);
      const elapsed = ((Date.now() - startMs) / 60000).toFixed(1);
      console.log(`  --- [${i + 1}/${total}] ${pct}% | gen:${generated} skip:${skipped} fail:${failed} | ${elapsed}min elapsed ---`);
    }

    // Save index after every image — lose at most one on interruption
    const updatedIndex = [...indexById.values()].sort((a, b) => a.id.localeCompare(b.id));
    fs.writeFileSync(INDEX_PATH, JSON.stringify(updatedIndex, null, 2));
  }

  const finalIndex = [...indexById.values()].sort((a, b) => a.id.localeCompare(b.id));
  fs.writeFileSync(INDEX_PATH, JSON.stringify(finalIndex, null, 2));

  console.log(`\n✓ Generated: ${generated}  Skipped: ${skipped}  Failed: ${failed}`);
  console.log(`  index.json — ${finalIndex.length} entries`);

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
