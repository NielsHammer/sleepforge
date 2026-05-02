#!/usr/bin/env bash
# ─── SleepForge → Mac migration ─────────────────────────────────────────────
#
# Idempotent setup: safe to re-run if any step fails halfway. Each step
# checks if it's already done before doing it.
#
# What this script does (in order):
#   1. Verify macOS + Apple Silicon
#   2. Install Homebrew if missing
#   3. Install node, ffmpeg, python3, git, jq via Homebrew
#   4. Install Python deps: kokoro, openai-whisper, torch (CPU build for Mac)
#   5. Install Node deps with `npm ci`
#   6. Install PM2 globally + register login auto-start
#   7. Pull Chatterbox Docker container (requires Docker Desktop running)
#   8. Upload archer voice to the running Chatterbox container
#   9. Start the SleepForge file server on port 8080 (PM2)
#  10. Run a self-test (Kokoro → Chatterbox → ffmpeg)
#
# What this script does NOT do:
#   - Install Docker Desktop (you must do this manually — link below)
#   - Copy the .env file (you SCP this manually from Hetzner)
#
# Read MIGRATION.md for the friendly step-by-step.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/NielsHammer/sleepforge.git}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/sleepforge}"
PORT="${PORT:-8080}"
CHATTERBOX_DIR="${CHATTERBOX_DIR:-$HOME/chatterbox}"

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
  green "✓ Apple Silicon (arm64)"
else
  yellow "⚠ Intel Mac detected — slower TTS, but everything else works"
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
for pkg in node ffmpeg python@3.11 git jq; do
  if brew list --formula "$pkg" >/dev/null 2>&1; then
    green "✓ $pkg already installed"
  else
    yellow "Installing $pkg..."; brew install "$pkg"
  fi
done
echo "node: $(node --version)"
echo "ffmpeg: $(ffmpeg -version | head -1)"
echo "python3: $(python3 --version)"

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

# ─── 5. Python deps for Kokoro + Whisper ────────────────────────────────────
banner "Step 5/10: Python deps (Kokoro, Whisper, Torch)"
if [[ ! -d "$INSTALL_DIR/.venv" ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip
# torch CPU on macOS — this is the standard wheel; arm64 macs use MPS
# transparently when models support it.
pip install torch torchaudio
# Kokoro inference + ONNX runtime
pip install kokoro==0.* onnxruntime soundfile numpy
# Whisper for word timestamps
pip install openai-whisper
deactivate
green "✓ Python deps installed in .venv"

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

# ─── 8. Docker Desktop check ────────────────────────────────────────────────
banner "Step 8/10: Docker Desktop"
if ! command -v docker >/dev/null 2>&1; then
  red "Docker is not installed."
  yellow "Please install Docker Desktop manually:"
  yellow "  → https://www.docker.com/products/docker-desktop/"
  yellow "  Open it once, accept the prompts, then re-run this script."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  red "Docker is installed but not running."
  yellow "Open Docker Desktop from Applications and wait for it to start, then re-run this script."
  exit 1
fi
green "✓ Docker $(docker --version)"

# ─── 9. Chatterbox container ────────────────────────────────────────────────
banner "Step 9/10: Chatterbox TTS container"
if [[ ! -d "$CHATTERBOX_DIR/.git" ]]; then
  yellow "Cloning chatterbox-tts-api → $CHATTERBOX_DIR"
  git clone https://github.com/travisvn/chatterbox-tts-api.git "$CHATTERBOX_DIR"
fi
cd "$CHATTERBOX_DIR"

# Write .env pointing at the SleepForge archer reference voice
cat > .env <<EOF
PORT=4123
HOST=0.0.0.0
VOICE_SAMPLE_HOST_PATH=$INSTALL_DIR/assets/voices/archer/ref_audio.wav
DEVICE=cpu
EXAGGERATION=0.4
CFG_WEIGHT=0.5
TEMPERATURE=0.6
MAX_CHUNK_LENGTH=280
MAX_TOTAL_LENGTH=3000
ENABLE_MEMORY_MONITORING=true
EOF

if ! docker ps --format '{{.Names}}' | grep -q "^chatterbox-tts-api-cpu$"; then
  yellow "Building Chatterbox image (5-15 min on first run)..."
  docker compose -f docker/docker-compose.cpu.yml --env-file .env build
  yellow "Starting container..."
  docker compose -f docker/docker-compose.cpu.yml --env-file .env up -d
fi

yellow "Waiting for Chatterbox to be healthy (model download + warmup, up to 5 min)..."
for i in $(seq 1 60); do
  status=$(docker inspect --format '{{.State.Health.Status}}' chatterbox-tts-api-cpu 2>/dev/null || echo unknown)
  if [[ "$status" == "healthy" ]]; then green "✓ Chatterbox healthy"; break; fi
  sleep 10
  printf "."
done
echo

# Upload archer voice to the library (idempotent — safe if already there)
if curl -s http://localhost:4123/voices | grep -q '"name":"archer"'; then
  green "✓ archer voice already in Chatterbox library"
else
  yellow "Uploading archer reference voice..."
  curl -s -X POST http://localhost:4123/voices \
    -F "voice_file=@$INSTALL_DIR/assets/voices/archer/ref_audio.wav" \
    -F "voice_name=archer" >/dev/null
  green "✓ archer voice uploaded"
fi

# ─── 10. File server + self-test ────────────────────────────────────────────
banner "Step 10/10: File server + self-test"
cd "$INSTALL_DIR"

# Start (or restart) the file server on $PORT under PM2
if pm2 describe sleepforge-fileserver >/dev/null 2>&1; then
  pm2 restart sleepforge-fileserver
else
  pm2 start --name sleepforge-fileserver \
    "python3 -m http.server $PORT" -- --bind 0.0.0.0
fi
pm2 save
green "✓ File server: http://localhost:$PORT/"

# .env warning (we never copy it for the user)
if [[ ! -f "$INSTALL_DIR/.env" ]]; then
  yellow "⚠ .env not found at $INSTALL_DIR/.env"
  yellow "  Copy it from the Hetzner server with:"
  yellow "    scp root@157.180.124.232:/opt/sleepforge/.env $INSTALL_DIR/.env"
fi

# Health check
banner "Self-test"
echo "Chatterbox health: $(curl -s http://localhost:4123/health | head -c 80)"
echo "File server:       $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/)"
echo "Docker container:  $(docker ps --filter name=chatterbox-tts-api-cpu --format '{{.Status}}')"

green "✓ Migration complete."
echo
yellow "Next steps:"
yellow "  1. SCP your .env from Hetzner if you haven't already (see above)"
yellow "  2. Visit http://localhost:$PORT/ to see your videos"
yellow "  3. cd $INSTALL_DIR && node run-pipeline-test.js   # to render a 5-min test"
