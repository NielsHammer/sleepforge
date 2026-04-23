#!/usr/bin/env node

import { generateVoiceoverWithTimestamps } from './src/tts.js';
import fs from 'fs';

const philosophyScript = `In the quiet moments before sleep, let us reflect on the wisdom of Marcus Aurelius. He taught us that the happiness of your life depends upon the quality of your thoughts. Every difficulty in life presents us with an opportunity to turn inward and ask: What is this experience trying to teach me?

The emperor-philosopher understood that we cannot control what happens to us, but we can always control how we respond. When faced with adversity, remember that it is not the event itself that troubles us, but our judgment about it. Change your thoughts, and you change your world.

As you drift toward sleep, consider this: The obstacle is the way. Every challenge is an invitation to practice virtue. In patience, we find strength. In acceptance, we find peace. In wisdom, we find freedom.

Sleep well, knowing that tomorrow brings new opportunities to live according to nature's design. The universe is change, and our duty is to flow with it gracefully.`;

async function generatePhilosophyVoiceover() {
  console.log('🎤 Generating 1-minute philosophy voiceover with YOUR cloned Archer voice...');

  try {
    const outputPath = '/opt/sleepforge/assets/voice-samples/philosophy-sample-archer.mp3';

    // Use the cloned Archer voice (F5-TTS)
    const voiceId = 'cloned-niels';

    console.log('🎵 Using F5-TTS with your cloned Archer voice...');
    console.log('📝 Reference audio: ElevenLabs_test_archer.mp3');
    console.log('📝 Reference text: Exact transcript match');

    const result = await generateVoiceoverWithTimestamps(philosophyScript, voiceId, outputPath);

    console.log('✅ Philosophy voiceover with YOUR voice generated successfully!');
    console.log(`📁 Saved to: ${outputPath}`);
    console.log(`⏱️  Duration: ~${Math.round(result.duration)} seconds`);

    // Check if file was created
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`📊 File size: ${Math.round(stats.size / 1024)} KB`);
      console.log('🎧 You can now hear YOUR voice in the philosophy sample!');
    }

  } catch (error) {
    console.error('❌ F5-TTS voiceover failed:', error.message);
    console.error('🔄 Falling back to Kokoro with warm female voice...');

    try {
      const outputPath = '/opt/sleepforge/assets/voice-samples/philosophy-sample-fallback.mp3';
      const result = await generateVoiceoverWithTimestamps(philosophyScript, 'kokoro-warm', outputPath);
      console.log('✅ Fallback philosophy voiceover generated!');
      console.log(`📁 Saved to: ${outputPath}`);
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError.message);
    }
  }
}

generatePhilosophyVoiceover();