import { generateVoiceoverWithTimestamps, setPacingOverride } from './src/tts.js';
import fs from 'fs';

const voices = [
  'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
  'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis'
];

const text = `Welcome to a calm evening of rest. Let your thoughts soften and your body relax. Breathe slowly and gently. Imagine the light fading around you as your mind drifts into a quiet dream. Every breath brings deeper peace and comfort.`;

async function generateAll() {
  console.log('Generating all Kokoro male voices with slight sleep pacing...');
  setPacingOverride({
    speed: 0.92,
    stability: 0.55,
    style: 0.35,
    label: 'sleep-lightly-slow'
  });

  for (const voice of voices) {
    const outputPath = `assets/voice-samples/kokoro-${voice}-sleep-0.92.mp3`;
    try {
      if (fs.existsSync(outputPath)) {
        console.log(`Skipping existing file: ${outputPath}`);
        continue;
      }
      console.log(`Generating ${voice} → ${outputPath}`);
      await generateVoiceoverWithTimestamps(text, voice, outputPath);
      console.log(`Saved ${outputPath}`);
    } catch (error) {
      console.error(`Failed for ${voice}:`, error.message || error);
    }
  }
  console.log('All Kokoro male voice generation complete.');
}

generateAll();