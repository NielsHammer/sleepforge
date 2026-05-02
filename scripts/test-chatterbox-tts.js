import "dotenv/config";
import { generateVoiceoverWithTimestamps } from "../src/tts.js";
import { isHealthy } from "../src/chatterbox.js";

const healthy = await isHealthy();
console.log(`Chatterbox healthy: ${healthy}`);

const text = "Marcus Aurelius walks slowly through the empty colonnade. The night is cool. The world is settling.";
const out = "/tmp/sf-tts-smoke.wav";
const t0 = Date.now();
await generateVoiceoverWithTimestamps(text, "af_heart", out);
const dt = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`Wrote ${out} in ${dt}s`);
