import { loadLibrary, lookupLibraryImageDiverse, lookupLibraryImageRotating } from "./library.js";

// ─── Sleep Mode Director ────────────────────────────────────────────────────
//
// Adapted from VideoForge director.js. SleepForge ditches niche budgets,
// clip type classification, and the 100+ animation components — sleep
// videos are 100% chalk image overlays. What we keep from VF:
//   - Clip-window construction from word timestamps + script text
//   - A video bible that constrains visual decisions (era, banned visuals)
//   - Per-clip narrator-text capture so the image lookup matches the
//     actual words being spoken at that moment, not just the script's
//     scene metadata
//
// Output shape (one per clip):
//   {
//     index, start_time, end_time, duration,
//     text,             // exact narration in this window (from word timestamps)
//     philosopher,      // hint from script-generator scene
//     moment,           // hint from script-generator scene
//     search_keywords,  // derived from text + philosopher
//     imagePath,        // resolved by lookupLibraryImage
//     imageId, imageScore,
//   }

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","in","on","at","to","for","with","from","by",
  "is","are","was","were","be","been","being","this","that","these","those","then",
  "as","into","onto","off","over","under","very","just","also","here","there","than",
  "his","her","their","its","it","he","she","they","them","him","you","your","yours",
  "no","not","none","without","while","when","where","what","who","whom","which",
  "i","me","my","mine","we","us","our","ours","do","does","did","done",
  "have","has","had","having","will","would","could","should","may","might","can",
  "about","because","like","through","across","along","around","between","before","after",
]);

const SLEEP_PHILOSOPHY_BIBLE = {
  era: "ancient-greek-roman",
  era_specific: "Ancient Greece and Rome (~700 BCE – 200 CE)",
  setting: "marble columns, scroll shelves, oil lamps, togas, chalk-on-blackboard imagery",
  visual_tone: "calm, contemplative, dark, monochrome chalk strokes",
  required_visual_style: "white and grey chalk on dark blackboard, monochrome only, hand-drawn lines",
  banned_visuals: [
    "modern", "cars", "phones", "neon", "color photography",
    "photorealistic", "computer screens", "modern clothing",
    "cityscape", "vehicles", "electric lighting",
  ],
  image_search_prefix: "chalk on blackboard",
  target_audience: "adults seeking calm, philosophical sleep content",
  emotional_arc: "gentle introduction → contemplation → deepening calm → restful close",
};

