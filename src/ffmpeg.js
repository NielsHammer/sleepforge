import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ─── SleepForge FFmpeg Compositor ───────────────────────────────────────────
//
// Composes the final video from layers:
//   1. Background: dark video (pre-rendered per channel, or generated)
//   2. Scene images: displayed for scene duration with xfade crossfades
//   3. Voiceover: narrator audio (Kokoro or F5-TTS)
//   4. Fireplace loop: ambient warmth
//   5. Cricket ambience: nighttime texture
//   6. ASS subtitles: burned in as final step
//
// FIX LOG:
//   - v2: Fixed black screen — images now guaranteed to cover full duration
//   - v2: Added 1.5s xfade crossfade between images
//   - v2: Eliminated separate background+overlay — single pass composition

// ─── HELPERS ────────────────────────────────────────────────────────────────

export function getAudioDuration(filePath) {
  const result = execSync(
    `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
    { encoding: "utf-8" }
  );
  return parseFloat(result.trim());
}

function fileExists(p) {
  return fs.existsSync(p) && fs.statSync(p).size > 100;
}

// ─── IMAGE SLIDESHOW WITH XFADE ─────────────────────────────────────────────
// Creates a video from scene images with smooth xfade crossfade transitions.
// GUARANTEES full duration coverage — no black frames ever.
//
// Strategy: Each image is loaded as a separate input with -loop 1 -t <seconds>.
// Then chained with xfade filters. This is the most reliable way to ensure
// every frame has an image visible.

export function createImageSlideshow(imagePaths, duration, outputPath, options = {}) {
  if (imagePaths.length === 0) {
    console.log("  No images for slideshow — generating black fallback");
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=0x0a0a0a:s=1920x1080:d=${duration},format=yuv420p" ` +
      `-c:v libx264 -preset fast -crf 23 -movflags +faststart "${outputPath}"`,
      { stdio: "pipe", timeout: 120000 }
    );
    return outputPath;
  }

  const fadeTime = options.fadeTime || 2.0; // 2.0s xfade crossfade — slower, calmer

  // Strategy: cycle through all images, repeating as needed to fill the full duration.
  // Use xfade crossfade between each image for smooth transitions.
  // Each image shows for slotDuration seconds.
  // Total = N * slotDuration - (N-1) * fadeTime >= duration

  // Each image shows for 12-15s for a calm sleep pacing
  const targetSlotDuration = Math.max(12, Math.min(15, duration / Math.max(1, imagePaths.length)));
  const numSlots = Math.ceil((duration + fadeTime) / (targetSlotDuration));
  const slotDuration = (duration + (numSlots - 1) * fadeTime) / numSlots;

  console.log(`  Creating slideshow: ${numSlots} slots, ${slotDuration.toFixed(1)}s each, ${fadeTime}s xfade (${duration}s total)...`);

  // xfade filter chains get complex with many inputs. Cap at 30.
  // Beyond that, use concat demuxer fallback.
  if (numSlots > 30) {
    return createSlideshowConcat(imagePaths, duration, outputPath, fadeTime);
  }

  // Build xfade filter chain
  const inputs = [];
  const filters = [];

  for (let i = 0; i < numSlots; i++) {
    const imgPath = path.resolve(imagePaths[i % imagePaths.length]);
    inputs.push(`-loop 1 -t ${slotDuration.toFixed(2)} -i "${imgPath}"`);
  }

  // Scale all inputs to 1920x1080
  for (let i = 0; i < numSlots; i++) {
    filters.push(`[${i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0a,setsar=1,format=yuv420p[img${i}]`);
  }

  // Chain xfade filters between consecutive images
  if (numSlots === 1) {
    // Single image — no xfade needed
    filters.push(`[img0]null[vout]`);
  } else {
    // First xfade
    let offset = slotDuration - fadeTime;
    filters.push(`[img0][img1]xfade=transition=fade:duration=${fadeTime}:offset=${offset.toFixed(2)}[xf0]`);

    for (let i = 2; i < numSlots; i++) {
      offset += slotDuration - fadeTime;
      const prevLabel = `xf${i - 2}`;
      const nextLabel = i < numSlots - 1 ? `xf${i - 1}` : "vout";
      filters.push(`[${prevLabel}][img${i}]xfade=transition=fade:duration=${fadeTime}:offset=${offset.toFixed(2)}[${nextLabel}]`);
    }

    // If only 2 images, the first xfade output is vout
    if (numSlots === 2) {
      filters[filters.length - 1] = filters[filters.length - 1].replace("[xf0]", "[vout]");
    }
  }

  const filterComplex = filters.join(";");

  execSync(
    `ffmpeg -y ${inputs.join(" ")} -filter_complex "${filterComplex}" ` +
    `-map "[vout]" -c:v libx264 -preset fast -crf 22 -movflags +faststart "${outputPath}"`,
    { stdio: "pipe", timeout: 600000 }
  );

  console.log(`  Slideshow created: ${outputPath}`);
  return outputPath;
}

