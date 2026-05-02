import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { PYTHON_BIN } from "./bin-paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PY = path.join(__dirname, "audio-pauses.py");

// Inserts natural pauses at sentence/clause boundaries using whisper word
// timestamps, then re-runs whisper on the result so subtitle timestamps are
// re-aligned to the new audio.
//
// Why post-process instead of pre-chunking TTS by sentence:
//   - Doesn't burn additional TTS time (Kokoro on CPU = ~17s per chunk)
//   - Doesn't require new TTS calls if the audio is already cached
//   - Independent of voice engine (Kokoro/F5/etc. all benefit)

export function insertSentencePauses(inputWav, whisperJson, outputWav, opts = {}) {
  const { periodMs = 350, commaMs = 120, paragraphMs = 700 } = opts;
  const cmd =
    `"${PYTHON_BIN}" "${PY}" "${inputWav}" "${whisperJson}" "${outputWav}" ` +
    `--period-ms ${periodMs} --comma-ms ${commaMs} --paragraph-ms ${paragraphMs}`;
  const out = execSync(cmd, { stdio: ["pipe", "pipe", "pipe"], timeout: 120000 });
  return out.toString();
}
