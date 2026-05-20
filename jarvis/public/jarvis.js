'use strict';

// ════════════════════════════════════════════════════════════════════════════
// JARVIS v2 — Holographic Command Center
// ════════════════════════════════════════════════════════════════════════════

// ─── PARTICLES ───────────────────────────────────────────────────────────────

let pCanvas, pCtx;
const particles = [];
const PARTICLE_N = 90;

function initParticles() {
  pCanvas = document.getElementById('particles-canvas');
  pCtx    = pCanvas.getContext('2d');
  sizeCanvas();
  window.addEventListener('resize', sizeCanvas);
  for (let i = 0; i < PARTICLE_N; i++) particles.push(mkParticle());
  requestAnimationFrame(drawParticles);
}

function sizeCanvas() {
  pCanvas.width  = window.innerWidth;
  pCanvas.height = window.innerHeight;
}

function mkParticle() {
  return {
    x:  Math.random() * window.innerWidth,
    y:  Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.35,
    r:  Math.random() * 1.2 + 0.2,
    a:  Math.random() * 0.18 + 0.04,
    da: (Math.random() > 0.5 ? 1 : -1) * 0.0015,
  };
}

function drawParticles() {
  const w = pCanvas.width, h = pCanvas.height;
  pCtx.clearRect(0, 0, w, h);
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    p.a += p.da;
    if (p.a < 0.04 || p.a > 0.28) p.da *= -1;
    if (p.x < 0) p.x = w;  else if (p.x > w) p.x = 0;
    if (p.y < 0) p.y = h;  else if (p.y > h) p.y = 0;
    pCtx.beginPath();
    pCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    pCtx.fillStyle = `rgba(0,229,255,${p.a})`;
    pCtx.fill();
    if (p.a > 0.2) {
      pCtx.beginPath();
      pCtx.arc(p.x, p.y, p.r * 2.8, 0, Math.PI * 2);
      pCtx.fillStyle = `rgba(0,229,255,${p.a * 0.12})`;
      pCtx.fill();
    }
  }
  requestAnimationFrame(drawParticles);
}

// ─── CLOCK ───────────────────────────────────────────────────────────────────

