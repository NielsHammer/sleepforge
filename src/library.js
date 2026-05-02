import fs from "fs";

// ─── Image Library Lookup ───────────────────────────────────────────────────
// Loads assets/images/library-v1/index.json and scores entries against a
// query (philosopher + narration keywords) to find the best chalk image
// for a given clip's moment of narration.
//
// Scoring:
//   philosopher exact match  +5
//   keyword exact match      +1 per overlap
//   keyword in title/idea    +0.5 per overlap
//
// Returns null if no entry scores > 0.

const LIBRARY_PATH = "assets/images/library-v1/index.json";

let _cache = null;

export function loadLibrary(forcePath = null) {
  if (_cache && !forcePath) return _cache;
  const p = forcePath || LIBRARY_PATH;
  if (!fs.existsSync(p)) {
    console.warn(`  ⚠ Library not found: ${p}`);
    _cache = [];
    return _cache;
  }
  _cache = JSON.parse(fs.readFileSync(p, "utf-8"));
  return _cache;
}

export function lookupLibraryImage(library, query) {
  if (!library || library.length === 0) return null;

  const queryPhilosopher = (query.philosopher || "").toLowerCase().trim();
  const queryKeywords = new Set(
    (query.keywords || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean)
  );

  let best = null;
  let bestScore = -1;

  for (const entry of library) {
    let score = 0;

    if (entry.philosopher && entry.philosopher.toLowerCase() === queryPhilosopher) {
      score += 5;
    }

    const entryKw = (entry.keywords || []).map((k) => String(k).toLowerCase());
    for (const kw of entryKw) {
      if (queryKeywords.has(kw)) score += 1;
    }

    const titleIdea = `${entry.title || ""} ${entry.idea || ""}`.toLowerCase();
    for (const kw of queryKeywords) {
      if (kw.length >= 4 && titleIdea.includes(kw)) score += 0.5;
    }

    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (bestScore <= 0 || !best) return null;
  return {
    id: best.id,
    path: best.path,
    file: best.file,
    score: bestScore,
    title: best.title,
    philosopher: best.philosopher,
  };
}

// LRU-rotating pick: never returns the same image as the previous clip,
// then prefers least-recently-used among the top N scored matches.
// Falls back gracefully when the library has only one strongly-matching entry.
//
// query     — { philosopher, keywords, narration }
// prevId    — image id used by the previous clip (null on first clip)
// useCounts — Map<imageId, number> tracking how many times each id was picked
// topN      — how many top-scored entries to consider for rotation
export function lookupLibraryImageRotating(library, query, prevId = null, useCounts = new Map(), topN = 10) {
  if (!library || library.length === 0) return null;

  const queryPhilosopher = (query.philosopher || "").toLowerCase().trim();
  const queryKeywords = new Set(
    (query.keywords || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean)
  );
  const narration = (query.narration || "").toLowerCase();

  const scored = [];
  for (const entry of library) {
    let score = 0;
    if (entry.philosopher && entry.philosopher.toLowerCase() === queryPhilosopher) score += 5;
    const entryKw = (entry.keywords || []).map((k) => String(k).toLowerCase());
    for (const kw of entryKw) {
      if (queryKeywords.has(kw)) score += 1;
      if (kw.length >= 4 && narration.includes(kw)) score += 0.4;
    }
    const titleIdea = `${entry.title || ""} ${entry.idea || ""}`.toLowerCase();
    for (const kw of queryKeywords) {
      if (kw.length >= 4 && titleIdea.includes(kw)) score += 0.5;
    }
    if (score > 0) scored.push({ entry, score });
  }

  if (scored.length === 0) {
    // Total miss — pick globally LRU so we still rotate
    const all = library.map((entry) => ({ entry, score: 0, uses: useCounts.get(entry.id) || 0 }));
    all.sort((a, b) => a.uses - b.uses);
    const pick = all.find((x) => x.entry.id !== prevId) || all[0];
    return formatPick(pick.entry, 0);
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(topN, scored.length));

  // Among top candidates, exclude prevId and pick the least-recently-used.
  // Tie-break by score (higher first), then stable order.
  const eligible = top.filter((s) => s.entry.id !== prevId);
  const pool = eligible.length > 0 ? eligible : top;
  pool.sort((a, b) => {
    const ua = useCounts.get(a.entry.id) || 0;
    const ub = useCounts.get(b.entry.id) || 0;
    if (ua !== ub) return ua - ub;
    return b.score - a.score;
  });

  return formatPick(pool[0].entry, pool[0].score);
}

function formatPick(entry, score) {
  return {
    id: entry.id,
    path: entry.path,
    file: entry.file,
    score,
    title: entry.title,
    philosopher: entry.philosopher,
  };
}

// Round-robin pick among the top N matches to avoid the same image repeating
// when many clips share the same dominant philosopher with no other signal.
export function lookupLibraryImageDiverse(library, query, alreadyUsed = new Set(), topN = 5) {
  if (!library || library.length === 0) return null;

  const queryPhilosopher = (query.philosopher || "").toLowerCase().trim();
  const queryKeywords = new Set(
    (query.keywords || []).map((k) => String(k).toLowerCase().trim()).filter(Boolean)
  );

  const scored = [];
  for (const entry of library) {
    let score = 0;
    if (entry.philosopher && entry.philosopher.toLowerCase() === queryPhilosopher) score += 5;
    const entryKw = (entry.keywords || []).map((k) => String(k).toLowerCase());
    for (const kw of entryKw) if (queryKeywords.has(kw)) score += 1;
    const titleIdea = `${entry.title || ""} ${entry.idea || ""}`.toLowerCase();
    for (const kw of queryKeywords) if (kw.length >= 4 && titleIdea.includes(kw)) score += 0.5;
    if (score > 0) scored.push({ entry, score });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, topN);
  const unused = top.find((s) => !alreadyUsed.has(s.entry.id));
  const pick = unused || top[0];

  return {
    id: pick.entry.id,
    path: pick.entry.path,
    file: pick.entry.file,
    score: pick.score,
    title: pick.entry.title,
    philosopher: pick.entry.philosopher,
  };
}
