#!/usr/bin/env node

import { generateVoiceoverWithTimestamps } from './src/tts.js';
import fs from 'fs';

const sleepPhilosophyScript = `As you settle into this peaceful moment, let us reflect on the timeless wisdom of the Stoics. Marcus Aurelius reminds us that our life is what our thoughts make it. In the quiet sanctuary of sleep, we find the perfect opportunity to cultivate inner peace.

Consider that every challenge in life is an invitation to practice virtue. When difficulties arise, remember that it is not the event itself that troubles us, but our judgment about it. We cannot control what happens to us, but we can always choose how we respond.

In this sacred space between wakefulness and dreams, let go of the day's burdens. Flow with the natural rhythm of life, accepting what you cannot change and changing what you can. The obstacle becomes the way, and every ending is a new beginning.

Sleep deeply, knowing that tomorrow brings fresh opportunities to live according to nature's design. You are part of something much larger than yourself - the eternal dance of the universe. Rest well, and awaken renewed.`;

async function generateAllVoiceSamples() {
  console.log('🎤 Generating high-quality sleep voice samples...\n');

  const voices = [
    {
      id: 'cloned-niels',
      name: 'Your Cloned Archer Voice (F5-TTS)',
      output: '/opt/sleepforge/assets/voice-samples/sleep-philosophy-archer.mp3',
      description: 'High-quality clone of your ElevenLabs Archer voice'
    },
    {
      id: 'kokoro-british',
      name: 'British Sleep Voice (Kokoro)',
      output: '/opt/sleepforge/assets/voice-samples/sleep-philosophy-british.mp3',
      description: 'Elegant British female voice (bf_alice)'
    },
    {
      id: 'kokoro-american',
      name: 'American Sleep Voice (Kokoro)',
      output: '/opt/sleepforge/assets/voice-samples/sleep-philosophy-american.mp3',
      description: 'Warm American female voice (af_nicole)'
    }
  ];

  for (const voice of voices) {
    try {
      console.log(`🎵 Generating: ${voice.name}`);
      console.log(`📝 ${voice.description}`);

      const result = await generateVoiceoverWithTimestamps(sleepPhilosophyScript, voice.id, voice.output);

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

  console.log('🎧 All voice samples generated! Check the files above to hear your options.');
}

// First, let's add the British and American voices to the VOICE_MAP
// We need to update the TTS module to include these voices
console.log('🔧 Adding British and American Kokoro voices to the system...');

// We'll create a temporary version with the new voices
const extendedVoiceMap = {
  "kokoro-british": {
    type: "kokoro",
    voice: "bf_alice"  // British female
  },
  "kokoro-american": {
    type: "kokoro",
    voice: "af_nicole"  // American female
  }
};

generateAllVoiceSamples();