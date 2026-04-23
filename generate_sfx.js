#!/usr/bin/env node

import fs from 'fs';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function generateSFX() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY not found');
    process.exit(1);
  }

  const sfxDir = '/opt/sleepforge/assets/sfx';
  if (!fs.existsSync(sfxDir)) fs.mkdirSync(sfxDir, { recursive: true });

  // Generate fireplace sound
  console.log('🎵 Generating fireplace SFX...');
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: 'cozy fireplace crackling in a quiet room at night, gentle popping and hissing sounds, warm and comforting atmosphere',
        duration_seconds: 30,
        prompt_influence: 0.8
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(`${sfxDir}/fireplace-cozy-loop.mp3`, Buffer.from(buffer));
    console.log('✅ Fireplace SFX generated successfully');
  } catch (err) {
    console.error('❌ Fireplace SFX failed:', err.message);
  }

  // Generate cricket ambience
  console.log('🎵 Generating cricket ambience SFX...');
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text: 'gentle night crickets chirping in a peaceful forest clearing at dusk, distant and soothing natural ambience',
        duration_seconds: 30,
        prompt_influence: 0.8
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    fs.writeFileSync(`${sfxDir}/night-crickets-loop.mp3`, Buffer.from(buffer));
    console.log('✅ Cricket ambience SFX generated successfully');
  } catch (err) {
    console.error('❌ Cricket SFX failed:', err.message);
  }

  console.log('🎵 SFX generation complete!');
}

generateSFX().catch(console.error);