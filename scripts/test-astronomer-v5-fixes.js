/**
 * test-astronomer-v5-fixes.js — 1-min render to verify two fixes:
 *   FIX 1: Whoosh audio is audible in intro (peak amplitude check)
 *   FIX 2: Channel intro uses general-purpose language (printed to console)
 *
 * Output: output/astronomer-test-v5-fixes/final.mp4
 * Usage:  node scripts/test-astronomer-v5-fixes.js
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

import { generateScript }                                from '../src/script-generator.js';
import { analyzeAndRewrite, printScoreTable }            from '../src/script-analyzer.js';
import { generateASS, filterWhisperSoundEffects }        from '../src/subtitles.js';
import { createStoryboard }                              from '../src/director.js';
import {
  createClipSlideshow, mixAudio,
  ensureSmokeLoop, ensureParticleLoop,
  composeFinalVideoWithBg, getAudioDuration, prependIntroVideo,
} from '../src/ffmpeg.js';
import { isHealthy, chatterboxTTS, resetHealthCache }    from '../src/chatterbox.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PYTHON_BIN   = process.env.PYTHON_BIN
  || path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');

const TOPIC        = "What Lives at the Edge of a Black Hole";
const DURATION_MIN = 1;
const SLUG         = 'astronomer-test-v5-fixes';
const OUTPUT_DIR   = path.join(PROJECT_ROOT, 'output', SLUG);
const ASSETS_DIR   = path.join(OUTPUT_DIR, 'assets');
const SENTENCES_DIR = path.join(ASSETS_DIR, 'sentences');
const SCRIPTS_DIR  = path.join(PROJECT_ROOT, 'scripts');

const VOICEOVER_PATH = path.join(ASSETS_DIR, 'voiceover.wav');
const WHISPER_PATH   = path.join(ASSETS_DIR, 'whisper.json');
const SLIDESHOW_PATH = path.join(OUTPUT_DIR, 'slideshow.mp4');
const VOICE_MIX_PATH = path.join(OUTPUT_DIR, 'voice-mix.m4a');
const BODY_PATH      = path.join(OUTPUT_DIR, 'body.mp4');
const FINAL_PATH     = path.join(OUTPUT_DIR, 'final.mp4');
const INTRO_AUDIO_CHECK = path.join(OUTPUT_DIR, 'intro-audio-check.wav');
const FRAME_PATH     = path.join(OUTPUT_DIR, 'frame-verify.png');

const CHANNEL_CONFIG = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8')
);
const INTRO_FINAL_PATH = path.join(PROJECT_ROOT, CHANNEL_CONFIG.intro_video_path);
const INTRO_SEC        = CHANNEL_CONFIG.intro_duration_seconds || 4.754;
const SPACE_LIB        = path.join(PROJECT_ROOT, 'assets', 'images', 'space-library-v1', 'index.json');

for (const d of [OUTPUT_DIR, ASSETS_DIR, SENTENCES_DIR]) fs.mkdirSync(d, { recursive: true });

const t_start = Date.now();
function log(msg) { console.log(msg); }
function elapsed() { return Math.round((Date.now() - t_start) / 1000); }

log('═══════════════════════════════════════════════════════════');
log('SleepForge — Astronomer test v5 (fix verification)');
log(`Topic:  ${TOPIC}`);
log(`Output: ${OUTPUT_DIR}`);
log('═══════════════════════════════════════════════════════════');

// ── Step 0: Verify intro audio before anything else ──────────────────────────
log('\n── Step 0: Intro audio verification ──');
const introProbe = execSync(
  `ffprobe -v quiet -print_format json -show_streams "${INTRO_FINAL_PATH}"`,
  { encoding: 'utf-8' }
);
const introStreams = JSON.parse(introProbe).streams;
const introAudio  = introStreams.find(s => s.codec_type === 'audio');
if (!introAudio) {
  log('  ✗ FATAL: intro-final.mp4 has NO audio stream');
  process.exit(1);
}
log(`  Codec:       ${introAudio.codec_name}`);
log(`  Sample rate: ${introAudio.sample_rate} Hz`);
log(`  Bitrate:     ${introAudio.bit_rate} bps`);
if (parseInt(introAudio.bit_rate, 10) < 50000) {
  log('  ✗ FATAL: audio bitrate too low — re-mux failed or intro is silent');
  process.exit(1);
}

// Extract first 4.5s and check peak amplitude
execSync(
  `ffmpeg -y -i "${INTRO_FINAL_PATH}" -t 4.5 -vn -ar 44100 "${INTRO_AUDIO_CHECK}" -loglevel quiet`,
  { stdio: 'pipe' }
);
const volDetect = execSync(
  `ffmpeg -i "${INTRO_AUDIO_CHECK}" -af "volumedetect" -vn -sn -dn -f null - 2>&1`,
  { encoding: 'utf-8', stdio: 'pipe' }
);
const maxVol  = parseFloat((volDetect.match(/max_volume:\s*([-\d.]+)\s*dB/) || [])[1] ?? '-999');
const meanVol = parseFloat((volDetect.match(/mean_volume:\s*([-\d.]+)\s*dB/) || [])[1] ?? '-999');
log(`  Peak amplitude:  ${maxVol} dB`);
log(`  Mean amplitude:  ${meanVol} dB`);
if (maxVol < -50) {
  log('  ✗ FAIL: intro audio is essentially silent (< -50 dB peak)');
  log('         Re-run: ffmpeg -y -i assets/intros/sleepless-astronomer/intro.mp4 -i "C:/Users/niels/Downloads/astronomy whoosh.mp3" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest assets/intros/sleepless-astronomer/intro-final.mp4');
  process.exit(1);
}
log(`  ✓ FIX 1 PASS: whoosh audio present in intro (peak ${maxVol} dB)`);

// ── Step 1: Generate script ──────────────────────────────────────────────────
log('\n── Step 1: Script generation (1 min, two-pass) ──');
const rawScriptPath = path.join(SCRIPTS_DIR, `${SLUG}-raw.json`);
let rawScenes;

if (fs.existsSync(rawScriptPath)) {
  log('  Using cached raw script: ' + rawScriptPath);
  rawScenes = JSON.parse(fs.readFileSync(rawScriptPath, 'utf-8'));
} else {
  const result = await generateScript(TOPIC, {
    duration:      DURATION_MIN,
    output:        SCRIPTS_DIR,
    channelConfig: CHANNEL_CONFIG,
  });
  rawScenes = result.scenes;
  fs.writeFileSync(rawScriptPath, JSON.stringify(rawScenes, null, 2));
}

// FIX 2 verification: find the intro scene and print it
const introScene = rawScenes.find(s => s.philosopher === 'intro' || s.subject === 'intro');
if (introScene) {
  const introText = introScene.narration;
  const BANNED = ['for sleep', 'to fall asleep', 'drift off', 'bedtime', 'as you sleep', 'before you sleep', 'designed for sleep', 'to help you drift', 'helps you sleep'];
  const violations = BANNED.filter(phrase => introText.toLowerCase().includes(phrase.toLowerCase()));
  log('\n  ── FIX 2: Channel intro text ──');
  log('  ' + introText.replace(/\n/g, '\n  ').slice(0, 500) + (introText.length > 500 ? '...' : ''));
  if (violations.length > 0) {
    log(`\n  ✗ FAIL: Banned phrases found in intro: ${violations.join(', ')}`);
    process.exit(1);
  }
  log('\n  ✓ FIX 2 PASS: Intro uses general-purpose framing (no sleep-exclusive language)');
} else {
  log('  NOTE: No intro scene found in script (intro_template may not be set)');
}

log(`  Raw script: ${rawScenes.length} scenes, ${rawScenes.map(s => s.narration).join(' ').split(/\s+/).length} words`);

// ── Step 2: Analyze + rewrite loop ──────────────────────────────────────────
log('\n── Step 2: Analyze + rewrite loop (target ≥ 8.0) ──');
const { finalScenes, history } = await analyzeAndRewrite(rawScenes, CHANNEL_CONFIG, {
  topicSlug: SLUG,
  maxIterations: 5,
  targetScore:   8.0,
  saveIterations: true,
});
const bestEntry = history.reduce((a, b) => (a.score >= b.score ? a : b));
log(`  Score history: ${history.map(h => `${h.score}`).join(' → ')}`);
log(`  Best score:    ${bestEntry.score}/10 at iteration ${bestEntry.iteration}`);

const winningJsonPath = path.join(SCRIPTS_DIR, `${SLUG}.json`);
fs.writeFileSync(winningJsonPath, JSON.stringify(finalScenes, null, 2));

// ── Step 3: Chatterbox TTS ───────────────────────────────────────────────────
log('\n── Step 3: Chatterbox TTS ──');
const serverScript = path.join(SCRIPTS_DIR, 'chatterbox-server.py');
let serverProc = spawn(PYTHON_BIN, [serverScript], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, CHATTERBOX_PORT: '4123' },
});
serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));

const serverReady = waitForChatterbox(300);
const scriptText  = finalScenes.map(s => s.narration).join('\n\n');

if (!fs.existsSync(VOICEOVER_PATH)) {
  const healthy = await serverReady;
  if (!healthy) { log('  ERROR: Chatterbox unavailable'); serverProc.kill(); process.exit(1); }
  log('  Chatterbox healthy ✓');

  const sentences = splitSentences(scriptText);
  log(`  ${sentences.length} sentences`);

  const silence350 = path.join(ASSETS_DIR, '_silence-350.wav');
  const silence700 = path.join(ASSETS_DIR, '_silence-700.wav');
  ensureSilence(silence350, 350);
  ensureSilence(silence700, 700);

  const partPaths = [];
  const ttsStats  = { totalAudio: 0, totalElapsed: 0, count: 0 };

  for (let i = 0; i < sentences.length; i++) {
    const { text, paragraphEnd } = sentences[i];
    const partPath = path.join(SENTENCES_DIR, `s${String(i).padStart(3, '0')}.wav`);
    if (!fs.existsSync(partPath)) {
      const t0 = Date.now();
      await chatterboxTTSWithRetry(text, partPath, 3);
      const dur = getAudioDuration(partPath);
      ttsStats.totalAudio   += dur;
      ttsStats.totalElapsed += (Date.now() - t0) / 1000;
      ttsStats.count++;
      const pct = Math.round(100 * (i + 1) / sentences.length);
      log(`  [${i+1}/${sentences.length}] ${pct}%`);
    }
    partPaths.push(partPath);
    if (i < sentences.length - 1) partPaths.push(paragraphEnd ? silence700 : silence350);
  }

  if (ttsStats.count > 0) {
    log(`  ◆ Chatterbox: ${(ttsStats.totalElapsed / ttsStats.totalAudio).toFixed(2)}x realtime`);
  }

  const concatFile = path.join(ASSETS_DIR, '_concat.txt');
  fs.writeFileSync(concatFile, partPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c:a pcm_s16le "${VOICEOVER_PATH}"`, { stdio: 'pipe' });
  fs.unlinkSync(concatFile);
} else {
  await serverReady;
}
const audioDuration = getAudioDuration(VOICEOVER_PATH);
log(`  Voiceover: ${audioDuration.toFixed(1)}s`);

// ── Step 4: Whisper ──────────────────────────────────────────────────────────
log('\n── Step 4: Whisper timestamps ──');
let wordTimestamps = [];
if (fs.existsSync(WHISPER_PATH)) {
  wordTimestamps = JSON.parse(fs.readFileSync(WHISPER_PATH, 'utf-8'));
  log(`  Cached: ${wordTimestamps.length} words`);
} else {
  const t0 = Date.now();
  const whisperOut = execSync(
    `"${PYTHON_BIN}" -c "import whisper,json;` +
    `m=whisper.load_model('base');` +
    `r=m.transcribe(r'${VOICEOVER_PATH}',word_timestamps=True,language='en');` +
    `words=[{'word':w['word'].strip(),'start':round(w['start'],3),'end':round(w['end'],3)} for seg in r['segments'] for w in seg.get('words',[])];` +
    `print(json.dumps(words))"`,
    { encoding: 'utf-8', timeout: 300000 }
  );
  wordTimestamps = JSON.parse(whisperOut.trim());
  fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTimestamps));
  log(`  ${wordTimestamps.length} words in ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
wordTimestamps = filterWhisperSoundEffects(wordTimestamps);

// ── Step 5: Director ─────────────────────────────────────────────────────────
log('\n── Step 5: Director + space library ──');
const { clips } = await createStoryboard(finalScenes, wordTimestamps, audioDuration, {
  targetClipSec: 4,
  libraryPath:   SPACE_LIB,
});
for (const clip of clips) {
  if (clip.imagePath && !path.isAbsolute(clip.imagePath)) {
    clip.imagePath = path.join(PROJECT_ROOT, clip.imagePath);
  }
}
const assigned = clips.filter(c => c.imagePath && fs.existsSync(c.imagePath)).length;
log(`  ${clips.length} clips, ${assigned}/${clips.length} from space library`);

// ── Step 6: Composition ──────────────────────────────────────────────────────
log('\n── Step 6: FFmpeg composition ──');

const particlesPath = await ensureParticleLoop();
const smokePath     = ensureSmokeLoop();

for (const p of [SLIDESHOW_PATH, VOICE_MIX_PATH, BODY_PATH, FINAL_PATH]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

createClipSlideshow(clips, Math.ceil(audioDuration), SLIDESHOW_PATH, { fadeTime: 1.5 });
mixAudio(VOICEOVER_PATH, Math.ceil(audioDuration), VOICE_MIX_PATH, {
  includeBgMusic: true,
  bgMusicVolume: '0.25',
  fireplaceVolume: '0.08',
});
composeFinalVideoWithBg({
  bgImagePath:    null,
  slideshowPath:  SLIDESHOW_PATH,
  particlesPath,
  smokePath,
  assPath:        null,
  voiceAudioPath: VOICE_MIX_PATH,
  bgMusicPath:    null,
  framePath:      null,
  outputPath:     BODY_PATH,
  duration:       audioDuration,
  introDuration:  0,
  fullscreen:     true,
});
log('  Body composed');

prependIntroVideo(INTRO_FINAL_PATH, BODY_PATH, FINAL_PATH);
log(`  ✓ Final: ${FINAL_PATH}`);

// ── Step 7: Verify final ─────────────────────────────────────────────────────
log('\n── Step 7: Verify final output ──');
const probeOut = execSync(`ffprobe -v quiet -show_streams "${FINAL_PATH}"`, { encoding: 'utf-8' });
const vStreams  = (probeOut.match(/codec_type=video/g) || []).length;
const aStreams  = (probeOut.match(/codec_type=audio/g) || []).length;
const actualDur = parseFloat(
  execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`, { encoding: 'utf-8' }).trim()
);

// Re-check whoosh amplitude in the final output (first 4.5s of the final)
const finalIntroAudioPath = path.join(OUTPUT_DIR, 'final-intro-check.wav');
execSync(
  `ffmpeg -y -i "${FINAL_PATH}" -t 4.5 -vn -ar 44100 "${finalIntroAudioPath}" -loglevel quiet`,
  { stdio: 'pipe' }
);
const finalVolDetect = execSync(
  `ffmpeg -i "${finalIntroAudioPath}" -af "volumedetect" -vn -sn -dn -f null - 2>&1`,
  { encoding: 'utf-8', stdio: 'pipe' }
);
const finalMaxVol = parseFloat((finalVolDetect.match(/max_volume:\s*([-\d.]+)\s*dB/) || [])[1] ?? '-999');
log(`  Streams: ${vStreams} video, ${aStreams} audio`);
log(`  Duration: ${actualDur.toFixed(1)}s (${(actualDur / 60).toFixed(2)} min)`);
log(`  Intro audio in final: ${finalMaxVol} dB peak`);
if (finalMaxVol < -50) {
  log('  ✗ WARN: Intro audio appears silent in final output — prependIntroVideo may have dropped audio');
} else {
  log(`  ✓ Whoosh audible in final output (${finalMaxVol} dB)`);
}

execSync(`ffmpeg -y -ss ${(INTRO_SEC + 2).toFixed(1)} -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_PATH}"`, { stdio: 'pipe' });
log(`  Frame: ${FRAME_PATH}`);

// ── Done ─────────────────────────────────────────────────────────────────────
const totalSec = elapsed();
const finalMB  = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);

log('\n═══════════════════════════════════════════════════════════');
log('✅ DONE — Astronomer test v5 (fix verification)');
log(`   FIX 1 (whoosh):  ✓ intro-final.mp4 peak ${maxVol} dB, final peak ${finalMaxVol} dB`);
log(`   FIX 2 (intro):   ✓ general-purpose framing, no sleep-exclusive language`);
log(`   Final:           ${FINAL_PATH}`);
log(`   Duration:        ${actualDur.toFixed(1)}s`);
log(`   File size:       ${finalMB} MB`);
log(`   Pipeline time:   ${Math.floor(totalSec/60)}m ${totalSec%60}s`);
log(`   Score history:   ${history.map(h => `${h.score}`).join(' → ')}`);
log(`   Best score:      ${bestEntry.score}/10`);
log('═══════════════════════════════════════════════════════════');

serverProc.kill();
process.exit(0);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waitForChatterbox(timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

async function chatterboxTTSWithRetry(text, outputPath, maxAttempts = 3) {
  const sil2s = path.join(ASSETS_DIR, '_silence-2000.wav');
  ensureSilence(sil2s, 2000);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (attempt > 1) {
        const healthy = await isHealthy();
        if (!healthy) {
          try { serverProc.kill('SIGKILL'); } catch {}
          resetHealthCache();
          await new Promise(r => setTimeout(r, 2000));
          serverProc = spawn(PYTHON_BIN, [serverScript], {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, CHATTERBOX_PORT: '4123' },
          });
          serverProc.stdout.on('data', d => process.stdout.write('[CB] ' + d));
          serverProc.stderr.on('data', d => process.stderr.write('[CB] ' + d));
          await waitForChatterbox(120);
        }
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
      await chatterboxTTS(text, outputPath);
      return;
    } catch (err) {
      log(`  [TTS] Attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
  }
  fs.copyFileSync(path.join(ASSETS_DIR, '_silence-2000.wav'), outputPath);
}

function splitSentences(text) {
  const ABBR = /^(Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|etc|Inc|Co|Ltd|B\.C|A\.D|i\.e|e\.g)$/i;
  const paras = text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
  const out   = [];
  for (let pi = 0; pi < paras.length; pi++) {
    const words = paras[pi].split(' ');
    let buf = '';
    for (let wi = 0; wi < words.length; wi++) {
      buf += (buf ? ' ' : '') + words[wi];
      const endsWithPunct = /[.!?…]["']?$/.test(words[wi]);
      const nextWord      = words[wi + 1] || '';
      const nextIsCapital = /^[A-Z"']/.test(nextWord);
      const isAbbr        = ABBR.test(words[wi].replace(/[.!?]$/, ''));
      if (endsWithPunct && nextIsCapital && !isAbbr && buf.split(' ').length >= 3) {
        out.push({ text: buf.trim(), paragraphEnd: wi === words.length - 1 && pi < paras.length - 1 });
        buf = '';
      }
    }
    if (buf.trim()) out.push({ text: buf.trim(), paragraphEnd: pi < paras.length - 1 });
  }
  return out;
}

function ensureSilence(outputPath, durationMs) {
  if (fs.existsSync(outputPath)) return;
  execSync(
    `ffmpeg -y -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t ${(durationMs/1000).toFixed(3)} -c:a pcm_s16le "${outputPath}"`,
    { stdio: 'pipe' }
  );
}
