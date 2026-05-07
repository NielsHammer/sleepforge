/**
 * Persistent learning pool for thumbnail-v3.
 *
 * Two JSON files in output/learning-pool/:
 *   winners.json — thumbnails Niels approved. Each entry has: title, niche,
 *                  html, why, approved_at, optional reason.
 *   losers.json  — thumbnails rejected with a specific reason.
 *
 * Loaded into every planner call as in-context learning. Across runs the
 * system accumulates a real understanding of what good looks like (winners)
 * and what to avoid (losers with reasons).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const POOL_DIR = path.join(PROJECT_ROOT, 'output', 'learning-pool');
const WINNERS_FILE = path.join(POOL_DIR, 'winners.json');
const LOSERS_FILE = path.join(POOL_DIR, 'losers.json');

function ensureDir() {
  if (!fs.existsSync(POOL_DIR)) fs.mkdirSync(POOL_DIR, { recursive: true });
}

function loadJsonArray(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

export function loadWinners() {
  return loadJsonArray(WINNERS_FILE);
}

export function loadLosers() {
  return loadJsonArray(LOSERS_FILE);
}

export function addWinner(entry) {
  ensureDir();
  const winners = loadWinners();
  winners.push({ ...entry, approved_at: new Date().toISOString() });
  fs.writeFileSync(WINNERS_FILE, JSON.stringify(winners, null, 2));
  return winners.length;
}

export function addLoser(entry) {
  if (!entry.reason || typeof entry.reason !== 'string' || entry.reason.trim().length === 0) {
    throw new Error('addLoser() requires a non-empty `reason` string');
  }
  ensureDir();
  const losers = loadLosers();
  losers.push({ ...entry, rejected_at: new Date().toISOString() });
  fs.writeFileSync(LOSERS_FILE, JSON.stringify(losers, null, 2));
  return losers.length;
}

export function buildLearningContext(title, niche, opts = {}) {
  const maxWinners = opts.maxWinners || 4;
  const maxLosers = opts.maxLosers || 6;
  const winners = loadWinners();
  const losers = loadLosers();
  if (winners.length === 0 && losers.length === 0) return '';

  const titleWords = new Set(title.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const score = (entry) => {
    let s = 0;
    if (entry.niche === niche) s += 5;
    const ew = (entry.title || '').toLowerCase().split(/\W+/);
    for (const w of ew) if (titleWords.has(w)) s += 2;
    return s;
  };

  const topWinners = [...winners].sort((a, b) => score(b) - score(a)).slice(0, maxWinners);
  const topLosers = [...losers].sort((a, b) => score(b) - score(a)).slice(0, maxLosers);

  const lines = ['═══ PERSISTENT LEARNING POOL — APPROVED + REJECTED THUMBNAILS ═══', ''];

  if (topWinners.length > 0) {
    lines.push('### APPROVED THUMBNAILS (Niels has personally said these work — adapt the same THINKING, not the same elements)');
    lines.push('');
    topWinners.forEach((w, i) => {
      lines.push(`Winner ${i + 1}: "${w.title}" (${w.niche || 'unknown'})`);
      if (w.why) lines.push(`  Designer reasoning: ${w.why.substring(0, 400)}`);
      if (w.html) {
        const compact = w.html
          .replace(/\s+/g, ' ')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '<style>...</style>')
          .substring(0, 500);
        lines.push(`  Structure: ${compact}`);
      }
      if (w.approved_reason) lines.push(`  Why approved: ${w.approved_reason}`);
      lines.push('');
    });
  }

  if (topLosers.length > 0) {
    lines.push('### REJECTED THUMBNAILS (Niels said these are bad — DO NOT REPEAT THESE MISTAKES)');
    lines.push('');
    topLosers.forEach((l, i) => {
      lines.push(`Loser ${i + 1}: "${l.title}" (${l.niche || 'unknown'})`);
      lines.push(`  WHY REJECTED: ${l.reason}`);
      lines.push('');
    });
  }

  lines.push('═══ END LEARNING POOL ═══');
  lines.push('');
  lines.push('Apply the lessons from APPROVED thumbnails. Avoid every pattern called out in REJECTED thumbnails. These are real human judgments — they override any abstract design principle.');
  lines.push('');
  return lines.join('\n');
}

export function approveFromCli({ outputDir, reason }) {
  const planFile = path.join(outputDir, 'thumbnail-v3-plan.json');
  const htmlFile = path.join(outputDir, 'thumbnail-v3.html');
  if (!fs.existsSync(planFile)) throw new Error('No plan at ' + planFile);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf-8'));
  const html = fs.existsSync(htmlFile) ? fs.readFileSync(htmlFile, 'utf-8') : null;
  const count = addWinner({
    title: plan.title,
    niche: plan.niche,
    why: plan.why,
    html,
    png_path: path.join(outputDir, 'thumbnail.png'),
    approved_reason: reason || null,
  });
  return { pool_size: count };
}

export function rejectFromCli({ outputDir, reason }) {
  if (!reason) throw new Error('reject requires --reason');
  const planFile = path.join(outputDir, 'thumbnail-v3-plan.json');
  if (!fs.existsSync(planFile)) throw new Error('No plan at ' + planFile);
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf-8'));
  const count = addLoser({
    title: plan.title,
    niche: plan.niche,
    reason,
    png_path: path.join(outputDir, 'thumbnail.png'),
  });
  return { pool_size: count };
}
