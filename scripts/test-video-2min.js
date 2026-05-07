/**
 * SleepForge 2-minute test video — Polish Pass 3 (May 2026)
 *
 * Full pipeline end-to-end:
 *   1. Start Chatterbox TTS server
 *   2. Generate 2-min script via Claude Haiku (cached)
 *   3. TTS all sentences via Chatterbox archer voice (cached)
 *   4. Whisper word timestamps (cached)
 *   5. Director: sentence → 4s clip windows
 *   6. Generate 2 chalk images per scene via Flux Schnell (cached)
 *   7. Generate philosophy background image via Flux Schnell (cached once)
 *   8. Assign images to clips
 *   9. ASS karaoke subtitles (word-by-word reveal)
 *  10. Fireplace particles + smoke loops (cached)
 *  11. Render 3 Remotion animations (cached), assign to clips at transitions
 *  12. FFmpeg composition:
 *        - createClipSlideshow: static hold + 1.5s crossfades (NO Ken Burns)
 *        - mixAudio: voice + fire + crickets ONLY (no bgmusic — separate stream)
 *        - composeFinalVideoWithBg: bg(15%) + chalk(85%) + particles(screen) +
 *          smoke(screen) + ASS subs + voice(a:0) + bgmusic@30%(a:1)
 *  13. Extract frame at 30s for particle/layer verification
 *  14. Run auto-critic
 *
 * Usage: node scripts/test-video-2min.js
 */
import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

import { generateScript, craftImagePrompt } from '../src/script-generator.js';
import { generateSceneImage }               from '../src/fal.js';
import { generateASS }                      from '../src/subtitles.js';
import { buildTimedClips }                  from '../src/director.js';
import {
  createClipSlideshow,
  mixAudio,
  ensureSmokeLoop,
  ensureParticleLoopLegacy,
  ensurePhilosophyFrame,
  composeFinalVideoWithBg,
  getAudioDuration,
} from '../src/ffmpeg.js';
import { renderAnimation } from '../src/remotion-renderer.js';
import { isHealthy, chatterboxTTS } from '../src/chatterbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_BIN   = process.env.PYTHON_BIN
  || path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');

const TOPIC        = 'Marcus Aurelius on Letting Go of What You Cannot Control';
const DURATION_MIN = 2;
const SLUG         = 'marcus-aurelius-2min';
const OUTPUT_DIR   = path.join(PROJECT_ROOT, 'output', SLUG);
const ASSETS_DIR   = path.join(OUTPUT_DIR, 'assets');
const IMAGES_DIR   = path.join(OUTPUT_DIR, 'images');
const ANIM_DIR     = path.join(OUTPUT_DIR, 'animations');
const SENTENCES_DIR = path.join(ASSETS_DIR, 'sentences');
const SCRIPTS_DIR  = path.join(PROJECT_ROOT, 'scripts');

const VOICEOVER_PATH = path.join(ASSETS_DIR, 'voiceover.wav');
const WHISPER_PATH   = path.join(ASSETS_DIR, 'whisper.json');
const ASS_PATH       = path.join(ASSETS_DIR, 'subtitles.ass');
const SLIDESHOW_PATH = path.join(OUTPUT_DIR, 'slideshow.mp4');
const VOICE_MIX_PATH = path.join(OUTPUT_DIR, 'voice-mix.m4a');   // voice + fire + crickets + bgmusic
const BG_MUSIC_PATH  = path.join(PROJECT_ROOT, 'assets', 'audio', 'bgmusic.mp3');
const FINAL_PATH     = path.join(OUTPUT_DIR, 'final.mp4');
const FRAME_30S_PATH = path.join(OUTPUT_DIR, 'frame-30s.png');
const FRAME_IMG_PATH = path.join(OUTPUT_DIR, 'verify-image-scene.png');
const FRAME_ANIM_PATH= path.join(OUTPUT_DIR, 'verify-animation-scene.png');
const PHILOSOPHY_FRAME_PATH = path.join(PROJECT_ROOT, 'assets', 'frames', 'philosophy-frame.png');

const BG_IMAGE_PATH  = path.join(PROJECT_ROOT, 'assets', 'backgrounds', 'philosophy-bg.png');
const BG_PROMPT      = 'ancient Greek philosophy library at dusk, marble columns, candlelight, ' +
                       'atmospheric, cinematic, no people, no text, soft focus, warm tones, ' +
                       'oil lamps glowing, scroll shelves, stone archways, golden hour light';

const IMGS_PER_SCENE = 2;

