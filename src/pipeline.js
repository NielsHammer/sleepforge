import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { generateScript, craftImagePrompt } from "./script-generator.js";
import { generateVoiceoverWithTimestamps, analyzePacing } from "./tts.js";
import { generateSceneImage } from "./fal.js";
import { generateASS } from "./subtitles.js";
import { compose, getAudioDuration } from "./ffmpeg.js";

// ─── SleepForge Pipeline ────────────────────────────────────────────────────
//
// Full orchestrator: script → TTS → Whisper → images → FFmpeg → final video
//
// Adapted from VideoForge pipeline.js but simplified for sleep content:
//   - No director/storyboard system (sleep videos have one visual style)
//   - No stock footage search (all images are AI-generated chalk art)
//   - No Remotion (pure FFmpeg composition)
//   - No upload step (separate module later)

// ─── WHISPER TRANSCRIPTION ──────────────────────────────────────────────────
// Get accurate word-level timestamps from the voiceover audio.
// These drive the karaoke subtitles.

function runWhisper(audioPath, outputDir) {
  console.log("  Running Whisper for word timestamps...");
  const jsonPath = path.join(outputDir, "whisper.json");

  try {
    // Use whisper with word_timestamps for precise timing
    const result = execSync(
      `python3 -c "
import whisper
import json

model = whisper.load_model('base')
result = model.transcribe('${audioPath}', word_timestamps=True, language='en')

words = []
for seg in result['segments']:
    for w in seg.get('words', []):
        words.append({
            'word': w['word'].strip(),
            'start': round(w['start'], 3),
            'end': round(w['end'], 3)
        })

with open('${jsonPath}', 'w') as f:
    json.dump(words, f, indent=2)

print(f'Whisper: {len(words)} words transcribed')
"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"], timeout: 300000 }
    );
    console.log("  " + result.trim());

    const words = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    return words;
  } catch (err) {
    console.error("  Whisper failed:", err.message);
    return null;
  }
}

// ─── IMAGE GENERATION ───────────────────────────────────────────────────────
// Generate scene-aware chalk images from the script's image prompts.
// Uses Fal.ai Flux Pro (~$0.03 per image).

async function generateSceneImages(scenes, outputDir) {
  const imageDir = path.join(outputDir, "images");
  fs.mkdirSync(imageDir, { recursive: true });

  const imagePaths = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const outputPath = path.join(imageDir, `scene-${String(i + 1).padStart(3, "0")}-${scene.philosopher.toLowerCase().replace(/\s+/g, "-")}.png`);

    // Skip if already generated (resume support)
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
      console.log(`  Image ${i + 1}/${scenes.length}: exists, skipping`);
      imagePaths.push(outputPath);
      continue;
    }

    const prompt = craftImagePrompt(scene);
    console.log(`  Image ${i + 1}/${scenes.length}: ${scene.philosopher} — ${scene.moment}`);

    try {
      await generateSceneImage(prompt, outputPath);
      imagePaths.push(outputPath);
    } catch (err) {
      console.error(`  Image ${i + 1} failed: ${err.message}`);
      // Continue without this image — slideshow will cycle others
    }
  }

  console.log(`  Generated ${imagePaths.length}/${scenes.length} images`);
  return imagePaths;
}

// ─── TTS WITH CHUNKING ──────────────────────────────────────────────────────
// Generate voiceover from the full narration text.
// For long scripts, chunks text and concatenates audio.

async function generateVoiceover(narrationText, voiceId, outputDir) {
  const voiceoverPath = path.join(outputDir, "voiceover.wav");

  // For long texts, split into chunks and concatenate
  const maxChars = 4000;
  if (narrationText.length <= maxChars) {
    console.log(`  Generating voiceover (${narrationText.length} chars)...`);
    await generateVoiceoverWithTimestamps(narrationText, voiceId, voiceoverPath);
    return voiceoverPath;
  }

  // Split by sentences, chunk into groups under maxChars
  const sentences = narrationText.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + s;
  }
  if (current.trim()) chunks.push(current.trim());

  console.log(`  Generating voiceover in ${chunks.length} chunks...`);

  const chunkPaths = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = path.join(outputDir, `voiceover-chunk-${i + 1}.wav`);
    console.log(`  Chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
    await generateVoiceoverWithTimestamps(chunks[i], voiceId, chunkPath);
    chunkPaths.push(chunkPath);
  }

  // Concatenate chunks using FFmpeg
  const concatFile = path.join(outputDir, "voiceover-concat.txt");
  fs.writeFileSync(concatFile, chunkPaths.map(p => `file '${p}'`).join("\n"));
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${voiceoverPath}"`,
    { stdio: "pipe", timeout: 120000 }
  );

  // Clean up chunks
  chunkPaths.forEach(p => { try { fs.unlinkSync(p); } catch (e) {} });
  try { fs.unlinkSync(concatFile); } catch (e) {}

  return voiceoverPath;
}

