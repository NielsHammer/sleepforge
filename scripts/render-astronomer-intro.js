/**
 * render-astronomer-intro.js
 *
 * Builds the reusable Sleepless Astronomer channel intro (v2).
 *
 * Tasks:
 *   1. Fetch / cache channel logo via YouTube Data API
 *   2. Render AstronomerIntro Remotion composition → intro.mp4 (video-only)
 *   3. Mux intro.mp4 + sting-whoosh.mp3 → intro-final.mp4
 *
 * Audio: assets/intros/sleepless-astronomer/sting-whoosh.mp3  (4.754s)
 * Frames: 143 @ 30fps
 *
 * Re-run safely — all outputs cached unless --force flag is passed.
 */

import 'dotenv/config';
import fs             from 'fs';
import path           from 'path';
import https          from 'https';
import { fileURLToPath } from 'url';
import { execSync, spawnSync } from 'child_process';
import { google }     from 'googleapis';
import { authenticate } from '../src/youtube.js';
import { renderAnimation } from '../src/remotion-renderer.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FORCE        = process.argv.includes('--force');

const INTROS_DIR   = path.join(PROJECT_ROOT, 'assets', 'intros', 'sleepless-astronomer');
const PUBLIC_DIR   = path.join(PROJECT_ROOT, 'public');
const LOGO_PATH    = path.join(INTROS_DIR, 'logo.png');
const PUBLIC_LOGO  = path.join(PUBLIC_DIR, 'astronomer-logo.png');
const INTRO_VID    = path.join(INTROS_DIR, 'intro.mp4');
const WHOOSH_PATH  = path.join(INTROS_DIR, 'sting-whoosh.mp3');
const FINAL_PATH   = path.join(INTROS_DIR, 'intro-final.mp4');

const FALLBACK_LOGO = path.join(PROJECT_ROOT, 'assets', 'channel-art', 'sleepless-astronomer-logo.png');

const DURATION_FRAMES = 143;  // 4.754s @ 30fps

fs.mkdirSync(INTROS_DIR, { recursive: true });
fs.mkdirSync(PUBLIC_DIR,  { recursive: true });

function log(msg) { console.log(msg); }

