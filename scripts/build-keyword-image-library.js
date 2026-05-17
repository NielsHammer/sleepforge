/**
 * build-keyword-image-library.js
 *
 * Tasks:
 *   TASK 2a: Generate 10 Flux prompts per keyword via Haiku (500 total)
 *   TASK 2b: Generate 500 images via Fal.ai Flux Schnell (~$1.52)
 *   TASK 2c: Build assets/images/space-keyword-library/index.json
 *   TASK 3:  Retag assets/images/space-library-v1/index.json with keyword_tags
 *
 * Usage: node scripts/build-keyword-image-library.js [--skip-images] [--skip-retag]
 *
 * Flags:
 *   --skip-images   Skip Fal.ai generation (prompts only)
 *   --skip-retag    Skip retagging space-library-v1
 *   --keyword <kw>  Only process this one keyword (for testing)
 */

import 'dotenv/config';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { callClaudeCLI } from '../src/claude-cli.js';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const KEYWORDS_PATH    = path.join(PROJECT_ROOT, 'data', 'space-keywords.json');
const PROMPTS_OUT      = path.join(PROJECT_ROOT, 'data', 'space-keywords-prompts.json');
const KW_LIB_DIR       = path.join(PROJECT_ROOT, 'assets', 'images', 'space-keyword-library');
const KW_LIB_INDEX     = path.join(KW_LIB_DIR, 'index.json');
const SPACE_LIB_INDEX  = path.join(PROJECT_ROOT, 'assets', 'images', 'space-library-v1', 'index.json');
const SPACE_PROMPTS    = path.join(PROJECT_ROOT, 'data', 'space-prompts.json');

const HAIKU  = 'claude-haiku-4-5-20251001';
const FAL_KEY = process.env.FAL_KEY;
const FLUX_URL = 'https://fal.run/fal-ai/flux/schnell';

const STYLE_ANCHOR = 'cinematic photorealistic 4K, dramatic lighting, deep moody atmosphere, hyper-detailed, awe-inspiring scale, sleep-friendly calm tone, dark backgrounds with rich color accents, Hubble/JWST telescope aesthetic, no text, no labels, no humans in modern clothing, no UFO/alien speculation';

const args = process.argv.slice(2);
const SKIP_IMAGES = args.includes('--skip-images');
const SKIP_RETAG  = args.includes('--skip-retag');
const ONLY_KW     = args.includes('--keyword') ? args[args.indexOf('--keyword') + 1] : null;

