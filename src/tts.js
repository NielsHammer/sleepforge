import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════
// VOICE LIBRARY — SleepForge voices
// ═══════════════════════════════════════════
const VOICE_MAP = {
  // Primary cloned voice
  "cloned-niels": {
    type: "f5-tts",
    refAudio: "/opt/sleepforge/assets/voices/cloned-niels/ref_audio.wav",
    refText: "/opt/sleepforge/assets/voices/cloned-niels/ref_text.txt"
  },
  // Fallback voices using Kokoro
  "kokoro-warm": {
    type: "kokoro",
    voice: "af_nicole"  // Warm female voice as fallback
  },
  "kokoro-neutral": {
    type: "kokoro",
    voice: "af_bella"
  }
};

// Voice metadata for order form display + auto-selection
export const VOICE_CATALOG = [
  { id: "cloned-niels", name: "Niels (Cloned)", description: "Primary cloned voice from Niels' voice sample", style: "natural", gender: "male", accent: "neutral" },
  { id: "kokoro-warm", name: "Kokoro Warm", description: "Warm, comforting female voice (fallback)", style: "warm", gender: "female", accent: "american" },
  { id: "kokoro-neutral", name: "Kokoro Neutral", description: "Neutral, clear voice (fallback)", style: "neutral", gender: "female", accent: "american" }
];

// ═══════════════════════════════════════════
// AUTO-SELECTION: theme/mood → voice (primary + backup)
// ═══════════════════════════════════════════
const STYLE_VOICES = {
  philosophy: { primary: "cloned-niels", backup: "kokoro-warm" },
  stoicism: { primary: "cloned-niels", backup: "kokoro-warm" },
  marcus_aurelius: { primary: "cloned-niels", backup: "kokoro-warm" },
  meditation: { primary: "kokoro-warm", backup: "cloned-niels" },
  sleep: { primary: "kokoro-warm", backup: "cloned-niels" },
  default: { primary: "cloned-niels", backup: "kokoro-warm" }
};

// Detect best voice style from script content
const STYLE_KEYWORDS = {
  philosophy: /philosophy|philosopher|think|wisdom|ancient|greece|rome|stoicism/i,
  stoicism: /stoic|stoicism|virtue|endurance|courage|self-control/i,
  marcus_aurelius: /marcus|aurelius|meditations|emperor|rome|roman/i,
  meditation: /meditat|mindful|calm|peace|relax|sleep|dream/i,
  sleep: /sleep|dream|rest|night|bedtime|insomnia|relax/i
};

export function detectVoiceStyle(scriptText) {
  let best = "default";
  let bestScore = 0;
  for (const [style, pattern] of Object.entries(STYLE_KEYWORDS)) {
    const matches = scriptText.match(new RegExp(pattern, "gi"));
    const score = matches ? matches.length : 0;
    if (score > bestScore) { bestScore = score; best = style; }
  }
  return best;
}

export function getAutoVoice(scriptText) {
  const style = detectVoiceStyle(scriptText);
  const voices = STYLE_VOICES[style] || STYLE_VOICES.default;
  return {
    style,
    primary: { id: voices.primary, ...VOICE_MAP[voices.primary] },
    backup: { id: voices.backup, ...VOICE_MAP[voices.backup] }
  };
}

