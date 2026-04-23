#!/usr/bin/env node

import { generateVoiceoverWithTimestamps } from './src/tts.js';
import fs from 'fs';

const sleepScript = `As you settle into this peaceful moment, let us reflect on the timeless wisdom of the Stoics. Marcus Aurelius reminds us that our life is what our thoughts make it. In the quiet sanctuary of sleep, we find the perfect opportunity to cultivate inner peace.

Consider that every challenge in life is an invitation to practice virtue. When difficulties arise, remember that it is not the event itself that troubles us, but our judgment about it. We cannot control what happens to us, but we can always choose how we respond.

In this sacred space between wakefulness and dreams, let go of the day's burdens. Flow with the natural rhythm of life, accepting what you cannot change and changing what you can. The obstacle becomes the way, and every ending is a new beginning.

Sleep deeply, knowing that tomorrow brings fresh opportunities to live according to nature's design. You are part of something much larger than yourself - the eternal dance of the universe. Rest well, and awaken renewed.`;

async function generateArcherVoice() {
  console.log('🎤 Generating YOUR cloned Archer voice (F5-TTS)...');
  console.log('📝 Using reference files from ElevenLabs_test_archer.mp3');
  console.log('🎵 Sleep-optimized pacing (0.90 speed) for maximum quality');
  console.log('⏳ This will take 2-5 minutes...\n');

  try {
    const outputPath = '/opt/sleepforge/assets/voice-samples/sleep-archer-cloned.mp3';
    const voiceId = 'cloned-niels';

    const result = await generateVoiceoverWithTimestamps(sleepScript, voiceId, outputPath);

    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log('\n🎉 SUCCESS! Your cloned Archer voice is ready!');
      console.log(`📁 Saved to: ${outputPath}`);
      console.log(`⏱️  Duration: ~${Math.round(result.duration)}s`);
      console.log(`📊 File size: ${Math.round(stats.size / 1024)}KB`);
      console.log('🎧 This should sound exactly like your ElevenLabs Archer sample!');
    } else {
      console.log('\n❌ File was not created. There may have been an error.');
    }

  } catch (error) {
    console.error('\n❌ Failed to generate cloned Archer voice:', error.message);
    console.log('🔄 You can try again or use the Kokoro voices as backup.');
  }
}

generateArcherVoice();