import { execSync, spawnSync } from "child_process";
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

// ─── CLIP-DRIVEN SLIDESHOW ──────────────────────────────────────────────────
// Renders one image per director clip, with each image showing for exactly
// its clip's duration. Chunks the work into groups so the xfade filter graph
// stays manageable for hour-long videos with 80-100 clips.
//
// clips: [{start_time, end_time, imagePath}], totalDuration (sec)

const SLIDESHOW_CHUNK_SIZE = 20; // max clips per xfade chain

export function createClipSlideshow(clips, totalDuration, outputPath, options = {}) {
  // 1.5s soft fade between every clip — long enough to feel elegant, short
  // enough to keep the storyboard moving at sleep tempo (3-5s per scene).
  const fadeTime = options.fadeTime || 1.5;
  const fallbackImage = options.fallbackImage || null;
  const bgImagePath  = options.bgImagePath  || null;
  const bgVideoPath  = options.bgVideoPath  || null;

  // Keep clips that have a video (animation) OR an image (still).
  // Animation clips have videoPath set and imagePath=null — previously they were
  // dropped here because imagePath resolved to null after fallback lookup.
  const usable = clips
    .map((c) => ({
      ...c,
      imagePath: c.videoPath ? c.imagePath : (c.imagePath || fallbackImage),
    }))
    .filter((c) =>
      (c.videoPath && fs.existsSync(c.videoPath)) ||
      (c.imagePath && fileExists(c.imagePath))
    );

  if (usable.length === 0) {
    console.log("  No clip images — generating black fallback");
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=0x0a0a0a:s=1920x1080:d=${Math.ceil(totalDuration)},format=yuv420p" ` +
      `-c:v libx264 -preset fast -crf 23 -movflags +faststart "${outputPath}"`,
      { stdio: "pipe", timeout: 120000 }
    );
    return outputPath;
  }

  console.log(`  Clip slideshow: ${usable.length} images over ${Math.round(totalDuration)}s, ${fadeTime}s xfade...`);

  // Single chunk fast path
  if (usable.length <= SLIDESHOW_CHUNK_SIZE) {
    renderClipChunk(usable, fadeTime, outputPath, { bgImagePath, bgVideoPath });
    return outputPath;
  }

  // Chunked render — split into groups, render each, then xfade-concat the chunks.
  const chunks = [];
  for (let i = 0; i < usable.length; i += SLIDESHOW_CHUNK_SIZE) {
    chunks.push(usable.slice(i, i + SLIDESHOW_CHUNK_SIZE));
  }
  console.log(`  Rendering in ${chunks.length} chunks of up to ${SLIDESHOW_CHUNK_SIZE} clips...`);

  const tmpDir = path.dirname(outputPath);
  const chunkPaths = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const cp = path.join(tmpDir, `slideshow-chunk-${ci}.mp4`);
    renderClipChunk(chunks[ci], fadeTime, cp, { bgImagePath, bgVideoPath });
    chunkPaths.push(cp);
  }

  // xfade-concat chunks
  if (chunkPaths.length === 1) {
    fs.copyFileSync(chunkPaths[0], outputPath);
  } else {
    concatChunksWithXfade(chunkPaths, fadeTime, outputPath);
  }

  // Cleanup
  for (const cp of chunkPaths) {
    try { fs.unlinkSync(cp); } catch {}
  }

  console.log(`  Clip slideshow created: ${outputPath}`);
  return outputPath;
}

// ─── Static per-clip scale filter ──────────────────────────────────────────
// Images are held perfectly still — no zoom, no pan. Ken Burns caused visible
// stutter (discrete pixel steps) that harmed the polish. Static hold looks
// cleaner and lets the xfade crossfade carry all the visual motion.
function buildStaticScaleFilter(inputLabel, outLabel, durSec) {
  const d = durSec.toFixed(3);
  return (
    `[${inputLabel}]scale=1920:1080:force_original_aspect_ratio=increase,` +
    `crop=1920:1080,setsar=1,fps=30,` +
    `format=yuv420p,trim=duration=${d},setpts=PTS-STARTPTS[${outLabel}]`
  );
}

function renderClipChunk(clips, fadeTime, outputPath, opts = {}) {
  const bgImagePath = opts.bgImagePath || null;
  const bgVideoPath = opts.bgVideoPath || null; // pre-rendered zoom loop for animation scenes
  const inputs = [];
  const filters = [];
  // nextIdx tracks actual ffmpeg input index across all clips (animation clips
  // consume 2 inputs: the animation + the bg behind it).
  let nextIdx = 0;

  // xfade overlaps the two adjacent streams by fadeTime, which would compress
  // the total slideshow by (n-1)*fadeTime. To preserve clip pacing, we render
  // each clip for actualDur+fadeTime so its trailing fadeTime gets consumed by
  // the next clip's xfade-in. xfade offsets are then placed at the clip's
  // actual end_time, not actual_end - fade.
  for (let i = 0; i < clips.length; i++) {
    const actualDur = clips[i].end_time - clips[i].start_time;
    const renderDur = actualDur + fadeTime;

    if (clips[i].videoPath) {
      // Animation clip: screen-blend the animation over a bg (zoom loop or static).
      // The animation has a black (#080808) background — screen blend makes dark
      // pixels transparent, revealing the bg behind the glowing elements.
      const animIdx = nextIdx++;
      // stream_loop so short animations (3s) loop to fill clip+fadeTime slot
      inputs.push(`-stream_loop -1 -t ${renderDur.toFixed(3)} -i "${path.resolve(clips[i].videoPath)}"`);

      const bgPath = bgVideoPath || bgImagePath;
      if (bgPath && fs.existsSync(bgPath)) {
        const bgIdx = nextIdx++;
        if (bgVideoPath && fs.existsSync(bgVideoPath)) {
          // Pre-rendered zoom loop — stream-loop it for the clip duration
          inputs.push(`-stream_loop -1 -t ${renderDur.toFixed(3)} -i "${path.resolve(bgVideoPath)}"`);
        } else {
          // Static bg image — still, no zoom
          inputs.push(`-loop 1 -framerate 30 -t ${renderDur.toFixed(3)} -i "${path.resolve(bgImagePath)}"`);
        }
        filters.push(`[${bgIdx}:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,fps=30,format=gbrp[bg${i}]`);
        filters.push(`[${animIdx}:v]scale=1920:1080,setsar=1,fps=30,format=gbrp[anim${i}]`);
        // screen blend in gbrp (RGB planar) — avoids YUV chroma offset corruption
        filters.push(
          `[bg${i}][anim${i}]blend=all_mode=screen:shortest=1,` +
          `trim=duration=${renderDur.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[img${i}]`
        );
      } else {
        // No bg available — just scale the animation
        filters.push(buildStaticScaleFilter(`${animIdx}:v`, `img${i}`, renderDur));
      }
    } else {
      // Still image: -loop 1 replays the image for the full clip duration
      const imgIdx = nextIdx++;
      inputs.push(`-loop 1 -framerate 30 -t ${renderDur.toFixed(3)} -i "${path.resolve(clips[i].imagePath)}"`);
      filters.push(buildStaticScaleFilter(`${imgIdx}:v`, `img${i}`, renderDur));
    }
  }

  if (clips.length === 1) {
    filters.push(`[img0]null[vout]`);
  } else {
    let offset = clips[0].end_time - clips[0].start_time; // start xfade at clip 0's actual end
    let chainLabel = "img0";
    for (let i = 1; i < clips.length; i++) {
      const isLast = i === clips.length - 1;
      const out = isLast ? "vout" : `xf${i - 1}`;
      filters.push(
        `[${chainLabel}][img${i}]xfade=transition=fade:duration=${fadeTime}:offset=${offset.toFixed(2)}[${out}]`
      );
      chainLabel = out;
      const thisDur = clips[i].end_time - clips[i].start_time;
      offset += thisDur; // next xfade starts at next clip's actual end
    }
  }

  // Write filter_complex to a temp file — Windows has an 8191-char cmd limit
  // and zoompan filter strings push chunks over that threshold.
  const filterFile = outputPath + ".filter.txt";
  fs.writeFileSync(filterFile, filters.join(";"));
  try {
    execSync(
      `ffmpeg -y ${inputs.join(" ")} -filter_complex_script "${filterFile}" ` +
      `-map "[vout]" -c:v libx264 -preset fast -crf 22 -movflags +faststart "${outputPath}"`,
      { stdio: "pipe", timeout: 1800000 }
    );
  } finally {
    try { fs.unlinkSync(filterFile); } catch {}
  }
}

