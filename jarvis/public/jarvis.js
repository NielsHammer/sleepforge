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

// ─── AUDIO CONTEXT ───────────────────────────────────────────────────────────

let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

// ─── JARVIS VOICE PLAYBACK ────────────────────────────────────────────────────

let _speaking = false;

async function playJarvisVoice(text) {
  if (!text) return;
  _speaking = true;
  setStatus('RESPONDING');
  document.getElementById('core').classList.add('pulsing');

  try {
    const res = await fetch('/api/jarvis/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

    const arrayBuf = await res.arrayBuffer();
    const ctx      = getAudioCtx();
    const decoded  = await ctx.decodeAudioData(arrayBuf);
    const src      = ctx.createBufferSource();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 32;

    src.buffer = decoded;
    src.connect(analyser);
    analyser.connect(ctx.destination);
    src.start();

    // Audio-reactive outer ring
    const r1 = document.querySelector('.r1');
    const dataArr = new Uint8Array(analyser.frequencyBinCount);
    function animFrame() {
      if (!_speaking) { if (r1) r1.style.transform = ''; return; }
      analyser.getByteFrequencyData(dataArr);
      const avg   = dataArr.reduce((s,v) => s + v, 0) / dataArr.length;
      const scale = 1 + (avg / 255) * 0.45;
      if (r1) r1.style.transform = `translate(-50%, -50%) scale(${scale})`;
      requestAnimationFrame(animFrame);
    }
    requestAnimationFrame(animFrame);

    src.onended = () => {
      _speaking = false;
      if (r1) r1.style.transform = '';
      document.getElementById('core').classList.remove('pulsing');
      setStatus('STANDING BY');
    };
  } catch (e) {
    console.error('[voice]', e);
    _speaking = false;
    document.getElementById('core').classList.remove('pulsing');
    setStatus('STANDING BY');
  }
}

// ─── UI ACTIONS ──────────────────────────────────────────────────────────────

function handleActions(actions) {
  if (!Array.isArray(actions)) return;
  for (const a of actions) {
    switch (a.type) {
      case 'open_channel':
        setTimeout(() => openChannel(a.slug === 'astronomer' ? 'astronomer' : 'philosophers'), 600);
        break;
      case 'close_panel':
        closeChannel();
        break;
      case 'highlight_metric': {
        const ids = a.metric === 'subs'
          ? ['m-astro-subs',  'm-phil-subs']
          : ['m-astro-views', 'm-phil-views'];
        ids.forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          el.style.transition = 'color 0.2s, text-shadow 0.2s';
          el.style.color = '#FFB300';
          el.style.textShadow = '0 0 12px rgba(255,179,0,0.8)';
          setTimeout(() => { el.style.color = ''; el.style.textShadow = ''; }, 3000);
        });
        break;
      }
    }
  }
}

// ─── PANEL RENDERING ─────────────────────────────────────────────────────────

function renderPanels(panels) {
  if (!panels || panels.length === 0) return;
  let html = '';
  for (const p of panels) html += renderPanel(p);
  document.getElementById('channel-detail-content').innerHTML = html;
  document.getElementById('channel-overlay').classList.remove('hidden');
}

function renderPanel(panel) {
  const { type, title, data } = panel;
  switch (type) {
    case 'comparison':    return renderComparisonPanel(title, data);
    case 'video_list':    return renderVideoListPanel(title, data);
    case 'channel_stats': return renderChannelStatsPanel(title, data);
    case 'system_status': return renderSystemStatusPanel(title, data);
    case 'render_queue':  return renderQueuePanel(title, data);
    default:
      return `<div class="od-header"><div class="od-name">${esc(title || type.toUpperCase())}</div></div>
              <pre class="od-raw">${esc(JSON.stringify(data, null, 2))}</pre>`;
  }
}

