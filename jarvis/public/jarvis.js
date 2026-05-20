'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
let ws;
let _jobs = [];
const _ytData = {}; // channelSlug -> { scheduled, published, lastStats, channelInfo }

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startClock();
  connectWS();
  pollStatus();
  loadOverviewData();
  if (window.lucide) lucide.createIcons();
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
});

// ─── CLOCK (Bangkok UTC+7) ────────────────────────────────────────────────────
function startClock() {
  function tick() {
    const now = new Date();
    const bkk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const h = String(bkk.getHours()).padStart(2,'0');
    const m = String(bkk.getMinutes()).padStart(2,'0');
    const s = String(bkk.getSeconds()).padStart(2,'0');
    const clockEl = document.getElementById('clock-bkk');
    if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;
    const dateEl = document.getElementById('clock-date');
    if (dateEl) dateEl.textContent = bkk.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', timeZone:'Asia/Bangkok' }) + ' BKK';
  }
  tick();
  setInterval(tick, 1000);
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('message', e => {
    try { handleWSMessage(JSON.parse(e.data)); } catch {}
  });
  ws.addEventListener('close', () => setTimeout(connectWS, 3000));
}

function handleWSMessage(msg) {
  if (msg.type === 'state')      { _jobs = msg.data?.renders || []; renderAllJobs(); }
  if (msg.type === 'job_update') { syncJob(msg.job); renderAllJobs(); }
  if (msg.type === 'metrics')    { updateMetrics(msg); }
}

function syncJob(job) {
  const idx = _jobs.findIndex(j => j.id === job.id);
  if (idx >= 0) _jobs[idx] = job; else _jobs.unshift(job);
}

// ─── SYSTEM STATUS ────────────────────────────────────────────────────────────
async function pollStatus() {
  try {
    const d = await fetchJSON('/api/status');
    setDot('chatterbox', d.services?.chatterbox);
    setDot('fal',        !!d.services?.fal);
    setDot('yt',         d.services?.youtube);
    setText('cpu-val', d.cpu ?? '--');
    setText('gpu-val', d.gpu?.gpu ?? '--');
    const vram = (d.gpu?.vram_used != null && d.gpu?.vram_total)
      ? `${d.gpu.vram_used}/${d.gpu.vram_total}MB`
      : '--';
    setText('vram-val', vram);
  } catch {}
  setTimeout(pollStatus, 8000);
}

function setDot(id, ok) {
  const dot  = document.getElementById(`dot-${id}`);
  const pill = document.getElementById(`pill-${id}`);
  if (!dot || !pill) return;
  dot.className  = `dot ${ok ? 'ok' : 'err'}`;
  pill.className = `status-pill ${ok ? 'ok' : 'err'}`;
}

// ─── OVERVIEW DATA ────────────────────────────────────────────────────────────
async function loadOverviewData() {
  await Promise.all([
    loadChannelCard('sleepless-astronomer', 'astro'),
    loadChannelCard('sleepless-philosophers', 'phil'),
  ]);
}

async function loadChannelCard(slug, prefix) {
  try {
    const d = await fetchJSON(`/api/youtube/queue/${slug}`);
    _ytData[slug] = d;

    // Stats
    if (d.channelInfo) {
      animateNumber(`${prefix}-subs`,  fmt(d.channelInfo.subs));
      animateNumber(`${prefix}-views`, fmt(d.channelInfo.totalViews));
    }
    if (d.lastStats) {
      setText(`${prefix}-ctr`,       d.lastStats.ctr != null ? `${d.lastStats.ctr.toFixed(1)}%` : '—');
      setText(`${prefix}-retention`, d.lastStats.retention_avg_pct != null ? `${d.lastStats.retention_avg_pct.toFixed(1)}%` : '—');
    }

    // Queue strip
    renderQueueStrip(prefix, d.scheduled, slug);

    // Last video
    renderLastVideo(prefix, d.published?.[0], d.lastStats);

    // If channel detail page is showing, populate it
    if (document.getElementById(`page-${slug.replace('sleepless-', '')}`)?.classList.contains('active')) {
      renderChannelDetail(slug, d);
    }
  } catch (e) {
    setText(`${prefix}-subs`, '—');
    console.warn(`loadChannelCard(${slug}):`, e.message);
  }
}

