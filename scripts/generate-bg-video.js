// Generate a 10-second seamless-loop background video for the Greek library
// scene using Fal.ai. Tries Kling v1.6 → MiniMax → Runway Gen3 in order, then
// post-processes the result into a palindrome loop (forward + reverse, with
// crossfade at the seam) and writes it to bg.mp4.
//
// Cost note: Kling v1.6 standard t2v ~$0.05/sec ≈ $0.50 for 10s.
//            MiniMax Hailuo-02 standard ~$0.045/sec ≈ $0.45 for 10s.

import "dotenv/config";
import axios from "axios";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const FAL_KEY = process.env.FAL_KEY;
const PROMPT =
  "dark ancient Greek library interior at night, massive stone Ionic columns, " +
  "hundreds of ancient scrolls on stone shelves, warm candlelight flickering on " +
  "weathered stone walls, dust particles floating in candlelight beams, " +
  "atmospheric fog at floor level, cinematic, ultra detailed, no people, seamless loop";

const OUT_DIR = "engine/remotion/backgrounds/marcus-aurelius-night";
const SOURCE_PATH = path.join(OUT_DIR, "bg-source.mp4");
const FINAL_PATH = path.join(OUT_DIR, "bg.mp4");

if (!FAL_KEY) {
  console.error("FAL_KEY missing in env");
  process.exit(1);
}

// ─── Async queue submission helper ──────────────────────────────────────────
async function submitToQueue(modelPath, body) {
  const submitUrl = `https://queue.fal.run/${modelPath}`;
  const resp = await axios.post(submitUrl, body, {
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    timeout: 30000,
  });
  return resp.data; // { request_id, status_url, response_url }
}