function renderComparisonPanel(title, data) {
  const channels = data.channels || [];
  const cols = channels.map(ch => {
    const videos = (ch.recentVideos || []).slice(0, 5);
    const rows = videos.map(v => {
      const dt  = new Date(v.publishedAt);
      const day = dt.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      const views = v.views != null ? fmt(v.views) : '—';
      const likes = v.likes != null ? fmt(v.likes) : '—';
      return `<div class="od-video-row">
        <span class="od-date">${day}</span>
        <span class="od-title">${esc((v.title || '').slice(0, 50))}</span>
        <span class="od-stat">${views}v · ${likes}♥</span>
      </div>`;
    }).join('') || '<div class="od-empty">NO DATA</div>';
    return `<div class="od-section">
      <div class="od-sec-title">${esc((ch.title || ch.channel || '').toUpperCase())}</div>
      <div class="od-channel-stat-row">
        <span>${fmt(ch.subs || 0)} SUBS</span>
        <span>${fmt(ch.totalViews || 0)} VIEWS</span>
        <span>${ch.videoCount || '—'} VIDEOS</span>
      </div>
      ${rows}
    </div>`;
  }).join('');
  return `
    <div class="od-header"><div class="od-name">${esc(title || 'CHANNEL COMPARISON')}</div></div>
    <div class="od-sections od-comparison">${cols}</div>`;
}

function renderVideoListPanel(title, data) {
  const videos = data.videos || [];
  const rows = videos.map(v => {
    const dt    = new Date(v.publishedAt);
    const day   = dt.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
    const views = v.views != null ? fmt(v.views) : '—';
    const likes = v.likes != null ? fmt(v.likes) : '—';
    const link  = v.videoId
      ? `<a class="od-yt-link" href="https://youtube.com/watch?v=${v.videoId}" target="_blank">YT↗</a>` : '';
    return `<div class="od-video-row">
      <span class="od-date">${day}</span>
      <span class="od-title">${esc((v.title || '').slice(0, 56))}</span>
      <span class="od-stat">${views}v · ${likes}♥</span>
      ${link}
    </div>`;
  }).join('') || '<div class="od-empty">NO VIDEOS</div>';
  const heading = title || ((data.channel || '').toUpperCase() + ' — RECENT VIDEOS');
  return `
    <div class="od-header"><div class="od-name">${esc(heading)}</div></div>
    <div class="od-sections"><div class="od-section">${rows}</div></div>`;
}

function renderChannelStatsPanel(title, data) {
  return `
    <div class="od-header">
      <div class="od-name">${esc(title || (data.title || '').toUpperCase())}</div>
      <div class="od-stats">
        <span>${fmt(data.subs || 0)} SUBSCRIBERS</span>
        <span>${fmt(data.totalViews || 0)} TOTAL VIEWS</span>
        <span>${data.videoCount || '—'} VIDEOS</span>
      </div>
    </div>`;
}

function renderSystemStatusPanel(title, data) {
  const svc = data.services || {};
  const dot = ok => `<span class="hud-dot ${ok ? 'online' : 'offline'}" style="display:inline-block;margin-right:8px"></span>`;
  const vramText = data.vramUsed != null
    ? `${Math.round(data.vramUsed / 1024)}/${Math.round((data.vramTotal || 12288) / 1024)} GB`
    : '—';
  const ramText  = data.memUsed != null
    ? `${Math.round(data.memUsed / 1024)}/${Math.round((data.memTotal || 32768) / 1024)} GB`
    : '—';
  return `
    <div class="od-header"><div class="od-name">${esc(title || 'SYSTEM STATUS')}</div></div>
    <div class="od-sections">
      <div class="od-section">
        <div class="od-sec-title">COMPUTE</div>
        <div class="od-stat-grid">
          <div class="od-stat-row"><span>CPU</span><span>${data.cpu ?? '—'}%</span></div>
          <div class="od-stat-row"><span>GPU</span><span>${data.gpu ?? '—'}%</span></div>
          <div class="od-stat-row"><span>VRAM</span><span>${vramText}</span></div>
          <div class="od-stat-row"><span>RAM</span><span>${ramText}</span></div>
        </div>
      </div>
      <div class="od-section">
        <div class="od-sec-title">SERVICES</div>
        <div class="od-stat-grid">
          <div class="od-stat-row">${dot(svc.chatterbox)}<span>CHATTERBOX TTS</span></div>
          <div class="od-stat-row">${dot(svc.fal)}<span>FAL.AI</span></div>
          <div class="od-stat-row">${dot(svc.youtube)}<span>YOUTUBE API</span></div>
        </div>
      </div>
    </div>`;
}

