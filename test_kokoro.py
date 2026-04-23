#!/usr/bin/env python3
"""
SleepForge Kokoro TTS Test Script
Tests Kokoro TTS with voice cloning from Niels' voice sample
"""

import os
import sys
from pathlib import Path
from kokoro_onnx import Kokoro
import numpy as np
import soundfile as sf

def test_kokoro_tts():
    """Test Kokoro TTS with a short sentence"""

    # Load environment variables
    voice_sample_path = os.getenv('VOICE_SAMPLE', '/opt/sleepforge/assets/voice-samples/niels-voice-sample.mp3')

    print("🎤 SleepForge Kokoro TTS Test")
    print(f"Voice sample: {voice_sample_path}")

    # Check if voice sample exists
    if not os.path.exists(voice_sample_path):
        print(f"❌ Voice sample not found: {voice_sample_path}")
        return False

    try:
        # Initialize Kokoro with voice cloning
        print("Loading Kokoro TTS model...")
        kokoro = Kokoro("kokoro-v0_19.onnx", "voices.bin")

        # Test text
        test_text = "Welcome to SleepForge. This is Niels speaking from the world of philosophy."

        print(f"Generating speech for: '{test_text}'")

        # Generate speech
        samples, sample_rate = kokoro.create(
            test_text,
            voice="af_nicole",  # Default voice for now, we'll clone later
            speed=1.0,
            lang="en-us"
        )

        # Save to output file
        output_path = "/opt/sleepforge/test_kokoro_output.wav"
        sf.write(output_path, samples, sample_rate)

        print(f"✅ TTS generated successfully!")
        print(f"Output saved to: {output_path}")
        print(f"Duration: {len(samples)/sample_rate:.2f} seconds")
        print(f"Sample rate: {sample_rate} Hz")

        return True

    except Exception as e:
        print(f"❌ TTS generation failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_kokoro_tts()
    sys.exit(0 if success else 1)