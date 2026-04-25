import { generatePixelArtImage } from './src/fal.js';
import fs from 'fs';
import path from 'path';

async function generatePixelArtSamples() {
  // Read the prompts file
  const promptsPath = 'assets/pixel-art-prompts-sleepforge.txt';
  const prompts = fs.readFileSync(promptsPath, 'utf-8').split('\n').filter(line => line.trim());

  // Take first 10 prompts
  const samplePrompts = prompts.slice(0, 10);

  // Create output directory
  const outputDir = 'assets/images';
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('Generating 10 pixel art sample images...');

  for (let i = 0; i < samplePrompts.length; i++) {
    const prompt = samplePrompts[i];
    const outputPath = path.join(outputDir, `pixel-art-sample-${i + 1}.png`);

    try {
      console.log(`Generating image ${i + 1}/10: ${prompt.substring(0, 50)}...`);
      await generatePixelArtImage(prompt, outputPath);
      console.log(`Saved: ${outputPath}`);
    } catch (error) {
      console.error(`Failed to generate image ${i + 1}:`, error.message);
    }
  }

  console.log('All 10 sample images generated!');
}

generatePixelArtSamples();