/**
 * generate-content-set.js
 *
 * Generates N content sets for the Jarvis approval queue.
 * Each set: topic, title + 4 alternatives, description, tags, preview thumbnail.
 * Runs via `node scripts/generate-content-set.js [--count 5]`
 *
 * Outputs JSON status lines to stdout for server to stream:
 *   {"status":"progress","msg":"...","i":N,"total":N}
 *   {"status":"done","sets":[...]}
 *   {"status":"error","msg":"..."}
 */

import fs        from 'fs';
import path      from 'path';
import crypto    from 'crypto';
import { fileURLToPath } from 'url';
import dotenv    from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI }                     = await import('../src/claude-cli.js');
const { generateThumbnailV3, closeBrowser } = await import('../src/thumbnail-v3.js');

const CONTENT_SETS_DIR = path.join(ROOT, 'data', 'content-sets');
const APPROVAL_QUEUE   = path.join(ROOT, 'data', 'approval-queue.json');

function readQueue() {
  try { return JSON.parse(fs.readFileSync(APPROVAL_QUEUE, 'utf-8')); }
  catch { return []; }
}

function writeQueue(items) {
  fs.mkdirSync(path.dirname(APPROVAL_QUEUE), { recursive: true });
  fs.writeFileSync(APPROVAL_QUEUE, JSON.stringify(items, null, 2));
}

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

const TRADITION_TONE = {
  'Stoicism':       'stoic, disciplined, ancient Roman marble, period-authentic art',
  'Taoism':         'tranquil, flowing, ancient Chinese ink wash painting, period-authentic art',
  'Buddhism':       'serene, meditative, ancient Buddhist sculpture or thangka, period-authentic art',
  'Epicureanism':   'peaceful, gentle, ancient Greek or Hellenistic art, period-authentic art',
  'Platonism':      'contemplative, idealist, ancient Greek sculpture, period-authentic art',
  'Aristotelianism':'scholarly, balanced, ancient Greek or Byzantine art, period-authentic art',
  'Confucianism':   'harmonious, ordered, ancient Chinese scroll painting, period-authentic art',
  'Existentialism': 'introspective, modern philosophical, painterly, no modern photos',
  'default':        'calm, meditative, philosophical, period-authentic ancient art',
};

