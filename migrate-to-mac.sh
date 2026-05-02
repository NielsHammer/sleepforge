#!/usr/bin/env bash
# ─── SleepForge → Mac migration (NATIVE, no Docker) ─────────────────────────
#
# Idempotent: safe to re-run if any step fails halfway.
#
# Steps:
#   1. Verify macOS + Apple Silicon
#   2. Homebrew
#   3. Brew packages: node, ffmpeg, python@3.11, git, jq, espeak-ng, wget
#   4. Clone or pull SleepForge → ~/sleepforge
#   5. SleepForge venv: kokoro, whisper, torch (MPS-capable on arm64)
#   6. Node deps (npm ci) — installs Remotion (@remotion/bundler, /renderer)
#   7. PM2 + login auto-start
#   8. Chatterbox: own venv with `pip install chatterbox-tts`, PM2 with DEVICE=mps
#   9. Upload archer voice to Chatterbox library
#  10. File server under PM2 on port 8080 (auto-starts on login)
#  11. Claude CLI (npm i -g @anthropic-ai/claude-code)
#  12. Kalam font → ~/Library/Fonts/
#  13. Inject PYTHON_BIN/WHISPER_BIN/CHATTERBOX_URL into ~/sleepforge/.env
#  14. Full self-test (pass/fail per check)
#
# What this script does NOT do:
#   - Use Docker (Docker on Mac can't reach Apple Silicon GPU)
#   - SCP your .env from Hetzner — you do that manually (see end of script)

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/NielsHammer/sleepforge.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/sleepforge}"
PORT="${PORT:-8080}"
CHATTERBOX_DIR="${CHATTERBOX_DIR:-$HOME/chatterbox}"
CHATTERBOX_PORT="${CHATTERBOX_PORT:-4123}"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
banner() { printf "\n\033[1;36m═══ %s ═══\033[0m\n" "$*"; }

# ─── 1. Verify environment ──────────────────────────────────────────────────
banner "Step 1/14: Verify macOS"
if [[ "$(uname -s)" != "Darwin" ]]; then red "macOS only."; exit 1; fi
green "✓ macOS $(sw_vers -productVersion)"
ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then green "✓ Apple Silicon — MPS available"
else yellow "⚠ Intel Mac — Chatterbox falls back to CPU"; fi

# ─── 2. Homebrew ────────────────────────────────────────────────────────────
banner "Step 2/14: Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  yellow "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ "$ARCH" == "arm64" ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"
  else eval "$(/usr/local/bin/brew shellenv)"; fi
fi
green "✓ Homebrew $(brew --version | head -1)"

# ─── 3. Brew packages ───────────────────────────────────────────────────────
banner "Step 3/14: Brew packages"
for pkg in node ffmpeg python@3.11 git jq espeak-ng wget; do
  if brew list --formula "$pkg" >/dev/null 2>&1; then green "✓ $pkg"
  else yellow "Installing $pkg..."; brew install "$pkg"; fi
done

if [[ "$ARCH" == "arm64" ]]; then
  PY_BIN="/opt/homebrew/opt/python@3.11/bin/python3.11"
else
  PY_BIN="/usr/local/opt/python@3.11/bin/python3.11"
fi
[[ -x "$PY_BIN" ]] || PY_BIN="$(command -v python3.11 || command -v python3)"
echo "node:    $(node --version)"
echo "ffmpeg:  $(ffmpeg -version | head -1)"
echo "python:  $PY_BIN"

# ─── 4. Clone or pull repo ──────────────────────────────────────────────────
banner "Step 4/14: SleepForge code"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  ( cd "$INSTALL_DIR" && git pull --ff-only )
  green "✓ Pulled $INSTALL_DIR"
else
  yellow "Cloning $REPO_URL..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  green "✓ Cloned to $INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ─── 5. SleepForge Python deps ──────────────────────────────────────────────
