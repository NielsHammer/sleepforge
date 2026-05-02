import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { PYTHON_BIN } from "./bin-paths.js";
import { generateScript } from "./script-generator.js";
import {
  generateVoiceoverWithTimestamps,
  getVoiceId,
  getAutoVoice,
  analyzePacing,
} from "./tts.js";
import { generateASS } from "./subtitles.js";
import { compose, getAudioDuration } from "./ffmpeg.js";
import { createStoryboard, SLEEP_PHILOSOPHY_BIBLE } from "./director.js";
import { generateThumbnail } from "./thumbnail.js";
import { generateMetadata } from "./metadata.js";
import { writeVideoPreview, rebuildOutputIndex } from "./preview.js";
import { applyContextualImagesToClips } from "./image-prompter.js";
import { reviewVideo } from "./feedback-agent.js";
import { writePipelineViz } from "./pipeline-viz.js";
import { generateSceneImage } from "./fal.js";

// ─── SleepForge Pipeline (VideoForge-aligned orchestration) ─────────────────
//
// Adapted from VideoForge's pipeline.js. Same flow, sleep-specific bricks:
//   - Voice: tts.js (Kokoro) instead of ElevenLabs
//   - Word timestamps: Whisper instead of ElevenLabs API
//   - Director: sleep-mode (30-45s clips, library lookup, no niche budgets)
//   - Visuals: assets/images/library-v1/ lookup, Schnell only for misses
//   - Renderer: FFmpeg slideshow + pre-rendered Greek-library bg.mp4
//   - Audio: voice + seamless ambient (fireplace + crickets)
//   - Subtitles: ASS karaoke
//   - Thumbnail + metadata: Schnell + Haiku
//
// Public entry point:  generateVideo({ topic, duration, voice, ... })
//   - The legacy `runPipeline(...)` export is kept as a thin alias.

// ─── Whisper transcription ──────────────────────────────────────────────────
// VideoForge gets word timestamps from ElevenLabs. SleepForge uses local
// Whisper because Kokoro doesn't return word timing.

