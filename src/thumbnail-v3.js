/**
 * SleepForge Thumbnail v3 — free-form HTML/CSS generation
 *
 * Ported from VideoForge thumbnail-v3.js. Key differences:
 *   - All models: claude-sonnet-4-6 (no Opus — CLAUDE.md rule)
 *   - Image sources: Recraft AI → Flux Schnell (cost rule: no Flux Pro)
 *   - Paths: Windows-compatible, relative to project root
 *   - canvas dependency removed (mobile check uses luminance estimate from PNG)
 *
 * Pipeline:
 *   1. Hook writer: 5 candidates → pick strongest (Pass 0)
 *   2. Concreteness classifier: concrete topic skips metaphor brainstorm (Pass 0.4)
 *   3. Metaphor brainstorm: abstract topics only, 5 candidates → pick strongest (Pass 0.5)
 *   4. Claude designs complete HTML/CSS with {{IMG:n}} placeholders (Pass 1)
 *   5. Image fetcher: Recraft → Flux Schnell → Pexels → Brave (Pass 2)
 *   6. HTML rewritten with local file:// URLs (Pass 3)
 *   7. Puppeteer renders 1280x720 PNG (Pass 3)
 *   8. Legibility + spell check (Pass 3)
 *   9. Critic rates 1-10, retry if < 7, max 3 attempts (Pass 5)
 *  10. Best-of-attempts promoted as final
 */
import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { selectReferenceThumbnailImages } from './thumbnail-reference-loader.js';
import { loadWinners, loadLosers } from './thumbnail-learning-pool.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const FAL_KEY = process.env.FAL_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

const MODEL = 'claude-sonnet-4-6';
const CANVAS_W = 1280;
const CANVAS_H = 720;
const MAX_ATTEMPTS = 3;
const PASS_THRESHOLD = 7;

// ─── IMAGE FETCHING ──────────────────────────────────────────────────────────

async function fetchRecraftImage(prompt, style = 'realistic_image') {
  if (!FAL_KEY) return null;
  try {
    const r = await axios.post(
      'https://queue.fal.run/fal-ai/recraft-v3',
      { prompt, image_size: 'landscape_16_9', style, num_images: 1 },
      { headers: { Authorization: 'Key ' + FAL_KEY, 'Content-Type': 'application/json' }, timeout: 30000 },
    );
    let result = r.data;
    if (result.status_url || result.request_id) {
      const statusUrl = result.status_url || `https://queue.fal.run/fal-ai/recraft-v3/requests/${result.request_id}/status`;
      const responseUrl = result.response_url || `https://queue.fal.run/fal-ai/recraft-v3/requests/${result.request_id}`;
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const s = await axios.get(statusUrl, { headers: { Authorization: 'Key ' + FAL_KEY }, timeout: 10000 });
          if (s.data.status === 'COMPLETED') {
            const final = await axios.get(responseUrl, { headers: { Authorization: 'Key ' + FAL_KEY }, timeout: 10000 });
            return final.data.images?.[0]?.url || null;
          }
          if (s.data.status === 'IN_QUEUE' || s.data.status === 'IN_PROGRESS') continue;
        } catch (e) { /* polling retry */ }
      }
    }
    return result.images?.[0]?.url || null;
  } catch (e) {
    return null;
  }
}

async function fetchFluxSchnellImage(prompt) {
  if (!FAL_KEY) return null;
  try {
    const r = await axios.post(
      'https://fal.run/fal-ai/flux/schnell',
      { prompt, image_size: 'landscape_16_9', num_images: 1, num_inference_steps: 4, enable_safety_checker: false },
      { headers: { Authorization: 'Key ' + FAL_KEY, 'Content-Type': 'application/json' }, timeout: 60000 },
    );
    return r.data.images?.[0]?.url || null;
  } catch (e) {
    return null;
  }
}

async function fetchPexelsImage(query) {
  if (!PEXELS_API_KEY) return null;
  try {
    const r = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: 5, orientation: 'landscape' },
      headers: { Authorization: PEXELS_API_KEY },
      timeout: 10000,
    });
    const photos = (r.data.photos || []).filter(p => p.width >= 1000);
    if (photos.length === 0) return null;
    photos.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    return photos[0].src.large2x || photos[0].src.large;
  } catch (e) {
    return null;
  }
}

async function fetchBraveImage(query) {
  if (!BRAVE_API_KEY) return null;
  try {
    const r = await axios.get('https://api.search.brave.com/res/v1/images/search', {
      params: { q: query + ' high resolution', count: 5, safesearch: 'strict' },
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, Accept: 'application/json' },
      timeout: 10000,
    });
    const results = (r.data.results || []).filter(r => (r.width || 0) >= 1000);
    if (results.length === 0) return null;
    results.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
    return results[0].properties?.url || null;
  } catch (e) {
    return null;
  }
}

async function downloadToFile(url, dest) {
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  fs.writeFileSync(dest, Buffer.from(r.data));
  return dest;
}

async function resolveImageRequest(req, label, outDir) {
  const prompt = req.prompt || req.query || '';
  if (!prompt) return null;
  const isReal = req.source_hint === 'real' || req.use_real_photo === true;

  console.log(`  [${label}] ${isReal ? 'REAL' : 'AI'}: "${prompt.substring(0, 80)}${prompt.length > 80 ? '...' : ''}"`);

  let url = null;

  if (isReal) {
    url = await fetchPexelsImage(prompt);
    if (!url) url = await fetchBraveImage(prompt);
    if (!url) {
      console.log(`  [${label}] No real photo — falling back to AI`);
      url = await fetchRecraftImage(prompt);
      if (!url) url = await fetchFluxSchnellImage(prompt);
    }
  } else {
    url = await fetchRecraftImage(prompt);
    if (!url) url = await fetchFluxSchnellImage(prompt);
    if (!url) {
      console.log(`  [${label}] AI failed — falling back to Pexels`);
      url = await fetchPexelsImage(prompt);
    }
    if (!url) url = await fetchBraveImage(prompt);
  }

  if (!url) {
    console.log(`  [${label}] All sources failed`);
    return null;
  }

  const localPath = path.join(outDir, `${label}.png`);
  try {
    await downloadToFile(url, localPath);
    console.log(`  [${label}] saved to ${path.basename(localPath)}`);
    return localPath;
  } catch (e) {
    console.log(`  [${label}] download failed: ${e.message}`);
    return null;
  }
}