// Fallback for large image counts: use concat demuxer with per-image fade in/out
function createSlideshowConcat(imagePaths, duration, outputPath, fadeTime) {
  const imageShowTime = Math.max(13, Math.ceil(duration / Math.ceil(duration / 13)));
  const totalSlots = Math.ceil(duration / imageShowTime) + 1; // +1 for safety

  console.log(`  Concat mode: ${totalSlots} slots, ${imageShowTime}s each...`);

  const concatFile = outputPath.replace(/\.\w+$/, "-concat.txt");
  const concatLines = [];

  for (let i = 0; i < totalSlots; i++) {
    const imgPath = path.resolve(imagePaths[i % imagePaths.length]);
    concatLines.push(`file '${imgPath}'`);
    concatLines.push(`duration ${imageShowTime}`);
  }
  // Final entry (concat demuxer requirement)
  concatLines.push(`file '${path.resolve(imagePaths[0])}'`);

  fs.writeFileSync(concatFile, concatLines.join("\n"));

  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" ` +
    `-vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0a,format=yuv420p" ` +
    `-c:v libx264 -preset fast -crf 23 -t ${Math.ceil(duration)} -movflags +faststart "${outputPath}"`,
    { stdio: "pipe", timeout: 600000 }
  );

  try { fs.unlinkSync(concatFile); } catch (e) {}
  console.log(`  Slideshow created (concat): ${outputPath}`);
  return outputPath;
}

// ─── SEAMLESS LOOP PRE-PROCESSING ───────────────────────────────────────────
// MP3 boundary clicks on -stream_loop come from sample discontinuity at the
// loop seam. Fix: rotate the file by half its length, crossfade the seam in
// the middle, and apply a tiny fade-in/out at the file ends. After this, the
// loop boundary lands at near-silent ramps, which masks any residual click.
//
// The rotated file is cached next to the original (`*-seamless.mp3`).

function makeSeamlessLoop(srcPath) {
  if (!fileExists(srcPath)) return null;

  const dirPath = path.dirname(srcPath);
  const baseName = path.basename(srcPath, path.extname(srcPath));
  const seamlessPath = path.join(dirPath, `${baseName}-seamless.mp3`);

  if (fileExists(seamlessPath)) {
    const srcMtime = fs.statSync(srcPath).mtimeMs;
    const dstMtime = fs.statSync(seamlessPath).mtimeMs;
    if (dstMtime >= srcMtime) return seamlessPath;
  }

  const dur = getAudioDuration(srcPath);
  if (!isFinite(dur) || dur < 4) {
    return srcPath;
  }

  const rotate = (dur / 2).toFixed(3);
  const xfade = 1.0;        // crossfade seam length
  const edgeFade = 0.25;    // tiny taper at file ends to mask loop boundary

  console.log(`  Building seamless loop: ${path.basename(seamlessPath)} (rotate@${rotate}s, xfade=${xfade}s)...`);

  // Split original into two halves at midpoint, swap, crossfade the seam,
  // then fade in/out at the new file boundaries.
  const filter =
    `[0:a]atrim=0:${rotate},asetpts=PTS-STARTPTS[head];` +
    `[0:a]atrim=${rotate},asetpts=PTS-STARTPTS[tail];` +
    `[tail][head]acrossfade=d=${xfade}:c1=tri:c2=tri[xf];` +
    `[xf]afade=t=in:st=0:d=${edgeFade},afade=t=out:st=${(dur - xfade - edgeFade).toFixed(3)}:d=${edgeFade}[out]`;

  try {
    execSync(
      `ffmpeg -y -i "${srcPath}" -filter_complex "${filter}" ` +
      `-map "[out]" -c:a libmp3lame -b:a 192k "${seamlessPath}"`,
      { stdio: "pipe", timeout: 60000 }
    );
    return seamlessPath;
  } catch (err) {
    console.error(`  Seamless build failed (${err.message}) — using original`);
    return srcPath;
  }
}

