/**
 * schedule-month.js
 *
 * Generates and uploads 30 videos scheduled at 8am local time over the next 30 days.
 * One video at a time on disk — auto-publish.js handles cleanup after each upload.
 *
 * Flow per video:
 *   1. Generate script + audio + Remotion render
 *   2. Generate thumbnail (thumbnail-v3)
 *   3. Generate YouTube metadata
 *   4. Upload to YouTube as private, publishAt = scheduled date 8am
 *   5. archive-and-cleanup deletes render folder
 *   6. Next video
 *
 * Diversity: no repeated philosopher/tradition on consecutive days.
 * Resumable: reads data/schedule-plan.json — skips already-uploaded entries.
 *
 * Usage:
 *   node scripts/schedule-month.js --channel sleepless-philosophers [--days 30] [--dry-run]
 *
 * IMPORTANT: Do not run until Niels approves the sample preview from generate-single-sample.js.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI } = await import('../src/claude-cli.js');

const PRINCIPLES_FILE = path.join(ROOT, 'data', 'reference-principles.json');
const PLAN_FILE       = path.join(ROOT, 'data', 'schedule-plan.json');
const HAIKU  = 'claude-haiku-4-5-20251001';
const SONNET = 'claude-sonnet-4-6';

function log(msg) { console.log(msg); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { channel: null, days: 30, dryRun: false, keepFiles: false };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--channel':    opts.channel  = args[++i]; break;
      case '--days':       opts.days     = parseInt(args[++i], 10); break;
      case '--dry-run':    opts.dryRun   = true; break;
      case '--keep-files': opts.keepFiles = true; break;
    }
  }
  return opts;
}

// ─── SCHEDULE DATE HELPERS ───────────────────────────────────────────────────

function scheduledDates(count) {
  const dates = [];
  const now   = new Date();
  for (let i = 1; i <= count; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    d.setHours(8, 0, 0, 0);
    dates.push(d.toISOString());
  }
  return dates;
}

// ─── TOPIC PLAN GENERATION (Sonnet) ─────────────────────────────────────────

async function generateTopicPlan(principles, days) {
  const contextSummary = JSON.stringify({
    sample_count:          principles.sample_count || 0,
    top_emerging_patterns: principles.top_emerging_patterns || [],
    high_ctr_keywords:     principles.high_ctr_keywords || [],
    title_patterns:        (principles.title_patterns || []).map(p => ({
      pattern_name: p.pattern_name,
      formula:      p.formula,
    })),
    sleepless_philosophers_insights: principles.sleepless_philosophers_insights || {},
  }, null, 2);

  const prompt = `You are a YouTube content strategist for "Sleepless Philosophers" — a 1-hour calm sleep story channel.

You have analyzed ${principles.sample_count || 0} reference videos. Reference data:
${contextSummary}

Generate a ${days}-video content plan for the next ${days} days.

DIVERSITY RULES (strictly enforced):
1. No two consecutive videos from the same philosopher or philosophical tradition
2. Rotate through at least 6 different traditions across the 30 days
   (e.g., Stoicism, Eastern philosophy, Ancient Greek, Medieval, Existentialism, Mythology)
3. Mix encyclopedic list format and single-concept deep-dive format throughout
4. Vary the CTR pattern: cycle through encyclopedic_number → completeness_claim → duration_list → superlative_quality
5. At least one "(NO ADS)" prefix title in every 7-video block

CONTENT RULES:
- All topics must work as 1-hour calm narrated sleep stories
- Named philosophers outperform generic tradition names ("Seneca" > "Stoic philosopher")
- Mix well-known and obscure (1 surprising pick per 7 days)

Return ONLY this JSON:
{
  "plan": [
    {
      "day": 1,
      "topic": "concise topic description",
      "sub_niche": "sleep_philosophy or sleep_history",
      "title": "The winning title",
      "title_pattern": "pattern name",
      "tradition": "Stoicism / Buddhism / Ancient Greek / etc",
      "philosopher": "primary philosopher or null",
      "diversity_note": "one sentence: how this differs from adjacent days"
    }
  ]
}`;

  log(`  Generating ${days}-day topic plan (Sonnet)...`);
  const raw = await callClaudeCLI(prompt, { model: SONNET, timeoutMs: 180000 });
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Topic plan: no JSON in response');
  const result = JSON.parse(m[0]);
  if (!Array.isArray(result.plan)) throw new Error('Topic plan: missing plan array');
  return result.plan;
}

// ─── RUN A SCRIPT AS SUBPROCESS ─────────────────────────────────────────────

function runScript(scriptPath, args = [], extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env:   { ...process.env, ...extraEnv },
      cwd:   ROOT,
    });
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} exited ${code}`));
    });
    child.on('error', reject);
  });
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (!opts.channel && !opts.dryRun) {
    console.error('\n--channel is required unless --dry-run is set.\n');
    process.exit(1);
  }

  log('\n╔══════════════════════════════════════════╗');
  log('║   SleepForge — 30-Day Schedule Builder    ║');
  log('╚══════════════════════════════════════════╝');
  log(`  Channel:  ${opts.channel || '(dry-run)'}`);
  log(`  Days:     ${opts.days}`);
  log(`  Dry run:  ${opts.dryRun}`);
  log(`  Plan:     ${PLAN_FILE}\n`);

  const principles = JSON.parse(fs.readFileSync(PRINCIPLES_FILE, 'utf-8'));

  // ── Load or generate plan ──
  let plan = null;
  if (fs.existsSync(PLAN_FILE)) {
    try {
      plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf-8'));
      log(`Loaded existing plan (${plan.length} entries) from ${PLAN_FILE}`);
      const pending = plan.filter(e => !e.uploaded);
      log(`  ${plan.length - pending.length} uploaded, ${pending.length} pending\n`);
    } catch { plan = null; }
  }

  if (!plan || plan.length < opts.days) {
    log('Generating new topic plan...');
    const topics = await generateTopicPlan(principles, opts.days);
    const dates  = scheduledDates(opts.days);
    plan = topics.map((t, i) => ({
      ...t,
      scheduledAt: dates[i] || null,
      uploaded:    false,
      videoId:     null,
    }));
    fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));
    log(`✓ Plan saved: ${PLAN_FILE}`);
    log('\n30-day lineup:');
    plan.forEach(e => {
      const d = new Date(e.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      log(`  ${String(e.day).padStart(2)} [${d}] "${e.title}"`);
    });
  }

  if (opts.dryRun) {
    log('\nDry run complete — plan saved but no videos rendered.');
    return;
  }

  // ── Process pending entries ──
  const pending = plan.filter(e => !e.uploaded);
  log(`\nProcessing ${pending.length} pending video(s)...\n`);

  for (const entry of pending) {
    const d = new Date(entry.scheduledAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    log(`\n╔══════════════════════════════════════════╗`);
    log(`║  Day ${String(entry.day).padStart(2)} — ${d.padEnd(18)}          ║`);
    log(`╚══════════════════════════════════════════╝`);
    log(`  Title:     "${entry.title}"`);
    log(`  Topic:     ${entry.topic}`);
    log(`  Tradition: ${entry.tradition}`);
    log(`  Scheduled: ${new Date(entry.scheduledAt).toLocaleString()}`);

    const args = [
      '--topic',    entry.topic,
      '--channel',  opts.channel,
      '--schedule', entry.scheduledAt,
    ];
    if (opts.keepFiles) args.push('--keep-files');

    try {
      await runScript(path.join(ROOT, 'scripts', 'auto-publish.js'), args);
      // Mark as uploaded in plan (auto-publish handles the actual cleanup)
      entry.uploaded   = true;
      entry.uploadedAt = new Date().toISOString();
      fs.writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2));
      log(`  ✓ Day ${entry.day} uploaded and scheduled.`);
    } catch (e) {
      log(`\n  ✗ Day ${entry.day} failed: ${e.message}`);
      log('  Stopping schedule to avoid out-of-order uploads.');
      log('  Re-run to resume from this entry.');
      process.exit(1);
    }
  }

  log('\n╔══════════════════════════════════════════╗');
  log('║   ✅ All 30 videos scheduled!              ║');
  log('╚══════════════════════════════════════════╝\n');
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
