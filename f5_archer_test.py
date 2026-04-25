#!/usr/bin/env python3
from pathlib import Path
from f5_tts.api import F5TTS
import soundfile as sf

ref_audio = Path('/opt/sleepforge/assets/voices/cloned-niels/ref_audio.wav')
ref_text = Path('/opt/sleepforge/assets/voices/cloned-niels/ref_text.txt')
out_path = Path('/opt/sleepforge/assets/voice-samples/sleep-archer-test.wav')

if not ref_audio.exists() or not ref_text.exists():
    raise FileNotFoundError('Missing reference audio or text for Archer voice clone')

with ref_text.open('r', encoding='utf-8') as f:
    ref_txt = f.read().strip()

print('Initializing F5TTS...')
client = F5TTS()
print('F5TTS initialized')

text = 'This is a short verification sample for the Archer voice clone. It should sound like the uploaded Archer voice.'
print('Running inference...')
result = client.infer(
    ref_file=str(ref_audio),
    ref_text=ref_txt,
    gen_text=text,
    file_wave=None,
    speed=0.90
)
print('Inference returned:', type(result), 'length', len(result))

wav, sr, mel = result
print('Saving output:', out_path)
sf.write(str(out_path), wav, sr)
print('Saved successfully')
print('Duration', len(wav)/sr)
