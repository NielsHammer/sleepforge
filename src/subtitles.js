import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ─── SleepForge ASS Karaoke Subtitle Generator ─────────────────────────────
//
// Adapted from VideoForge pipeline.js generateSRT().
// Generates ASS karaoke subtitles where:
//   - 4 words per phrase (never wraps on screen)
//   - Current word highlights gold as spoken
//   - Fixed position: bottom center, never moves
//   - Calm font styling suited for sleep content
//
// Input: Whisper word timestamps [{word, start, end}, ...]
// Output: .ass file path

const PHRASE_SIZE = 4;       // soft cap, may shrink if char count overflows
const PHRASE_MAX_CHARS = 26; // Kalam @ 72pt fits ~26 chars in the 1720px safe zone before clipping
const PHRASE_MIN_WORDS = 2;  // never emit a single-word orphan phrase

// ─── HELPERS ────────────────────────────────────────────────────────────────

function toASSTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  return h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0") + "." + String(cs).padStart(2, "0");
}

function flushBuffer(phrases, buf, nextStart) {
  if (buf.length === 0) return;
  const lastWordEnd = buf[buf.length - 1].end;
  const nextStartGuard = nextStart != null ? nextStart - 0.01 : lastWordEnd + 0.3;
  const endTime = Math.max(lastWordEnd, Math.min(lastWordEnd + 0.15, nextStartGuard));
  phrases.push({ words: [...buf], start: buf[0].start, end: endTime });
}

function cleanWord(w) {
  return String(w)
    .replace(/[\u2014\u2013]/g, "") // em dash, en dash
    .replace(/[\u2018\u2019]/g, "'") // curly single quotes
    .replace(/[\u201C\u201D]/g, '"') // curly double quotes
    .replace(/\u2026/g, "...") // ellipsis
    .trim();
}

// ─── ASS GENERATION ─────────────────────────────────────────────────────────

/**
 * Generate ASS karaoke subtitle file from Whisper word timestamps.
 *
 * @param {Array<{word: string, start: number, end: number}>} wordTimestamps
 * @param {string} outputPath - Where to write the .ass file
 * @returns {string|null} Path to generated .ass file, or null if no timestamps
 */
export function generateASS(wordTimestamps, outputPath) {
  if (!wordTimestamps || wordTimestamps.length === 0) return null;

  // Group words into phrases. A phrase ends when:
  //   - the buffer would exceed PHRASE_MAX_CHARS (prevents off-screen clipping)
  //   - we hit a sentence end AND have at least PHRASE_MIN_WORDS (prevents "all" orphans)
  //   - we hit PHRASE_SIZE words
  //   - we run out of words
  const cleaned = wordTimestamps
    .map((raw) => ({ ...raw, word: cleanWord(raw.word) }))
    .filter((w) => w.word);

  const phraseChars = (buf) => buf.reduce((n, w) => n + w.word.length, 0) + Math.max(0, buf.length - 1);
  const phrases = [];
  let phraseBuffer = [];

  for (let i = 0; i < cleaned.length; i++) {
    const w = cleaned[i];
    const projectedChars = phraseChars(phraseBuffer) + (phraseBuffer.length ? 1 : 0) + w.word.length;
    const willOverflow = phraseBuffer.length > 0 && projectedChars > PHRASE_MAX_CHARS;

    // Flush before adding this word if it would overflow
    if (willOverflow) {
      flushBuffer(phrases, phraseBuffer, cleaned[i].start);
      phraseBuffer = [];
    }

    phraseBuffer.push(w);
    const isLast = i === cleaned.length - 1;
    const endsSentence = /[.!?]$/.test(w.word.trim());
    const reachedSize = phraseBuffer.length >= PHRASE_SIZE;
    const canCloseOnSentence = endsSentence && phraseBuffer.length >= PHRASE_MIN_WORDS;

    if (reachedSize || canCloseOnSentence || isLast) {
      const nextStart = (i + 1 < cleaned.length) ? cleaned[i + 1].start : null;
      flushBuffer(phrases, phraseBuffer, nextStart);
      phraseBuffer = [];
    }
  }

  // Chalk-write effect:
  //   Trick: \kf<centiseconds> animates the fill from SecondaryColour → PrimaryColour
  //   left-to-right across the word's pixels over its centisecond duration. By making
  //   Secondary fully transparent and Primary opaque chalk-white, each word literally
  //   "writes itself on" the board as it's spoken. No per-letter dialogue events
  //   needed — libass does the column-by-column reveal natively.
  //
  // ASS color format is &HAABBGGRR (alpha 00=opaque, FF=transparent)
  //   Primary   &H00FFFFFF  pure bright white  (active word — currently being spoken)
  //   Secondary &H40DCDCDC  ~75% chalk white   (past + upcoming words — visible but
  //                                              clearly distinguishable from the active word
  //                                              so the karaoke chalk-write reveal is readable)
  //   Outline   &HC0000000  heavy black edge   (chalk-stroke pop on any background)
  //   Shadow    &HD0000000  deep black         (cozy depth)
  //
  // Font bumped to 84 — subtitles are a key visual element, not an afterthought.
  // MarginV 110 keeps text inside the chalkboard frame's lower edge.
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Kalam,80,&H00FFFFFF,&H40DCDCDC,&HC0000000,&HD0000000,-1,0,0,0,100,100,3,0,1,6,4,2,140,140,150,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Build dialogue lines with karaoke chalk-write timing.
  // Each word's \kf duration matches its actual spoken duration so the
  // letters "appear" exactly as the narrator says them.
  const lines = phrases.map(phrase => {
    const kText = phrase.words.map((w) => {
      const wordDur = Math.max(15, Math.round((w.end - w.start) * 100));
      // \kf with transparent Secondary = letters fade in column-by-column
      return "{\\kf" + wordDur + "}" + w.word;
    }).join(" ");
    return "Dialogue: 0," + toASSTime(phrase.start) + "," + toASSTime(phrase.end) + ",Default,,0,0,0,,{\\an2\\pos(960,990)}" + kText;
  });

  fs.writeFileSync(outputPath, header + lines.join("\n") + "\n");
  console.log(`  Subtitles: ${outputPath} (${phrases.length} phrases from ${wordTimestamps.length} words)`);
  return outputPath;
}

// ─── BURN INTO VIDEO ────────────────────────────────────────────────────────

/**
 * Burn ASS subtitles into a video using FFmpeg.
 *
 * @param {string} videoPath - Input video
 * @param {string} assPath - ASS subtitle file
 * @param {string} outputPath - Output video with burned subs
 * @returns {boolean} Success
 */
export function burnSubtitles(videoPath, assPath, outputPath) {
  try {
    const escapedAss = assPath.replace(/:/g, "\\:");
    execSync(
      `ffmpeg -y -i "${videoPath}" -vf "ass='${escapedAss}'" -c:a copy -movflags +faststart "${outputPath}"`,
      { stdio: "pipe", timeout: 1800000 }
    );
    console.log(`  Subtitles burned into: ${outputPath}`);
    return true;
  } catch (err) {
    console.error(`  Subtitle burn failed: ${err.message}`);
    return false;
  }
}
