/**
 * harvest-transcripts.js
 *
 * Phase 2: Download transcripts via yt-dlp for videos already harvested.
 * Gentle rate limiting to avoid IP blocks.
 *
 * Usage: node scripts/harvest-transcripts.js
 *
 * Rules:
 *   - Max 30 transcripts/hour with random 30-90s delays
 *   - Only runs 1am-7am local time (pass --force to override)
 *   - Stops on 3 consecutive 429/403 errors (marks IP blocked for 24h)
 *   - Pre-flight health check before each pull
 *   - Skip videos shorter than 30 minutes
 *   - VTT → plain text + timestamped text
 *
 * Requires: yt-dlp in PATH. Install: pip install yt-dlp
 */

import { execSync, spawnSync } from 'child_process';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// On Windows, winget installs yt-dlp to a path not always in the inherited
// PATH of non-interactive shells. Resolve it at startup.
function resolveYtDlp() {
  // 1. Try PATH first
  try { execSync('yt-dlp --version', { stdio: 'ignore' }); return 'yt-dlp'; } catch {}
  // 2. Common winget location
  const winget = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
  if (fs.existsSync(winget)) {
    for (const pkg of fs.readdirSync(winget)) {
      if (pkg.startsWith('yt-dlp.yt-dlp')) {
        const exe = path.join(winget, pkg, 'yt-dlp.exe');
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return 'yt-dlp'; // fallback, will fail with clear error
}
const YTDLP = resolveYtDlp();

const REFS_DIR   = 'C:\\Users\\niels\\Desktop\\References';
const INDEX_FILE = path.join(REFS_DIR, 'index.json');
const STATE_FILE = path.join(REFS_DIR, 'harvest-state.json');
const LOG_FILE   = path.join(REFS_DIR, 'harvest-log.txt');

const FORCE          = process.argv.includes('--force');
const MAX_PER_HOUR   = 30;
const MIN_DELAY_MS   = 30_000;
const MAX_DELAY_MS   = 90_000;
const BLOCK_ERRORS   = 3;   // consecutive errors before marking IP blocked
const BLOCK_HOURS    = 24;

// ─── LOGGING ─────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

// ─── STATE ───────────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { harvested_ids: [], quota: { date: '', units_used: 0 }, completed_queries: [], ip_blocked_until: null }; }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── VTT CONVERSION ──────────────────────────────────────────────────────────

function vttToPlainText(vttContent) {
  return vttContent
    .split('\n')
    .filter(l => !/^WEBVTT|^NOTE|^\d+$|^[\d:.]+\s*-->\s*[\d:.]+/.test(l.trim()))
    .map(l => l.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))
    .filter(l => l.trim().length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function vttToTimestamped(vttContent) {
  const lines = [];
  let currentTime = '';
  for (const line of vttContent.split('\n')) {
    const timeMatch = line.match(/^([\d:.]+)\s*-->\s*[\d:.]+/);
    if (timeMatch) {
      currentTime = timeMatch[1];
    } else if (line.trim() && !/^WEBVTT|^NOTE|^\d+$/.test(line.trim()) && currentTime) {
      const text = line.replace(/<[^>]+>/g, '').trim();
      if (text) lines.push(`[${currentTime}] ${text}`);
    }
  }
  return lines.join('\n');
}

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

async function healthCheck(videoId) {
  const start = Date.now();
  const result = spawnSync(YTDLP, [
    '--dump-json', '--no-playlist',
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeout: 10000, encoding: 'utf-8' });
  const elapsed = Date.now() - start;
  return { ok: result.status === 0, elapsed };
}

// ─── RANDOM DELAY ────────────────────────────────────────────────────────────

function randomDelay() {
  const ms = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
  return new Promise(r => setTimeout(r, ms));
}

// ─── TRANSCRIPT FETCH ────────────────────────────────────────────────────────

function fetchTranscript(videoId, outDir) {
  const vttDir = path.join(outDir, '_vtt_tmp');
  fs.mkdirSync(vttDir, { recursive: true });

  const result = spawnSync(YTDLP, [
    '--write-auto-sub', '--sub-lang', 'en', '--sub-format', 'vtt',
    '--skip-download', '--no-playlist',
    '-o', path.join(vttDir, 'sub'),
    `https://www.youtube.com/watch?v=${videoId}`,
  ], { timeout: 60000, encoding: 'utf-8' });

  if (result.status !== 0) {
    const stderr = result.stderr || '';
    const isRateLimit = stderr.includes('429') || stderr.includes('403') || stderr.includes('blocked');
    try { fs.rmSync(vttDir, { recursive: true, force: true }); } catch {}
    throw Object.assign(new Error(`yt-dlp failed: ${stderr.slice(-200)}`), { isRateLimit });
  }

  // Find VTT file
  const vttFiles = fs.existsSync(vttDir)
    ? fs.readdirSync(vttDir).filter(f => f.endsWith('.vtt') || f.endsWith('.srt'))
    : [];

  if (vttFiles.length === 0) {
    try { fs.rmSync(vttDir, { recursive: true, force: true }); } catch {}
    throw new Error('No subtitle file produced — video may have no auto-captions');
  }

  const vttContent = fs.readFileSync(path.join(vttDir, vttFiles[0]), 'utf-8');
  fs.writeFileSync(path.join(outDir, 'transcript.txt'), vttToPlainText(vttContent));
  fs.writeFileSync(path.join(outDir, 'transcript-timestamped.txt'), vttToTimestamped(vttContent));

  try { fs.rmSync(vttDir, { recursive: true, force: true }); } catch {}
  return true;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  log('══════════════════════════════════════════════════');
  log('  SleepForge — Reference Transcripts (Phase 2)');
  log('══════════════════════════════════════════════════');

  // Check yt-dlp
  const ytdlpCheck = spawnSync(YTDLP, ['--version'], { encoding: 'utf-8' });
  if (ytdlpCheck.status !== 0) {
    log('');
    log('ERROR: yt-dlp is not installed or not in PATH.');
    log('');
    log('Install options:');
    log('  pip install yt-dlp          (if Python is in PATH)');
    log('  winget install yt-dlp       (Windows package manager)');
    log('  scoop install yt-dlp        (if Scoop is installed)');
    log('');
    log('After installing, run:  node scripts/harvest-transcripts.js');
    process.exit(1);
  }
  log(`yt-dlp version: ${ytdlpCheck.stdout?.trim()}`);

  // Check time window (1am-7am local)
  const hour = new Date().getHours();
  if (!FORCE && (hour < 1 || hour >= 7)) {
    log(`Current hour: ${hour}:00. Transcript harvesting runs 1am-7am only.`);
    log('Pass --force to run outside this window.');
    process.exit(0);
  }

  // Check IP block status
  const state = loadState();
  if (state.ip_blocked_until) {
    const blockedUntil = new Date(state.ip_blocked_until);
    if (blockedUntil > new Date()) {
      log(`IP marked blocked until ${blockedUntil.toLocaleString()}. Aborting.`);
      process.exit(0);
    }
    state.ip_blocked_until = null;
    saveState(state);
  }

  // Load index, find videos needing transcripts
  if (!fs.existsSync(INDEX_FILE)) {
    log('No index.json found. Run harvest-references.js first.');
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  const needsTranscript = index
    .filter(v => v.duration_sec >= 30 * 60)
    .filter(v => {
      const transcriptPath = path.join(REFS_DIR, 'by-niche', v.niche, v.video_id, 'transcript.txt');
      return !fs.existsSync(transcriptPath);
    })
    .sort((a, b) => b.view_count - a.view_count);

  log(`Videos needing transcripts: ${needsTranscript.length}`);
  log(`Rate limit: ${MAX_PER_HOUR}/hour, ${Math.round(MIN_DELAY_MS/1000)}-${Math.round(MAX_DELAY_MS/1000)}s delays`);

  if (needsTranscript.length === 0) {
    log('All transcripts up to date.');
    return;
  }

  let consecutiveErrors = 0;
  let doneThisHour = 0;
  const hourStart = Date.now();

  for (const video of needsTranscript) {
    // Hour rate limit
    if (doneThisHour >= MAX_PER_HOUR) {
      const elapsed = Date.now() - hourStart;
      const waitMs = Math.max(0, 3_600_000 - elapsed);
      log(`Hour limit reached. Waiting ${Math.ceil(waitMs/60000)} min...`);
      await new Promise(r => setTimeout(r, waitMs));
      doneThisHour = 0;
    }

    const videoDir = path.join(REFS_DIR, 'by-niche', video.niche, video.video_id);
    log(`\n  ${video.video_id} "${video.title.slice(0, 55)}"`);
    log(`  views: ${Math.round(video.view_count/1000)}K | niche: ${video.niche}`);

    // Pre-flight health check
    log('  Pre-flight health check...');
    const { ok, elapsed: hcElapsed } = await healthCheck(video.video_id);
    if (!ok) {
      log(`  Health check failed — skipping`);
      consecutiveErrors++;
    } else if (hcElapsed > 6000) {
      log(`  Health check slow (${hcElapsed}ms > 6s threshold) — pausing 4 hours`);
      await new Promise(r => setTimeout(r, 4 * 3_600_000));
      consecutiveErrors = 0;
      continue;
    } else {
      log(`  Health check OK (${hcElapsed}ms)${hcElapsed > 3000 ? ' ⚠ slow but under 6s threshold' : ''}`);
    }

    if (consecutiveErrors >= BLOCK_ERRORS) {
      const blockedUntil = new Date(Date.now() + BLOCK_HOURS * 3_600_000).toISOString();
      state.ip_blocked_until = blockedUntil;
      saveState(state);
      log(`\n3 consecutive errors — marking IP blocked until ${new Date(blockedUntil).toLocaleString()}`);
      log('Transcript phase aborted. Metadata harvest can continue.');
      process.exit(0);
    }

    // Fetch transcript
    try {
      fetchTranscript(video.video_id, videoDir);
      log(`  ✓ transcript.txt written`);
      consecutiveErrors = 0;
      doneThisHour++;
    } catch (err) {
      log(`  ✗ ${err.message}`);
      if (err.isRateLimit) consecutiveErrors++;
      else consecutiveErrors = 0; // non-rate-limit errors don't count toward block
    }

    // Random delay between calls
    const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    log(`  Waiting ${Math.round(delay/1000)}s...`);
    await new Promise(r => setTimeout(r, delay));
  }

  log('\n══════════════════════════════════════════════════');
  log('Transcript harvest complete.');
  const transcriptCount = index.filter(v => {
    return fs.existsSync(path.join(REFS_DIR, 'by-niche', v.niche, v.video_id, 'transcript.txt'));
  }).length;
  log(`Transcripts available: ${transcriptCount} / ${index.length}`);
  log('══════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
