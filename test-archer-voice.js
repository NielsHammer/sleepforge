#!/usr/bin/env node

import { generateVoiceoverWithTimestamps } from './src/tts.js';
import fs from 'fs';

const shortTest = `Hello, this is Niels speaking. The voice cloning is working with the Archer sample you uploaded. This should sound like your voice.`;

async function testArcherVoice() {
  console.log('🎤 Testing YOUR cloned Archer voice (short sample)...');

  try {
    const outputPath = '/opt/sleepforge/assets/voice-samples/archer-voice-test.mp3';
    const voiceId = 'cloned-niels';

    console.log('🎵 Using F5-TTS with cloned Archer voice...');
    const result = await generateVoiceoverWithTimestamps(shortTest, voiceId, outputPath);

    console.log('✅ Archer voice test generated successfully!');
    console.log(`📁 Saved to: ${outputPath}`);
    console.log(`⏱️  Duration: ~${Math.round(result.duration)} seconds`);

    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`📊 File size: ${Math.round(stats.size / 1024)} KB`);
      console.log('🎧 This should sound like YOUR voice!');
    }

  } catch (error) {
    console.error('❌ Archer voice test failed:', error.message);
  }
}

testArcherVoice();