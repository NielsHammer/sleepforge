// V3 — even darker, static camera, motion only in atmospheric elements.

import "dotenv/config";
import axios from "axios";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const FAL_KEY = process.env.FAL_KEY;
const PROMPT =
  "static locked-off camera shot, no camera movement, no zoom, no pan, no tracking. " +
  "Dark philosophical sanctuary at night, almost pitch black, deep velvety shadows fill 90 percent of the frame. " +
  "Ancient Greek philosopher's study lit only by a tiny dying fire on a stone hearth on the right and a single small oil lamp on a wooden desk on the left. " +
  "On the desk, an open scroll, a quill, and a worn leather book. " +
  "Tall heavy black drapes hanging beside a narrow arched window high on the back wall, gently breathing in a faint draft. " +
  "Through the window, a deep night sky with slowly twinkling distant stars. " +
  "A single potted olive branch in shadow, leaves trembling almost imperceptibly. " +
  "Wisps of smoke rising slowly from the fire, curling into the dark air. " +
  "Faint flicker of orange-amber on the nearest column, the rest of the scene swallowed by shadow. " +
  "Dust particles drifting through the lamp's small glow. " +
  "Nothing else moves. The architecture, columns, shelves, walls — completely still, as if frozen in time. " +
  "Cinematic, ultra detailed, dark moody color grade, desaturated near-black palette with a single warm amber accent. " +
  "Profound stillness, contemplative, mysterious, no people, no motion in the camera or environment except: fire flicker, smoke, drape sway, leaf tremble, star twinkle.";

const OUT_DIR = "engine/remotion/backgrounds/marcus-aurelius-night";
const SOURCE_PATH = path.join(OUT_DIR, "bg-source-v3.mp4");
const FINAL_PATH = path.join(OUT_DIR, "bg-v3.mp4");

if (!FAL_KEY) { console.error("FAL_KEY missing"); process.exit(1); }

async function submitToQueue(modelPath, body) {
  const r = await axios.post(`https://queue.fal.run/${modelPath}`, body, {
    headers: { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" },
    timeout: 30000,
  });
  return r.data;
}

async function pollForResult(statusUrl, responseUrl, maxWaitSec = 900) {
  const started = Date.now();
  let lastStatus = "";
  while ((Date.now() - started) / 1000 < maxWaitSec) {
    const r = await axios.get(statusUrl, {
      headers: { Authorization: `Key ${FAL_KEY}` }, timeout: 15000,
    });
    const s = r.data.status;
    if (s !== lastStatus) {
      console.log(`  [${((Date.now() - started) / 1000).toFixed(0)}s] status: ${s}`);
      lastStatus = s;
    }
    if (s === "COMPLETED") {
      const final = await axios.get(responseUrl, {
        headers: { Authorization: `Key ${FAL_KEY}` }, timeout: 15000,
      });
      return final.data;
    }
    if (s === "FAILED" || s === "CANCELLED") {
      throw new Error(`Job ${s}: ${JSON.stringify(r.data).slice(0, 300)}`);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`Timed out after ${maxWaitSec}s`);
}

async function downloadTo(url, outPath) {
  const r = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
  fs.writeFileSync(outPath, Buffer.from(r.data));
}

const ATTEMPTS = [
  {
    name: "Kling v1.6 Standard t2v",
    modelPath: "fal-ai/kling-video/v1.6/standard/text-to-video",
    body: { prompt: PROMPT, duration: "10", aspect_ratio: "16:9" },
    pickVideoUrl: (data) => data?.video?.url,
  },
];

async function tryGenerate() {
  for (const a of ATTEMPTS) {
    console.log(`\n→ Trying: ${a.name}`);
    const sub = await submitToQueue(a.modelPath, a.body);
    console.log(`  Submitted: ${sub.request_id}`);
    const result = await pollForResult(sub.status_url, sub.response_url, 900);
    const url = a.pickVideoUrl(result);
    if (!url) throw new Error("No video URL in result");
    console.log(`  Video URL: ${url}`);
    console.log(`  Downloading to ${SOURCE_PATH}...`);
    await downloadTo(url, SOURCE_PATH);
    console.log(`  Downloaded: ${(fs.statSync(SOURCE_PATH).size / 1024).toFixed(0)} KB`);
    return { model: a.name };
  }
  throw new Error("All attempts failed");
}

function buildPalindromeLoop(srcPath, outPath, xfade = 0.5) {
  const dur = parseFloat(execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${srcPath}"`,
    { encoding: "utf-8" }
  ).trim());
  console.log(`  Source duration: ${dur.toFixed(2)}s`);
  if (!isFinite(dur) || dur < 1) throw new Error(`Invalid duration ${dur}`);

  const offset = dur - xfade;
  const filter =
    `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,` +
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x000000,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[fwd];` +
    `[1:v]reverse,scale=1920:1080:force_original_aspect_ratio=decrease,` +
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x000000,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[rev];` +
    `[fwd][rev]xfade=transition=fade:duration=${xfade}:offset=${offset.toFixed(2)}[vout]`;

  console.log(`  Building palindrome loop (xfade=${xfade}s, total≈${(2 * dur - xfade).toFixed(1)}s)...`);
  execSync(
    `ffmpeg -y -i "${srcPath}" -i "${srcPath}" -filter_complex "${filter}" ` +
    `-map "[vout]" -an -c:v libx264 -preset slow -crf 20 -movflags +faststart "${outPath}"`,
    { stdio: "inherit", timeout: 1800000 }
  );
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let modelUsed = null;
  if (process.env.SKIP_GEN === "1" && fs.existsSync(SOURCE_PATH)) {
    console.log(`SKIP_GEN=1 — reusing existing ${SOURCE_PATH}`);
    modelUsed = "(cached)";
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
  console.log(`  Note:   bg.mp4 NOT replaced — pending approval`);
  console.log(`  View:   http://157.180.124.232:8080/${FINAL_PATH}`);
}

main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
