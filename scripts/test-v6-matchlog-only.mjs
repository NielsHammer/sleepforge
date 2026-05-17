/**
 * Quick match-log test — uses all cached data, no TTS/render.
 * Verifies keyword library images are being selected.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createStoryboard } from '../src/director.js';
import { filterWhisperSoundEffects } from '../src/subtitles.js';
import { getAudioDuration } from '../src/ffmpeg.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SLUG = 'astronomer-test-v6-keywords';
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output', SLUG);
const ASSETS_DIR = path.join(OUTPUT_DIR, 'assets');

const CHANNEL_CONFIG = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'channels', 'sleepless-astronomer.json'), 'utf-8')
);

const finalScenes = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, 'scripts', `${SLUG}.json`), 'utf-8')
);
const whisperPath = path.join(ASSETS_DIR, 'whisper.json');
let wordTimestamps = JSON.parse(fs.readFileSync(whisperPath, 'utf-8'));
wordTimestamps = filterWhisperSoundEffects(wordTimestamps);
const audioDuration = getAudioDuration(path.join(ASSETS_DIR, 'voiceover.wav'));

console.log('Script scenes:', finalScenes.length, '  Words:', finalScenes.map(s=>s.narration).join(' ').split(/\s+/).length);
console.log('Audio:', audioDuration.toFixed(1) + 's   Whisper words:', wordTimestamps.length);

const { clips, matchLog } = await createStoryboard(finalScenes, wordTimestamps, audioDuration, {
  targetClipSec:      4,
  imageMatching:      CHANNEL_CONFIG.image_matching,
  minClipDurationSec: CHANNEL_CONFIG.min_clip_duration_seconds,
  maxClipDurationSec: CHANNEL_CONFIG.max_clip_duration_seconds,
});

console.log('\nMatch log:');
console.log('  Clip  Time   Energy     Keyword            Score  Source         Text');
console.log('  ──────────────────────────────────────────────────────────────────────────');
(matchLog || []).forEach(m => {
  const src = m.image_path
    ? (m.image_path.includes('space-keyword-library') ? 'kw-library' : 'space-lib-v1')
    : '(null)';
  console.log(`  ${String(m.clip).padStart(3)}  ${String(m.start||0).padEnd(5)}  ${(m.energy||'').padEnd(10)} ${(m.keyword||'(fallback)').padEnd(18)} ${String(m.score||0).padStart(5)}  ${src.padEnd(14)} ${(m.text||'').slice(0,40)}`);
});

const hits = (matchLog||[]).filter(m=>m.keyword_matched||m.keyword).length;
const kwLibHits = (matchLog||[]).filter(m=>m.image_path&&m.image_path.includes('space-keyword-library')).length;
const spaceLibHits = (matchLog||[]).filter(m=>m.image_path&&m.image_path.includes('space-library-v1')).length;
const usedPaths = clips.map(c=>c.imagePath).filter(Boolean);
const dupCount = usedPaths.length - new Set(usedPaths).size;

console.log(`\nSummary:`);
console.log(`  Total clips:          ${clips.length}`);
console.log(`  Keyword hits:         ${hits} (${Math.round(100*hits/clips.length)}%)`);
console.log(`  Keyword library imgs: ${kwLibHits}`);
console.log(`  Space-library-v1:     ${spaceLibHits}`);
console.log(`  Duplicate images:     ${dupCount}`);
console.log(`  Duration range:       ${Math.min(...clips.map(c=>c.duration||0)).toFixed(1)}s – ${Math.max(...clips.map(c=>c.duration||0)).toFixed(1)}s`);

// Save updated match log
const logData = (matchLog||[]).map(m => ({
  clip: m.clip, keyword: m.keyword||null, score: m.score||0,
  energy: m.energy||null, start: m.start||0, text: m.text||'',
  image_path: m.image_path||null,
  source: m.image_path ? (m.image_path.includes('space-keyword-library') ? 'kw-library' : 'space-lib-v1') : null,
}));
fs.writeFileSync(path.join(OUTPUT_DIR, 'match-log.json'), JSON.stringify(logData, null, 2));
console.log('\nMatch log saved to output/astronomer-test-v6-keywords/match-log.json');
