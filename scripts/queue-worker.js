/**
 * queue-worker.js — Watches data/queue.json and renders queued videos.
 *
 * Polls every 30 seconds. Picks the oldest "queued" entry, marks it "rendering",
 * spawns render-single.js, waits for completion, then marks "completed" or "failed".
 * Sequential — only one video renders at a time (Chatterbox owns the GPU).
 *
 * Logs to data/queue-worker.log
 *
 * Auto-started by JARVIS server. Restarts on crash.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const QUEUE_FILE = path.join(PROJECT_ROOT, 'data', 'queue.json');
const LOG_FILE   = path.join(PROJECT_ROOT, 'data', 'queue-worker.log');
const POLL_MS    = 30_000;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function readQueue() {
  try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')); }
  catch { return []; }
}

function writeQueue(q) {
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2));
}

function updateEntry(id, patch) {
  const q = readQueue();
  const idx = q.findIndex(e => e.id === id);
  if (idx >= 0) {
    Object.assign(q[idx], patch, { updatedAt: new Date().toISOString() });
    writeQueue(q);
  }
}

function pickNext(q) {
  const active = q.find(e => e.status === 'rendering');
  if (active) return null; // already rendering
  return q.find(e => e.status === 'queued') || null;
}

let currentChild = null;
let isRendering  = false;

async function renderEntry(entry) {
  isRendering = true;
  updateEntry(entry.id, { status: 'rendering', startedAt: new Date().toISOString() });
  log(`STARTING  ${entry.channel}/${entry.topic} (id=${entry.id})`);

  const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'render-single.js');
  const spawnArgs  = [
    scriptPath,
    '--channel',       entry.channel,
    '--topic',         entry.topic,
    '--queue-id',      entry.id,
  ];
  if (entry.scheduleDate) spawnArgs.push('--schedule-date', entry.scheduleDate);

  return new Promise(resolve => {
    const child = spawn(process.execPath, spawnArgs, {
      cwd:   PROJECT_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env:   process.env,
    });
    currentChild = child;

    let buf = '';
    function processLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      // Echo progress to our own log
      if (trimmed.startsWith('[') || trimmed.includes('Step') || trimmed.includes('✅') || trimmed.includes('❌') || trimmed.includes('%')) {
        log(`  [render] ${trimmed}`);
      }
      // Parse completion signal
      if (trimmed.startsWith('QUEUE_UPDATE:')) {
        try {
          const data = JSON.parse(trimmed.slice('QUEUE_UPDATE:'.length).trim());
          if (data.queueId === entry.id) {
            updateEntry(entry.id, data);
            if (data.status === 'completed') {
              log(`COMPLETED ${entry.channel}/${entry.topic} → ${data.url}`);
            } else {
              log(`FAILED    ${entry.channel}/${entry.topic} → ${data.error}`);
            }
          }
        } catch {}
      }
    }

    child.stdout.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(processLine);
    });
    child.stderr.on('data', d => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      lines.forEach(l => { if (l.trim()) log(`  [render/err] ${l.trim()}`); });
    });

    child.on('close', code => {
      currentChild = null;
      // If QUEUE_UPDATE wasn't received, mark failed based on exit code
      const q = readQueue();
      const e = q.find(x => x.id === entry.id);
      if (e && e.status === 'rendering') {
        const status = code === 0 ? 'failed' : 'failed';
        updateEntry(entry.id, { status, error: `Process exited with code ${code}` });
        log(`EXIT code=${code} for ${entry.channel}/${entry.topic} — marked failed`);
      }
      isRendering = false;
      resolve();
    });

    child.on('error', err => {
      currentChild = null;
      updateEntry(entry.id, { status: 'failed', error: err.message });
      log(`SPAWN ERROR: ${err.message}`);
      isRendering = false;
      resolve();
    });
  });
}

async function tick() {
  if (isRendering) return;
  const q    = readQueue();
  const next = pickNext(q);
  if (!next) return;
  await renderEntry(next);
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────

log('Queue worker started. Polling every 30s.');

// Reset any stale "rendering" entries from a previous crashed run
const q = readQueue();
let reset = 0;
for (const e of q) {
  if (e.status === 'rendering') {
    e.status = 'queued';
    e.resetAt = new Date().toISOString();
    reset++;
  }
}
if (reset > 0) {
  writeQueue(q);
  log(`Reset ${reset} stale "rendering" entries back to "queued"`);
}

// Initial tick immediately, then every 30s
tick();
setInterval(tick, POLL_MS);

process.on('SIGTERM', () => {
  log('SIGTERM received — shutting down');
  if (currentChild) {
    try { currentChild.kill('SIGTERM'); } catch {}
  }
  process.exit(0);
});
