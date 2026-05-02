import fs from "fs";
import path from "path";

// Writes a per-video preview.html (embedded player + metadata) and rebuilds
// the master output/index.html so every rendered video is browsable from
// http://<server-ip>:8080/output/

const SERVER_BASE = "http://157.180.124.232:8080";
const OUTPUT_ROOT = "output";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtTime(sec) {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
           : `${m}:${String(s).padStart(2, "0")}`;
}

const PAGE_CSS = `
  *{box-sizing:border-box}
  body{margin:0;background:#0a0a0f;color:#e8e8ee;font-family:-apple-system,system-ui,sans-serif;line-height:1.55}
  .wrap{max-width:1280px;margin:0 auto;padding:32px 20px}
  a{color:#a78bfa;text-decoration:none} a:hover{text-decoration:underline}
  h1{font-size:32px;margin:0 0 8px;font-weight:600}
  .meta{color:#9090a0;font-size:14px;margin-bottom:24px}
  .hero{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;align-items:start}
  .hero img{width:100%;border-radius:10px;background:#000;display:block;border:1px solid #2a2a3a}
  .hero video{width:100%;border-radius:10px;background:#000;display:block;border:1px solid #2a2a3a}
  @media (max-width:900px){.hero{grid-template-columns:1fr}}
  .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
  .pill{background:#1a1a24;border:1px solid #2a2a3a;border-radius:999px;padding:4px 12px;font-size:12px;color:#c0c0d0}
  .desc{margin-top:24px;white-space:pre-wrap;color:#c8c8d0;font-size:15px}
  .chapters{margin-top:24px;background:#11111a;border:1px solid #1f1f2c;border-radius:8px;padding:16px}
  .chapter{display:flex;gap:12px;padding:6px 0;font-size:14px}
  .chapter time{color:#7a7a90;min-width:64px;font-variant-numeric:tabular-nums}
  .files{margin-top:24px;font-size:13px;color:#8888a0}
  .files a{margin-right:16px}
  .nav{display:flex;gap:14px;margin-top:8px;font-size:14px}
  .nav a{background:#1a1a24;border:1px solid #2a2a3a;border-radius:6px;padding:6px 14px}
  .nav a:hover{border-color:#a78bfa}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:20px;margin-top:24px}
  .card{background:#11111a;border:1px solid #1f1f2c;border-radius:10px;overflow:hidden;transition:border-color .15s,transform .15s}
  .card:hover{border-color:#a78bfa;transform:translateY(-2px)}
  .card a{color:inherit;display:block}
  .card img{width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;display:block}
  .card .body{padding:14px 16px}
  .card h3{margin:0 0 4px;font-size:17px;font-weight:500;color:#e8e8ee;line-height:1.3}
  .card .small{color:#7a7a90;font-size:12px;margin-top:6px}
  header{margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1f1f2c}
  header .crumb{color:#7a7a90;font-size:13px}
`;

