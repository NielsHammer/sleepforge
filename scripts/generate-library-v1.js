// Generate the locked image library v1 from philosophy-blackboard-top-100.json
// Style: test10 chalk-on-blackboard (uses each entry's own prompt verbatim —
// they were authored in this style on 2026-04-25).
// Cost: 100 × Flux Schnell @ $0.003 = ~$0.30 total.
// Output:
//   assets/images/library-v1/<id>.png            — one PNG per entry
//   assets/images/library-v1/index.json          — lookup index for the pipeline
//
// Index entries carry the philosopher, idea, title, extracted keyword tags,
// and the absolute file path so the pipeline can pick the closest match for
// any given scene without re-calling Fal.ai.

import "dotenv/config";
import fs from "fs";
import path from "path";
import { generateSceneImage } from "../src/fal.js";

const SRC_JSON = "assets/philosophy-blackboard-top-100.json";
const OUT_DIR = "assets/images/library-v1";
const INDEX_PATH = path.join(OUT_DIR, "index.json");

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","from","by",
  "is","are","was","were","be","been","being","this","that","these","those",
  "as","into","onto","off","over","under","very","just","also","here","there",
  "his","her","their","its","it","he","she","they","them","him",
  "no","not","none","without","while","when","where","what","who","whom",
  "chalk","blackboard","drawing","close","medium","shot","rough","scratchy",
  "white","grey","gray","heavy","dust","visible","smudges","bare","background",
  "text","letters","caption","dark","16:9","landscape",
]);

function extractKeywords(entry) {
  // Pull descriptive nouns/verbs from title + idea + the action portion of prompt
  const action = (entry.prompt || "").replace(/^Dark[^.]*?of /i, "").split(",")[0];
  const text = `${entry.title || ""} ${entry.idea || ""} ${action}`.toLowerCase();
  return [...new Set(
    text
      .replace(/[^a-z0-9'\- ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  )];
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const entries = JSON.parse(fs.readFileSync(SRC_JSON, "utf-8"));
  console.log(`Library v1: ${entries.length} prompts → ${OUT_DIR}`);

  // Resume support: load existing index if present
  const existingIndex = fs.existsSync(INDEX_PATH)
    ? JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"))
    : [];
  const indexById = new Map(existingIndex.map((e) => [e.id, e]));

  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const filename = `${e.id}.png`;
    const filePath = path.join(OUT_DIR, filename);
    const exists = fs.existsSync(filePath) && fs.statSync(filePath).size > 1000;

    const indexEntry = {
      id: e.id,
      type: e.type,
      philosopher: e.philosopher,
      idea: e.idea,
      title: e.title,
      why: e.why,
      keywords: extractKeywords(e),
      file: filename,
      path: filePath,
      prompt: e.prompt,
    };

    if (exists) {
      console.log(`[${i + 1}/${entries.length}] ${e.id}: exists, skipping`);
      indexById.set(e.id, indexEntry);
      okCount++;
    } else {
      const t0 = Date.now();
      try {
        await generateSceneImage(e.prompt, filePath);
        const dt = ((Date.now() - t0) / 1000).toFixed(1);
        const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(0);
        console.log(`[${i + 1}/${entries.length}] ${e.id}: ${sizeKb}KB in ${dt}s — ${e.title}`);
        indexById.set(e.id, indexEntry);
        okCount++;
      } catch (err) {
        console.error(`[${i + 1}/${entries.length}] ${e.id}: FAILED — ${err.message}`);
        failCount++;
      }
    }

    // Persist index after every entry for crash safety
    fs.writeFileSync(
      INDEX_PATH,
      JSON.stringify([...indexById.values()], null, 2)
    );
  }

  console.log(`\nDone. ok=${okCount} fail=${failCount} total=${entries.length}`);
  console.log(`Index: ${INDEX_PATH}`);
  console.log(`Cost: ~$${(okCount * 0.003).toFixed(2)} (Flux Schnell)`);
}

main().catch((err) => {
  console.error("Library generation crashed:", err);
  process.exit(1);
});
