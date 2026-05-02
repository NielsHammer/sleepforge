// V4 — pitch-dark night cozy vibe, hard-locked tripod camera.
// Tricks vs v3: aggressive negative_prompt, raised cfg_scale, prompt repeats
// the static-camera rule at top + middle + end, scene anchored as "night"
// with moon + stars out the window so Kling can't drift toward daylight.

import "dotenv/config";
import axios from "axios";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const FAL_KEY = process.env.FAL_KEY;

const PROMPT = [
  "FIXED TRIPOD SHOT. LOCKED-OFF CAMERA. The camera does not move at all during the entire 10 seconds. No panning, no tilting, no zooming, no dollying, no tracking, no parallax, no handheld shake. The camera is bolted to the floor and sees the same exact frame from frame 1 to frame 240.",
  "",
  "Scene: a small, cozy, ancient Greek philosopher's study at deep night. Pitch black overall. The frame is roughly 90% pure black with only one small warm pool of light.",
  "",
  "On the right, a low stone hearth with a small dying fire — embers glowing deep red and orange, flames tiny and lazy, gently flickering in place. The fire is the only meaningful light source in the room.",
  "",
  "On the wooden desk in the middle, an open scroll with quill resting on it, a small leather-bound book, and a tiny clay oil lamp with a single low flame, barely lit.",
  "",
  "On the left, a tall narrow arched window opens onto a deep night sky. The moon is hidden but its faint cool silver glow falls in a thin sliver onto the stone floor. Distant stars twinkle slowly outside. Heavy dark drapes hang on either side of the window, breathing very gently in a soft draft.",
  "",
  "A single potted olive branch in the deep shadow beside the desk, its leaves trembling almost imperceptibly.",
  "",
  "Wisps of smoke rise slowly from the hearth, curling and dissipating into the dark air. Fine dust particles drift through the lamp's tiny glow.",
  "",
  "STILLNESS. The architecture, columns, shelves, walls, desk, books, scrolls, floor — all completely still and motionless. Nothing in the architecture moves. Nothing in the framing moves. Only these elements may move and only subtly: the fire flame flicker, the rising smoke, the slow drape sway, the tiny leaf tremble, the slow star twinkle.",
  "",
  "AGAIN: the camera itself is absolutely stationary. The frame composition is identical from start to end. Tripod-locked. No camera movement of any kind.",
  "",
  "Mood: cozy, contemplative, mysterious, deep night, secret philosophical sanctuary. Cinematic, ultra detailed, dark moody color grade, near-pitch-black palette with a single warm amber accent from the dying fire and the lamp. Heavy underexposure. ISO 100 feel. Almost monochrome. No people. Quiet.",
].join("\n");

const NEGATIVE_PROMPT = [
  "camera movement", "camera pan", "camera tilt", "camera zoom", "camera tracking",
  "camera dolly", "handheld shake", "parallax", "moving camera", "rotating camera",
  "daylight", "sunlight", "bright sunlight", "morning light", "noon light",
  "harsh light", "overexposed", "bright scene", "high key lighting", "blown highlights",
  "lens flare", "people", "person", "figure", "human", "silhouette of person",
  "saturated colors", "vivid colors", "rainbow", "neon",
  "moving walls", "moving columns", "warping architecture",
  "modern objects", "phones", "computers", "cars",
  "text", "writing", "letters", "captions", "subtitles",
].join(", ");

const OUT_DIR = "engine/remotion/backgrounds/marcus-aurelius-night";
const SOURCE_PATH = path.join(OUT_DIR, "bg-source-v4.mp4");
const FINAL_PATH = path.join(OUT_DIR, "bg-v4.mp4");

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

async function tryGenerate() {
  const modelPath = "fal-ai/kling-video/v1.6/standard/text-to-video";
  console.log(`\n→ Trying: Kling v1.6 Standard t2v (high cfg_scale, with negative_prompt)`);
  console.log(`  Prompt length: ${PROMPT.length} chars`);
  console.log(`  Negative prompt: ${NEGATIVE_PROMPT.length} chars`);
  const sub = await submitToQueue(modelPath, {
    prompt: PROMPT,
    negative_prompt: NEGATIVE_PROMPT,
    duration: "10",
    aspect_ratio: "16:9",
    cfg_scale: 0.85,
  });
  console.log(`  Submitted: ${sub.request_id}`);
  const result = await pollForResult(sub.status_url, sub.response_url, 900);
  const url = result?.video?.url;
  if (!url) throw new Error("No video URL in result");
  console.log(`  Video URL: ${url}`);
  console.log(`  Downloading to ${SOURCE_PATH}...`);
  await downloadTo(url, SOURCE_PATH);
  console.log(`  Downloaded: ${(fs.statSync(SOURCE_PATH).size / 1024).toFixed(0)} KB`);
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
  if (process.env.SKIP_GEN === "1" && fs.existsSync(SOURCE_PATH)) {
    console.log(`SKIP_GEN=1 — reusing existing ${SOURCE_PATH}`);
  } else {
    await tryGenerate();
  }
  buildPalindromeLoop(SOURCE_PATH, FINAL_PATH);

  const finalSizeMb = (fs.statSync(FINAL_PATH).size / 1024 / 1024).toFixed(2);
  const finalDur = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`,
    { encoding: "utf-8" }
  ).trim();

  console.log(`\nDone.`);
  console.log(`  Source: ${SOURCE_PATH}`);
  console.log(`  Loop:   ${FINAL_PATH} (${finalSizeMb} MB, ${finalDur}s)`);
  console.log(`  Note:   bg.mp4 NOT replaced — pending approval`);
  console.log(`  View:   http://157.180.124.232:8080/${FINAL_PATH}`);
}

main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
