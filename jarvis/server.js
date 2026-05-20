/**
 * JARVIS Command Center — SleepForge dashboard server.
 * Port 3001. Express + WebSocket. Plain Node, no build step.
 */

import express        from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { exec, spawn, spawnSync } from 'child_process';
import fs             from 'fs';
import path           from 'path';
import os             from 'os';
import crypto         from 'crypto';
import { fileURLToPath } from 'url';
import dotenv         from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI } = await import('../src/claude-cli.js');

const PORT           = 3001;
const STATE_FILE     = path.join(__dirname, 'state.json');
const TOKENS_DIR     = path.join(ROOT, 'assets', 'youtube-tokens');
const LIBRARY_INDEX  = path.join(ROOT, 'assets', 'images', 'library-v1', 'index.json');
const LIBRARY_DIR    = path.join(ROOT, 'assets', 'images', 'library-v1');
const OUTPUT_DIR     = path.join(ROOT, 'output');

// ─── STATE ────────────────────────────────────────────────────────────────────

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')); }
  catch { return { renders: [], publishes: [], analytics_cache: {}, last_updated: null }; }
}

function writeState(patch) {
  const state = readState();
  Object.assign(state, patch, { last_updated: new Date().toISOString() });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  broadcast({ type: 'state', data: state });
  return state;
}

function updateRenderJob(id, updates) {
  const state = readState();
  const idx = state.renders.findIndex(r => r.id === id);
  if (idx >= 0) Object.assign(state.renders[idx], updates, { updatedAt: new Date().toISOString() });
  state.last_updated = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  broadcast({ type: 'job_update', job: state.renders[idx] });
}

// ─── WEBSOCKET BROADCAST ─────────────────────────────────────────────────────

const clients = new Set();
function broadcast(payload) {
  const msg = JSON.stringify(payload);
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  }
}

// ─── SYSTEM METRICS ──────────────────────────────────────────────────────────

let _cpuCache = { val: 0, ts: 0 };
async function getCpu() {
  if (Date.now() - _cpuCache.ts < 3000) return _cpuCache.val;
  return new Promise(res => {
    const c1 = os.cpus();
    setTimeout(() => {
      const c2 = os.cpus();
      let idle = 0, total = 0;
      for (let i = 0; i < c1.length; i++) {
        const t1 = Object.values(c1[i].times).reduce((a,b)=>a+b,0);
        const t2 = Object.values(c2[i].times).reduce((a,b)=>a+b,0);
        idle  += c2[i].times.idle - c1[i].times.idle;
        total += t2 - t1;
      }
      _cpuCache = { val: Math.round(100*(1-idle/total)), ts: Date.now() };
      res(_cpuCache.val);
    }, 400);
  });
}

async function getGpu() {
  return new Promise(res => {
    exec('nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits', (err, out) => {
      if (err) { res({ gpu: null, vram_used: null, vram_total: null }); return; }
      const p = out.trim().split(',').map(s => parseInt(s.trim()));
      res({ gpu: p[0] || 0, vram_used: p[1] || 0, vram_total: p[2] || 12288 });
    });
  });
}

// ─── TTS — Piper (JARVIS voice) with Edge TTS fallback ───────────────────────

const PYTHON_BIN   = process.env.PYTHON_BIN  || 'python';
// piper-tts is installed in system Python (not venv) — use explicit path
const PIPER_PYTHON = process.env.PIPER_PYTHON || 'C:\\Python314\\python.exe';
const PIPER_MODEL  = path.join(ROOT, 'assets', 'voices', 'jarvis', 'jarvis-medium.onnx');
const PIPER_AVAIL  = fs.existsSync(PIPER_MODEL);

async function synthesize(text) {
  if (PIPER_AVAIL) {
    try { return await synthesizePiper(text); }
    catch (e) { console.warn('[TTS] Piper failed, falling back to edge-tts:', e.message); }
  }
  return synthesizeEdge(text);
}

async function synthesizePiper(text) {
  const tmpFile = path.join(os.tmpdir(), `piper_${crypto.randomUUID()}.wav`);
  return new Promise((resolve, reject) => {
    const proc = spawn(PIPER_PYTHON, ['-m', 'piper',
      '--model', PIPER_MODEL,
      '--output_file', tmpFile,
    ], { timeout: 15000 });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.stdin.write(text + '\n');
    proc.stdin.end();
    proc.on('close', code => {
      if (code !== 0) { reject(new Error(`piper (${code}): ${stderr.slice(-200)}`)); return; }
      try {
        const buf = fs.readFileSync(tmpFile);
        fs.rmSync(tmpFile, { force: true });
        resolve({ buf, contentType: 'audio/wav' });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

async function synthesizeEdge(text, voice = 'en-GB-RyanNeural', rate = '+5%') {
  const tmpFile = path.join(os.tmpdir(), `tts_${crypto.randomUUID()}.mp3`);
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_BIN, [
      '-m', 'edge_tts', '--text', text,
      '--voice', voice, '--rate', rate, '--write-media', tmpFile,
    ], { timeout: 30000 });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0) { reject(new Error(`edge_tts (${code}): ${stderr.slice(-300)}`)); return; }
      try {
        const buf = fs.readFileSync(tmpFile);
        fs.rmSync(tmpFile, { force: true });
        resolve({ buf, contentType: 'audio/mpeg' });
      } catch (e) { reject(e); }
    });
    proc.on('error', reject);
  });
}

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────

function listChannels() {
  if (!fs.existsSync(TOKENS_DIR)) return [];
  return fs.readdirSync(TOKENS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const slug = f.replace('.json','');
      return {
        slug,
        name: slug.split('-').map(w => w[0].toUpperCase()+w.slice(1)).join(' '),
        tokenFile: path.join(TOKENS_DIR, f),
      };
    });
}

