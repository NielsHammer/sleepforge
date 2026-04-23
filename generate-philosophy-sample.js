#!/usr/bin/env node

import { generateVoiceoverWithTimestamps } from './src/tts.js';
import fs from 'fs';

const philosophyScript = `In the quiet moments before sleep, let us reflect on the wisdom of Marcus Aurelius. He taught us that the happiness of your life depends upon the quality of your thoughts. Every difficulty in life presents us with an opportunity to turn inward and ask: What is this experience trying to teach me?

The emperor-philosopher understood that we cannot control what happens to us, but we can always control how we respond. When faced with adversity, remember that it is not the event itself that troubles us, but our judgment about it. Change your thoughts, and you change your world.

As you drift toward sleep, consider this: The obstacle is the way. Every challenge is an invitation to practice virtue. In patience, we find strength. In acceptance, we find peace. In wisdom, we find freedom.

Sleep well, knowing that tomorrow brings new opportunities to live according to nature's design. The universe is change, and our duty is to flow with it gracefully.`;

async function generatePhilosophyVoiceover() {
  console.log('🎤 Generating 1-minute philosophy voiceover...');

  try {
    // Try Kokoro first (faster)
    const outputPath = '/opt/sleepforge/assets/voice-samples/philosophy-sample-kokoro.mp3';
    const voiceId = 'kokoro-warm';

    console.log('🎵 Using Kokoro TTS (warm female voice)...');
    const result = await generateVoiceoverWithTimestamps(philosophyScript, voiceId, outputPath);

    console.log('✅ Philosophy voiceover generated successfully!');
    console.log(`📁 Saved to: ${outputPath}`);
    console.log(`⏱️  Duration: ~${Math.round(result.duration)} seconds`);

    // Check if file was created
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`📊 File size: ${Math.round(stats.size / 1024)} KB`);
      console.log('🎧 You can now listen to the philosophy sample!');
    }

  } catch (error) {
    console.error('❌ Voiceover generation failed:', error.message);
  }
}

generatePhilosophyVoiceover();