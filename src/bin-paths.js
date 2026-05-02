// Absolute paths for binaries we spawn from Node.
//
// Why this exists: Node child_process.spawn / execSync don't inherit the
// shell's PATH the way an interactive terminal does — the venv `activate`
// script and Homebrew shellenv only run in interactive shells. So a bare
// "python3" or "whisper" can fail with ENOENT on a Mac. Every caller imports
// from here so a single env var (PYTHON_BIN, WHISPER_BIN) overrides the
// default everywhere at once.
//
// Defaults assume Homebrew on Apple Silicon. migrate-to-mac.sh writes the
// resolved absolute paths into .env so dotenv loads them at process start.

export const PYTHON_BIN =
  process.env.PYTHON_BIN || "/opt/homebrew/opt/python@3.11/bin/python3.11";

export const WHISPER_BIN =
  process.env.WHISPER_BIN || "/opt/homebrew/opt/python@3.11/bin/whisper";
