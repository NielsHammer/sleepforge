import axios from "axios";
import fs from "fs";
import path from "path";

const FAL_KEY = process.env.FAL_KEY;
const FAL_BASE = "https://queue.fal.run";

/**
 * Generate a pixel art image using Fal.ai Flux Pro with pixel art style.
 */
export async function generatePixelArtImage(prompt, outputPath) {
  const pixelArtPrompt = `${prompt}, extremely pixelated 16-bit style with thousands of tiny square pixels, stone-mason carved relief feel, meaningful philosophical narrative, natural classical philosophy atmosphere, calm scholarly mood, ancient Greek and Mediterranean textures, deep dark shadows and black stone tones, crisp bright white highlights, high resolution 4K HD sharpness, marble and terracotta details, limited palette, dramatic contrast, cinematic 16:9 frame, no text, no letters, no signage`;

  const resp = await axios.post(
    "https://fal.run/fal-ai/flux-pro/v1.1",
    {
      prompt: pixelArtPrompt,
      image_size: "landscape_16_9",
      num_images: 1,
    },
    {
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const imageUrl = resp.data.images[0].url;
  const imgResp = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });

  fs.writeFileSync(outputPath, Buffer.from(imgResp.data));
  return outputPath;
}

export async function generateChalkboardImage(prompt, outputPath) {
  const chalkboardPrompt = `${prompt}, chalk drawing on blackboard, rough hand-drawn style, visible chalk dust and scratches, bare blackboard background, white chalk and grey highlights, no text, no letters, no caption`;

  const resp = await axios.post(
    "https://fal.run/fal-ai/flux-pro/v1.1",
    {
      prompt: chalkboardPrompt,
      image_size: "landscape_16_9",
      num_images: 1,
    },
    {
      headers: {
        Authorization: `Key ${FAL_KEY}`,
        "Content-Type": "application/json",
      },
      timeout: 60000,
    }
  );

  const imageUrl = resp.data.images[0].url;
  const imgResp = await axios.get(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });

  fs.writeFileSync(outputPath, Buffer.from(imgResp.data));
  return outputPath;
}