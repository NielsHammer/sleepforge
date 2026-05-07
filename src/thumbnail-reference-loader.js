/**
 * Reference blueprint loader for the thumbnail planner.
 *
 * Loads niche reference JSON blueprints from thumbnail-references/<niche>/*.json
 * and exposes selectRelevantReferences() which picks the top N blueprints most
 * similar to the current video by niche match and topic keyword overlap.
 *
 * Also loads video-library/ for real YouTube thumbnail JPGs to attach as vision
 * context to the planner.
 *
 * Both directories start empty — the system degrades gracefully to designing
 * without references. Quality improves as the corpus is rebuilt over time.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const REFERENCES_DIR = path.join(PROJECT_ROOT, 'thumbnail-references');
const VIDEO_LIBRARY_DIR = path.join(PROJECT_ROOT, 'video-library');

let _allRefs = null;

const NICHE_NEIGHBORS = {
  science: ['science', 'space', 'disaster_science'],
  finance: ['finance'],
  tech: ['tech', 'mystery'],
  health: ['health', 'self_improvement'],
  history: ['history', 'mystery'],
  horror: ['mystery', 'history'],
  space: ['space', 'science'],
  nature: ['nature', 'disaster_science', 'science'],
  travel: ['nature', 'history'],
  entertainment: ['entertainment'],
  education: ['science', 'self_improvement'],
  self_improvement: ['self_improvement', 'health'],
  military: ['history', 'tech'],
  retirement: ['finance'],
  philosophy: ['self_improvement', 'history', 'education'],
  sleep: ['self_improvement', 'health', 'philosophy'],
};

function loadAll() {
  if (_allRefs) return _allRefs;
  _allRefs = [];
  if (!fs.existsSync(REFERENCES_DIR)) return _allRefs;
  for (const niche of fs.readdirSync(REFERENCES_DIR)) {
    if (niche.startsWith('_')) continue;
    const nicheDir = path.join(REFERENCES_DIR, niche);
    let stat;
    try { stat = fs.statSync(nicheDir); } catch (e) { continue; }
    if (!stat.isDirectory()) continue;
    for (const f of fs.readdirSync(nicheDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const bp = JSON.parse(fs.readFileSync(path.join(nicheDir, f), 'utf-8'));
        if (!bp.meta || !bp.design_reasoning) continue;
        _allRefs.push({ niche, file: f, ...bp });
      } catch (e) { /* skip malformed */ }
    }
  }
  return _allRefs;
}

function scoreRelevance(ref, title, niche, targetEmotion) {
  const neighbors = NICHE_NEIGHBORS[niche] || [niche];
  if (!neighbors.includes(ref.niche)) return -1;

  let score = 0;
  if (ref.niche === niche) score += 10;

  const titleWords = new Set(title.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const refTitleWords = new Set((ref.meta?.title_reference || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));
  let overlap = 0;
  for (const w of titleWords) if (refTitleWords.has(w)) overlap++;
  score += overlap * 8;

  if (targetEmotion && ref.emotional_triggers?.primary_trigger) {
    const trig = ref.emotional_triggers.primary_trigger.toLowerCase();
    if (trig.includes(targetEmotion.toLowerCase())) score += 6;
  }

  const vibes = ['dread', 'awe', 'curious', 'aspir', 'shock', 'mystery', 'urgent', 'forbidden', 'reveal'];
  for (const v of vibes) {
    if ((ref.meta?.mood || '').toLowerCase().includes(v)) score += 0.5;
  }

  return score;
}

let _videoLib = null;
function loadVideoLibrary() {
  if (_videoLib) return _videoLib;
  _videoLib = [];
  if (!fs.existsSync(VIDEO_LIBRARY_DIR)) return _videoLib;
  for (const id of fs.readdirSync(VIDEO_LIBRARY_DIR)) {
    const dir = path.join(VIDEO_LIBRARY_DIR, id);
    let stat;
    try { stat = fs.statSync(dir); } catch (e) { continue; }
    if (!stat.isDirectory()) continue;
    const metaFile = path.join(dir, 'metadata.json');
    const thumbFile = path.join(dir, 'thumbnail.jpg');
    if (!fs.existsSync(metaFile) || !fs.existsSync(thumbFile)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(metaFile, 'utf-8'));
      if (!m.title || !m.viewCount) continue;
      _videoLib.push({ id, title: m.title, channel: m.channel, views: m.viewCount, path: thumbFile });
    } catch (e) {}
  }
  return _videoLib;
}

