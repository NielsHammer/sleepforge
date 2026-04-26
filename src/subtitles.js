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

const PHRASE_SIZE = 4; // 4 words per phrase — matches Niels' spec

// ─── HELPERS ────────────────────────────────────────────────────────────────

function toASSTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  return h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0") + "." + String(cs).padStart(2, "0");
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

  // Group words into phrases of 4, respecting sentence boundaries
  const phrases = [];
  let phraseBuffer = [];

  for (let i = 0; i < wordTimestamps.length; i++) {
    const raw = wordTimestamps[i];
    const cleaned = cleanWord(raw.word);
    if (!cleaned) continue;
    const w = { ...raw, word: cleaned };
    phraseBuffer.push(w);

    const endsPhrase = phraseBuffer.length >= PHRASE_SIZE;
    const endsSentence = /[.!?]$/.test(w.word.trim());
    const isLast = i === wordTimestamps.length - 1;

    if (endsPhrase || endsSentence || isLast) {
      if (phraseBuffer.length > 0) {
        const lastWordEnd = phraseBuffer[phraseBuffer.length - 1].end;
        const nextWordStart = (i + 1 < wordTimestamps.length) ? wordTimestamps[i + 1].start : lastWordEnd + 0.3;
        const endTime = Math.min(lastWordEnd + 0.15, nextWordStart - 0.01);
        phrases.push({
          words: [...phraseBuffer],
          start: phraseBuffer[0].start,
          end: Math.max(lastWordEnd, endTime),
        });
        phraseBuffer = [];
      }
    }
  }

  // ASS header
  // PrimaryColour: white (unhighlighted words)
  // SecondaryColour: gold &H0066E8FF (highlighted current word via \kf)
  // Alignment 2 = bottom center
  // pos(960,1030) = fixed position, never moves
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat Bold,58,&H00FFFFFF,&H0066E8FF,&H00000000,&HA0000000,-1,0,0,0,100,100,1,0,1,4,3,2,80,80,50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  // Build dialogue lines with karaoke timing
  const lines = phrases.map(phrase => {
    const kText = phrase.words.map((w, wi) => {
      const nextStart = wi < phrase.words.length - 1 ? phrase.words[wi + 1].start : w.end + 0.15;
      const dur = Math.max(1, Math.round((nextStart - w.start) * 100));
      return "{\\kf" + dur + "}" + w.word;
    }).join(" ");
    // Fixed position: bottom center (960, 1030) on 1920x1080
    return "Dialogue: 0," + toASSTime(phrase.start) + "," + toASSTime(phrase.end) + ",Default,,0,0,0,,{\\an2\\pos(960,1030)}" + kText;
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