// ─── METADATA GENERATION ────────────────────────────────────────────────────
// Generate YouTube title, description, and tags.
// Uses Claude Haiku to stay within budget.

async function generateMetadata(topic, scenes, outputDir) {
  console.log("  Generating metadata...");

  const philosophers = [...new Set(scenes.map(s => s.philosopher))];

  const metadata = {
    title: `${topic} | Sleep Philosophy`,
    description: `A calming exploration of ${topic.toLowerCase()}. Featuring the wisdom of ${philosophers.join(", ")}. Perfect for sleep, meditation, and contemplation.\n\nPhilosophers featured:\n${philosophers.map(p => `- ${p}`).join("\n")}`,
    tags: [
      "philosophy", "sleep", "stoicism", "meditation", "relaxation",
      ...philosophers.map(p => p.toLowerCase()),
      "sleep story", "bedtime story", "philosophy sleep", "ancient wisdom",
      "marcus aurelius", "stoic philosophy", "calming narration",
    ],
  };

  const metaPath = path.join(outputDir, "metadata.json");
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
  console.log(`  Metadata: ${metaPath}`);
  return metadata;
}

// ─── MAIN PIPELINE ──────────────────────────────────────────────────────────

export async function runPipeline(options = {}) {
  const {
    topic = "The Stoic Philosophy of Marcus Aurelius",
    duration = 60,
    voice = "cloned-niels",
    philosophers = ["socrates", "plato", "aristotle", "marcus-aurelius", "epictetus", "seneca"],
    skipImages = false,
    skipTTS = false,
  } = options;

  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const outputDir = path.join("output", slug);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log("\n═══ SleepForge Pipeline ═══");
  console.log(`Topic: ${topic}`);
  console.log(`Duration: ${duration} min`);
  console.log(`Voice: ${voice}`);
  console.log(`Output: ${outputDir}/`);

  const startTime = Date.now();
  const results = { steps: {} };

  // ── STEP 1: SCRIPT GENERATION ──
  console.log("\n── Step 1: Script Generation ──");
  let scenes;
  const scriptJsonPath = path.join("scripts", `${slug}.json`);

  if (fs.existsSync(scriptJsonPath)) {
    console.log(`  Using existing script: ${scriptJsonPath}`);
    scenes = JSON.parse(fs.readFileSync(scriptJsonPath, "utf-8"));
  } else {
    const scriptResult = await generateScript(topic, {
      duration,
      philosophers,
      output: "./scripts",
    });
    scenes = scriptResult.scenes;
  }

  results.steps.script = { scenes: scenes.length, words: scenes.reduce((sum, s) => sum + s.narration.split(/\s+/).length, 0) };
  console.log(`  Script: ${scenes.length} scenes, ${results.steps.script.words} words`);

  // ── STEP 2: TTS VOICEOVER ──
  console.log("\n── Step 2: TTS Voiceover ──");
  const voiceoverPath = path.join(outputDir, "voiceover.wav");

  // Lock sleep-optimized pacing (slower delivery, calm tone) before TTS runs
  await analyzePacing("sleep-philosophy", topic, "calm", "");

  if (skipTTS && fs.existsSync(voiceoverPath)) {
    console.log("  Using existing voiceover");
  } else {
    const narrationText = scenes.map(s => s.narration).join("\n\n");
    await generateVoiceover(narrationText, voice, outputDir);
  }

  const voiceoverDuration = getAudioDuration(voiceoverPath);
  results.steps.tts = { duration: voiceoverDuration, path: voiceoverPath };
  console.log(`  Voiceover: ${voiceoverDuration.toFixed(1)}s (${(voiceoverDuration / 60).toFixed(1)} min)`);

  // ── STEP 3: WHISPER TIMESTAMPS ──
  console.log("\n── Step 3: Whisper Word Timestamps ──");
  const wordTimestamps = runWhisper(voiceoverPath, outputDir);
  results.steps.whisper = { words: wordTimestamps ? wordTimestamps.length : 0 };

  // ── STEP 4: ASS SUBTITLES ──
  console.log("\n── Step 4: ASS Karaoke Subtitles ──");
  let assPath = null;
  if (wordTimestamps && wordTimestamps.length > 0) {
    assPath = path.join(outputDir, "subtitles.ass");
    generateASS(wordTimestamps, assPath);
  } else {
    console.log("  No word timestamps — skipping subtitles");
  }
  results.steps.subtitles = { path: assPath, phrases: wordTimestamps ? Math.ceil(wordTimestamps.length / 4) : 0 };

  // ── STEP 5: IMAGE GENERATION ──
  console.log("\n── Step 5: Scene Image Generation ──");
  let imagePaths = [];
  if (!skipImages) {
    imagePaths = await generateSceneImages(scenes, outputDir);
  } else {
    // Check for existing images
    const imageDir = path.join(outputDir, "images");
    if (fs.existsSync(imageDir)) {
      imagePaths = fs.readdirSync(imageDir)
        .filter(f => f.endsWith(".png"))
        .sort()
        .map(f => path.join(imageDir, f));
    }
    console.log(`  Using ${imagePaths.length} existing images`);
  }
  results.steps.images = { count: imagePaths.length };

  // ── STEP 6: RENDER INTRO ──
  console.log("\n── Step 6: Render Intro Animation ──");
  const introPath = path.join(outputDir, "intro.mp4");
  if (!fs.existsSync(introPath) || fs.statSync(introPath).size < 1000) {
    try {
      execSync(
        `node engine/remotion/components/render-intro.mjs "${topic.replace(/"/g, '\\"')}" "${introPath}"`,
        { stdio: "pipe", timeout: 300000, cwd: "/opt/sleepforge" }
      );
      console.log(`  Intro rendered: ${introPath}`);
    } catch (err) {
      console.error(`  Intro render failed: ${err.message} — skipping`);
    }
  } else {
    console.log("  Intro exists, skipping render");
  }

  // ── STEP 7: FFMPEG COMPOSITION ──
  console.log("\n── Step 7: FFmpeg Composition ──");
  const composeResult = await compose({
    voiceoverPath,
    imagePaths,
    assPath,
    outputDir,
    introPath: fs.existsSync(introPath) ? introPath : null,
  });
  results.steps.compose = { finalPath: composeResult.finalPath, duration: composeResult.duration, size: composeResult.size };

  // ── STEP 8: METADATA ──
  console.log("\n── Step 8: Metadata ──");
  const metadata = await generateMetadata(topic, scenes, outputDir);
  results.steps.metadata = metadata;

  // ── SUMMARY ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const finalSize = (composeResult.size / 1024 / 1024).toFixed(1);

  console.log("\n═══ Pipeline Complete ═══");
  console.log(`  Duration: ${(composeResult.duration / 60).toFixed(1)} min`);
  console.log(`  File size: ${finalSize} MB`);
  console.log(`  Scenes: ${scenes.length}`);
  console.log(`  Images: ${imagePaths.length}`);
  console.log(`  Subtitles: ${results.steps.subtitles.phrases} phrases`);
  console.log(`  Elapsed: ${elapsed}s`);
  console.log(`  Output: ${composeResult.finalPath}`);
  console.log(`  View: http://157.180.124.232:8080/${composeResult.finalPath}`);

  return results;
}
