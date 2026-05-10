/**
 * learn-from-feedback.js
 *
 * Reads data/approval-feedback.json (approval/rejection history with notes)
 * and updates data/reference-principles.json with learned preferences.
 *
 * Usage: node scripts/learn-from-feedback.js
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { callClaudeCLI } = await import('../src/claude-cli.js');

const FEEDBACK_FILE    = path.join(ROOT, 'data', 'approval-feedback.json');
const PRINCIPLES_FILE  = path.join(ROOT, 'data', 'reference-principles.json');
const APPROVED_QUEUE   = path.join(ROOT, 'data', 'approved-queue.json');

function tryJson(p) { try { return JSON.parse(fs.readFileSync(p,'utf-8')); } catch { return null; } }

async function main() {
  const feedback   = tryJson(FEEDBACK_FILE);
  const principles = tryJson(PRINCIPLES_FILE);
  const approved   = tryJson(APPROVED_QUEUE) || [];

  if (!feedback || (!feedback.approved?.length && !feedback.rejected?.length)) {
    console.log('No feedback data yet — approve or reject content sets first.');
    return;
  }

  const prompt = `You are a YouTube content strategist for a sleep philosophy channel.

CURRENT PRINCIPLES:
${JSON.stringify(principles?.principles?.slice(0,15) || [], null, 2)}

APPROVAL HISTORY (what Niels approved):
${JSON.stringify(feedback.approved || [], null, 2)}

REJECTION HISTORY (what Niels rejected + why):
${JSON.stringify(feedback.rejected || [], null, 2)}

NOTES FROM NIELS:
${(feedback.notes || []).filter(Boolean).join('\n') || 'none'}

Based on approval/rejection patterns and notes, identify 3-5 updated or new principles about:
- Which topics/traditions perform well
- Title patterns Niels prefers
- Topics to avoid
- Any content preferences revealed by rejections

Reply ONLY with JSON array of principle updates (no markdown):
[
  {"name": "principle name", "description": "one sentence", "learned_from": "approval/rejection/note"},
  ...
]`;

  console.log('Calling Haiku to extract learnings...');
  const raw   = await callClaudeCLI(prompt, { model: 'claude-haiku-4-5-20251001', timeoutMs: 45000 });
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) { console.error('No JSON returned'); return; }

  const newPrinciples = JSON.parse(match[0]);
  console.log(`Learned ${newPrinciples.length} new/updated principles:`);
  for (const p of newPrinciples) console.log(`  • ${p.name}: ${p.description}`);

  // Merge into reference-principles.json
  const existing = principles || { principles: [], last_updated: null };
  const merged = [...existing.principles];
  for (const np of newPrinciples) {
    const idx = merged.findIndex(p => p.name.toLowerCase() === np.name.toLowerCase());
    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...np, updated_from_feedback: new Date().toISOString() };
    } else {
      merged.push({ ...np, ctr_lift_pct: null, source: 'approval_feedback', added_at: new Date().toISOString() });
    }
  }
  existing.principles    = merged;
  existing.last_updated  = new Date().toISOString();
  fs.writeFileSync(PRINCIPLES_FILE, JSON.stringify(existing, null, 2));

  // Archive processed feedback
  const archivePath = path.join(ROOT, 'data', `approval-feedback-${Date.now()}.json`);
  fs.copyFileSync(FEEDBACK_FILE, archivePath);
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify({ approved: [], rejected: [], notes: [] }, null, 2));

  console.log(`\nPrinciples updated: ${PRINCIPLES_FILE}`);
  console.log(`Feedback archived:  ${archivePath}`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
