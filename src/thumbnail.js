import { generateSceneImage } from "./fal.js";

// ─── SleepForge Thumbnail Generator ─────────────────────────────────────────
// Flux Schnell + philosophy dark aesthetic. No text in the image — YouTube
// adds the title overlay separately. Single Schnell call (~$0.003).

const KNOWN_PHILOSOPHERS = [
  "Marcus Aurelius", "Seneca", "Epictetus", "Socrates", "Plato", "Aristotle",
  "Diogenes", "Heraclitus", "Pythagoras", "Zeno", "Cicero", "Epicurus",
  "Parmenides", "Empedocles", "Anaximander", "Thales", "Xenophon", "Plutarch",
  "Lucretius", "Boethius",
];

function pickThumbnailPhilosopher(topic, scenes) {
  // 1. Topic title trumps everything — "Marcus Aurelius on Letting Go" → Marcus Aurelius
  const topicLower = (topic || "").toLowerCase();
  for (const name of KNOWN_PHILOSOPHERS) {
    if (topicLower.includes(name.toLowerCase())) return name;
  }
  // 2. Otherwise the most-mentioned scene philosopher
  const counts = {};
  for (const s of scenes || []) {
    const p = s.philosopher;
    if (p) counts[p] = (counts[p] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || "an ancient Greek philosopher";
}

export async function generateThumbnail(topic, scenes, outputPath) {
  const topPhilosopher = pickThumbnailPhilosopher(topic, scenes);

  const prompt =
    `Cinematic 16:9 thumbnail composition. ${topPhilosopher} in profile silhouette, ` +
    `seated and contemplative, against a vast dark blackboard background. ` +
    `Hand-drawn white chalk strokes radiate from the figure, swirling chalk dust, ` +
    `single crumbling Greek Doric column to the side, deep shadows, ` +
    `monochrome white-and-grey chalk only — no color, no warm tones, no neon. ` +
    `Heavy chalk texture on the figure, atmospheric depth, calm meditative mood. ` +
    `No text, no letters, no writing in the image. ` +
    `NOT a photograph, NOT photorealistic — pure chalk drawing on blackboard.`;

  console.log(`  Thumbnail subject: ${topPhilosopher}`);
  await generateSceneImage(prompt, outputPath);
  return outputPath;
}