const t_start = Date.now();
function log(msg) { console.log(msg); }
function elapsed() { return Math.round((Date.now() - t_start) / 1000); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Load keywords ─────────────────────────────────────────────────────────
const KEYWORDS = JSON.parse(fs.readFileSync(KEYWORDS_PATH, 'utf-8'));
const keywords = ONLY_KW ? KEYWORDS.filter(k => k.keyword === ONLY_KW) : KEYWORDS;
log(`═══════════════════════════════════════════════════════════`);
log(`SleepForge — Keyword Image Library Builder`);
log(`Keywords: ${keywords.length}   Images per keyword: 10   Total: ${keywords.length * 10}`);
log(`Skip images: ${SKIP_IMAGES}   Skip retag: ${SKIP_RETAG}`);
log(`═══════════════════════════════════════════════════════════`);

// ─── TASK 2a: Generate prompts ─────────────────────────────────────────────
log('\n── Task 2a: Generate 10 prompts per keyword (Haiku) ──');
let allPrompts = [];

if (fs.existsSync(PROMPTS_OUT)) {
  allPrompts = JSON.parse(fs.readFileSync(PROMPTS_OUT, 'utf-8'));
  log(`  Loaded ${allPrompts.length} cached prompts`);
}

const alreadyHaveKws = new Set(allPrompts.map(p => p.keyword));

for (const kw of keywords) {
  if (alreadyHaveKws.has(kw.keyword)) {
    log(`  ${kw.keyword}: cached (10 prompts)`);
    continue;
  }

  log(`  Generating: ${kw.keyword}...`);
  const prompt = `Generate exactly 10 visually distinct Flux image prompts for the astronomy subject: "${kw.keyword}"

Requirements:
- Each prompt must start with the style anchor (copy verbatim): "${STYLE_ANCHOR} —"
- After the dash, describe a specific visual scene
- 10 prompts must differ in: composition, lighting, color treatment, mood, and viewing angle
- Variations: close-up / wide shot / unique angle / eclipse-style / backlit / monochrome accent / dramatic / soft / warm / cool
- No text, labels, humans in modern clothing, UFOs, or aliens
- Each prompt 40-80 words total

Aliases for this keyword (may inspire scene ideas): ${kw.aliases.join(', ')}

Return ONLY a JSON array of 10 objects, no other text:
[
  {"variant": 1, "flux_prompt": "..."},
  {"variant": 2, "flux_prompt": "..."},
  ...
]`;

  try {
    const text = await callClaudeCLI(prompt, { model: HAIKU, timeoutMs: 90000 });
    const parsed = JSON.parse(text.trim().match(/\[[\s\S]*\]/)?.[0] || text.trim());

    for (const item of parsed.slice(0, 10)) {
      const variant = item.variant || (parsed.indexOf(item) + 1);
      const id = `${kw.keyword.replace(/\s+/g, '-')}-${String(variant).padStart(3, '0')}`;
      allPrompts.push({
        id,
        keyword: kw.keyword,
        variant,
        flux_prompt: item.flux_prompt,
      });
    }
    alreadyHaveKws.add(kw.keyword);
    fs.writeFileSync(PROMPTS_OUT, JSON.stringify(allPrompts, null, 2));
    await sleep(200);
  } catch (err) {
    log(`  ERROR generating prompts for ${kw.keyword}: ${err.message}`);
  }
}
log(`  Total prompts: ${allPrompts.length}`);

// ─── TASK 2b: Generate images via Fal.ai ─────────────────────────────────
if (!SKIP_IMAGES) {
  log('\n── Task 2b: Generate images via Fal.ai Flux Schnell ──');
  if (!FAL_KEY) {
    log('  ERROR: FAL_KEY not set — skipping image generation');
  } else {
    let generated = 0, skipped = 0, errors = 0;

    for (const entry of allPrompts) {
      if (ONLY_KW && entry.keyword !== ONLY_KW) continue;

      const kwDir = path.join(KW_LIB_DIR, entry.keyword.replace(/\s+/g, '-'));
      fs.mkdirSync(kwDir, { recursive: true });
      const imgPath = path.join(kwDir, `${entry.id}.jpg`);

      if (fs.existsSync(imgPath)) {
        skipped++;
        continue;
      }

      let attempts = 0;
      let success = false;
      while (attempts < 4 && !success) {
        try {
          const resp = await axios.post(FLUX_URL, {
            prompt: entry.flux_prompt,
            image_size: 'landscape_16_9',
            num_images: 1,
            num_inference_steps: 4,
            enable_safety_checker: false,
          }, {
            headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' },
            timeout: 120000,
          });
          const imgUrl = resp.data.images[0].url;
          const imgResp = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 60000 });
          fs.writeFileSync(imgPath, Buffer.from(imgResp.data));
          generated++;
          success = true;
          const total = allPrompts.filter(p => !ONLY_KW || p.keyword === ONLY_KW).length;
          const done = generated + skipped;
          const pct = Math.round(100 * done / total);
          process.stdout.write(`\r  [${done}/${total}] ${pct}% — ${entry.keyword} — ${entry.id}          `);
        } catch (err) {
          attempts++;
          const isTransient = err.code === 'ETIMEDOUT' || err.response?.status >= 500 || err.response?.status === 429;
          if (attempts < 4 && isTransient) {
            await sleep(Math.min(2000 * 2 ** attempts, 16000));
          } else {
            log(`\n  ERROR ${entry.id}: ${err.message}`);
            errors++;
            break;
          }
        }
      }
    }
    console.log(`\n  Generated: ${generated}   Skipped: ${skipped}   Errors: ${errors}`);
  }
}

// ─── TASK 2c: Build keyword library index ────────────────────────────────
log('\n── Task 2c: Build keyword library index ──');
const kwIndexData = { keywords: {} };

for (const kw of KEYWORDS) {
  const kwSlug = kw.keyword.replace(/\s+/g, '-');
  const kwDir  = path.join(KW_LIB_DIR, kwSlug);
  const images = fs.existsSync(kwDir)
    ? fs.readdirSync(kwDir).filter(f => /\.(jpg|png|webp)$/i.test(f))
        .sort()
        .map(f => `assets/images/space-keyword-library/${kwSlug}/${f}`)
    : [];

  kwIndexData.keywords[kw.keyword] = {
    priority:  kw.priority,
    category:  kw.category,
    aliases:   kw.aliases,
    visual_specificity: kw.visual_specificity,
    images,
  };
}

fs.mkdirSync(KW_LIB_DIR, { recursive: true });
fs.writeFileSync(KW_LIB_INDEX, JSON.stringify(kwIndexData, null, 2));
const totalImages = Object.values(kwIndexData.keywords).reduce((s, v) => s + v.images.length, 0);
log(`  Index written: ${totalImages} images across ${Object.keys(kwIndexData.keywords).length} keywords`);

