/**
 * keyword-matcher.js — Semantic image matching for Sleepless Astronomer.
 *
 * Given a short script segment (~5 seconds), scans for any of the 50 space
 * keywords (plus their aliases), picks the highest-scoring match, and returns
 * an image path from the matching keyword's pool.
 *
 * Scoring:
 *   keyword priority (1-10) × visual_specificity multiplier
 *   + recency bonus (earlier in segment = more likely what the listener expects)
 *   + exact keyword match > alias match
 *
 * Image selection:
 *   - Keyword library (assets/images/space-keyword-library/) preferred
 *   - Falls back to space-library-v1 using keyword_tags
 *   - Tracks used images across the render to avoid repeats
 *   - Avoids same keyword pool twice within COOLDOWN_CLIPS clips
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

const KEYWORD_LIBRARY_INDEX = path.join(PROJECT_ROOT, "assets", "images", "space-keyword-library", "index.json");
const SPACE_LIBRARY_INDEX   = path.join(PROJECT_ROOT, "assets", "images", "space-library-v1", "index.json");
const KEYWORDS_PATH         = path.join(PROJECT_ROOT, "data", "space-keywords.json");

const VISUAL_SPECIFICITY_MULT = { high: 1.2, medium: 1.0, low: 0.7 };
const COOLDOWN_CLIPS = 8;

// ─── Load data ───────────────────────────────────────────────────────────────

let _keywords = null;
function loadKeywords() {
  if (_keywords) return _keywords;
  _keywords = JSON.parse(fs.readFileSync(KEYWORDS_PATH, "utf-8"));
  return _keywords;
}

let _kwIndex = null;
function loadKeywordIndex() {
  if (_kwIndex !== null) return _kwIndex;
  if (!fs.existsSync(KEYWORD_LIBRARY_INDEX)) { _kwIndex = null; return null; }
  _kwIndex = JSON.parse(fs.readFileSync(KEYWORD_LIBRARY_INDEX, "utf-8"));
  return _kwIndex;
}

let _spaceLib = null;
function loadSpaceLibrary() {
  if (_spaceLib !== null) return _spaceLib;
  if (!fs.existsSync(SPACE_LIBRARY_INDEX)) { _spaceLib = []; return []; }
  _spaceLib = JSON.parse(fs.readFileSync(SPACE_LIBRARY_INDEX, "utf-8"));
  return _spaceLib;
}

// ─── Matching ────────────────────────────────────────────────────────────────

// Build a word-boundary regex for a phrase (handles multi-word aliases)
function makePattern(phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, "gi");
}

// Pre-compile patterns for all keywords + aliases
let _patterns = null;
function getPatterns() {
  if (_patterns) return _patterns;
  const keywords = loadKeywords();
  _patterns = keywords.map(kw => {
    const all = [kw.keyword, ...(kw.aliases || [])];
    return {
      kw,
      patterns: all.map(phrase => ({ phrase, rx: makePattern(phrase), isAlias: phrase !== kw.keyword })),
    };
  });
  return _patterns;
}

/**
 * Scan segment text for keyword matches. Returns array of:
 * { keyword, score, matchPhrase, position, isAlias }
 * sorted by score descending.
 */
