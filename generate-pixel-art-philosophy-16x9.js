import { generatePixelArtImage } from './src/fal.js';
import fs from 'fs';
import path from 'path';

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  throw new Error('FAL_KEY environment variable is required.');
}

const promptFile = path.join('assets', 'philosophy-pixel-art-prompts.txt');
let prompts = [
  'Dark 16:9 pixel art of Socrates calmly drinking hemlock in a stone prison courtyard, students watching in shadow, meaningful trial and courage, stone-mason carved relief feel, no text',
  'Dark 16:9 pixel art of Plato leading a prisoner from a shadowy cave toward a bright open courtyard, the scene expresses enlightenment and the form of truth, natural ancient Greek atmosphere, no text',
  'Dark 16:9 pixel art of Aristotle arranging stone animal figures on a marble table, capturing his classification of forms, detailed Greek library setting, meaningful philosophical order, no text',
  'Dark 16:9 pixel art of Marcus Aurelius in a dim stone chamber overlooking a stormy sea, holding a small scroll, embodying stoic acceptance and inner calm, no text',
  'Dark 16:9 pixel art of Nietzsche walking alone along a curved stone path between ancient ruins under dusk light, suggesting eternal recurrence and personal struggle, no text',
];

if (fs.existsSync(promptFile)) {
  const fileContent = fs.readFileSync(promptFile, 'utf-8');
  const loadedPrompts = fileContent
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (loadedPrompts.length > 0) {
    prompts = loadedPrompts;
  }
}

async function generate() {
  const outputDir = 'assets/images';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const count = Number(process.argv[2]) || 5;
  const random = process.argv.includes('--random');
  const usePrompts = random ? samplePrompts(prompts, count) : prompts.slice(0, count);

  console.log(`Generating ${usePrompts.length} new 16:9 philosophy pixel art images...`);

  for (let i = 0; i < usePrompts.length; i++) {
    const prompt = usePrompts[i];
    const outputPath = path.join(outputDir, `philosophy-16x9-${i + 1}.png`);
    try {
      console.log(`Generating ${i + 1}/${usePrompts.length}: ${prompt}`);
      await generatePixelArtImage(prompt, outputPath);
      console.log(`Saved: ${outputPath}`);
    } catch (error) {
      console.error(`Failed to generate image ${i + 1}:`, error.message || error);
    }
  }

  console.log(`Done generating ${usePrompts.length} 16:9 philosophy images.`);
}

function samplePrompts(arr, n) {
  const copy = [...arr];
  const sample = [];
  while (sample.length < n && copy.length > 0) {
    const idx = Math.floor(Math.random() * copy.length);
    sample.push(copy.splice(idx, 1)[0]);
  }
  return sample;
}

generate();
