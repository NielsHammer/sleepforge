import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { approveFromCli, rejectFromCli, loadWinners, loadLosers } from '../src/thumbnail-learning-pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'output');
const PORT = 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(OUTPUT_DIR));

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function walkDir(dir, depth = 0) {
  if (depth > 6) return [];
  let results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) results = results.concat(walkDir(full, depth + 1));
    else results.push(full);
  }
  return results;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function toUrl(absPath) {
  return '/output/' + path.relative(OUTPUT_DIR, absPath).replace(/\\/g, '/');
}

// ─── SCANNERS ─────────────────────────────────────────────────────────────────

function scanThumbnails() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  const winners = loadWinners();
  const losers  = loadLosers();
  const winnerPaths = new Set(winners.map(w => w.png_path));
  const loserPaths  = new Set(losers.map(l => l.png_path));

  const thumbDirs = new Set();
  for (const f of walkDir(OUTPUT_DIR)) {
    if (path.basename(f) !== 'thumbnail.png') continue;
    const dir = path.dirname(f);
    // Skip attempt-N subdirs — the parent dir holds the final promoted result
    if (/[/\\]attempt-\d+$/.test(dir)) continue;
    thumbDirs.add(dir);
  }

  const results = [];
  for (const dir of thumbDirs) {
    const pngPath = path.join(dir, 'thumbnail.png');
    const plan    = readJson(path.join(dir, 'thumbnail-v3-plan.json'));
    const review  = readJson(path.join(dir, 'thumbnail-v3-review.json'));
    const hook    = readJson(path.join(dir, 'thumbnail-v3-hook.json'));
    const relDir  = path.relative(OUTPUT_DIR, dir).replace(/\\/g, '/');

    results.push({
      id:        relDir,
      outputDir: dir,
      pngUrl:    toUrl(pngPath),
      title:     plan?.title   || path.basename(dir),
      niche:     plan?.niche   || '',
      hook:      plan?.hook_text || hook?.winner || '',
      subject:   plan?.primary_subject || '',
      why:       plan?.why || '',
      attempt:   plan?._attempt || 1,
      rating:    review?.rating ?? null,
      verdict:   review?.designer_verdict || '',
      problems:  review?.problems  || [],
      strengths: review?.strengths || [],
      approved:  winnerPaths.has(pngPath),
      rejected:  loserPaths.has(pngPath),
      mtime:     fs.statSync(pngPath).mtimeMs,
    });
  }
  return results.sort((a, b) => b.mtime - a.mtime);
}

function scanVideos() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  return walkDir(OUTPUT_DIR)
    .filter(f => f.endsWith('.mp4'))
    .map(f => {
      const dir  = path.dirname(f);
      const meta = readJson(path.join(dir, 'metadata.json')) ||
                   readJson(path.join(dir, 'video-metadata.json'));
      return {
        id:    path.relative(OUTPUT_DIR, f).replace(/\\/g, '/'),
        url:   toUrl(f),
        title: meta?.title || path.basename(f, '.mp4'),
        mtime: fs.statSync(f).mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function scanScripts() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  const results = [];
  for (const f of walkDir(OUTPUT_DIR)) {
    const base = path.basename(f);
    if (base !== 'script.txt' && base !== 'script.json' && !base.endsWith('-script.txt')) continue;
    let preview = '';
    try { preview = fs.readFileSync(f, 'utf-8').substring(0, 600); } catch { /* empty */ }
    results.push({
      id:      path.relative(OUTPUT_DIR, f).replace(/\\/g, '/'),
      url:     toUrl(f),
      title:   path.basename(path.dirname(f)),
      preview,
      mtime:   fs.statSync(f).mtimeMs,
    });
  }
  return results.sort((a, b) => b.mtime - a.mtime);
}

function getPipelineStatus() {
  if (!fs.existsSync(OUTPUT_DIR)) return { active: false, step: '', lastActivityAgo: null };
  const allFiles = walkDir(OUTPUT_DIR);

  let newest = 0, newestFile = '';
  for (const f of allFiles) {
    try { const m = fs.statSync(f).mtimeMs; if (m > newest) { newest = m; newestFile = f; } } catch { /* skip */ }
  }

  const ageMs  = Date.now() - newest;
  const active = ageMs < 3 * 60 * 1000;

  let step = '';
  for (const f of allFiles) {
    if (path.basename(f) !== 'thumbnail-v3-hook.json') continue;
    const dir      = path.dirname(f);
    const pngPath  = path.join(dir, 'thumbnail.png');
    const hookMt   = fs.statSync(f).mtimeMs;
    const pngMt    = fs.existsSync(pngPath) ? fs.statSync(pngPath).mtimeMs : 0;
    if (hookMt > pngMt && Date.now() - hookMt < 15 * 60 * 1000) {
      const planPath = path.join(dir, 'thumbnail-v3-plan.json');
      const planMt   = fs.existsSync(planPath) ? fs.statSync(planPath).mtimeMs : 0;
      step = planMt > pngMt ? 'Fetching images / rendering' : 'Planning thumbnail layout';
    }
  }

  return {
    active: active || !!step,
    step:   step || (active ? 'Processing' : ''),
    lastActivityFile: newestFile ? path.relative(OUTPUT_DIR, newestFile).replace(/\\/g, '/') : '',
    lastActivityAgo:  Math.round(ageMs / 1000),
  };
}

// ─── API ──────────────────────────────────────────────────────────────────────

app.get('/api/data', (_req, res) => {
  try {
    res.json({
      thumbnails: scanThumbnails(),
      videos:     scanVideos(),
      scripts:    scanScripts(),
      pipeline:   getPipelineStatus(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/approve', (req, res) => {
  try {
    const { outputDir, reason } = req.body;
    if (!outputDir) return res.status(400).json({ error: 'outputDir required' });
    const result = approveFromCli({ outputDir, reason: reason || '' });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/reject', (req, res) => {
  try {
    const { outputDir, reason } = req.body;
    if (!outputDir) return res.status(400).json({ error: 'outputDir required' });
    if (!reason?.trim()) return res.status(400).json({ error: 'reason required to reject' });
    const result = rejectFromCli({ outputDir, reason });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`SleepForge Dashboard → http://localhost:${PORT}`);
});