banner "Step 5/14: SleepForge Python deps (kokoro, whisper, torch w/ MPS)"
[[ -d "$INSTALL_DIR/.venv" ]] || "$PY_BIN" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip wheel
pip install torch torchaudio  # arm64 wheel ships with MPS
pip install kokoro==0.* onnxruntime soundfile numpy openai-whisper
deactivate
green "✓ SleepForge venv ready"

# Resolve absolute whisper path inside the venv
WHISPER_VENV_BIN="$INSTALL_DIR/.venv/bin/whisper"
PYTHON_VENV_BIN="$INSTALL_DIR/.venv/bin/python"

# ─── 6. Node deps (Remotion lives in root package.json) ─────────────────────
banner "Step 6/14: Node deps"
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
# Sanity-check that Remotion is reachable
if [[ -d "$INSTALL_DIR/node_modules/@remotion/renderer" && -d "$INSTALL_DIR/node_modules/@remotion/bundler" ]]; then
  green "✓ Remotion @bundler + @renderer present"
else
  red "✗ Remotion modules missing after npm install"; exit 1
fi

# ─── 7. PM2 + auto-start ────────────────────────────────────────────────────
banner "Step 7/14: PM2"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2
green "✓ PM2 $(pm2 --version)"
pm2 startup launchd -u "$USER" --hp "$HOME" 2>&1 | grep "sudo " | sh || true
pm2 save || true

# ─── 8. Chatterbox NATIVE (own venv, MPS) ───────────────────────────────────
banner "Step 8/14: Chatterbox native install"
mkdir -p "$CHATTERBOX_DIR"
cd "$CHATTERBOX_DIR"
[[ -d "$CHATTERBOX_DIR/.venv" ]] || "$PY_BIN" -m venv .venv
# shellcheck disable=SC1091
source "$CHATTERBOX_DIR/.venv/bin/activate"
pip install --upgrade pip wheel
# Install MPS-capable torch first so subsequent installs don't downgrade it
pip install "torch>=2.2,<2.7" "torchaudio>=2.2,<2.7"
pip install chatterbox-tts fastapi "uvicorn[standard]" python-multipart \
            python-dotenv pydub psutil sse-starlette soundfile numpy
deactivate
green "✓ chatterbox-tts installed in $CHATTERBOX_DIR/.venv"

# Minimal API server: a tiny shim that exposes /health, /voices, and
# /v1/audio/speech against the chatterbox-tts python package, with DEVICE=mps.
cat > "$CHATTERBOX_DIR/server.py" <<'PYEOF'
import os, io, json, tempfile, threading
from pathlib import Path
import torch, torchaudio
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from chatterbox.tts import ChatterboxTTS

DEVICE = os.environ.get("DEVICE", "mps" if torch.backends.mps.is_available() else "cpu")
VOICE_LIB = Path(os.environ.get("VOICE_LIB", str(Path(__file__).parent / "voices")))
VOICE_LIB.mkdir(parents=True, exist_ok=True)
DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "archer")

print(f"[chatterbox] booting on device={DEVICE}")
model = ChatterboxTTS.from_pretrained(device=DEVICE)
print(f"[chatterbox] model ready")

app = FastAPI()
_lock = threading.Lock()

@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE}

@app.get("/voices")
def voices():
    out = [{"name": p.stem} for p in VOICE_LIB.glob("*.wav")]
    return out

@app.post("/voices")
async def upload_voice(voice_file: UploadFile = File(...), voice_name: str = Form(...)):
    dst = VOICE_LIB / f"{voice_name}.wav"
    dst.write_bytes(await voice_file.read())
    return {"name": voice_name}

class SpeechReq(BaseModel):
    input: str
    voice: str | None = None
    response_format: str = "wav"
    exaggeration: float | None = None
    cfg_weight: float | None = None
    temperature: float | None = None