function renderQueuePanel(title, data) {
  const renders = data.renders || [];
  const rows = renders.map(r => {
    const cls = r.status === 'done' ? 'od-priv public'
              : r.status === 'failed' ? 'od-priv private' : 'od-priv unlisted';
    return `<div class="od-video-row">
      <span class="${cls}">${(r.status || '').toUpperCase()}</span>
      <span class="od-title">${esc((r.topic || '').slice(0, 48))} <span class="od-date">[${esc(r.channel || '')}]</span></span>
      <span class="od-stat">${r.progress || 0}% — ${esc(r.step || '')}</span>
    </div>`;
  }).join('') || '<div class="od-empty">QUEUE EMPTY</div>';
  return `
    <div class="od-header"><div class="od-name">${esc(title || 'RENDER QUEUE')}</div></div>
    <div class="od-sections"><div class="od-section">${rows}</div></div>`;
}

// ─── COMMAND INPUT ────────────────────────────────────────────────────────────

function fillCmd(text) {
  const el = document.getElementById('command-input');
  if (!el) return;
  el.value = text;
  el.focus();
}

let _cmdPending = false;

async function sendCommand(cmdOverride) {
  if (_cmdPending) return;
  const el  = document.getElementById('command-input');
  const cmd = (cmdOverride || el.value || '').trim();
  if (!cmd) return;

  el.value = '';
  _cmdPending = true;
  setStatus('PROCESSING', true);

  // Show response panel immediately with "thinking" state
  const panel = document.getElementById('response-panel');
  document.getElementById('response-title').textContent = 'JARVIS';
  document.getElementById('response-body').textContent  = `> ${cmd}\n\n…`;
  panel.classList.remove('hidden', 'slide-in');
  void panel.offsetWidth;
  panel.classList.add('slide-in');

  try {
    const r = await fetch('/api/jarvis/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cmd }),
    });
    const data   = await r.json();
    const spoken = data.spoken || '';
    const panels = data.panels || [];

    document.getElementById('response-body').textContent = `> ${cmd}\n\n${spoken}`;
    setStatus(spoken.slice(0, 50).toUpperCase());

    // Start voice; show panels with brief delay so voice starts first
    const voicePromise = playJarvisVoice(spoken);
    if (panels.length > 0) setTimeout(() => renderPanels(panels), 700);
    await voicePromise;
  } catch (e) {
    document.getElementById('response-body').textContent = `> ${cmd}\n\n[JARVIS OFFLINE — ${e.message}]`;
    setStatus('ERROR');
    setTimeout(() => setStatus('STANDING BY'), 3000);
  } finally {
    _cmdPending = false;
  }
}

// ─── MIC / SPEECH RECOGNITION ────────────────────────────────────────────────

let _recognition = null;
let _micActive   = false;

function toggleMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setStatus('SPEECH API UNAVAILABLE');
    setTimeout(() => setStatus('STANDING BY'), 2000);
    return;
  }

  if (_micActive) {
    _micActive = false;
    if (_recognition) _recognition.stop();
    document.getElementById('cmd-mic').classList.remove('listening');
    setStatus('STANDING BY');
    return;
  }

  _micActive = true;
  document.getElementById('cmd-mic').classList.add('listening');
  setStatus('LISTENING');

  _recognition = new SR();
  _recognition.lang         = 'en-US';
  _recognition.interimResults = false;
  _recognition.maxAlternatives = 1;

  _recognition.onresult = e => {
    const transcript = e.results[0][0].transcript;
    document.getElementById('command-input').value = transcript;
    _micActive = false;
    document.getElementById('cmd-mic').classList.remove('listening');
    // Auto-submit
    sendCommand(transcript);
  };

  _recognition.onerror = () => {
    _micActive = false;
    document.getElementById('cmd-mic').classList.remove('listening');
    setStatus('MIC ERROR');
    setTimeout(() => setStatus('STANDING BY'), 2000);
  };

  _recognition.onend = () => {
    if (_micActive) {
      _micActive = false;
      document.getElementById('cmd-mic').classList.remove('listening');
      setStatus('STANDING BY');
    }
  };

  _recognition.start();
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
  document.getElementById('cmd-send').addEventListener('click', () => sendCommand());
  document.getElementById('cmd-mic').addEventListener('click', toggleMic);

  // Escape closes overlay
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeChannel();
  });
});