function renderQueueStrip(prefix, scheduled, slug) {
  const el = document.getElementById(`${prefix}-queue-strip`);
  if (!el) return;
  const chipClass = prefix === 'astro' ? 'astro-chip' : 'phil-chip';

  if (!scheduled?.length) {
    el.innerHTML = `<span class="queue-chip empty-slot">⚠ No scheduled videos</span>`;
    return;
  }

  // Show next 5 dates
  const chips = scheduled.slice(0, 5).map((v, i) => {
    const dt  = new Date(v.scheduledAt);
    const lbl = dt.toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:'Asia/Bangkok' });
    return `<span class="queue-chip ${chipClass}${i === 0 ? ' next' : ''}" title="${esc(v.title)}">${lbl}</span>`;
  });

  const more = scheduled.length > 5 ? `<span class="text-muted" style="font-size:11px">+${scheduled.length-5} more</span>` : '';
  el.innerHTML = `<div class="queue-dates"><span class="queue-lbl">Next</span>${chips.join('')}${more}</div>`;
}

function renderLastVideo(prefix, vid, stats) {
  const el = document.getElementById(`${prefix}-last-video`);
  if (!el) return;
  if (!vid) { el.innerHTML = `<div class="last-video-loading">No published videos found</div>`; return; }

  const dt    = vid.publishedAt ? new Date(vid.publishedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '';
  const views = stats?.views != null ? `${fmt(stats.views)} views` : '';
  const likes = stats?.likes != null ? ` · ${fmt(stats.likes)} likes` : '';
  const wt    = stats?.watch_time_minutes != null ? ` · ${Math.round(stats.watch_time_minutes/60)}h watch time` : '';

  el.innerHTML = `
    <div class="last-video-title" title="${esc(vid.title)}">${esc(vid.title)}</div>
    <div class="last-video-meta">${dt}${views ? ' · ' + views : ''}${likes}${wt}
      ${vid.videoId ? ` · <a href="https://youtube.com/watch?v=${vid.videoId}" target="_blank" class="last-video-link">▶ Watch</a>` : ''}
    </div>`;
}

// ─── RENDER JOBS ──────────────────────────────────────────────────────────────
function renderAllJobs() {
  renderJobsContainer('overview-renders', _jobs.filter(j => ['rendering','uploading','queued'].includes(j.status)).slice(0, 5));
  renderJobsContainer('queue-list', _jobs.slice(0, 30));
}

function renderJobsContainer(containerId, jobs) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!jobs.length) { el.innerHTML = `<div class="empty-state">No active renders.</div>`; return; }
  el.innerHTML = jobs.map(jobHTML).join('');
}

function jobHTML(j) {
  const pct = j.progress || 0;
  return `<div class="render-job fade-in">
    <div class="job-dot ${j.status}"></div>
    <div class="job-info">
      <div class="job-title">${esc(j.topic || '—')}</div>
      <div class="job-step">${esc(j.step || j.status)} · ${esc(j.channel || '')}</div>
    </div>
    <div class="job-bar-wrap">
      <div class="job-bar-bg"><div class="job-bar" style="width:${pct}%"></div></div>
      <div class="job-pct">${pct}%</div>
    </div>
    ${j.videoId ? `<a href="https://youtube.com/watch?v=${j.videoId}" target="_blank" style="font-size:11px;color:var(--astro)">▶ Watch</a>` : ''}
  </div>`;
}