// ─── Helper: download URL to file ────────────────────────────────────────────
function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        file.close();
        download(res.headers.location, destPath).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(destPath); });
    }).on('error', (err) => {
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

// ─── TASK 1: Fetch / cache logo ──────────────────────────────────────────────
log('\n── Task 1: Fetch Sleepless Astronomer logo ──');
let logoOk = false;

if (!FORCE && fs.existsSync(LOGO_PATH) && fs.statSync(LOGO_PATH).size > 5000) {
  log(`  Logo cached: ${LOGO_PATH}`);
  logoOk = true;
} else {
  try {
    log('  Authenticating with YouTube...');
    const auth = await authenticate('sleepless-astronomer');
    const yt   = google.youtube({ version: 'v3', auth });

    log('  Calling channels.list (mine=true)...');
    const res = await yt.channels.list({ part: 'snippet', mine: true });

    const channel = res.data.items?.[0];
    if (!channel) throw new Error('No channel returned from API');

    const thumbs  = channel.snippet.thumbnails;
    const thumbUrl = (thumbs.high || thumbs.medium || thumbs.default)?.url;
    if (!thumbUrl) throw new Error('No thumbnail URL in channel snippet');

    log(`  Channel: ${channel.snippet.title}`);
    log(`  Downloading avatar to ${LOGO_PATH}...`);
    await download(thumbUrl, LOGO_PATH);

    const size = fs.statSync(LOGO_PATH).size;
    log(`  ✓ Logo downloaded (${Math.round(size / 1024)} KB)`);
    logoOk = true;
  } catch (err) {
    log(`  ✗ YouTube API failed: ${err.message}`);
    if (fs.existsSync(FALLBACK_LOGO)) {
      fs.copyFileSync(FALLBACK_LOGO, LOGO_PATH);
      log(`  ✓ Used fallback: ${FALLBACK_LOGO}`);
      logoOk = true;
    } else {
      log('  ! No logo available — intro will show text placeholder');
    }
  }
}

if (logoOk) {
  fs.copyFileSync(LOGO_PATH, PUBLIC_LOGO);
  log(`  Logo copied to public/astronomer-logo.png`);
}

// ─── Verify whoosh audio ──────────────────────────────────────────────────────
log('\n── Verifying whoosh audio ──');
if (!fs.existsSync(WHOOSH_PATH)) {
  throw new Error(`Missing whoosh audio: ${WHOOSH_PATH}\nRun: cp "astronomy whoosh.mp3" ${WHOOSH_PATH}`);
}
const audioDur = parseFloat(
  execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${WHOOSH_PATH}"`, { encoding: 'utf-8' }).trim()
);
log(`  Audio: ${WHOOSH_PATH} (${audioDur.toFixed(3)}s)`);

// ─── TASK 2: Render AstronomerIntro via Remotion ─────────────────────────────
log(`\n── Task 2: Render AstronomerIntro (Remotion, ${DURATION_FRAMES} frames) ──`);

if (!FORCE && fs.existsSync(INTRO_VID) && fs.statSync(INTRO_VID).size > 10000) {
  log(`  Cached: ${INTRO_VID}`);
} else {
  if (FORCE && fs.existsSync(INTRO_VID)) fs.unlinkSync(INTRO_VID);
  const t0 = Date.now();
  await renderAnimation('AstronomerIntro', INTRO_VID, {
    durationInFrames: DURATION_FRAMES,
    inputProps: { logoPath: logoOk ? 'astronomer-logo.png' : null },
    concurrency: 4,
  });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  log(`  ✓ Rendered in ${elapsed}s: ${INTRO_VID}`);
}

// ─── TASK 3: Mux video + whoosh audio → intro-final.mp4 ──────────────────────
log('\n── Task 3: Mux video + whoosh audio ──');

if (!FORCE && fs.existsSync(FINAL_PATH) && fs.statSync(FINAL_PATH).size > 10000) {
  log(`  Cached: ${FINAL_PATH}`);
} else {
  if (FORCE && fs.existsSync(FINAL_PATH)) fs.unlinkSync(FINAL_PATH);

  // Explicit -map 0:v -map 1:a required — Remotion outputs a silent audio stream,
  // so without explicit mapping ffmpeg defaults to that stream instead of the whoosh.
  const r = spawnSync('ffmpeg', [
    '-y',
    '-i', INTRO_VID,
    '-i', WHOOSH_PATH,
    '-map', '0:v',
    '-map', '1:a',
    '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    FINAL_PATH,
  ], { stdio: 'pipe', timeout: 60000 });

  if (r.status !== 0) {
    throw new Error(`Mux failed: ${r.stderr?.toString().slice(-400)}`);
  }

  const size = fs.statSync(FINAL_PATH).size;
  log(`  ✓ intro-final.mp4 (${Math.round(size / 1024)} KB): ${FINAL_PATH}`);
}

// ─── Verify ──────────────────────────────────────────────────────────────────
log('\n── Verify ──');
const probe = execSync(`ffprobe -v quiet -show_streams "${FINAL_PATH}"`, { encoding: 'utf-8' });
const vs = (probe.match(/codec_type=video/g) || []).length;
const as = (probe.match(/codec_type=audio/g) || []).length;
const dur = execSync(
  `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`,
  { encoding: 'utf-8' }
).trim();
log(`  Streams: ${vs} video, ${as} audio`);
log(`  Duration: ${parseFloat(dur).toFixed(3)}s`);

// Verify audio is not silent — Remotion embeds a silent stream that can win if -map is wrong
const tmpWav = FINAL_PATH.replace('.mp4', '-verify.wav');
execSync(`ffmpeg -y -i "${FINAL_PATH}" -t 4.5 -vn -ar 44100 "${tmpWav}"`, { stdio: 'pipe' });
const volCheck = execSync(
  `ffmpeg -i "${tmpWav}" -af "volumedetect" -vn -sn -dn -f null - 2>&1`,
  { encoding: 'utf-8' }
);
try { fs.unlinkSync(tmpWav); } catch {}
const peakVol = parseFloat((volCheck.match(/max_volume:\s*([-\d.]+)\s*dB/) || [])[1] ?? '-999');
if (peakVol < -50) {
  throw new Error(`Intro audio is silent (peak ${peakVol} dB) — mux pulled Remotion's silent stream. Check -map flags.`);
}
log(`  Audio peak: ${peakVol} dB ✓`);

log('\n══════════════════════════════════════════════════');
log('  ✅ Astronomer intro v2 built');
log(`  Logo:  ${LOGO_PATH}`);
log(`  Video: ${INTRO_VID}`);
log(`  Final: ${FINAL_PATH}`);
log(`  Duration: ${parseFloat(dur).toFixed(3)}s`);
log('  Wire with: prependIntroVideo(FINAL_PATH, body.mp4, final.mp4)');
log('══════════════════════════════════════════════════');
