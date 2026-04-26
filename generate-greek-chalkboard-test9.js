import axios from "axios";
import fs from "fs";
import path from "path";

const FAL_KEY = process.env.FAL_KEY;
const outputDir = "assets/images/sleepless-philosophers/test9";

const stylePrefix = "Professional chalk street art on dark blackboard surface, rough expressive hand-drawn white chalk lines, imperfect strokes, visible chalk dust and smudges, ancient Greek setting,";
const styleSuffix = "close-up portrait or medium close shot, dark blackboard texture background, no text, no writing, no words, no letters, no caption, no border, 16:9 landscape";

const prompts = [
  {
    name: "socrates-hemlock",
    prompt: `${stylePrefix} Socrates in a white toga lifting a cup of hemlock to his lips with a calm steady hand, his weathered face serene and resolute, a single Doric column behind him, Mediterranean evening light, ${styleSuffix}`,
  },
  {
    name: "plato-cave-light",
    prompt: `${stylePrefix} Plato in flowing robes turning his head toward a beam of light breaking through darkness, one hand raised to shield his eyes, rough stone cave wall behind, olive branch shadow, ${styleSuffix}`,
  },
  {
    name: "aristotle-examining-shell",
    prompt: `${stylePrefix} Aristotle in a toga holding a seashell up close and examining it with intense curiosity, weathered hands, grey beard, a single marble column fragment beside him, ${styleSuffix}`,
  },
  {
    name: "diogenes-lantern",
    prompt: `${stylePrefix} Diogenes the Cynic holding a lit lantern up in daylight searching for an honest man, wild unkempt beard, tattered cloak, defiant expression, Athenian agora column in background, ${styleSuffix}`,
  },
  {
    name: "marcus-aurelius-writing",
    prompt: `${stylePrefix} Marcus Aurelius in Roman toga writing meditations on a scroll by candlelight, stoic calm face, laurel wreath on head, Mediterranean night, single olive tree branch visible, ${styleSuffix}`,
  },
  {
    name: "epictetus-teaching",
    prompt: `${stylePrefix} Epictetus the Stoic philosopher in a simple toga leaning forward passionately teaching, one hand raised making a point, humble surroundings, cracked Ionic column behind, ${styleSuffix}`,
  },
  {
    name: "pythagoras-geometry",
    prompt: `${stylePrefix} Pythagoras in white robes tracing a triangle in the air with his finger, mystical focused expression, sacred geometry symbols floating faintly, Greek temple portico behind, ${styleSuffix}`,
  },
  {
    name: "heraclitus-fire",
    prompt: `${stylePrefix} Heraclitus the weeping philosopher gazing into a small flame he holds in his cupped hands, melancholic intense expression, dark wild hair and beard, rough stone wall behind, ${styleSuffix}`,
  },
  {
    name: "seneca-storm",
    prompt: `${stylePrefix} Seneca standing perfectly calm and composed while chalk-drawn storm winds swirl around him, toga billowing, arms crossed over chest, Corinthian column crumbling behind him, ${styleSuffix}`,
  },
  {
    name: "hypatia-astrolabe",
    prompt: `${stylePrefix} Hypatia of Alexandria holding an astrolabe up toward a starry sky, scholarly robes, confident intelligent expression, lighthouse of Alexandria faintly visible behind, ${styleSuffix}`,
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
  console.log(`Generating 10 Greek chalkboard philosopher images into ${outputDir}/`);
  for (let i = 0; i < prompts.length; i++) {
    const { name, prompt } = prompts[i];
    const outputPath = path.join(outputDir, `${name}.png`);
    console.log(`\n[${i + 1}/10] ${name}`);
    try {
      await generateImage(prompt, outputPath);
      console.log(`  ✓ Saved: ${outputPath}`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message || err}`);
    }
  }
  console.log("\nDone! All images saved to " + outputDir);
})();