// ─── HOOK WRITER ──────────────────────────────────────────────────────────────

async function generateHookCandidates({ title, scriptText, niche, tone }) {
  const scriptExcerpt = scriptText ? scriptText.substring(0, 4000) : 'No script available — design from title alone.';

  const prompt = `You are writing hook text for a YouTube thumbnail. 1-3 words that appear over an image at 168x94 pixels on a phone screen.

TITLE: "${title}"
NICHE: ${niche || 'unknown'}
TONE: ${tone || 'unknown'}

SCRIPT (mine this for the specific thing that makes THIS video interesting):
"""
${scriptExcerpt}
"""

A thumbnail hook is a PROMISE. It tells the viewer what they'll learn and makes them feel like they NEED to know. It is not poetry. It is not a clever phrase. It is a promise that, combined with the image, makes someone think "I have to watch this."

Before generating candidates, answer these two questions about the video:
1. WHAT IS THE SINGLE MOST INTERESTING THING IN THIS VIDEO? (Not a mood. Not a theme. The specific surprising fact, event, or revelation.)
2. WHAT IMAGE WILL LIKELY APPEAR IN THE THUMBNAIL? (The obvious visual subject. The hook must work WITH this image, not duplicate it.)

The hook and image SPLIT the work:
- The IMAGE shows you WHAT (the philosopher, the concept, the scene)
- The HOOK tells you WHY you should care (what happened, what's surprising, what you'll gain)
- Together they answer: "what is this video about and why should I watch it?"

CRITICAL DISTINCTION — STATEMENTS vs EMOTIONS:
The biggest failure mode is hooks that DESCRIBE what happened instead of making you FEEL it.
  - Statements score lower. Emotions score higher.
  - "STILL KILLING" is an EMOTION — present-tense dread. Score it higher.
  - "MISSILES STARVED" is gold standard — curious, clickable, emotional, AND you understand the video.

Before locking any hook, ALL FOUR must be true:
  1. Would the average person be CURIOUS?
  2. Would they WANT TO CLICK?
  3. Would they FEEL something?
  4. Would they UNDERSTAND what the video is about?

Generate 5 candidate hooks. Score each 1-10 on THREE axes:
  - clarity: does a viewer INSTANTLY understand the topic when they see this hook + the likely image?
  - promise: does this hook make the viewer feel "I NEED to watch this"?
  - emotion: does this hook make the viewer FEEL something in 0.05 seconds?

WINNERS from our pool (study these):
  - "MISSILES STARVED" — SR-71 video. You instantly understand: the plane outran missiles.
  - "PUNCHED THROUGH" — Tonga eruption. Visceral, instant understanding.
  - "STILL FULL" — Hilbert's Hotel paradox. Makes an abstract concept feel eerie.
  - "FROZEN FOREVER" — Black hole. Existential dread in two words.
  - "STILL KILLING" — Chernobyl. Present-tense dread, ongoing threat.
  - "NEVER SEEN RAIN" — Atacama Desert. Simple, curious, makes you need to know.

LOSERS from our pool (avoid these patterns):
  - "BOTH ENGINES DEAD" — Statement about mechanical failure, not human stakes.
  - "ORGANS GO DARK" — Sounds like death but the video is about SIZE.
  - "NO OTHER DOCTOR" — States a staffing fact, doesn't make you feel desperation.

Pick the SINGLE BEST hook. Return ONLY this JSON:
{
  "what_is_interesting": "one sentence: the single most interesting thing in this video",
  "likely_image": "one sentence: what the thumbnail image will probably show",
  "candidates": [
    { "hook": "TEXT", "clarity": N, "promise": N, "emotion": N, "total": N },
    { "hook": "TEXT", "clarity": N, "promise": N, "emotion": N, "total": N },
    { "hook": "TEXT", "clarity": N, "promise": N, "emotion": N, "total": N },
    { "hook": "TEXT", "clarity": N, "promise": N, "emotion": N, "total": N },
    { "hook": "TEXT", "clarity": N, "promise": N, "emotion": N, "total": N }
  ],
  "winner": "the chosen hook text",
  "winner_reasoning": "one sentence: why this hook + the likely image makes a viewer think 'I have to watch this'"
}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.content[0].text;
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Hook planner returned no JSON');
  const result = JSON.parse(m[0]);
  if (!result.winner) throw new Error('Hook planner returned no winner');
  return result;
}

// ─── TOPIC CONCRETENESS CLASSIFIER ────────────────────────────────────────────

async function classifyTopicConcreteness({ title, scriptText, niche }) {
  const prompt = `Classify this YouTube video topic as CONCRETE or ABSTRACT for thumbnail design purposes.

TITLE: "${title}"
NICHE: ${niche || 'unknown'}
SCRIPT EXCERPT: "${(scriptText || '').substring(0, 1500)}"

CONCRETE = the topic has an obvious physical subject that a thumbnail should literally show.
  Examples: "The Tonga Volcano" → CONCRETE, "How the SR-71 Outran Missiles" → CONCRETE

ABSTRACT = the topic has no obvious physical subject and the literal image would be boring. Needs a creative metaphor.
  Examples: "The Math Problem Nobody Can Solve" → ABSTRACT, "Why Discipline Beats Motivation" → ABSTRACT

Return ONLY this JSON:
{ "is_abstract": true | false, "subject": "the literal subject if CONCRETE, or null if ABSTRACT", "reason": "one sentence why" }`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].text;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { is_abstract: true, reason: 'classifier returned no JSON, defaulting to abstract' };
    return JSON.parse(m[0]);
  } catch (e) {
    return { is_abstract: true, reason: 'classifier failed: ' + e.message };
  }
}

// ─── VISUAL METAPHOR BRAINSTORM ────────────────────────────────────────────────

async function generateImageMetaphors({ title, scriptText, niche, tone, lockedHook }) {
  const scriptExcerpt = scriptText ? scriptText.substring(0, 4000) : 'No script available — design from title alone.';

  const prompt = `You are a senior YouTube thumbnail designer brainstorming the visual for this video.

TITLE: "${title}"
NICHE: ${niche || 'unknown'}
TONE: ${tone || 'unknown'}

LOCKED HOOK: "${lockedHook?.winner || '(no hook)'}"
WHY THIS HOOK: ${lockedHook?.winner_reasoning || ''}

SCRIPT EXCERPT (mine for specific scenes, objects, characters, moments):
"""
${scriptExcerpt}
"""

Your job: generate 5 candidate visual metaphors. The image must make the locked hook FEEL true at a single glance.

CRITICAL — avoid the LITERAL IMAGE failure mode:
  - For a philosophy topic, the literal image is a chalk drawing. The metaphorical image is a single torch lighting in darkness, a mind opening like a door, hands releasing chains.
  - For an abstract concept, don't show a chalkboard. Show the FEELING of the concept.
  - The literal image is what an amateur picks. The metaphorical image is what a senior designer picks.

TONE MATCHING — for PHILOSOPHICAL or INTELLECTUAL topics:
  - NEVER use violence, death, gore, blood, war scenes, or crime imagery.
  - Use intellectual-mystery metaphors: locked doors, infinite hallways, missing puzzle pieces, frozen moments, light breaking through darkness.

Score each candidate 1-10 on:
  - surprise: would a senior designer say "oh, that's clever"?
  - emotional_impact: does the image make the viewer FEEL the hook before reading text?
  - specificity: is the image specific and concrete, or generic stock?
  - hook_coherence: does the image visually answer the question the hook raises?

Return ONLY this JSON:
{
  "candidates": [
    {
      "metaphor": "one-sentence description of the image",
      "image_prompt": "complete cinematic AI generation prompt — be specific about composition, lighting, color, mood",
      "source_hint": "ai",
      "surprise": N, "emotional_impact": N, "specificity": N, "hook_coherence": N, "total": N
    },
    { "metaphor": "...", "image_prompt": "...", "source_hint": "ai", "surprise": N, "emotional_impact": N, "specificity": N, "hook_coherence": N, "total": N },
    { "metaphor": "...", "image_prompt": "...", "source_hint": "ai", "surprise": N, "emotional_impact": N, "specificity": N, "hook_coherence": N, "total": N },
    { "metaphor": "...", "image_prompt": "...", "source_hint": "ai", "surprise": N, "emotional_impact": N, "specificity": N, "hook_coherence": N, "total": N },
    { "metaphor": "...", "image_prompt": "...", "source_hint": "ai", "surprise": N, "emotional_impact": N, "specificity": N, "hook_coherence": N, "total": N }
  ],
  "winner_index": 0,
  "winner_reasoning": "one sentence explaining why this metaphor beats the others for THIS specific topic + hook"
}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = response.content[0].text;
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Metaphor planner returned no JSON');
  const result = JSON.parse(m[0]);
  if (!Array.isArray(result.candidates) || result.candidates.length === 0) {
    throw new Error('Metaphor planner returned no candidates');
  }
  result.winner = result.candidates[result.winner_index || 0];
  return result;
}

