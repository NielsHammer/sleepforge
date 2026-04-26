import axios from "axios";
import fs from "fs";
import path from "path";

const FAL_KEY = process.env.FAL_KEY;
const outputDir = "assets/images/sleepless-philosophers/test10";
fs.mkdirSync(outputDir, { recursive: true });

// STRICT style block — modeled exactly on seneca-storm.png (the approved reference)
// Rules from Niels:
//   - Medium distance, 3/4 body or full figure — NEVER close-up face
//   - Strong action or gesture
//   - Swirling chalk atmospheric elements AROUND the figure (wind, dust, waves, debris)
//   - Single column or minimal Greek architectural element
//   - Pure white chalk on black blackboard — STRICTLY monochrome
//   - NO light sources: no fire, no candle, no lantern, no stars, no glow, no flame
//   - NO warm tones, no color, no gold, no orange, no brown skin
//   - Chalk stroke texture visible on everything including face and hands

const stylePrefix = "Chalk street art drawing on dark blackboard, rough imperfect white chalk strokes on pure black surface, visible chalk dust and smudges, heavy chalk texture on all surfaces including skin and clothing, strictly monochrome white and grey chalk only, absolutely no color no warm tones no gold no orange no brown, NOT a photograph NOT photorealistic NOT a painting, hand-drawn chalk lines only,";
const styleSuffix = "medium distance three-quarter body shot, dark blackboard texture background visible, chalk dust particles in air, no light sources no fire no candle no lantern no glow no flame no stars, no text no writing no words no letters, 16:9 landscape composition";

const prompts = [
  {
    name: "socrates-trial",
    prompt: `${stylePrefix} Socrates in toga standing defiant before unseen accusers, one arm raised in argument, chalk-drawn swirling dust clouds billowing around his feet, single crumbling Doric column behind him, toga folds rendered in rough scratchy chalk strokes, ${styleSuffix}`,
  },
  {
    name: "plato-allegory",
    prompt: `${stylePrefix} Plato in flowing toga turning away from chalk-drawn shadow shapes on a cave wall, one hand reaching forward into empty dark space, rough chalk cave outline around him, chalk dust swirling in the air between shadow and figure, single broken column fragment on the ground, ${styleSuffix}`,
  },
  {
    name: "aristotle-walking",
    prompt: `${stylePrefix} Aristotle in toga walking forward mid-stride with purposeful gesture, one hand extended making a philosophical point, chalk-drawn wind sweeping his robes and hair, swirling chalk dust clouds trailing behind him, single Ionic column fading in background, ${styleSuffix}`,
  },
  {
    name: "marcus-aurelius-stoic",
    prompt: `${stylePrefix} Marcus Aurelius in Roman toga and laurel wreath standing with arms folded across chest in stoic composure, chalk-drawn crashing waves and turbulent sea swirling around his legs, crumbling Corinthian column beside him, his figure unmoved and calm against the chaos, ${styleSuffix}`,
  },
  {
    name: "diogenes-defiant",
    prompt: `${stylePrefix} Diogenes the Cynic in tattered robes sitting defiantly inside a large chalk-drawn barrel on its side, one arm draped over the rim gesturing dismissively, swirling chalk wind and debris blowing around the barrel, broken column fragments scattered nearby, wild unkempt beard and hair drawn in rough chalk scratches, ${styleSuffix}`,
  },
];

async function generateImage(prompt, outputPath) {
  const resp = await axios.post(
    "https://fal.run/fal-ai/flux-pro/v1.1",
    {
      prompt,
      image_size: "landscape_16_9",
      num_images: 1,
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
}

(async () => {
  console.log(`Generating 5 images using seneca-storm style reference into ${outputDir}/`);
  console.log("Style: medium distance, chalk strokes, swirling atmosphere, no light sources, strict monochrome\n");
  for (let i = 0; i < prompts.length; i++) {
    const { name, prompt } = prompts[i];
    const outputPath = path.join(outputDir, `${name}.png`);
    console.log(`[${i + 1}/5] ${name}`);
    try {
      await generateImage(prompt, outputPath);
      console.log(`  done: ${outputPath}`);
    } catch (err) {
      console.error(`  FAILED: ${err.message || err}`);
    }
  }
  console.log("\nAll done. View at http://157.180.124.232:8080/assets/images/sleepless-philosophers/test10/");
})();