function startClock() {
  const el  = document.getElementById('clock-bkk');
  const pad = n => String(n).padStart(2, '0');
  function tick() {
    const bkk = new Date(Date.now() + 7 * 3600000);
    el.textContent = `${pad(bkk.getUTCHours())}:${pad(bkk.getUTCMinutes())}:${pad(bkk.getUTCSeconds())}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ─── CORE STATUS ─────────────────────────────────────────────────────────────

let _statusTimer = null;

function setStatus(text, pulse = false) {
  const el = document.getElementById('core-status');
  if (el) el.textContent = text.toUpperCase().slice(0, 50);
  if (pulse) {
    const core = document.getElementById('core');
    core.classList.add('pulsing');
    clearTimeout(_statusTimer);
    _statusTimer = setTimeout(() => core.classList.remove('pulsing'), 2500);
  }
}

// ─── RIPPLES ─────────────────────────────────────────────────────────────────

function spawnRipple() {
  const host = document.getElementById('ripple-host');
  if (!host) return;
  const r = document.createElement('div');
  r.className = 'ripple';
  host.appendChild(r);
  setTimeout(() => r.remove(), 2700);
}

// ─── WEBSOCKET ───────────────────────────────────────────────────────────────

function connectWS() {
  try {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = e => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'metrics')    onMetrics(m);
        if (m.type === 'state')      onState(m);
        if (m.type === 'job_update') onJobUpdate(m);
      } catch (_) {}
    };
    ws.onclose = () => setTimeout(connectWS, 3000);
  } catch (_) {}
}

function onMetrics(d) {
  if (d.cpu != null) setText('cpu-val', d.cpu);

  // Server nests GPU data: d.gpu = { gpu: %, vram_used: MB, vram_total: MB }
  const gpuObj  = d.gpu && typeof d.gpu === 'object' ? d.gpu : null;
  const gpuPct  = gpuObj ? gpuObj.gpu : (typeof d.gpu === 'number' ? d.gpu : null);
  const vramUsed  = gpuObj ? gpuObj.vram_used  : null;
  const vramTotal = gpuObj ? gpuObj.vram_total : 12288;
  if (gpuPct  != null) setText('gpu-val',  gpuPct);
  if (vramUsed != null) {
    setText('vram-val', `${Math.round(vramUsed / 1024)}GB / ${Math.round(vramTotal / 1024)}GB`);
  }
}

function onState(m) {
  const count = (m.queue || []).filter(j => j.status === 'rendering').length;
  setText('render-count', count);
  if (count > 0) setStatus(`RENDERING ${count} VIDEO${count > 1 ? 'S' : ''}`);
}

function onJobUpdate(m) {
  const count = (m.queue || []).filter(j => j.status === 'rendering').length;
  setText('render-count', count);
  if (count > 0) setStatus(`RENDERING ${count} VIDEO${count > 1 ? 'S' : ''}`);
}

// ─── STATUS POLL ─────────────────────────────────────────────────────────────

function setDot(id, ok) {
  const el = document.getElementById(id);
  if (el) el.className = 'hud-dot ' + (ok ? 'online' : 'offline');
}

function setText(id, val) {
  if (val == null) return;
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function pollStatus() {
  fetch('/api/status').then(r => r.json()).then(d => {
    setDot('dot-tts', d.chatterbox);
    setDot('dot-fal', d.fal);
    setDot('dot-yt',  d.youtube);
    onMetrics(d);
    const count = (d.queue || []).filter(j => j.status === 'rendering').length;
    setText('render-count', count);
    const statusEl = document.getElementById('core-status');
    if (count > 0) {
      setStatus(`RENDERING ${count} VIDEO${count > 1 ? 'S' : ''}`);
    } else if (statusEl && statusEl.textContent.startsWith('RENDERING')) {
      setStatus('STANDING BY');
    }
  }).catch(() => {});
}

// ─── CHANNEL DATA ─────────────────────────────────────────────────────────────

const channelCache = {};

const CHANNELS = [
  { slug: 'sleepless-astronomer',   id: 'astro', name: 'ASTRONOMER',   label: 'Sleepless Astronomer' },
  { slug: 'sleepless-philosophers', id: 'phil',  name: 'PHILOSOPHERS', label: 'Sleepless Philosophers' },
];

async function loadChannels() {
  await Promise.all(CHANNELS.map(ch => loadChannelCard(ch)));
  setStatus('STANDING BY');
}

async function loadChannelCard(ch) {
  setStatus(`SCANNING ${ch.name}`);
  try {
    const r = await fetch(`/api/youtube/queue/${ch.slug}`);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    channelCache[ch.id] = { ...d, ...ch };
    renderCard(ch.id);
  } catch (_) {
    const card = document.getElementById(`card-${ch.id}`);
    if (card) card.innerHTML = `<div class="cc tl"></div><div class="cc tr"></div><div class="cc bl"></div><div class="cc br"></div><div class="card-loading">CHANNEL OFFLINE</div>`;
  }
}

function renderCard(id) {
  const d = channelCache[id];
  if (!d) return;
  const info      = d.channelInfo || {};
  const scheduled = d.scheduled   || [];
  const published  = d.published   || [];
  const lastStats  = d.lastStats   || {};
  const lastVid    = published[0];

  const qDots = scheduled.slice(0, 5).map(v => {
    const dt  = new Date(v.scheduledAt || v.publishedAt);
    const day = dt.toLocaleDateString('en', { weekday: 'short', timeZone: 'Asia/Bangkok' });
    return `<span class="q-dot" title="${esc(v.title)}">${day}</span>`;
  }).join('') || '<span class="q-empty">NONE QUEUED</span>';

  const lastBlock = lastVid ? `
    <div class="card-last">
      <div class="cl-title">${esc((lastVid.title || '').slice(0, 44))}${(lastVid.title || '').length > 44 ? '…' : ''}</div>
      ${lastStats.views ? `<div class="cl-stat">${fmt(lastStats.views)} views · ${lastStats.likes || '—'} likes</div>` : ''}
    </div>` : '';

  const card = document.getElementById(`card-${id}`);
  if (!card) return;
  card.innerHTML = `
    <div class="cc tl"></div><div class="cc tr"></div>
    <div class="cc bl"></div><div class="cc br"></div>
    <div class="card-badge badge-${id}">${d.name}</div>
    <div class="card-label">${d.label}</div>
    <div class="card-metrics">
      <div class="cm">
        <div class="cm-val" id="m-${id}-subs">—</div>
        <div class="cm-lbl">SUBSCRIBERS</div>
      </div>
      <div class="cm">
        <div class="cm-val" id="m-${id}-views">—</div>
        <div class="cm-lbl">TOTAL VIEWS</div>
      </div>
    </div>
    <div class="card-queue">
      <div class="cq-label">UPLOAD QUEUE</div>
      <div class="cq-dots">${qDots}</div>
    </div>
    ${lastBlock}
    <div class="card-expand-hint">CLICK TO EXPAND ▶</div>
  `;

  tickNumber(`m-${id}-subs`,   info.subs       || 0);
  tickNumber(`m-${id}-views`,  info.totalViews  || 0);
}

// ─── CHANNEL DETAIL OVERLAY ──────────────────────────────────────────────────

function openChannel(which) {
  const id = which === 'astronomer' ? 'astro' : 'phil';
  const d  = channelCache[id];
  if (!d) return;

  setStatus(`ANALYZING ${d.name}`, true);

  const info  = d.channelInfo || {};
  const sched = (d.scheduled || []).slice(0, 14);
  const pubs  = (d.published  || []).slice(0, 5);

  const schedRows = sched.length
    ? sched.map(v => {
        const dt = new Date(v.scheduledAt || v.publishedAt);
        return `<div class="od-video-row">
          <span class="od-date">${dt.toLocaleDateString('en',{month:'short',day:'numeric',timeZone:'Asia/Bangkok'})}</span>
          <span class="od-title">${esc((v.title || '').slice(0, 62))}</span>
        </div>`;
      }).join('')
    : '<div class="od-empty">NO SCHEDULED VIDEOS</div>';

  const pubRows = pubs.length
    ? pubs.map(v => {
        const dt = new Date(v.publishedAt);
        return `<div class="od-video-row">
          <span class="od-date">${dt.toLocaleDateString('en',{month:'short',day:'numeric',timeZone:'Asia/Bangkok'})}</span>
          <span class="od-title">${esc((v.title || '').slice(0, 62))}</span>
          <span class="od-priv ${v.privacyStatus || ''}">${(v.privacyStatus || '').toUpperCase()}</span>
        </div>`;
      }).join('')
    : '<div class="od-empty">NO RECENT UPLOADS</div>';

  document.getElementById('channel-detail-content').innerHTML = `
    <div class="od-header">
      <div class="od-name">${esc(d.label)}</div>
      <div class="od-stats">
        <span>${fmt(info.subs || 0)} SUBSCRIBERS</span>
        <span>${fmt(info.totalViews || 0)} TOTAL VIEWS</span>
        <span>${info.videoCount || '—'} VIDEOS</span>
      </div>
    </div>
    <div class="od-sections">
      <div class="od-section"><div class="od-sec-title">UPCOMING SCHEDULE</div>${schedRows}</div>
      <div class="od-section"><div class="od-sec-title">RECENT UPLOADS</div>${pubRows}</div>
    </div>
  `;

  const overlay = document.getElementById('channel-overlay');
  overlay.classList.remove('hidden');

  setTimeout(() => setStatus('STANDING BY'), 3000);
}

function closeChannel() {
  document.getElementById('channel-overlay').classList.add('hidden');
  setStatus('STANDING BY');
}

// ─── COMMAND INPUT ────────────────────────────────────────────────────────────

function fillCmd(text) {
  const el = document.getElementById('command-input');
  if (!el) return;
  el.value = text;
  el.focus();
}

function sendCommand() {
  const el  = document.getElementById('command-input');
  const cmd = (el.value || '').trim();
  if (!cmd) return;
  el.value = '';

  setStatus(cmd.slice(0, 50), true);

  const panel = document.getElementById('response-panel');
  document.getElementById('response-title').textContent = 'COMMAND RECEIVED';
  document.getElementById('response-body').textContent  =
    `> ${cmd}\n\n[ PHASE 2 — COMMAND EXECUTION PENDING ]\nWire-up coming in next session.`;
  panel.classList.remove('hidden', 'slide-in');
  void panel.offsetWidth;
  panel.classList.add('slide-in');

  setTimeout(() => {
    const s = document.getElementById('core-status');
    if (s && s.textContent === cmd.toUpperCase().slice(0, 50)) setStatus('STANDING BY');
  }, 5000);
}

// ─── UTILITIES ───────────────────────────────────────────────────────────────

function fmt(n) {
  n = +n || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tickNumber(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const dur   = 1400;
  const start = Date.now();
  (function tick() {
    const t    = Math.min(1, (Date.now() - start) / dur);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(ease * target));
    if (t < 1) requestAnimationFrame(tick);
  })();
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initParticles();
  startClock();
  connectWS();
  pollStatus();
  setInterval(pollStatus, 8000);
  loadChannels();

  // Ripple loop
  spawnRipple();
  setInterval(spawnRipple, 4200);

  // Command input
  document.getElementById('command-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendCommand();
  });
  document.getElementById('cmd-send').addEventListener('click', sendCommand);

  // Escape closes overlay
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeChannel();
  });
});
