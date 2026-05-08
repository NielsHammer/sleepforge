/**
 * SleepForge auto-publish pipeline — fire and forget.
 *
 * Usage:
 *   node scripts/auto-publish.js \
 *     --topic "Epictetus on Inner Freedom" \
 *     --channel sleepless-philosophers \
 *     [--duration 120]          # minutes, default 2
 *     [--schedule "2026-05-10T08:00:00"]  # default: tomorrow 8am local
 *     [--privacy public|private|unlisted] # default: private (review before publish)
 *     [--no-thumbnail]          # skip thumbnail generation
 *     [--dry-run]               # pipeline only, skip YouTube upload
 *
 * Pipeline:
 *   1. Generate video  (spawns test-video-2min.js with SLEEPFORGE_TOPIC/SLUG env)
 *   2. Generate thumbnail (thumbnail-v3)
 *   3. Generate YouTube metadata (Haiku, SEO-optimised)
 *   4. Upload video + thumbnail to YouTube
 *   5. Log video ID + scheduled publish time
 */

import { spawn }      from "child_process";
import fs             from "fs";
import path           from "path";
import { fileURLToPath } from "url";
import dotenv         from "dotenv";

// ─── JARVIS STATE HELPER ─────────────────────────────────────────────────────

const JARVIS_STATE = path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\//,''))), 'jarvis', 'state.json');

function jarvisUpdate(jobId, patch) {
  if (!jobId) return;
  try {
    const stateFile = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname.slice(process.platform==='win32'?1:0)),'..'), 'jarvis', 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const idx   = state.renders.findIndex(r => r.id === jobId);
    if (idx >= 0) Object.assign(state.renders[idx], patch, { updatedAt: new Date().toISOString() });
    state.last_updated = new Date().toISOString();
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch { /* Jarvis not running — that's fine */ }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

// Dynamic imports after dotenv
const { generateMetadata }    = await import("../src/youtube-metadata-generator.js");
const { uploadVideo, uploadThumbnail } = await import("../src/youtube.js");
const { generateThumbnailV3 } = await import("../src/thumbnail-v3.js");

// ─── ARG PARSING ─────────────────────────────────────────────────────────────

function parseArgs() {
  const args  = process.argv.slice(2);
  const opts  = {
    topic:       null,
    channel:     null,
    duration:    2,
    schedule:    null,          // ISO string or null → tomorrow 8am
    noSchedule:  false,         // --no-schedule: upload immediately, no publishAt
    privacy:     "private",
    thumbnail:   true,
    dryRun:      false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--topic":       opts.topic     = args[++i]; break;
      case "--channel":     opts.channel   = args[++i]; break;
      case "--duration":    opts.duration  = parseInt(args[++i], 10); break;
      case "--schedule":    opts.schedule  = args[++i]; break;
      case "--no-schedule": opts.noSchedule = true;     break;
      case "--privacy":     opts.privacy   = args[++i]; break;
      case "--no-thumbnail":opts.thumbnail = false;     break;
      case "--dry-run":     opts.dryRun    = true;      break;
    }
  }
  return opts;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function tomorrowAt8am() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

function log(msg) { console.log(msg); }