// ─── PLANNER PROMPT ────────────────────────────────────────────────────────────

function buildPlannerPrompt({ title, scriptText, niche, tone, priorAttempt, visionRefs = [], poolWinners = [], poolLosers = [], lockedHook = null, lockedMetaphor = null }) {
  const scriptExcerpt = scriptText ? scriptText.substring(0, 6000) : 'No script available — design from title alone.';
  const totalImages = visionRefs.length + poolWinners.length + poolLosers.length;

  const visionBlock = totalImages > 0
    ? `
═══ VISUAL CONTEXT ═══
${visionRefs.length} reference thumbnails attached (top-performing real YouTube thumbnails in this niche).
${poolWinners.length} APPROVED designs attached (the human reviewer Niels personally said these work).
${poolLosers.length} REJECTED designs attached (Niels personally rejected these — see reasons below).

CRITICAL — HOW TO USE THE APPROVED EXAMPLES:
Niels approved these designs for ONE reason: the LEVEL OF CRAFT. Every pixel in an approved design was intentional, and the composition served THAT specific video's content. The approved examples are NOT templates to copy. The same craft, applied to different content, produces structurally different designs every time.

WHY EACH REJECTED DESIGN WAS REJECTED (do not repeat these mistakes):
${poolLosers.map((l, i) => `  ${i + 1}. "${l.title || 'untitled'}": ${l.reason}`).join('\n') || '  (none)'}

WHY EACH APPROVED DESIGN WORKS:
${poolWinners.map((w, i) => `  ${i + 1}. "${w.title || 'untitled'}": ${w.approved_reason || '(approved)'}`).join('\n') || '  (none)'}
`
    : '';

  const retryBlock = priorAttempt
    ? `
═══ YOUR PREVIOUS ATTEMPT WAS REJECTED ═══
Critic gave it ${priorAttempt.rating}/10. Verdict: ${priorAttempt.designer_verdict || '(none)'}
Problems: ${(priorAttempt.problems || []).slice(0, 4).join(' | ') || '(none)'}
Most important fix: ${priorAttempt.fix_instructions || '(none)'}

Make a STRUCTURALLY DIFFERENT design — not a tweak. Different composition, different focal hierarchy, different image idea.
`
    : '';

  const lockedHookBlock = lockedHook
    ? `
═══ LOCKED HOOK — DO NOT CHANGE THIS ═══
HOOK: "${lockedHook.winner}"
WHY: ${lockedHook.winner_reasoning}
WHAT MAKES THIS VIDEO INTERESTING: ${lockedHook.what_is_interesting || 'not specified'}

═══ REQUIRED IMAGE ═══
${lockedHook.likely_image || 'not specified'}

This is NOT a suggestion. Your job is NOT to write a different hook. Design the composition that makes this hook + this image hit as hard as possible.
`
    : '';

  const lockedMetaphorBlock = lockedMetaphor
    ? `
═══ LOCKED VISUAL METAPHOR ═══
METAPHOR: ${lockedMetaphor.winner.metaphor}
WHY: ${lockedMetaphor.winner_reasoning}

Use this image_request prompt as the basis for image_requests[0]:
"${lockedMetaphor.winner.image_prompt}"
source_hint: "${lockedMetaphor.winner.source_hint || 'ai'}"
`
    : '';

  return `You are a senior YouTube thumbnail designer who charges $500/thumbnail. You design freely. You are not given templates, layouts, or composition rules — you decide every pixel based on what the SPECIFIC video needs.
${visionBlock}${lockedHookBlock}${lockedMetaphorBlock}
═══ THE VIDEO ═══

TITLE: "${title}"
NICHE: ${niche || 'unknown'}
TONE: ${tone || 'unknown'}

SCRIPT (mine this for specific facts, dates, numbers, scenes — never invent generic dramatic words):
"""
${scriptExcerpt}
"""
${retryBlock}
═══ YOUR TASK ═══

Design a complete HTML5/CSS document. Whatever you write will be loaded into headless Chrome at 1280x720 and screenshotted as the final thumbnail. Use any modern CSS: flexbox, grid, gradients, blend modes, filters, transforms, mask, clip-path, drop-shadow, web fonts from Google Fonts.

There is no template. The composition should be designed for THIS video's specific content.

═══ TECHNICAL CONSTRAINTS ═══

1. Complete valid HTML5 document, no scripts, server-side rendering only.
2. Body is exactly 1280x720, no margin/padding/scroll.
3. To embed images, use placeholders \`{{IMG:1}}\`, \`{{IMG:2}}\` etc. They get substituted with real images you specify in image_requests. 0–3 images.
4. Google Fonts via @import or link is allowed.

═══ DESIGN PHILOSOPHY ═══

You are designing for a viewer who will see this thumbnail for 0.05 seconds while scrolling YouTube on their phone at 168x94 pixels. Everything you design must survive that context.

THE THUMBNAIL'S JOB IS TO IDENTIFY THE VIDEO.
A stranger who has never seen the title should guess the topic within 2 seconds.

ONE IMAGE, ONE HOOK, ONE STORY.
The strongest thumbnails share a structure: a single hero image fills the frame, and 1-3 words of hook text create the emotional punch. No banners, no badges, no secondary text, no decorative overlays.

THE HOOK MUST TRIGGER A FEELING, NOT DESCRIBE A FACT.
Strong hook patterns: impossible-sounding specifics, personal challenges, forbidden frames, stark contrasts. Weak patterns: raw numbers without verbs, vague descriptors, topic categories.

TEXT CRAFT:
- Text must be readable at 168x94. Below 36px it vanishes.
- Never grey text — use white, near-black, or saturated color.
- Set explicit letter-spacing (0.02-0.08em) and word-spacing (minimum 0.15em).
- Never negative letter-spacing.
- Give the hook breathing room — at least 40px from any edge.
- The hook is ONE color — never split across two colors.

═══ RETURN FORMAT — JSON ONLY ═══

{
  "primary_subject": "the one named entity the thumbnail visually depicts",
  "subject_is_person": true | false,
  "hook_text": "the hook text your design uses, for logging",
  "image_requests": [
    { "id": 1, "prompt": "specific, cinematic AI generation prompt OR Pexels search query", "source_hint": "ai" | "real", "purpose": "role in composition" }
  ],
  "html": "<!DOCTYPE html><html>...</html>",
  "why": "3-4 sentences explaining the design decision in plain English. Why this image? Why this hook? Why this composition?"
}`;
}

