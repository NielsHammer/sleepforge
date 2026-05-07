'use strict';

let _pendingRejectDir = null;
let _pendingRejectTitle = '';

// ─── DATA LOADING ─────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const r = await fetch('/api/data');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    render(data);
  } catch (e) {
    console.error('loadData failed:', e);
  }
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function render({ thumbnails, videos, scripts, pipeline }) {
  renderPipeline(pipeline);
  renderThumbnails(thumbnails);
  renderVideos(videos);
  renderScripts(scripts);

  const counts = [
    thumbnails.length + ' thumbnail' + (thumbnails.length !== 1 ? 's' : ''),
    videos.length + ' video' + (videos.length !== 1 ? 's' : ''),
    scripts.length + ' script' + (scripts.length !== 1 ? 's' : ''),
  ];
  document.getElementById('counts').textContent = counts.join(' · ');
}

function renderPipeline(p) {
  const el    = document.getElementById('pipeline-status');
  const label = document.getElementById('pipeline-label');
  el.className = p.active ? 'pipeline-active' : 'pipeline-idle';
  if (p.active && p.step) {
    label.textContent = '● ' + p.step;
  } else if (p.active) {
    label.textContent = '● Pipeline running';
  } else if (p.lastActivityAgo !== null) {
    const ago = p.lastActivityAgo;
    const agoStr = ago < 60 ? ago + 's ago' : ago < 3600 ? Math.round(ago / 60) + 'm ago' : Math.round(ago / 3600) + 'h ago';
    label.textContent = 'Idle · last activity ' + agoStr;
  } else {
    label.textContent = 'Idle';
  }
}

function ratingClass(r) {
  if (r === null) return '';
  if (r >= 7) return 'rating-high';
  if (r >= 5) return 'rating-mid';
  return 'rating-low';
}

function renderThumbnails(thumbs) {
  const grid   = document.getElementById('thumbnail-grid');
  const empty  = document.getElementById('no-thumbnails');
  grid.innerHTML = '';
  if (thumbs.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;

  for (const t of thumbs) {
    const card = document.createElement('div');
    card.className = 'thumb-card' + (t.approved ? ' approved' : t.rejected ? ' rejected' : '');
    card.dataset.id  = t.id;
    card.dataset.dir = t.outputDir;

    const ratingHtml = t.rating !== null
      ? `<span class="rating ${ratingClass(t.rating)}">★ ${t.rating}/10</span>`
      : `<span class="rating" style="color:var(--muted)">No rating</span>`;

    const problemsHtml = t.problems.length > 0
      ? `<ul class="problems">${t.problems.slice(0, 3).map(p => `<li>${esc(p.substring(0, 100))}</li>`).join('')}</ul>`
      : '';

    const badgeHtml = t.approved
      ? `<span class="thumb-badge badge-approved">✓ Approved</span>`
      : t.rejected
      ? `<span class="thumb-badge badge-rejected">✗ Rejected</span>`
      : '';

    const actionsHtml = t.approved || t.rejected
      ? ''
      : `<div class="thumb-actions">
           <button class="btn-approve" onclick="approve('${esc(t.id)}', '${escQ(t.outputDir)}', '${escQ(t.title)}')">👍 Approve</button>
           <button class="btn-reject"  onclick="openReject('${escQ(t.outputDir)}', '${escQ(t.title)}')">👎 Reject</button>
         </div>`;

    card.innerHTML = `
      <div class="thumb-img-wrap">
        <img src="${t.pngUrl}?t=${Math.floor(t.mtime / 1000)}" alt="thumbnail" loading="lazy">
        ${badgeHtml}
      </div>
      <div class="thumb-body">
        ${t.hook ? `<div class="thumb-hook">${esc(t.hook)}</div>` : ''}
        <div class="thumb-title">${esc(t.title)}</div>
        <div class="thumb-meta">
          ${t.niche ? `<span class="niche-tag">${esc(t.niche)}</span>` : ''}
          ${ratingHtml}
          ${t.attempt > 1 ? `<span class="niche-tag">attempt ${t.attempt}</span>` : ''}
        </div>
        ${t.verdict ? `<div class="verdict">${esc(t.verdict)}</div>` : ''}
        ${problemsHtml}
        ${actionsHtml}
      </div>`;
    grid.appendChild(card);
  }
}

function renderVideos(videos) {
  const list  = document.getElementById('video-list');
  const empty = document.getElementById('no-videos');
  list.innerHTML = '';
  if (videos.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  for (const v of videos) {
    list.innerHTML += `
      <div class="video-card">
        <h3>${esc(v.title)}</h3>
        <video controls preload="metadata" src="${v.url}"></video>
      </div>`;
  }
}

function renderScripts(scripts) {
  const list  = document.getElementById('script-list');
  const empty = document.getElementById('no-scripts');
  list.innerHTML = '';
  if (scripts.length === 0) { empty.hidden = false; return; }
  empty.hidden = true;
  for (const s of scripts) {
    const card = document.createElement('div');
    card.className = 'script-card';
    card.innerHTML = `
      <div class="script-header" onclick="toggleScript(this)">
        <h3>${esc(s.title)}</h3>
        <span class="script-toggle">▾</span>
      </div>
      <pre class="script-preview">${esc(s.preview)}${s.preview.length >= 600 ? '\n…' : ''}</pre>`;
    list.appendChild(card);
  }
}

// ─── ACTIONS ──────────────────────────────────────────────────────────────────

async function approve(id, outputDir, title) {
  const reason = prompt(`Approve "${title}"\n\nOptional: why does this work? (leave blank to skip)`);
  if (reason === null) return; // cancelled
  try {
    const r = await fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputDir, reason }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    const card = document.querySelector(`.thumb-card[data-id="${id}"]`);
    if (card) { card.classList.add('approved'); card.querySelector('.thumb-actions').remove(); }
    loadData();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function openReject(outputDir, title) {
  _pendingRejectDir   = outputDir;
  _pendingRejectTitle = title;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-reason').value = '';
  document.getElementById('modal-overlay').hidden = false;
  document.getElementById('modal-reason').focus();
}

function closeModal() {
  _pendingRejectDir = null;
  document.getElementById('modal-overlay').hidden = true;
}

async function submitReject() {
  const reason = document.getElementById('modal-reason').value.trim();
  if (!reason) {
    document.getElementById('modal-reason').style.borderColor = 'var(--red)';
    return;
  }
  try {
    const r = await fetch('/api/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputDir: _pendingRejectDir, reason }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    closeModal();
    loadData();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

function toggleScript(header) {
  header.closest('.script-card').classList.toggle('open');
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escQ(str) {
  return String(str ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// Press Escape to close modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

// Initial load + auto-refresh every 8 seconds
loadData();
setInterval(loadData, 8000);