function concatChunksWithXfade(chunkPaths, fadeTime, outputPath) {
  const inputs = chunkPaths.map((p) => `-i "${path.resolve(p)}"`);
  const filters = [];

  // Probe each chunk's duration
  const durations = chunkPaths.map((p) => getAudioDuration(p));

  // Normalize each input
  for (let i = 0; i < chunkPaths.length; i++) {
    filters.push(`[${i}:v]setpts=PTS-STARTPTS,fps=30,format=yuv420p[c${i}]`);
  }

  let chainLabel = "c0";
  let offset = durations[0] - fadeTime;
  for (let i = 1; i < chunkPaths.length; i++) {
    const isLast = i === chunkPaths.length - 1;
    const out = isLast ? "vout" : `xc${i - 1}`;
    filters.push(
      `[${chainLabel}][c${i}]xfade=transition=fade:duration=${fadeTime}:offset=${offset.toFixed(2)}[${out}]`
    );
    chainLabel = out;
    offset += durations[i] - fadeTime;
  }

  execSync(
    `ffmpeg -y ${inputs.join(" ")} -filter_complex "${filters.join(";")}" ` +
    `-map "[vout]" -c:v libx264 -preset fast -crf 22 -movflags +faststart "${outputPath}"`,
    { stdio: "pipe", timeout: 1800000 }
  );
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
  // Use TWO independent `-i` decodes (input 0 for tail, input 1 for head):
  // a single input feeding asplit→atrim branches deadlocks because both
  // atrim branches need to consume the same buffer in different time ranges.
  // Independent decodes let each branch read from its own demuxer.
  const outLen = dur - xfade;
  const fadeOutStart = Math.max(0, outLen - edgeFade);
  const filter =
    `[0:a]atrim=start=${rotate},asetpts=PTS-STARTPTS[tail];` +
    `[1:a]atrim=start=0:end=${rotate},asetpts=PTS-STARTPTS[head];` +
    `[tail][head]acrossfade=d=${xfade}:c1=tri:c2=tri[xf];` +
    `[xf]afade=t=in:st=0:d=${edgeFade},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${edgeFade}[out]`;

  try {
    execSync(
      `ffmpeg -y -i "${srcPath}" -i "${srcPath}" -filter_complex "${filter}" ` +
      `-map "[out]" -c:a libmp3lame -b:a 192k "${seamlessPath}"`,
      { stdio: "pipe", timeout: 60000 }
    );
    if (!fileExists(seamlessPath) || fs.statSync(seamlessPath).size < 5000) {
      throw new Error(`output file too small (${fs.existsSync(seamlessPath) ? fs.statSync(seamlessPath).size : 0} bytes)`);
    }
    return seamlessPath;
  } catch (err) {
    console.error(`  Seamless build failed (${err.message}) — using original`);
    try { fs.unlinkSync(seamlessPath); } catch {}
    return srcPath;
  }
}

// ─── INTRO STING ────────────────────────────────────────────────────────────
// Generates a 2-second cinematic intro sting entirely with FFmpeg:
//   50-60Hz sub-bass swell, 220Hz atmospheric pad, 660Hz soft chime at ~1.65s.
// All three tones fade in naturally via amplitude envelopes, then fade out.

export function generateIntroSting(outputPath, durationSec = 2) {
  if (fileExists(outputPath)) return outputPath;
  const d = String(durationSec);
  const fadeOutSt = String((durationSec - 0.3).toFixed(2));

  // Three layered sine tones — passed as array to spawnSync to avoid Windows
  // shell double-quote escaping (cmd.exe eats quotes inside filter_complex strings).
  // 60Hz sub-bass swell + 220Hz atmospheric pad + 660Hz soft chime at ~1.65s.
  const filterComplex = [
    `sine=frequency=60:sample_rate=44100:duration=${d}[s0]`,
    `sine=frequency=220:sample_rate=44100:duration=${d}[s1]`,
    `sine=frequency=660:sample_rate=44100:duration=${d}[s2]`,
    `[s0]volume=0.90,afade=t=in:st=0:d=0.6[sub]`,
    `[s1]volume=0.55,afade=t=in:st=0:d=0.4[pad]`,
    `[s2]volume=0.32,adelay=1650|1650[chime]`,
    `[sub][pad][chime]amix=inputs=3:duration=longest,afade=t=out:st=${fadeOutSt}:d=0.3,alimiter=limit=0.92:level=true[out]`,
  ].join(';');

  const result = spawnSync('ffmpeg', [
    '-y',
    '-filter_complex', filterComplex,
    '-map', '[out]',
    '-c:a', 'pcm_s16le',
    outputPath,
  ], { stdio: 'pipe', timeout: 15000 });

  if (result.status !== 0) {
    const errMsg = result.stderr?.toString().slice(-500) || 'unknown error';
    throw new Error(`generateIntroSting failed: ${errMsg}`);
  }
  return outputPath;
}

