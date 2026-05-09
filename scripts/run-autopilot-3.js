/**
 * run-autopilot-3.js
 *
 * Queues 3 philosophy sleep videos on sleepless-philosophers.
 *
 * Schedule (Bangkok UTC+7):
 *   Video 1 — today     8pm  (UTC 13:00)
 *   Video 2 — tomorrow  8am  (UTC 01:00)
 *   Video 3 — +2 days   8am  (UTC 01:00)
 *
 * Per-video pipeline:
 *   1. Render 60-min video (test-video-2min.js, SLEEPFORGE_DURATION=60)
 *   2. Generate 3 thumbnail variants (v2+v3 reuse locked hook + metaphor)
 *   3. Upload best variant (highest critic score) to YouTube as scheduled
 *   4. Copy unused 2 thumbnail PNGs to data/uploaded-archive/<videoId>/
 *   5. Archive + cleanup render folder
 *
 * Usage:
 *   node scripts/run-autopilot-3.js [--dry-run] [--keep-files] [--skip-render]
 */

import fs       from 'fs';
import path     from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv   from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI }           = await import('../src/claude-cli.js');
const { generateThumbnailV3, closeBrowser } = await import('../src/thumbnail-v3.js');
const { generateMetadata }        = await import('../src/youtube-metadata-generator.js');
const { uploadVideo, getVideoProcessingStatus } = await import('../src/youtube.js');

const CHANNEL          = 'sleepless-philosophers';
const PRINCIPLES_FILE  = path.join(ROOT, 'data', 'reference-principles.json');
const ARCHIVE_DIR      = path.join(ROOT, 'data', 'uploaded-archive');
const HAIKU            = 'claude-haiku-4-5-20251001';

// ─── ARGS ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, keepFiles: false, skipRender: false };
  for (const a of args) {
    if (a === '--dry-run')     opts.dryRun     = true;
    if (a === '--keep-files')  opts.keepFiles  = true;
    if (a === '--skip-render') opts.skipRender = true;
  }
  return opts;
}

// ─── SCHEDULE DATES ───────────────────────────────────────────────────────────
// Bangkok = UTC+7.  8pm tonight = 13:00 UTC today.  8am tomorrow = 01:00 UTC tomorrow.

function scheduleDates() {
  const today = new Date();
  const d1 = new Date(today); d1.setUTCHours(13, 0, 0, 0);
  const d2 = new Date(today); d2.setUTCDate(d2.getUTCDate() + 1); d2.setUTCHours(1, 0, 0, 0);
  const d3 = new Date(today); d3.setUTCDate(d3.getUTCDate() + 2); d3.setUTCHours(1, 0, 0, 0);
  return [d1.toISOString(), d2.toISOString(), d3.toISOString()];
}

// ─── TOPIC SELECTION ──────────────────────────────────────────────────────────

async function pick3Topics(principles) {
  const ctx = {
    top_emerging_patterns: principles.top_emerging_patterns || [],
    high_ctr_keywords:     principles.high_ctr_keywords || [],
    title_patterns:        (principles.title_patterns || []).slice(0, 4).map(p => ({ name: p.pattern_name, formula: p.formula })),
    sleepless_philosophers_insights: principles.sleepless_philosophers_insights || {},
  };

  const prompt = `You are a YouTube content strategist for "Sleepless Philosophers" — 1-hour calm sleep story channel.

Reference data (350 videos analyzed):
${JSON.stringify(ctx, null, 2)}

Pick exactly 3 video topics for tonight + next 2 mornings.

DIVERSITY RULES (strictly enforced):
1. No two videos from the same philosopher or tradition.
2. Cover 3 distinct traditions: choose from Stoicism, Eastern/Taoism, Ancient Greek, Buddhism, Existentialism, Medieval, Mythology, Pre-Socratic.
3. Each video must use a different title pattern from: encyclopedic_number, completeness_claim, duration_list, superlative_quality.
4. At least one title must include "(NO ADS)" prefix.
5. Use named philosophers where possible — "Seneca" beats "Stoic philosopher".

VIDEO 1 is the highest-stakes — it posts tonight and sets the channel's first impression. Make it the strongest topic.

Return ONLY this JSON:
{
  "videos": [
    {
      "topic": "concise topic description for the render engine (30 words max)",
      "title": "the winning YouTube title",
      "tradition": "tradition name",
      "philosopher": "primary philosopher or null",
      "title_pattern": "pattern name",
      "diversity_note": "one sentence: how this differs from the other two"
    }
  ]
}`;

  log('  Selecting 3 topics (Haiku)...');
  const raw = await callClaudeCLI(prompt, { model: HAIKU, timeoutMs: 60000 });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Topic selection: no JSON in response');
  const result = JSON.parse(m[0]);
  if (!Array.isArray(result.videos) || result.videos.length < 3) throw new Error('Topic selection: need exactly 3 videos');
  return result.videos.slice(0, 3);
}