// ═══════════════════════════════════════════
// VOICE RESOLUTION
// ═══════════════════════════════════════════
export async function getVoiceId(voiceNameOrId) {
  // If it's already a voice ID (long string), use directly
  if (voiceNameOrId && voiceNameOrId.length > 15) return voiceNameOrId;

  const lower = (voiceNameOrId || "").toLowerCase().replace(/['\s-]/g, "_");

  // Check our local map first
  if (VOICE_MAP[lower]) return lower;

  // Try partial match on catalog
  const match = VOICE_CATALOG.find(v =>
    v.id.includes(lower) || v.name.toLowerCase().includes(lower.replace(/_/g, " "))
  );
  if (match) return match.id;

  console.log(`Voice "${voiceNameOrId}" not found, using cloned-niels`);
  return "cloned-niels";
}

// ═══════════════════════════════════════════
// PACING: Claude decides per-video voice settings
// ═══════════════════════════════════════════
let _currentPacing = null;

export function setPacingOverride(pacing) {
  _currentPacing = {
    speed: Math.max(0.85, Math.min(1.15, parseFloat(pacing.speed) || 1.0)),
    stability: Math.max(0.35, Math.min(0.65, parseFloat(pacing.stability) || 0.55)),
    style: Math.max(0.15, Math.min(0.55, parseFloat(pacing.style) || 0.35)),
    label: pacing.label || 'custom pacing',
  };
  return _currentPacing;
}

export function getCurrentPacing() {
  return _currentPacing;
}

export async function analyzePacing(niche, topic, tone, scriptPreview) {
  try {
    // For SleepForge, we use fixed pacing optimized for sleep content
    // Slow, calm, meditative delivery
    const sleepPacing = {
      speed: 0.90,      // Slightly slower than normal
      stability: 0.55,  // Balanced stability
      style: 0.35,      // Natural expressiveness
      label: "sleep-optimized: calm, meditative"
    };
    console.log(`🎙️  Pacing (SleepForge): ${sleepPacing.label}`);
    _currentPacing = sleepPacing;
    return sleepPacing;
  } catch (err) {
    console.log(`Pacing analysis failed (${err.message}), using defaults`);
  }

  // Fallback
  const fallback = { speed: 0.90, stability: 0.55, style: 0.35, label: "calm, meditative" };
  console.log(`🎙️  Pacing (default): ${fallback.label}`);
  _currentPacing = fallback;
  return fallback;
}

// ═══════════════════════════════════════════
// TEXT PROCESSING
// ═══════════════════════════════════════════
function chunkText(text, maxChars = 4500) {
  if (text.length <= maxChars) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length + 1 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current ? " " : "") + s;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

// ═══════════════════════════════════════════
// TTS GENERATION
// ═══════════════════════════════════════════

async function generateWithF5TTS(text, voiceConfig, outputPath) {
  return new Promise((resolve, reject) => {
    const pythonScript = `
import sys
import os
sys.path.insert(0, '/opt/sleepforge')

from f5_tts.api import F5TTS
import soundfile as sf
import numpy as np

def generate_tts():
    try:
        f5tts = F5TTS()

        # Load reference files
        with open("${voiceConfig.refText}", "r") as f:
            ref_text = f.read().strip()

        # Generate speech
        result = f5tts.infer(
            ref_file="${voiceConfig.refAudio}",
            ref_text=ref_text,
            gen_text="${text.replace(/"/g, '\\"')}",
            file_wave=None,
            speed=${_currentPacing ? _currentPacing.speed : 1.0}
        )

        # F5-TTS returns (wav, sr, mel_spectrogram)
        wav, sr, _ = result

        # Save to file
        sf.write("${outputPath}", wav, sr)

        # Return basic info (we'll add timestamps later)
        return {"duration": len(wav)/sr, "sample_rate": sr}

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    result = generate_tts()
    print(f"Duration: {result['duration']}")
    print(f"Sample Rate: {result['sample_rate']}")
`;

    const tempScript = `/tmp/f5tts_${Date.now()}.py`;
    fs.writeFileSync(tempScript, pythonScript);

    const python = spawn("python3", [tempScript], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: "/opt/sleepforge"
    });

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => { stdout += data.toString(); });
    python.stderr.on("data", (data) => { stderr += data.toString(); });

    python.on("close", (code) => {
      fs.unlinkSync(tempScript);
      if (code === 0) {
        const lines = stdout.trim().split("\n");
        const duration = parseFloat(lines[0].split(": ")[1]);
        const sampleRate = parseInt(lines[1].split(": ")[1]);
        resolve({ duration, sampleRate, words: [] }); // Basic word timestamps for now
      } else {
        reject(new Error(`F5-TTS failed: ${stderr}`));
      }
    });

    python.on("error", reject);
  });
}

