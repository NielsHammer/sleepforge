import { generateVoiceoverWithTimestamps } from './src/tts.js';

async function generateMaleKokoroSamples() {
  console.log('Generating British male Kokoro voice sample...');

  const britishText = `Welcome to your peaceful sleep journey. Let your mind drift gently into the realm of dreams. Feel the warmth of relaxation spreading through your body. Breathe deeply and slowly. Allow yourself to surrender to the gentle embrace of sleep.`;

  try {
    const britishResult = await generateVoiceoverWithTimestamps(britishText, 'kokoro-british-male', 'assets/voice-samples/sleep-british-kokoro-male.mp3');
    console.log('British male voice generated successfully:', britishResult.outputPath);
  } catch (error) {
    console.error('Error generating British male voice:', error);
  }

  console.log('Generating American male Kokoro voice sample...');

  const americanText = `Welcome to your peaceful sleep journey. Let your mind drift gently into the realm of dreams. Feel the warmth of relaxation spreading through your body. Breathe deeply and slowly. Allow yourself to surrender to the gentle embrace of sleep.`;

  try {
    const americanResult = await generateVoiceoverWithTimestamps(americanText, 'kokoro-american-male', 'assets/voice-samples/sleep-american-kokoro-male.mp3');
    console.log('American male voice generated successfully:', americanResult.outputPath);
  } catch (error) {
    console.error('Error generating American male voice:', error);
  }
}

generateMaleKokoroSamples();