// ─── SLUG ─────────────────────────────────────────────────────────────────────

function slugify(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// ─── VIDEO RENDER ─────────────────────────────────────────────────────────────

function renderVideo(topic, slug, durationMins) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'test-video-2min.js')], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: {
        ...process.env,
        SLEEPFORGE_TOPIC:    topic,
        SLEEPFORGE_SLUG:     slug,
        SLEEPFORGE_DURATION: String(durationMins),
      },
      cwd: ROOT,
    });
    child.on('close', code => { if (code === 0) resolve(); else reject(new Error(`render exited ${code}`)); });
    child.on('error', reject);
  });
}

// ─── THUMBNAIL VARIANTS ───────────────────────────────────────────────────────

async function generate3Variants(outputDir, topic, title, scriptText) {
  const variants = [];

  // Variant 1 — full pipeline (hook + metaphor + plan + critic)
  const v1Dir = path.join(outputDir, 'thumb-v1');
  log('  Generating thumbnail variant 1 (full pipeline)...');
  let v1Path = null;
  try {
    v1Path = await generateThumbnailV3({
      outputDir:  v1Dir,
      title,
      scriptText,
      niche: 'philosophy',
      tone:  'calm, meditative, philosophical',
    });
  } catch (e) {
    log(`  ⚠ Variant 1 failed: ${e.message}`);
  }

  // Read locked hook + metaphor from v1 (for reuse in v2/v3)
  let lockedHook     = null;
  let lockedMetaphor = null;
  try {
    const hookPath = path.join(v1Dir, 'thumbnail-v3-hook.json');
    const metaPath = path.join(v1Dir, 'thumbnail-v3-metaphor.json');
    if (fs.existsSync(hookPath))     lockedHook     = JSON.parse(fs.readFileSync(hookPath, 'utf-8'));
    if (fs.existsSync(metaPath))     lockedMetaphor = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch {}

  const v1Review = readCriticScore(v1Dir);
  if (v1Path) variants.push({ pngPath: v1Path, dir: v1Dir, rating: v1Review.rating, attempt: 1 });

  // Variants 2 + 3 — locked hook + metaphor, structurally different plan
  for (let i = 2; i <= 3; i++) {
    const vDir = path.join(outputDir, `thumb-v${i}`);
    log(`  Generating thumbnail variant ${i} (locked hook+metaphor)...`);
    let vPath = null;
    try {
      vPath = await generateThumbnailV3({
        outputDir:      vDir,
        title,
        scriptText,
        niche:          'philosophy',
        tone:           'calm, meditative, philosophical',
        _lockedHook:    lockedHook,
        _lockedMetaphor: lockedMetaphor,
        _priorAttempt:  variants[0]
          ? { rating: variants[0].rating, designer_verdict: 'See variant 1', problems: [], fix_instructions: 'Make a STRUCTURALLY DIFFERENT design — different composition, different focal hierarchy, different image treatment.' }
          : null,
      });
    } catch (e) {
      log(`  ⚠ Variant ${i} failed: ${e.message}`);
    }
    const vReview = readCriticScore(vDir);
    if (vPath) variants.push({ pngPath: vPath, dir: vDir, rating: vReview.rating, attempt: i });
  }

  if (variants.length === 0) throw new Error('All 3 thumbnail variants failed');

  // Pick best by critic score
  variants.sort((a, b) => b.rating - a.rating);
  const best   = variants[0];
  const unused = variants.slice(1);

  log(`  Best variant: v${best.attempt} (score ${best.rating}/10)`);
  for (const u of unused) log(`  Unused v${u.attempt}: score ${u.rating}/10 — saved to archive`);

  return { best, unused };
}

function readCriticScore(dir) {
  try {
    const p = path.join(dir, 'thumbnail-v3-review.json');
    if (!fs.existsSync(p)) return { rating: 5 };
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return { rating: 5 }; }
}

// ─── DIR SIZE ─────────────────────────────────────────────────────────────────

function dirSizeMb(dir) {
  try {
    let total = 0;
    const walk = d => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else try { total += fs.statSync(p).size; } catch {}
      }
    };
    walk(dir);
    return (total / 1024 / 1024).toFixed(0);
  } catch { return '?'; }
}