function normalizeWord(s) {
  return String(s || "").toLowerCase().replace(/[^a-z']/g, "");
}

function extractKeywords(text, philosopher = "") {
  const words = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9'\- ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));
  const counts = {};
  for (const w of words) counts[w] = (counts[w] || 0) + 1;
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
  const out = [];
  if (philosopher) out.push(String(philosopher).toLowerCase());
  for (const w of top) if (!out.includes(w)) out.push(w);
  return out;
}

// Find the index in wordTimestamps where this scene's narration begins,
// searching forward from `cursor`. Anchor on the first 5 normalized words.
function locateSceneStart(scene, wordTimestamps, cursor) {
  const sceneWords = String(scene.narration || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map(normalizeWord)
    .filter(Boolean);
  if (sceneWords.length === 0) return -1;

  for (let i = cursor; i <= wordTimestamps.length - sceneWords.length; i++) {
    let match = true;
    for (let j = 0; j < sceneWords.length; j++) {
      const tw = normalizeWord(wordTimestamps[i + j].word);
      const sw = sceneWords[j];
      if (!tw || !sw) { match = false; break; }
      // Substring overlap in either direction handles minor punctuation drift
      if (!(tw.includes(sw) || sw.includes(tw))) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

// Fine-grain mode: walk the word timestamps in order and slice the timeline
// into ~targetClipSec windows. Each clip inherits its philosopher hint from
// whichever scene's word range contains it.
//
// This is what we want for sleep videos with constant image-switching:
// 12-16 clips for a 1-min video, 60-90 for a 5-min, etc. Each clip is short
// enough that the slideshow feels alive, but long enough (3-5s) that the eye
// has time to register the chalk image before it crossfades.
function buildFineClipsByTime(scenes, wordTimestamps, totalDuration, targetSec) {
  if (!Array.isArray(wordTimestamps) || wordTimestamps.length === 0) {
    // No timestamps — even-time chunking
    const numClips = Math.max(1, Math.round(totalDuration / targetSec));
    const dur = totalDuration / numClips;
    const out = [];
    for (let i = 0; i < numClips; i++) {
      const scene = scenes[Math.min(i, scenes.length - 1)] || {};
      out.push({
        index: i,
        start_time: i * dur,
        end_time: (i + 1) * dur,
        duration: dur,
        text: scene.narration || "",
        philosopher: scene.philosopher || "",
        moment: scene.moment || "",
        search_keywords: extractKeywords(scene.narration || "", scene.philosopher),
      });
    }
    return out;
  }

  // Map each word index → the scene whose narration it belongs to (best-effort)
  const sceneStarts = [];
  let cursor = 0;
  for (const scene of scenes) {
    const idx = locateSceneStart(scene, wordTimestamps, cursor);
    if (idx !== -1) {
      sceneStarts.push({ wordIdx: idx, scene });
      cursor = idx + 1;
    }
  }
  function sceneAt(wordIdx) {
    let best = sceneStarts[0]?.scene || scenes[0] || {};
    for (const s of sceneStarts) {
      if (s.wordIdx <= wordIdx) best = s.scene; else break;
    }
    return best;
  }

  // Walk words, accumulate until ≥targetSec elapsed (or sentence-boundary hit).
  // Prefer to close a clip on a punctuation token so phrasing matches the cut.
  const clips = [];
  let buf = [];
  let bufStartTime = wordTimestamps[0].start;
  let prevEnd = 0;

  const flush = (endTime) => {
    if (buf.length === 0) return;
    const text = buf.map((w) => w.word).join(" ").trim();
    const startScene = sceneAt(buf[0]._idx);
    const start = Math.max(prevEnd, bufStartTime);
    const end = Math.max(start + 0.1, endTime);
    clips.push({
      index: clips.length,
      start_time: start,
      end_time: end,
      duration: end - start,
      text,
      philosopher: startScene.philosopher || "",
      moment: startScene.moment || "",
      search_keywords: extractKeywords(text, startScene.philosopher),
    });
    prevEnd = end;
    buf = [];
  };

  for (let i = 0; i < wordTimestamps.length; i++) {
    const w = { ...wordTimestamps[i], _idx: i };
    if (buf.length === 0) bufStartTime = w.start;
    buf.push(w);
    const elapsed = w.end - bufStartTime;
    const endsSentence = /[.!?]$/.test((w.word || "").trim());
    const endsClause = /[,;:]$/.test((w.word || "").trim());
    const isLast = i === wordTimestamps.length - 1;

    // Close the clip when:
    //  - we've hit the upper bound (targetSec * 1.4) regardless of punctuation
    //  - we're at/near targetSec AND a sentence ended (clean cut)
    //  - we're at/near targetSec AND a clause boundary (good cut)
    //  - end of input
    // Target 5s clips with a 4-7s window — keeps each chalk image on screen
    // for 3-5s of fully-visible time after subtracting the 1.5s xfade.
    const minSec = Math.max(4.0, targetSec * 0.85);
    const maxSec = Math.max(7.0, targetSec * 1.4);
    let close = isLast;
    if (!close && elapsed >= maxSec) close = true;
    else if (!close && elapsed >= targetSec && endsSentence) close = true;
    else if (!close && elapsed >= minSec && endsSentence) close = true;
    else if (!close && elapsed >= targetSec && endsClause) close = true;

    if (close) {
      const nextStart = i + 1 < wordTimestamps.length ? wordTimestamps[i + 1].start : w.end + 0.1;
      flush(Math.min(w.end + 0.05, nextStart - 0.01));
    }
  }
  flush(totalDuration);

  // Eliminate gaps: each clip's end_time should reach the NEXT clip's start_time
  // so the slideshow covers the full audio (sentence-pause silence wasn't being
  // covered by either neighbour, leaving 0.5-1s gaps).
  for (let i = 0; i < clips.length - 1; i++) {
    if (clips[i + 1].start_time > clips[i].end_time) {
      clips[i].end_time = clips[i + 1].start_time;
      clips[i].duration = clips[i].end_time - clips[i].start_time;
    }
  }
  if (clips.length > 0) {
    clips[clips.length - 1].end_time = Math.max(clips[clips.length - 1].end_time, totalDuration);
    clips[clips.length - 1].duration =
      clips[clips.length - 1].end_time - clips[clips.length - 1].start_time;
  }

  return clips;
}

// Build clip windows: one per script-generator scene by default, then split
// any clip longer than maxClipSec on sentence boundaries.
function buildClipWindows(scenes, wordTimestamps, totalDuration, opts = {}) {
  const minClipSec = opts.minClipSec || 30;
  const maxClipSec = opts.maxClipSec || 45;

  if (!Array.isArray(wordTimestamps) || wordTimestamps.length === 0) {
    // No timestamps — fall back to even-time chunking based on totalDuration
    const out = [];
    const sceneDur = totalDuration / Math.max(1, scenes.length);
    let t = 0;
    for (let i = 0; i < scenes.length; i++) {
      out.push({
        index: i,
        start_time: t,
        end_time: t + sceneDur,
        duration: sceneDur,
        text: scenes[i].narration || "",
        philosopher: scenes[i].philosopher || "",
        moment: scenes[i].moment || "",
        search_keywords: extractKeywords(scenes[i].narration || "", scenes[i].philosopher),
      });
      t += sceneDur;
    }
    return out;
  }

  const clips = [];
  let cursor = 0;
  let prevEndTime = 0;

  for (let si = 0; si < scenes.length; si++) {
    const scene = scenes[si];
    const startIdx = locateSceneStart(scene, wordTimestamps, cursor);
    if (startIdx === -1) continue;

    // Determine end index: just before the next scene's start, or end of timestamps
    let endIdx = wordTimestamps.length - 1;
    if (si + 1 < scenes.length) {
      const nextStart = locateSceneStart(scenes[si + 1], wordTimestamps, startIdx + 1);
      if (nextStart > startIdx) endIdx = nextStart - 1;
    }

    const clipStart = Math.max(prevEndTime, wordTimestamps[startIdx].start);
    const clipEnd = wordTimestamps[endIdx].end;
    if (clipEnd <= clipStart) continue;

    const sliceText = wordTimestamps
      .slice(startIdx, endIdx + 1)
      .map((w) => w.word)
      .join(" ")
      .trim();

    clips.push({
      index: clips.length,
      start_time: clipStart,
      end_time: clipEnd,
      duration: clipEnd - clipStart,
      text: sliceText || scene.narration,
      philosopher: scene.philosopher || "",
      moment: scene.moment || "",
      _sceneIdx: si,
    });

    prevEndTime = clipEnd;
    cursor = endIdx + 1;
  }

  // Split any clip longer than maxClipSec on sentence boundaries
  const split = [];
  for (const clip of clips) {
    if (clip.duration <= maxClipSec) {
      split.push(clip);
      continue;
    }
    const sentences = String(clip.text).split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    if (sentences.length <= 1) {
      split.push(clip);
      continue;
    }
    const targetCount = Math.ceil(clip.duration / maxClipSec);
    const sentencesPerSub = Math.max(1, Math.ceil(sentences.length / targetCount));
    let subStart = clip.start_time;
    let consumedChars = 0;
    const totalChars = sentences.reduce((s, x) => s + x.length, 0) || 1;
    for (let s = 0; s < sentences.length; s += sentencesPerSub) {
      const subSentences = sentences.slice(s, s + sentencesPerSub);
      const subText = subSentences.join(" ");
      const subChars = subText.length;
      const fraction = subChars / totalChars;
      const subDur = clip.duration * fraction;
      split.push({
        ...clip,
        start_time: subStart,
        end_time: subStart + subDur,
        duration: subDur,
        text: subText,
      });
      subStart += subDur;
      consumedChars += subChars;
    }
  }

  // Merge any clip shorter than minClipSec into its previous neighbour
  const merged = [];
  for (const clip of split) {
    if (merged.length > 0 && clip.duration < minClipSec) {
      const prev = merged[merged.length - 1];
      prev.end_time = clip.end_time;
      prev.duration = prev.end_time - prev.start_time;
      prev.text = (prev.text + " " + clip.text).slice(0, 4000);
      continue;
    }
    merged.push(clip);
  }

  // Re-derive search keywords + reindex
  merged.forEach((c, i) => {
    c.index = i;
    c.search_keywords = extractKeywords(c.text, c.philosopher);
    delete c._sceneIdx;
  });

  return merged;
}

// ─── createStoryboard ──────────────────────────────────────────────────────
//
// scenes: output of script-generator.generateScript().scenes
// wordTimestamps: [{word, start, end}, ...] from Whisper
// totalDuration: voiceover duration in seconds
// brief: { niche, tone, narrator, videoLength, backgroundStyle, minClipSec, maxClipSec }
//
// Returns { clips, videoBible }.

export async function createStoryboard(scenes, wordTimestamps, totalDuration, brief = {}) {
  // Fine-grain mode (sleep default): one clip every targetClipSec seconds so
  // the chalk imagery stays visually alive. Scene-mode (legacy) only used if
  // brief explicitly opts out by setting targetClipSec to 0/null.
  const targetClipSec = brief.targetClipSec ?? 4;
  const clips = targetClipSec > 0
    ? buildFineClipsByTime(scenes, wordTimestamps, totalDuration, targetClipSec)
    : buildClipWindows(scenes, wordTimestamps, totalDuration, {
        minClipSec: brief.minClipSec || 30,
        maxClipSec: brief.maxClipSec || 45,
      });

  // Resolve library image per clip — rotating picker:
  //   - never reuses the previous clip's image (no two-in-a-row)
  //   - prefers least-recently-used among the top scored matches
  //   - falls back to globally-LRU if no entry scores > 0
  const library = loadLibrary();
  const useCounts = new Map();
  let prevId = null;
  let hits = 0;
  let misses = 0;

  for (const clip of clips) {
    const match = lookupLibraryImageRotating(
      library,
      {
        philosopher: clip.philosopher,
        keywords: clip.search_keywords,
        narration: clip.text,
      },
      prevId,
      useCounts,
      10
    );
    if (match) {
      clip.imagePath = match.path;
      clip.imageId = match.id;
      clip.imageScore = match.score;
      useCounts.set(match.id, (useCounts.get(match.id) || 0) + 1);
      prevId = match.id;
      hits++;
    } else {
      clip.imagePath = null;
      misses++;
    }
  }

  const uniqueUsed = useCounts.size;
  console.log(
    `  Director: ${clips.length} clips (${hits} hits, ${misses} misses, ${uniqueUsed} unique images)`
  );

  return {
    clips,
    videoBible: SLEEP_PHILOSOPHY_BIBLE,
  };
}

export { SLEEP_PHILOSOPHY_BIBLE };
