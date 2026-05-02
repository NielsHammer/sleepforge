import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { callClaudeCLI } from "./claude-cli.js";

// ─── Human feedback agent ───────────────────────────────────────────────────
//
// Auto-reviews a finished video against the channel vision rules. Extracts
// 6 evenly-spaced frames from final.mp4, ships them through the Claude CLI
// (vision-enabled in -p mode via `--add-dir`), and gets back a structured
// JSON critique. The critique gets rendered into a feedback.html page that
// lives next to the preview and is linked from the index.

const FEEDBACK_MODEL = "claude-sonnet-4-6"; // Vision quality matters more than speed

const VISION_RULES = `
SLEEPFORGE CHANNEL VISION — what each video should be:

1. AESTHETIC (current design, May 2026)
   - The chalk-on-blackboard image fills the FULL 1920x1080 frame.
   - There is NO Greek library background, NO bg.mp4, NO wooden chalkboard surround.
     Pure chalk-on-dark style edge-to-edge. The frame IS the chalk drawing.
   - Drifting white particles and atmospheric smoke are screen-blended on top of
     the image (this is intentional, adds chalk-dust feel — not a defect).
   - No pink/magenta/purple tint anywhere (known bug, must verify it stays fixed).
   - Subtitles: white, centered bottom, karaoke-style word highlight.

2. IMAGE FIT
   - The chalk image must show what the narrator is saying at that moment.
   - Wrong-culture leaks (Asian calligraphy, modern objects, photorealism, marble
     statue renders instead of chalk) are critical fails.
   - Abstract chalk smears with no recognizable subject = critical fail.
   - Same philosopher should have a consistent recognizable face/silhouette across frames.
   - Images should not be so dark that the figure is barely visible.

3. PACING
   - Sleep-tempo: slow, calm, natural pauses between sentences.
   - Image dwell ~3-5 seconds per scene with 0.6s xfade between.

4. SUBTITLE QUALITY
   - One short phrase visible at a time (~4 words), centered bottom.
   - NEVER truncated mid-word — text must fit the safe zone.
   - White text only. No pink/magenta bleed.
   - Karaoke chalk-write style: the active word is opaque white, already-spoken AND
     upcoming words in the SAME phrase are rendered as faintly-dimmed chalk-grey
     ghost-preview. This is intentional — do NOT flag dim/grey past or upcoming
     words as "strikethrough", "broken", "corrupted", or "incomplete".
   - A minor ASR transcription glitch in a single word (e.g. "defeated" → "defyred")
     is a known low-severity Whisper ASR issue. Flag it, but minor severity, not critical.
   - A frame with NO subtitle visible may simply have caught a between-sentence pause
     (350-700ms silence pads between sentences). Only flag this as critical if you can
     hear narration but see no caption.

5. THUMBNAIL
   - Chalk-on-dark, single philosopher portrait, clickable for YouTube.

NOT bugs (do not flag):
- Plain dark/black background — that's the new full-screen image design.
- No wooden chalkboard frame around the image — that's been removed.
- Drifting particles or smoke — that's the intentional top-layer overlay.`;