function runWhisper(audioPath, outputDir) {
  const jsonPath = path.join(outputDir, "whisper.json");
  console.log("  Running Whisper for word timestamps...");
  try {
    const result = execSync(
      `"${PYTHON_BIN}" -c "
import whisper, json
m = whisper.load_model('base')
r = m.transcribe('${audioPath}', word_timestamps=True, language='en')
words = []
for seg in r['segments']:
    for w in seg.get('words', []):
        words.append({'word': w['word'].strip(), 'start': round(w['start'], 3), 'end': round(w['end'], 3)})
with open('${jsonPath}', 'w') as f:
    json.dump(words, f)
print(f'Whisper: {len(words)} words')
"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 600000 }
    );
    console.log("  " + result.trim());
    return JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  } catch (err) {
    console.error("  Whisper failed:", err.message);
    return [];
  }
}

// ─── Sentence-by-sentence TTS with proper silence pauses ────────────────────
// Replaces the old approach (TTS-then-post-process-silence) which was cutting
// audio mid-word because Whisper word.end timestamps trail the actual word
// boundary. Now each sentence is its own TTS chunk, and silent .wav files of
// known length are concatenated between them. Result: zero clipping, deterministic
// pauses, and per-sentence audio that we can also expose for QC.

const ABBREVIATIONS = /^(Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|etc|Inc|Co|Ltd|B\.C|A\.D|i\.e|e\.g)$/i;

function splitIntoSentences(text) {
  const paragraphs = text.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (let p = 0; p < paragraphs.length; p++) {
    const para = paragraphs[p].replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    // Greedy split on sentence-end punctuation, then merge fragments where the
    // boundary is actually an abbreviation (Mr., Dr., etc.).
    const rawParts = para.split(/(?<=[.!?])\s+/);
    const merged = [];
    let buf = "";
    for (const part of rawParts) {
      buf = buf ? `${buf} ${part}` : part;
      // If `buf` ends with one of our abbreviations, keep accumulating.
      const m = buf.match(/(\S+?)\.\s*$/);
      const lastToken = m ? m[1] : "";
      if (lastToken && ABBREVIATIONS.test(lastToken)) continue;
      merged.push(buf);
      buf = "";
    }
    if (buf) merged.push(buf);

    for (let i = 0; i < merged.length; i++) {
      out.push({
        text: merged[i].trim(),
        paragraphEnd: i === merged.length - 1 && p < paragraphs.length - 1,
      });
    }
  }
  return out;
}

function ensureSilenceWav(outPath, durationMs) {
  if (fs.existsSync(outPath)) return outPath;
  const sec = (durationMs / 1000).toFixed(3);
  execSync(
    `ffmpeg -y -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=24000" ` +
    `-t ${sec} -c:a pcm_s16le "${outPath}"`,
    { stdio: "pipe" }
  );
  return outPath;
}

async function generateVoiceover(narrationText, voiceId, outputPath, outputDir) {
  const sentencesDir = path.join(outputDir, "sentences");
  fs.mkdirSync(sentencesDir, { recursive: true });

  const sentences = splitIntoSentences(narrationText);
  console.log(`  Sentence-by-sentence TTS: ${sentences.length} sentences`);

  // Pre-generate silence padding files (cached per outputDir)
  const silenceShort = ensureSilenceWav(path.join(outputDir, "_silence-350.wav"), 350);
  const silenceLong = ensureSilenceWav(path.join(outputDir, "_silence-700.wav"), 700);

  const sentenceMeta = new Array(sentences.length);
  const sentencePaths = new Array(sentences.length); // sentence audio in order
  const overallStart = Date.now();

  // Concurrency = TTS_CONCURRENCY env var, default 4. Chatterbox CPU runs at
  // ~4× slower than realtime per sentence, but parallel sentence requests
  // saturate the 8-core box without thrashing — 4 concurrent gives the best
  // throughput in practice (queue overhead at 8). Kokoro is fast enough that
  // any concurrency level is fine.
  const concurrency = parseInt(process.env.TTS_CONCURRENCY || "4", 10);
  console.log(`  Parallel TTS: concurrency=${concurrency}`);

  let nextIdx = 0;
  let completed = 0;
  async function worker() {
    while (true) {
      const i = nextIdx++;
      if (i >= sentences.length) return;
      const s = sentences[i];
      const partPath = path.join(sentencesDir, `s${String(i).padStart(3, "0")}.wav`);
      const t0 = Date.now();
      try {
        await generateVoiceoverWithTimestamps(s.text, voiceId, partPath);
      } catch (err) {
        console.error(`    sentence ${i + 1} TTS failed: ${err.message}`);
        throw err;
      }
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const dur = getAudioDuration(partPath);
      sentenceMeta[i] = {
        index: i, text: s.text,
        path: path.relative(outputDir, partPath),
        durationSec: dur, ttsSec: parseFloat(dt),
      };
      sentencePaths[i] = partPath;
      completed++;
      if (completed % 5 === 0 || completed === sentences.length) {
        const pct = Math.round(100 * completed / sentences.length);
        const elapsed = Math.round((Date.now() - overallStart) / 1000);
        console.log(`    [${completed}/${sentences.length}] ${pct}% · ${elapsed}s elapsed`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Stitch in order: sentence-i, then silence (short or long depending on paragraph end).
  const partPaths = [];
  for (let i = 0; i < sentences.length; i++) {
    partPaths.push(sentencePaths[i]);
    if (i < sentences.length - 1) {
      partPaths.push(sentences[i].paragraphEnd ? silenceLong : silenceShort);
    }
  }

  const totalSec = ((Date.now() - overallStart) / 1000).toFixed(0);
  console.log(`  TTS complete: ${sentences.length} sentences in ${totalSec}s`);

  // Concat all parts into the final voiceover.wav
  const concatFile = path.join(outputDir, "_voice-concat.txt");
  // ffmpeg concat demuxer resolves entries relative to the concat file's dir.
  // Files live in different subdirs, so use absolute paths.
  fs.writeFileSync(concatFile, partPaths.map((p) => `file '${path.resolve(p)}'`).join("\n"));
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${outputPath}"`,
    { stdio: "pipe", timeout: 180000 }
  );
  try { fs.unlinkSync(concatFile); } catch {}

  // Persist sentence metadata for the audio QC page
  fs.writeFileSync(
    path.join(outputDir, "sentences.json"),
    JSON.stringify({ sentences: sentenceMeta }, null, 2)
  );

  return outputPath;
}

// ─── Library miss → live Schnell generation ─────────────────────────────────

async function fillLibraryMisses(clips, outputDir) {
  const livedir = path.join(outputDir, "images-live");
  let livedDir = false;
  let filled = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (clip.imagePath) continue;

    if (!livedDir) {
      fs.mkdirSync(livedir, { recursive: true });
      livedDir = true;
    }

    const livePath = path.join(livedir, `clip-${String(i + 1).padStart(3, "0")}.png`);
    const fallbackPrompt =
      `Chalk drawing on dark blackboard, white and grey chalk only, monochrome, ` +
      `${clip.philosopher ? clip.philosopher + " " : ""}` +
      `${(clip.text || "").slice(0, 200)}, ` +
      `swirling chalk dust, single Greek Doric column, no light sources, no color, ` +
      `medium distance, 16:9, no text, no letters, no caption.`;

    try {
      console.log(`  Library miss → Schnell for clip ${i + 1}: ${clip.philosopher || "?"}`);
      await generateSceneImage(fallbackPrompt, livePath);
      clip.imagePath = livePath;
      filled++;
    } catch (err) {
      console.error(`  Live image gen failed for clip ${i + 1}: ${err.message}`);
    }
  }
  return filled;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function generateVideo(options = {}) {
  const startTime = Date.now();
  const {
    topic = "The Stoic Philosophy of Marcus Aurelius",
    duration = 60, // sleep videos default to 60 minutes
    voice = "am_echo",
    philosophers = ["socrates", "plato", "aristotle", "marcus-aurelius", "epictetus", "seneca"],
    skipImages = false,
    skipVoice = false,
    minClipSec = 30,
    maxClipSec = 45,
    targetClipSec = 5,  // sleep-tempo: one image every ~5s, 4-7s window after merge
    skipThumbnail = false,
    skipMetadata = false,
    intro = false,  // sleep videos start the voiceover at t=0; bg.mp4 carries the visual hook
  } = options;

  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const outputDir = path.join("output", slug);
  const assetsDir = path.join(outputDir, "assets");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  console.log("\n═══ SleepForge Pipeline (VF-aligned) ═══");
  console.log(`Topic: ${topic}`);
  console.log(`Duration target: ${duration} min`);
  console.log(`Voice: ${voice}`);
  console.log(`Output: ${outputDir}/`);

  // Order brief — single source of truth for downstream modules
  const orderBrief = {
    topic,
    niche: "sleep-philosophy",
    tone: "calm-meditative",
    narrator: voice,
    videoLength: `${duration}min`,
    backgroundStyle: "greek-library-night",
    minClipSec,
    maxClipSec,
    targetClipSec,
  };

  const results = { steps: {} };

  // ── STEP 1: Script ────────────────────────────────────────────────────────
  console.log("\n── Step 1: Script Generation ──");
  let scenes;
  const scriptJsonPath = path.join("scripts", `${slug}.json`);
  if (fs.existsSync(scriptJsonPath)) {
    console.log(`  Using existing script: ${scriptJsonPath}`);
    scenes = JSON.parse(fs.readFileSync(scriptJsonPath, "utf-8"));
  } else {
    const r = await generateScript(topic, { duration, philosophers, output: "./scripts" });
    scenes = r.scenes;
  }
  const scriptText = scenes.map((s) => s.narration).join("\n\n");
  results.steps.script = { scenes: scenes.length, words: scriptText.split(/\s+/).length };
  console.log(`  Script: ${scenes.length} scenes, ${results.steps.script.words} words`);

  // ── STEP 2: Voice resolution + pacing ─────────────────────────────────────
  console.log("\n── Step 2: Voice Setup ──");
  const voiceId = await getVoiceId(voice);
  console.log(`  Voice: ${voiceId}`);
  await analyzePacing(orderBrief.niche, topic, orderBrief.tone, scriptText.slice(0, 500));

  // ── STEP 3: Voiceover + word timestamps ───────────────────────────────────
  console.log("\n── Step 3: TTS Voiceover ──");
  const voiceoverPath = path.join(assetsDir, "voiceover.wav");
  const tsPath = path.join(assetsDir, "voiceover-timestamps.json");

  let wordTimestamps, totalDuration;
  if (skipVoice && fs.existsSync(voiceoverPath) && fs.existsSync(tsPath)) {
    const cached = JSON.parse(fs.readFileSync(tsPath, "utf-8"));
    wordTimestamps = cached.words;
    totalDuration = cached.duration;
    console.log(`  Cached voiceover: ${totalDuration.toFixed(1)}s, ${wordTimestamps.length} words`);
  } else {
    // TTS each sentence separately, concat with silence padding between.
    // Result has natural pauses without any post-process audio surgery.
    await generateVoiceover(scriptText, voiceId, voiceoverPath, assetsDir);
    totalDuration = getAudioDuration(voiceoverPath);
    wordTimestamps = runWhisper(voiceoverPath, assetsDir);
    fs.writeFileSync(tsPath, JSON.stringify({ words: wordTimestamps, duration: totalDuration }, null, 2));
  }
  results.steps.voice = { duration: totalDuration, words: wordTimestamps.length };
  console.log(`  Voiceover: ${totalDuration.toFixed(1)}s (${(totalDuration / 60).toFixed(1)} min), ${wordTimestamps.length} words`);

  // ── STEP 4: Director — storyboard windows ────────────────────────────────
  console.log("\n── Step 4: Director ──");
  const storyboard = await createStoryboard(scenes, wordTimestamps, totalDuration, orderBrief);
  const clips = storyboard.clips;
  const videoBible = storyboard.videoBible;

  const libraryHits = clips.filter((c) => c.imagePath).length;
  results.steps.director = { clips: clips.length, libraryHits, libraryMisses: clips.length - libraryHits };

  // ── STEP 5: Contextual image prompter — Claude per-clip + DB cache ───────
  // Replaces library keyword lookup + Schnell fill with a single context-aware
  // pass: Claude reads each clip's narration + scene metadata + video bible,
  // writes the perfect chalk prompt, then we hash-lookup an existing image or
  // generate a fresh one via Schnell. New images go into db/image-cache.json
  // for reuse across future videos on similar concepts.
  if (!skipImages) {
    console.log("\n── Step 5: Contextual Image Prompter ──");
    const result = await applyContextualImagesToClips(clips, videoBible, topic, slug);
    results.steps.director.contextual = result;
    results.steps.director.filled = result.generated;
  }

  // Persist storyboard AFTER contextual images so prompts/hashes are saved.
  fs.writeFileSync(path.join(outputDir, "storyboard.json"), JSON.stringify({ clips, videoBible }, null, 2));

  // Choose a fallback image (first library hit) for any remaining null clips
  const fallbackImage = clips.find((c) => c.imagePath)?.imagePath || null;

  // ── STEP 6: ASS karaoke subtitles ─────────────────────────────────────────
  console.log("\n── Step 6: ASS Karaoke Subtitles ──");
  let assPath = null;
  if (wordTimestamps && wordTimestamps.length > 0) {
    assPath = path.join(outputDir, "subtitles.ass");
    generateASS(wordTimestamps, assPath);
  } else {
    console.log("  No word timestamps — skipping subtitles");
  }

  // ── STEP 7: Intro animation (opt-in) ──────────────────────────────────────
  // Sleep philosophy videos default to NO standalone intro — the voiceover
  // begins at t=0 over the bg.mp4. A 12-second silent splash before the
  // narration was jarring. Pass `intro: true` to re-enable.
  let introPath = null;
  if (intro) {
    console.log("\n── Step 7: Render Intro Animation ──");
    introPath = path.join(outputDir, "intro.mp4");
    if (!fs.existsSync(introPath) || fs.statSync(introPath).size < 1000) {
      try {
        execSync(
          `node engine/remotion/components/render-intro.mjs "${topic.replace(/"/g, '\\"')}" "${introPath}"`,
          { stdio: "pipe", timeout: 300000, cwd: "/opt/sleepforge" }
        );
        console.log(`  Intro rendered: ${introPath}`);
      } catch (err) {
        console.error(`  Intro render failed: ${err.message} — skipping`);
        introPath = null;
      }
    }
  } else {
    console.log("\n── Step 7: Intro skipped (voice starts at t=0 over bg.mp4) ──");
  }

  // ── STEP 8: FFmpeg composition (slideshow + bg overlay + audio + subs) ────
  console.log("\n── Step 8: FFmpeg Composition ──");
  const composeResult = await compose({
    voiceoverPath,
    clips,
    fallbackImage,
    assPath,
    outputDir,
    introPath: introPath && fs.existsSync(introPath) ? introPath : null,
  });
  results.steps.compose = {
    finalPath: composeResult.finalPath,
    duration: composeResult.duration,
    size: composeResult.size,
  };

  // ── STEP 9: Thumbnail ─────────────────────────────────────────────────────
  if (!skipThumbnail) {
    console.log("\n── Step 9: Thumbnail ──");
    const thumbPath = path.join(outputDir, "thumbnail.png");
    try {
      await generateThumbnail(topic, scenes, thumbPath);
      console.log(`  Thumbnail: ${thumbPath}`);
      results.steps.thumbnail = thumbPath;
    } catch (err) {
      console.error(`  Thumbnail failed: ${err.message}`);
    }
  }

  // ── STEP 10: Metadata ─────────────────────────────────────────────────────
  if (!skipMetadata) {
    console.log("\n── Step 10: Metadata ──");
    const metadata = await generateMetadata(topic, scenes, clips, totalDuration);
    const metaPath = path.join(outputDir, "metadata.json");
    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    console.log(`  Title: ${metadata.title}`);
    console.log(`  Tags: ${metadata.tags.length}, Chapters: ${metadata.chapters.length}`);
    results.steps.metadata = metadata;
  }

  // ── Pipeline visualization — step-by-step HTML with intermediate artifacts ─
  try {
    writePipelineViz(outputDir, topic, results);
  } catch (err) {
    console.error(`  Pipeline viz failed: ${err.message}`);
  }

  // ── Auto feedback agent — Claude reviews the finished video ───────────────
  try {
    console.log("\n── Step 11: Feedback Agent ──");
    await reviewVideo({
      videoPath: composeResult.finalPath,
      topic,
      metadata: results.steps.metadata,
      outputDir,
    });
  } catch (err) {
    console.error(`  Feedback agent failed: ${err.message}`);
  }

  // ── Preview pages — embeds player + metadata, browsable via file server ──
  try {
    writeVideoPreview(outputDir, topic, results.steps.metadata, composeResult.duration);
    rebuildOutputIndex("output");
  } catch (err) {
    console.error(`  Preview generation failed: ${err.message}`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const finalSize = (composeResult.size / 1024 / 1024).toFixed(1);

  console.log("\n═══ Pipeline Complete ═══");
  console.log(`  Duration: ${(composeResult.duration / 60).toFixed(1)} min`);
  console.log(`  File size: ${finalSize} MB`);
  console.log(`  Clips: ${clips.length} (library: ${libraryHits}, generated: ${results.steps.director.filled || 0})`);
  console.log(`  Elapsed: ${elapsed}s`);
  console.log(`  Output: ${composeResult.finalPath}`);
  console.log(`  Watch: http://157.180.124.232:8080/${outputDir}/preview.html`);
  console.log(`  All videos: http://157.180.124.232:8080/output/`);

  return results;
}

// Backward-compatible alias
export const runPipeline = generateVideo;