// ─── AUDIO MIX ──────────────────────────────────────────────────────────────

export function mixAudio(voiceoverPath, duration, outputPath, options = {}) {
  const fireplaceRaw = options.fireplacePath || "assets/sfx/fireplace-cozy-loop.mp3";
  const cricketRaw = options.cricketPath || "assets/sfx/night-crickets-loop.mp3";

  // Use seamless rotated/crossfaded versions to eliminate loop-boundary clicks
  const fireplaceLoop = fileExists(fireplaceRaw) ? makeSeamlessLoop(fireplaceRaw) : null;
  const cricketLoop = fileExists(cricketRaw) ? makeSeamlessLoop(cricketRaw) : null;

  const voiceVol = options.voiceVolume || "1.0";
  const fireplaceVol = options.fireplaceVolume || "0.08";
  const cricketVol = options.cricketVolume || "0.05";

  console.log(`  Mixing audio (voice:${voiceVol} fire:${fireplaceVol} cricket:${cricketVol})...`);

  const inputs = [`-i "${voiceoverPath}"`];
  const filters = [];

  filters.push(`[0:a]volume=${voiceVol}[voice]`);

  let mixInputs = "[voice]";
  let inputIndex = 1;

  if (fireplaceLoop) {
    inputs.push(`-stream_loop -1 -i "${fireplaceLoop}"`);
    // aresample=async=1 smooths any sample-level glitches at loop boundaries
    filters.push(`[${inputIndex}:a]aresample=async=1,volume=${fireplaceVol}[fire]`);
    mixInputs += "[fire]";
    inputIndex++;
  }

  if (cricketLoop) {
    inputs.push(`-stream_loop -1 -i "${cricketLoop}"`);
    filters.push(`[${inputIndex}:a]aresample=async=1,volume=${cricketVol}[cricket]`);
    mixInputs += "[cricket]";
    inputIndex++;
  }

  const mixCount = mixInputs.split("][").length;
  filters.push(`${mixInputs}amix=inputs=${mixCount}:duration=first:dropout_transition=3[mixed]`);

  const filterComplex = filters.join(";");

  execSync(
    `ffmpeg -y ${inputs.join(" ")} -filter_complex "${filterComplex}" ` +
    `-map "[mixed]" -c:a aac -b:a 192k -t ${duration} "${outputPath}"`,
    { stdio: "pipe", timeout: 600000 }
  );

  console.log(`  Audio mixed: ${outputPath}`);
  return outputPath;
}

// ─── COMPOSE FINAL VIDEO ────────────────────────────────────────────────────
// Overlays the image slideshow centered at 60% on top of the Remotion background.
// If no Remotion background exists, uses slideshow as the full video track.

const REMOTION_BG = "engine/remotion/backgrounds/marcus-aurelius-night/bg.mp4";