// ─── TASK 3: Retag space-library-v1 ──────────────────────────────────────
if (!SKIP_RETAG) {
  log('\n── Task 3: Retag space-library-v1 index.json ──');

  if (!fs.existsSync(SPACE_LIB_INDEX)) {
    log('  ERROR: space-library-v1/index.json not found');
  } else {
    const spaceLib = JSON.parse(fs.readFileSync(SPACE_LIB_INDEX, 'utf-8'));

    // Build lookup: primary_subject / tag → keyword
    // Map normalized subjects/tags to canonical keywords
    const SUBJECT_TO_KW = {};
    for (const kw of KEYWORDS) {
      const kwLower = kw.keyword.toLowerCase();
      SUBJECT_TO_KW[kwLower] = kw.keyword;
      for (const alias of (kw.aliases || [])) {
        SUBJECT_TO_KW[alias.toLowerCase()] = kw.keyword;
      }
    }

    // Also map common space-prompts subjects to keywords
    const MANUAL_MAP = {
      'black-hole': 'black hole',
      'black hole': 'black hole',
      'neutron-star': 'neutron star',
      'neutron star': 'neutron star',
      'gas-giant': 'jupiter',
      'gas giant': 'jupiter',
      'solar-system': 'solar system',
      'cosmic-web': 'cosmic web',
      'cosmic web': 'cosmic web',
      'spiral-galaxy': 'spiral galaxy',
      'galaxy-cluster': 'galaxy cluster',
      'galaxy-merger': 'galaxy merger',
      'star-formation': 'star formation',
      'deep-space': null,  // too generic → general_space
      'stellar': null,
      'stellar-remnant': null,
      'stellar-death': 'supernova',
      'stellar-explosion': 'supernova',
      'accretion-disk': 'accretion disk',
      'event-horizon': 'black hole',
      'gravitational-lensing': 'gravitational lensing',
      'pulsar': 'pulsar',
      'magnetar': 'magnetar',
      'white-dwarf': 'white dwarf',
      'red-giant': 'red giant',
      'binary-star': 'binary star',
      'globular-cluster': 'globular cluster',
      'planetary-rings': 'planetary rings',
      'planetary-nebula': 'nebula',
      'emission-nebula': 'nebula',
      'supernova-remnant': 'supernova',
      'protoplanetary-disk': 'protoplanetary disk',
      'protostar': 'star formation',
      'molecular-cloud': 'star formation',
      'large-scale-structure': 'cosmic web',
      'tidal-tails': 'galaxy merger',
      'deep-field': 'deep field',
      'great-red-spot': 'jupiter',
      'cassini-division': 'saturn',
    };

    function tagEntry(entry) {
      const tags = new Set();
      const subjects = [
        entry.primary_subject,
        ...(entry.tags || []),
        entry.category,
      ].filter(Boolean).map(s => s.toLowerCase().replace(/_/g, '-'));

      for (const sub of subjects) {
        // Direct manual map
        if (MANUAL_MAP[sub] !== undefined) {
          if (MANUAL_MAP[sub]) tags.add(MANUAL_MAP[sub]);
          continue;
        }
        // Subject-to-keyword lookup
        const normalized = sub.replace(/-/g, ' ');
        if (SUBJECT_TO_KW[normalized]) { tags.add(SUBJECT_TO_KW[normalized]); continue; }
        if (SUBJECT_TO_KW[sub]) { tags.add(SUBJECT_TO_KW[sub]); continue; }
      }

      const result = [...tags].filter(Boolean);
      return result.length > 0 ? result : ['general_space'];
    }

    let taggedCount = 0;
    let generalCount = 0;
    for (const entry of spaceLib) {
      entry.keyword_tags = tagEntry(entry);
      if (entry.keyword_tags[0] === 'general_space') generalCount++;
      else taggedCount++;
    }

    fs.writeFileSync(SPACE_LIB_INDEX, JSON.stringify(spaceLib, null, 2));
    log(`  Tagged: ${taggedCount} images → keywords   ${generalCount} → general_space`);

    // Show distribution
    const dist = {};
    for (const e of spaceLib) {
      for (const t of e.keyword_tags) dist[t] = (dist[t] || 0) + 1;
    }
    const top = Object.entries(dist).sort((a,b)=>b[1]-a[1]).slice(0, 15);
    log('  Top tags:');
    top.forEach(([k,v]) => log(`    ${v.toString().padStart(3)}  ${k}`));
  }
}

// ─── Done ─────────────────────────────────────────────────────────────────
const totalSec = elapsed();
log('\n═══════════════════════════════════════════════════════════');
log('✅ DONE — Keyword image library built');
log(`   Prompts file:   ${PROMPTS_OUT}`);
log(`   Keyword index:  ${KW_LIB_INDEX}`);
log(`   Total time:     ${Math.floor(totalSec/60)}m ${totalSec%60}s`);
log('═══════════════════════════════════════════════════════════');
