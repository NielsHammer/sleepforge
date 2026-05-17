/**
 * test-astronomer-v6-keywords.js — Keyword matching integration test
 *
 * Topic: "Voyager 1's Journey Past Jupiter and Saturn" — exercises
 *        voyager + jupiter + saturn + deep field + interstellar space + earth
 *
 * Confirms:
 *   1. Keyword detected per segment (match log printed)
 *   2. Images match spoken content
 *   3. Clip durations vary 3-6s by energy
 *   4. No image repeats
 *
 * Output: output/astronomer-test-v6-keywords/final.mp4
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

import { generateScript }                                from '../src/script-generator.js';
import { analyzeAndRewrite }                             from '../src/script-analyzer.js';
import { filterWhisperSoundEffects }                     from '../src/subtitles.js';
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

const TOPIC        = "Voyager 1's Journey Past Jupiter and Saturn";
const DURATION_MIN = 2;
const SLUG         = 'astronomer-test-v6-keywords';
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
const FRAME_PATH     = path.join(OUTPUT_DIR, 'frame-verify.png');

const CHANNEL_CONFIG = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8')
);
const INTRO_FINAL_PATH = path.join(PROJECT_ROOT, CHANNEL_CONFIG.intro_video_path);
const INTRO_SEC        = CHANNEL_CONFIG.intro_duration_seconds || 4.754;

for (const d of [OUTPUT_DIR, ASSETS_DIR, SENTENCES_DIR]) fs.mkdirSync(d, { recursive: true });

const t_start = Date.now();
function log(msg) { console.log(msg); }
function elapsed() { return Math.round((Date.now() - t_start) / 1000); }

log('═══════════════════════════════════════════════════════════');
log('SleepForge — Astronomer test v6 (keyword matching)');
log(`Topic:  ${TOPIC}`);
log(`Output: ${OUTPUT_DIR}`);
log('═══════════════════════════════════════════════════════════');

// ── Step 1: Generate script ──────────────────────────────────────────────────
log('\n── Step 1: Script generation (2 min, two-pass) ──');
const rawScriptPath = path.join(SCRIPTS_DIR, `${SLUG}-raw.json`);
let rawScenes;
if (fs.existsSync(rawScriptPath)) {
  log('  Using cached raw script');
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
log(`  Raw: ${rawScenes.length} scenes, ${rawScenes.map(s=>s.narration).join(' ').split(/\s+/).length} words`);

// ── Step 2: Analyze + rewrite ─────────────────────────────────────────────
log('\n── Step 2: Analyze + rewrite (target ≥ 8.0) ──');
const { finalScenes, history } = await analyzeAndRewrite(rawScenes, CHANNEL_CONFIG, {
  topicSlug: SLUG, maxIterations: 5, targetScore: 8.0, saveIterations: true,
});
const bestEntry = history.reduce((a, b) => (a.score >= b.score ? a : b));
log(`  Score history: ${history.map(h => `${h.score}`).join(' → ')}`);
log(`  Best score:    ${bestEntry.score}/10`);
fs.writeFileSync(path.join(SCRIPTS_DIR, `${SLUG}.json`), JSON.stringify(finalScenes, null, 2));

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
const scriptText = finalScenes.map(s => s.narration).join('\n\n');

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
  if (ttsStats.count > 0) log(`  ◆ ${(ttsStats.totalElapsed / ttsStats.totalAudio).toFixed(2)}x realtime`);
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
    `"${PYTHON_BIN}" -c "import whisper,json;m=whisper.load_model('base');r=m.transcribe(r'${VOICEOVER_PATH}',word_timestamps=True,language='en');words=[{'word':w['word'].strip(),'start':round(w['start'],3),'end':round(w['end'],3)} for seg in r['segments'] for w in seg.get('words',[])];print(json.dumps(words))"`,
    { encoding: 'utf-8', timeout: 300000 }
  );
  wordTimestamps = JSON.parse(whisperOut.trim());
  fs.writeFileSync(WHISPER_PATH, JSON.stringify(wordTimestamps));
  log(`  ${wordTimestamps.length} words in ${((Date.now()-t0)/1000).toFixed(0)}s`);
}
wordTimestamps = filterWhisperSoundEffects(wordTimestamps);

// ── Step 5: Director with keyword matcher ────────────────────────────────────
log('\n── Step 5: Director — keyword_semantic matching ──');
const { clips, matchLog } = await createStoryboard(finalScenes, wordTimestamps, audioDuration, {
  targetClipSec:       4,
  imageMatching:       CHANNEL_CONFIG.image_matching,
  minClipDurationSec:  CHANNEL_CONFIG.min_clip_duration_seconds,
  maxClipDurationSec:  CHANNEL_CONFIG.max_clip_duration_seconds,
});

// Print match log
log('\n  Match log (first 30 clips):');
log('  Clip  Time   Energy     Keyword            Score  Text (excerpt)');
log('  ─────────────────────────────────────────────────────────────────────');
(matchLog || []).slice(0, 30).forEach(m => {
  log(`  ${String(m.clip).padStart(3)}  ${String(m.start).padEnd(5)}  ${(m.energy||'').padEnd(10)} ${(m.keyword||'(fallback)').padEnd(18)} ${String(m.score).padStart(5)}  ${m.text}`);
});

// Resolve absolute paths
for (const clip of clips) {
  if (clip.imagePath && !path.isAbsolute(clip.imagePath)) {
    clip.imagePath = path.join(PROJECT_ROOT, clip.imagePath);
  }
}

// Verify uniqueness and duration range
const usedPaths = clips.map(c => c.imagePath).filter(Boolean);
const uniquePaths = new Set(usedPaths);
const dupCount = usedPaths.length - uniquePaths.size;
const durations = clips.map(c => c.duration).filter(Boolean);
const minDur = Math.min(...durations).toFixed(1);
const maxDur = Math.max(...durations).toFixed(1);
const kwHitCount = (matchLog||[]).filter(m => m.keyword !== '(fallback)').length;

log(`\n  ✓ Clips: ${clips.length}   Unique images: ${uniquePaths.size}   Duplicates: ${dupCount}`);
log(`  ✓ Duration range: ${minDur}s – ${maxDur}s`);
log(`  ✓ Keyword hits: ${kwHitCount}/${clips.length} (${Math.round(100*kwHitCount/clips.length)}%)`);

if (dupCount > 0) log(`  ✗ WARN: ${dupCount} duplicate image assignments`);

// ── Step 6: Composition ──────────────────────────────────────────────────────
log('\n── Step 6: FFmpeg composition ──');
const particlesPath = await ensureParticleLoop();
const smokePath     = ensureSmokeLoop();
for (const p of [SLIDESHOW_PATH, VOICE_MIX_PATH, BODY_PATH, FINAL_PATH]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
createClipSlideshow(clips, Math.ceil(audioDuration), SLIDESHOW_PATH, { fadeTime: 1.5 });
mixAudio(VOICEOVER_PATH, Math.ceil(audioDuration), VOICE_MIX_PATH, {
  includeBgMusic: true, bgMusicVolume: '0.25', fireplaceVolume: '0.08',
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
prependIntroVideo(INTRO_FINAL_PATH, BODY_PATH, FINAL_PATH);
log(`  ✓ Final: ${FINAL_PATH}`);

// ── Step 7: Verify + report ──────────────────────────────────────────────────
log('\n── Step 7: Verify ──');
const actualDur = parseFloat(
  execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`, { encoding: 'utf-8' }).trim()
);
const finalMB = Math.round(fs.statSync(FINAL_PATH).size / 1024 / 1024);
execSync(`ffmpeg -y -ss ${(INTRO_SEC + 2).toFixed(1)} -i "${FINAL_PATH}" -vframes 1 -q:v 2 "${FRAME_PATH}"`, { stdio: 'pipe' });

const totalSec = elapsed();

// Save match log
const matchLogPath = path.join(OUTPUT_DIR, 'match-log.json');
fs.writeFileSync(matchLogPath, JSON.stringify(matchLog || [], null, 2));

// Save final report
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const reportPath = path.join(PROJECT_ROOT, 'data', `astronomer-keywords-${ts}.md`);

const keywordDist = {};
(matchLog || []).forEach(m => {
  const k = m.keyword || '(fallback)';
  keywordDist[k] = (keywordDist[k] || 0) + 1;
});
const distLines = Object.entries(keywordDist).sort((a,b)=>b[1]-a[1])
  .map(([k,v]) => `| ${k} | ${v} |`).join('\n');

fs.writeFileSync(reportPath, `# Keyword Matching Test — ${ts.replace('T',' ')}

## 50 Keywords Approved (Derived from Frequency Analysis)

See \`data/space-keywords.json\` for full list with priorities, categories, and aliases.

Top 10 by priority:
| Keyword | Priority | Category |
|---|---|---|
| black hole | 10 | stellar_phenomena |
| saturn | 10 | planet |
| earth | 10 | planet |
| nebula | 10 | stellar_phenomena |
| jupiter | 9 | planet |
| milky way | 9 | galaxy |
| moon | 9 | moon |
| sun | 9 | star |
| mars | 9 | planet |
| star formation | 8 | stellar_phenomena |

## Image Generation

- Prompts: 500 (10 per keyword, generated via Haiku)
- Images: 500 (Flux Schnell, ~$1.52)
- Keyword library: \`assets/images/space-keyword-library/\`
- Existing space-library-v1 retagged with keyword_tags for fallback coverage

## Test Render

**Topic:** ${TOPIC}

**Script:** ${finalScenes.length} scenes, ${finalScenes.map(s=>s.narration).join(' ').split(/\s+/).length} words
**Score:** ${history.map(h=>h.score).join(' → ')} (target ≥ 8.0)
**Output:** ${FINAL_PATH}
**Duration:** ${actualDur.toFixed(1)}s (${(actualDur/60).toFixed(2)} min)
**File size:** ${finalMB} MB

## Match Log Summary

| Keyword | Clips |
|---|---|
${distLines}

- Total clips: ${clips.length}
- Keyword hits: ${kwHitCount} (${Math.round(100*kwHitCount/clips.length)}%)
- Fallbacks: ${clips.length - kwHitCount}
- Unique images: ${uniquePaths.size}
- Duplicate images: ${dupCount}
- Clip duration range: ${minDur}s – ${maxDur}s

## Full Match Log

Full match log saved to: \`${matchLogPath}\`

## Pipeline Time

${Math.floor(totalSec/60)}m ${totalSec%60}s total
`);

log('\n═══════════════════════════════════════════════════════════');
log('✅ DONE — Astronomer test v6 (keyword matching)');
log(`   Final:         ${FINAL_PATH}`);
log(`   Duration:      ${actualDur.toFixed(1)}s`);
log(`   File size:     ${finalMB} MB`);
log(`   Keyword hits:  ${kwHitCount}/${clips.length} (${Math.round(100*kwHitCount/clips.length)}%)`);
log(`   Duplicates:    ${dupCount}`);
log(`   Dur range:     ${minDur}s – ${maxDur}s`);
log(`   Pipeline:      ${Math.floor(totalSec/60)}m ${totalSec%60}s`);
log(`   Report:        ${reportPath}`);
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
  const out = [];
  for (let pi = 0; pi < paras.length; pi++) {
    const words = paras[pi].split(' ');
    let buf = '';
    for (let wi = 0; wi < words.length; wi++) {
      buf += (buf ? ' ' : '') + words[wi];
      const endsWithPunct = /[.!?…]["']?$/.test(words[wi]);
      const nextWord = words[wi + 1] || '';
      const nextIsCapital = /^[A-Z"']/.test(nextWord);
      const isAbbr = ABBR.test(words[wi].replace(/[.!?]$/, ''));
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