// ─── ARCHIVE + CLEANUP ────────────────────────────────────────────────────────

async function archiveAndCleanup(videoId, slug, outputDir, scheduledAt, unusedThumbs) {
  const archiveVideoDir = path.join(ARCHIVE_DIR, videoId);
  fs.mkdirSync(archiveVideoDir, { recursive: true });

  // Poll until upload confirmed (max 3 min)
  log('  Polling YouTube — waiting for upload confirmation...');
  let confirmed = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, i === 0 ? 60000 : 15000));
    try {
      const s = await getVideoProcessingStatus(videoId, CHANNEL);
      const ok = s && (s.uploadStatus === 'processed' || s.uploadStatus === 'uploaded');
      log(`    Attempt ${i + 1}/12: ${s?.uploadStatus || 'unknown'}`);
      if (ok) { confirmed = true; break; }
    } catch (e) {
      log(`    Attempt ${i + 1}/12: poll error — ${e.message}`);
    }
  }

  if (!confirmed) {
    log('  ⚠ Upload not confirmed after 3 min — keeping render folder.');
    return;
  }
  log('  ✓ Upload confirmed.');

  // Copy key files to archive
  const toKeep = [
    path.join(outputDir, 'youtube-metadata.json'),
    path.join(outputDir, 'log.txt'),
  ];
  let archived = 0;
  for (const src of toKeep) {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(archiveVideoDir, path.basename(src)));
      archived++;
    }
  }

  // Save unused thumbnail variants to archive
  for (let i = 0; i < unusedThumbs.length; i++) {
    const src = unusedThumbs[i].pngPath;
    if (src && fs.existsSync(src)) {
      const dest = path.join(archiveVideoDir, `thumbnail-unused-v${unusedThumbs[i].attempt}.png`);
      fs.copyFileSync(src, dest);
      archived++;
    }
  }

  fs.writeFileSync(path.join(archiveVideoDir, 'manifest.json'), JSON.stringify({
    videoId, slug, outputDir, channelName: CHANNEL,
    scheduledAt: scheduledAt || null,
    uploadedAt: new Date().toISOString(),
    archivedFiles: archived,
    unusedThumbnails: unusedThumbs.map(u => `thumbnail-unused-v${u.attempt}.png`),
    cleanedUp: false,
  }, null, 2));

  // Delete render folder
  try {
    const sizeMb = dirSizeMb(outputDir);
    fs.rmSync(outputDir, { recursive: true, force: true });
    log(`  ✓ Render folder deleted (~${sizeMb} MB freed)`);

    const manifest = JSON.parse(fs.readFileSync(path.join(archiveVideoDir, 'manifest.json'), 'utf-8'));
    manifest.cleanedUp   = true;
    manifest.cleanedUpAt = new Date().toISOString();
    fs.writeFileSync(path.join(archiveVideoDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  } catch (e) {
    log(`  ⚠ Could not delete render folder: ${e.message}`);
  }
}

// ─── REPORT ───────────────────────────────────────────────────────────────────

function buildReport(results, startedAt) {
  const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
  const lines = [
    `# SleepForge Autopilot Run — ${new Date().toISOString().slice(0, 10)}`,
    '',
    `Started: ${new Date(startedAt).toISOString()}`,
    `Elapsed: ${elapsedMin} minutes`,
    `Channel: ${CHANNEL}`,
    '',
    '## Videos',
    '',
  ];
  for (const r of results) {
    lines.push(`### Video ${r.index}: ${r.title}`);
    lines.push(`- Tradition: ${r.tradition}`);
    lines.push(`- Topic: ${r.topic}`);
    lines.push(`- Scheduled: ${r.scheduledAt ? new Date(r.scheduledAt).toLocaleString() : 'immediate'}`);
    lines.push(`- Status: ${r.status}`);
    if (r.videoId) lines.push(`- Video ID: ${r.videoId}`);
    if (r.videoId) lines.push(`- URL: https://www.youtube.com/watch?v=${r.videoId}`);
    if (r.bestThumbRating) lines.push(`- Best thumbnail score: ${r.bestThumbRating}/10`);
    if (r.error) lines.push(`- Error: ${r.error}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ─── LOG ──────────────────────────────────────────────────────────────────────

function log(msg) { console.log(msg); }

function logSection(title) {
  log(`\n${'═'.repeat(50)}`);
  log(`  ${title}`);
  log(`${'═'.repeat(50)}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts      = parseArgs();
  const startedAt = Date.now();
  const reportTs  = startedAt;

  log('\n╔══════════════════════════════════════════════════╗');
  log('║   SleepForge — 3-Video Autopilot Queue           ║');
  log('╚══════════════════════════════════════════════════╝');
  log(`  Channel:     ${CHANNEL}`);
  log(`  Dry run:     ${opts.dryRun}`);
  log(`  Keep files:  ${opts.keepFiles}`);
  log(`  Skip render: ${opts.skipRender}`);

  // ── Load principles ──
  const principles = JSON.parse(fs.readFileSync(PRINCIPLES_FILE, 'utf-8'));

  // ── Pick 3 topics ──
  logSection('TOPIC SELECTION');
  const topics = await pick3Topics(principles);
  const dates  = scheduleDates();

  log('\n3-video lineup:');
  topics.forEach((t, i) => {
    const d = new Date(dates[i]).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    log(`  ${i + 1}. [${d}] "${t.title}"`);
    log(`     Tradition: ${t.tradition} | Pattern: ${t.title_pattern}`);
  });

  const results = [];

  // ── Process each video ──
  for (let i = 0; i < topics.length; i++) {
    const t           = topics[i];
    const scheduledAt = dates[i];
    const slug        = slugify(t.topic);
    const outputDir   = path.join(ROOT, 'output', slug);
    const videoPath   = path.join(outputDir, 'final.mp4');
    const result      = { index: i + 1, title: t.title, topic: t.topic, tradition: t.tradition, scheduledAt, status: 'pending', videoId: null };
    results.push(result);

    logSection(`VIDEO ${i + 1} / 3 — ${t.tradition}`);
    log(`  Title:     "${t.title}"`);
    log(`  Topic:     ${t.topic}`);
    log(`  Scheduled: ${new Date(scheduledAt).toLocaleString()}`);

    try {
      // Step 1: Render video
      if (!opts.skipRender && fs.existsSync(videoPath)) {
        log('\n── Step 1: Video cached — skipping render ──');
      } else if (!opts.skipRender) {
        log('\n── Step 1: Rendering 60-min video ──');
        await renderVideo(t.topic, slug, 60);
        if (!fs.existsSync(videoPath)) throw new Error(`Render completed but ${videoPath} not found`);
        log(`  ✓ ${videoPath}`);
      } else {
        log('\n── Step 1: --skip-render set ──');
        if (!fs.existsSync(videoPath)) throw new Error(`No video at ${videoPath} and --skip-render set`);
      }

      // Step 2: Load script for thumbnail context
      let scriptText = '';
      const scriptJsonPath = path.join(ROOT, 'scripts', `${slug}.json`);
      if (fs.existsSync(scriptJsonPath)) {
        const scenes = JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8'));
        scriptText = scenes.map(s => s.narration || '').join('\n\n');
      }

      // Step 3: Generate 3 thumbnail variants
      log('\n── Step 2: Generating 3 thumbnail variants ──');
      const { best, unused } = await generate3Variants(outputDir, t.topic, t.title, scriptText);
      result.bestThumbRating = best.rating;

      // Step 4: Generate YouTube metadata
      log('\n── Step 3: Generating YouTube metadata ──');
      const scenes = fs.existsSync(scriptJsonPath) ? JSON.parse(fs.readFileSync(scriptJsonPath, 'utf-8')) : [];
      const meta = await generateMetadata(t.topic, scenes);
      meta.title = t.title; // use our carefully selected title, not the metadata generator's
      log(`  Title: ${meta.title}`);
      log(`  Tags:  ${meta.tags.slice(0, 5).join(', ')}… (${meta.tags.length} total)`);

      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(path.join(outputDir, 'youtube-metadata.json'), JSON.stringify({
        ...meta, scheduledAt, channel: CHANNEL,
      }, null, 2));

      // Step 5: Upload
      if (opts.dryRun) {
        log('\n── DRY RUN — skipping upload ──');
        log(`  Best thumbnail: ${best.pngPath} (score ${best.rating}/10)`);
        result.status = 'dry-run';
        continue;
      }

      log('\n── Step 4: Uploading to YouTube ──');
      const videoId = await uploadVideo({
        channelName:   CHANNEL,
        videoPath,
        title:         meta.title,
        description:   meta.description,
        tags:          meta.tags,
        thumbnailPath: best.pngPath,
        scheduledAt,
        privacyStatus: 'private',
      });

      result.videoId = videoId;
      result.status  = 'uploaded';

      fs.writeFileSync(path.join(outputDir, 'youtube-metadata.json'), JSON.stringify({
        ...meta, scheduledAt, channel: CHANNEL, videoId,
      }, null, 2));

      log(`\n  ✓ Uploaded: https://www.youtube.com/watch?v=${videoId}`);
      log(`  Studio:     https://studio.youtube.com/video/${videoId}/edit`);

      // Step 6: Archive + cleanup
      if (opts.keepFiles) {
        log('  --keep-files set — skipping cleanup.');
      } else {
        log('\n── Step 5: Archive + cleanup ──');
        await archiveAndCleanup(videoId, slug, outputDir, scheduledAt, unused);
        result.status = 'archived';
      }

    } catch (e) {
      log(`\n  ✗ Video ${i + 1} failed: ${e.message}`);
      result.status = 'failed';
      result.error  = e.message;
      // Continue to next video — don't abort the queue
    }

    // Write intermediate report after each video
    const reportPath = path.join(ROOT, 'data', `autopilot-run-${reportTs}.md`);
    fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
    fs.writeFileSync(reportPath, buildReport(results, startedAt));
  }

  await closeBrowser();

  // Final report
  const reportPath = path.join(ROOT, 'data', `autopilot-run-${reportTs}.md`);
  fs.writeFileSync(reportPath, buildReport(results, startedAt));

  logSection('AUTOPILOT COMPLETE');
  const uploaded = results.filter(r => r.videoId);
  log(`  Uploaded: ${uploaded.length} / ${results.length}`);
  for (const r of results) {
    const icon = r.status === 'archived' || r.status === 'uploaded' ? '✓' : r.status === 'dry-run' ? '○' : '✗';
    log(`  ${icon} Video ${r.index}: ${r.title}`);
    if (r.videoId) log(`    └── ${r.videoId} — scheduled ${new Date(r.scheduledAt).toLocaleString()}`);
    if (r.error)   log(`    └── ERROR: ${r.error}`);
  }
  log(`\n  Report: ${reportPath}`);

  if (results.some(r => r.status === 'failed')) process.exit(1);
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