function extractFrames(videoPath, outDir, count = 6) {
  const duration = parseFloat(
    execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`)
      .toString().trim()
  );
  fs.mkdirSync(outDir, { recursive: true });
  const framePaths = [];
  // Spread frames evenly, avoiding the very edges
  for (let i = 0; i < count; i++) {
    const t = duration * ((i + 0.5) / count);
    const out = path.join(outDir, `frame-${i}.jpg`);
    execSync(
      `ffmpeg -y -ss ${t.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 2 "${out}" 2>/dev/null`,
      { stdio: "pipe" }
    );
    framePaths.push({ path: out, time: t });
  }
  return { framePaths, duration };
}

function buildCritiquePrompt(framePaths, topic, metadata) {
  const frameList = framePaths
    .map((f, i) => `Frame ${i + 1} at ${f.time.toFixed(0)}s — absolute path: ${path.resolve(f.path)}`)
    .join("\n");
  return `You are reviewing a finished SleepForge video as the channel's quality reviewer.

VIDEO TOPIC: ${topic}
TITLE: ${metadata?.title || "—"}

${VISION_RULES}

INSTRUCTIONS:
1. Use the Read tool to read EACH of these frame images one by one:
${frameList}

2. After viewing all frames, write a structured JSON critique below.

Be honest and specific. Frame indices are 0-based.

Output format:
{
  "overall": "<one-sentence verdict>",
  "score": <1-10 integer>,
  "issues": [
    { "frame": <0-based index>, "severity": "critical|major|minor", "what": "<what you see>", "why": "<why it's wrong>", "fix": "<concrete suggestion>" }
  ],
  "wins": ["<things that work well>"],
  "next_priorities": ["<top 3 things to fix next>"]
}

After reading the frames, return ONLY the JSON object. No preamble, no markdown fences.`;
}

export async function reviewVideo({ videoPath, topic, metadata, outputDir }) {
  console.log(`\n  Feedback agent reviewing ${videoPath}...`);
  const t0 = Date.now();

  const framesDir = path.join(outputDir, "feedback-frames");
  const { framePaths, duration } = extractFrames(videoPath, framesDir, 6);
  console.log(`  Extracted ${framePaths.length} frames over ${duration.toFixed(0)}s`);

  const prompt = buildCritiquePrompt(framePaths, topic, metadata);

  let raw;
  try {
    raw = await callClaudeCLI(prompt, {
      model: FEEDBACK_MODEL,
      timeoutMs: 360000,
      tools: "Read",
      allowedTools: "Read",
      addDirs: [path.resolve(framesDir)],
    });
  } catch (err) {
    console.error(`  Feedback agent failed: ${err.message}`);
    return null;
  }

  const text = raw.replace(/^```(?:json)?\s*/gm, "").replace(/```\s*$/gm, "").trim();
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (err) {
    console.error(`  Feedback JSON parse failed: ${err.message}`);
    fs.writeFileSync(path.join(outputDir, "feedback-raw.txt"), text);
    return null;
  }

  parsed._meta = {
    framePaths: framePaths.map((f) => ({ path: path.relative(outputDir, f.path), time: f.time })),
    duration,
    elapsedSec: ((Date.now() - t0) / 1000).toFixed(1),
    reviewedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outputDir, "feedback.json"), JSON.stringify(parsed, null, 2));
  writeFeedbackHtml(outputDir, topic, parsed);
  console.log(`  Feedback: score ${parsed.score}/10, ${parsed.issues?.length || 0} issues — feedback.html written`);
  return parsed;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function severityColor(sev) {
  return { critical: "#ef4444", major: "#f59e0b", minor: "#94a3b8" }[sev] || "#94a3b8";
}

function writeFeedbackHtml(outputDir, topic, fb) {
  const slug = path.basename(outputDir);
  const frames = (fb._meta?.framePaths || []).map((f, i) => `
    <figure>
      <img src="${escapeHtml(f.path)}" alt="frame ${i}">
      <figcaption>Frame ${i + 1} — ${f.time.toFixed(0)}s</figcaption>
    </figure>`).join("");

  const issues = (fb.issues || []).map((iss) => `
    <li style="border-left:3px solid ${severityColor(iss.severity)};padding:8px 14px;margin:8px 0;background:#11111a">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <strong>Frame ${(iss.frame ?? 0) + 1}</strong>
        <span style="text-transform:uppercase;font-size:11px;color:${severityColor(iss.severity)}">${escapeHtml(iss.severity)}</span>
      </div>
      <div style="margin-top:4px">${escapeHtml(iss.what)}</div>
      <div style="color:#9090a0;font-size:13px;margin-top:4px">Why: ${escapeHtml(iss.why)}</div>
      <div style="color:#a78bfa;font-size:13px;margin-top:4px">Fix: ${escapeHtml(iss.fix)}</div>
    </li>`).join("");

  const wins = (fb.wins || []).map((w) => `<li>${escapeHtml(w)}</li>`).join("");
  const next = (fb.next_priorities || []).map((n) => `<li>${escapeHtml(n)}</li>`).join("");

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Feedback — ${escapeHtml(topic)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0a0a0f;color:#e8e8ee;font-family:-apple-system,system-ui,sans-serif;line-height:1.55}
.wrap{max-width:1080px;margin:0 auto;padding:32px 20px}
a{color:#a78bfa;text-decoration:none}
h1{font-size:26px;margin:0 0 8px}h2{font-size:18px;margin:24px 0 12px;color:#c0c0d0}
.score{display:inline-block;padding:4px 14px;border-radius:999px;background:#1a1a24;border:1px solid #2a2a3a;font-size:14px}
.frames{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:16px 0}
figure{margin:0;background:#11111a;border:1px solid #1f1f2c;border-radius:6px;overflow:hidden}
figure img{width:100%;display:block}figcaption{padding:6px 10px;font-size:12px;color:#7a7a90}
ul{padding-left:20px}li{margin:6px 0}
.crumb{color:#7a7a90;font-size:13px;margin-bottom:24px}
.overall{font-size:17px;margin:8px 0 16px;color:#e8e8ee}
</style></head><body><div class="wrap">
<div class="crumb"><a href="${escapeHtml(SERVER_BASE_FALLBACK)}/output/">← all videos</a> · <a href="preview.html">preview</a></div>
<h1>Feedback — ${escapeHtml(topic)}</h1>
<div><span class="score">Score: ${fb.score ?? "?"}/10</span></div>
<p class="overall">${escapeHtml(fb.overall || "")}</p>
<h2>Frames reviewed</h2>
<div class="frames">${frames}</div>
${issues ? `<h2>Issues (${fb.issues?.length || 0})</h2><ul style="list-style:none;padding:0">${issues}</ul>` : ""}
${wins ? `<h2>What works</h2><ul>${wins}</ul>` : ""}
${next ? `<h2>Next priorities</h2><ol>${next}</ol>` : ""}
<div style="color:#7a7a90;font-size:12px;margin-top:32px">Reviewed in ${fb._meta?.elapsedSec || "?"}s by ${escapeHtml(FEEDBACK_MODEL)}</div>
</div></body></html>`;

  fs.writeFileSync(path.join(outputDir, "feedback.html"), html);
}

const SERVER_BASE_FALLBACK = "http://157.180.124.232:8080";