async function generateWithKokoro(text, voiceConfig, outputPath) {
  return new Promise((resolve, reject) => {
    const pythonScript = `
import sys
sys.path.insert(0, '/opt/sleepforge')

from kokoro_onnx import Kokoro
import soundfile as sf
import numpy as np

def generate_tts():
    try:
        kokoro = Kokoro("kokoro-v0_19.onnx", "voices.bin")

        samples, sample_rate = kokoro.create(
            "${text.replace(/"/g, '\\"')}",
            voice="${voiceConfig.voice}",
            speed=${_currentPacing ? _currentPacing.speed : 1.0},
            lang="en-us"
        )

        sf.write("${outputPath}", samples, sample_rate)

        # Basic word estimation (we'll improve this)
        words = []
        word_count = len("${text}".split())
        duration_per_word = len(samples) / sample_rate / word_count
        current_time = 0

        for word in "${text}".split():
            words.append({
                "word": word,
                "start": current_time,
                "end": current_time + duration_per_word
            })
            current_time += duration_per_word

        return {
            "duration": len(samples)/sample_rate,
            "sample_rate": sample_rate,
            "words": words
        }

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    result = generate_tts()
    import json
    print(json.dumps(result))
`;

    const tempScript = `/tmp/kokoro_${Date.now()}.py`;
    fs.writeFileSync(tempScript, pythonScript);

    const python = spawn("python3", [tempScript], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: "/opt/sleepforge"
    });

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => { stdout += data.toString(); });
    python.stderr.on("data", (data) => { stderr += data.toString(); });

    python.on("close", (code) => {
      fs.unlinkSync(tempScript);
      if (code === 0) {
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (e) {
          resolve({ duration: 0, sampleRate: 24000, words: [] });
        }
      } else {
        reject(new Error(`Kokoro failed: ${stderr}`));
      }
    });

    python.on("error", reject);
  });
}

async function ttsChunk(text, voiceId, outputPath) {
  const voiceConfig = VOICE_MAP[voiceId];
  if (!voiceConfig) {
    throw new Error(`Unknown voice: ${voiceId}`);
  }

  if (voiceConfig.type === "f5-tts") {
    return await generateWithF5TTS(text, voiceConfig, outputPath);
  } else if (voiceConfig.type === "kokoro") {
    return await generateWithKokoro(text, voiceConfig, outputPath);
  } else {
    throw new Error(`Unsupported voice type: ${voiceConfig.type}`);
  }
}

export async function generateVoiceoverWithTimestamps(text, voiceId, outputPath) {
  // Clean the text like VideoForge does
  text = text.replace(/\*\*([^*]+)\*\*/g,"$1").replace(/\*([^*]+)\*/g,"$1")
             .replace(/^#{1,6}\s+/gm,"").replace(/^---+$/gm,"")
             .replace(/^\s*[-*+]\s+/gm,"").replace(/\n{3,}/g,"\n\n").trim();

  // Collapse paragraph breaks
  text = text.replace(/\n\n+/g, ' ').replace(/\n/g, ' ').replace(/  +/g, ' ').trim();

  const chunks = chunkText(text);

  if (chunks.length === 1) {
    const result = await ttsChunk(chunks[0], voiceId, outputPath);
    return {
      words: result.words,
      duration: result.duration,
      audioPath: outputPath
    };
  }

  console.log(`Splitting voiceover into ${chunks.length} chunks (${text.length} chars total)`);

  // For now, handle single chunk - we'll implement multi-chunk later
  const result = await ttsChunk(chunks[0], voiceId, outputPath);
  return {
    words: result.words,
    duration: result.duration,
    audioPath: outputPath
  };
}