// ─── POOL LOADING ──────────────────────────────────────────────────────────────

function loadPoolEntriesWithImages(maxWinners = 4, maxLosers = 3) {
  const winners = [...loadWinners()].reverse();
  const losers = [...loadLosers()].reverse();
  const out = { winners: [], losers: [] };
  for (const w of winners) {
    if (out.winners.length >= maxWinners) break;
    if (!w.png_path || !fs.existsSync(w.png_path)) continue;
    try {
      const buf = fs.readFileSync(w.png_path);
      out.winners.push({ ...w, _bytes: buf });
    } catch (e) { /* skip */ }
  }
  for (const l of losers) {
    if (out.losers.length >= maxLosers) break;
    if (!l.png_path || !fs.existsSync(l.png_path)) continue;
    try {
      const buf = fs.readFileSync(l.png_path);
      out.losers.push({ ...l, _bytes: buf });
    } catch (e) { /* skip */ }
  }
  return out;
}

// ─── PLANNER ──────────────────────────────────────────────────────────────────

async function planThumbnail({ title, scriptText, niche, tone, priorAttempt, lockedHook = null, lockedMetaphor = null }) {
  const visionRefs = selectReferenceThumbnailImages(title, niche || 'education', 4);
  const pool = loadPoolEntriesWithImages(4, 3);

  if (visionRefs.length > 0) {
    console.log('  [VisionRefs] ' + visionRefs.length + ' niche references:');
    for (const r of visionRefs) {
      console.log(`    • ${String(r.views).padStart(12)} views — "${r.title.substring(0, 70)}"`);
    }
  }
  if (pool.winners.length > 0) {
    console.log('  [Pool] ' + pool.winners.length + ' winners (Niels-approved):');
    for (const w of pool.winners) console.log(`    ✓ "${(w.title || '').substring(0, 70)}"`);
  }
  if (pool.losers.length > 0) {
    console.log('  [Pool] ' + pool.losers.length + ' losers (Niels-rejected):');
    for (const l of pool.losers) console.log(`    ✗ "${(l.title || '').substring(0, 70)}" — ${l.reason.substring(0, 80)}`);
  }

  const prompt = buildPlannerPrompt({ title, scriptText, niche, tone, priorAttempt, visionRefs, poolWinners: pool.winners, poolLosers: pool.losers, lockedHook, lockedMetaphor });

  const content = [];
  for (const r of visionRefs) {
    try {
      const buf = fs.readFileSync(r.path);
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } });
    } catch (e) { /* skip */ }
  }
  for (const w of pool.winners) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: w._bytes.toString('base64') } });
  }
  for (const l of pool.losers) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: l._bytes.toString('base64') } });
  }
  content.push({ type: 'text', text: prompt });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content }],
  });
  const text = response.content[0].text;
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/, '');
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Planner returned no JSON');
  const plan = JSON.parse(m[0]);
  if (!plan.html) throw new Error('Planner returned no html field');
  plan._pool_winners_used = pool.winners.length;
  plan._pool_losers_used = pool.losers.length;
  return plan;
}

