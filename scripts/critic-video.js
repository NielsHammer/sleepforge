/**
 * SleepForge auto-critic — scores a rendered MP4 using Claude Haiku.
 *
 * Usage:
 *   node scripts/critic-video.js <video.mp4> [script.json] [transcript.txt]
 *
 * What it does:
 *   1. Extracts 10 keyframes evenly distributed across the video (not 1/sec)
 *   2. Sends all keyframes + transcript excerpt + script to Claude Haiku in one call
 *   3. Returns JSON report + human-readable summary
 *   4. Target cost: < $0.05 per critique (Haiku pricing ~$0.0008/1K tokens)
 *
 * Output:
 *   <video-dir>/critic-report.json
 *   <video-dir>/critic-summary.txt
 */
import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import os   from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { callClaudeCLI } from '../src/claude-cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const videoPath    = process.argv[2];
  const scriptPath   = process.argv[3] || null;
  const transcriptPath = process.argv[4] || null;

  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('Usage: node scripts/critic-video.js <video.mp4> [script.json] [transcript.txt]');
    process.exit(1);
  }

  const videoDir  = path.dirname(videoPath);
  const videoBase = path.basename(videoPath, path.extname(videoPath));
  const reportPath  = path.join(videoDir, `${videoBase}-critic-report.json`);
  const summaryPath = path.join(videoDir, `${videoBase}-critic-summary.txt`);

  console.log(`\n── Critic: ${path.basename(videoPath)} ──`);

  // ── Step 1: Probe video duration ─────────────────────────────────────────
  const durationStr = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${videoPath}"`,
    { encoding: 'utf-8' }
  ).trim();
  const duration = parseFloat(durationStr);
  console.log(`  Duration: ${duration.toFixed(1)}s`);

  // ── Step 2: Extract 10 keyframes ─────────────────────────────────────────
  const frameDir = path.join(os.tmpdir(), `sleepforge-critic-${Date.now()}`);
  fs.mkdirSync(frameDir, { recursive: true });

  const NUM_FRAMES = 10;
  const framePaths = [];
  for (let i = 0; i < NUM_FRAMES; i++) {
    const ts = duration * (i + 0.5) / NUM_FRAMES;
    const framePath = path.join(frameDir, `frame-${String(i).padStart(2, '0')}.jpg`);
    execSync(
      `ffmpeg -y -ss ${ts.toFixed(2)} -i "${videoPath}" -vframes 1 -q:v 4 "${framePath}"`,
      { stdio: 'pipe' }
    );
    if (fs.existsSync(framePath)) framePaths.push({ ts, path: framePath });
  }
  console.log(`  Extracted ${framePaths.length} keyframes`);

  // ── Step 3: Load optional context ────────────────────────────────────────
  let scriptSummary = '';
  if (scriptPath && fs.existsSync(scriptPath)) {
    try {
      const scenes = JSON.parse(fs.readFileSync(scriptPath, 'utf-8'));
      const narration = scenes.map((s, i) => `Scene ${i+1}: ${(s.narration || '').slice(0, 200)}`).join('\n');
      scriptSummary = `\nSCRIPT SCENES (first 200 chars each):\n${narration}`;
    } catch {}
  }

  let transcriptExcerpt = '';
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    const txt = fs.readFileSync(transcriptPath, 'utf-8');
    transcriptExcerpt = `\nTRANSCRIPT (first 600 chars):\n${txt.slice(0, 600)}`;
  }

  // ── Step 4: Probe audio streams ──────────────────────────────────────────
  const streamsRaw = execSync(
    `ffprobe -v quiet -show_streams -select_streams a "${videoPath}"`,
    { encoding: 'utf-8' }
  ).trim();
  const audioStreamCount = (streamsRaw.match(/\[STREAM\]/g) || []).length;
  const audioInfo = `Audio streams: ${audioStreamCount} (want ≥2 for voice + music)`;

  // ── Step 5: Call Claude Haiku with all frames ────────────────────────────
  const frameList = framePaths.map((f, i) =>
    `Frame ${i+1} at ${f.ts.toFixed(1)}s: ${f.path}`
  ).join('\n');

  const prompt = `You are a sleep-video critic evaluating a YouTube philosophy sleep story.

VIDEO FILE: ${path.basename(videoPath)}
DURATION: ${duration.toFixed(1)}s
${audioInfo}
${scriptSummary}
${transcriptExcerpt}

KEYFRAMES (read each one using the Read tool before scoring):
${frameList}

Please read all ${framePaths.length} keyframe images above, then return ONLY valid JSON (no markdown, no commentary) matching this exact schema:

{
  "overall": <1-10>,
  "categories": {
    "visual_variety": <1-10>,
    "audio_mix": <1-10>,
    "pacing": <1-10>,
    "animation_usage": <1-10>,
    "subtitle_readability": <1-10>,
    "image_narration_match": <1-10>
  },
  "improvements": [
    {"rank": 1, "impact": "high|medium|low", "description": "..."},
    {"rank": 2, "impact": "high|medium|low", "description": "..."},
    {"rank": 3, "impact": "high|medium|low", "description": "..."}
  ],
  "observations": {
    "background_visible": true|false,
    "particles_visible": true|false,
    "subtitles_visible": true|false,
    "music_stream_present": ${audioStreamCount >= 2}
  },
  "summary": "One paragraph qualitative summary of the video."
}`;

  console.log(`  Sending to Claude Haiku (${framePaths.length} frames + context)...`);
  const t0 = Date.now();

  let raw;
  try {
    raw = await callClaudeCLI(prompt, {
      model: 'claude-haiku-4-5-20251001',
      timeoutMs: 120000,
      tools: 'Read',
      addDirs: [frameDir],
      permissionMode: 'bypassPermissions',
      allowedTools: 'Read',
    });
  } catch (err) {
    console.error(`  Haiku call failed: ${err.message}`);
    // Clean up frames
    for (const f of framePaths) try { fs.unlinkSync(f.path); } catch {}
    fs.rmdirSync(frameDir);
    process.exit(1);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  Haiku responded in ${elapsed}s`);

  // ── Step 6: Parse + write report ─────────────────────────────────────────
  let report;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    report = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch {
    report = { raw_response: raw, parse_error: true };
  }

  // Add metadata
  report._meta = {
    video: path.resolve(videoPath),
    duration: duration,
    frames_sampled: framePaths.length,
    audio_streams: audioStreamCount,
    critic_model: 'claude-haiku-4-5-20251001',
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  Report: ${reportPath}`);

  // Human-readable summary
  const cats = report.categories || {};
  const catLines = Object.entries(cats)
    .map(([k, v]) => `    ${k.padEnd(28)}: ${v}/10`)
    .join('\n');
  const improvements = (report.improvements || [])
    .map(i => `  [${i.impact?.toUpperCase() || '?'}] ${i.description}`)
    .join('\n');

  const humanSummary = [
    `══ CRITIC REPORT: ${path.basename(videoPath)} ══`,
    `  Overall: ${report.overall}/10`,
    `  Duration: ${duration.toFixed(1)}s`,
    ``,
    `  Category Scores:`,
    catLines,
    ``,
    `  Observations:`,
    `    background_visible   : ${report.observations?.background_visible}`,
    `    particles_visible    : ${report.observations?.particles_visible}`,
    `    subtitles_visible    : ${report.observations?.subtitles_visible}`,
    `    music_stream_present : ${report.observations?.music_stream_present}`,
    ``,
    `  Top Improvements:`,
    improvements,
    ``,
    `  Summary:`,
    `  ${report.summary || '(no summary)'}`,
    ``,
    `  Generated: ${new Date().toLocaleString()}`,
  ].join('\n');

  fs.writeFileSync(summaryPath, humanSummary);
  console.log(`  Summary: ${summaryPath}`);
  console.log(`\n${humanSummary}`);

  // Cleanup temp frames
  for (const f of framePaths) try { fs.unlinkSync(f.path); } catch {}
  try { fs.rmdirSync(frameDir); } catch {}

  return { report, reportPath, summaryPath };
}

main().catch(err => { console.error(err.message); process.exit(1); });
