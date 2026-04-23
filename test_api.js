#!/usr/bin/env node

import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

async function testAPI() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  console.log('Testing ElevenLabs API key...');

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey }
    });

    if (response.ok) {
      console.log('✅ API key is valid');
      const data = await response.json();
      console.log(`Found ${data.voices.length} voices`);
    } else {
      console.log(`❌ API key invalid: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.log('❌ API test failed:', err.message);
  }
}

testAPI();