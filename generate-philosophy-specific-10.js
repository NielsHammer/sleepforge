import { generatePixelArtImage } from './src/fal.js';
import fs from 'fs';
import path from 'path';

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  throw new Error('FAL_KEY environment variable is required.');
}

const outputDir = path.join('assets', 'images', 'test7');
const baseOutputDir = path.join('assets', 'images');
if (fs.existsSync(baseOutputDir)) {
  fs.rmSync(baseOutputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

const entries = [
  {
    title: 'Socrates Cross-Examining a Youth',
    reason: 'Socrates is the foundation of Western philosophy, and this prompt focuses on his intense questioning in a raw chalkboard style.',
    prompt: 'Dark 16:9 chalk drawing on blackboard of Socrates leaning forward and questioning a young man, close medium shot, rough scratchy white chalk lines, heavy chalk dust, visible smudges, bare blackboard background, no text, no letters, no caption',
  },
  {
    title: 'Plato Guiding the Prisoner',
    reason: 'Plato should be shown as the main action in rough chalk, with no scene background taking attention away from the figure.',
    prompt: 'Dark 16:9 chalk drawing on blackboard of Plato pointing toward a shaft of light while touching a chained prisoner\'s shoulder, close medium shot, rough hand-drawn white chalk strokes, chalk dust smears, uneven scratchy lines, bare blackboard background, no text, no letters, no caption',
  },
  {
    title: 'Aristotle Writing Definitions',
    reason: 'Aristotle should feel like a fast chalk sketch of a philosopher actively writing, not a detailed environment.',
    prompt: 'Dark 16:9 chalk drawing on blackboard of Aristotle writing on a small tablet, close medium shot, rough uneven chalk lines, heavy chalk dust and smudges, bare blackboard background, no text, no letters, no caption',
  },
  {
    title: 'Marcus Aurelius Writing',
    reason: 'Marcus should be rendered with raw chalk energy and a minimal blackboard backdrop, with the body and hand action remaining the focus.',
    prompt: 'Dark 16:9 chalk drawing on blackboard of Marcus Aurelius writing with a quill, close medium shot, thick rough chalk strokes, heavy chalk dust, visible scratch marks, bare blackboard background, no text, no letters, no caption',
  },
  {
    title: 'Buddha Opening His Eyes',
    reason: 'Buddha should read as a rough sacred chalkboard sketch, with the figure emerging from raw chalk texture and no detailed background.',
    prompt: 'Dark 16:9 chalk drawing on blackboard of Buddha opening his eyes in meditation with hands in dhyana mudra, close medium shot, rough scratched chalk texture, soft chalk dust smudges, bare blackboard background, no text, no letters, no caption',
  },
];

fs.writeFileSync(path.join(outputDir, 'philosophy-specific-10-metadata.json'), JSON.stringify(entries, null, 2));

async function generate() {
  console.log('Generating 5 raw chalk-on-blackboard philosophy images in assets/images/test7...');

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    console.log(`\n${i + 1}. ${entry.title}`);
    console.log(`Reason: ${entry.reason}`);
    console.log(`Prompt: ${entry.prompt}`);

    const outputPath = path.join(outputDir, `philosophy-specific-10-${i + 1}.png`);
    try {
      await generatePixelArtImage(entry.prompt, outputPath);
      console.log(`Saved: ${outputPath}`);
    } catch (error) {
      console.error(`Failed to generate ${entry.title}:`, error.message || error);
    }
  }

  console.log('\nDone generating 5 raw chalk-on-blackboard philosophy images in assets/images/test7.');
}

generate();