@app.post("/v1/audio/speech")
def speech(req: SpeechReq):
    voice = req.voice or DEFAULT_VOICE
    ref = VOICE_LIB / f"{voice}.wav"
    if not ref.exists():
        return JSONResponse({"error": f"voice '{voice}' not in library"}, status_code=404)
    kw = {}
    if req.exaggeration is not None: kw["exaggeration"] = req.exaggeration
    if req.cfg_weight   is not None: kw["cfg_weight"]   = req.cfg_weight
    if req.temperature  is not None: kw["temperature"]  = req.temperature
    with _lock:
        wav = model.generate(req.input, audio_prompt_path=str(ref), **kw)
    buf = io.BytesIO()
    torchaudio.save(buf, wav, model.sr, format="wav")
    return Response(buf.getvalue(), media_type="audio/wav")
PYEOF

cat > "$CHATTERBOX_DIR/.env" <<EOF
PORT=$CHATTERBOX_PORT
HOST=127.0.0.1
DEVICE=mps
DEFAULT_VOICE=archer
VOICE_LIB=$CHATTERBOX_DIR/voices
EOF

# Pre-stage archer voice in the library
mkdir -p "$CHATTERBOX_DIR/voices"
cp -f "$INSTALL_DIR/assets/voices/archer/ref_audio.wav" "$CHATTERBOX_DIR/voices/archer.wav"

# Run under PM2 using the venv's uvicorn so torch/MPS wiring is right.
# PM2 defaults to interpreting unknown files as Node — uvicorn is a Python
# entrypoint, so we wrap it in a shell launcher and tell PM2 to exec it with
# bash. The wrapper is also where DEVICE=mps and friends get exported, since
# PM2's CLI doesn't support per-process env overrides reliably.
cat > "$CHATTERBOX_DIR/start-chatterbox.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$CHATTERBOX_DIR"
export DEVICE=mps
export DEFAULT_VOICE=archer
export VOICE_LIB="$CHATTERBOX_DIR/voices"
exec "$CHATTERBOX_DIR/.venv/bin/uvicorn" server:app \\
  --host 127.0.0.1 --port $CHATTERBOX_PORT
EOF
chmod +x "$CHATTERBOX_DIR/start-chatterbox.sh"

if pm2 describe chatterbox-tts >/dev/null 2>&1; then
  pm2 restart chatterbox-tts --update-env
else
  pm2 start "$CHATTERBOX_DIR/start-chatterbox.sh" \
    --name chatterbox-tts \
    --interpreter bash \
    --cwd "$CHATTERBOX_DIR"
fi
pm2 save || true

yellow "Waiting for Chatterbox to come up (model download + MPS warmup, up to 5 min)..."
HEALTHY=0
for _ in $(seq 1 60); do
  if curl -fs "http://localhost:$CHATTERBOX_PORT/health" >/dev/null 2>&1; then
    HEALTHY=1; break
  fi
  sleep 5; printf "."
done
echo
[[ $HEALTHY -eq 1 ]] && green "✓ Chatterbox healthy on http://localhost:$CHATTERBOX_PORT" \
                      || yellow "⚠ Chatterbox not yet healthy — check 'pm2 logs chatterbox-tts'"

# ─── 9. Upload archer voice (idempotent) ────────────────────────────────────
banner "Step 9/14: archer voice in Chatterbox library"
if curl -fs "http://localhost:$CHATTERBOX_PORT/voices" | grep -q '"name":"archer"'; then
  green "✓ archer already registered"
else
  curl -s -X POST "http://localhost:$CHATTERBOX_PORT/voices" \
    -F "voice_file=@$INSTALL_DIR/assets/voices/archer/ref_audio.wav" \
    -F "voice_name=archer" >/dev/null \
    && green "✓ archer uploaded" \
    || yellow "⚠ upload failed (Chatterbox may still be warming up)"
fi