// ─── PREPEND INTRO VIDEO ────────────────────────────────────────────────────
// Concatenates a pre-rendered intro clip (video+audio) before the main body.
// Both inputs must be H.264 video + AAC audio — re-encodes to ensure compat.
// Used by the Sleepless Astronomer pipeline to prepend the 2-sec animated intro.
export function prependIntroVideo(introPath, bodyPath, outputPath) {
  const timeout = 7200000; // 2 hours — 71-min body at 4x speed = ~18 min encode; leave headroom
  const result = spawnSync('ffmpeg', [
    '-y',
    '-i', path.resolve(introPath),
    '-i', path.resolve(bodyPath),
    '-filter_complex',
    '[0:v]scale=1920:1080,fps=30,format=yuv420p[v0];' +
    '[1:v]scale=1920:1080,fps=30,format=yuv420p[v1];' +
    '[0:a]aresample=44100[a0];' +
    '[1:a]aresample=44100[a1];' +
    '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '22',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    path.resolve(outputPath),
  ], { stdio: ['ignore', 'ignore', 'pipe'], timeout, maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw new Error(`prependIntroVideo spawn error: ${result.error.message}`);
  if (result.status !== 0) {
    const err = result.stderr?.toString().slice(-800) || 'unknown error';
    throw new Error(`prependIntroVideo failed (exit ${result.status}): ${err}`);
  }
  return outputPath;
}

// Prepend intro sting to a voiceover: sting.wav + voiceover.wav → output.wav
// Both are resampled to 44100 Hz before concat — sting is 44100 Hz, Chatterbox voice
// is 24000 Hz, and -c:a copy would embed a mismatched sample rate header causing 1.84x
// playback speed (chipmunk voice).
export function prependIntroSting(stingPath, voicePath, outputPath) {
  const result = spawnSync('ffmpeg', [
    '-y',
    '-i', stingPath,
    '-i', voicePath,
    '-filter_complex', '[0:a]aresample=44100[s];[1:a]aresample=44100[v];[s][v]concat=n=2:v=0:a=1[out]',
    '-map', '[out]',
    '-c:a', 'pcm_s16le',
    outputPath,
  ], { stdio: 'pipe', timeout: 60000 });
  if (result.status !== 0) {
    const errMsg = result.stderr?.toString().slice(-300) || 'unknown error';
    throw new Error(`prependIntroSting failed: ${errMsg}`);
  }
  return outputPath;
}

// ─── AUDIO MIX ──────────────────────────────────────────────────────────────

export function mixAudio(voiceoverPath, duration, outputPath, options = {}) {
  const fireplaceRaw  = options.fireplacePath || "assets/sfx/fireplace-cozy-loop.mp3";
  const cricketRaw    = options.cricketPath   || "assets/sfx/night-crickets-loop.mp3";
  const bgMusicRaw    = options.bgMusicPath   || "assets/audio/bgmusic.mp3";

  const fireplaceLoop = fileExists(fireplaceRaw) ? makeSeamlessLoop(fireplaceRaw) : null;
  const cricketLoop   = fileExists(cricketRaw)   ? makeSeamlessLoop(cricketRaw)   : null;
  // Set includeBgMusic: false to omit bgmusic from this mix (e.g. when
  // you want to pass it as a separate audio stream in the final MP4).
  const includeBgMusic = options.includeBgMusic !== false;
  // bgMusic: use directly (long track, loop seam inaudible at low volume)
  const bgMusicLoop   = includeBgMusic && fileExists(bgMusicRaw) ? bgMusicRaw : null;

  const voiceVol     = options.voiceVolume    ?? "1.0";
  const fireplaceVol = options.fireplaceVolume ?? "0.08";
  const cricketVol   = options.cricketVolume   ?? "0.05";
  const bgMusicVol   = options.bgMusicVolume   ?? "0.25";

  console.log(`  Mixing audio (voice:${voiceVol} fire:${fireplaceVol} cricket:${cricketVol} music:${bgMusicVol})...`);

  const inputs  = [`-i "${voiceoverPath}"`];
  const filters = [];

  // [0] = voice, full volume
  filters.push(`[0:a]volume=${voiceVol}[voice_raw]`);

  let inputIdx = 1;
  const bgTracks = []; // { label, volLabel }

  if (bgMusicLoop) {
    inputs.push(`-stream_loop -1 -i "${bgMusicLoop}"`);
    filters.push(`[${inputIdx}:a]aresample=async=1,volume=${bgMusicVol}[bgmusic_vol]`);
    bgTracks.push({ label: "bgmusic", volLabel: "bgmusic_vol" });
    inputIdx++;
  }
  if (fireplaceLoop) {
    inputs.push(`-stream_loop -1 -i "${fireplaceLoop}"`);
    filters.push(`[${inputIdx}:a]aresample=async=1,volume=${fireplaceVol}[fire_vol]`);
    bgTracks.push({ label: "fire", volLabel: "fire_vol" });
    inputIdx++;
  }
  if (cricketLoop) {
    inputs.push(`-stream_loop -1 -i "${cricketLoop}"`);
    filters.push(`[${inputIdx}:a]aresample=async=1,volume=${cricketVol}[cricket_vol]`);
    bgTracks.push({ label: "cricket", volLabel: "cricket_vol" });
    inputIdx++;
  }

  // Simple direct mix — no sidechain ducking.
  filters.push(`[voice_raw]acopy[voice_main]`);

  const mixIn    = `[voice_main]${bgTracks.map((t) => `[${t.volLabel}]`).join("")}`;
  const mixCount = bgTracks.length + 1;
  filters.push(`${mixIn}amix=inputs=${mixCount}:duration=first:dropout_transition=3[mixed]`);

  execSync(
    `ffmpeg -y ${inputs.join(" ")} -filter_complex "${filters.join(";")}" ` +
    `-map "[mixed]" -c:a aac -b:a 192k -t ${duration} "${outputPath}"`,
    { stdio: "pipe", timeout: 600000 }
  );

  console.log(`  Audio mixed: ${outputPath}`);
  return outputPath;
}

// ─── COMPOSE FINAL VIDEO ────────────────────────────────────────────────────
// Layered composition (back→front):
//   1. bg.mp4 (Kling night-study), darkened ~50% so it reads as ambience
//   2. Drifting chalk-dust particle layer (overlay)
//   3. Chalkboard-framed image panel (slideshow + frame border)
//   Subtitle burn happens later in `compose()` after this stage.

const REMOTION_BG = "engine/remotion/backgrounds/marcus-aurelius-night/bg.mp4";
const PARTICLES_PATH = "engine/remotion/backgrounds/particles-loop.mp4";
const SMOKE_PATH = "engine/remotion/backgrounds/smoke-loop.mp4";
const FRAME_PATH = "assets/frames/chalkboard-frame.png";

// Generate a sparse white chalk-dust field as a static PNG, sized 2× video
// width so we can scroll it horizontally and wrap. Using deterministic geq
// gives reproducible particle positions per channel.
function ensureDustPng(outPath) {
  if (fileExists(outPath)) return outPath;
  console.log(`  Generating dust texture: ${outPath}...`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Threshold/100000 = pixel density. 12 → ~460 lit pixels in 3840×1080.
  // Pixels cluster from neighboring hash hits to form ~80-120 visible dots.
  const aExpr = `if(lt(mod(X*7919+Y*6113,100000),12),220,0)`;
  execSync(
    `ffmpeg -y -f lavfi -i "color=c=white@0.0:s=3840x1080,format=rgba" ` +
    `-vf "geq=r=255:g=255:b=255:a='${aExpr}'" -frames:v 1 -update 1 "${outPath}"`,
    { stdio: "pipe", timeout: 60000 }
  );
  return outPath;
}

// Build a 30s loop of a single subtle dust layer drifting up-and-slightly-right.
// Procedural via geq: noise pattern position offset by time, so dots translate
// upward (~12 px/s) and rightward (~3 px/s). Subtle, sleep-appropriate.
// Once cached, costs nothing on subsequent renders.
export function ensureSmokeLoop(outPath = SMOKE_PATH) {
  if (fileExists(outPath) && fs.statSync(outPath).size > 100000) return outPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  console.log(`  Generating smoke loop → ${outPath} (one-time, ~30s)...`);
  // Animate noise at low resolution (240×135) then scale up — much faster than
  // per-frame 1920×1080 geq. The noise changes each frame via allf=t+u (time +
  // uniform), blurred to a cloud texture, then scaled up and darkened for
  // atmospheric screen-blend overlay on the slideshow.
  execSync(
    `ffmpeg -y -f lavfi -i "color=c=0x808080:s=240x135:r=30:d=60" ` +
    `-vf "noise=alls=50:allf=t+u,` +
         `boxblur=8:2,` +
         `scale=1920:1080:flags=bicubic,` +
         `eq=brightness=-0.55:contrast=1.2:saturation=0,` +
         `format=yuv420p" ` +
    `-t 60 -c:v libx264 -preset fast -crf 28 -movflags +faststart "${outPath}"`,
    { stdio: "pipe", timeout: 300000 }
  );
  return outPath;
}

export async function ensureParticleLoop(outPath = PARTICLES_PATH) {
  if (fileExists(outPath)) return outPath;
  console.log(`  Rendering fireplace-spark particle loop via Remotion: ${outPath}...`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const { renderFireplaceParticles } = await import("./remotion-particles.js");
  await renderFireplaceParticles(outPath);
  return outPath;
}

// Legacy ffmpeg-geq fallback — no Remotion needed. Used by test-video pipeline.
export function ensureParticleLoopLegacy(outPath = PARTICLES_PATH) {
  if (fileExists(outPath)) return outPath;
  console.log(`  Building fireplace-spark particle loop (legacy): ${outPath}...`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  // Fireplace-spark embers, 60s loop, 30fps.
  //
  // Why geq instead of a particle simulator: ffmpeg has no native particle
  // system, but a deterministic hash gives us reproducible "embers" that
  // appear at integer positions. By making each spark short-lived (3-5 sec)
  // and spawning many of them, the eye reads a steady drift of glowing dots,
  // not a static grid.
  //
  // Math:
  //   For each pixel (X, Y) and time T:
  //     - hash(X, Y) decides if this pixel could ever be a spark spawn point
  //     - the spawn point's vertical position drifts up linearly: Y_now = Y0 - speed*T
  //     - we draw a soft warm-orange glow (R≈255, G≈170, B≈70) at that point
  //
  // Drift speed: ~10 px/s upward — matches a real fireplace spark rising in
  // still air. Spawn density tuned so ~25 sparks visible at once (sparse).
  // Slight horizontal sway via sin(t + hash) so they don't move on rails.
  //
  // Output is RGB on near-black canvas — screen-blended downstream, so the
  // black falls away and only the glowing dots remain.

  const speed = 8;         // px/sec upward drift (slower = longer on screen)
  const spawnDensity = 20; // lower = denser; ~415 spawn points, prominent embers
  const lifetime = 5;      // each spark lives 5 seconds — more visible at once

  // The spawn-point hash is over (X, Y) — Y here is the spawn Y, not screen Y.
  // We invert: for each screen Y, look up the spark whose age is t = (Y0 - Y)/speed.
  // For each pixel, we pretend it might be a spawn point that was emitted t seconds
  // ago and has risen to (X+sway, Y - speed*t). Spawn density × lifetime determines
  // how many sparks land on screen on average.
  //
  // Simplified expr: at time T, ember at original (X, Y) is at screen position
  // (X + sway(T+hash), Y - speed*T). To render: for each screen pixel (sx, sy)
  // and time T, we ask "is there a spawn (X, Y) such that X+sway≈sx and Y-speed*T≈sy?"
  // We approximate by walking the inverse: spawn Y = sy + speed*T, and X = sx (sway
  // small enough we ignore in hash lookup). Then check spawn validity.

  // Active window: only pixels in the lower 80% of the screen are eligible to be
  // a "current spark" (sparks rise from below the chalk figure and float past).
  // Brightness fades over lifetime via sin(pi * age/lifetime).
  // Spark mask (1 if pixel is a spark, 0 otherwise). Used both for luma AND
  // chroma so non-spark pixels stay neutral grey-on-black instead of dumping
  // a global warm tint that bleeds through screen-blend downstream.
  const sparkMask = `lt(mod(X*7919+(Y+${speed}*T)*6113,100000),${spawnDensity})`;
  const lumExpr =
    `if(${sparkMask},255*sin(PI*mod(T+0.001*X,${lifetime})/${lifetime}),0)`;
  // Chroma: 128 = neutral grey. Diverge on spark pixels for warm orange/amber.
  const cbExpr = `if(${sparkMask},80,128)`;   // blue chroma drop → warm amber
  const crExpr = `if(${sparkMask},215,128)`;  // red chroma boost → bright orange

  execSync(
    `ffmpeg -y -f lavfi -i "color=c=black:s=1920x1080:r=30:d=60" ` +
    `-vf "format=yuv420p,geq=lum='${lumExpr}':cb='${cbExpr}':cr='${crExpr}',gblur=sigma=2.5" ` +
    `-c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p -movflags +faststart "${outPath}"`,
    { stdio: "pipe", timeout: 600000 }
  );
  return outPath;
}

// Generate a 1152×648 chalkboard frame PNG: dark slate-grey border with
// scattered white chalk flecks along the inner edge, transparent center.
// Uses drawbox primitives so geq edge-cases don't break the build.
export function ensureChalkboardFrame(outPath = FRAME_PATH, panelW = 1152, panelH = 648) {
  if (fileExists(outPath)) return outPath;
  console.log(`  Generating chalkboard frame: ${outPath}...`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const borderW = 50;             // dark slate border thickness (was 36 — too thin)
  const chalkLineW = 3;           // bright chalk line just inside the slate
  const chalkBand = 14;           // band beyond the chalk line where flecks appear
  const slate = "0x141414@1.0";   // dark slate
  const chalk = "0xF5F1E8@1.0";   // warm chalk white (matches subtitle Primary)

  // Layered build (back→front):
  //   1. Four solid slate border rectangles  →  thick dark frame
  //   2. Four chalk-white inner-edge stripes →  hand-drawn chalk rectangle
  //   3. Scattered chalk flecks in the chalk band → smudgy chalk-dust feel
  const inner = borderW;
  const innerEnd = panelW - borderW;
  const innerEndY = panelH - borderW;
  const filters = [
    // Slate border ring
    `drawbox=x=0:y=0:w=${panelW}:h=${borderW}:color=${slate}:t=fill`,
    `drawbox=x=0:y=${panelH - borderW}:w=${panelW}:h=${borderW}:color=${slate}:t=fill`,
    `drawbox=x=0:y=${borderW}:w=${borderW}:h=${panelH - 2 * borderW}:color=${slate}:t=fill`,
    `drawbox=x=${panelW - borderW}:y=${borderW}:w=${borderW}:h=${panelH - 2 * borderW}:color=${slate}:t=fill`,
    // Chalk-white rectangle stroke just inside the slate
    `drawbox=x=${inner}:y=${inner}:w=${innerEnd - inner}:h=${chalkLineW}:color=${chalk}:t=fill`,
    `drawbox=x=${inner}:y=${innerEndY - chalkLineW}:w=${innerEnd - inner}:h=${chalkLineW}:color=${chalk}:t=fill`,
    `drawbox=x=${inner}:y=${inner}:w=${chalkLineW}:h=${innerEndY - inner}:color=${chalk}:t=fill`,
    `drawbox=x=${innerEnd - chalkLineW}:y=${inner}:w=${chalkLineW}:h=${innerEndY - inner}:color=${chalk}:t=fill`,
  ];

  // Chalk flecks — small 1-3px boxes scattered in the band beyond the chalk line.
  // Deterministic LCG so the frame is identical every render.
  let seed = 12345;
  const lcg = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const fleckCount = 200;
  for (let i = 0; i < fleckCount; i++) {
    const side = i % 4;
    let x, y;
    if (side === 0) {
      x = Math.floor(lcg() * panelW);
      y = inner + chalkLineW + Math.floor(lcg() * chalkBand);
    } else if (side === 1) {
      x = Math.floor(lcg() * panelW);
      y = innerEndY - chalkLineW - chalkBand + Math.floor(lcg() * chalkBand);
    } else if (side === 2) {
      x = inner + chalkLineW + Math.floor(lcg() * chalkBand);
      y = Math.floor(lcg() * panelH);
    } else {
      x = innerEnd - chalkLineW - chalkBand + Math.floor(lcg() * chalkBand);
      y = Math.floor(lcg() * panelH);
    }
    const w = 1 + Math.floor(lcg() * 3);
    const h = 1 + Math.floor(lcg() * 3);
    filters.push(`drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${chalk}:t=fill`);
  }

  execSync(
    `ffmpeg -y -f lavfi -i "color=c=black@0.0:s=${panelW}x${panelH},format=rgba" ` +
    `-vf "${filters.join(",")}" -frames:v 1 -update 1 "${outPath}"`,
    { stdio: "pipe", timeout: 60000 }
  );
  return outPath;
}

// Generate a 1920×1080 philosophy frame PNG with a transparent center.
// Rendered once; overlay on top of the final video to give all scenes an
// elegant gold-on-slate border with corner accent squares.
export function ensurePhilosophyFrame(outPath) {
  if (fileExists(outPath)) return outPath;
  console.log(`  Generating philosophy frame: ${outPath}...`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const W = 1920, H = 1080;
  const bw = 52;       // border thickness (px)
  const gl = 4;        // gold inner line thickness
  const slate = "0x110E08@1.0";  // warm dark slate
  const gold  = "0xC8A040@1.0";  // burnished gold

  const filters = [
    // Solid slate border ring (four rectangles)
    `drawbox=x=0:y=0:w=${W}:h=${bw}:color=${slate}:t=fill`,
    `drawbox=x=0:y=${H-bw}:w=${W}:h=${bw}:color=${slate}:t=fill`,
    `drawbox=x=0:y=${bw}:w=${bw}:h=${H-2*bw}:color=${slate}:t=fill`,
    `drawbox=x=${W-bw}:y=${bw}:w=${bw}:h=${H-2*bw}:color=${slate}:t=fill`,
    // Gold inner rectangle stroke just inside the slate
    `drawbox=x=${bw}:y=${bw}:w=${W-2*bw}:h=${gl}:color=${gold}:t=fill`,
    `drawbox=x=${bw}:y=${H-bw-gl}:w=${W-2*bw}:h=${gl}:color=${gold}:t=fill`,
    `drawbox=x=${bw}:y=${bw+gl}:w=${gl}:h=${H-2*bw-2*gl}:color=${gold}:t=fill`,
    `drawbox=x=${W-bw-gl}:y=${bw+gl}:w=${gl}:h=${H-2*bw-2*gl}:color=${gold}:t=fill`,
    // Corner accent squares (open stroke, not filled)
    `drawbox=x=${bw-gl}:y=${bw-gl}:w=32:h=32:color=${gold}:t=3`,
    `drawbox=x=${W-bw-22}:y=${bw-gl}:w=32:h=32:color=${gold}:t=3`,
    `drawbox=x=${bw-gl}:y=${H-bw-22}:w=32:h=32:color=${gold}:t=3`,
    `drawbox=x=${W-bw-22}:y=${H-bw-22}:w=32:h=32:color=${gold}:t=3`,
  ];

  // Deterministic chalk flecks scattered along the border band
  let seed = 77341;
  const lcg = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const band = bw - gl - 6;
  for (let i = 0; i < 180; i++) {
    const side = i % 4;
    let x, y;
    if (side === 0) { x = Math.floor(lcg() * W); y = gl + 6 + Math.floor(lcg() * band); }
    else if (side === 1) { x = Math.floor(lcg() * W); y = H - bw + 6 + Math.floor(lcg() * band); }
    else if (side === 2) { x = gl + 6 + Math.floor(lcg() * band); y = Math.floor(lcg() * H); }
    else { x = W - bw + 6 + Math.floor(lcg() * band); y = Math.floor(lcg() * H); }
    const fw = 1 + Math.floor(lcg() * 2);
    const fh = 1 + Math.floor(lcg() * 2);
    filters.push(`drawbox=x=${x}:y=${y}:w=${fw}:h=${fh}:color=${gold}:t=fill`);
  }

  // Windows CMD has an 8191-char limit. Write the filter graph to a temp file
  // and use -filter_complex_script to avoid "command line too long" errors.
  // drawbox does not write alpha on a transparent source.
  // Workaround: start with opaque black, draw the border, then colorkey
  // pure black → transparent to reveal the video through the center.
  // similarity=0.001 only keys exact or near-exact black; slate (0x110E08) is safe.
  const filterScript = outPath + ".filter.txt";
  fs.writeFileSync(filterScript, `[0:v]${filters.join(",")},colorkey=0x000000:0.001:0.0,format=rgba[v]`);
  try {
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=black:s=${W}x${H}" ` +
      `-filter_complex_script "${filterScript}" -map "[v]" -frames:v 1 -update 1 "${outPath}"`,
      { stdio: "pipe", timeout: 60000 }
    );
  } finally {
    try { fs.unlinkSync(filterScript); } catch {}
  }
  return outPath;
}

export async function composeVideo(slideshowPath, audioPath, outputPath, duration, options = {}) {
  console.log(`  Composing final video (${Math.round(duration)}s)...`);

  // Slideshow fills the full 1920x1080 frame; particles + smoke are
  // screen-blended on top for atmosphere. Particles come from Remotion
  // (cozy fireplace embers); smoke is a slow ffmpeg-generated drift.
  const particlesPath = await ensureParticleLoop();
  const smokePath = ensureSmokeLoop();

  const filter =
    // [0] = slideshow scaled to fill 1920x1080 (cover/crop)
    `[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,` +
      `setsar=1,fps=30,format=gbrp[base];` +
    // [1] = particles loop, screen-blended (sparkle over chalk)
    `[1:v]scale=1920:1080,setsar=1,fps=30,format=gbrp[parts];` +
    `[base][parts]blend=all_mode=screen:shortest=0[withParts];` +
    // [2] = smoke loop, screen-blended on top (atmospheric drift)
    `[2:v]scale=1920:1080,setsar=1,fps=30,format=gbrp[smoke];` +
    `[withParts][smoke]blend=all_mode=screen:shortest=0,format=yuv420p[v]`;

  execSync(
    `ffmpeg -y -i "${slideshowPath}" ` +                    // [0] slideshow (full)
    `-stream_loop -1 -i "${particlesPath}" ` +              // [1] particles
    `-stream_loop -1 -i "${smokePath}" ` +                  // [2] smoke
    `-i "${audioPath}" ` +                                  // [3] audio
    `-filter_complex "${filter}" ` +
    `-map "[v]" -map 3:a -c:v libx264 -preset fast -crf 22 -c:a copy ` +
    `-t ${Math.ceil(duration)} -movflags +faststart "${outputPath}"`,
    { stdio: "pipe", timeout: 1800000 }
  );

  console.log(`  Video composed: ${outputPath}`);
  return outputPath;
}

// ─── LAYERED COMPOSITION WITH BACKGROUND IMAGE ──────────────────────────────
// Layer order (back→front):
//   bgImagePath   → static philosophy background (hidden by 100% chalk, but
//                   visible through animation clips where it was screen-blended
//                   into the slideshow by renderClipChunk)
//   slideshowPath → chalk images at 100% opacity (no bg bleed on image clips)
//   particlesPath → screen blend (warm orange ember sparks)
//   smokePath     → screen blend (atmospheric dust drift)
//   framePath     → philosophy frame PNG (RGBA, transparent centre) — overlay
//   assPath       → ASS karaoke subtitles burned in on top
//
// Audio: single mixed stereo track (voice + bgmusic + fire all in voiceAudioPath).
export function composeFinalVideoWithBg({
  bgImagePath,
  slideshowPath,
  particlesPath,
  smokePath,
  assPath,
  voiceAudioPath,
  bgMusicPath,    // ignored — mix music into voiceAudioPath via mixAudio() instead
  framePath,      // optional: philosophy-frame.png (RGBA, transparent centre)
  outputPath,
  duration,
  introDuration,  // seconds of black + fade-in before video content (default 0)
  fullscreen = false, // true = space channel: images fill 1920×1080, no bg, no frame
}) {
  const intro = introDuration || 0;
  const d = Math.ceil(duration) + intro;
  const escapedAss = assPath
    ? assPath.replace(/\\/g, "/").replace(/:/g, "\\:")
    : null;

  // Build input list, tracking indices
  const inputs = [];
  let idx = 0;

  let bgIdx = null;
  if (!fullscreen && bgImagePath && fileExists(bgImagePath)) {
    inputs.push(`-loop 1 -framerate 30 -t ${d} -i "${path.resolve(bgImagePath)}"`);
    bgIdx = idx++;
  }

  inputs.push(`-i "${path.resolve(slideshowPath)}"`);
  const slideshowIdx = idx++;

  inputs.push(`-stream_loop -1 -i "${path.resolve(particlesPath)}"`);
  const particlesIdx = idx++;

  inputs.push(`-stream_loop -1 -i "${path.resolve(smokePath)}"`);
  const smokeIdx = idx++;

  inputs.push(`-i "${path.resolve(voiceAudioPath)}"`);
  const voiceIdx = idx++;

  let frameIdx = null;
  if (!fullscreen && framePath && fileExists(framePath)) {
    inputs.push(`-loop 1 -framerate 1 -i "${path.resolve(framePath)}"`);
    frameIdx = idx++;
  }

  // Build filter_complex
  const filters = [];

  // Base layer
  if (fullscreen) {
    // Fullscreen (space channel): images fill the entire 1920×1080 viewport.
    // No bg image, no frame margins — cover-crop to avoid letter-boxing.
    filters.push(
      `[${slideshowIdx}:v]scale=1920:1080:force_original_aspect_ratio=increase,` +
      `crop=1920:1080,setsar=1,fps=30,format=gbrp[base]`
    );
  } else if (bgIdx !== null) {
    // Framed + bg: chalk in inner 1728×972 window, bg blurred behind it.
    filters.push(
      `[${bgIdx}:v]scale=1728:972:force_original_aspect_ratio=increase,` +
      `crop=1728:972,setsar=1,fps=30,` +
      `gblur=sigma=10,` +
      `colorchannelmixer=rr=0.55:gg=0.55:bb=0.55,` +
      `pad=1920:1080:96:54:color=black,` +
      `format=gbrp[bg_dark]`
    );
    filters.push(
      `[${slideshowIdx}:v]scale=1728:972:force_original_aspect_ratio=increase,` +
      `crop=1728:972,setsar=1,fps=30,` +
      `pad=1920:1080:96:54:color=black,` +
      `format=gbrp[chalk]`
    );
    filters.push(`[bg_dark][chalk]blend=all_mode=screen:shortest=1[base]`);
  } else {
    // Framed, no bg — chalk in inner window, black margins
    filters.push(
      `[${slideshowIdx}:v]scale=1728:972:force_original_aspect_ratio=increase,` +
      `crop=1728:972,setsar=1,fps=30,` +
      `pad=1920:1080:96:54:color=black,` +
      `format=gbrp[base]`
    );
  }

  // Smoke — screen blend
  filters.push(
    `[${smokeIdx}:v]scale=1920:1080,setsar=1,fps=30,format=gbrp[smoke_sc]`
  );
  filters.push(
    `[base][smoke_sc]blend=all_mode=screen:shortest=0,format=yuv420p[with_smoke]`
  );

  // Philosophy frame overlay (optional) — rendered on top of smoke
  let afterFrame = "with_smoke";
  if (frameIdx !== null) {
    filters.push(`[with_smoke][${frameIdx}:v]overlay=x=0:y=0[with_frame]`);
    afterFrame = "with_frame";
  }

  // Particles LAST — screen blend across full 1920×1080, on top of frame border.
  // This means particles float in the black margins AND over the chalk content.
  // Convert current layer to gbrp, blend, convert back to yuv420p.
  filters.push(`[${afterFrame}]format=gbrp[pre_parts]`);
  filters.push(
    `[${particlesIdx}:v]scale=1920:1080,setsar=1,fps=30,` +
    `colorchannelmixer=rr=1.5:gg=1.5:bb=1.5,format=gbrp[parts]`
  );
  filters.push(`[pre_parts][parts]blend=all_mode=screen:shortest=0,format=yuv420p[with_parts]`);

  // ASS subtitles (optional)
  if (escapedAss) {
    filters.push(`[with_parts]ass='${escapedAss}'[v_subs]`);
  } else {
    filters.push(`[with_parts]null[v_subs]`);
  }

  // Intro black padding + fade-in (optional)
  let videoOutLabel = 'v_subs';
  if (intro > 0) {
    const fadeDur = Math.min(intro, 1.0).toFixed(2);
    filters.push(
      `[v_subs]tpad=start_duration=${intro}:start_mode=add:color=black,` +
      `fade=t=in:st=0:d=${fadeDur}[v]`
    );
    videoOutLabel = 'v';
  } else {
    filters.push(`[v_subs]null[v]`);
    videoOutLabel = 'v';
  }

  // Single audio output — music is already mixed into voiceAudioPath via mixAudio()
  const mapArgs   = `-map "[v]" -map ${voiceIdx}:a`;
  const codecArgs = `-c:v libx264 -preset fast -crf 22 -c:a copy`;

  // Timeout scales with output duration — libx264 fast on 60-min video needs ~90min.
  // Use 2s of timeout per second of content, minimum 10 minutes.
  const composeTimeoutMs = Math.max(600000, d * 2000);
  execSync(
    `ffmpeg -y ${inputs.join(" ")} -filter_complex "${filters.join(";")}" ` +
    `${mapArgs} ${codecArgs} -t ${d} -movflags +faststart "${path.resolve(outputPath)}"`,
    { stdio: "pipe", timeout: composeTimeoutMs }
  );

  console.log(`  Composed: ${outputPath}`);
  return outputPath;
}

// ─── PHILOSOPHY FRAME SET ───────────────────────────────────────────────────
// Generates 10 philosophy frame variants in `framesDir`, each 1920×1080 PNG
// with a transparent center. Styles range from minimal to ornate.
// Returns the array of 10 file paths.

function buildFrameFilters(W, H, cfg) {
  const {
    bw = 52,
    bwH = bw,          // left/right border thickness (defaults to bw)
    bwV = bw,          // top/bottom border thickness (defaults to bw)
    gl = 4,
    gl2 = 0,
    slate = null,
    accent = null,
    cornerSize = 32,
    cornerStroke = 3,
    fleckCount = 180,
    fleckSeed = 77341,
    cornersOnly = false,
  } = cfg;

  const filters = [];

  if (cornersOnly && accent) {
    const la = 52, lt = 5, m = 18;
    filters.push(`drawbox=x=${m}:y=${m}:w=${la}:h=${lt}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${m}:y=${m}:w=${lt}:h=${la}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${W-m-la}:y=${m}:w=${la}:h=${lt}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${W-m-lt}:y=${m}:w=${lt}:h=${la}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${m}:y=${H-m-lt}:w=${la}:h=${lt}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${m}:y=${H-m-la}:w=${lt}:h=${la}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${W-m-la}:y=${H-m-lt}:w=${la}:h=${lt}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${W-m-lt}:y=${H-m-la}:w=${lt}:h=${la}:color=${accent}:t=fill`);
    return filters;
  }

  if (slate) {
    filters.push(`drawbox=x=0:y=0:w=${W}:h=${bwV}:color=${slate}:t=fill`);
    filters.push(`drawbox=x=0:y=${H-bwV}:w=${W}:h=${bwV}:color=${slate}:t=fill`);
    filters.push(`drawbox=x=0:y=${bwV}:w=${bwH}:h=${H-2*bwV}:color=${slate}:t=fill`);
    filters.push(`drawbox=x=${W-bwH}:y=${bwV}:w=${bwH}:h=${H-2*bwV}:color=${slate}:t=fill`);
  }

  if (accent) {
    filters.push(`drawbox=x=${bwH}:y=${bwV}:w=${W-2*bwH}:h=${gl}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${bwH}:y=${H-bwV-gl}:w=${W-2*bwH}:h=${gl}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${bwH}:y=${bwV+gl}:w=${gl}:h=${H-2*bwV-2*gl}:color=${accent}:t=fill`);
    filters.push(`drawbox=x=${W-bwH-gl}:y=${bwV+gl}:w=${gl}:h=${H-2*bwV-2*gl}:color=${accent}:t=fill`);

    if (gl2 > 0) {
      const ix = bwH + gl2, iy = bwV + gl2;
      filters.push(`drawbox=x=${ix}:y=${iy}:w=${W-2*ix}:h=${gl}:color=${accent}:t=fill`);
      filters.push(`drawbox=x=${ix}:y=${H-iy-gl}:w=${W-2*ix}:h=${gl}:color=${accent}:t=fill`);
      filters.push(`drawbox=x=${ix}:y=${iy+gl}:w=${gl}:h=${H-2*iy-2*gl}:color=${accent}:t=fill`);
      filters.push(`drawbox=x=${W-ix-gl}:y=${iy+gl}:w=${gl}:h=${H-2*iy-2*gl}:color=${accent}:t=fill`);
    }

    if (cornerSize > 0) {
      const cs = cornerStroke, sz = cornerSize;
      filters.push(`drawbox=x=${bwH-cs}:y=${bwV-cs}:w=${sz}:h=${sz}:color=${accent}:t=${cs}`);
      filters.push(`drawbox=x=${W-bwH-sz+cs}:y=${bwV-cs}:w=${sz}:h=${sz}:color=${accent}:t=${cs}`);
      filters.push(`drawbox=x=${bwH-cs}:y=${H-bwV-sz+cs}:w=${sz}:h=${sz}:color=${accent}:t=${cs}`);
      filters.push(`drawbox=x=${W-bwH-sz+cs}:y=${H-bwV-sz+cs}:w=${sz}:h=${sz}:color=${accent}:t=${cs}`);
    }

    if (fleckCount > 0) {
      let seed = fleckSeed;
      const lcg = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      const bandH = Math.max(1, bwH - gl - 6);
      const bandV = Math.max(1, bwV - gl - 6);
      for (let i = 0; i < fleckCount; i++) {
        const side = i % 4;
        let x, y;
        if (side === 0) { x = Math.floor(lcg() * W); y = gl + 6 + Math.floor(lcg() * bandV); }
        else if (side === 1) { x = Math.floor(lcg() * W); y = H - bwV + 6 + Math.floor(lcg() * bandV); }
        else if (side === 2) { x = gl + 6 + Math.floor(lcg() * bandH); y = Math.floor(lcg() * H); }
        else { x = W - bwH + 6 + Math.floor(lcg() * bandH); y = Math.floor(lcg() * H); }
        const fw = 1 + Math.floor(lcg() * 2);
        const fh = 1 + Math.floor(lcg() * 2);
        filters.push(`drawbox=x=${x}:y=${y}:w=${fw}:h=${fh}:color=${accent}:t=fill`);
      }
    }
  }

  return filters;
}

function renderFrame(outPath, W, H, filters) {
  if (fileExists(outPath)) return outPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const filterScript = outPath + '.filter.txt';
  fs.writeFileSync(filterScript,
    `[0:v]${filters.join(',')},colorkey=0x000000:0.001:0.0,format=rgba[v]`
  );
  try {
    execSync(
      `ffmpeg -y -f lavfi -i "color=c=black:s=${W}x${H}" ` +
      `-filter_complex_script "${filterScript}" -map "[v]" -frames:v 1 -update 1 "${outPath}"`,
      { stdio: 'pipe', timeout: 60000 }
    );
  } finally {
    try { fs.unlinkSync(filterScript); } catch {}
  }
  return outPath;
}

export function ensurePhilosophyFrameSet(framesDir) {
  fs.mkdirSync(framesDir, { recursive: true });
  const W = 1920, H = 1080;

  // All variants: bwH=96 (left/right), bwV=54 (top/bottom) → inner window 1728×972 centred in 1920×1080
  const VARIANTS = [
    // 01: Classic gold — slate border, burnished gold line, corner squares + flecks
    { name: 'philosophy-frame-01.png', bwH: 96, bwV: 54, gl: 4, slate: '0x110E08@1.0', accent: '0xC8A040@1.0', cornerSize: 32, cornerStroke: 3, fleckCount: 180 },
    // 02: Double line — two concentric gold lines, wider corners, no flecks
    { name: 'philosophy-frame-02.png', bwH: 96, bwV: 54, gl: 3, gl2: 10, slate: '0x110E08@1.0', accent: '0xC8A040@1.0', cornerSize: 36, cornerStroke: 3, fleckCount: 0 },
    // 03: Silver moon — cool slate, silver accent, small corners + cool flecks
    { name: 'philosophy-frame-03.png', bwH: 96, bwV: 54, gl: 3, slate: '0x0D1015@1.0', accent: '0xB0C0D0@1.0', cornerSize: 28, cornerStroke: 3, fleckCount: 160, fleckSeed: 31337 },
    // 04: Thin minimal — very narrow accent line, no corners, no flecks
    { name: 'philosophy-frame-04.png', bwH: 96, bwV: 54, gl: 2, slate: '0x0E0B06@1.0', accent: '0xC8A040@1.0', cornerSize: 0, fleckCount: 0 },
    // 05: Thick ornate — 5px gold line, large 44px corner squares
    { name: 'philosophy-frame-05.png', bwH: 96, bwV: 54, gl: 5, slate: '0x120F0A@1.0', accent: '0xD0A840@1.0', cornerSize: 44, cornerStroke: 4, fleckCount: 220, fleckSeed: 99991 },
    // 06: Corners only — no border ring, just L-bracket corner marks
    { name: 'philosophy-frame-06.png', cornersOnly: true, accent: '0xC8A040@1.0' },
    // 07: Warm amber — dark warm slate, amber gold, extra flecks
    { name: 'philosophy-frame-07.png', bwH: 96, bwV: 54, gl: 4, slate: '0x18100A@1.0', accent: '0xE8A030@1.0', cornerSize: 36, cornerStroke: 3, fleckCount: 200, fleckSeed: 54321 },
    // 08: Cool steel — night-sky slate, steel blue accent
    { name: 'philosophy-frame-08.png', bwH: 96, bwV: 54, gl: 3, slate: '0x0A0E1A@1.0', accent: '0x8898CC@1.0', cornerSize: 28, cornerStroke: 3, fleckCount: 150, fleckSeed: 11111 },
    // 09: Wide gold — double line, generous corners
    { name: 'philosophy-frame-09.png', bwH: 96, bwV: 54, gl: 4, gl2: 12, slate: '0x110E08@1.0', accent: '0xC8A040@1.0', cornerSize: 40, cornerStroke: 4, fleckCount: 200, fleckSeed: 77777 },
    // 10: Rose copper — warm dark with copper accent, romantic feel
    { name: 'philosophy-frame-10.png', bwH: 96, bwV: 54, gl: 4, slate: '0x150B0F@1.0', accent: '0xC87858@1.0', cornerSize: 32, cornerStroke: 3, fleckCount: 180, fleckSeed: 24680 },
  ];

  const paths = [];
  for (const v of VARIANTS) {
    const outPath = path.join(framesDir, v.name);
    paths.push(outPath);
    if (fileExists(outPath)) {
      console.log(`  Frame cached: ${v.name}`);
      continue;
    }
    console.log(`  Generating frame: ${v.name}...`);
    const filters = buildFrameFilters(W, H, v);
    renderFrame(outPath, W, H, filters);
  }
  return paths;
}

// ─── FULL PIPELINE COMPOSITION ──────────────────────────────────────────────

export async function compose(config) {
  const {
    voiceoverPath,
    imagePaths = [],
    clips = null,           // director clips with start_time/end_time/imagePath
    fallbackImage = null,   // used to fill clips with imagePath=null
    assPath = null,
    outputDir,
    introPath = null,
  } = config;

  const duration = getAudioDuration(voiceoverPath);
  console.log(`\n  FFmpeg Composition`);
  console.log(`  Duration: ${Math.round(duration)}s (${(duration / 60).toFixed(1)} min)`);
  if (clips) console.log(`  Clips: ${clips.length} (director-driven)`);
  else console.log(`  Images: ${imagePaths.length} (legacy slideshow)`);

  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: Image slideshow.
  // Prefer director-driven clip slideshow when clips are provided — each
  // image then shows for exactly its clip's duration. Falls back to the
  // legacy fixed-cadence slideshow if clips aren't passed.
  const slideshowPath = path.join(outputDir, "slideshow.mp4");
  if (clips && clips.length > 0) {
    createClipSlideshow(clips, Math.ceil(duration), slideshowPath, { fallbackImage });
  } else {
    createImageSlideshow(imagePaths, Math.ceil(duration), slideshowPath);
  }

  // Step 2: Audio mix
  const mixedAudioPath = path.join(outputDir, "mixed-audio.m4a");
  mixAudio(voiceoverPath, Math.ceil(duration), mixedAudioPath);

  // Step 3: Compose video (slideshow + audio)
  const rawVideoPath = path.join(outputDir, "raw.mp4");
  await composeVideo(slideshowPath, mixedAudioPath, rawVideoPath, duration);

  // Step 4: Prepend intro (if provided)
  // Cannot use `-c copy` concat: the intro has no audio track and a different
  // time_base than raw.mp4, so concat demuxer silently drops the main video
  // stream. Use the concat filter (re-encodes) and synthesize ambient audio
  // (looped fireplace + crickets) for the intro window so it isn't silent.
  let videoForSubs = rawVideoPath;
  if (introPath && fileExists(introPath)) {
    const introDur = getAudioDuration(introPath);
    console.log(`  Prepending intro animation (${introDur.toFixed(1)}s) with ambient audio...`);
    const withIntroPath = path.join(outputDir, "with-intro.mp4");

    // Try to use the seamless SFX loops we already built; fall back to silence.
    const fireSrc = makeSeamlessLoop("assets/sfx/fireplace-cozy-loop.mp3");
    const cricketSrc = makeSeamlessLoop("assets/sfx/night-crickets-loop.mp3");
    const haveFire = fireSrc && fileExists(fireSrc);
    const haveCricket = cricketSrc && fileExists(cricketSrc);

    const inputs = [`-i "${introPath}"`, `-i "${rawVideoPath}"`];
    let introAudioFilter;

    if (haveFire || haveCricket) {
      let nextIdx = 2;
      const ambParts = [];
      if (haveFire) {
        inputs.push(`-stream_loop -1 -t ${introDur.toFixed(2)} -i "${fireSrc}"`);
        ambParts.push({ idx: nextIdx++, vol: "0.08", label: "fire" });
      }
      if (haveCricket) {
        inputs.push(`-stream_loop -1 -t ${introDur.toFixed(2)} -i "${cricketSrc}"`);
        ambParts.push({ idx: nextIdx++, vol: "0.05", label: "cricket" });
      }
      const ambFilters = ambParts
        .map((p) => `[${p.idx}:a]volume=${p.vol}[${p.label}]`)
        .join(";");
      const mixInputs = ambParts.map((p) => `[${p.label}]`).join("");
      const mixCount = ambParts.length;
      introAudioFilter = `${ambFilters};${mixInputs}amix=inputs=${mixCount}:duration=first,atrim=0:${introDur.toFixed(2)},asetpts=PTS-STARTPTS[introAudio]`;
    } else {
      inputs.push(`-f lavfi -t ${introDur.toFixed(2)} -i "anullsrc=channel_layout=stereo:sample_rate=48000"`);
      introAudioFilter = `[2:a]asetpts=PTS-STARTPTS[introAudio]`;
    }

    // Normalize both video streams to identical params before concat
    const filter =
      `${introAudioFilter};` +
      `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v0];` +
      `[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v1];` +
      `[1:a]asetpts=PTS-STARTPTS[a1];` +
      `[v0][introAudio][v1][a1]concat=n=2:v=1:a=1[outv][outa]`;

    execSync(
      `ffmpeg -y ${inputs.join(" ")} -filter_complex "${filter}" ` +
      `-map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 22 -c:a aac -b:a 192k -movflags +faststart "${withIntroPath}"`,
      { stdio: "pipe", timeout: 600000 }
    );

    videoForSubs = withIntroPath;
    console.log(`  Intro prepended: ${withIntroPath}`);
  }

  // Step 5: Burn subtitles (if ASS file provided)
  const finalPath = path.join(outputDir, "final.mp4");
  if (assPath && fileExists(assPath)) {
    console.log("  Burning subtitles...");
    const escapedAss = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
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
