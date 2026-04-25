import { generatePixelArtImage } from './src/fal.js';
import fs from 'fs';
import path from 'path';

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  throw new Error('FAL_KEY environment variable is required.');
}

const prompts = [
  'Dark stone-carved 16-bit pixel art of Socrates carved in black marble with glowing white highlights, in a shadowy Greek agora, clearly detailed old man face, mysterious philosophy atmosphere',
  'Dark stone-carved 16-bit pixel art of Aristotle\'s metaphysics sphere etched into black marble, bright white glowing idea particles swirling, ancient academy ruins',
  'Dark stone-carved 16-bit pixel art of Descartes as a cold stone thinker in a shadowy temple, bright white cogito text etched in marble, high contrast mysterious feel',
  'Dark stone-carved 16-bit pixel art of Nietzsche\'s eternal recurrence wheel carved in black stone, cracked face of Nietzsche glowing with bright white detail, dramatic dark purple-black background',
  'Dark stone-carved 16-bit pixel art of civil disobedience march through black marble streets, bright white protest signs and shadowy stone figures, deep mysterious philosophy vibe',
];

async function generate() {
  const outputDir = 'assets/images';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Generating 5 random philosophy pixel art images...');

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const outputPath = path.join(outputDir, `philosophy-random-${i + 1}.png`);
    try {
      console.log(`Generating ${i + 1}/5: ${prompt}`);
      await generatePixelArtImage(prompt, outputPath);
      console.log(`Saved: ${outputPath}`);
    } catch (error) {
      console.error(`Failed to generate image ${i + 1}:`, error.message || error);
    }
  }

  console.log('Done generating the 5 random philosophy images.');
}

generate();
