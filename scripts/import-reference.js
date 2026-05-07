/**
 * SleepForge reference library importer.
 *
 * Usage:
 *   node scripts/import-reference.js <youtube-url>
 *
 * Downloads:
 *   - Thumbnail (thumbnail.jpg)
 *   - Video metadata: title, description, views, channel (metadata.json)
 *   - Full transcript with timestamps (transcript.txt)
 *
 * Saves to: reference-library/<channel-slug>/<video-id>/
 *
 * Requirements:
 *   - yt-dlp in PATH  (install: pip install yt-dlp  OR  winget install yt-dlp)
 *   - Python youtube-transcript-api for transcripts:
 *     pip install youtube-transcript-api
 *     Fallback: yt-dlp --write-auto-sub (subtitles only, no timestamps)
 */
import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath }       from 'url';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const LIB_DIR     = path.join(PROJECT_ROOT, 'reference-library');

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

function ytdlpAvailable() {
  try { execSync('yt-dlp --version', { stdio: 'pipe' }); return true; } catch { return false; }
}

function extractVideoId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node scripts/import-reference.js <youtube-url>');
    process.exit(1);
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    console.error(`Could not extract video ID from URL: ${url}`);
    process.exit(1);
  }

  if (!ytdlpAvailable()) {
    console.error('yt-dlp not found. Install: pip install yt-dlp  OR  winget install yt-dlp');
    process.exit(1);
  }

  console.log(`\n── Importing reference: ${url} ──`);
  console.log(`  Video ID: ${videoId}`);

  // ── Step 1: Fetch metadata via yt-dlp ────────────────────────────────────
  console.log('  Fetching metadata...');
  let metaRaw;
  try {
    metaRaw = execSync(
      `yt-dlp --dump-json --no-playlist "${url}"`,
      { encoding: 'utf-8', timeout: 60000 }
    );
  } catch (err) {
    console.error(`  yt-dlp metadata failed: ${err.message}`);
    process.exit(1);
  }

  const meta = JSON.parse(metaRaw.trim().split('\n').pop()); // last JSON line

  const channelSlug = slugify(meta.channel || meta.uploader || 'unknown-channel');
  const outDir = path.join(LIB_DIR, channelSlug, videoId);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`  Output dir: ${outDir}`);

  // Write metadata.json
  const metadata = {
    video_id:    videoId,
    url,
    title:       meta.title,
    channel:     meta.channel || meta.uploader,
    channel_url: meta.channel_url || meta.uploader_url,
    view_count:  meta.view_count,
    like_count:  meta.like_count,
    duration:    meta.duration,
    upload_date: meta.upload_date,
    description: (meta.description || '').slice(0, 2000),
    tags:        meta.tags || [],
    imported_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  console.log(`  Saved metadata.json (${meta.title?.slice(0, 60)})`);

  // ── Step 2: Download thumbnail ────────────────────────────────────────────
  console.log('  Downloading thumbnail...');
  const thumbPath = path.join(outDir, 'thumbnail.jpg');
  if (!fs.existsSync(thumbPath)) {
    try {
      execSync(
        `yt-dlp --write-thumbnail --skip-download --convert-thumbnails jpg ` +
        `-o "${path.join(outDir, 'thumbnail')}" "${url}"`,
        { stdio: 'pipe', timeout: 30000 }
      );
      // yt-dlp may write thumbnail.jpg or thumbnail.webp — rename if needed
      const possibleNames = ['thumbnail.jpg', 'thumbnail.webp', 'thumbnail.png'];
      for (const name of possibleNames) {
        const candidate = path.join(outDir, name);
        if (fs.existsSync(candidate) && name !== 'thumbnail.jpg') {
          fs.renameSync(candidate, thumbPath);
          break;
        }
      }
    } catch (err) {
      console.warn(`  Thumbnail download failed (non-fatal): ${err.message}`);
    }
  }
  const thumbOk = fs.existsSync(thumbPath);
  console.log(`  Thumbnail: ${thumbOk ? thumbPath : 'FAILED'}`);

  // ── Step 3: Fetch transcript ──────────────────────────────────────────────
  console.log('  Fetching transcript...');
  const transcriptPath = path.join(outDir, 'transcript.txt');

  // Try youtube-transcript-api (Python) first — gives clean text with timestamps
  let transcriptOk = false;
  const pythonBin = process.env.PYTHON_BIN
    || path.join(PROJECT_ROOT, '.venv', 'Scripts', 'python.exe');

  if (fs.existsSync(pythonBin) || spawnSync('python', ['--version'], { stdio: 'pipe' }).status === 0) {
    const bin = fs.existsSync(pythonBin) ? pythonBin : 'python';
    try {
      const transcriptRaw = execSync(
        `"${bin}" -c "` +
        `from youtube_transcript_api import YouTubeTranscriptApi;` +
        `t=YouTubeTranscriptApi.get_transcript('${videoId}');` +
        `print('\\n'.join(f\\"[{e[\\'start\\']:.1f}s] {e[\\'text\\']}\\" for e in t))"`,
        { encoding: 'utf-8', timeout: 30000 }
      );
      fs.writeFileSync(transcriptPath, transcriptRaw.trim());
      transcriptOk = true;
      console.log(`  Transcript (youtube-transcript-api): ${transcriptPath}`);
    } catch {
      // fall through to yt-dlp subtitle approach
    }
  }

  if (!transcriptOk) {
    // Fallback: yt-dlp auto-subtitles (VTT → plain text)
    try {
      const vttDir = path.join(outDir, '_vtt_tmp');
      fs.mkdirSync(vttDir, { recursive: true });
      execSync(
        `yt-dlp --write-auto-sub --sub-lang en --sub-format vtt ` +
        `--skip-download -o "${path.join(vttDir, 'sub')}" "${url}"`,
        { stdio: 'pipe', timeout: 30000 }
      );
      // Find the VTT file
      const vttFiles = fs.readdirSync(vttDir).filter(f => f.endsWith('.vtt'));
      if (vttFiles.length > 0) {
        const vttContent = fs.readFileSync(path.join(vttDir, vttFiles[0]), 'utf-8');
        // Strip VTT markup → plain text
        const plain = vttContent
          .split('\n')
          .filter(l => !/^WEBVTT|^NOTE|^\d+$|^[\d:.]+\s+-->\s+[\d:.]+/.test(l.trim()))
          .filter(l => l.trim().length > 0)
          .join(' ')
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        fs.writeFileSync(transcriptPath, plain);
        transcriptOk = true;
        console.log(`  Transcript (yt-dlp VTT): ${transcriptPath}`);
      }
      // Clean up vtt tmp dir
      for (const f of fs.readdirSync(vttDir)) fs.unlinkSync(path.join(vttDir, f));
      fs.rmdirSync(vttDir);
    } catch (err) {
      console.warn(`  Transcript fetch failed (non-fatal): ${err.message}`);
    }
  }

  if (!transcriptOk) {
    fs.writeFileSync(transcriptPath, '[transcript unavailable — try installing youtube-transcript-api]');
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(`\n  ✓ Saved to: ${outDir}`);
  console.log(`    metadata.json  — title, views, channel, description`);
  console.log(`    thumbnail.jpg  — ${thumbOk ? 'ok' : 'missing'}`);
  console.log(`    transcript.txt — ${transcriptOk ? 'ok' : 'unavailable'}`);
  console.log(`\n  Usage in niches: read reference-library/<channel>/<id>/transcript.txt`);
  console.log(`  for style/pacing blueprints.`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
