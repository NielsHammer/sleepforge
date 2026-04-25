import { generateVoiceoverWithTimestamps } from './src/tts.js';

async function generateSleepArcher() {
  console.log('Generating sleep-optimized Archer voice sample...');

  const sleepText = `Welcome to your peaceful sleep journey. Let your mind drift gently into the realm of dreams. Feel the warmth of relaxation spreading through your body. Breathe deeply and slowly. Allow yourself to surrender to the gentle embrace of sleep.`;

  try {
    const result = await generateVoiceoverWithTimestamps(sleepText, 'f5-archer', 'assets/voice-samples/sleep-archer-test.wav');
    console.log('Sleep Archer voice generated successfully:', result.audioPath);
  } catch (error) {
    console.error('Error generating sleep Archer voice:', error);
  }
}

generateSleepArcher();