function listVideos() {
  if (!fs.existsSync(OUTPUT_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(OUTPUT_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir       = path.join(OUTPUT_DIR, entry.name);
    const videoFile = path.join(dir, 'final.mp4');
    if (!fs.existsSync(videoFile)) continue;
    const stat    = fs.statSync(videoFile);
    const meta    = tryJson(path.join(dir, 'youtube-metadata.json')) || {};
    const thumbPng = path.join(dir, 'thumbnail', 'thumbnail.png');
    out.push({
      slug:         entry.name,
      title:        meta.title || entry.name.replace(/-/g,' '),
      description:  meta.description || '',
      tags:         meta.tags || [],
      scheduledAt:  meta.scheduledAt || null,
      channel:      meta.channel || null,
      videoId:      meta.videoId || null,
      created:      stat.mtime.toISOString(),
      sizeMb:       Math.round(stat.size/1024/1024*10)/10,
      thumbnailUrl: fs.existsSync(thumbPng) ? `/output/${entry.name}/thumbnail/thumbnail.png` : null,
      videoUrl:     `/output/${entry.name}/final.mp4`,
    });
  }
  return out.sort((a,b) => new Date(b.created)-new Date(a.created));
}

function tryJson(p) { try { return JSON.parse(fs.readFileSync(p,'utf-8')); } catch { return null; } }

async function checkHttp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch { return false; }
}

// ─── JARVIS BRAIN ─────────────────────────────────────────────────────────────

const JARVIS_SYS = `You are JARVIS, the AI assistant for SleepForge, an automated YouTube sleep-story production system owned by Niels. Address Niels as "sir".

PERSONALITY RULES:
- Dry, precise British wit. Think J.A.R.V.I.S. from Iron Man.
- Maximum 2-3 sentences. Never longer. No bullet points. No markdown.
- Use exact numbers from the data when available. Never invent statistics.
- Subtle sarcasm is permitted, especially for mundane requests.
- End with a relevant next suggestion when useful.
- If the user asks you to render a video, confirm with a dry one-liner, then on the very last line append this exact JSON (no trailing text): {"action":"render","topic":"TOPIC_HERE","channel":"CHANNEL_HERE"}
  If no channel is specified, default channel is "sleepless-philosophers".`;

const JARVIS_AGENT_SYS = `JARVIS v3 — SleepForge AI Command Center
Personality: dry British wit, J.A.R.V.I.S. from Iron Man. Address Niels as "sir". speak: max 2 sentences, no markdown, no bullets. Subtle sarcasm welcome. Use exact data numbers.
CHANNELS: "astronomer"=Sleepless Astronomer | "philosophers"=Sleepless Philosophers

═══ TIER 1 — READ (use freely) ═══
list_channels()
get_channel_stats(channel)
get_recent_videos(channel, limit?)
get_scheduled_queue(channel, limit?)
get_system_status()
get_render_queue()
get_local_videos(limit?)
get_library_stats()
search_knowledge(query, scope?) — scope: "project_files"|"render_logs"|"documentation"|"all"
read_file(path) — returns first 200 lines of any project file

═══ TIER 2 — SAFE WRITE (execute immediately, no confirmation needed) ═══
run_thumbnail_test(topic, channel) → {score, hook, subject, filePath}
regenerate_video_thumbnail(videoId, channel) → {filePath, score} (saves locally, NOT uploaded)
upload_thumbnail_to_video(videoId, thumbnailPath, channel) → {ok}
generate_title_candidates(topic, channel, count?) → {titles:[...]}
analyze_script(scriptText) → {wordCount, scores, issues, verdict}
queue_video(channel, topic, scheduleDate?) → {id} — IMPORTANT: this adds to queue only; the queue-worker picks it up within 30 seconds and starts rendering
get_queue_status() → {rendering, queued, completed, failed, estimatedCompletionISO}
cancel_queued_video(queueId) → {ok}
get_video_thumbnail(videoId, channel) → {thumbnailUrl, title}
search_topics(channel, query) → {results:[...]}
mark_topic_used(topic, channel) → {ok}
remember_preference(key, value) → {ok}
preview_codebase_change(filepath, instructions) → {diff, filepath} — generates code change for review, NO write

═══ TIER 3 — POWERFUL (ALWAYS call request_confirmation first, NEVER execute directly) ═══
delete_video(videoId, channel)
run_overnight_batch(videoCount, channel)
modify_channel_config(channel, field, value)
bulk_regenerate_thumbnails(channel)
execute_shell_command(command)
apply_pending_modification() — writes file from preview_codebase_change
undo_last_modification()

TIER 3 PROTOCOL: ALWAYS call request_confirmation(tool, description, args) before ANY Tier 3 tool.
The user must verbally confirm (yes/proceed/confirm/do it) before execution.
Example: request_confirmation("run_overnight_batch","queue 5 Astronomer videos tonight",{"videoCount":5,"channel":"astronomer"})

═══ PROTECTED — HARDCODED NEVER ALLOWED ═══
delete_channel, revoke_oauth_token, delete_youtube_token_file, any bulk delete >3 videos
Response: "I'm afraid that operation is hardcoded as protected, sir. You'll need to do that manually."

═══ HONESTY RULES — NEVER BREAK ═══
- queue_video adds to the queue ONLY. Never say "rendering started" or "video is being made." Say "Added to queue. Worker picks it up within 30 seconds — call get_queue_status() to confirm it started."
- If you queue multiple videos, say "Queued N videos. They will render sequentially — each takes ~2-3 hours. First should start within 30 seconds."
- Always call get_queue_status() after queuing to show the user the actual state.
- Never imply work is happening faster than it is.

═══ PANELS ═══
Structured: video_list, channel_stats, comparison, system_status, render_queue
Custom: {"type":"custom","title":"...","html":"...","css":"..."}
Use custom panels liberally for creative visualization. Choose based on data shape:
- Single metric → big number with context
- Comparison → side-by-side cards or table (CSS grid, cyan/amber colours)
- Timeline → horizontal event list
- Scores/ratings → bar chart using divs and inline styles
- Anomaly → highlighted callout with border-left: 3px solid #FFB300
CSS is scoped automatically. Use var(--cyan) #00E5FF, var(--amber) #FFB300, dark bg rgba(0,18,42,0.9), font-family Share Tech Mono for data.

═══ RESPONSE FORMAT — ONLY valid JSON ═══
{"think":"1 sentence","speak":"1-2 sentence British JARVIS","tools":[{"name":"...","args":{...}}],"panels":[...],"done":false}

RULES:
1. done=false when tools needed; done=true when final.
2. Call tools for ALL requested items in one response (both channels = 4 tool calls at once).
3. speak never recites numbers — panels visualize data.
4. request_confirmation before EVERY Tier 3 tool. One tool call per confirmation request.
5. Creative panels always beat plain text dumps.
OUTPUT ONLY JSON.`;

async function askJarvis(question, ctx) {
  const prompt = `${JARVIS_SYS}\n\nCURRENT CONTEXT:\n${JSON.stringify(ctx,null,2)}\n\nUSER: ${question}\n\nJARVIS:`;
  return callClaudeCLI(prompt, { model: 'claude-sonnet-4-6', timeoutMs: 30000 });
}

// ─── JARVIS AGENT INFRASTRUCTURE ─────────────────────────────────────────────

const JARVIS_SESSION_FILE = path.join(ROOT, 'data', 'jarvis-session.json');

function readSession() {
  try { return JSON.parse(fs.readFileSync(JARVIS_SESSION_FILE, 'utf-8')); }
  catch { return []; }
}

function writeSession(history) {
  try {
    fs.mkdirSync(path.dirname(JARVIS_SESSION_FILE), { recursive: true });
    fs.writeFileSync(JARVIS_SESSION_FILE, JSON.stringify(history.slice(-50), null, 2));
  } catch {}
}

// ─── QUEUE / PREFS / MODS ────────────────────────────────────────────────────

const QUEUE_FILE = path.join(ROOT, 'data', 'queue.json');
const PREFS_FILE = path.join(ROOT, 'data', 'jarvis-preferences.json');
const MODS_LOG   = path.join(ROOT, 'data', 'jarvis-self-modifications.log');

function readQueue()  { try { return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8')); } catch { return []; } }
function writeQueue(q) { fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true }); fs.writeFileSync(QUEUE_FILE, JSON.stringify(q, null, 2)); }

function readPreferences()  { try { return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf-8')); } catch { return {}; } }
function writePreferences(p) { fs.mkdirSync(path.dirname(PREFS_FILE), { recursive: true }); fs.writeFileSync(PREFS_FILE, JSON.stringify(p, null, 2)); }

function logModification(description, filepath) {
  const entry = `[${new Date().toISOString()}] ${description}${filepath ? '\nFile: ' + filepath : ''}\n─────────────\n`;
  try { fs.appendFileSync(MODS_LOG, entry); } catch {}
}

// ─── PENDING CONFIRMATION / MODIFICATION ─────────────────────────────────────

let _pendingConfirmation = null;
let _pendingModification = null;

function isConfirmation(text) {
  return /^(yes|yeah|y\b|proceed|confirm|do it|go ahead|execute|run it|affirmative|absolutely|sure|ok\b|okay|go for it|approved|sounds good)/i.test(text.trim());
}
function isCancellation(text) {
  return /^(no\b|cancel|abort|stop|never mind|forget it|don't|do not|nope)/i.test(text.trim());
}

// ─── KNOWLEDGE SEARCH ────────────────────────────────────────────────────────

function searchKnowledge(query, scope = 'all') {
  const results = [];
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return results;

  const SCOPE_DIRS = {
    project_files:  ['src', 'scripts'],
    render_logs:    ['data'],
    documentation:  ['docs', 'data/CONTEXT'],
    all:            ['src', 'scripts', 'data', 'jarvis'],
  };
  const SCOPE_EXTS = {
    project_files:  new Set(['.js', '.json', '.md']),
    render_logs:    new Set(['.md', '.txt', '.log', '.json']),
    documentation:  new Set(['.md', '.txt']),
    all:            new Set(['.js', '.json', '.md', '.txt']),
  };

  const dirs = SCOPE_DIRS[scope] || SCOPE_DIRS.all;
  const exts = SCOPE_EXTS[scope] || SCOPE_EXTS.all;

  const SKIP_DIRS = new Set(['node_modules', '.venv', 'output', 'bin', '.git', 'backgrounds']);

  function walkDir(rel, depth = 0) {
    if (depth > 3) return;
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walkDir(path.join(rel, e.name), depth + 1);
      } else if (e.isFile() && exts.has(path.extname(e.name))) {
        try {
          const content = fs.readFileSync(path.join(abs, e.name), 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const ll = lines[i].toLowerCase();
            const hits = words.filter(w => ll.includes(w)).length;
            if (hits >= Math.min(2, words.length)) {
              results.push({
                file:      path.join(rel, e.name).replace(/\\/g, '/'),
                line:      i + 1,
                snippet:   lines.slice(Math.max(0, i - 1), i + 4).join('\n').slice(0, 400),
                relevance: hits,
              });
            }
          }
        } catch {}
      }
    }
  }

  for (const d of dirs) walkDir(d);

  const seen = new Set();
  return results
    .sort((a, b) => b.relevance - a.relevance)
    .filter(r => { const k = r.file + ':' + r.line; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 10);
}

async function getChannelDataCached(channelShort) {
  const slug = channelShort === 'astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
  const cached = _ytCache.get(slug);
  if (cached && Date.now() - cached.ts < YT_CACHE_TTL) return cached.data;

  const videos = await listChannelVideos(slug);
  const now = new Date();
  const scheduled = videos
    .filter(v => v.privacyStatus === 'private' && v.scheduledAt && new Date(v.scheduledAt) > now)
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
    .slice(0, 14);
  const published = videos
    .filter(v => v.privacyStatus === 'public')
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 10);

  let channelInfo = null, lastStats = null;
  try {
    const auth = await authenticate(slug);
    const yt   = googleApis.youtube({ version: 'v3', auth });
    const cr   = await yt.channels.list({ part: ['snippet', 'statistics'], mine: true });
    const ch   = cr.data.items?.[0];
    if (ch) channelInfo = {
      title:      ch.snippet?.title,
      subs:       parseInt(ch.statistics?.subscriberCount || 0),
      totalViews: parseInt(ch.statistics?.viewCount || 0),
      videoCount: parseInt(ch.statistics?.videoCount || 0),
    };
  } catch {}
  if (published[0]) {
    try { lastStats = { ...(await getVideoStats(published[0].videoId, slug)), videoId: published[0].videoId }; }
    catch {}
  }

  const data = { channel: slug, scheduled, published, channelInfo, lastStats };
  _ytCache.set(slug, { data, ts: Date.now() });
  return data;
}

// ─── PROTECTED OPS ───────────────────────────────────────────────────────────

const HARDCODED_PROTECTED = new Set([
  'delete_channel', 'revoke_oauth_token', 'delete_youtube_token_file', 'bulk_delete_videos',
]);

// ─── TOOL EXECUTOR ───────────────────────────────────────────────────────────

async function executeJarvisTool(name, args = {}) {
  if (HARDCODED_PROTECTED.has(name)) {
    return { error: `PROTECTED: "${name}" is hardcoded as protected, sir. You'll need to do that manually.` };
  }

  try {
    switch (name) {

      // ── TIER 1 — READ ──────────────────────────────────────────────────────

      case 'list_channels':
        return listChannels().map(c => ({ slug: c.slug, name: c.name }));

      case 'get_channel_stats': {
        const d = await getChannelDataCached(args.channel);
        const i = d.channelInfo || {};
        return { channel: args.channel, title: i.title, subs: i.subs, totalViews: i.totalViews, videoCount: i.videoCount };
      }

      case 'get_recent_videos': {
        const limit = Math.min(args.limit || 5, 10);
        const ch    = args.channel === 'astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const d     = await getChannelDataCached(args.channel);
        const pubs  = (d.published || []).slice(0, limit);
        return await Promise.all(pubs.map(async (v, i) => {
          if (i === 0 && d.lastStats?.videoId === v.videoId) {
            return { videoId: v.videoId, title: v.title, publishedAt: v.publishedAt,
                     views: d.lastStats.views, likes: d.lastStats.likes };
          }
          try {
            const s = await getVideoStats(v.videoId, ch);
            return { videoId: v.videoId, title: v.title, publishedAt: v.publishedAt, views: s.views, likes: s.likes };
          } catch {
            return { videoId: v.videoId, title: v.title, publishedAt: v.publishedAt, views: null, likes: null };
          }
        }));
      }

      case 'get_scheduled_queue': {
        const limit = Math.min(args.limit || 10, 20);
        const d     = await getChannelDataCached(args.channel);
        return (d.scheduled || []).slice(0, limit).map(v => ({ title: v.title, scheduledAt: v.scheduledAt }));
      }

      case 'get_system_status': {
        const [cpu, gpu] = await Promise.all([getCpu(), getGpu()]);
        const usedMem    = os.totalmem() - os.freemem();
        const chatterbox = await checkHttp('http://localhost:5002/health');
        return {
          cpu, gpu: gpu.gpu, vramUsed: gpu.vram_used, vramTotal: gpu.vram_total,
          memUsed: Math.round(usedMem/1024/1024), memTotal: Math.round(os.totalmem()/1024/1024),
          services: {
            chatterbox, fal: !!process.env.FAL_KEY,
            youtube: fs.existsSync(TOKENS_DIR) && fs.readdirSync(TOKENS_DIR).filter(f=>f.endsWith('.json')).length > 0,
          },
        };
      }

      case 'get_render_queue':
        return readState().renders.slice(0,10).map(r=>({ topic:r.topic, channel:r.channel, status:r.status, progress:r.progress, step:r.step }));

      case 'get_local_videos':
        return listVideos().slice(0, Math.min(args.limit||10,20)).map(v=>({ slug:v.slug, title:v.title, channel:v.channel, sizeMb:v.sizeMb, videoId:v.videoId }));

      case 'get_library_stats': {
        if (!fs.existsSync(LIBRARY_INDEX)) return { totalImages: 0, keywordCount: 0 };
        const idx = JSON.parse(fs.readFileSync(LIBRARY_INDEX,'utf-8'));
        return { totalImages: idx.length, keywordCount: new Set(idx.flatMap(e=>e.keywords||[])).size };
      }

      case 'search_knowledge':
        return searchKnowledge(args.query || '', args.scope || 'all');

      case 'read_file': {
        const absPath = path.isAbsolute(args.path||'') ? args.path : path.join(ROOT, args.path||'');
        if (!absPath.startsWith(ROOT)) return { error: 'Path outside project root not allowed, sir.' };
        if (!fs.existsSync(absPath)) return { error: `File not found: ${args.path}` };
        const lines = fs.readFileSync(absPath,'utf-8').split('\n');
        return { file: args.path, totalLines: lines.length, content: lines.slice(0,200).join('\n'), truncated: lines.length>200 };
      }

      // ── TIER 2 — SAFE WRITE ───────────────────────────────────────────────

      case 'run_thumbnail_test': {
        const channelSlug = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        return new Promise(resolve => {
          const child = spawn(process.execPath, [
            path.join(ROOT,'scripts','thumbnail-tester.js'),
            '--topic', args.topic||'Unknown topic',
            '--channel', channelSlug,
          ], { cwd: ROOT, stdio:['ignore','pipe','pipe'], env: process.env });
          let out='';
          child.stdout.on('data',d=>out+=d);
          child.stderr.on('data',d=>out+=d);
          child.on('close', code => resolve({
            ok:        code===0,
            topic:     args.topic,
            channel:   channelSlug,
            hook:      out.match(/Hook:\s*(.+)/)?.[1]?.trim(),
            subject:   out.match(/Subject:\s*(.+)/)?.[1]?.trim(),
            score:     out.match(/Score:\s*(.+)/)?.[1]?.trim(),
            filePath:  out.match(/File:\s*(.+)/)?.[1]?.trim(),
            verdict:   out.match(/Verdict:\s*(.+)/)?.[1]?.trim(),
            error:     code!==0 ? out.slice(-400) : null,
          }));
        });
      }

      case 'regenerate_video_thumbnail': {
        const channelSlug = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        // Fetch video title to use as topic
        let topic = args.topic || 'Unknown';
        try {
          const auth = await authenticate(channelSlug);
          const yt   = googleApis.youtube({ version:'v3', auth });
          const res  = await yt.videos.list({ part:['snippet'], id:[args.videoId] });
          topic = res.data.items?.[0]?.snippet?.title || topic;
        } catch {}
        return executeJarvisTool('run_thumbnail_test', { topic, channel: args.channel });
      }

      case 'upload_thumbnail_to_video': {
        const channelSlug = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const absPath = path.isAbsolute(args.thumbnailPath||'') ? args.thumbnailPath : path.join(ROOT, args.thumbnailPath||'');
        if (!fs.existsSync(absPath)) return { error: `Thumbnail not found: ${absPath}` };
        const auth    = await authenticate(channelSlug);
        const youtube = googleApis.youtube({ version:'v3', auth });
        const ext     = path.extname(absPath).toLowerCase();
        await youtube.thumbnails.set({ videoId: args.videoId,
          media: { mimeType: ext==='.png'?'image/png':'image/jpeg', body: fs.createReadStream(absPath) } });
        return { ok: true, videoId: args.videoId, message: `Thumbnail uploaded to YouTube, sir.` };
      }

      case 'generate_title_candidates': {
        const count = args.count || 5;
        const slug  = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const cfg   = tryJson(path.join(ROOT,'data','channels',`${slug}.json`)) || {};
        const prompt = `Generate ${count} YouTube title candidates for a sleep story video.
Topic: ${args.topic}
Channel: ${cfg.display_name||slug} | Niche: ${cfg.niche||'sleep documentary'} | Tone: ${cfg.tone||''}
Return ONLY a JSON array of ${count} title strings, each under 60 chars.`;
        const raw  = await callClaudeCLI(prompt, { model:'claude-haiku-4-5-20251001', timeoutMs:30000 });
        const m    = raw.match(/\[[\s\S]*\]/);
        return { titles: m ? JSON.parse(m[0]) : [raw.trim()] };
      }

      case 'analyze_script': {
        const text = args.scriptText || args.script_text || '';
        if (!text) return { error: 'scriptText required' };
        const prompt = `Analyze this sleep story script. Return ONLY JSON:
{"wordCount":N,"estimatedMinutes":N,"scores":{"informationDensity":N,"specificity":N,"sleepPacing":N,"aiSlop":N},"issues":["..."],"strengths":["..."],"verdict":"..."}
SCRIPT: ${text.slice(0,3000)}`;
        const raw = await callClaudeCLI(prompt, { model:'claude-haiku-4-5-20251001', timeoutMs:30000 });
        const m   = raw.match(/\{[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : { error:'Analysis failed', raw: raw.slice(0,200) };
      }

      case 'queue_video': {
        const id   = crypto.randomUUID();
        const item = { id, channel: args.channel, topic: args.topic, scheduleDate: args.scheduleDate||null,
                       status:'queued', createdAt: new Date().toISOString() };
        const q    = readQueue();
        q.push(item);
        writeQueue(q);
        return { ok:true, id, item, note:'Added to queue. Queue-worker picks it up within 30s. Each video takes ~2-3 hours. Call get_queue_status() to confirm.' };
      }

      case 'get_queue_status': {
        const q = readQueue();
        const rendering  = q.filter(e => e.status === 'rendering');
        const queued     = q.filter(e => e.status === 'queued');
        const completed  = q.filter(e => e.status === 'completed');
        const failed     = q.filter(e => e.status === 'failed');
        const RENDER_MS  = 2.5 * 60 * 60 * 1000; // ~2.5h per video estimate
        let estimatedCompletionISO = null;
        if (rendering.length > 0 || queued.length > 0) {
          const startedAt = rendering[0]?.startedAt ? new Date(rendering[0].startedAt) : new Date();
          const remainingMs = RENDER_MS - (Date.now() - startedAt.getTime());
          const totalMs = Math.max(remainingMs, 0) + queued.length * RENDER_MS;
          estimatedCompletionISO = new Date(Date.now() + totalMs).toISOString();
        }
        return {
          workerActive: rendering.length > 0,
          rendering:    rendering.map(e => ({ id:e.id, channel:e.channel, topic:e.topic, startedAt:e.startedAt||null })),
          queued:       queued.map(e => ({ id:e.id, channel:e.channel, topic:e.topic, scheduleDate:e.scheduleDate })),
          completed:    completed.slice(-5).map(e => ({ id:e.id, channel:e.channel, topic:e.topic, url:e.url||null, updatedAt:e.updatedAt||null })),
          failed:       failed.map(e => ({ id:e.id, channel:e.channel, topic:e.topic, error:e.error||null })),
          counts:       { rendering:rendering.length, queued:queued.length, completed:completed.length, failed:failed.length },
          estimatedCompletionISO,
        };
      }

      case 'cancel_queued_video': {
        const q   = readQueue();
        const idx = q.findIndex(v => v.id===args.queueId || (v.topic||'').toLowerCase().includes((args.topic||'').toLowerCase()));
        if (idx===-1) return { error:'Item not found in queue' };
        const [removed] = q.splice(idx,1);
        writeQueue(q);
        return { ok:true, removed };
      }

      case 'get_video_thumbnail': {
        const channelSlug = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const auth = await authenticate(channelSlug);
        const yt   = googleApis.youtube({ version:'v3', auth });
        const res  = await yt.videos.list({ part:['snippet'], id:[args.videoId] });
        const vid  = res.data.items?.[0];
        if (!vid) return { error:'Video not found' };
        const t    = vid.snippet.thumbnails;
        return { videoId:args.videoId, title:vid.snippet.title,
                 thumbnailUrl: t.maxres?.url||t.high?.url||t.medium?.url, thumbnails:t };
      }

      case 'search_topics': {
        const slug = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const cfg  = tryJson(path.join(ROOT,'data','channels',`${slug}.json`)) || {};
        if (!cfg.topic_pool) return { error:'No topic_pool in channel config' };
        const pool = tryJson(path.join(ROOT, cfg.topic_pool));
        if (!pool) return { error:`Topic pool not found at ${cfg.topic_pool}` };
        const topics = Array.isArray(pool) ? pool : (pool.topics || []);
        const lq = (args.query||'').toLowerCase();
        const results = topics.filter(t => {
          const txt = (typeof t==='string'?t:(t.title||'')).toLowerCase();
          return lq.split(/\s+/).some(w=>w.length>2 && txt.includes(w));
        }).slice(0,10);
        return { channel:slug, query:args.query, results, total:results.length };
      }

      case 'mark_topic_used': {
        const slug = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const cfg  = tryJson(path.join(ROOT,'data','channels',`${slug}.json`)) || {};
        const poolPath = path.join(ROOT, cfg.topic_pool||'');
        const pool = tryJson(poolPath);
        if (!pool) return { error:'Topic pool not found' };
        const topics = Array.isArray(pool) ? pool : (pool.topics || []);
        const lTopic = (args.topic||'').toLowerCase();
        const idx = topics.findIndex(t => (typeof t==='string'?t:(t.title||'')).toLowerCase().includes(lTopic));
        if (idx===-1) return { error:'Topic not found in pool' };
        topics[idx] = typeof topics[idx]==='string'
          ? { title:topics[idx], used:true, usedAt:new Date().toISOString() }
          : { ...topics[idx], used:true, usedAt:new Date().toISOString() };
        if (!Array.isArray(pool)) pool.topics = topics;
        fs.writeFileSync(poolPath, JSON.stringify(Array.isArray(pool)?topics:pool, null, 2));
        return { ok:true, marked:args.topic };
      }

      case 'remember_preference': {
        const prefs = readPreferences();
        prefs[args.key] = args.value;
        writePreferences(prefs);
        return { ok:true, key:args.key, value:args.value };
      }

      case 'preview_codebase_change': {
        const absPath = path.isAbsolute(args.filepath||'') ? args.filepath : path.join(ROOT, args.filepath||'');
        if (!absPath.startsWith(ROOT)) return { error:'Path outside project root not allowed' };
        if (!fs.existsSync(absPath)) return { error:`File not found: ${args.filepath}` };
        const original = fs.readFileSync(absPath,'utf-8');
        const prompt = `Apply these exact instructions to this file. Return ONLY the complete new file content, no explanation.
FILE: ${args.filepath}
INSTRUCTIONS: ${args.instructions}
CURRENT CONTENT:
${original.slice(0,8000)}`;
        const newContent = await callClaudeCLI(prompt, { model:'claude-sonnet-4-6', timeoutMs:90000 });
        const origLines = original.split('\n');
        const newLines  = newContent.split('\n');
        const diffLines = []; let changes=0;
        for (let i=0; i<Math.min(Math.max(origLines.length,newLines.length),200); i++) {
          if (origLines[i]!==newLines[i]) {
            if (origLines[i]!==undefined) diffLines.push(`- ${origLines[i]}`);
            if (newLines[i]!==undefined)  diffLines.push(`+ ${newLines[i]}`);
            changes++;
            if (changes>40) { diffLines.push('... (additional changes)'); break; }
          }
        }
        _pendingModification = { filepath:absPath, original, newContent, instructions:args.instructions };
        return { preview_ready:true, filepath:args.filepath, changeCount:changes, diff:diffLines.join('\n'),
                 originalLines:origLines.length, newLines:newLines.length };
      }

      // ── CONFIRMATION GATE ─────────────────────────────────────────────────

      case 'request_confirmation': {
        _pendingConfirmation = { tool:args.tool, args:args.args||{}, description:args.description||args.tool };
        return { confirm_pending:true, description:args.description };
      }

      // ── TIER 3 — POWERFUL (only reached post-confirmation) ─────────────────

      case 'delete_video': {
        const channelSlug = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const auth = await authenticate(channelSlug);
        const yt   = googleApis.youtube({ version:'v3', auth });
        await yt.videos.update({ part:['status'],
          requestBody:{ id:args.videoId, status:{ privacyStatus:'private' } } });
        logModification(`delete_video (set private) videoId=${args.videoId} channel=${channelSlug}`, null);
        return { ok:true, videoId:args.videoId, message:`Video set to private.` };
      }

      case 'run_overnight_batch': {
        const channelSlug = (args.channel||'astronomer')==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const scriptName  = channelSlug==='sleepless-astronomer' ? 'astronomer-overnight.js' : null;
        if (!scriptName) return { error:`No overnight script configured for ${channelSlug}` };
        const scriptPath  = path.join(ROOT,'scripts',scriptName);
        if (!fs.existsSync(scriptPath)) return { error:`Script not found: ${scriptPath}` };
        logModification(`run_overnight_batch channel=${channelSlug} count=${args.videoCount||5}`, null);
        const child = spawn(process.execPath, [scriptPath], { cwd:ROOT, detached:true, stdio:'ignore', env:process.env });
        child.unref();
        return { ok:true, pid:child.pid, channel:channelSlug, message:`Overnight batch started. PID ${child.pid}.` };
      }

      case 'modify_channel_config': {
        const channelSlug = args.channel==='astronomer' ? 'sleepless-astronomer' : 'sleepless-philosophers';
        const configPath  = path.join(ROOT,'data','channels',`${channelSlug}.json`);
        const config      = tryJson(configPath);
        if (!config) return { error:'Config not found' };
        const SAFE = new Set(['tone','audience','target_word_count','target_duration_minutes','notes','topic_pool','banned_topics','banned_words_thumbnail']);
        if (!SAFE.has(args.field)) return { error:`Field "${args.field}" not modifiable. Safe: ${[...SAFE].join(', ')}` };
        const oldValue = config[args.field];
        config[args.field] = args.value;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        logModification(`modify_channel_config ${channelSlug}.${args.field}: ${JSON.stringify(oldValue)} → ${JSON.stringify(args.value)}`, configPath);
        return { ok:true, channel:channelSlug, field:args.field, oldValue, newValue:args.value };
      }

      case 'bulk_regenerate_thumbnails': {
        const channelShort = args.channel||'astronomer';
        const d = await getChannelDataCached(channelShort);
        const videos = (d.published||[]).slice(0,5);
        logModification(`bulk_regenerate_thumbnails channel=${channelShort} count=${videos.length}`, null);
        const results = [];
        for (const v of videos) {
          const res = await executeJarvisTool('regenerate_video_thumbnail', { videoId:v.videoId, channel:channelShort });
          results.push({ videoId:v.videoId, title:v.title, ...res });
        }
        return { ok:true, processed:results.length, results };
      }

      case 'execute_shell_command': {
        if (!args.command) return { error:'command required' };
        logModification(`execute_shell_command: ${args.command}`, null);
        return new Promise(resolve => {
          const child = spawn('cmd', ['/c', args.command], { cwd:ROOT, stdio:['ignore','pipe','pipe'] });
          let out='', err='';
          child.stdout.on('data',d=>out+=d);
          child.stderr.on('data',d=>err+=d);
          child.on('close', code => resolve({ ok:code===0, exitCode:code, stdout:out.slice(0,2000), stderr:err.slice(0,500) }));
          child.on('error', e => resolve({ ok:false, error:e.message }));
          setTimeout(()=>{ child.kill(); resolve({ ok:false, error:'Command timed out after 30s' }); }, 30000);
        });
      }

      case 'apply_pending_modification': {
        if (!_pendingModification) return { error:'No pending modification. Call preview_codebase_change first.' };
        const { filepath, newContent, instructions } = _pendingModification;
        fs.writeFileSync(filepath, newContent);
        logModification(`apply_pending_modification ${path.relative(ROOT,filepath)}\nInstructions: ${instructions}`, filepath);
        _pendingModification = null;
        return { ok:true, filepath:path.relative(ROOT,filepath), message:'File written successfully.' };
      }

      case 'undo_last_modification': {
        return new Promise(resolve => {
          const child = spawn('git', ['diff','--name-only','HEAD~1','HEAD'], { cwd:ROOT, stdio:['ignore','pipe','pipe'] });
          let out='';
          child.stdout.on('data',d=>out+=d);
          child.on('close', code => {
            if (code!==0) { resolve({ error:'git diff failed' }); return; }
            const files = out.trim().split('\n').filter(Boolean);
            if (!files.length) { resolve({ error:'No recent git changes to undo' }); return; }
            const restore = spawn('git', ['checkout','HEAD~1','--',...files], { cwd:ROOT, stdio:['ignore','pipe','pipe'] });
            restore.on('close', c => c===0
              ? resolve({ ok:true, files, message:`Restored ${files.length} file(s) to previous state.` })
              : resolve({ error:'git restore failed' }));
          });
        });
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

function tryParseAgentResponse(raw) {
  const jm = raw.match(/\{[\s\S]*\}/);
  if (jm) { try { return JSON.parse(jm[0]); } catch {} }

  const speakMatch = raw.match(/"speak"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!speakMatch) return null;

  let tools = [], panels = [];
  const toolsMatch = raw.match(/"tools"\s*:\s*(\[[\s\S]*?\])/);
  if (toolsMatch) { try { tools = JSON.parse(toolsMatch[1]); } catch {} }
  const panelsMatch = raw.match(/"panels"\s*:\s*(\[[\s\S]*?\])/);
  if (panelsMatch) { try { panels = JSON.parse(panelsMatch[1]); } catch {} }

  return {
    speak: speakMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
    tools,
    panels,
    done: true,
  };
}

function buildAgentPrompt(turns, preferences = null) {
  let p = JARVIS_AGENT_SYS;
  if (preferences && Object.keys(preferences).length > 0) {
    p += `\n\nPREFERENCES (apply automatically, sir):\n${JSON.stringify(preferences, null, 2)}`;
  }
  p += '\n\n';
  for (const t of turns) {
    if (t.role === 'user') {
      p += `USER: ${t.text}\n\n`;
    } else if (t.role === 'assistant') {
      const body = t.rawJson || JSON.stringify({ speak: t.text || '', tools: [], panels: [], done: true });
      p += `JARVIS: ${body}\n\n`;
    } else if (t.role === 'tool_results') {
      p += `TOOL RESULTS: ${JSON.stringify(t.results)}\n\n`;
    }
  }
  p += 'JARVIS:';
  return p;
}

async function runJarvisAgent(userText, history) {
  const prefs = readPreferences();

  // ── Handle pending confirmation ─────────────────────────────────────────────
  if (_pendingConfirmation) {
    const pending = _pendingConfirmation;

    if (isCancellation(userText)) {
      _pendingConfirmation = null;
      const updHistory = [...history, { role:'user', text:userText }, { role:'assistant', text:'Understood, sir. Standing by.' }].slice(-50);
      writeSession(updHistory);
      return { spoken:'Understood, sir. Standing by.', panels:[], toolsExecuted:[], updatedHistory: updHistory };
    }

    if (isConfirmation(userText)) {
      _pendingConfirmation = null;
      const result = await executeJarvisTool(pending.tool, pending.args || {});

      // Ask Sonnet to generate a completion message + any panels
      const completionPrompt = `${JARVIS_AGENT_SYS}\n\n` +
        `USER: ${pending.description} — please confirm.\n\n` +
        `JARVIS: ${JSON.stringify({ speak:`Sir, this will ${pending.description}. Confirm to proceed?`, tools:[{ name:'request_confirmation', args:pending }], panels:[], done:false })}\n\n` +
        `TOOL RESULTS: [{"tool":"request_confirmation","result":{"confirm_pending":true}}]\n\n` +
        `USER: ${userText}\n\n` +
        `TOOL RESULTS: [{"tool":"${pending.tool}","args":${JSON.stringify(pending.args)},"result":${JSON.stringify(result)}}]\n\n` +
        `JARVIS:`;

      let spoken = `Done, sir. ${pending.description} complete.`;
      let panels  = [];
      try {
        const raw   = await callClaudeCLI(completionPrompt, { model:'claude-sonnet-4-6', timeoutMs:60000 });
        const jm    = raw.match(/\{[\s\S]*\}/);
        const parsed = jm ? JSON.parse(jm[0]) : null;
        if (parsed?.speak)          spoken = parsed.speak;
        if (parsed?.panels?.length) panels = parsed.panels;
      } catch {}

      const updHistory = [...history,
        { role:'user', text:`${pending.description} [confirmed]` },
        { role:'assistant', text: spoken },
      ].slice(-50);
      return { spoken, panels, toolsExecuted:[{ name:pending.tool, args:pending.args }], updatedHistory: updHistory };
    }

    // Not a yes/no — discard pending and treat as a new command
    _pendingConfirmation = null;
  }

  // ── Normal agent loop ───────────────────────────────────────────────────────
  const MAX_ITERS = 6;
  const turns     = [...history, { role:'user', text:userText }];
  let spokenFinal = '';
  let panelsFinal = [];
  let toolsExecuted = [];

  for (let i = 0; i < MAX_ITERS; i++) {
    const prompt = buildAgentPrompt(turns, prefs);
    const raw    = await callClaudeCLI(prompt, { model:'claude-sonnet-4-6', timeoutMs:120000 });

    const parsed = tryParseAgentResponse(raw);
    if (!parsed) {
      spokenFinal = raw.replace(/[*#`]/g,'').trim().slice(0,300);
      turns.push({ role:'assistant', text:spokenFinal });
      break;
    }

    if (parsed.speak)          spokenFinal = parsed.speak;
    if (parsed.panels?.length) panelsFinal = parsed.panels;

    const toolCalls = parsed.tools || [];
    turns.push({ role:'assistant', rawJson:raw });

    if (parsed.done || toolCalls.length === 0) break;

    const results = await Promise.all(toolCalls.map(async call => {
      toolsExecuted.push({ name:call.name, args:call.args });
      const result = await executeJarvisTool(call.name, call.args || {});
      return { tool:call.name, args:call.args, result };
    }));

    turns.push({ role:'tool_results', results });

    // If request_confirmation was called, JARVIS will respond with done=true on next iteration
    // asking the user to confirm — let it complete that turn naturally
  }

  return {
    spoken:    spokenFinal || 'Done, sir.',
    panels:    panelsFinal,
    toolsExecuted,
    updatedHistory: turns.filter(t => t.role==='user' || t.role==='assistant').slice(-50),
  };
}

// ─── RENDER TRIGGER ───────────────────────────────────────────────────────────

function spawnRender(jobId, topic, channel, scheduledAt) {
  const args = [
    path.join(ROOT,'scripts','auto-publish.js'),
    '--topic', topic,
    '--channel', channel,
    '--duration', '2',
    '--privacy', 'private',
  ];
  if (scheduledAt) args.push('--schedule', scheduledAt);
  else             args.push('--no-schedule');

  updateRenderJob(jobId, { status: 'rendering', step: 'Starting render...', progress: 5 });

  const child = spawn(process.execPath, args, {
    cwd: ROOT, stdio: ['ignore','pipe','pipe'], env: process.env,
  });

  let buf = '';
  function parseLine(line) {
    if (!line.trim()) return;
    if (line.includes('Rendering video'))            updateRenderJob(jobId, { step:'Rendering video',       progress: 15 });
    else if (line.includes('Video already exists'))  updateRenderJob(jobId, { step:'Video cached',          progress: 40 });
    else if (line.includes('Generating thumbnail'))  updateRenderJob(jobId, { step:'Generating thumbnail',  progress: 45 });
    else if (line.includes('PASSED designer'))       updateRenderJob(jobId, { step:'Thumbnail approved',    progress: 60 });
    else if (line.includes('Generating YouTube'))    updateRenderJob(jobId, { step:'Generating metadata',   progress: 65 });
    else if (line.includes('Uploading'))             updateRenderJob(jobId, { step:'Uploading to YouTube',  progress: 75 });
    else if (line.includes('Upload progress: 50%'))  updateRenderJob(jobId, { step:'Uploading… 50%',        progress: 85 });
    else if (line.includes('Upload complete'))       updateRenderJob(jobId, { step:'Finalising',            progress: 95 });
    const vidMatch = line.match(/Video ID:\s*(\S+)/);
    if (vidMatch) {
      updateRenderJob(jobId, {
        status: 'done', step: 'Published', progress: 100,
        videoId: vidMatch[1],
        videoUrl: `https://youtube.com/watch?v=${vidMatch[1]}`,
      });
    }
  }

  child.stdout.on('data', d => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(parseLine); });
  child.stderr.on('data', d => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(parseLine); });
  child.on('close', code => {
    if (code !== 0) updateRenderJob(jobId, { status:'failed', step:'Failed', progress:0 });
    broadcast({ type:'render_complete', jobId, code });
  });
}

// ─── EXPRESS ──────────────────────────────────────────────────────────────────

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer, path: '/ws' });

app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
app.use('/output',  express.static(OUTPUT_DIR));
app.use('/library', express.static(LIBRARY_DIR));

wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({ type:'state', data: readState() }));
  ws.on('close', () => clients.delete(ws));
});

// GET /api/status
app.get('/api/status', async (req,res) => {
  const [cpu, gpu] = await Promise.all([getCpu(), getGpu()]);
  const used = os.totalmem() - os.freemem();
  const [chatterbox, fal] = await Promise.all([
    checkHttp('http://localhost:5002/health'),
    Promise.resolve(!!process.env.FAL_KEY),
  ]);
  res.json({
    cpu, gpu,
    mem: { used: Math.round(used/1024/1024), total: Math.round(os.totalmem()/1024/1024) },
    services: {
      chatterbox,
      fal: !!process.env.FAL_KEY,
      youtube: fs.existsSync(TOKENS_DIR) && fs.readdirSync(TOKENS_DIR).filter(f=>f.endsWith('.json')).length > 0,
    },
  });
});

// GET /api/channels
app.get('/api/channels', (req,res) => res.json(listChannels()));

// GET /api/videos
app.get('/api/videos', (req,res) => res.json(listVideos()));

// GET /api/state
app.get('/api/state', (req,res) => res.json(readState()));

// GET /api/library
app.get('/api/library', (req,res) => {
  if (!fs.existsSync(LIBRARY_INDEX)) return res.json({ total:0, items:[] });
  const idx    = JSON.parse(fs.readFileSync(LIBRARY_INDEX,'utf-8'));
  const page   = parseInt(req.query.page)  || 0;
  const limit  = parseInt(req.query.limit) || 80;
  const search = (req.query.search || '').toLowerCase();
  const filtered = search
    ? idx.filter(e =>
        (e.philosopher||'').toLowerCase().includes(search) ||
        (e.era||'').toLowerCase().includes(search) ||
        (e.mood||'').toLowerCase().includes(search) ||
        (e.keywords||[]).some(k => k.toLowerCase().includes(search))
      )
    : idx;
  res.json({ total: filtered.length, page, items: filtered.slice(page*limit,(page+1)*limit) });
});

// GET /api/settings
app.get('/api/settings', (req,res) => res.json({
  keys: {
    fal:       !!process.env.FAL_KEY,
    anthropic: true,   // always true — using Claude CLI subscription
    youtube:   fs.existsSync(TOKENS_DIR) && fs.readdirSync(TOKENS_DIR).filter(f=>f.endsWith('.json')).length > 0,
  },
  defaults: { privacy:'private', defaultChannel:'sleepless-philosophers', rpm:20, bgMusicVol:0.12 },
}));

// POST /api/jarvis/chat
app.post('/api/jarvis/chat', async (req,res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error:'message required' });

  const videos   = listVideos();
  const channels = listChannels();
  const state    = readState();
  const ctx = {
    date:           new Date().toLocaleString(),
    channels:       channels.map(c=>c.slug),
    total_videos:   videos.length,
    recent_videos:  videos.slice(0,5).map(v=>({ title:v.title, channel:v.channel, created:v.created, videoId:v.videoId })),
    active_renders: state.renders.filter(r=>['rendering','uploading'].includes(r.status)).length,
    queue_length:   state.renders.filter(r=>r.status==='queued').length,
    done_today:     state.renders.filter(r=>{
      const d=new Date(r.updatedAt); const now=new Date();
      return r.status==='done' && d.toDateString()===now.toDateString();
    }).length,
  };

  try {
    const raw   = await askJarvis(message, ctx);
    const aMatch = raw.match(/\{"action":"render"[^}]*\}/);
    const action = aMatch ? tryJson(aMatch[0]) : null;
    const reply  = raw.replace(/\{"action":"render"[^}]*\}/,'').trim();

    if (action?.action === 'render') {
      const jobId = crypto.randomUUID();
      const s = readState();
      s.renders.unshift({
        id: jobId, topic: action.topic, channel: action.channel,
        status:'queued', progress:0, step:'Queued',
        videoId:null, videoUrl:null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        scheduledAt: null,
      });
      writeState({ renders: s.renders });
      setTimeout(() => spawnRender(jobId, action.topic, action.channel, null), 200);
    }

    res.json({ reply, action });
  } catch(err) {
    res.json({ reply: `My apologies, sir. ${err.message}`, action: null });
  }
});

