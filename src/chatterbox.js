import fs from "fs";
import path from "path";

// HTTP client for the local Chatterbox TTS container (OpenAI-compatible API).
//
// Container is run via docker-compose at /opt/chatterbox/, on port 4123.
// The "archer" voice has been uploaded to its persistent voice library so
// every sentence can clone Niels' archer reference without re-uploading.
//
// API: POST /v1/audio/speech
//      { input: "...", voice: "archer", response_format: "wav" }
//
// CPU inference is ~4-6× slower than realtime. Wire this through a
// concurrency-N worker pool in pipeline.js so we hide the latency behind
// parallel sentence rendering.

export const CHATTERBOX_URL = process.env.CHATTERBOX_URL || "http://localhost:4123";
export const CHATTERBOX_VOICE = process.env.CHATTERBOX_VOICE || "archer";
export const CHATTERBOX_TIMEOUT_MS = parseInt(process.env.CHATTERBOX_TIMEOUT_MS || "300000", 10);

let _healthCache = null;
let _healthCacheTs = 0;

export function resetHealthCache() {
  _healthCache = null;
  _healthCacheTs = 0;
}

// Cached health probe — only re-checks every 60s. Fast no-op when up,
// so we can call it before every sentence without flooding the API.
export async function isHealthy() {
  const now = Date.now();
  if (_healthCache !== null && now - _healthCacheTs < 60000) return _healthCache;
  if (process.env.CHATTERBOX_DISABLED === "1") {
    _healthCache = false; _healthCacheTs = now;
    return false;
  }
  try {
    const resp = await fetch(`${CHATTERBOX_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    _healthCache = resp.ok;
  } catch {
    _healthCache = false;
  }
  _healthCacheTs = now;
  return _healthCache;
}

// Serialization queue: Chatterbox CPU/MPS PyTorch backends are NOT thread
// safe — concurrent /v1/audio/speech calls produced tensor-shape mismatches
// ("stack expects each tensor to be equal size", "got NoneType"). We chain
// requests through a single Promise so only ONE Chatterbox inference runs
// at a time, regardless of how many pipeline workers call us in parallel.
// Kokoro fallback path stays parallel because Kokoro runs in isolated
// Python subprocesses.
let _chatterboxQueue = Promise.resolve();
function serializeChatterbox(fn) {
  const next = _chatterboxQueue.then(() => fn(), () => fn());
  // Don't let one failing job poison the chain — swallow rejections after
  // the awaited result has resolved so the next caller still proceeds.
  _chatterboxQueue = next.catch(() => {});
  return next;
}

// Generate speech for a single chunk to outputPath. Returns the path on
// success. Throws on any error so the caller can decide whether to fall
// back to Kokoro. Calls are automatically serialized via the queue above.
export function chatterboxTTS(text, outputPath, opts = {}) {
  return serializeChatterbox(async () => {
    const voice = opts.voice || CHATTERBOX_VOICE;
    const url = `${CHATTERBOX_URL}/v1/audio/speech`;

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        voice,
        response_format: "wav",
      }),
      signal: AbortSignal.timeout(CHATTERBOX_TIMEOUT_MS),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Chatterbox HTTP ${resp.status}: ${body.slice(0, 200)}`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length < 1024) {
      throw new Error(`Chatterbox returned ${buffer.length} bytes — likely an error response`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  });
}
