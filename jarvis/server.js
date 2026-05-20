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

const JARVIS_AGENT_SYS = `You are JARVIS, Tony Stark's AI assistant running SleepForge — an automated YouTube sleep-story production system.
PERSONALITY: Dry, precise British wit. Address Niels as "sir". speak field: max 2 sentences, no markdown, no bullet points. Use exact numbers from data only. Subtle sarcasm permitted.
CHANNELS: "astronomer" = Sleepless Astronomer | "philosophers" = Sleepless Philosophers

AVAILABLE TOOLS:
list_channels() → [{slug, name}]
get_channel_stats(channel: "astronomer"|"philosophers") → {title, subs, totalViews, videoCount}
get_recent_videos(channel: "astronomer"|"philosophers", limit?: number) → [{videoId, title, publishedAt, views, likes}]
get_scheduled_queue(channel: "astronomer"|"philosophers", limit?: number) → [{title, scheduledAt}]
get_system_status() → {cpu, gpu, vramUsed, vramTotal, memUsed, memTotal, services}
get_render_queue() → [{topic, channel, status, progress, step}]
get_local_videos(limit?: number) → [{slug, title, channel, sizeMb, videoId}]
get_library_stats() → {totalImages, keywordCount}

PANEL TYPES (rendered as UI cards):
- video_list → data: {channel, videos: [{videoId, title, publishedAt, views, likes}]}
- channel_stats → data: {channel, title, subs, totalViews, videoCount}
- comparison → data: {channels: [{channel, title, subs, totalViews, videoCount, recentVideos: [{title, publishedAt, views, likes}]}]}
- system_status → data: {cpu, gpu, vramUsed, vramTotal, memUsed, memTotal, services: {chatterbox, fal, youtube}}
- render_queue → data: {renders: [{topic, channel, status, progress, step}]}

RESPONSE FORMAT — output ONLY valid JSON, nothing else:
{"think":"1 sentence reasoning","speak":"1-2 sentence British JARVIS response","tools":[{"name":"...","args":{...}}],"panels":[{"type":"...","title":"...","data":{...}}],"done":false}

CRITICAL RULES:
1. done=false when tools are needed first, done=true when response is final.
2. If user asks about MULTIPLE channels, call tools for ALL channels in ONE response.
3. speak never recites numbers — panels display data visually. speak just acknowledges.
4. Never invent or guess data. Always call the relevant tools first.
5. After receiving tool results, set done=true and emit final panels.
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
    fs.writeFileSync(JARVIS_SESSION_FILE, JSON.stringify(history.slice(-40), null, 2));
  } catch {}
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

async function executeJarvisTool(name, args = {}) {
  try {
    switch (name) {

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
        const withStats = await Promise.all(pubs.map(async (v, i) => {
          if (i === 0 && d.lastStats?.videoId === v.videoId) {
            return { videoId: v.videoId, title: v.title, publishedAt: v.publishedAt,
                     views: d.lastStats.views, likes: d.lastStats.likes };
          }
          try {
            const s = await getVideoStats(v.videoId, ch);
            return { videoId: v.videoId, title: v.title, publishedAt: v.publishedAt,
                     views: s.views, likes: s.likes };
          } catch {
            return { videoId: v.videoId, title: v.title, publishedAt: v.publishedAt,
                     views: null, likes: null };
          }
        }));
        return withStats;
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
          memUsed:  Math.round(usedMem / 1024 / 1024),
          memTotal: Math.round(os.totalmem() / 1024 / 1024),
          services: {
            chatterbox,
            fal:     !!process.env.FAL_KEY,
            youtube: fs.existsSync(TOKENS_DIR) && fs.readdirSync(TOKENS_DIR).filter(f=>f.endsWith('.json')).length > 0,
          },
        };
      }

      case 'get_render_queue': {
        const state = readState();
        return state.renders.slice(0, 10).map(r => ({
          topic: r.topic, channel: r.channel, status: r.status, progress: r.progress, step: r.step,
        }));
      }

      case 'get_local_videos': {
        const limit = Math.min(args.limit || 10, 20);
        return listVideos().slice(0, limit).map(v => ({
          slug: v.slug, title: v.title, channel: v.channel, sizeMb: v.sizeMb, videoId: v.videoId,
        }));
      }

      case 'get_library_stats': {
        if (!fs.existsSync(LIBRARY_INDEX)) return { totalImages: 0, keywordCount: 0 };
        const idx = JSON.parse(fs.readFileSync(LIBRARY_INDEX, 'utf-8'));
        const kw  = new Set(idx.flatMap(e => e.keywords || []));
        return { totalImages: idx.length, keywordCount: kw.size };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e.message };
  }
}

function buildAgentPrompt(turns) {
  let p = JARVIS_AGENT_SYS + '\n\n';
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
  const MAX_ITERS = 5;
  const turns     = [...history, { role: 'user', text: userText }];
  let spokenFinal = '';
  let panelsFinal = [];
  let toolsExecuted = [];

  for (let i = 0; i < MAX_ITERS; i++) {
    const prompt = buildAgentPrompt(turns);
    const raw    = await callClaudeCLI(prompt, { model: 'claude-sonnet-4-6', timeoutMs: 60000 });

    let parsed;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      spokenFinal = raw.replace(/[*#`]/g, '').trim().slice(0, 300);
      turns.push({ role: 'assistant', text: spokenFinal });
      break;
    }
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch {
      spokenFinal = raw.replace(/[*#`]/g, '').trim().slice(0, 300);
      turns.push({ role: 'assistant', text: spokenFinal });
      break;
    }

    if (parsed.speak)            spokenFinal = parsed.speak;
    if (parsed.panels?.length)   panelsFinal = parsed.panels;

    const toolCalls = parsed.tools || [];
    turns.push({ role: 'assistant', rawJson: jsonMatch[0] });

    if (parsed.done || toolCalls.length === 0) break;

    const results = await Promise.all(toolCalls.map(async call => {
      toolsExecuted.push({ name: call.name, args: call.args });
      const result = await executeJarvisTool(call.name, call.args || {});
      return { tool: call.name, args: call.args, result };
    }));

    turns.push({ role: 'tool_results', results });
  }

  return {
    spoken:    spokenFinal || 'Done, sir.',
    panels:    panelsFinal,
    toolsExecuted,
    updatedHistory: turns.filter(t => t.role === 'user' || t.role === 'assistant').slice(-20),
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

// ─── START ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║   JARVIS Command Center                   ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║   http://localhost:${PORT}                    ║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
});
