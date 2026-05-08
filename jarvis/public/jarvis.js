/* ═══════════════════════════════════════════════════════════
   JARVIS — SleepForge Command Center — Frontend
═══════════════════════════════════════════════════════════ */

'use strict';

// ─── GLOBALS ──────────────────────────────────────────────────────────────────
let ws;
let voiceEnabled = true;
let libPage = 0;
let libSearch = '';
let libTotal = 0;
let activePanel = 'overview';
let ctrChart = null;
let viewsChart = null;
const PANELS = ['overview','channels','queue','analytics','library','settings'];

// ─── BOOT ANIMATION ───────────────────────────────────────────────────────────
const BOOT_LINES = [
  'INITIALIZING CORE SYSTEMS...',
  'LOADING SLEEPFORGE ENGINE v3.4...',
  'CONNECTING TO YOUTUBE OAUTH...',
  'SCANNING RENDER QUEUE...',
  'CALIBRATING CHALK IMAGE LIBRARY...',
  'JARVIS ONLINE. GOOD EVENING, SIR.',
];

function boot() {
  const bar   = document.getElementById('boot-bar');
  const log   = document.getElementById('boot-log');
  const el    = document.getElementById('boot');
  initBootParticles();

  let i = 0;
  function nextLine() {
    if (i >= BOOT_LINES.length) {
      setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => {
          el.style.display = 'none';
          document.getElementById('app').classList.remove('hidden');
          onAppReady();
        }, 800);
      }, 400);
      return;
    }
    log.textContent = BOOT_LINES[i];
    bar.style.width = `${Math.round(((i+1)/BOOT_LINES.length)*100)}%`;
    i++;
    setTimeout(nextLine, i === BOOT_LINES.length ? 600 : 340);
  }
  setTimeout(nextLine, 400);
}

function onAppReady() {
  initParticles();
  initClock();
  initWebSocket();
  loadPanel('overview');
  pollMetrics();
}