// POST /api/jarvis/speak
app.post('/api/jarvis/speak', async (req,res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error:'text required' });
  try {
    const { buf, contentType } = await synthesize(text);
    res.set('Content-Type', contentType);
    res.set('Content-Length', String(buf.length));
    res.send(buf);
  } catch(err) {
    console.error('[TTS] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/jarvis/command  — Sonnet agent loop with multi-tool chaining
app.post('/api/jarvis/command', async (req,res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  const history = readSession();

  try {
    const result = await runJarvisAgent(text, history);
    writeSession(result.updatedHistory);
    res.json({
      spoken:        result.spoken,
      panels:        result.panels,
      toolsExecuted: result.toolsExecuted,
    });
  } catch (err) {
    console.error('[command] agent error:', err.message);
    res.json({ spoken: `My apologies sir. ${err.message.slice(0, 100)}`, panels: [], toolsExecuted: [] });
  }
});

// POST /api/queue/add
app.post('/api/queue/add', (req,res) => {
  const { topic, channel, scheduledAt } = req.body;
  if (!topic || !channel) return res.status(400).json({ error:'topic and channel required' });
  const jobId = crypto.randomUUID();
  const s = readState();
  const job = {
    id:jobId, topic, channel, scheduledAt: scheduledAt||null,
    status:'queued', progress:0, step:'Queued',
    videoId:null, videoUrl:null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  s.renders.unshift(job);
  writeState({ renders: s.renders });
  setTimeout(() => spawnRender(jobId, topic, channel, scheduledAt||null), 200);
  res.json(job);
});

// ─── ANALYTICS API ───────────────────────────────────────────────────────────

const BENCHMARK_FILE  = path.join(ROOT, 'data', 'channel-benchmark.json');
const PRINCIPLES_FILE = path.join(ROOT, 'data', 'principle-scores.json');
const OWN_HISTORY_F   = path.join(ROOT, 'data', 'own-channel-history.json');

app.get('/api/analytics/benchmark', (_req, res) => {
  if (!fs.existsSync(BENCHMARK_FILE)) return res.json(null);
  res.json(JSON.parse(fs.readFileSync(BENCHMARK_FILE, 'utf-8')));
});

app.get('/api/analytics/principles', (_req, res) => {
  if (!fs.existsSync(PRINCIPLES_FILE)) return res.json(null);
  res.json(JSON.parse(fs.readFileSync(PRINCIPLES_FILE, 'utf-8')));
});

app.get('/api/analytics/thumbnails', (_req, res) => {
  if (!fs.existsSync(OWN_HISTORY_F)) return res.json([]);
  const records = JSON.parse(fs.readFileSync(OWN_HISTORY_F, 'utf-8'));
  res.json(
    records
      .filter(r => r.ctr !== null && r.thumbnail_url)
      .sort((a, b) => (b.ctr || 0) - (a.ctr || 0))
      .slice(0, 10)
      .map(r => ({ video_id: r.video_id, title: r.title, thumbnail_url: r.thumbnail_url, ctr: r.ctr, views: r.views, was_made_by_sleepforge: r.was_made_by_sleepforge }))
  );
});

app.get('/api/analytics/insights', async (_req, res) => {
  let context = '';
  if (fs.existsSync(BENCHMARK_FILE)) {
    const b = JSON.parse(fs.readFileSync(BENCHMARK_FILE, 'utf-8'));
    context += `Channel median CTR: ${b.ctr_baseline?.median?.toFixed(2) ?? 'n/a'}%. `;
    context += `Channel median retention: ${b.retention_baseline?.median?.toFixed(1) ?? 'n/a'}%. `;
    const sf = b.sleepforge_videos?.[0];
    if (sf) context += `SleepForge latest video CTR: ${sf.ctr?.toFixed(2) ?? 'pending'}% (rank: ${sf.ctr_rank ?? 'n/a'}). `;
  }
  if (fs.existsSync(PRINCIPLES_FILE)) {
    const p = JSON.parse(fs.readFileSync(PRINCIPLES_FILE, 'utf-8'));
    const top3 = (p.principles || []).filter(x => x.ctr_lift_pct !== null).slice(0, 3);
    if (top3.length) context += `Top principles by CTR: ${top3.map(x => `${x.name} (+${x.ctr_lift_pct}%)`).join(', ')}.`;
  }
  if (!context) return res.json({ insights: ['No analytics data yet — run ingest-own-channel.js and refresh-analytics.js first.'] });

  const prompt = `YouTube analytics consultant for a philosophy sleep channel.\n\nDATA: ${context}\n\nGenerate 3-5 short actionable insights (1 sentence each).\nReturn ONLY a JSON array: ["insight 1", "insight 2", ...]`;
  try {
    const raw = await callClaudeCLI(prompt, { model: 'claude-haiku-4-5-20251001', timeoutMs: 30000 });
    const m = raw.match(/\[[\s\S]*\]/);
    res.json({ insights: m ? JSON.parse(m[0]) : ['Analysis complete — check benchmark data above.'] });
  } catch (err) {
    res.json({ insights: [`Pending: ${err.message}`] });
  }
});

// ─── CONTENT APPROVAL QUEUE ──────────────────────────────────────────────────

const CONTENT_SETS_DIR  = path.join(ROOT, 'data', 'content-sets');
const APPROVAL_QUEUE_F  = path.join(ROOT, 'data', 'approval-queue.json');
const APPROVED_QUEUE_F  = path.join(ROOT, 'data', 'approved-queue.json');
const FEEDBACK_FILE     = path.join(ROOT, 'data', 'approval-feedback.json');

function readApprovalQueue() {
  try { return JSON.parse(fs.readFileSync(APPROVAL_QUEUE_F,'utf-8')); } catch { return []; }
}
function writeApprovalQueue(items) {
  fs.mkdirSync(path.dirname(APPROVAL_QUEUE_F), { recursive: true });
  fs.writeFileSync(APPROVAL_QUEUE_F, JSON.stringify(items, null, 2));
}
function readApprovedQueue() {
  try { return JSON.parse(fs.readFileSync(APPROVED_QUEUE_F,'utf-8')); } catch { return []; }
}
function readFeedback() {
  try { return JSON.parse(fs.readFileSync(FEEDBACK_FILE,'utf-8')); }
  catch { return { approved: [], rejected: [], notes: [] }; }
}
function writeFeedback(fb) {
  fs.mkdirSync(path.dirname(FEEDBACK_FILE), { recursive: true });
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(fb, null, 2));
}
function readContentSet(id) {
  const p = path.join(CONTENT_SETS_DIR, id, 'content.json');
  try { return JSON.parse(fs.readFileSync(p,'utf-8')); } catch { return null; }
}

// GET /api/content/queue
app.get('/api/content/queue', (req, res) => {
  const queue = readApprovalQueue();
  // Enrich with full content.json data
  const enriched = queue.map(item => {
    const full = readContentSet(item.id);
    return full || item;
  });
  res.json(enriched);
});

// GET /api/content/thumbnail/:id — serve thumbnail image
app.get('/api/content/thumbnail/:id', (req, res) => {
  const thumbPath = path.join(CONTENT_SETS_DIR, req.params.id, 'thumbnail.png');
  if (!fs.existsSync(thumbPath)) return res.status(404).end();
  res.sendFile(thumbPath);
});

// POST /api/content/generate — spawn generate-content-set.js, stream progress
app.post('/api/content/generate', (req, res) => {
  const count = parseInt(req.body?.count) || 5;
  res.json({ ok: true, msg: `Generating ${count} content sets…` });

  broadcast({ type: 'content_gen_start', count });

  const child = spawn(process.execPath, [
    path.join(ROOT,'scripts','generate-content-set.js'),
    '--count', String(count),
  ], { cwd: ROOT, stdio: ['ignore','pipe','pipe'], env: process.env });

  let buf = '';
  function parseLine(line) {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      broadcast({ type: 'content_gen_progress', ...obj });
      if (obj.status === 'done') {
        broadcast({ type: 'content_gen_done', sets: obj.sets || [] });
      }
    } catch {}
  }
  child.stdout.on('data', d => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(parseLine); });
  child.stderr.on('data', d => { /* suppress */ });
  child.on('close', code => {
    if (code !== 0) broadcast({ type: 'content_gen_done', error: 'Generation script exited with error' });
  });
});