# ─── 10. File server under PM2 ──────────────────────────────────────────────
banner "Step 10/14: File server (port $PORT) under PM2"
cd "$INSTALL_DIR"
# Same uvicorn-style trap: PM2 would try to interpret python3.11 as a Node
# script. Wrap it in a launcher and pin --interpreter bash.
cat > "$INSTALL_DIR/start-fileserver.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$INSTALL_DIR"
exec "$PY_BIN" -m http.server $PORT --bind 0.0.0.0
EOF
chmod +x "$INSTALL_DIR/start-fileserver.sh"

if pm2 describe sleepforge-fileserver >/dev/null 2>&1; then
  pm2 restart sleepforge-fileserver
else
  pm2 start "$INSTALL_DIR/start-fileserver.sh" \
    --name sleepforge-fileserver \
    --interpreter bash \
    --cwd "$INSTALL_DIR"
fi
pm2 save || true
green "✓ File server: http://localhost:$PORT/"

# ─── 11. Claude CLI ─────────────────────────────────────────────────────────
banner "Step 11/14: Claude CLI"
if ! command -v claude >/dev/null 2>&1; then
  yellow "Installing @anthropic-ai/claude-code globally..."
  npm install -g @anthropic-ai/claude-code
fi
green "✓ claude $(claude --version 2>/dev/null || echo 'installed')"
yellow "▸ Run 'claude' once interactively to authenticate (subscription login)."

# ─── 12. Kalam font ─────────────────────────────────────────────────────────
banner "Step 12/14: Kalam font"
FONT_DIR="$HOME/Library/Fonts"
mkdir -p "$FONT_DIR"
if ls "$FONT_DIR"/Kalam* >/dev/null 2>&1; then
  green "✓ Kalam already installed"
else
  yellow "Downloading Kalam from Google Fonts..."
  TMP="$(mktemp -d)"
  for variant in Regular Bold Light; do
    wget -q -O "$FONT_DIR/Kalam-$variant.ttf" \
      "https://github.com/google/fonts/raw/main/ofl/kalam/Kalam-$variant.ttf" \
      || yellow "  (skipped Kalam-$variant)"
  done
  rm -rf "$TMP"
  if ls "$FONT_DIR"/Kalam* >/dev/null 2>&1; then green "✓ Kalam installed"
  else yellow "⚠ Kalam download failed — subtitle burning may use fallback font"; fi
fi

# ─── 13. Inject env vars into ~/sleepforge/.env ─────────────────────────────
banner "Step 13/14: ~/sleepforge/.env env vars"
ENV_FILE="$INSTALL_DIR/.env"
touch "$ENV_FILE"