// ─── BOOT PARTICLES ─────────────────────────────────────────────────────────
function initBootParticles() {
  const canvas = document.getElementById('boot-particles');
  const ctx    = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const pts = Array.from({length:60}, () => ({
    x: Math.random()*canvas.width, y: Math.random()*canvas.height,
    vx: (Math.random()-.5)*.3, vy: (Math.random()-.5)*.3,
    r: Math.random()*1.5+.5, a: Math.random()*.4+.05,
  }));

  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (const p of pts) {
      p.x = (p.x+p.vx+canvas.width)  % canvas.width;
      p.y = (p.y+p.vy+canvas.height) % canvas.height;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(0,212,255,${p.a})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ─── MAIN PARTICLES ─────────────────────────────────────────────────────────
function initParticles() {
  const canvas = document.getElementById('particles');
  const ctx    = canvas.getContext('2d');
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);

  const pts = Array.from({length:80}, () => ({
    x: Math.random()*canvas.width, y: Math.random()*canvas.height,
    vx: (Math.random()-.5)*.2, vy: (Math.random()-.5)*.2,
    r: Math.random()*1.2+.3, a: Math.random()*.18+.03,
    pulse: Math.random()*Math.PI*2,
  }));

  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const t = Date.now()/1000;
    for (const p of pts) {
      p.x = (p.x+p.vx+canvas.width)  % canvas.width;
      p.y = (p.y+p.vy+canvas.height) % canvas.height;
      const alpha = p.a * (0.7 + 0.3*Math.sin(t*0.8+p.pulse));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      ctx.fillStyle = `rgba(0,212,255,${alpha})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }
  draw();
}

// ─── CLOCK ───────────────────────────────────────────────────────────────────
function initClock() {
  const clockEl = document.getElementById('clock');
  const dateEl  = document.getElementById('dateline');
  function tick() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('en-GB', { hour12: false });
    dateEl.textContent  = now.toLocaleDateString('en-GB', { weekday:'long', year:'numeric', month:'long', day:'numeric' }).toUpperCase();
  }
  tick();
  setInterval(tick, 1000);
}

// ─── WEBSOCKET ───────────────────────────────────────────────────────────────
function initWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.type === 'metrics')    handleMetrics(msg);
    if (msg.type === 'state')      handleStateUpdate(msg.data);
    if (msg.type === 'job_update') handleJobUpdate(msg.job);
    if (msg.type === 'render_complete') {
      addChatMsg('jarvis', `Render complete, sir. Video ID: ${msg.job?.videoId || 'pending'}. Check the queue for the link.`);
      speakText('Render complete, sir.');
    }
  };

  ws.onclose  = () => setTimeout(initWebSocket, 3000);
  ws.onerror  = () => {};
}

function handleMetrics({ cpu, gpu }) {
  if (cpu != null) document.getElementById('cpu-val').textContent = cpu;
  if (gpu?.gpu != null) {
    document.getElementById('gpu-val').textContent  = gpu.gpu;
    if (gpu.vram_used != null && gpu.vram_total != null) {
      document.getElementById('vram-val').textContent = `${(gpu.vram_used/1024).toFixed(1)}/${(gpu.vram_total/1024).toFixed(0)}G`;
    }
  }
}

function handleStateUpdate(state) {
  if (activePanel === 'queue')    renderQueuePanel(state.renders);
  if (activePanel === 'overview') renderQueueOverview(state.renders);
}

function handleJobUpdate(job) {
  if (!job) return;
  if (activePanel === 'queue')    updateQueueRow(job);
  if (activePanel === 'overview') renderQueueOverview(null);
}

// ─── METRICS POLL ────────────────────────────────────────────────────────────
async function pollMetrics() {
  try {
    const s = await apiFetch('/api/status');
    if (s.cpu != null) document.getElementById('cpu-val').textContent = s.cpu;
    if (s.gpu?.gpu != null) document.getElementById('gpu-val').textContent = s.gpu.gpu;
    if (s.gpu?.vram_used != null && s.gpu?.vram_total != null) {
      document.getElementById('vram-val').textContent = `${(s.gpu.vram_used/1024).toFixed(1)}/${(s.gpu.vram_total/1024).toFixed(0)}G`;
    }
    // Update diagnostics if visible
    const diag = {
      'diag-tts':  s.services?.chatterbox,
      'diag-fal':  s.services?.fal,
      'diag-yt':   s.services?.youtube,
    };
    for (const [id, ok] of Object.entries(diag)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent  = ok ? 'ONLINE' : 'OFFLINE';
      el.className    = ok ? 'badge-ok' : 'badge-err';
    }
  } catch {}
  setTimeout(pollMetrics, 6000);
}

// ─── PANEL SWITCHING ─────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const p = item.dataset.panel;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    loadPanel(p);
  });
});

function loadPanel(name) {
  activePanel = name;
  PANELS.forEach(p => {
    const el = document.getElementById(`panel-${p}`);
    if (el) el.classList.toggle('active', p === name);
  });
  switch(name) {
    case 'overview':  loadOverview();   break;
    case 'channels':  loadChannels();   break;
    case 'queue':     loadQueue();      break;
    case 'analytics': loadAnalytics();  break;
    case 'library':   resetLibrary();   break;
    case 'settings':  loadSettings();   break;
  }
}

// ─── OVERVIEW ────────────────────────────────────────────────────────────────
async function loadOverview() {
  const [videos, channels, state, status] = await Promise.all([
    apiFetch('/api/videos'),
    apiFetch('/api/channels'),
    apiFetch('/api/state'),
    apiFetch('/api/status').catch(() => ({})),
  ]);

  // Stat cards
  animateCount('sc-videos',   videos.length);
  animateCount('sc-channels', channels.length);

  // Estimated views & earnings (mock: assume each video gets avg 150 views in first 30d)
  const estViews = videos.length * 150;
  const estEarn  = Math.round(estViews / 1000 * 20 * 100) / 100;
  animateCount('sc-views', estViews);
  setStatNum('sc-earn', `$${estEarn.toFixed(0)}`);

  // Queue items
  renderQueueOverview(state.renders);

  // Recent videos
  renderRecentVideos(videos.slice(0,8));

  // Diagnostics
  const diag = {
    'diag-tts': status?.services?.chatterbox,
    'diag-fal': status?.services?.fal,
    'diag-yt':  status?.services?.youtube,
  };
  for (const [id, ok] of Object.entries(diag)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = ok ? 'ONLINE' : 'OFFLINE';
    el.className   = ok ? 'badge-ok' : 'badge-err';
  }
}

function renderQueueOverview(renders) {
  const el = document.getElementById('ov-queue');
  if (!el) return;
  if (!renders) {
    apiFetch('/api/state').then(s => renderQueueOverview(s.renders));
    return;
  }
  const active = renders.filter(r => ['queued','rendering','uploading'].includes(r.status));
  if (!active.length) {
    el.innerHTML = `<div style="padding:12px 0;color:var(--text-dim);font-size:11px;letter-spacing:1px;">Queue empty, sir.</div>`;
    return;
  }
  el.innerHTML = active.map(r => `
    <div class="queue-row">
      <div class="qr-topic">${esc(r.topic)}</div>
      <div class="qr-status ${r.status}">${r.status.toUpperCase()}</div>
      <div class="progress-bar-wrap"><div class="progress-bar" style="width:${r.progress||0}%"></div></div>
    </div>`).join('');
}

function renderRecentVideos(videos) {
  const el = document.getElementById('ov-recent');
  if (!el) return;
  if (!videos.length) {
    el.innerHTML = `<div style="padding:12px 0;color:var(--text-dim);font-size:11px;">No videos yet.</div>`;
    return;
  }
  el.innerHTML = videos.map(v => `
    <div class="recent-row">
      ${v.thumbnailUrl
        ? `<img class="recent-thumb" src="${v.thumbnailUrl}" alt="">`
        : `<div class="recent-thumb-placeholder">▶</div>`}
      <div class="recent-title">${esc(v.title)}</div>
      <div class="recent-meta">${relTime(v.created)}</div>
    </div>`).join('');
}

// ─── CHANNELS ─────────────────────────────────────────────────────────────────
async function loadChannels() {
  const [channels, videos] = await Promise.all([apiFetch('/api/channels'), apiFetch('/api/videos')]);
  const grid = document.getElementById('ch-grid');
  document.getElementById('ch-detail').classList.add('hidden');
  document.getElementById('ch-grid').classList.remove('hidden');

  if (!channels.length) {
    grid.innerHTML = `<div style="color:var(--text-dim);padding:24px;">No channels connected yet, sir.</div>`;
    return;
  }

  grid.innerHTML = channels.map(ch => {
    const chVideos = videos.filter(v => v.channel === ch.slug);
    return `
      <div class="ch-card" onclick="openChannelDetail('${esc(ch.slug)}')">
        <div class="ch-card-name">${esc(ch.name)}</div>
        <div class="ch-card-meta">
          <div>Videos: <strong>${chVideos.length}</strong></div>
          <div>Slug: <strong>${esc(ch.slug)}</strong></div>
          <div>Est. Views: <strong>${chVideos.length * 150}</strong></div>
        </div>
        <button class="ch-open-btn">OPEN CHANNEL →</button>
      </div>`;
  }).join('');
}

async function openChannelDetail(slug) {
  document.getElementById('ch-grid').classList.add('hidden');
  const detail = document.getElementById('ch-detail');
  detail.classList.remove('hidden');
  document.getElementById('ch-detail-title').textContent = slug.replace(/-/g,' ').toUpperCase();

  const videos = await apiFetch('/api/videos');
  const chVideos = videos.filter(v => v.channel === slug);
  const grid = document.getElementById('ch-video-grid');

  if (!chVideos.length) {
    grid.innerHTML = `<div style="color:var(--text-dim);padding:24px;">No videos for this channel yet.</div>`;
    return;
  }

  grid.innerHTML = chVideos.map(v => `
    <div class="ch-vid-card">
      ${v.thumbnailUrl
        ? `<img class="ch-vid-thumb" src="${v.thumbnailUrl}" alt="">`
        : `<div class="ch-vid-thumb-placeholder">▶</div>`}
      <div class="ch-vid-info">
        <div class="ch-vid-title">${esc(v.title)}</div>
        <div class="ch-vid-meta">${relTime(v.created)} · ${v.sizeMb}MB
          ${v.videoId ? `<br><a href="https://youtube.com/watch?v=${v.videoId}" target="_blank" style="color:var(--cyan)">YouTube ↗</a>` : ''}
        </div>
      </div>
    </div>`).join('');
}

function closeChannelDetail() {
  document.getElementById('ch-detail').classList.add('hidden');
  document.getElementById('ch-grid').classList.remove('hidden');
}

// ─── QUEUE ────────────────────────────────────────────────────────────────────
async function loadQueue() {
  const state = await apiFetch('/api/state');
  const channels = await apiFetch('/api/channels');

  // Populate modal channel select
  const sel = document.getElementById('modal-channel');
  sel.innerHTML = channels.map(c => `<option value="${c.slug}">${c.name}</option>`).join('');

  renderQueuePanel(state.renders);
}

function renderQueuePanel(renders) {
  const container = document.getElementById('queue-rows');
  if (!container) return;

  if (!renders || !renders.length) {
    container.innerHTML = `<div class="empty-queue">Queue empty. All quiet on the western front, sir.</div>`;
    return;
  }

  container.innerHTML = renders.map(r => `
    <div class="queue-table-row" id="qrow-${r.id}">
      <div class="qtr-topic">${esc(r.topic)}</div>
      <div class="qtr-channel">${esc(r.channel || '—')}</div>
      <div><span class="qr-status ${r.status}">${r.status.toUpperCase()}</span></div>
      <div>
        <div class="progress-bar-wrap" style="width:100%">
          <div class="progress-bar" style="width:${r.progress||0}%"></div>
        </div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:3px;">${esc(r.step||'')}</div>
      </div>
      <div class="qtr-time">${relTime(r.createdAt)}</div>
    </div>`).join('');
}

function updateQueueRow(job) {
  const row = document.getElementById(`qrow-${job.id}`);
  if (!row) { loadQueue(); return; }
  const statusEl = row.querySelector('.qr-status');
  const barEl    = row.querySelector('.progress-bar');
  const stepEl   = row.querySelectorAll('div')[3]?.querySelector('div:last-child');
  if (statusEl) { statusEl.textContent = job.status.toUpperCase(); statusEl.className = `qr-status ${job.status}`; }
  if (barEl)    barEl.style.width = `${job.progress||0}%`;
  if (stepEl)   stepEl.textContent = job.step || '';
}

function openAddModal()  { document.getElementById('add-modal').classList.remove('hidden'); }
function closeAddModal() { document.getElementById('add-modal').classList.add('hidden'); }

async function submitQueue() {
  const topic   = document.getElementById('modal-topic').value.trim();
  const channel = document.getElementById('modal-channel').value;
  const sched   = document.getElementById('modal-schedule').value;
  if (!topic) { alert('Please enter a topic.'); return; }

  closeAddModal();
  document.getElementById('modal-topic').value = '';

  await apiFetch('/api/queue/add', 'POST', { topic, channel, scheduledAt: sched || null });
  loadPanel('queue');
  addChatMsg('jarvis', `Queuing "${topic}" for ${channel}, sir. I'll notify you when it's ready.`);
}

// ─── ANALYTICS ───────────────────────────────────────────────────────────────
async function loadAnalytics() {
  const videos = await apiFetch('/api/videos');

  // Generate mock trend data (30 days)
  const labels = Array.from({length:30}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-29+i);
    return d.toLocaleDateString('en-GB',{month:'short',day:'numeric'});
  });

  // Mock CTR data growing over time
  const ctrData   = labels.map((_,i) => +(2.5 + i*0.12 + Math.sin(i*0.7)*0.8).toFixed(2));
  const viewsData = labels.map((_,i) => Math.round(20 + i*8 + Math.sin(i*0.5)*15));

  renderChart('chart-ctr',   ctrData,   labels, 'CTR %', '#00d4ff', 0, 20);
  renderChart('chart-views', viewsData, labels, 'Views', '#ffb300', 0, null);

  // Top videos table
  const tableEl = document.getElementById('analytics-table');
  const topVids = videos.slice(0,10).map((v, i) => ({
    ...v,
    ctr:       +(4 + Math.random()*8).toFixed(1),
    views:     Math.round(50+Math.random()*500),
    retention: Math.round(35+Math.random()*40),
  }));

  tableEl.innerHTML = `
    <div class="at-header">
      <span>TITLE</span><span>CHANNEL</span><span>CTR</span><span>VIEWS</span><span>RETENTION</span>
    </div>
    ${topVids.map(v => `
      <div class="at-row">
        <div class="at-title">${esc(v.title)}</div>
        <div class="at-channel">${esc(v.channel||'—')}</div>
        <div class="at-ctr">
          <div class="ctr-bar-wrap">
            <div class="ctr-bar" style="width:${Math.min(v.ctr*4,100)}px"></div>
            <span>${v.ctr}%</span>
          </div>
        </div>
        <div class="at-views">${v.views.toLocaleString()}</div>
        <div class="at-ret">${v.retention}%</div>
      </div>`).join('')}`;
}

function renderChart(id, data, labels, label, color, min, max) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (id === 'chart-ctr' && ctrChart)    { ctrChart.destroy();   ctrChart   = null; }
  if (id === 'chart-views' && viewsChart){ viewsChart.destroy(); viewsChart = null; }

  const chart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor:     color,
        backgroundColor: color.replace(')',',0.08)').replace('rgb','rgba'),
        borderWidth:     2,
        pointRadius:     0,
        pointHoverRadius:4,
        tension:         0.4,
        fill:            true,
      }],
    },
    options: {
      responsive:true, maintainAspectRatio:true,
      plugins: { legend:{ display:false }, tooltip:{ mode:'index', intersect:false } },
      scales: {
        x: {
          grid:{ color:'rgba(0,212,255,0.06)' },
          ticks:{ color:'#3d6a8a', font:{ family:'Share Tech Mono', size:9 }, maxRotation:0,
                  maxTicksLimit:8 },
        },
        y: {
          min, max,
          grid:{ color:'rgba(0,212,255,0.06)' },
          ticks:{ color:'#3d6a8a', font:{ family:'Share Tech Mono', size:9 } },
        },
      },
    },
  });
  if (id === 'chart-ctr')   ctrChart   = chart;
  if (id === 'chart-views') viewsChart = chart;
}

// ─── LIBRARY ──────────────────────────────────────────────────────────────────
function resetLibrary() {
  libPage = 0; libSearch = '';
  document.getElementById('lib-search').value = '';
  document.getElementById('lib-grid').innerHTML = '';
  loadMoreLibrary();

  // Wire up search
  const input = document.getElementById('lib-search');
  input.oninput = debounce(() => {
    libSearch = input.value;
    libPage   = 0;
    document.getElementById('lib-grid').innerHTML = '';
    loadMoreLibrary();
  }, 350);
}

async function loadMoreLibrary() {
  const res = await apiFetch(`/api/library?page=${libPage}&limit=80&search=${encodeURIComponent(libSearch)}`);
  libTotal  = res.total;
  libPage++;

  const grid = document.getElementById('lib-grid');
  document.getElementById('lib-count').textContent = `${libTotal} images`;

  const frag = document.createDocumentFragment();
  for (const img of res.items) {
    const card = document.createElement('div');
    card.className = 'lib-img-card';
    card.innerHTML = `
      <img src="/library/${img.file}" alt="" loading="lazy">
      <div class="lib-img-overlay">
        <div class="lib-img-label">${esc(img.philosopher||'')}<br>${esc(img.era||'')}</div>
      </div>`;
    card.onclick = () => openLightbox(img);
    frag.appendChild(card);
  }
  grid.appendChild(frag);

  const moreBtn = document.getElementById('lib-more');
  moreBtn.classList.toggle('hidden', libPage * 80 >= libTotal);
}

function openLightbox(img) {
  document.getElementById('lb-img').src = `/library/${img.file}`;
  document.getElementById('lb-meta').innerHTML =
    `<strong>Philosopher:</strong> ${esc(img.philosopher||'—')}<br>` +
    `<strong>Era:</strong> ${esc(img.era||'—')}<br>` +
    `<strong>School:</strong> ${esc(img.school_of_thought||'—')}<br>` +
    `<strong>Mood:</strong> ${esc(img.mood||'—')}<br>` +
    `<strong>Keywords:</strong> ${(img.keywords||[]).join(', ')}`;
  document.getElementById('lightbox').classList.remove('hidden');
}
function closeLightbox() { document.getElementById('lightbox').classList.add('hidden'); }

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await apiFetch('/api/settings');
  setKeyStatus('key-fal', s.keys.fal);
  setKeyStatus('key-yt',  s.keys.youtube);
}

function setKeyStatus(id, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = ok ? '✓ CONNECTED' : '✗ MISSING';
  el.className   = ok ? 'key-ok' : 'key-err';
}

// ─── CHAT BAR ────────────────────────────────────────────────────────────────
document.getElementById('chat-in').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

document.getElementById('voice-on')?.addEventListener('change', e => {
  voiceEnabled = e.target.checked;
});

async function sendMessage() {
  const input = document.getElementById('chat-in');
  const btn   = document.getElementById('send-btn');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  addChatMsg('user', text);
  btn.disabled = true;

  const thinking = addChatMsg('jarvis', 'Processing your query, sir…', true);

  try {
    const res = await apiFetch('/api/jarvis/chat', 'POST', { message: text });
    thinking.remove();
    addChatMsg('jarvis', res.reply);
    if (voiceEnabled && res.reply) speakText(res.reply);
  } catch(err) {
    thinking.remove();
    addChatMsg('jarvis', 'My apologies, sir. The neural link appears unstable.');
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

function addChatMsg(who, text, thinking = false) {
  const msgs = document.getElementById('chat-msgs');
  const div  = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `
    <span class="chat-who ${who}">${who === 'user' ? 'SIR' : 'JARVIS'}</span>
    <span class="chat-text${thinking ? ' thinking':''}">${esc(text)}</span>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

// ─── VOICE / EDGE TTS ────────────────────────────────────────────────────────
async function speakText(text) {
  if (!voiceEnabled) return;
  try {
    const res = await fetch('/api/jarvis/speak', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ text: text.slice(0,200) }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {}
}

// ─── STAT CARD COUNT-UP ──────────────────────────────────────────────────────
function animateCount(cardId, target) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const el = card.querySelector('.stat-num');
  if (!el) return;
  const start    = 0;
  const duration = 1200;
  const startTs  = performance.now();

  function step(ts) {
    const elapsed = ts - startTs;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = 1 - Math.pow(1-progress, 3);
    const val      = Math.round(start + (target-start)*eased);
    el.textContent = val.toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function setStatNum(cardId, value) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const el = card.querySelector('.stat-num');
  if (el) el.textContent = value;
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m/60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h/24)}d ago`;
}

async function apiFetch(url, method='GET', body=null) {
  const opts = { method, headers:{ 'Content-Type':'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res  = await fetch(url, opts);
  if (!res.ok) throw new Error(`API ${url}: ${res.status}`);
  return res.json();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── INIT ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);
