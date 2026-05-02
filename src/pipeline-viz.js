import fs from "fs";
import path from "path";

// Generates a pipeline.html that visualizes every step of the build for one
// video — script → TTS → director → contextual images → ffmpeg → final —
// with intermediate artifacts and the actual outputs at each stage so Niels
// can see at a glance which stage is producing the wrong thing.

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n, d = 1) {
  return typeof n === "number" ? n.toFixed(d) : "?";
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#0a0a0f;color:#e8e8ee;font-family:-apple-system,system-ui,sans-serif;line-height:1.55}
.wrap{max-width:1280px;margin:0 auto;padding:32px 20px}
a{color:#a78bfa;text-decoration:none}
h1{font-size:26px;margin:0 0 8px}
h2{font-size:18px;margin:0 0 4px;color:#e8e8ee}
.crumb{color:#7a7a90;font-size:13px;margin-bottom:24px}
.step{background:#11111a;border:1px solid #1f1f2c;border-radius:8px;padding:18px 20px;margin:12px 0;display:grid;grid-template-columns:120px 1fr;gap:18px}
.step .num{color:#7a7a90;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
.step .num strong{display:block;color:#a78bfa;font-size:32px;font-weight:600;margin-top:4px}
.step .body{min-width:0}
.step .meta{color:#9090a0;font-size:13px;margin:6px 0 12px}
.step .artifacts{display:flex;gap:8px;flex-wrap:wrap;font-size:12px}
.step .artifacts a{background:#1a1a24;border:1px solid #2a2a3a;padding:4px 10px;border-radius:6px;font-family:monospace}
.clipgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-top:14px}
.clipgrid figure{margin:0;background:#0a0a0f;border:1px solid #1f1f2c;border-radius:6px;overflow:hidden}
.clipgrid img{width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;display:block}
.clipgrid figcaption{padding:6px 8px;font-size:11px;color:#9090a0;line-height:1.4}
.clipgrid figcaption .t{color:#7a7a90;font-family:monospace}
.tag{display:inline-block;background:#1a1a24;border:1px solid #2a2a3a;border-radius:999px;padding:1px 8px;font-size:11px;color:#c0c0d0;margin-right:4px}
audio{width:100%;margin-top:8px}
video{width:100%;border-radius:6px;background:#000;margin-top:8px}
`;

export function writePipelineViz(outputDir, topic, results) {
  const slug = path.basename(outputDir);
  const exists = (rel) => fs.existsSync(path.join(outputDir, rel));
  const link = (rel, label) =>
    exists(rel) ? `<a href="${escapeHtml(rel)}">${escapeHtml(label || rel)}</a>` : "";

  const storyboard = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(outputDir, "storyboard.json"), "utf-8")); }
    catch { return null; }
  })();
  const metadata = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(outputDir, "metadata.json"), "utf-8")); }
    catch { return null; }
  })();
  const sentences = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(outputDir, "sentences.json"), "utf-8")).sentences; }
    catch { return []; }
  })();

  const clips = storyboard?.clips || [];
  const bible = storyboard?.videoBible || {};

  const clipFigures = clips.slice(0, 24).map((c) => {
    const img = c.imagePath
      ? path.relative(outputDir, path.resolve(c.imagePath))
      : null;
    const imgUrl = img && img.startsWith("..")
      ? `http://157.180.124.232:8080/${escapeHtml(c.imagePath)}`
      : (img ? escapeHtml(img) : "");
    const promptSnippet = c.imagePrompt
      ? `<div style="margin-top:4px;color:#a78bfa">${escapeHtml(String(c.imagePrompt).slice(0, 120))}…</div>`
      : "";
    return `
      <figure>
        ${imgUrl ? `<img src="${imgUrl}" alt="">` : `<div style="aspect-ratio:16/9;background:#1a1a24;display:grid;place-items:center;color:#7a7a90;font-size:11px">no image</div>`}
        <figcaption>
          <div class="t">${fmt(c.start_time)}–${fmt(c.end_time)}s · ${escapeHtml(c.philosopher || "—")}</div>
          <div>${escapeHtml((c.text || "").slice(0, 80))}${(c.text || "").length > 80 ? "…" : ""}</div>
          ${promptSnippet}
        </figcaption>
      </figure>`;
  }).join("");

  const tags = (
    (metadata?.tags || []).slice(0, 12)
      .map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")
  );

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Pipeline — ${escapeHtml(topic)}</title>
<style>${CSS}</style></head><body><div class="wrap">
<div class="crumb"><a href="http://157.180.124.232:8080/output/">← all videos</a> · <a href="preview.html">preview</a> · <a href="feedback.html">feedback</a></div>
<h1>Pipeline — ${escapeHtml(topic)}</h1>
<div style="color:#9090a0;font-size:14px">${escapeHtml(metadata?.title || "")}${tags ? `<div style="margin-top:8px">${tags}</div>` : ""}</div>

<div class="step">
  <div class="num">Step<strong>1</strong></div>
  <div class="body">
    <h2>Script Generation</h2>
    <div class="meta">Claude Haiku via subscription · ${results?.steps?.script?.scenes || "?"} scenes · ${results?.steps?.script?.words || "?"} words</div>
    <div class="artifacts">${link("../../scripts/" + slug + ".json", "scenes.json")}</div>
  </div>
</div>

${(() => {
  const sentenceQC = sentences.length ? `
    <details style="margin-top:14px">
      <summary style="cursor:pointer;color:#a78bfa">Audio QC — listen to each sentence (${sentences.length})</summary>
      <div style="display:grid;grid-template-columns:1fr;gap:6px;margin-top:10px;max-height:600px;overflow:auto;padding:8px;background:#0a0a0f;border:1px solid #1f1f2c;border-radius:6px">
        ${sentences.map((s) => `
          <div style="display:grid;grid-template-columns:50px 1fr 240px 60px;gap:10px;align-items:center;padding:6px 8px;background:#11111a;border-radius:4px;font-size:13px">
            <code style="color:#7a7a90">#${String(s.index + 1).padStart(3, "0")}</code>
            <span>${escapeHtml(s.text.slice(0, 100))}${s.text.length > 100 ? "…" : ""}</span>
            <audio controls preload="none" src="${escapeHtml(s.path)}" style="height:30px;width:100%"></audio>
            <span style="color:#7a7a90;text-align:right">${fmt(s.durationSec, 1)}s</span>
          </div>`).join("")}
      </div>
    </details>` : "";
  return `<div class="step">
  <div class="num">Step<strong>2</strong></div>
  <div class="body">
    <h2>TTS Voiceover (Kokoro am_echo)</h2>
    <div class="meta">${fmt(results?.steps?.voice?.duration)}s · ${results?.steps?.voice?.words || "?"} words · ${sentences.length} sentence chunks · 350/700ms silence pads</div>
    <div class="artifacts">${link("assets/voiceover.wav", "voiceover.wav")} ${link("assets/voiceover-timestamps.json", "whisper.json")} ${link("sentences.json", "sentences.json")}</div>
    ${exists("assets/voiceover.wav") ? '<audio controls preload="none" src="assets/voiceover.wav" style="width:100%;margin-top:8px"></audio>' : ""}
    ${sentenceQC}
  </div>
</div>`;
})()}

<div class="step">
  <div class="num">Step<strong>3</strong></div>
  <div class="body">
    <h2>Director — clip windows</h2>
    <div class="meta">${clips.length} clips, ~${clips.length ? fmt((results?.steps?.voice?.duration || 0) / clips.length) : "?"}s avg per clip</div>
    <div class="artifacts">${link("storyboard.json", "storyboard.json")}</div>
    <div style="margin-top:10px;font-size:13px;color:#9090a0">Bible era: ${escapeHtml(bible.era_specific || "—")}</div>
  </div>
</div>

<div class="step">
  <div class="num">Step<strong>4</strong></div>
  <div class="body">
    <h2>Contextual Images</h2>
    <div class="meta">${results?.steps?.director?.contextual?.cacheHits ?? "?"} cache hits · ${results?.steps?.director?.contextual?.generated ?? "?"} fresh from Schnell · ${results?.steps?.director?.contextual?.failed ?? "?"} failed</div>
    <div class="clipgrid">${clipFigures}</div>
    ${clips.length > 24 ? `<div style="margin-top:8px;color:#7a7a90;font-size:12px">Showing first 24 of ${clips.length}</div>` : ""}
  </div>
</div>

<div class="step">
  <div class="num">Step<strong>5</strong></div>
  <div class="body">
    <h2>Subtitles (ASS karaoke)</h2>
    <div class="meta">4 words/phrase · white text · burned via FFmpeg</div>
    <div class="artifacts">${link("subtitles.ass", "subtitles.ass")}</div>
  </div>
</div>

<div class="step">
  <div class="num">Step<strong>6</strong></div>
  <div class="body">
    <h2>FFmpeg Composition</h2>
    <div class="meta">bg.mp4 (warm Greek room, RGB-blend particles) → chalkboard panel + frame → audio mix → subs burn</div>
    <div class="artifacts">${link("slideshow.mp4", "slideshow.mp4")} ${link("mixed-audio.m4a", "mixed-audio")} ${link("raw.mp4", "raw.mp4")} ${link("final.mp4", "final.mp4")}</div>
    ${exists("final.mp4") ? '<video controls preload="metadata" poster="thumbnail.png" src="final.mp4"></video>' : ""}
  </div>
</div>

<div class="step">
  <div class="num">Step<strong>7</strong></div>
  <div class="body">
    <h2>Thumbnail + Metadata</h2>
    <div class="meta">${escapeHtml(metadata?.title || "")}</div>
    <div class="artifacts">${link("thumbnail.png", "thumbnail.png")} ${link("metadata.json", "metadata.json")} ${link("feedback.json", "feedback.json")}</div>
    ${exists("thumbnail.png") ? '<img src="thumbnail.png" style="margin-top:10px;max-width:480px;border-radius:6px">' : ""}
  </div>
</div>

</div></body></html>`;

  fs.writeFileSync(path.join(outputDir, "pipeline.html"), html);
}
