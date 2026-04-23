#!/usr/bin/env node

import { generateVoiceoverWithTimestamps, analyzePacing } from './src/tts.js';
import fs from 'fs';
import path from 'path';

// Test script for voice cloning
async function testVoice() {
  console.log('🎤 Testing SleepForge F5-TTS voice cloning...');

  // Set up sleepy pacing
  await analyzePacing('sleep', 'relaxation', 'calm', 'gentle bedtime story');

  // Short sleepy text for 10-second test
  const testText = `Welcome to your bedtime story. Let your mind drift peacefully as you listen to these calming words. Feel the gentle rhythm of sleep approaching, wrapping you in comfort and peace.`;

  const outputPath = '/tmp/sleepforge-niels-voice-test.wav';

  try {
    console.log('🎵 Generating voiceover with cloned Niels voice...');
    const result = await generateVoiceoverWithTimestamps(testText, 'cloned-niels', outputPath);

    console.log(`✅ F5-TTS Voice test complete!`);
    console.log(`📁 Audio saved to: ${outputPath}`);
    console.log(`⏱️  Duration: ${result.duration.toFixed(1)} seconds`);
    console.log(`🎙️  Voice: Niels (F5-TTS cloned)`);

    // Check if file exists and has content
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`📊 File size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
    }

  } catch (error) {
    console.error('❌ F5-TTS Voice test failed:', error.message);
    process.exit(1);
  }
}

testVoice();