// ─── CHANNEL DETAIL ───────────────────────────────────────────────────────────
function renderChannelDetail(slug, d) {
  const shortId   = slug.replace('sleepless-', '');
  const container = document.getElementById(`detail-${shortId}`);
  if (!container) return;

  const isAstro   = shortId === 'astronomer';
  const nextClass = isAstro ? 'is-astro-next' : 'is-phil-next';
  const info      = d.channelInfo;
  const ls        = d.lastStats;

  // Stats row
  const statsHTML = `
    <div class="detail-stats-row">
      <div class="detail-stat"><div class="detail-stat-val">${info ? fmt(info.subs) : '—'}</div><div class="detail-stat-lbl">Subscribers</div></div>
      <div class="detail-stat"><div class="detail-stat-val">${info ? fmt(info.totalViews) : '—'}</div><div class="detail-stat-lbl">Total Views</div></div>
      <div class="detail-stat"><div class="detail-stat-val">${info ? info.videoCount : '—'}</div><div class="detail-stat-lbl">Videos</div></div>
      <div class="detail-stat"><div class="detail-stat-val">${ls?.ctr != null ? ls.ctr.toFixed(1)+'%' : '—'}</div><div class="detail-stat-lbl">Last CTR</div></div>
      <div class="detail-stat"><div class="detail-stat-val">${ls?.retention_avg_pct != null ? ls.retention_avg_pct.toFixed(1)+'%' : '—'}</div><div class="detail-stat-lbl">Avg Retention</div></div>
    </div>`;

  // Scheduled timeline — show next 14 days gaps
  const now   = new Date();
  const days  = Array.from({length:14}, (_,i) => {
    const d = new Date(now); d.setDate(now.getDate() + i); return d;
  });
  const scheduledByDate = {};
  for (const v of (d.scheduled || [])) {
    const k = new Date(v.scheduledAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
    scheduledByDate[k] = v;
  }

  const tlItems = days.map((day, i) => {
    const key  = day.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const vid  = scheduledByDate[key];
    const lbl  = day.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
    if (vid) {
      return `<div class="tl-item ${i === 0 ? nextClass : ''}">
        <div class="tl-date">${lbl}</div>
        <div class="tl-title">${esc(vid.title)}</div>
      </div>`;
    }
    return `<div class="tl-empty">${lbl} — empty</div>`;
  }).join('');

  const timelineHTML = `
    <div class="detail-section">
      <div class="section-head">Scheduled — Next 14 Days</div>
      <div class="timeline">${tlItems}</div>
    </div>`;

  // Published table
  const rows = (d.published || []).map(v => {
    const dt = v.publishedAt ? new Date(v.publishedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : '—';
    return `<tr>
      <td class="td-title" title="${esc(v.title)}">${esc(v.title)}</td>
      <td class="td-date">${dt}</td>
      <td class="td-yt">${v.videoId ? `<a href="https://youtube.com/watch?v=${v.videoId}" target="_blank">▶ ${v.videoId}</a>` : '—'}</td>
    </tr>`;
  }).join('');

  const tableHTML = `
    <div class="detail-section">
      <div class="section-head">Recent Published Videos</div>
      <div class="table-wrap">
        <table class="videos-table">
          <thead><tr><th>Title</th><th>Published</th><th>YouTube</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="3" class="text-muted" style="text-align:center;padding:20px">No published videos found</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  container.innerHTML = statsHTML + timelineHTML + tableHTML;
}

// ─── PAGE NAVIGATION ──────────────────────────────────────────────────────────
function showPage(id) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  // Show target
  const page = document.getElementById(`page-${id}`);
  if (page) page.classList.add('active');
  const btn  = document.getElementById(`nav-${id}`);
  if (btn) btn.classList.add('active');

  // Load channel detail on demand
  if (id === 'astronomer') {
    const slug = 'sleepless-astronomer';
    if (_ytData[slug]) renderChannelDetail(slug, _ytData[slug]);
    else loadChannelCard(slug, 'astro').then(() => renderChannelDetail(slug, _ytData[slug]));
  }
  if (id === 'philosophers') {
    const slug = 'sleepless-philosophers';
    if (_ytData[slug]) renderChannelDetail(slug, _ytData[slug]);
    else loadChannelCard(slug, 'phil').then(() => renderChannelDetail(slug, _ytData[slug]));
  }
  if (id === 'queue') renderJobsContainer('queue-list', _jobs.slice(0, 50));
}

// ─── CHAT ─────────────────────────────────────────────────────────────────────
async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg   = input.value.trim();
  if (!msg) return;
  input.value = '';

  appendChat('user', msg);
  appendChat('thinking', 'JARVIS is thinking…');

  try {
    const d = await fetchJSON('/api/jarvis/chat', { method:'POST', body: JSON.stringify({ message: msg }), headers: {'Content-Type':'application/json'} });
    removeLastThinking();
    appendChat('jarvis', d.reply || '(no reply)');
  } catch (e) {
    removeLastThinking();
    appendChat('jarvis', `My apologies, sir. ${e.message}`);
  }
}

function appendChat(role, text) {
  const msgs = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = `chat-msg ${role} fade-in`;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeLastThinking() {
  const msgs  = document.getElementById('chat-messages');
  const nodes = msgs.querySelectorAll('.chat-msg.thinking');
  nodes.forEach(n => n.remove());
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmt(n) {
  if (n == null) return '—';
  n = Number(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function animateNumber(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = val;
  el.classList.remove('count-in');
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('count-in');
}

function updateMetrics(msg) {
  setText('cpu-val', msg.cpu ?? '--');
  setText('gpu-val', msg.gpu?.gpu ?? '--');
  if (msg.gpu?.vram_used != null) {
    setText('vram-val', `${msg.gpu.vram_used}/${msg.gpu.vram_total}MB`);
  }
}