// ─── HTML REWRITING ────────────────────────────────────────────────────────────

function rewriteHtmlImages(html, imagePaths) {
  let out = html;
  for (const [id, p] of Object.entries(imagePaths)) {
    if (!p) continue;
    // Windows: file:///C:/path/to/file — three slashes, forward slashes
    const fileUrl = 'file:///' + p.replace(/\\/g, '/');
    out = out.replace(new RegExp('\\{\\{IMG:' + id + '\\}\\}', 'g'), fileUrl);
  }
  out = out.replace(/\{\{IMG:\d+\}\}/g, '');
  return out;
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

let _browser = null;
async function getBrowser() {
  if (_browser && _browser.connected) return _browser;
  _browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', '--disable-gpu',
      '--font-render-hinting=none',
    ],
  });
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (e) {}
    _browser = null;
  }
}

async function renderHtmlToPng(html, outPath, tempHtmlPath) {
  fs.writeFileSync(tempHtmlPath, html, 'utf-8');
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: CANVAS_W, height: CANVAS_H, deviceScaleFactor: 1 });
  // Windows: file:///C:/path/to/file.html (three slashes + forward slashes)
  const fileUri = 'file:///' + tempHtmlPath.replace(/\\/g, '/');
  await page.goto(fileUri, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H } });
  await page.close();
  return outPath;
}

// ─── CRITIC ───────────────────────────────────────────────────────────────────

async function reviewThumbnail(pngPath, title) {
  const buffer = fs.readFileSync(pngPath);
  const base64 = buffer.toString('base64');
  const pool = loadPoolEntriesWithImages(3, 0);
  const content = [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
  ];
  for (const w of pool.winners) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: w._bytes.toString('base64') } });
  }

  const referenceBlock = pool.winners.length > 0
    ? `\n\nThe ${pool.winners.length} additional images are real thumbnails Niels personally APPROVED. They are your calibration anchor — outputs that match their level of intentionality should rate 7+.\n\nApproved reference reasoning:\n${pool.winners.map((w, i) => `  ${i + 1}. "${w.title}": ${w.approved_reason}`).join('\n')}`
    : '';

  content.push({
    type: 'text',
    text: `You are reviewing a YouTube thumbnail for the video "${title}". The first image is the candidate to review.${referenceBlock}

Rate 1-10:
- 1-3: Has a hard defect (typo, unreadable text, wrong subject, looks broken)
- 4-5: Functional but forgettable, looks like a template
- 6: Decent — one good idea but execution has issues
- 7: Solid — same league as the approved reference thumbnails above
- 8-9: Excellent — would actually go on a real channel
- 10: Best-of-the-year tier

Be honest, not reflexively harsh. If the candidate is structurally as good as the reference winners, rate it 7+.

Hard defects that cap the rating at 4:
- Visible typos
- Text covering the focal subject of the image
- Subject identity is wrong
- Floating clip-art / emoji icons used as decoration
- Compositionally identical to a template (no specific design choices for THIS topic)

Return ONLY valid JSON:
{
  "rating": 1-10,
  "would_use_on_real_channel": true | false,
  "designer_verdict": "one sentence — what's good or bad about this specific design",
  "specific_problems": ["concrete defects, empty array if none"],
  "what_works": ["genuine wins, empty array if none"],
  "fix_instructions": "if rating < 7, the SINGLE most important thing to change"
}`,
  });

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content }],
  });
  const text = response.content[0].text;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { rating: 5, problems: ['parse failed'], strengths: [], fix_instructions: null };
  const parsed = JSON.parse(m[0]);
  return {
    rating: parsed.rating,
    designer_verdict: parsed.designer_verdict,
    problems: parsed.specific_problems || [],
    strengths: parsed.what_works || [],
    fix_instructions: parsed.fix_instructions || null,
    would_click: parsed.would_use_on_real_channel,
  };
}

// ─── LEGIBILITY CHECKS ────────────────────────────────────────────────────────

const SPELLING_WHITELIST = new Set([
  'b', 'm', 'k', 'tn', 'gb', 'tb', 'kb', 'pm', 'am', 'pst', 'est', 'utc',
  'wtf', 'omg', 'lol', 'ai', 'us', 'usa', 'uk', 'eu', 'un', 'ftc', 'cia', 'fbi', 'irs',
  'mph', 'kph', 'kg', 'lb', 'lbs', 'oz', 'cm', 'mm', 'km', 'ft',
  'mrbeast', 'spacex', 'tesla', 'nvidia', 'openai', 'youtube', 'facebook',
  '1st', '2nd', '3rd', '4th', '5th', '10th', '20th', '21st',
]);