export function composeVideo(slideshowPath, audioPath, outputPath, duration, options = {}) {
  const bgPath = options.backgroundPath || REMOTION_BG;
  const hasBg = fileExists(bgPath);

  console.log(`  Composing final video (${Math.round(duration)}s)...`);
  console.log(`  Background: ${hasBg ? bgPath : "none (slideshow only)"}`);

  if (hasBg) {
    // Overlay slideshow centered at 60% width on looping Remotion background
    // Image panel: 60% of 1920 = 1152px wide, centered at (384, 108)
    const panelW = 1152;
    const panelH = Math.round(panelW * 9 / 16); // 648
    const panelX = Math.round((1920 - panelW) / 2); // 384
    const panelY = Math.round((1080 - panelH) / 2) - 20; // 196

    execSync(
      `ffmpeg -y -stream_loop -1 -i "${bgPath}" -i "${slideshowPath}" -i "${audioPath}" ` +
      `-filter_complex "[1:v]scale=${panelW}:${panelH}[img];[0:v][img]overlay=${panelX}:${panelY}:shortest=0[v]" ` +
      `-map "[v]" -map 2:a -c:v libx264 -preset fast -crf 22 -c:a copy ` +
      `-t ${Math.ceil(duration)} -movflags +faststart "${outputPath}"`,
      { stdio: "pipe", timeout: 1200000 }
    );
  } else {
    // No background — slideshow is the full video
    execSync(
      `ffmpeg -y -i "${slideshowPath}" -i "${audioPath}" ` +
      `-map 0:v -map 1:a -c:v copy -c:a copy ` +
      `-t ${Math.ceil(duration)} -movflags +faststart "${outputPath}"`,
      { stdio: "pipe", timeout: 600000 }
    );
  }

  console.log(`  Video composed: ${outputPath}`);
  return outputPath;
}

// ─── FULL PIPELINE COMPOSITION ──────────────────────────────────────────────

export async function compose(config) {
  const {
    voiceoverPath,
    imagePaths = [],
    assPath = null,
    outputDir,
    introPath = null,
  } = config;

  const duration = getAudioDuration(voiceoverPath);
  console.log(`\n  FFmpeg Composition`);
  console.log(`  Duration: ${Math.round(duration)}s (${(duration / 60).toFixed(1)} min)`);
  console.log(`  Images: ${imagePaths.length}`);

  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: Image slideshow (covers full duration, no black frames)
  const slideshowPath = path.join(outputDir, "slideshow.mp4");
  createImageSlideshow(imagePaths, Math.ceil(duration), slideshowPath);

  // Step 2: Audio mix
  const mixedAudioPath = path.join(outputDir, "mixed-audio.m4a");
  mixAudio(voiceoverPath, Math.ceil(duration), mixedAudioPath);

  // Step 3: Compose video (slideshow + audio)
  const rawVideoPath = path.join(outputDir, "raw.mp4");
  composeVideo(slideshowPath, mixedAudioPath, rawVideoPath, duration);

  // Step 4: Prepend intro (if provided)
  let videoForSubs = rawVideoPath;
  if (introPath && fileExists(introPath)) {
    console.log("  Prepending intro animation...");
    const withIntroPath = path.join(outputDir, "with-intro.mp4");
    const concatFile = path.join(outputDir, "intro-concat.txt");
    fs.writeFileSync(concatFile, `file '${path.resolve(introPath)}'\nfile '${path.resolve(rawVideoPath)}'`);
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy -movflags +faststart "${withIntroPath}"`,
      { stdio: "pipe", timeout: 300000 }
    );
    try { fs.unlinkSync(concatFile); } catch (e) {}
    videoForSubs = withIntroPath;
    console.log(`  Intro prepended: ${withIntroPath}`);
  }

  // Step 5: Burn subtitles (if ASS file provided)
  const finalPath = path.join(outputDir, "final.mp4");
  if (assPath && fileExists(assPath)) {
    console.log("  Burning subtitles...");
    const escapedAss = assPath.replace(/:/g, "\\:");
    try {
      execSync(
        `ffmpeg -y -i "${videoForSubs}" -vf "ass='${escapedAss}'" -c:a copy -movflags +faststart "${finalPath}"`,
        { stdio: "pipe", timeout: 1800000 }
      );
      console.log(`  Final video with subs: ${finalPath}`);
    } catch (err) {
      console.error(`  Subtitle burn failed, using raw: ${err.message}`);
      fs.copyFileSync(videoForSubs, finalPath);
    }
  } else {
    fs.copyFileSync(videoForSubs, finalPath);
    console.log(`  Final video (no subs): ${finalPath}`);
  }

  const finalSize = (fs.statSync(finalPath).size / 1024 / 1024).toFixed(1);
  console.log(`  Output: ${finalPath} (${finalSize} MB)`);

  return {
    finalPath,
    duration,
    size: fs.statSync(finalPath).size,
  };
}