// Animations to render and assign — (compositionId → output filename)
const ANIM_POOL = [
  { id: 'RipplesAnimation',        file: 'ripples.mp4',     frames: 90  },
  { id: 'HourglassAnimation',      file: 'hourglass.mp4',   frames: 120 },
  { id: 'PathsDivergingAnimation', file: 'paths.mp4',       frames: 120 },
];

for (const d of [OUTPUT_DIR, ASSETS_DIR, IMAGES_DIR, ANIM_DIR, SENTENCES_DIR]) {
  fs.mkdirSync(d, { recursive: true });
}

const t_pipeline = Date.now();
log('═══════════════════════════════════════════');
log('SleepForge — 2-minute test video (polish pass 4)');
log('Topic: ' + TOPIC);
log('Output: ' + OUTPUT_DIR);
log('═══════════════════════════════════════════');

// Pass 4: Force regeneration of cached files that changed
const PARTICLES_CACHE = path.resolve(PROJECT_ROOT, 'engine/remotion/backgrounds/particles-loop.mp4');
if (fs.existsSync(PARTICLES_CACHE)) {
  log('  Clearing old particles (Pass 4 — larger/brighter embers)...');
  fs.unlinkSync(PARTICLES_CACHE);
}
if (fs.existsSync(SLIDESHOW_PATH)) {
  log('  Clearing old slideshow (Pass 4 — animation fix + bg zoom)...');
  fs.unlinkSync(SLIDESHOW_PATH);
}
if (fs.existsSync(VOICE_MIX_PATH)) {
  log('  Clearing old audio mix (Pass 4 — single track with bgmusic)...');
  fs.unlinkSync(VOICE_MIX_PATH);
}
if (fs.existsSync(FINAL_PATH)) fs.unlinkSync(FINAL_PATH);

// ── Step 1: Start Chatterbox server ──────────────────────────────────────────
log('\n── Step 1: Starting Chatterbox server ──');
const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
const serverProc   = spawn(PYTHON_BIN, [serverScript], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CHATTERBOX_PORT: '4123' },
});
serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
serverProc.on('error', err => log('Chatterbox server error: ' + err.message));

log('  Waiting for model load...');
const serverReady = waitForChatterbox(300);

// ── Step 2: Script ────────────────────────────────────────────────────────────
log(`\n── Step 2: Script generation (Haiku, ${DURATION_MIN} min) ──`);
const scriptJsonPath = path.join(SCRIPTS_DIR, SLUG + '.json');
let scenes;
if (fs.existsSync(scriptJsonPath)) {
  log('  Using cached script: ' + scriptJsonPath);
  scenes = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
} else {
  const result = await generateScript(TOPIC, {
    duration: DURATION_MIN,
    philosophers: ['marcus-aurelius', 'epictetus', 'seneca'],
    output: SCRIPTS_DIR,
  });
  scenes = result.scenes;
  fs.writeFileSync(scriptJsonPath, JSON.stringify(scenes, null, 2));
}
const scriptText = scenes.map(s => s.narration).join('\n\n');
const wordCount  = scriptText.split(/\s+/).length;
log(`  ${scenes.length} scenes, ${wordCount} words (~${Math.round(wordCount / 110)} min)`);