export function writeVideoPreview(outputDir, topic, metadata, durationSec) {
  const slug = path.basename(outputDir);
  const pubBase = `${SERVER_BASE}/${OUTPUT_ROOT}/${slug}`;

  const tags = (metadata?.tags || []).map((t) =>
    `<span class="pill">${escapeHtml(t)}</span>`).join("");

  const chapters = (metadata?.chapters || []).map((c) =>
    `<div class="chapter"><time>${fmtTime(c.time)}</time><span>${escapeHtml(c.title)}</span></div>`
  ).join("");

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${escapeHtml(metadata?.title || topic)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${PAGE_CSS}</style>
</head><body><div class="wrap">
<header>
  <div class="crumb"><a href="${SERVER_BASE}/${OUTPUT_ROOT}/">← all videos</a></div>
</header>
<h1>${escapeHtml(metadata?.title || topic)}</h1>
<div class="meta">${fmtTime(durationSec)} • SleepForge / Sleepless Philosophers</div>

<div class="nav">
  <a href="pipeline.html">Pipeline visualization</a>
  <a href="feedback.html">Feedback report</a>
  <a href="${pubBase}/thumbnail.png">Thumbnail (full size)</a>
</div>

<div class="hero" style="margin-top:24px">
  <img src="${pubBase}/thumbnail.png" alt="thumbnail">
  <video controls preload="metadata" poster="${pubBase}/thumbnail.png">
    <source src="${pubBase}/final.mp4" type="video/mp4">
  </video>
</div>

<div class="row">${tags}</div>

<div class="desc">${escapeHtml(metadata?.description || "")}</div>

${chapters ? `<div class="chapters"><strong>Chapters</strong>${chapters}</div>` : ""}

<div class="files">
  <a href="${pubBase}/final.mp4">final.mp4</a>
  <a href="${pubBase}/subtitles.ass">subtitles.ass</a>
  <a href="${pubBase}/metadata.json">metadata.json</a>
  <a href="${pubBase}/storyboard.json">storyboard.json</a>
  <a href="${pubBase}/sentences.json">sentences.json</a>
</div>
</div></body></html>`;

  fs.writeFileSync(path.join(outputDir, "preview.html"), html);
}

export function rebuildOutputIndex(outputRoot = OUTPUT_ROOT) {
  if (!fs.existsSync(outputRoot)) return;

  const entries = fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(outputRoot, d.name);
      const finalMp4 = path.join(dir, "final.mp4");
      const previewHtml = path.join(dir, "preview.html");
      if (!fs.existsSync(finalMp4) || !fs.existsSync(previewHtml)) return null;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf-8")); } catch {}
      const stat = fs.statSync(finalMp4);
      return {
        slug: d.name,
        title: meta.title || d.name,
        sizeMB: (stat.size / 1024 / 1024).toFixed(1),
        mtime: stat.mtime,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);

  const cards = entries.map((e) => `
    <a href="${escapeHtml(e.slug)}/preview.html" class="card-link">
      <div class="card">
        <img src="${escapeHtml(e.slug)}/thumbnail.png" alt="">
        <div class="body">
          <h3>${escapeHtml(e.title)}</h3>
          <div class="small">${e.sizeMB} MB • ${e.mtime.toISOString().slice(0, 10)}</div>
        </div>
      </div>
    </a>`).join("");

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>SleepForge — All Videos</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>${PAGE_CSS}
  .card-link{text-decoration:none}
  .latest{margin-bottom:32px;padding:20px;background:linear-gradient(135deg,#1a1330 0%,#11111a 100%);border:1px solid #3a2a5a;border-radius:12px}
  .latest .label{color:#a78bfa;font-size:12px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
  .latest h2{margin:0 0 8px;font-size:22px}
  .latest .meta{color:#9090a0;font-size:13px;margin-bottom:14px}
  .latest .hero{display:grid;grid-template-columns:2fr 1fr;gap:16px}
  .latest a{color:#fff}
  @media (max-width:700px){.latest .hero{grid-template-columns:1fr}}
</style>
</head><body><div class="wrap">
<header>
  <h1 style="margin:0">SleepForge</h1>
  <div class="crumb">${entries.length} video${entries.length === 1 ? "" : "s"} rendered</div>
</header>
${entries.length ? `
<div class="latest">
  <a href="${escapeHtml(entries[0].slug)}/preview.html">
    <div class="label">▶ Latest</div>
    <h2>${escapeHtml(entries[0].title)}</h2>
    <div class="meta">${entries[0].sizeMB} MB • ${entries[0].mtime.toISOString().slice(0, 10)}</div>
    <div class="hero">
      <img src="${escapeHtml(entries[0].slug)}/thumbnail.png" alt="" style="width:100%;border-radius:8px;display:block">
      <video controls preload="metadata" poster="${escapeHtml(entries[0].slug)}/thumbnail.png" style="width:100%;border-radius:8px;display:block;background:#000">
        <source src="${escapeHtml(entries[0].slug)}/final.mp4" type="video/mp4">
      </video>
    </div>
  </a>
</div>
<h2 style="font-size:18px;color:#9090a0;margin:32px 0 16px;font-weight:500">All videos</h2>
<div class="grid">${cards}</div>` : `<p style="color:#7a7a90">No videos rendered yet.</p>`}
</div></body></html>`;

  fs.writeFileSync(path.join(outputRoot, "index.html"), html);
}
