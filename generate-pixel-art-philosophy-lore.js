import { generatePixelArtImage } from './src/fal.js';
import fs from 'fs';
import path from 'path';

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  throw new Error('FAL_KEY environment variable is required.');
}

const prompts = [
  'Dark pixelated Greek temple carved from stone, Aristotle as a glowing stone relief ghost, black marble walls, bright white chisel detail, medieval philosophy atmosphere',
  'Stone-mason style mind and body duality carved into a black marble wall in a chilly Greek agora, glowing pixelated eyes and bright white highlights',
  'Plato\'s cave rendered as dark stone block pixels with shadowy prisoners and a bright white fire centerpiece, mysterious ancient atmosphere',
  'Twisted Greek statue of the paradoxical liar emerging from carved stone relief, intense bright detail on the face, deep shadows and cold marble texture',
  'Cold monastery library with Nietzsche\'s eternal recurrence wheel carved in stone, tiny pixel mosaic squares, vibrant white detail against dark purple-black background',
];

async function generate() {
  const outputDir = 'assets/images';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Generating 5 new philosophy pixel art images...');

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const outputPath = path.join(outputDir, `philosophy-pixel-art-${i + 1}.png`);
    try {
      console.log(`Generating ${i + 1}/5: ${prompt}`);
      await generatePixelArtImage(prompt, outputPath);
      console.log(`Saved: ${outputPath}`);
    } catch (error) {
      console.error(`Failed to generate image ${i + 1}:`, error.message || error);
    }
  }

  console.log('Done generating the 5 philosophy images.');
}

generate();