function scanSegment(text) {
  const lower = text.toLowerCase();
  const wordCount = lower.split(/\s+/).length;
  const results = [];

  for (const { kw, patterns } of getPatterns()) {
    const specMult = VISUAL_SPECIFICITY_MULT[kw.visual_specificity] || 1.0;
    let bestScore = 0;
    let bestPhrase = null;
    let bestPosition = 1.0; // normalized 0–1 (0 = start of segment)
    let bestIsAlias = false;

    for (const { phrase, rx, isAlias } of patterns) {
      const matches = [...lower.matchAll(rx)];
      for (const m of matches) {
        // Position: word index of match start (approximate)
        const charsBeforeMatch = m.index;
        const approxWordPos = lower.slice(0, charsBeforeMatch).split(/\s+/).length / Math.max(1, wordCount);
        // Earlier = higher recency bonus (0 = start, 1 = end)
        const recencyBonus = (1 - approxWordPos) * 2;
        const baseScore = kw.priority * specMult + recencyBonus + (isAlias ? 0 : 1.5);
        if (baseScore > bestScore) {
          bestScore = baseScore;
          bestPhrase = phrase;
          bestPosition = approxWordPos;
          bestIsAlias = isAlias;
        }
      }
    }

    if (bestScore > 0) {
      results.push({
        keyword: kw.keyword,
        priority: kw.priority,
        category: kw.category,
        score: bestScore,
        matchPhrase: bestPhrase,
        position: bestPosition,
        isAlias: bestIsAlias,
      });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

// ─── Image selection ─────────────────────────────────────────────────────────

/**
 * Pick a random unused image from the keyword pool.
 * Prefers keyword library; falls back to tagged space-library-v1 entries;
 * falls back further to any space-library-v1 image with "general_space" tag.
 *
 * state: { usedImages: Set<string>, recentKeywords: string[] }
 */
function pickImage(keyword, state) {
  const usedImages = state.usedImages;

  // Try keyword library first
  const kwIndex = loadKeywordIndex();
  if (kwIndex && kwIndex.keywords && kwIndex.keywords[keyword]) {
    const images = kwIndex.keywords[keyword].images || [];
    const unused = images.filter(p => !usedImages.has(p));
    if (unused.length > 0) {
      return unused[Math.floor(Math.random() * unused.length)];
    }
  }

  // Try space-library-v1 with matching keyword_tags
  const spaceLib = loadSpaceLibrary();
  const tagged = spaceLib.filter(e =>
    e.keyword_tags && e.keyword_tags.includes(keyword) && !usedImages.has(e.path)
  );
  if (tagged.length > 0) {
    return tagged[Math.floor(Math.random() * tagged.length)].path;
  }

  // Fallback: any image from space-library-v1 not already used
  const fallback = spaceLib.filter(e => !usedImages.has(e.path));
  if (fallback.length > 0) {
    return fallback[Math.floor(Math.random() * fallback.length)].path;
  }

  // Last resort: return any space-library image regardless of used status
  if (spaceLib.length > 0) {
    return spaceLib[Math.floor(Math.random() * spaceLib.length)].path;
  }

  return null;
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Create a fresh matcher state object. Pass to matchImage() across all clips
 * in a single render to maintain no-repeat and cooldown tracking.
 */
export function createMatcherState() {
  return {
    usedImages: new Set(),
    recentKeywords: [],  // ring buffer of last COOLDOWN_CLIPS keyword names
    clipCount: 0,
  };
}

/**
 * For a given segment of narration text, find the best keyword match and
 * return an appropriate image.
 *
 * Returns:
 * {
 *   image_path: string | null,
 *   keyword_matched: string | null,
 *   match_score: number,
 *   match_phrase: string | null,
 *   fallback_used: boolean,
 *   all_matches: [...],
 * }
 */
export function matchImage(segmentText, state) {
  const matches = scanSegment(segmentText);

  // Apply cooldown: skip keywords used recently (within COOLDOWN_CLIPS clips)
  const available = matches.filter(m => {
    const recentIdx = state.recentKeywords.lastIndexOf(m.keyword);
    return recentIdx === -1 || (state.clipCount - recentIdx) > COOLDOWN_CLIPS;
  });

  // Pick the best available match, or best match ignoring cooldown if nothing is available
  const chosen = available[0] || matches[0];

  let imagePath = null;
  let fallbackUsed = false;

  if (chosen) {
    imagePath = pickImage(chosen.keyword, state);
    if (!imagePath) {
      // No image for this keyword at all — pick general fallback
      fallbackUsed = true;
      const spaceLib = loadSpaceLibrary();
      const unused = spaceLib.filter(e => !state.usedImages.has(e.path));
      imagePath = (unused[Math.floor(Math.random() * unused.length)] || spaceLib[0])?.path || null;
    }
  } else {
    // No keyword matched — use general space library
    fallbackUsed = true;
    const spaceLib = loadSpaceLibrary();
    const unused = spaceLib.filter(e => !state.usedImages.has(e.path));
    imagePath = (unused[Math.floor(Math.random() * unused.length)] || spaceLib[0])?.path || null;
  }

  // Update state
  if (imagePath) state.usedImages.add(imagePath);
  if (chosen) {
    state.recentKeywords.push(chosen.keyword);
    if (state.recentKeywords.length > COOLDOWN_CLIPS * 2) state.recentKeywords.shift();
  }
  state.clipCount++;

  return {
    image_path: imagePath,
    keyword_matched: chosen?.keyword || null,
    match_score: chosen?.score || 0,
    match_phrase: chosen?.matchPhrase || null,
    fallback_used: fallbackUsed,
    all_matches: matches.slice(0, 5),
  };
}

/**
 * Estimate "energy" of a segment for clip duration variation.
 * Returns: { target_seconds: number, energy: "calm"|"neutral"|"emphatic" }
 *
 * Calm segments (long, flowing, descriptive) → longer clip (5-6s)
 * Emphatic segments (facts, numbers, short punchy sentences) → shorter clip (3-4s)
 */
export function estimateSegmentEnergy(text, minSec = 3, maxSec = 6) {
  const words = text.trim().split(/\s+/);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : words.length;

  // Emphatic markers: numbers, dates, proper nouns, "only", "just", "first", "exactly"
  const emphatic = /\b(\d{4}|\d+\.\d+|billion|million|trillion|only|just|first|exactly|precisely|never|always|every|each)\b/i.test(text);

  let energy, targetSec;
  if (avgWordsPerSentence >= 20 && !emphatic) {
    energy = "calm";
    targetSec = Math.max(minSec, Math.min(maxSec, 5.5));
  } else if (avgWordsPerSentence <= 12 || emphatic) {
    energy = "emphatic";
    targetSec = Math.max(minSec, Math.min(maxSec, 3.5));
  } else {
    energy = "neutral";
    targetSec = Math.max(minSec, Math.min(maxSec, 4.5));
  }

  return { target_seconds: targetSec, energy };
}