// ── Step 3: Voiceover ─────────────────────────────────────────────────────────
log('\n── Step 3: Chatterbox TTS (archer voice) ──');
if (fs.existsSync(VOICEOVER_PATH)) {
  const dur = getAudioDuration(VOICEOVER_PATH);
  log(`  Cached voiceover: ${dur.toFixed(1)}s`);
} else {
  const healthy = await serverReady;
  if (!healthy) {
    log('  ERROR: Chatterbox server never became healthy — aborting');
    serverProc.kill();
    process.exit(1);
  }
  log('  Chatterbox healthy ✓');

  const sentences = splitSentences(scriptText);
  log(`  ${sentences.length} sentences to synthesize`);

  const ttsStats = { totalAudio: 0, totalElapsed: 0, count: 0 };
  const partPaths = [];
  const silence350 = path.join(ASSETS_DIR, '_silence-350.wav');
  const silence700 = path.join(ASSETS_DIR, '_silence-700.wav');
  ensureSilence(silence350, 350);
  ensureSilence(silence700, 700);

  for (let i = 0; i < sentences.length; i++) {
    const { text, paragraphEnd } = sentences[i];
    const partPath = path.join(SENTENCES_DIR, `s${String(i).padStart(3, '0')}.wav`);
    if (!fs.existsSync(partPath)) {
      const t0 = Date.now();
      await chatterboxTTS(text, partPath);
      const elapsed = (Date.now() - t0) / 1000;
      const dur     = getAudioDuration(partPath);
      ttsStats.totalAudio   += dur;
      ttsStats.totalElapsed += elapsed;
      ttsStats.count++;
      const pct = Math.round(100 * (i + 1) / sentences.length);
      log(`  [${i+1}/${sentences.length}] ${pct}% — ${elapsed.toFixed(1)}s → ${dur.toFixed(1)}s audio`);
    }
    partPaths.push(partPath);
    if (i < sentences.length - 1) {
      partPaths.push(paragraphEnd ? silence700 : silence350);
    }
  }

  if (ttsStats.count > 0) {
    const rt = (ttsStats.totalElapsed / ttsStats.totalAudio).toFixed(2);
    log(`  ◆ Chatterbox: ${rt}x realtime`);
  }

  const concatFile = path.join(ASSETS_DIR, '_concat.txt');
  fs.writeFileSync(concatFile, partPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  execSync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${VOICEOVER_PATH}"`,
    { stdio: 'pipe' }
  );
  fs.unlinkSync(concatFile);
  log(`  Voiceover: ${getAudioDuration(VOICEOVER_PATH).toFixed(1)}s`);
}
const audioDuration = getAudioDuration(VOICEOVER_PATH);

// ── Step 4: Whisper ───────────────────────────────────────────────────────────
log('\n── Step 4: Whisper word timestamps ──');
let wordTimestamps = [];
if (fs.existsSync(WHISPER_PATH)) {
  wordTimestamps = JSON.parse(fs.readFileSync(WHISPER_PATH, 'utf-8'));
  log(`  Cached: ${wordTimestamps.length} words`);
} else {
  log('  Running Whisper base model...');
  const t0 = Date.now();
  const whisperResult = execSync(
    `"${PYTHON_BIN}" -c "` +
      `import whisper,json;` +
      `m=whisper.load_model('base');` +
      `r=m.transcribe(r'${VOICEOVER_PATH}',word_timestamps=True,language='en');` +
      `words=[{'word':w['word'].strip(),'start':round(w['start'],3),'end':round(w['end'],3)}` +
      ` for seg in r['segments'] for w in seg.get('words',[])];` +
      `print(json.dumps(words))"`,
    { encoding: 'utf-8', timeout: 300000 }
  );
  wordTimestamps = JSON.parse(whisperResult.trim());
  fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTimestamps));
  log(`  ${wordTimestamps.length} words in ${((Date.now()-t0)/1000).toFixed(0)}s`);
}

// ── Step 5: Director ──────────────────────────────────────────────────────────
log('\n── Step 5: Director — building clip windows ──');
const clips = buildTimedClips(scenes, wordTimestamps, audioDuration, 4);
log(`  ${clips.length} clips at ~4s each covering ${audioDuration.toFixed(1)}s audio`);

// ── Step 6: Images ────────────────────────────────────────────────────────────
log(`\n── Step 6: Chalk image generation (Flux Schnell, ${IMGS_PER_SCENE}/scene) ──`);
const totalImages  = scenes.length * IMGS_PER_SCENE;
const allImagePaths = [];
const imgJobs = [];

for (let si = 0; si < scenes.length; si++) {
  for (let vi = 0; vi < IMGS_PER_SCENE; vi++) {
    const imgPath = path.join(IMAGES_DIR, `scene-${String(si+1).padStart(3,'0')}-v${vi}.png`);
    allImagePaths.push(imgPath);
    if (!fs.existsSync(imgPath)) {
      imgJobs.push({ si, vi, imgPath, prompt: craftImagePrompt(scenes[si], vi) });
    }
  }
}
log(`  ${totalImages - imgJobs.length} cached, ${imgJobs.length} to generate`);