// POST /api/content/approve/:id
app.post('/api/content/approve/:id', (req, res) => {
  const { id } = req.params;
  const { notes, channel, scheduledAt } = req.body || {};

  const content = readContentSet(id);
  if (!content) return res.status(404).json({ error: 'Content set not found' });

  // Move to approved queue
  const approved = readApprovedQueue();
  approved.unshift({ ...content, notes: notes || '', channel: channel || 'sleepless-philosophers', scheduledAt: scheduledAt || null, approvedAt: new Date().toISOString() });
  fs.mkdirSync(path.dirname(APPROVED_QUEUE_F), { recursive: true });
  fs.writeFileSync(APPROVED_QUEUE_F, JSON.stringify(approved, null, 2));

  // Update content.json status
  content.status = 'approved';
  content.notes  = notes || '';
  fs.writeFileSync(path.join(CONTENT_SETS_DIR, id, 'content.json'), JSON.stringify(content, null, 2));

  // Update approval queue status
  const queue = readApprovalQueue().map(q => q.id === id ? { ...q, status: 'approved' } : q);
  writeApprovalQueue(queue);

  // Log to feedback
  const fb = readFeedback();
  fb.approved.push({ id, topic: content.topic, title: content.title, tradition: content.tradition, notes: notes || '', approvedAt: new Date().toISOString() });
  if (notes) fb.notes.push(notes);
  writeFeedback(fb);

  res.json({ ok: true });
});