set_env_kv() {
  local key="$1" val="$2"
  if grep -q "^$key=" "$ENV_FILE" 2>/dev/null; then
    # Replace existing line; use a delimiter that won't appear in paths
    python3 -c "
import sys, re
p, k, v = sys.argv[1:4]
t = open(p).read()
t = re.sub(rf'^{re.escape(k)}=.*$', f'{k}={v}', t, flags=re.M)
open(p, 'w').write(t)
" "$ENV_FILE" "$key" "$val"
  else
    printf '\n%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}

set_env_kv PYTHON_BIN     "$PYTHON_VENV_BIN"
set_env_kv WHISPER_BIN    "$WHISPER_VENV_BIN"
set_env_kv CHATTERBOX_URL "http://localhost:$CHATTERBOX_PORT"
set_env_kv CHATTERBOX_VOICE "archer"
green "✓ PYTHON_BIN, WHISPER_BIN, CHATTERBOX_URL written to $ENV_FILE"

# Warn on missing required keys (don't fail — user may not have SCP'd yet)
REQUIRED_KEYS=(ANTHROPIC_API_KEY FAL_KEY)
MISSING=()
for k in "${REQUIRED_KEYS[@]}"; do
  if ! grep -qE "^$k=.+" "$ENV_FILE"; then MISSING+=("$k"); fi
done
if (( ${#MISSING[@]} > 0 )); then
  yellow "⚠ Missing required keys in $ENV_FILE: ${MISSING[*]}"
  yellow "  SCP your Hetzner .env over the top:"
  yellow "    scp root@157.180.124.232:/opt/sleepforge/.env $ENV_FILE"
  yellow "  Then re-run this script (it will keep PYTHON_BIN etc. on top of yours)."
fi

# ─── 14. Full self-test ─────────────────────────────────────────────────────
banner "Step 14/14: Self-test"
PASS=0; FAIL=0
check() {
  local label="$1" cmd="$2"
  if eval "$cmd" >/dev/null 2>&1; then
    printf "  \033[32m✓\033[0m %s\n" "$label"; PASS=$((PASS+1))
  else
    printf "  \033[31m✗\033[0m %s\n" "$label"; FAIL=$((FAIL+1))
  fi
}

NODE_MAJOR="$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/')"
check "python3.11 callable ($PY_BIN)"           "[[ -x '$PY_BIN' ]]"
check "venv python ($PYTHON_VENV_BIN)"          "[[ -x '$PYTHON_VENV_BIN' ]]"
check "venv whisper ($WHISPER_VENV_BIN)"        "[[ -x '$WHISPER_VENV_BIN' ]]"
check "node ≥ v22"                              "[[ -n '$NODE_MAJOR' && $NODE_MAJOR -ge 22 ]]"
check "ffmpeg installed"                        "command -v ffmpeg"
check "ffprobe installed"                       "command -v ffprobe"
check "Chatterbox /health responds"             "curl -fs http://localhost:$CHATTERBOX_PORT/health"
check "archer voice in Chatterbox library"      "curl -fs http://localhost:$CHATTERBOX_PORT/voices | grep -q archer"
check "Kalam font installed"                    "ls $FONT_DIR/Kalam*"
check "Remotion @bundler"                       "[[ -d $INSTALL_DIR/node_modules/@remotion/bundler ]]"
check "Remotion @renderer"                      "[[ -d $INSTALL_DIR/node_modules/@remotion/renderer ]]"
check "claude CLI"                              "command -v claude"
check "PM2 sleepforge-fileserver online"        "pm2 jlist | grep -q sleepforge-fileserver"
check "PM2 chatterbox-tts online"               "pm2 jlist | grep -q chatterbox-tts"
check "File server responds on :$PORT"          "curl -fs -o /dev/null http://localhost:$PORT/"
check ".env: ANTHROPIC_API_KEY"                 "grep -qE '^ANTHROPIC_API_KEY=.+' '$ENV_FILE'"
check ".env: FAL_KEY"                           "grep -qE '^FAL_KEY=.+' '$ENV_FILE'"
check ".env: PYTHON_BIN"                        "grep -qE '^PYTHON_BIN=.+' '$ENV_FILE'"
check ".env: WHISPER_BIN"                       "grep -qE '^WHISPER_BIN=.+' '$ENV_FILE'"
check ".env: CHATTERBOX_URL"                    "grep -qE '^CHATTERBOX_URL=.+' '$ENV_FILE'"

echo
if (( FAIL == 0 )); then
  green "✓ All $PASS checks passed."
else
  yellow "$PASS passed, $FAIL failed — fix the ✗ items above and re-run."
fi

echo
yellow "Next steps:"
yellow "  1. If any .env keys were missing, SCP yours from Hetzner:"
yellow "       scp root@157.180.124.232:/opt/sleepforge/.env $ENV_FILE"
yellow "     (then re-run this script — env vars get re-injected on top)"
yellow "  2. Authenticate Claude CLI: run 'claude' once in this terminal."
yellow "  3. Render a 5-min test:"
yellow "       cd $INSTALL_DIR && node run-pipeline-test.js"
yellow "  4. Watch it: http://localhost:$PORT/output/"
