#!/usr/bin/env python3
"""
SleepForge Whisper Test Script
Tests Whisper speech recognition
"""

import os
import whisper
import numpy as np

def test_whisper():
    """Test Whisper speech recognition"""

    print("🎧 SleepForge Whisper Test")

    try:
        # Load Whisper model (base model for speed)
        print("Loading Whisper base model...")
        model = whisper.load_model("base")

        # Test with the Kokoro output we just generated
        audio_path = "/opt/sleepforge/test_kokoro_output.wav"

        if not os.path.exists(audio_path):
            print(f"❌ Test audio file not found: {audio_path}")
            return False

        print(f"Transcribing: {audio_path}")

        # Transcribe the audio
        result = model.transcribe(audio_path)

        print("✅ Whisper transcription successful!")
        print(f"Detected language: {result['language']}")
        print(f"Transcription: '{result['text'].strip()}'")
        print(f"Confidence segments: {len(result['segments'])}")

        return True

    except Exception as e:
        print(f"❌ Whisper test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_whisper()
    exit(0 if success else 1)