// POST /api/content/reject/:id
app.post('/api/content/reject/:id', (req, res) => {
  const { id } = req.params;
  const { notes } = req.body || {};

  const content = readContentSet(id);

  // Remove from approval queue
  const queue = readApprovalQueue().filter(q => q.id !== id);
  writeApprovalQueue(queue);

  // Log to feedback before deleting
  if (content) {
    const fb = readFeedback();
    fb.rejected.push({ id, topic: content.topic, title: content.title, tradition: content.tradition, notes: notes || '', rejectedAt: new Date().toISOString() });
    if (notes) fb.notes.push(notes);
    writeFeedback(fb);
  }

  // Delete content set folder
  const setDir = path.join(CONTENT_SETS_DIR, id);
  if (fs.existsSync(setDir)) fs.rmSync(setDir, { recursive: true, force: true });

  res.json({ ok: true });
});

// POST /api/content/reroll/:id — regenerate this content set in-place
app.post('/api/content/reroll/:id', (req, res) => {
  const { id } = req.params;
  res.json({ ok: true, msg: 'Re-rolling content set…' });
  broadcast({ type: 'content_reroll_start', id });

  const child = spawn(process.execPath, [
    path.join(ROOT,'scripts','generate-content-set.js'),
    '--count', '1', '--replace-id', id,
  ], { cwd: ROOT, stdio: ['ignore','pipe','pipe'], env: process.env });

  let buf = '';
  function parseLine(line) {
    if (!line.trim()) return;
    try {
      const obj = JSON.parse(line);
      if (obj.status === 'done') broadcast({ type: 'content_reroll_done', id, set: obj.sets?.[0] });
    } catch {}
  }
  child.stdout.on('data', d => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); lines.forEach(parseLine); });
  child.stderr.on('data', () => {});
  child.on('close', () => {});
});