let imgJobIdx = 0, imgDone = 0;
async function imgWorker() {
  while (true) {
    const j = imgJobs[imgJobIdx++];
    if (!j) return;
    try {
      await generateSceneImage(j.prompt, j.imgPath);
      imgDone++;
      log(`  [${imgDone}/${imgJobs.length}] scene-${j.si+1}-v${j.vi}.png`);
    } catch (err) {
      log(`  [img scene-${j.si+1}-v${j.vi}] FAILED: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 4 }, imgWorker));
log(`  Images done: ${allImagePaths.filter(p => fs.existsSync(p)).length}/${totalImages}`);

// ── Step 7: Philosophy background image ───────────────────────────────────────
log('\n── Step 7: Philosophy background image ──');
if (!fs.existsSync(BG_IMAGE_PATH)) {
  fs.mkdirSync(path.dirname(BG_IMAGE_PATH), { recursive: true });
  log('  Generating via Flux Schnell (one-time, cached)...');
  log(`  Prompt: ${BG_PROMPT.slice(0, 80)}...`);
  await generateSceneImage(BG_PROMPT, BG_IMAGE_PATH);
  log(`  Background: ${BG_IMAGE_PATH}`);
} else {
  log(`  Cached: ${BG_IMAGE_PATH}`);
}

// ── Step 8: Assign images to clips ────────────────────────────────────────────
log('\n── Step 8: Assigning images to clips ──');
const sceneDuration = audioDuration / scenes.length;
const sceneClipCounters = new Array(scenes.length).fill(0);

for (let ci = 0; ci < clips.length; ci++) {
  const mid = (clips[ci].start_time + clips[ci].end_time) / 2;
  const si  = Math.min(scenes.length - 1, Math.floor(mid / sceneDuration));
  const vi  = sceneClipCounters[si] % IMGS_PER_SCENE;
  const imgPath = allImagePaths[si * IMGS_PER_SCENE + vi];
  clips[ci].imagePath = fs.existsSync(imgPath) ? imgPath : null;
  sceneClipCounters[si]++;
}
const firstValidImg = allImagePaths.find(p => fs.existsSync(p));
for (const clip of clips) { if (!clip.imagePath) clip.imagePath = firstValidImg; }
log(`  Assigned: ${clips.filter(c => c.imagePath).length}/${clips.length} clips have images`);

// ── Step 9: ASS subtitles ─────────────────────────────────────────────────────
log('\n── Step 9: ASS karaoke subtitles ──');
// Always regenerate — 2-min script has different word timestamps
if (fs.existsSync(ASS_PATH)) fs.unlinkSync(ASS_PATH);
if (wordTimestamps.length > 0) {
  generateASS(wordTimestamps, ASS_PATH);
  log(`  Generated: ${ASS_PATH}`);
} else {
  log('  No timestamps — skipping subtitles');
}

// ── Step 10: Atmosphere layers + philosophy frame ─────────────────────────────
log('\n── Step 10: Generating atmosphere layers + frame ──');
const particlesPath = ensureParticleLoopLegacy();
log(`  Particles: ${particlesPath}`);
const smokePath = ensureSmokeLoop();
log(`  Smoke: ${smokePath}`);

// Philosophy frame (generated once, cached)
ensurePhilosophyFrame(PHILOSOPHY_FRAME_PATH);
log(`  Frame: ${PHILOSOPHY_FRAME_PATH}`);

// Pre-render bg zoom loop (10s, 30fps) for animation scenes
// zoompan: z oscillates 1.00↔1.04 over 10s. Smooth sub-pixel movement at 30fps.
const BG_ZOOM_PATH = path.join(ANIM_DIR, 'bg-zoom-loop.mp4');
if (!fs.existsSync(BG_ZOOM_PATH) && fs.existsSync(BG_IMAGE_PATH)) {
  log('  Pre-rendering bg zoom loop (10s)...');
  execSync(
    `ffmpeg -y -loop 1 -framerate 30 -t 10 -i "${BG_IMAGE_PATH}" ` +
    `-vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,` +
    `zoompan=z='1.02+0.02*cos(2*PI*on/300)':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':d=1:fps=30:s=1920x1080" ` +
    `-t 10 -c:v libx264 -preset fast -crf 20 -movflags +faststart "${BG_ZOOM_PATH}"`,
    { stdio: 'pipe', timeout: 300000 }
  );
  log(`  Bg zoom loop: ${BG_ZOOM_PATH}`);
} else if (fs.existsSync(BG_ZOOM_PATH)) {
  log(`  Bg zoom loop cached: ${BG_ZOOM_PATH}`);
}

// ── Step 11: Remotion animations ─────────────────────────────────────────────
log('\n── Step 11: Rendering Remotion animations ──');
const renderedAnims = {};
for (const anim of ANIM_POOL) {
  const outPath = path.join(ANIM_DIR, anim.file);
  try {
    await renderAnimation(anim.id, outPath, { durationInFrames: anim.frames });
    renderedAnims[anim.id] = outPath;
  } catch (err) {
    log(`  WARNING: ${anim.id} render failed: ${err.message} — skipping`);
  }
}

// Assign animations to clips at scene-boundary positions (every N clips).
// Animations replace the chalk image for that clip window. They are short
// (3-4s) so they align naturally with single clip durations.
if (Object.keys(renderedAnims).length > 0 && clips.length >= 6) {
  const animKeys = Object.keys(renderedAnims);
  // Place 1 animation per 3 scenes, starting at scene boundary 1
  const sceneTransitionClips = [];
  let prevSi = -1;
  for (let ci = 0; ci < clips.length; ci++) {
    const mid = (clips[ci].start_time + clips[ci].end_time) / 2;
    const si  = Math.min(scenes.length - 1, Math.floor(mid / sceneDuration));
    if (si !== prevSi && si > 0 && si % 2 === 0) {
      sceneTransitionClips.push(ci);
    }
    prevSi = si;
  }
  // Assign at most 3 animations
  const assignCount = Math.min(animKeys.length, sceneTransitionClips.length, 3);
  for (let i = 0; i < assignCount; i++) {
    const ci = sceneTransitionClips[i];
    const animPath = renderedAnims[animKeys[i % animKeys.length]];
    clips[ci].videoPath = animPath;
    clips[ci].imagePath = null; // clear still image for this slot
    log(`  Animation at clip ${ci} (${clips[ci].start_time.toFixed(1)}s): ${path.basename(animPath)}`);
  }
}

// ── Step 12: FFmpeg composition ───────────────────────────────────────────────
log('\n── Step 12: FFmpeg composition ──');

// 12a: Slideshow — animation clips screen-blended over zoomed bg, image clips static
log('  Building clip slideshow (animation scenes: bg zoom + screen blend)...');
const usableClips = clips.filter(c => c.imagePath || c.videoPath);
log(`  Usable clips: ${usableClips.length} (${usableClips.filter(c=>c.videoPath).length} animations, ${usableClips.filter(c=>!c.videoPath).length} images)`);
createClipSlideshow(usableClips, Math.ceil(audioDuration), SLIDESHOW_PATH, {
  fadeTime:    1.5,
  bgVideoPath: fs.existsSync(BG_ZOOM_PATH) ? BG_ZOOM_PATH : null,
});

// 12b: Single mixed audio track — voice (100%) + fire (8%) + bgmusic (25%), no sidechain
log('  Mixing single audio track (voice + fire + bgmusic, no sidechain)...');
mixAudio(VOICEOVER_PATH, Math.ceil(audioDuration), VOICE_MIX_PATH, {
  includeBgMusic:  true,
  bgMusicVolume:   '0.25',
  fireplaceVolume: '0.08',
});

// 12c: Final compose — bg(hidden by 100% chalk) + chalk + particles + smoke + frame + subs
// Single audio track in the output (music already mixed in 12b)
log('  Composing final video (single audio track, frame overlay, animation visible)...');
composeFinalVideoWithBg({
  bgImagePath:    BG_IMAGE_PATH,
  slideshowPath:  SLIDESHOW_PATH,
  particlesPath,
  smokePath,
  assPath:        fs.existsSync(ASS_PATH) ? ASS_PATH : null,
  voiceAudioPath: VOICE_MIX_PATH,
  bgMusicPath:    null,  // already in voiceAudioPath — do NOT add again
  framePath:      fs.existsSync(PHILOSOPHY_FRAME_PATH) ? PHILOSOPHY_FRAME_PATH : null,
  outputPath:     FINAL_PATH,
  duration:       audioDuration,
});

// ── Step 13: Verify with ffprobe + extract verification frames ───────────────
log('\n── Step 13: Verification ──');

const probeOutput = execSync(
  `ffprobe -v quiet -show_streams "${FINAL_PATH}"`,
  { encoding: 'utf-8' }
);
const videoStreams = (probeOutput.match(/codec_type=video/g) || []).length;
const audioStreams = (probeOutput.match(/codec_type=audio/g) || []).length;
log(`  Streams: ${videoStreams} video, ${audioStreams} audio`);
if (audioStreams === 1) {
  log('  ✓ Single audio track confirmed (WMP-compatible)');
} else if (audioStreams === 0) {
  log('  ✗ No audio stream detected!');
} else {
  log(`  ⚠ ${audioStreams} audio streams — expected 1`);
}

// Frame at 30s — proof of layers
const frameTs = Math.min(30, audioDuration * 0.4);
execSync(
  `ffmpeg -y -ss ${frameTs.toFixed(1)} -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_30S_PATH}"`,
  { stdio: 'pipe' }
);
const frameOk = fs.existsSync(FRAME_30S_PATH) && fs.statSync(FRAME_30S_PATH).size > 5000;
log(`  Frame at ${frameTs.toFixed(1)}s: ${frameOk ? FRAME_30S_PATH : 'FAILED'}`);

// Image scene verification — frame from early in video (image clip zone)
try {
  execSync(
    `ffmpeg -y -ss 8 -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_IMG_PATH}"`,
    { stdio: 'pipe' }
  );
  log(`  Image scene frame (8s): ${FRAME_IMG_PATH}`);
} catch {}

// Animation scene verification — find first animation clip's timestamp
const firstAnimClip = usableClips.find(c => c.videoPath);
if (firstAnimClip) {
  const animTs = ((firstAnimClip.start_time + firstAnimClip.end_time) / 2).toFixed(1);
  try {
    execSync(
      `ffmpeg -y -ss ${animTs} -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_ANIM_PATH}"`,
      { stdio: 'pipe' }
    );
    log(`  Animation scene frame (${animTs}s): ${FRAME_ANIM_PATH}`);
  } catch {}
} else {
  log('  No animation clips assigned — animation scene frame skipped');
}

// volumedetect on first 5s — confirm voice is audible (FFmpeg writes to stderr)
try {
  const volOut = execSync(
    `ffmpeg -y -i "${FINAL_PATH}" -t 5 -af "volumedetect" -f null NUL 2>&1`,
    { encoding: 'utf-8' }
  );
  const meanVol = volOut.match(/mean_volume:\s*(-[\d.]+)\s*dB/);
  if (meanVol) log(`  Audio mean (first 5s): ${meanVol[1]} dBFS`);
} catch (e) {
  const combined = (e.stdout || '') + (e.stderr || '') + (e.message || '');
  const meanVol = combined.match(/mean_volume:\s*(-[\d.]+)\s*dB/);
  if (meanVol) log(`  Audio mean (first 5s): ${meanVol[1]} dBFS`);
}

// ── Done ──────────────────────────────────────────────────────────────────────
const finalSize = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);
const elapsed   = Math.round((Date.now() - t_pipeline) / 1000);

log('\n═══════════════════════════════════════════');
log('✅ DONE');
log(`   Video:         ${FINAL_PATH}`);
log(`   Duration:      ${audioDuration.toFixed(1)}s (${(audioDuration/60).toFixed(2)} min)`);
log(`   Clips:         ${clips.length} @ ~4s each`);
log(`   Animations:    ${Object.keys(renderedAnims).length} rendered (${usableClips.filter(c=>c.videoPath).length} in slideshow)`);
log(`   Audio streams: ${audioStreams} (target: 1 — single mixed track)`);
log(`   File size:     ${finalSize} MB`);
log(`   Pipeline:      ${Math.floor(elapsed/60)}m ${elapsed%60}s`);
log(`   Frame 30s:     ${FRAME_30S_PATH}`);
log(`   Verify image:  ${FRAME_IMG_PATH}`);
log(`   Verify anim:   ${FRAME_ANIM_PATH}`);
log('═══════════════════════════════════════════');

serverProc.kill();
process.exit(0);

// ── HELPERS ───────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }

async function waitForChatterbox(timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

function splitSentences(text) {
  const ABBR = /^(Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|etc|Inc|Co|Ltd|B\.C|A\.D|i\.e|e\.g)$/i;
  const paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const out   = [];
  for (let pi = 0; pi < paras.length; pi++) {
    const parts  = paras[pi].replace(/\n+/g, ' ').split(/(?<=[.!?])\s+/);
    const merged = [];
    let buf = '';
    for (const part of parts) {
      buf = buf ? buf + ' ' + part : part;
      const m = buf.match(/(\S+?)\.\s*$/);
      if (m && ABBR.test(m[1])) continue;
      merged.push(buf); buf = '';
    }
    if (buf) merged.push(buf);
    for (let i = 0; i < merged.length; i++) {
      out.push({ text: merged[i].trim(), paragraphEnd: i === merged.length - 1 && pi < paras.length - 1 });
    }
  }
  return out.filter(s => s.text.length > 0);
}

function ensureSilence(outPath, durationMs) {
  if (fs.existsSync(outPath)) return;
  execSync(
    `ffmpeg -y -f lavfi -i "anullsrc=channel_layout=mono:sample_rate=24000" ` +
    `-t ${(durationMs / 1000).toFixed(3)} -c:a pcm_s16le "${outPath}"`,
    { stdio: 'pipe' }
  );
}
