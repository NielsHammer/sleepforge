#!/usr/bin/env node

import { generateVoiceoverWithTimestamps } from './src/tts.js';
import fs from 'fs';

const sleepScript = `As you settle into this peaceful moment, let us reflect on the timeless wisdom of the Stoics. Marcus Aurelius reminds us that our life is what our thoughts make it. In the quiet sanctuary of sleep, we find the perfect opportunity to cultivate inner peace.

Consider that every challenge in life is an invitation to practice virtue. When difficulties arise, remember that it is not the event itself that troubles us, but our judgment about it. We cannot control what happens to us, but we can always choose how we respond.

In this sacred space between wakefulness and dreams, let go of the day's burdens. Flow with the natural rhythm of life, accepting what you cannot change and changing what you can. The obstacle becomes the way, and every ending is a new beginning.

Sleep deeply, knowing that tomorrow brings fresh opportunities to live according to nature's design. You are part of something much larger than yourself - the eternal dance of the universe. Rest well, and awaken renewed.`;

async function generateKokoroSamples() {
  console.log('🎤 Generating British & American Kokoro sleep voices...\n');

  const voices = [
    {
      id: 'kokoro-british',
      name: 'British Sleep Voice',
      output: '/opt/sleepforge/assets/voice-samples/sleep-british-kokoro.mp3',
      description: 'Elegant British female voice (bf_alice) - perfect for sophisticated sleep content'
    },
    {
      id: 'kokoro-american',
      name: 'American Sleep Voice',
      output: '/opt/sleepforge/assets/voice-samples/sleep-american-kokoro.mp3',
      description: 'Warm American female voice (af_nicole) - comforting and familiar'
    }
  ];

  for (const voice of voices) {
    try {
      console.log(`🎵 Generating: ${voice.name}`);
      console.log(`📝 ${voice.description}`);

      const result = await generateVoiceoverWithTimestamps(sleepScript, voice.id, voice.output);

      if (fs.existsSync(voice.output)) {
        const stats = fs.statSync(voice.output);
        console.log(`✅ Success! Duration: ~${Math.round(result.duration)}s, Size: ${Math.round(stats.size / 1024)}KB`);
        console.log(`📁 Saved to: ${voice.output}\n`);
      } else {
        console.log(`❌ File not created for ${voice.name}\n`);
      }

    } catch (error) {
      console.error(`❌ Failed to generate ${voice.name}:`, error.message);
      console.log('');
    }
  }

  console.log('🎧 Kokoro voice samples ready! Now working on your cloned Archer voice...');
}

generateKokoroSamples();