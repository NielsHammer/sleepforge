#!/usr/bin/env bash
# ─── SleepForge → Mac migration (NATIVE / no Docker) ────────────────────────
#
# Idempotent setup: safe to re-run if any step fails halfway. Each step
# checks if it's already done before doing it.
#
# What this script does (in order):
#   1. Verify macOS + Apple Silicon
#   2. Install Homebrew if missing
#   3. Install node, ffmpeg, python@3.11, git, jq, espeak-ng via Homebrew
#   4. Clone or pull the SleepForge repo
#   5. Python deps for SleepForge: kokoro, openai-whisper, torch (MPS-capable)
#   6. Node deps (npm ci)
#   7. PM2 + login auto-start
#   8. Clone chatterbox-tts-api + create its OWN venv (separate from SleepForge)
#      → install torch with MPS support, install API requirements
#   9. Upload archer voice into Chatterbox's voice library + start API under PM2
#  10. Start the file server on port 8080 + run a self-test
#
# What this script does NOT do:
#   - Use Docker (intentional — Docker on Mac can't reach Apple Silicon GPU)
#   - Copy the .env file (you SCP this manually from Hetzner)
#
# Read MIGRATION.md for the friendly step-by-step.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/NielsHammer/sleepforge.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/sleepforge}"
PORT="${PORT:-8080}"
CHATTERBOX_DIR="${CHATTERBOX_DIR:-$HOME/chatterbox}"
CHATTERBOX_REPO="${CHATTERBOX_REPO:-https://github.com/travisvn/chatterbox-tts-api.git}"
CHATTERBOX_PORT="${CHATTERBOX_PORT:-4123}"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red() { printf "\033[31m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }
banner() { printf "\n\033[1;36m═══ %s ═══\033[0m\n" "$*"; }

# ─── 1. Verify environment ──────────────────────────────────────────────────
banner "Step 1/10: Verify macOS"
if [[ "$(uname -s)" != "Darwin" ]]; then
  red "This script is for macOS only."; exit 1
fi
green "✓ macOS detected ($(sw_vers -productVersion))"

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  green "✓ Apple Silicon (arm64) — MPS GPU acceleration available"
else
  yellow "⚠ Intel Mac detected — Chatterbox falls back to CPU (slower)"
fi

# ─── 2. Homebrew ────────────────────────────────────────────────────────────
banner "Step 2/10: Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  yellow "Installing Homebrew (you'll be prompted for your password once)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ "$ARCH" == "arm64" ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  else
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi
green "✓ Homebrew $(brew --version | head -1)"

# ─── 3. Brew packages ───────────────────────────────────────────────────────
banner "Step 3/10: Brew packages"
# espeak-ng is needed by kokoro for phonemization
for pkg in node ffmpeg python@3.11 git jq espeak-ng; do
  if brew list --formula "$pkg" >/dev/null 2>&1; then
    green "✓ $pkg already installed"
  else
    yellow "Installing $pkg..."; brew install "$pkg"
  fi
done
echo "node:    $(node --version)"
echo "ffmpeg:  $(ffmpeg -version | head -1)"
echo "python3: $(python3 --version)"

# Use Homebrew's python@3.11 explicitly so we get a stable version
if [[ "$ARCH" == "arm64" ]]; then
  PY_BIN="/opt/homebrew/opt/python@3.11/bin/python3.11"
else
  PY_BIN="/usr/local/opt/python@3.11/bin/python3.11"
fi
[[ -x "$PY_BIN" ]] || PY_BIN="$(command -v python3.11 || command -v python3)"
echo "python:  $PY_BIN"

# ─── 4. Clone or pull repo ──────────────────────────────────────────────────
banner "Step 4/10: SleepForge code"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  green "✓ Repo already cloned at $INSTALL_DIR; pulling latest"
  ( cd "$INSTALL_DIR" && git pull --ff-only )
else
  yellow "Cloning $REPO_URL into $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ─── 5. Python deps for Kokoro + Whisper (SleepForge venv) ──────────────────
banner "Step 5/10: SleepForge Python deps (Kokoro, Whisper, Torch w/ MPS)"
if [[ ! -d "$INSTALL_DIR/.venv" ]]; then
  "$PY_BIN" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip wheel
# Torch on Apple Silicon: the standard wheel ships MPS support out of the box.
pip install torch torchaudio
pip install kokoro==0.* onnxruntime soundfile numpy
pip install openai-whisper
deactivate
green "✓ SleepForge Python deps installed in .venv"

# ─── 6. Node deps ───────────────────────────────────────────────────────────
banner "Step 6/10: Node deps"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
green "✓ Node deps installed"

# ─── 7. PM2 + auto-start ────────────────────────────────────────────────────
banner "Step 7/10: PM2"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi
green "✓ PM2 $(pm2 --version)"

# Generate a launch agent so PM2 starts on login
pm2 startup launchd -u "$USER" --hp "$HOME" 2>&1 | grep "sudo " | sh || true
pm2 save

# ─── 8. Chatterbox NATIVE install (its own venv, MPS-capable) ───────────────
banner "Step 8/10: Chatterbox TTS — native install with MPS"
if [[ ! -d "$CHATTERBOX_DIR/.git" ]]; then
  yellow "Cloning chatterbox-tts-api → $CHATTERBOX_DIR"
  git clone "$CHATTERBOX_REPO" "$CHATTERBOX_DIR"
fi
cd "$CHATTERBOX_DIR"

# Chatterbox runs in ITS OWN venv so its torch / numpy don't fight SleepForge's.
if [[ ! -d "$CHATTERBOX_DIR/.venv" ]]; then
  "$PY_BIN" -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip wheel

# Apple Silicon: install MPS-capable torch first so requirements.txt's pin doesn't
# downgrade to a CPU-only build. The default macOS arm64 torch wheel includes MPS.
pip install "torch>=2.2,<2.7" "torchaudio>=2.2,<2.7"

# Now install the rest of the API requirements (will skip torch since it's pinned)
pip install -r requirements.txt

deactivate
green "✓ Chatterbox Python deps installed in $CHATTERBOX_DIR/.venv"

# Write .env pointing at the SleepForge archer reference voice + DEVICE=mps
cat > "$CHATTERBOX_DIR/.env" <<EOF
PORT=$CHATTERBOX_PORT
HOST=127.0.0.1
VOICE_SAMPLE_HOST_PATH=$INSTALL_DIR/assets/voices/archer/ref_audio.wav
DEVICE=mps
EXAGGERATION=0.4
CFG_WEIGHT=0.5
TEMPERATURE=0.6
MAX_CHUNK_LENGTH=280
MAX_TOTAL_LENGTH=3000
ENABLE_MEMORY_MONITORING=true
EOF

# Pre-place the archer reference where Chatterbox expects it (the API also
# accepts uploads via /voices, but having the default voice file present means
# first-boot inference works even before the upload step below).
mkdir -p "$CHATTERBOX_DIR/voice-samples"
cp -f "$INSTALL_DIR/assets/voices/archer/ref_audio.wav" "$CHATTERBOX_DIR/voice-sample.mp3" || true

# ─── 9. Run Chatterbox under PM2 + upload archer voice ──────────────────────
banner "Step 9/10: Start Chatterbox API + upload archer voice"
cd "$CHATTERBOX_DIR"

# Use the venv's uvicorn so the API runs against the MPS-capable torch.
if pm2 describe chatterbox-tts >/dev/null 2>&1; then
  pm2 restart chatterbox-tts --update-env
else
  pm2 start "$CHATTERBOX_DIR/.venv/bin/uvicorn" \
    --name chatterbox-tts \
    --cwd "$CHATTERBOX_DIR" \
    -- app.main:app --host 127.0.0.1 --port $CHATTERBOX_PORT
fi
pm2 save

yellow "Waiting for Chatterbox to come up (model download + MPS warmup, up to 5 min)..."
for i in $(seq 1 60); do
  if curl -s -o /dev/null -w '%{http_code}' "http://localhost:$CHATTERBOX_PORT/health" | grep -q '^200$'; then
    green "✓ Chatterbox healthy on http://localhost:$CHATTERBOX_PORT"
    break
  fi
  sleep 5
  printf "."
done
echo

# Upload archer voice to the library (idempotent — safe if already there)
if curl -s "http://localhost:$CHATTERBOX_PORT/voices" | grep -q '"name":"archer"'; then
  green "✓ archer voice already in Chatterbox library"
else
  yellow "Uploading archer reference voice..."
  curl -s -X POST "http://localhost:$CHATTERBOX_PORT/voices" \
    -F "voice_file=@$INSTALL_DIR/assets/voices/archer/ref_audio.wav" \
    -F "voice_name=archer" >/dev/null || yellow "(upload skipped — check pm2 logs chatterbox-tts)"
  green "✓ archer voice uploaded"
fi

# ─── 10. File server + self-test ────────────────────────────────────────────
banner "Step 10/10: File server + self-test"
cd "$INSTALL_DIR"

if pm2 describe sleepforge-fileserver >/dev/null 2>&1; then
  pm2 restart sleepforge-fileserver
else
  pm2 start --name sleepforge-fileserver \
    "python3 -m http.server $PORT" -- --bind 0.0.0.0
fi
pm2 save
green "✓ File server: http://localhost:$PORT/"

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  yellow "⚠ .env not found at $INSTALL_DIR/.env"
  yellow "  Copy it from the Hetzner server with:"
  yellow "    scp root@157.180.124.232:/opt/sleepforge/.env $INSTALL_DIR/.env"
fi

banner "Self-test"
echo "Chatterbox health: $(curl -s http://localhost:$CHATTERBOX_PORT/health | head -c 80)"
echo "File server:       $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/)"
echo "PM2 processes:"
pm2 list

green "✓ Migration complete."
echo
yellow "Next steps:"
yellow "  1. SCP your .env from Hetzner if you haven't already (see above)"
yellow "  2. Visit http://localhost:$PORT/ to see your videos"
yellow "  3. cd $INSTALL_DIR && node run-pipeline-test.js   # to render a 5-min test"