// Run a subprocess, stream its output, resolve when done.
function runScript(scriptPath, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [scriptPath],
      {
        stdio: ["ignore", "inherit", "inherit"],
        env: { ...process.env, ...env },
        cwd: ROOT,
      }
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited ${code}`));
    });
    child.on("error", reject);
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (!opts.topic) {
    console.error("\nUsage: node scripts/auto-publish.js --topic \"...\" --channel <slug>\n");
    process.exit(1);
  }
  if (!opts.channel && !opts.dryRun) {
    console.error("\n--channel is required unless --dry-run is set.\n");
    process.exit(1);
  }

  const slug      = slugify(opts.topic);
  const outputDir = path.join(ROOT, "output", slug);
  const videoPath = path.join(outputDir, "final.mp4");
  const thumbDir  = path.join(outputDir, "thumbnail");
  const scriptJsonPath = path.join(ROOT, "scripts", `${slug}.json`);

  const scheduledAt = opts.noSchedule ? null : (opts.schedule || tomorrowAt8am());

  log("\n╔══════════════════════════════════════════╗");
  log("║   SleepForge Auto-Publish Pipeline        ║");
  log("╚══════════════════════════════════════════╝");
  log(`  Topic:    ${opts.topic}`);
  log(`  Channel:  ${opts.channel || "(dry-run, no upload)"}`);
  log(`  Schedule: ${scheduledAt ? new Date(scheduledAt).toLocaleString() : "immediate (no schedule)"}`);
  log(`  Output:   ${outputDir}\n`);

  const jobId = process.env.JARVIS_JOB_ID || null;

  // ── Step 1: Generate video ─────────────────────────────────────────────────
  if (fs.existsSync(videoPath)) {
    log("── Step 1: Video already exists, skipping render ──");
    log(`   ${videoPath}`);
    jarvisUpdate(jobId, { step: 'Video cached', progress: 40 });
  } else {
    log("── Step 1: Rendering video ──");
    jarvisUpdate(jobId, { step: 'Rendering video', progress: 10, status: 'rendering' });
    await runScript(path.join(ROOT, "scripts", "test-video-2min.js"), {
      SLEEPFORGE_TOPIC:    opts.topic,
      SLEEPFORGE_SLUG:     slug,
      SLEEPFORGE_DURATION: String(opts.duration),
    });
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video render completed but ${videoPath} not found.`);
    }
    log(`  ✓ Video: ${videoPath}`);
  }

  // ── Step 2: Load script scenes for metadata ────────────────────────────────
  let scenes = [];
  if (fs.existsSync(scriptJsonPath)) {
    scenes = JSON.parse(fs.readFileSync(scriptJsonPath, "utf-8"));
  }

  // ── Step 3: Generate thumbnail ─────────────────────────────────────────────
  let thumbnailPath = null;
  if (opts.thumbnail) {
    log("\n── Step 2: Generating thumbnail ──");
    jarvisUpdate(jobId, { step: 'Generating thumbnail', progress: 45 });
    const existingThumb = path.join(thumbDir, "thumbnail-final.png");
    if (fs.existsSync(existingThumb)) {
      thumbnailPath = existingThumb;
      log(`  Cached: ${thumbnailPath}`);
    } else {
      try {
        const scriptText = scenes.map((s) => s.narration || "").join("\n\n");
        thumbnailPath = await generateThumbnailV3({
          outputDir: thumbDir,
          title:      opts.topic,
          scriptText,
          niche:      "philosophy",
          tone:       "calm, meditative, philosophical",
        });
        log(`  ✓ Thumbnail: ${thumbnailPath}`);
      } catch (err) {
        log(`  Thumbnail failed (${err.message}) — continuing without it`);
      }
    }
  }

  // ── Step 4: Generate metadata ──────────────────────────────────────────────
  log("\n── Step 3: Generating YouTube metadata ──");
  jarvisUpdate(jobId, { step: 'Generating metadata', progress: 65 });
  const meta = await generateMetadata(opts.topic, scenes);
  log(`  Title:  ${meta.title}`);
  log(`  Tags:   ${meta.tags.slice(0, 5).join(", ")}… (${meta.tags.length} total)`);

  // Save metadata alongside video for reference
  fs.writeFileSync(
    path.join(outputDir, "youtube-metadata.json"),
    JSON.stringify({ ...meta, scheduledAt, channel: opts.channel }, null, 2)
  );

  // ── Step 5: Upload ─────────────────────────────────────────────────────────
  if (opts.dryRun) {
    log("\n── Dry run — skipping upload ──");
    log("  Metadata saved to: " + path.join(outputDir, "youtube-metadata.json"));
    log("  Video ready at:    " + videoPath);
    return;
  }

  log("\n── Step 4: Uploading to YouTube ──");
  jarvisUpdate(jobId, { step: 'Uploading to YouTube', progress: 75, status: 'uploading' });
  const videoId = await uploadVideo({
    channelName:   opts.channel,
    videoPath,
    title:         meta.title,
    description:   meta.description,
    tags:          meta.tags,
    thumbnailPath,
    scheduledAt,
    privacyStatus: opts.privacy,
  });

  jarvisUpdate(jobId, { step: 'Published', progress: 100, status: 'done', videoId, videoUrl: `https://youtube.com/watch?v=${videoId}` });

  // Persist videoId back to metadata file so Jarvis can read it
  fs.writeFileSync(
    path.join(outputDir, "youtube-metadata.json"),
    JSON.stringify({ ...meta, scheduledAt, channel: opts.channel, videoId }, null, 2)
  );

  log("\n╔══════════════════════════════════════════╗");
  log("║   ✅ Published!                            ║");
  log("╚══════════════════════════════════════════╝");
  log(`  Video ID:  ${videoId}`);
  log(`  URL:       https://www.youtube.com/watch?v=${videoId}`);
  log(`  Studio:    https://studio.youtube.com/video/${videoId}/edit`);
  log(`  Scheduled: ${new Date(scheduledAt).toLocaleString()}`);
  log(`  Channel:   ${opts.channel}`);
}

main().catch((err) => {
  console.error("\n✗ Fatal:", err.message);
  process.exit(1);
});
