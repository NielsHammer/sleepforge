/**
 * render-astronomer-intro.js
 *
 * Task 1: Fetch Sleepless Astronomer logo via YouTube Data API
 * Task 4: Render AstronomerIntro Remotion composition → intro.mp4
 * Task 5: Generate boosted intro sting (2.5x volume) → intro-final.mp4
 *
 * Output: assets/intros/sleepless-astronomer/
 *   logo.png          — channel avatar (800px)
 *   intro.mp4         — Remotion animation, video only, 2s
 *   intro-sting.wav   — boosted 3-tone sting (2.5x volume, alimited)
 *   intro-final.mp4   — animation + sting audio combined
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
const STING_PATH   = path.join(INTROS_DIR, 'intro-sting.wav');
const FINAL_PATH   = path.join(INTROS_DIR, 'intro-final.mp4');

const FALLBACK_LOGO = path.join(PROJECT_ROOT, 'assets', 'channel-art', 'sleepless-astronomer-logo.png');

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
      fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

// ─── TASK 1: Fetch logo ───────────────────────────────────────────────────────
log('\n── Task 1: Fetch Sleepless Astronomer logo ──');
let logoOk = false;

if (!FORCE && fs.existsSync(LOGO_PATH) && fs.statSync(LOGO_PATH).size > 5000) {
  log(`  Logo cached: ${LOGO_PATH}`);
  logoOk = true;
} else {
  // Try YouTube Data API
  try {
    log('  Authenticating with YouTube...');
    const auth = await authenticate('sleepless-astronomer');
    const yt   = google.youtube({ version: 'v3', auth });

    log('  Calling channels.list (mine=true)...');
    const res = await yt.channels.list({
      part: 'snippet',
      mine: true,
    });

    const channel = res.data.items?.[0];
    if (!channel) throw new Error('No channel returned from API');

    const thumbs = channel.snippet.thumbnails;
    // Prefer highest resolution: high (800px) → medium (240px) → default (88px)
    const thumbUrl = (thumbs.high || thumbs.medium || thumbs.default)?.url;
    if (!thumbUrl) throw new Error('No thumbnail URL in channel snippet');

    log(`  Channel: ${channel.snippet.title}`);
    log(`  Avatar URL: ${thumbUrl}`);
    log(`  Downloading to ${LOGO_PATH}...`);
    await download(thumbUrl, LOGO_PATH);

    const size = fs.statSync(LOGO_PATH).size;
    log(`  ✓ Logo downloaded (${Math.round(size / 1024)} KB)`);
    logoOk = true;
  } catch (err) {
    log(`  ✗ YouTube API failed: ${err.message}`);
    // Fallback: local channel art
    if (fs.existsSync(FALLBACK_LOGO)) {
      fs.copyFileSync(FALLBACK_LOGO, LOGO_PATH);
      log(`  ✓ Used fallback: ${FALLBACK_LOGO}`);
      logoOk = true;
    } else {
      log('  ! No logo available — intro will use text placeholder');
    }
  }
}

// Copy to public/ so Remotion staticFile() can serve it
if (logoOk) {
  fs.copyFileSync(LOGO_PATH, PUBLIC_LOGO);
  log(`  Logo copied to public/astronomer-logo.png`);
}

// ─── TASK 4: Render AstronomerIntro via Remotion ─────────────────────────────
log('\n── Task 4: Render AstronomerIntro (Remotion, 60 frames) ──');

if (!FORCE && fs.existsSync(INTRO_VID) && fs.statSync(INTRO_VID).size > 10000) {
  log(`  Cached: ${INTRO_VID}`);
} else {
  if (FORCE && fs.existsSync(INTRO_VID)) fs.unlinkSync(INTRO_VID);
  await renderAnimation('AstronomerIntro', INTRO_VID, {
    durationInFrames: 60,
    inputProps: { logoPath: logoOk ? 'astronomer-logo.png' : null },
    concurrency: 4,
  });
  log(`  ✓ Intro video rendered: ${INTRO_VID}`);
}

// ─── TASK 5A: Generate boosted intro sting ───────────────────────────────────
log('\n── Task 5A: Generate boosted intro sting ──');

if (!FORCE && fs.existsSync(STING_PATH) && fs.statSync(STING_PATH).size > 1000) {
  log(`  Cached: ${STING_PATH}`);
} else {
  // Base sting: 3 layered sine tones (same formula as existing pipeline)
  const baseSting = path.join(INTROS_DIR, 'intro-sting-base.wav');
  const d = '2';
  const filterBase = [
    `sine=frequency=60:sample_rate=44100:duration=${d}[s0]`,
    `sine=frequency=220:sample_rate=44100:duration=${d}[s1]`,
    `sine=frequency=660:sample_rate=44100:duration=${d}[s2]`,
    `[s0]volume=0.90,afade=t=in:st=0:d=0.6[sub]`,
    `[s1]volume=0.55,afade=t=in:st=0:d=0.4[pad]`,
    `[s2]volume=0.32,adelay=1650|1650[chime]`,
    `[sub][pad][chime]amix=inputs=3:duration=longest,afade=t=out:st=1.7:d=0.3,alimiter=limit=0.92:level=true[base]`,
  ].join(';');

  log('  Generating base sting...');
  const r1 = spawnSync('ffmpeg', [
    '-y', '-filter_complex', filterBase,
    '-map', '[base]', '-c:a', 'pcm_s16le', baseSting,
  ], { stdio: 'pipe', timeout: 15000 });
  if (r1.status !== 0) throw new Error(`Base sting failed: ${r1.stderr?.toString().slice(-300)}`);

  // Boost 2.5x + alimiter to prevent clipping
  log('  Boosting 2.5x + alimiter...');
  const r2 = spawnSync('ffmpeg', [
    '-y', '-i', baseSting,
    '-af', 'volume=2.5,alimiter=limit=0.95:level=true',
    '-c:a', 'pcm_s16le', STING_PATH,
  ], { stdio: 'pipe', timeout: 15000 });
  if (r2.status !== 0) throw new Error(`Boost failed: ${r2.stderr?.toString().slice(-300)}`);

  fs.unlinkSync(baseSting);
  log(`  ✓ Boosted sting: ${STING_PATH}`);
}

// ─── TASK 5B: Combine video + audio → intro-final.mp4 ────────────────────────
log('\n── Task 5B: Combine video + sting audio ──');

if (!FORCE && fs.existsSync(FINAL_PATH) && fs.statSync(FINAL_PATH).size > 10000) {
  log(`  Cached: ${FINAL_PATH}`);
} else {
  if (FORCE && fs.existsSync(FINAL_PATH)) fs.unlinkSync(FINAL_PATH);
  log('  Muxing intro video + boosted sting...');
  execSync(
    `ffmpeg -y -i "${INTRO_VID}" -i "${STING_PATH}" ` +
    `-c:v copy -c:a aac -b:a 192k -shortest -t 2.0 ` +
    `-movflags +faststart "${FINAL_PATH}"`,
    { stdio: 'pipe', timeout: 60000 }
  );
  const size = fs.statSync(FINAL_PATH).size;
  log(`  ✓ intro-final.mp4 (${Math.round(size / 1024)} KB): ${FINAL_PATH}`);
}

// ─── Verify ──────────────────────────────────────────────────────────────────
log('\n── Verify ──');
const probe = execSync(`ffprobe -v quiet -show_streams "${FINAL_PATH}"`, { encoding: 'utf-8' });
const vs = (probe.match(/codec_type=video/g) || []).length;
const as = (probe.match(/codec_type=audio/g) || []).length;
log(`  Streams: ${vs} video, ${as} audio`);

const dur = execSync(
  `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${FINAL_PATH}"`,
  { encoding: 'utf-8' }
).trim();
log(`  Duration: ${parseFloat(dur).toFixed(2)}s`);

log('\n══════════════════════════════════════════════════');
log('  ✅ Astronomer intro built');
log(`  Logo:  ${LOGO_PATH}`);
log(`  Video: ${INTRO_VID}`);
log(`  Final: ${FINAL_PATH}`);
log('  Wire with: prependIntroVideo(FINAL_PATH, body.mp4, final.mp4)');
log('══════════════════════════════════════════════════');
