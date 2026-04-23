#!/usr/bin/env python3
"""
SleepForge F5-TTS Voice Cloning Script
Clones Niels' voice from the voice sample for use in TTS
"""

import os
import sys
from pathlib import Path
from f5_tts.api import F5TTS
import torch

def clone_niels_voice():
    """Clone Niels' voice using F5-TTS"""

    print("🎤 SleepForge Voice Cloning - F5-TTS")

    # Paths
    voice_sample_path = "/opt/sleepforge/assets/voice-samples/ElevenLabs_test_archer.mp3"
    output_dir = "/opt/sleepforge/assets/voices/cloned-niels"
    ref_text_path = f"{output_dir}/ref_text.txt"
    ref_audio_path = f"{output_dir}/ref_audio.wav"

    # Create output directory
    os.makedirs(output_dir, exist_ok=True)

    # Check if voice sample exists
    if not os.path.exists(voice_sample_path):
        print(f"❌ Voice sample not found: {voice_sample_path}")
        return False

    try:
        print(f"Loading clean ElevenLabs Archer voice sample: {voice_sample_path}")

        # Initialize F5-TTS
        print("Initializing F5-TTS...")
        f5tts = F5TTS()

        # For voice cloning, we need reference text and audio
        # Using the exact transcript from the user's ElevenLabs script
        ref_text = """Close your eyes. Let your body settle. Feel the weight of the day begin to lift from your shoulders, slowly, gently, like a tide pulling back from the shore.

Tonight, we travel back. Back to ancient Rome. Back to a time when one of the most powerful men who ever lived chose, above all else, to master not his empire, but his own mind.

His name was Marcus Aurelius. Emperor of Rome. Commander of legions. And yet, in the quiet hours before dawn, he sat alone and wrote. Not orders. Not laws. But private thoughts. Reflections on how to live well. How to stay calm in chaos. How to be good when power made goodness unnecessary.

He never intended for anyone to read those words. They were written for himself alone. And perhaps that is precisely why they have endured for two thousand years.

Marcus was born in the year 121 AD, into a wealthy and respected Roman family. From his earliest years, those around him recognised something different in the boy. A seriousness. A depth. An unusual desire not for pleasure or status, but for understanding.

When the Emperor Hadrian noticed the young Marcus, he reportedly called him Verissimus — the most truthful one. It was a name that would follow him all his life.

At the age of seventeen, Marcus was adopted by the Emperor Antoninus Pius, essentially being chosen as the future ruler of the known world. Most young men, handed such a destiny, would have been consumed by ambition, by vanity, by the intoxicating promise of absolute power.

Marcus responded by studying philosophy more seriously than ever before.

He was drawn above all to Stoicism — a school of thought founded in Athens centuries earlier, which taught that the good life had nothing to do with wealth, fame, or power. The Stoics believed that the only true good was virtue — wisdom, courage, justice, and self-discipline. Everything else — money, reputation, even health — was, in their word, preferred but not necessary. Nice to have. But not the source of happiness.

This was a radical idea. And for Marcus, it became the foundation of everything.

Imagine for a moment what it meant to hold these beliefs while ruling an empire of seventy million people. Every day brought decisions of enormous consequence. Wars on the frontier. Plagues sweeping through cities. Political conspiracies threatening the throne. Floods, famines, rebellions.

And through all of it, Marcus returned each morning and each evening to his journal, reminding himself of the same quiet truths.

You have power over your mind, he wrote, not outside events. Realise this, and you will find strength.

Not power over armies. Not power over enemies. Power over the mind. That was what he sought. That was what he practised every single day.

The Meditations, as his journals came to be called, are unlike any other book in the history of human thought. They are not polished philosophy, written to impress an audience. They are raw. Honest. Often repetitive, because Marcus was reminding himself of things he kept forgetting, just as we all do.

He writes about anger. About how he sometimes woke feeling resistant to the day, wanting nothing more than to stay in his warm bed rather than face his duties. He writes this not as confession but as a reminder — the obstacle is the path. The discomfort is where the growth lives.

He writes about difficult people. About colleagues who lied, who were ungrateful, who behaved badly. And he reminds himself, always, that such people cannot help what they are. That to expect humans to be perfect is as foolish as to be surprised when a fig tree grows figs.

He writes about death. With unusual frequency and unusual calm. Death, he believed, was not to be feared but to be accepted as the most natural thing in the world. Alexander the Great and his mule driver, he wrote, both ended in the same place. Both returned to the same dust.

This was not meant to be depressing. It was meant to be liberating.

When you truly accept your own mortality, when you feel it not just as an idea but as a lived reality, something remarkable happens. The small irritations of life lose their power. The petty arguments, the wounded pride, the fear of what others think — all of it softens. What remains is only what matters.

Marcus Aurelius ruled Rome for nearly twenty years. He spent much of that time not in the comfort of the imperial palace but on the cold frontiers of the empire, leading his armies in difficult and gruelling campaigns. He suffered the loss of children. He endured betrayal from those he trusted. He watched a plague move through his beloved Rome, killing thousands.

And through all of it, he wrote.

Not to be remembered. Not to be admired. But to stay true to himself. To remember, in the noise and chaos of an empire, who he wanted to be.

That is his gift to us, across two millennia of time.

The world will always be noisy. There will always be pressure, uncertainty, loss. There will always be people who disappoint us and circumstances that frighten us and days when the weight of it all feels almost too heavy to carry.

But in the quiet space of your own mind, in the small choices you make each moment about how to respond, how to see, how to be — there, you are always free.

There, as Marcus knew, you are always home.

So as you drift now toward sleep, let that thought settle gently into you. You cannot control the storm outside. But the place you stand within yourself — that is yours. That has always been yours.

Rest now. Tomorrow you begin again."""

        print("Setting up voice cloning with matched reference data...")

        # Save reference files for future use
        with open(ref_text_path, 'w') as f:
            f.write(ref_text)

        # Convert MP3 to WAV if needed (F5-TTS prefers WAV)
        import subprocess
        if voice_sample_path.endswith('.mp3'):
            print("Converting MP3 to WAV...")
            subprocess.run([
                'ffmpeg', '-i', voice_sample_path, '-acodec', 'pcm_s16le',
                '-ar', '22050', ref_audio_path, '-y'
            ], check=True, capture_output=True)

        print("✅ Voice cloning setup complete!")
        print(f"Reference text saved to: {ref_text_path}")
        print(f"Reference audio saved to: {ref_audio_path}")
        print(f"Cloned voice ready for use in TTS module")

        return True

    except Exception as e:
        print(f"❌ Voice cloning failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = clone_niels_voice()
    sys.exit(0 if success else 1)
