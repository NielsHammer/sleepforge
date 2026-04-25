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
  // Archer cloned voice
  "f5-archer": {
    type: "f5-tts",
    refAudio: "/opt/sleepforge/assets/voices/archer/ref_audio.wav",
    refText: "/opt/sleepforge/assets/voices/archer/ref_text.txt"
  },
  // Kokoro voices for different accents
  "kokoro-warm": {
    type: "kokoro",
    voice: "af_nicole"  // Warm American female voice
  },
  "kokoro-neutral": {
    type: "kokoro",
    voice: "af_bella"   // Neutral American female voice
  },
  "kokoro-british-male": {
    type: "kokoro",
    voice: "bm_daniel"   // British male voice
  },
  "kokoro-american-male": {
    type: "kokoro",
    voice: "am_michael"  // American male voice
  },
  "am_michael": { type: "kokoro", voice: "am_michael" },
  "am_adam": { type: "kokoro", voice: "am_adam" },
  "am_echo": { type: "kokoro", voice: "am_echo" },
  "am_eric": { type: "kokoro", voice: "am_eric" },
  "am_fenrir": { type: "kokoro", voice: "am_fenrir" },
  "am_liam": { type: "kokoro", voice: "am_liam" },
  "am_onyx": { type: "kokoro", voice: "am_onyx" },
  "am_puck": { type: "kokoro", voice: "am_puck" },
  "am_santa": { type: "kokoro", voice: "am_santa" },
  "bm_daniel": { type: "kokoro", voice: "bm_daniel" },
  "bm_fable": { type: "kokoro", voice: "bm_fable" },
  "bm_george": { type: "kokoro", voice: "bm_george" },
  "bm_lewis": { type: "kokoro", voice: "bm_lewis" }
};

// Voice metadata for order form display + auto-selection
export const VOICE_CATALOG = [
  { id: "cloned-niels", name: "Niels (Cloned)", description: "Primary cloned voice from Niels' voice sample", style: "natural", gender: "male", accent: "neutral" },
  { id: "f5-archer", name: "Archer (Cloned)", description: "High-quality cloned Archer voice for sleep content", style: "professional", gender: "male", accent: "american" },
  { id: "kokoro-warm", name: "Kokoro Warm", description: "Warm, comforting female voice (fallback)", style: "warm", gender: "female", accent: "american" },
  { id: "kokoro-neutral", name: "Kokoro Neutral", description: "Neutral, clear voice (fallback)", style: "neutral", gender: "female", accent: "american" },
  { id: "kokoro-british", name: "British Sleep Voice", description: "Elegant British female voice for sleep content", style: "elegant", gender: "female", accent: "british" },
  { id: "kokoro-american", name: "American Sleep Voice", description: "Warm American female voice for sleep content", style: "warm", gender: "female", accent: "american" },
  { id: "kokoro-british-male", name: "British Male Sleep Voice", description: "Sophisticated British male voice for sleep content", style: "authoritative", gender: "male", accent: "british" },
  { id: "kokoro-american-male", name: "American Male Sleep Voice", description: "Warm American male voice for sleep content", style: "comforting", gender: "male", accent: "american" },
  { id: "am_adam", name: "Kokoro American Male Adam", description: "American male voice for sleep content", style: "soft", gender: "male", accent: "american" },
  { id: "am_echo", name: "Kokoro American Male Echo", description: "Calm American male voice with gentle clarity", style: "smooth", gender: "male", accent: "american" },
  { id: "am_eric", name: "Kokoro American Male Eric", description: "Warm American male voice with soft delivery", style: "warm", gender: "male", accent: "american" },
  { id: "am_fenrir", name: "Kokoro American Male Fenrir", description: "Deep American male voice with a soothing tone", style: "deep", gender: "male", accent: "american" },
  { id: "am_liam", name: "Kokoro American Male Liam", description: "Relaxed American male voice for sleep and meditation", style: "relaxed", gender: "male", accent: "american" },
  { id: "am_michael", name: "Kokoro American Male Michael", description: "Comforting American male voice with soft tones", style: "comforting", gender: "male", accent: "american" },
  { id: "am_onyx", name: "Kokoro American Male Onyx", description: "Smooth American male voice with strong presence", style: "strong", gender: "male", accent: "american" },
  { id: "am_puck", name: "Kokoro American Male Puck", description: "Gentle American male voice with playful warmth", style: "gentle", gender: "male", accent: "american" },
  { id: "am_santa", name: "Kokoro American Male Santa", description: "Rich American male voice with soft clarity", style: "rich", gender: "male", accent: "american" },
  { id: "bm_fable", name: "Kokoro British Male Fable", description: "British male voice with a calm, story-like tone", style: "storytelling", gender: "male", accent: "british" },
  { id: "bm_george", name: "Kokoro British Male George", description: "British male voice with steady, mellow delivery", style: "steady", gender: "male", accent: "british" },
  { id: "bm_lewis", name: "Kokoro British Male Lewis", description: "British male voice with a warm, gentle style", style: "gentle", gender: "male", accent: "british" }
];

// ═══════════════════════════════════════════
// AUTO-SELECTION: theme/mood → voice (primary + backup)
// ═══════════════════════════════════════════
const STYLE_VOICES = {
  philosophy: { primary: "cloned-niels", backup: "kokoro-warm" },
  stoicism: { primary: "cloned-niels", backup: "kokoro-warm" },
  marcus_aurelius: { primary: "cloned-niels", backup: "kokoro-warm" },
  meditation: { primary: "kokoro-warm", backup: "cloned-niels" },
  sleep: { primary: "am_echo", backup: "am_michael" },
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