const COMMON_WORDS = new Set([
  'a','about','above','accept','access','accident','according','account','across','act','action','actual','actually','add','addition','admit','advantage','advice','affect','after','again','against','age','ago','agree','agreement','ahead','aid','air','alarm','alarms','alert','alerts','alien','aliens','alive','all','allow','almost','alone','along','already','also','although','always','am','american','among','amount','an','analysis','ancient','and','animal','animals','announce','another','answer','any','anyone','anything','apart','appear','approach','are','area','argue','arm','arms','army','around','arrest','arrive','art','as','ask','at','attack','attempt','authority','available','average','avoid','away','awake','back','bad','balance','bank','base','be','because','become','been','before','begin','behind','being','believe','below','best','better','between','big','bigger','biggest','billion','billions','birth','bit','black','blood','blue','board','body','book','born','both','bottom','brain','break','breath','bring','broad','broke','broken','brother','build','building','built','burn','business','but','buy','by','call','came','can','cannot','car','care','carry','case','cash','cause','cell','center','central','century','certain','challenge','chance','change','charge','check','chemistry','child','children','choice','choose','city','civil','claim','clean','clear','climate','close','cold','collapse','complete','computer','concern','condition','confidence','consider','contain','continue','control','cost','could','count','country','course','cover','create','crime','crucial','current','cut','damage','danger','dangerous','dark','darkness','data','date','day','days','dead','deal','death','debate','decade','decide','decision','deep','degree','design','despite','detail','develop','development','did','die','died','difference','different','difficult','direct','direction','discover','disease','do','doctor','done','door','down','draw','dream','drive','drop','due','during','each','early','earn','earth','east','eat','economic','economy','edge','education','effect','effort','eight','either','election','element','else','end','enemy','energy','engine','english','enjoy','enough','enter','environment','equal','estimate','europe','even','evening','event','ever','every','everyone','everything','evidence','exactly','example','except','exist','expect','experience','explain','express','extra','extreme','eye','eyes','face','fact','factor','fail','failed','failure','fall','family','famous','far','fast','father','fear','feel','feeling','few','field','fifteen','fifty','fight','figure','fill','film','final','find','fire','first','five','flat','floor','flow','focus','follow','food','force','forces','foreign','forest','forever','forget','form','former','forty','forward','found','four','free','freedom','from','full','fund','future','gain','game','general','get','glass','go','god','gold','gone','good','got','government','great','green','grew','grey','ground','group','grow','growth','had','hair','half','hand','hands','happen','happened','hard','hate','have','having','he','head','health','hear','heard','heart','heat','heavy','held','help','her','here','herself','hide','high','higher','him','himself','his','history','historic','historical','hit','hold','hole','home','hope','hospital','hot','hotel','hour','hours','house','how','however','huge','human','humans','hundred','i','ice','idea','if','ill','image','imagine','immediate','impact','important','impossible','improve','in','income','incredible','independent','indicate','industry','influence','information','inside','instead','interest','international','internet','into','invest','involve','is','island','it','its','itself','job','join','judge','jump','just','keep','key','kill','killed','kind','know','knowledge','known','lady','lake','land','language','large','last','late','later','laugh','launch','law','lead','leader','leak','learn','least','leave','led','left','legal','less','let','level','lie','lied','life','light','like','likely','line','listen','little','live','lives','living','local','lock','long','look','lose','loss','lost','lot','love','low','machine','major','make','making','man','manage','many','mass','massive','matter','mean','meaning','means','medical','meet','member','memory','mental','might','million','millions','mind','minute','minutes','miss','missing','mission','mistake','model','modern','moment','money','month','months','moon','more','morning','most','mother','motion','mountain','move','movement','much','murder','must','my','myself','name','national','natural','nature','near','nearly','need','needs','never','new','news','next','night','nights','nine','no','nobody','none','nor','normal','north','not','nothing','notice','now','nuclear','number','obvious','occur','of','off','offer','office','officer','often','oh','oil','ok','old','on','once','one','only','open','opinion','opportunity','or','order','other','others','our','out','outside','over','own','paid','pain','paper','part','particular','partner','party','pass','past','pay','peace','people','per','percent','perform','perhaps','person','personal','pick','place','plan','planet','plant','play','please','point','police','political','poor','position','positive','possible','post','power','powerful','practice','present','press','pressure','price','prime','private','probably','problem','problems','process','produce','product','project','promise','protect','prove','provide','public','pull','purpose','push','put','quality','question','quick','quickly','quiet','race','rain','raise','ran','range','rate','reach','read','real','really','reason','recent','recently','record','red','reduce','reform','region','release','remain','remember','remove','report','require','research','resource','rest','result','return','reveal','review','rich','right','rise','risk','river','road','rock','role','run','safe','safety','same','saw','say','school','science','scientific','scientist','sea','second','secret','see','seem','seen','sell','sense','sent','series','serious','service','set','seven','several','severe','shall','she','ship','shock','should','show','side','sight','sign','silence','similar','simple','since','single','sit','situation','six','size','skill','sky','sleep','slow','small','smoke','snow','so','society','soft','solution','some','somebody','someone','something','sometimes','son','soon','sort','sound','source','south','space','speak','special','specific','speed','spend','spent','stand','star','start','state','stay','step','still','stone','stop','storm','story','strength','strike','strong','structure','success','such','sudden','suddenly','suggest','summer','sun','support','surface','survive','system','take','taken','talk','tall','tax','teach','teacher','team','technology','tell','temperature','ten','test','than','thank','that','the','their','them','themselves','then','theory','there','these','they','thing','think','third','thirty','this','those','thought','thousand','three','through','time','times','tiny','to','today','together','tomorrow','too','took','top','tough','toward','town','trade','train','travel','tree','tried','trouble','true','trust','truth','try','twenty','two','type','under','understand','unit','united','unless','until','up','use','used','usually','value','very','view','violence','voice','wait','walk','wall','want','war','warm','watch','water','wave','way','we','weapon','weather','week','weeks','well','went','what','when','where','whether','which','while','white','who','whole','why','wide','wife','win','wind','within','without','woman','women','wonder','word','work','world','worry','worst','would','wrong','year','years','yes','you','young','your','yourself','zero',
  // Philosophy / sleep-specific words common in SleepForge content
  'virtue','stoic','stoicism','wisdom','meditations','aurelius','marcus','seneca','epictetus','socrates','plato','aristotle','philosophy','philosopher','philosophers','ancient','greek','roman','emperor','eternal','consciousness','existence','mortality','contemplation','equanimity','temperance','justice','courage','reason','logos','pneuma','ataraxia','eudaimonia','apatheia',
]);

function extractVisibleText(html) {
  const noStyle = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  const noScript = noStyle.replace(/<script[\s\S]*?<\/script>/gi, '');
  const noTags = noScript.replace(/<[^>]+>/g, ' ');
  const decoded = noTags
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  return decoded.replace(/\s+/g, ' ').trim();
}

function looksLikeTypo(word) {
  if (word.length < 4 || word.length > 12) return false;
  const vowels = (word.match(/[aeiouy]/g) || []).length;
  if (vowels === 0) return true;
  if (/(.)\1\1/.test(word)) return true;
  return false;
}