async function generateOneSet(existingTopics, overrideId = null) {
  const id     = overrideId || crypto.randomUUID().slice(0,8);
  const setDir = path.join(CONTENT_SETS_DIR, id);
  fs.mkdirSync(setDir, { recursive: true });

  const principles = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT,'data','reference-principles.json'),'utf-8')); }
    catch { return {}; }
  })();
  const topPrinciples = (principles?.principles || [])
    .filter(p => p.ctr_lift_pct !== null)
    .slice(0, 8)
    .map(p => `${p.name} (+${p.ctr_lift_pct}% CTR)`)
    .join(', ');

  // ── Step 1: topic + titles + metadata in one Haiku call ──
  const prompt = `You are building a content set for a YouTube sleep philosophy channel called "Sleepless Philosophers".

AVOID THESE TOPICS (already in queue): ${JSON.stringify(existingTopics)}

TOP PERFORMING PRINCIPLES: ${topPrinciples || 'none yet'}

Generate ONE complete content set. Requirements:
- Pick a specific, well-known philosophy topic (a tradition, thinker, or concept — e.g. "Marcus Aurelius Stoicism", "Taoism Lao Tzu", "Epicurean philosophy of pleasure", "Aristotle on happiness")
- Sleep-friendly and contemplative
- Strong YouTube appeal for philosophy/sleep audience

Reply ONLY with this JSON (no markdown):
{
  "topic": "short topic name",
  "tradition": "one of: Stoicism | Taoism | Buddhism | Epicureanism | Platonism | Aristotelianism | Confucianism | Existentialism | Other",
  "hook": "one sentence why this resonates with insomniacs",
  "primaryTitle": "YouTube title (include sleep language e.g. 'to Fall Asleep to', 'Sleep Meditation')",
  "alternatives": ["alt title 1","alt title 2","alt title 3","alt title 4"],
  "description": "3-4 sentence YouTube description, natural and sleep-focused",
  "tags": ["tag1","tag2","tag3","tag4","tag5","tag6","tag7","tag8","tag9","tag10","tag11","tag12","tag13","tag14","tag15"]
}`;

  const raw   = await callClaudeCLI(prompt, { model: 'claude-haiku-4-5-20251001', timeoutMs: 45000 });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Haiku returned no JSON for set ${id}`);

  const data = JSON.parse(match[0]);

  // ── Step 2: real thumbnail via full thumbnail-v3 pipeline ──
  const tone = TRADITION_TONE[data.tradition] || TRADITION_TONE.default;
  try {
    await generateThumbnailV3({
      outputDir:  setDir,
      title:      data.primaryTitle,
      scriptText: '',
      niche:      'philosophy',
      tone:       `calm, meditative, philosophical, ${tone}, no modern faces, no contemporary makeup, no plucked eyebrows, no current-era hairstyles`,
    });
  } catch (e) {
    emit({ status: 'progress', msg: `⚠ Thumbnail generation failed for set ${id}: ${e.message.slice(0, 120)}`, i: 0, total: 0 });
    // Fall back to a minimal CSS placeholder so the set isn't blocked
    const fallbackHtml = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box;}body{width:1280px;height:720px;background:#0a0a1a;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;}.t{color:#fff;font-size:68px;font-weight:bold;text-align:center;padding:60px;letter-spacing:0.04em;word-spacing:0.18em;}</style></head><body><div class="t">${data.primaryTitle.replace(/</g,'&lt;')}</div></body></html>`;
    const { default: puppeteer } = await import('puppeteer');
    let browser;
    try {
      browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu'] });
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.setContent(fallbackHtml);
      await page.screenshot({ path: path.join(setDir, 'thumbnail.png') });
    } finally {
      if (browser) await browser.close();
    }
  }

  // ── Step 3: save content.json ──
  const content = {
    id,
    topic:        data.topic,
    tradition:    data.tradition,
    hook:         data.hook,
    title:        data.primaryTitle,
    alternatives: data.alternatives || [],
    description:  data.description,
    tags:         data.tags || [],
    thumbnailPath: path.join(setDir, 'thumbnail.png'),
    createdAt:    new Date().toISOString(),
    status:       'pending',
    notes:        '',
  };
  fs.writeFileSync(path.join(setDir, 'content.json'), JSON.stringify(content, null, 2));

  return content;
}

// ── Main ──
const args       = process.argv.slice(2);
const countIdx   = args.indexOf('--count');
const count      = countIdx >= 0 ? (parseInt(args[countIdx + 1]) || 5) : 5;
const replaceIdx = args.indexOf('--replace-id');
const replaceId  = replaceIdx >= 0 ? args[replaceIdx + 1] : null;

const queue    = readQueue();
const existing = queue.map(q => q.topic);
const results  = [];

for (let i = 0; i < count; i++) {
  emit({ status: 'progress', msg: `Generating content set ${i+1}/${count}…`, i, total: count });
  try {
    const useId   = replaceId && i === 0 ? replaceId : null;
    const content = await generateOneSet([...existing, ...results.map(r => r.topic)], useId);

    // If re-rolling, overwrite the existing queue entry in-place
    if (replaceId && i === 0) {
      const idx = queue.findIndex(q => q.id === replaceId);
      const entry = { id: replaceId, topic: content.topic, tradition: content.tradition, title: content.title, createdAt: content.createdAt, status: 'pending' };
      if (idx >= 0) queue[idx] = entry; else queue.unshift(entry);
      writeQueue(queue);
    } else {
      results.push(content);
      queue.unshift({ id: content.id, topic: content.topic, tradition: content.tradition, title: content.title, createdAt: content.createdAt, status: 'pending' });
      writeQueue(queue);
    }

    emit({ status: 'progress', msg: `✓ Set ${i+1}: "${content.title}"`, i, total: count });
  } catch (err) {
    emit({ status: 'progress', msg: `⚠ Set ${i+1} failed: ${err.message}`, i, total: count });
  }
}

await closeBrowser().catch(() => {});
emit({ status: 'done', sets: results });