function inferTitleNiche(title) {
  const t = (title || '').toLowerCase();
  const tags = new Set();
  if (/\b(rocket|space|nasa|planet|galaxy|cosmos|star|black hole|moon|mars|jupiter|saturn|venus|alien|universe|dimension|astronomy|orbit|cosmic)\b/.test(t)) tags.add('space');
  if (/\b(ai|artificial intelligence|robot|hack|cyber|crypto|computer|machine learning|neural|tech|software|coding|algorithm|silicon)\b/.test(t)) tags.add('tech');
  if (/\b(invest|stock|crypto|bitcoin|money|millionaire|million|billion|wealth|finance|broke|rich|profit|market|economy|recession|debt|tax)\b/.test(t)) tags.add('finance');
  if (/\b(volcano|earthquake|trench|ocean|deep sea|mariana|tsunami|hurricane|tornado|asteroid|extinction|disaster|geology|magma|tectonic)\b/.test(t)) tags.add('disaster_science');
  if (/\b(animal|wildlife|jungle|forest|species|amazon|reef|coral|whale|shark|wolf|bear|tiger|lion|elephant|extinct|biology|ecosystem)\b/.test(t)) tags.add('nature');
  if (/\b(history|ancient|empire|war|world war|king|queen|battle|rome|roman|medieval|civilization|dynasty|century|bc|ad|pharaoh|emperor|knight|viking)\b/.test(t)) tags.add('history');
  if (/\b(diet|health|food|nutrition|brain|sleep|exercise|fitness|mental|workout|body|muscle|fat|weight|sugar|hormone|cancer|heart|disease)\b/.test(t)) tags.add('health');
  if (/\b(physics|chemistry|biology|science|scientific|experiment|theory|quantum|atom|particle|relativity|entropy|antimatter|laser|gravity|dna|gene)\b/.test(t)) tags.add('science');
  if (/\b(motivation|discipline|habit|routine|success|mindset|productivity|stoic|stoicism|wisdom|self help|self improvement|focus|goals)\b/.test(t)) tags.add('self_improvement');
  if (/\b(mystery|secret|conspiracy|hidden|forbidden|dark|cult|paranormal|unsolved|cold case|crime|murder|killer|haunted|disappear|missing)\b/.test(t)) tags.add('mystery');
  if (/\b(philosophy|philosopher|marcus|aurelius|seneca|epictetus|socrates|plato|aristotle|stoic|stoicism|wisdom|virtue|meditations|epicurus)\b/.test(t)) tags.add('philosophy');
  return tags;
}

export function selectReferenceThumbnailImages(title, niche, n = 4) {
  const lib = loadVideoLibrary();
  if (lib.length === 0) return [];
  const titleWords = new Set((title || '').toLowerCase().split(/\W+/).filter(w => w.length > 3));
  const nicheTagSet = new Set([niche, ...(NICHE_NEIGHBORS[niche] || [])]);
  const titleTags = inferTitleNiche(title);

  const scored = lib.map(v => {
    let score = 0;
    const vTags = inferTitleNiche(v.title);
    let hasNicheMatch = false;
    for (const tag of titleTags) if (vTags.has(tag)) { score += 10; hasNicheMatch = true; }
    for (const tag of nicheTagSet) if (vTags.has(tag)) { score += 5; hasNicheMatch = true; }
    const vWords = (v.title || '').toLowerCase().split(/\W+/);
    for (const w of vWords) if (titleWords.has(w)) score += 6;
    score += Math.log10(Math.max(1, v.views)) / 4;
    return { ...v, _score: score, _hasNicheMatch: hasNicheMatch };
  });
  const matched = scored.filter(s => s._hasNicheMatch).sort((a, b) => b._score - a._score);
  const unmatched = scored.filter(s => !s._hasNicheMatch).sort((a, b) => b._score - a._score);
  const out = matched.slice(0, n);
  while (out.length < n && unmatched.length > 0) out.push(unmatched.shift());
  return out;
}

export function selectRelevantReferences(title, niche, n = 4, targetEmotion = null) {
  const all = loadAll();
  const scored = all
    .map(r => ({ ref: r, score: scoreRelevance(r, title, niche, targetEmotion) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map(x => x.ref);
}

export function formatReferenceContext(references) {
  if (!references || references.length === 0) return '';
  const lines = [
    '═══ REAL DESIGNER EXAMPLES — STUDY THEIR THINKING, DO NOT COPY THEIR ELEMENTS ═══',
    '',
    'Below are ' + references.length + ' real high-performing YouTube thumbnails that real designers made for similar videos. For each one, you will see WHAT they did and WHY they made each choice. Your job is NOT to copy their layout or their text — your job is to think like they thought.',
    '',
  ];
  references.forEach((ref, i) => {
    lines.push(`──── Reference ${i + 1}/${references.length} (${ref.niche}) ────`);
    if (ref.meta?.title_reference) lines.push(`Original video: "${ref.meta.title_reference}"`);
    if (ref.meta?.layout_type) lines.push(`Layout type: ${ref.meta.layout_type}`);
    if (ref.meta?.mood) lines.push(`Mood: ${ref.meta.mood}`);

    const t = ref.text_hierarchy?.[0];
    if (t) {
      lines.push('');
      lines.push(`HOOK TEXT: "${t.content}"`);
      if (t.why_this_text) lines.push(`  why this hook works: ${t.why_this_text}`);
      if (t.why_this_position) lines.push(`  why this position: ${t.why_this_position}`);
    }
    if (ref.design_reasoning?.why_this_layout) lines.push(`WHY THIS LAYOUT: ${ref.design_reasoning.why_this_layout}`);
    if (ref.design_reasoning?.why_these_colors) lines.push(`WHY THESE COLORS: ${ref.design_reasoning.why_these_colors}`);
    if (ref.design_reasoning?.what_makes_someone_click) lines.push(`WHAT MAKES SOMEONE CLICK: ${ref.design_reasoning.what_makes_someone_click}`);
    if (ref.emotional_triggers?.primary_trigger) lines.push(`PRIMARY EMOTIONAL TRIGGER: ${ref.emotional_triggers.primary_trigger}`);
    if (ref.emotional_triggers?.curiosity_gap) lines.push(`CURIOSITY GAP: ${ref.emotional_triggers.curiosity_gap}`);
    if (ref.design_patterns?.technique) lines.push(`DESIGN TECHNIQUE: ${ref.design_patterns.technique}`);
    if (Array.isArray(ref.color_palette?.hex_list)) lines.push(`PALETTE: ${ref.color_palette.hex_list.join(' ')}`);
    lines.push('');
  });
  lines.push('═══ END REFERENCES ═══');
  lines.push('');
  return lines.join('\n');
}