function checkSpelling(html) {
  const text = extractVisibleText(html);
  if (!text) return [];
  const tokens = text.toLowerCase().match(/[a-z][a-z']*[a-z]|[a-z]/g) || [];
  const suspected = [];
  const seen = new Set();
  for (const tok of tokens) {
    if (seen.has(tok)) continue;
    seen.add(tok);
    if (tok.length <= 1) continue;
    if (COMMON_WORDS.has(tok)) continue;
    if (SPELLING_WHITELIST.has(tok)) continue;
    if (/^(it|that|there|don|isn|wasn|won|can|couldn|shouldn|wouldn|hasn|haven|hadn|aren|weren|i|you|he|she|we|they)'(s|t|d|ll|re|ve|m)$/.test(tok)) continue;
    if (looksLikeTypo(tok)) suspected.push(tok);
  }
  return suspected;
}

function checkHtmlLegibility(html) {
  const violations = [];
  const fontSizeMatches = [...html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*(px|rem|em)/gi)];
  for (const m of fontSizeMatches) {
    let pxValue = parseFloat(m[1]);
    if (m[2] === 'rem' || m[2] === 'em') pxValue *= 16;
    if (pxValue < 36) {
      violations.push(`text font-size ${pxValue}px is below 36px minimum`);
    }
  }
  const colorMatches = [...html.matchAll(/color\s*:\s*(#[0-9a-f]{3,6}|rgba?\([^)]+\))/gi)];
  for (const m of colorMatches) {
    const c = m[1].toLowerCase();
    if (c.startsWith('#')) {
      let hex = c.slice(1);
      if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
      if (hex.length !== 6) continue;
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max - min < 25 && max >= 70 && max <= 220) {
        violations.push(`text color ${c} is grey — use white/dark/saturated accent only`);
      }
    } else if (c.startsWith('rgb')) {
      const nums = c.match(/\d+(?:\.\d+)?/g);
      if (nums && nums.length >= 3) {
        const r = +nums[0], g = +nums[1], b = +nums[2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max - min < 25 && max >= 70 && max <= 220) {
          violations.push(`text color ${c} is grey — use white/dark/saturated accent only`);
        }
      }
    }
  }
  if (/transform\s*:[^;]*rotate/i.test(html)) {
    violations.push(`text uses transform: rotate — rotated text vanishes at mobile scale`);
  }
  const letterSpacingMatches = [...html.matchAll(/letter-spacing\s*:\s*(-?\d+(?:\.\d+)?)\s*(px|em|rem)/gi)];
  for (const m of letterSpacingMatches) {
    if (parseFloat(m[1]) < 0) {
      violations.push(`negative letter-spacing (${m[0]}) — letters mush together at mobile scale`);
    }
  }
  const textOnly = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ');
  if (/[∞∑∫ℵπ∂∇√≠≤≥±]/.test(textOnly) && /[=+\-×÷]/.test(textOnly)) {
    violations.push(`text contains a math equation/symbol — hooks must be plain English words`);
  }
  const bigFontMatches = [...html.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)\s*px/gi)];
  const hasBigHookText = bigFontMatches.some(m => parseFloat(m[1]) >= 80);
  if (hasBigHookText && !/word-spacing\s*:/i.test(html)) {
    violations.push(`large hook text (>=80px) found but no word-spacing declared — set word-spacing >= 0.15em`);
  }
  const suspectedTypos = checkSpelling(html);
  if (suspectedTypos.length > 0) {
    for (const t of suspectedTypos.slice(0, 5)) {
      violations.push(`possible typo: "${t.toUpperCase()}" (no vowels or weird consonant cluster)`);
    }
  }
  return { ok: violations.length === 0, violations };
}

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

export async function generateThumbnailV3({
  outputDir,
  title,
  scriptText = '',
  niche = 'philosophy',
  tone = 'calm, meditative, philosophical',
  _attempt = 1,
  _priorAttempt = null,
  _lockedHook = null,
  _lockedMetaphor = null,
}) {
  console.log('============================================================');
  console.log('SleepForge Thumbnail v3 (HTML/CSS)' + (_attempt > 1 ? ` — RETRY ${_attempt}/${MAX_ATTEMPTS}` : ''));
  console.log('============================================================');
  console.log('  Title: ' + title);
  console.log('  Niche: ' + niche);
  console.log('  Script: ' + (scriptText ? `${scriptText.length} chars` : 'none'));

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Step 0: Hook writer
  let lockedHook = _lockedHook;
  if (!lockedHook) {
    console.log('\n--- Step 0: Hook writer (5 candidates → pick strongest) ---');
    try {
      lockedHook = await generateHookCandidates({ title, scriptText, niche, tone });
      console.log('  Candidates:');
      for (const c of (lockedHook.candidates || [])) {
        console.log(`    "${c.hook}" — clarity:${c.clarity} promise:${c.promise} emotion:${c.emotion} total:${c.total}`);
      }
      console.log('  WINNER: "' + lockedHook.winner + '"');
      console.log('  Why: ' + lockedHook.winner_reasoning);
      fs.writeFileSync(path.join(outputDir, 'thumbnail-v3-hook.json'), JSON.stringify(lockedHook, null, 2));
    } catch (e) {
      console.log('  [Hook writer] Failed: ' + e.message + ' — falling back to single-pass planner');
      lockedHook = null;
    }
  }

  // Step 0.4: Topic concreteness classifier
  let topicClass = null;
  if (lockedHook) {
    console.log('\n--- Step 0.4: Topic concreteness classifier ---');
    topicClass = await classifyTopicConcreteness({ title, scriptText, niche });
    console.log('  is_abstract: ' + topicClass.is_abstract + ' (subject: ' + (topicClass.subject || 'none') + ')');
    console.log('  reason: ' + topicClass.reason);
    fs.writeFileSync(path.join(outputDir, 'thumbnail-v3-topicclass.json'), JSON.stringify(topicClass, null, 2));
  }

  // Step 0.5: Visual metaphor brainstorm (abstract topics only)
  let lockedMetaphor = _lockedMetaphor;
  const shouldBrainstormMetaphor = !lockedMetaphor && lockedHook && (topicClass?.is_abstract !== false);
  if (!shouldBrainstormMetaphor && !lockedMetaphor) {
    console.log('\n--- Step 0.5: Skipping metaphor brainstorm — topic is CONCRETE (subject: ' + (topicClass?.subject || 'unknown') + ') ---');
  }
  if (shouldBrainstormMetaphor) {
    console.log('\n--- Step 0.5: Visual metaphor brainstorm (5 candidates → pick strongest) ---');
    try {
      lockedMetaphor = await generateImageMetaphors({ title, scriptText, niche, tone, lockedHook });
      console.log('  Metaphor candidates:');
      for (const c of (lockedMetaphor.candidates || [])) {
        const total = (c.surprise || 0) + (c.emotional_impact || 0) + (c.specificity || 0) + (c.hook_coherence || 0);
        console.log(`    s:${c.surprise} e:${c.emotional_impact} sp:${c.specificity} hc:${c.hook_coherence} = ${total} → "${(c.metaphor || '').substring(0, 80)}"`);
      }
      const winner = lockedMetaphor.winner;
      console.log('  WINNER: ' + (winner?.metaphor || 'unknown'));
      console.log('  Why: ' + lockedMetaphor.winner_reasoning);
      fs.writeFileSync(path.join(outputDir, 'thumbnail-v3-metaphor.json'), JSON.stringify(lockedMetaphor, null, 2));
    } catch (e) {
      console.log('  [Metaphor brainstorm] Failed: ' + e.message + ' — design pass will pick image freely');
      lockedMetaphor = null;
    }
  }

  // Step 1: Plan
  console.log('\n--- Step 1: Claude designs the thumbnail (full HTML/CSS) ---');
  const plan = await planThumbnail({ title, scriptText, niche, tone, priorAttempt: _priorAttempt, lockedHook, lockedMetaphor });
  plan.title = title;
  plan.niche = niche;
  plan._attempt = _attempt;
  console.log('  Subject: ' + plan.primary_subject);
  console.log('  Hook: ' + plan.hook_text);
  console.log('  Image requests: ' + (plan.image_requests || []).length);
  for (const req of (plan.image_requests || [])) {
    console.log(`    [${req.id}] ${req.source_hint || 'ai'}: ${(req.prompt || '').substring(0, 80)}`);
  }
  console.log('  HTML size: ' + plan.html.length + ' chars');
  fs.writeFileSync(path.join(outputDir, 'thumbnail-v3-plan.json'), JSON.stringify(plan, null, 2));

  // Step 2: Resolve images
  console.log('\n--- Step 2: Fetching images ---');
  const imagePaths = {};
  for (const req of (plan.image_requests || [])) {
    const localPath = await resolveImageRequest(req, `img-${req.id}`, outputDir);
    if (localPath) imagePaths[req.id] = localPath;
  }

  // Step 3: Rewrite HTML + legibility check + render
  console.log('\n--- Step 3: Render via headless Chrome ---');
  const rewritten = rewriteHtmlImages(plan.html, imagePaths);
  const htmlPath = path.join(outputDir, 'thumbnail-v3.html');
  const pngPath = path.join(outputDir, 'thumbnail.png');

  const legibility = checkHtmlLegibility(rewritten);
  if (!legibility.ok) {
    console.log('  ⚠️  Legibility violations:');
    for (const v of legibility.violations) console.log('    ✗ ' + v);
  }

  try {
    await renderHtmlToPng(rewritten, pngPath, htmlPath);
    const sizeKB = Math.round(fs.statSync(pngPath).size / 1024);
    console.log('  Saved: ' + pngPath + ' (' + sizeKB + ' KB)');
  } catch (e) {
    console.log('  ✗ Render failed: ' + e.message);
    throw e;
  }

  // Step 5: Critic
  console.log('\n--- Step 5: Harsh designer critic ---');
  const review = await reviewThumbnail(pngPath, title);
  console.log('  Critic rating: ' + review.rating + '/10');
  if (review.designer_verdict) console.log('  Designer verdict: ' + review.designer_verdict);
  if (review.problems.length > 0) {
    console.log('  Problems:');
    for (const p of review.problems) console.log('    - ' + p);
  }

  // Apply legibility penalties
  if (!legibility.ok) {
    const hasHardViolation = legibility.violations.some(v =>
      /font-size .* below 36px/.test(v) || /typo/i.test(v) || /negative letter-spacing/.test(v) || /math equation/.test(v));
    const hasSoftViolation = legibility.violations.some(v =>
      /transform: rotate/.test(v) || /grey/i.test(v) || /no word-spacing declared/.test(v));
    if (hasHardViolation) {
      review.rating = Math.min(review.rating, 4);
    } else if (hasSoftViolation) {
      review.rating = Math.max(1, review.rating - 2);
    }
    review.problems = [...review.problems, ...legibility.violations.map(v => 'LEGIBILITY: ' + v)];
    review._legibility_violations = legibility.violations;
  }

  fs.writeFileSync(path.join(outputDir, 'thumbnail-v3-review.json'), JSON.stringify(review, null, 2));

  if (review.rating >= PASS_THRESHOLD) {
    console.log('\n✅ PASSED designer review (' + review.rating + '/10) on attempt ' + _attempt);
    return pngPath;
  }

  if (_attempt < MAX_ATTEMPTS) {
    console.log('\n⚠️  Below threshold (' + review.rating + '/10). Retrying...');
    const archDir = path.join(outputDir, `attempt-${_attempt}`);
    fs.mkdirSync(archDir, { recursive: true });
    fs.copyFileSync(pngPath, path.join(archDir, 'thumbnail.png'));
    fs.copyFileSync(path.join(outputDir, 'thumbnail-v3-plan.json'), path.join(archDir, 'thumbnail-v3-plan.json'));
    fs.copyFileSync(path.join(outputDir, 'thumbnail-v3-review.json'), path.join(archDir, 'thumbnail-v3-review.json'));
    return generateThumbnailV3({ outputDir, title, scriptText, niche, tone, _attempt: _attempt + 1, _priorAttempt: review, _lockedHook: lockedHook, _lockedMetaphor: lockedMetaphor });
  }

  console.log('\n⚠️  Out of retries. Promoting best of attempts.');
  let best = { rating: review.rating, path: pngPath };
  for (let a = 1; a < _attempt; a++) {
    try {
      const arev = JSON.parse(fs.readFileSync(path.join(outputDir, `attempt-${a}`, 'thumbnail-v3-review.json'), 'utf-8'));
      if ((arev.rating || 0) > best.rating) {
        best = { rating: arev.rating, path: path.join(outputDir, `attempt-${a}`, 'thumbnail.png') };
      }
    } catch (e) { /* skip */ }
  }
  if (best.path !== pngPath) {
    console.log('  Best attempt was ' + best.rating + '/10 — promoting it');
    fs.copyFileSync(best.path, pngPath);
  }
  return pngPath;
}
