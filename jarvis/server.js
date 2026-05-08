/**
 * JARVIS Command Center — SleepForge dashboard server.
 * Port 3001. Express + WebSocket. Plain Node, no build step.
 */

import express        from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { exec, spawn } from 'child_process';
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

// ─── EDGE TTS (direct WebSocket — no npm dep needed) ─────────────────────────

const TTS_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const TTS_URL   = `wss://speech.platform.bing.com/consumer/speech/synthesize/realtimeaudio/edge/v1?TrustedClientToken=${TTS_TOKEN}`;

async function synthesize(text, voice = 'en-GB-RyanNeural', rate = '+5%') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(TTS_URL, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin':          'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Pragma':          'no-cache',
        'Cache-Control':   'no-cache',
      }
    });

    const chunks = [];
    const reqId  = crypto.randomUUID().replace(/-/g,'');
    const ts     = new Date().toISOString().replace(/T/,' ').replace(/\.\d+Z/,'');
    const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    ws.on('open', () => {
      ws.send(
        `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`
      );
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody rate='${rate}'>${escaped}</prosody></voice></speak>`;
      ws.send(`X-RequestId:${reqId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.on('message', (data) => {
      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) { ws.close(); resolve(Buffer.concat(chunks)); }
      } else if (data.length > 2) {
        const hlen = data.readUInt16BE(0);
        if (data.length > 2 + hlen) chunks.push(data.slice(2 + hlen));
      }
    });

    const t = setTimeout(() => { ws.close(); reject(new Error('TTS timeout')); }, 15000);
    ws.on('error', e => { clearTimeout(t); reject(e); });
    ws.on('close', ()  => clearTimeout(t));
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

async function askJarvis(question, ctx) {
  const prompt = `${JARVIS_SYS}\n\nCURRENT CONTEXT:\n${JSON.stringify(ctx,null,2)}\n\nUSER: ${question}\n\nJARVIS:`;
  return callClaudeCLI(prompt, { model: 'claude-sonnet-4-6', timeoutMs: 30000 });
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
    const mp3 = await synthesize(text);
    res.set('Content-Type','audio/mpeg');
    res.set('Content-Length', String(mp3.length));
    res.send(mp3);
  } catch(err) {
    console.error('TTS error:', err.message);
    res.status(500).json({ error: err.message });
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