async function pollForResult(statusUrl, responseUrl, maxWaitSec = 600) {
  const started = Date.now();
  let lastStatus = "";
  while ((Date.now() - started) / 1000 < maxWaitSec) {
    try {
      const r = await axios.get(statusUrl, {
        headers: { Authorization: `Key ${FAL_KEY}` },
        timeout: 15000,
      });
      const s = r.data.status;
      if (s !== lastStatus) {
        const elapsed = ((Date.now() - started) / 1000).toFixed(0);
        console.log(`  [${elapsed}s] status: ${s}`);
        lastStatus = s;
      }
      if (s === "COMPLETED") {
        const final = await axios.get(responseUrl, {
          headers: { Authorization: `Key ${FAL_KEY}` },
          timeout: 15000,
        });
        return final.data;
      }
      if (s === "FAILED" || s === "CANCELLED") {
        throw new Error(`Job ${s}: ${JSON.stringify(r.data).slice(0, 200)}`);
      }
    } catch (err) {
      if (err.response) {
        throw new Error(`status poll ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 200)}`);
      }
      throw err;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`Timed out after ${maxWaitSec}s`);
}

async function downloadTo(url, outPath) {
  const r = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
  fs.writeFileSync(outPath, Buffer.from(r.data));
}

// ─── Model attempts ─────────────────────────────────────────────────────────
const ATTEMPTS = [
  {
    name: "Kling v1.6 Standard t2v",
    modelPath: "fal-ai/kling-video/v1.6/standard/text-to-video",
    body: { prompt: PROMPT, duration: "10", aspect_ratio: "16:9" },
    pickVideoUrl: (data) => data?.video?.url,
  },
  {
    name: "MiniMax Hailuo-02 Standard",
    modelPath: "fal-ai/minimax/hailuo-02/standard/text-to-video",
    body: { prompt: PROMPT, duration: "10", prompt_optimizer: true },
    pickVideoUrl: (data) => data?.video?.url,
  },
  {
    name: "Kling v1.5 Pro t2v",
    modelPath: "fal-ai/kling-video/v1.5/pro/text-to-video",
    body: { prompt: PROMPT, duration: "10", aspect_ratio: "16:9" },
    pickVideoUrl: (data) => data?.video?.url,
  },
];

async function tryGenerate() {
  for (const a of ATTEMPTS) {
    console.log(`\n→ Trying: ${a.name}`);
    try {
      const submission = await submitToQueue(a.modelPath, a.body);
      console.log(`  Submitted: ${submission.request_id}`);
      const result = await pollForResult(submission.status_url, submission.response_url, 900);
      const videoUrl = a.pickVideoUrl(result);
      if (!videoUrl) {
        console.log(`  No video URL in result: ${JSON.stringify(result).slice(0, 200)}`);
        continue;
      }
      console.log(`  Video URL: ${videoUrl}`);
      console.log(`  Downloading to ${SOURCE_PATH}...`);
      await downloadTo(videoUrl, SOURCE_PATH);
      const sizeKb = (fs.statSync(SOURCE_PATH).size / 1024).toFixed(0);
      console.log(`  Downloaded: ${sizeKb} KB`);
      return { model: a.name };
    } catch (err) {
      const detail = err.response
        ? `${err.response.status} ${JSON.stringify(err.response.data).slice(0, 200)}`
        : err.message;
      console.log(`  ✗ ${a.name} failed: ${detail}`);
    }
  }
  throw new Error("All video generation attempts failed");
}

// ─── Palindrome seamless loop ───────────────────────────────────────────────
// Forward (with fadeout overlap) + reverse (with fadein overlap) crossfaded.
// The reverse half plays the source backward, so the audio/visual of the seam
// is the same frame mirrored — invisible loop boundary.
function buildPalindromeLoop(sourcePath, outPath, opts = {}) {
  const xfade = opts.xfade || 0.5; // seconds overlap at the seam

  // Probe duration
  const dur = parseFloat(
    execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${sourcePath}"`,
      { encoding: "utf-8" }
    ).trim()
  );
  console.log(`  Source duration: ${dur.toFixed(2)}s`);
  if (!isFinite(dur) || dur < 1) throw new Error(`Invalid source duration ${dur}`);

  const fwdLen = dur;          // forward half length
  const offset = fwdLen - xfade; // when xfade between forward and reverse begins

  // Filter graph:
  //   [0:v] -> forward, fps=30, scaled
  //   [1:v] (same source) -> reverse, fps=30, scaled
  //   xfade(forward, reverse, duration=xfade, offset=fwdLen-xfade)
  //
  // Two -i passes are required because xfade needs both branches available
  // simultaneously and reversing requires a separate decode.
  const filter =
    `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,` +
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x000000,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[fwd];` +
    `[1:v]reverse,scale=1920:1080:force_original_aspect_ratio=decrease,` +
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x000000,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[rev];` +
    `[fwd][rev]xfade=transition=fade:duration=${xfade}:offset=${offset.toFixed(2)}[vout]`;

  console.log(`  Building palindrome loop (xfade=${xfade}s, total≈${(2 * dur - xfade).toFixed(1)}s)...`);
  execSync(
    `ffmpeg -y -i "${sourcePath}" -i "${sourcePath}" -filter_complex "${filter}" ` +
    `-map "[vout]" -an -c:v libx264 -preset slow -crf 20 -movflags +faststart "${outPath}"`,
    { stdio: "inherit", timeout: 1800000 }
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const skipGen = process.env.SKIP_GEN === "1" && fs.existsSync(SOURCE_PATH);
  let modelUsed = null;
  if (skipGen) {
    console.log(`SKIP_GEN=1 — reusing existing ${SOURCE_PATH}`);
    modelUsed = "(cached source)";
  } else {
    const r = await tryGenerate();
    modelUsed = r.model;
  }

  buildPalindromeLoop(SOURCE_PATH, FINAL_PATH);

  const finalSizeMb = (fs.statSync(FINAL_PATH).size / 1024 / 1024).toFixed(2);
  const finalDur = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`,
    { encoding: "utf-8" }
  ).trim();

  console.log(`\nDone.`);
  console.log(`  Model: ${modelUsed}`);
  console.log(`  Source: ${SOURCE_PATH}`);
  console.log(`  Loop:   ${FINAL_PATH} (${finalSizeMb} MB, ${finalDur}s)`);
  console.log(`  View:   http://157.180.124.232:8080/${FINAL_PATH}`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
