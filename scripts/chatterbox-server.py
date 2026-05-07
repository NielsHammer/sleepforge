#!/usr/bin/env python3
"""
Minimal OpenAI-compatible /v1/audio/speech server wrapping Chatterbox TTS.
Loads the model ONCE on CUDA at startup, then serves requests.

Endpoints:
  GET  /health              → {"status":"ok","device":"cuda"}
  POST /v1/audio/speech     → WAV audio bytes
    body: {"input": "text", "voice": "archer", "response_format": "wav"}

Voice map: "archer" → assets/voices/archer/ref_audio.wav
"""
import json
import io
import time
import threading
import os
import sys
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
PORT = int(os.environ.get("CHATTERBOX_PORT", "4123"))

VOICE_MAP = {
    "archer": str(PROJECT_ROOT / "assets" / "voices" / "archer" / "ref_audio.wav"),
}
DEFAULT_VOICE = "archer"

# ── Model load ────────────────────────────────────────────────────────────────
import torch
import soundfile as sf

print(f"[chatterbox-server] Loading model...", flush=True)
t0 = time.time()
from chatterbox.tts import ChatterboxTTS
device = "cuda" if torch.cuda.is_available() else "cpu"
model = ChatterboxTTS.from_pretrained(device=device)
print(f"[chatterbox-server] Ready on {device} in {time.time()-t0:.1f}s — listening on port {PORT}", flush=True)

_lock = threading.Lock()

def tts(text, voice_path):
    t_start = time.time()
    with _lock:
        wav = model.generate(
            text,
            audio_prompt_path=voice_path,
            exaggeration=0.5,
            cfg_weight=0.5,
        )
    arr = wav.squeeze().cpu().numpy()
    sr = model.sr
    buf = io.BytesIO()
    sf.write(buf, arr, sr, format="WAV")
    wav_bytes = buf.getvalue()
    audio_dur = len(arr) / sr
    elapsed = time.time() - t_start
    rt = elapsed / audio_dur if audio_dur > 0 else 0
    print(f"  [{elapsed:.1f}s | {rt:.2f}x RT | {audio_dur:.1f}s audio] {text[:60]}", flush=True)
    return wav_bytes, audio_dur, elapsed

# ── HTTP handler ──────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass  # suppress default access log

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok", "device": device}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            self.send_response(404); self.end_headers()
            return
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))
        text = body.get("input", "").strip()
        voice = body.get("voice", DEFAULT_VOICE)
        if not text:
            self.send_response(400); self.end_headers()
            return
        voice_path = VOICE_MAP.get(voice) or VOICE_MAP[DEFAULT_VOICE]
        if not os.path.exists(voice_path):
            print(f"  WARN: voice file not found: {voice_path}", flush=True)
            voice_path = VOICE_MAP[DEFAULT_VOICE]
        try:
            wav_bytes, _, _ = tts(text, voice_path)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self.end_headers()
            self.wfile.write(wav_bytes)
        except Exception as e:
            print(f"  ERROR: {e}", flush=True)
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
