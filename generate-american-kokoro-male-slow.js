import { generateVoiceoverWithTimestamps, setPacingOverride } from './src/tts.js';

async function generateImprovedAmericanMale() {
  console.log('Generating improved American male Kokoro sleep voice sample...');

  setPacingOverride({
    speed: 0.80,
    stability: 0.55,
    style: 0.30,
    label: 'sleep-slow high-quality'
  });

  const sleepText = `Welcome to your peaceful sleep journey. Let your mind drift gently into the realm of dreams. Feel the warmth of relaxation spreading through your body. Breathe deeply and slowly. Allow yourself to surrender to the gentle embrace of sleep.`;

  try {
    const result = await generateVoiceoverWithTimestamps(
      sleepText,
      'kokoro-american-male',
      'assets/voice-samples/sleep-american-kokoro-male-high-quality-slow.mp3'
    );
    console.log('Generated improved sample:', result.audioPath);
    console.log('Duration:', result.duration.toFixed(2), 'seconds');
  } catch (error) {
    console.error('Error generating improved American male Kokoro sample:', error);
    process.exit(1);
  }
}

generateImprovedAmericanMale();