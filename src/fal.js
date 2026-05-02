import axios from "axios";
import fs from "fs";
import path from "path";

const FAL_KEY = process.env.FAL_KEY;

// SleepForge image generator — Flux Schnell only.
//
// Flux Schnell costs ~$0.003/image vs Flux Pro at ~$0.05/image (≈17x cheaper).
// At our chalk-on-blackboard style, Schnell's slightly looser detail actually
// reads more like rough chalk than Pro's photoreal precision — so cheaper AND better.
//
// Endpoint: https://fal.run/fal-ai/flux/schnell
// Params: prompt, image_size (landscape_16_9), num_inference_steps (default 4)

const FLUX_SCHNELL_URL = "https://fal.run/fal-ai/flux/schnell";

const TRANSIENT_CODES = new Set(["EPIPE", "ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "ENETUNREACH", "EAI_AGAIN"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTransient(err) {
  if (TRANSIENT_CODES.has(err?.code)) return true;
  const status = err?.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return false;
}

async function callFluxSchnell(prompt, outputPath, opts = {}) {
  if (!FAL_KEY) throw new Error("FAL_KEY env var not set");
  const maxAttempts = opts.maxAttempts ?? 5;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await axios.post(
        FLUX_SCHNELL_URL,
        {
          prompt,
          image_size: opts.imageSize || "landscape_16_9",
          num_images: 1,
          num_inference_steps: opts.steps || 4,
          enable_safety_checker: false,
        },
        {
          headers: {
            Authorization: `Key ${FAL_KEY}`,
            "Content-Type": "application/json",
          },
          timeout: 120000,
        }
      );

      const imageUrl = resp.data.images[0].url;
      const imgResp = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
      });

      fs.writeFileSync(outputPath, Buffer.from(imgResp.data));
      return outputPath;
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransient(err)) throw err;
      const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 16000) + Math.floor(Math.random() * 500);
      const tag = err.code || err.response?.status || err.message;
      console.warn(`  Flux Schnell attempt ${attempt}/${maxAttempts} failed (${tag}) — retrying in ${backoffMs}ms`);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

/**
 * Generate a scene-aware chalk image using the locked test10 style.
 * Takes a fully-formed prompt from craftImagePrompt() in script-generator.js.
 * This is the production image generator for the pipeline.
 */
export async function generateSceneImage(prompt, outputPath) {
  return callFluxSchnell(prompt, outputPath);
}

/**
 * Direct chalkboard-style generation (for ad-hoc batch scripts).
 * Wraps the prompt with chalk-style hints.
 */
export async function generateChalkboardImage(prompt, outputPath) {
  const chalkboardPrompt = `${prompt}, chalk drawing on blackboard, rough hand-drawn style, visible chalk dust and scratches, bare blackboard background, white chalk and grey highlights, no text, no letters, no caption`;
  return callFluxSchnell(chalkboardPrompt, outputPath);
}

/**
 * Legacy pixel-art helper — kept for compatibility with older test scripts.
 * Now also routes through Schnell.
 */
export async function generatePixelArtImage(prompt, outputPath) {
  const pixelArtPrompt = `${prompt}, extremely pixelated 16-bit style with thousands of tiny square pixels, stone-mason carved relief feel, meaningful philosophical narrative, natural classical philosophy atmosphere, calm scholarly mood, ancient Greek and Mediterranean textures, deep dark shadows and black stone tones, crisp bright white highlights, marble and terracotta details, limited palette, dramatic contrast, cinematic 16:9 frame, no text, no letters, no signage`;
  return callFluxSchnell(pixelArtPrompt, outputPath);
}