// ─── YOUTUBE QUEUE API ───────────────────────────────────────────────────────

const { listChannelVideos, getVideoStats, authenticate } = await import('../src/youtube.js');
const { google: googleApis } = await import('googleapis');

const _ytCache = new Map(); // channelName -> { data, ts }
const YT_CACHE_TTL = 5 * 60 * 1000;

app.get('/api/youtube/queue/:channel', async (req, res) => {
  const channel = req.params.channel;
  const cached  = _ytCache.get(channel);
  if (cached && Date.now() - cached.ts < YT_CACHE_TTL) return res.json(cached.data);

  try {
    const videos  = await listChannelVideos(channel);
    const now     = new Date();

    const scheduled = videos
      .filter(v => v.privacyStatus === 'private' && v.scheduledAt && new Date(v.scheduledAt) > now)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))
      .slice(0, 14);

    const published = videos
      .filter(v => v.privacyStatus === 'public')
      .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
      .slice(0, 5);

    let lastStats = null;
    if (published.length > 0) {
      try {
        const s = await getVideoStats(published[0].videoId, channel);
        lastStats = { ...s, videoId: published[0].videoId, title: published[0].title, publishedAt: published[0].publishedAt };
      } catch {}
    }

    // Channel identity (sub count etc via channels.list)
    let channelInfo = null;
    try {
      const auth = await authenticate(channel);
      const yt   = googleApis.youtube({ version: 'v3', auth });
      const cr   = await yt.channels.list({ part: ['snippet', 'statistics'], mine: true });
      const ch   = cr.data.items?.[0];
      if (ch) channelInfo = {
        title:       ch.snippet?.title,
        description: ch.snippet?.description,
        thumbnail:   ch.snippet?.thumbnails?.default?.url,
        subs:        parseInt(ch.statistics?.subscriberCount || 0),
        totalViews:  parseInt(ch.statistics?.viewCount || 0),
        videoCount:  parseInt(ch.statistics?.videoCount || 0),
      };
    } catch {}

    const data = { channel, scheduled, published, lastStats, channelInfo };
    _ytCache.set(channel, { data, ts: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/youtube/queue/cache/:channel', (req, res) => {
  _ytCache.delete(req.params.channel);
  res.json({ ok: true });
});

// ─── METRICS BROADCAST ───────────────────────────────────────────────────────

setInterval(async () => {
  const [cpu, gpu] = await Promise.all([getCpu(), getGpu()]);
  broadcast({ type:'metrics', cpu, gpu });
}, 5000);

// ─── QUEUE WORKER ─────────────────────────────────────────────────────────────

let _queueWorkerProc = null;

function spawnQueueWorker() {
  const workerScript = path.join(ROOT, 'scripts', 'queue-worker.js');
  if (!fs.existsSync(workerScript)) {
    console.warn('[worker] queue-worker.js not found — queue processing disabled');
    return;
  }
  const workerLogOut = path.join(ROOT, 'data', 'queue-worker.log');
  const outStream = fs.openSync(workerLogOut, 'a');
  _queueWorkerProc = spawn(process.execPath, [workerScript], {
    cwd:   ROOT,
    stdio: ['ignore', outStream, outStream],
    env:   process.env,
  });
  _queueWorkerProc.on('exit', (code, signal) => {
    console.log(`[worker] Queue worker exited (code=${code} signal=${signal}) — restarting in 5s`);
    _queueWorkerProc = null;
    setTimeout(spawnQueueWorker, 5000);
  });
  _queueWorkerProc.on('error', err => {
    console.error(`[worker] Spawn error: ${err.message} — retrying in 5s`);
    _queueWorkerProc = null;
    setTimeout(spawnQueueWorker, 5000);
  });
  console.log(`[worker] Queue worker started PID=${_queueWorkerProc.pid}`);
}

// ─── START ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   JARVIS Command Center                   ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║   http://localhost:${PORT}                    ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
  spawnQueueWorker();
});
