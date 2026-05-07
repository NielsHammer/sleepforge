import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ─── SleepForge ASS Karaoke Subtitle Generator ─────────────────────────────
//
// Generates ASS karaoke subtitles where:
//   - Words group into natural phrases (commas, clauses, sentence ends)
//   - Current word fills white as it's spoken (\kf animation)
//   - Previous + upcoming words stay dim chalk-grey
//   - Fixed position: bottom center, never moves
//
// Input: Whisper word timestamps [{word, start, end}, ...]
// Output: .ass file path

const PHRASE_MAX_CHARS = 32; // Kalam @ 80pt fits ~32 chars before wrapping
const PHRASE_MIN_WORDS = 2;  // never emit a single-word orphan phrase
const PHRASE_MAX_WORDS = 7;  // hard cap — natural breaks preferred

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

  // Group words into natural phrases. A phrase ends at:
  //   1. Natural punctuation boundary (comma, semicolon, colon, sentence end)
  //   2. Whisper timing gap > 0.45s (speaker paused naturally)
  //   3. Char overflow (PHRASE_MAX_CHARS) — prevents text running off screen
  //   4. Hard word cap (PHRASE_MAX_WORDS) — absolute safety net
  const cleaned = wordTimestamps
    .map((raw) => ({ ...raw, word: cleanWord(raw.word) }))
    .filter((w) => w.word);

  const phraseChars = (buf) => buf.reduce((n, w) => n + w.word.length, 0) + Math.max(0, buf.length - 1);

  // Returns true if this word ends a natural phrase boundary
  const isNaturalBreak = (w, nextW) => {
    const text = w.word.trim();
    if (/[,;:]$/.test(text)) return true;              // comma / semicolon / colon
    if (/[.!?]$/.test(text)) return true;              // sentence end
    if (nextW && (nextW.start - w.end) > 0.45) return true; // timing gap > 450ms
    return false;
  };

  const phrases = [];
  let phraseBuffer = [];

  for (let i = 0; i < cleaned.length; i++) {
    const w = cleaned[i];
    const nextW = cleaned[i + 1];
    const projectedChars = phraseChars(phraseBuffer) + (phraseBuffer.length ? 1 : 0) + w.word.length;
    const willOverflow = phraseBuffer.length > 0 && projectedChars > PHRASE_MAX_CHARS;

    // Flush before adding if it would overflow (prevents clipping)
    if (willOverflow) {
      flushBuffer(phrases, phraseBuffer, w.start);
      phraseBuffer = [];
    }

    phraseBuffer.push(w);
    const isLast = i === cleaned.length - 1;
    const natural = isNaturalBreak(w, nextW) && phraseBuffer.length >= PHRASE_MIN_WORDS;
    const tooLong = phraseBuffer.length >= PHRASE_MAX_WORDS;

    if (natural || tooLong || isLast) {
      flushBuffer(phrases, phraseBuffer, nextW?.start ?? null);
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
  //   Secondary &HFF000000  fully transparent   (words invisible until it's their turn;
  //                                              \kf animates fill from invisible→white as
  //                                              each word is spoken — true word-by-word reveal)
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
Style: Default,Kalam,80,&H00FFFFFF,&HFF000000,&HC0000000,&HD0000000,-1,0,0,0,100,100,3,0,1,6,4,2,140,140,150,1

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
