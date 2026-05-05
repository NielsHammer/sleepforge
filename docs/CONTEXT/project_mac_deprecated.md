---
name: SleepForge Mac stack is deprecated — moving to desktop PC
description: As of 2026-05-02, Niels decided to abandon the Mac M1 + Chatterbox+MPS path and move SleepForge to his desktop PC. Don't propose Mac fixes.
type: project
originSessionId: 976a0604-0ad7-46b5-a63b-5255e2b78ed8
---
On 2026-05-02 Niels decided to move all SleepForge work to his desktop PC instead of continuing on the Mac M1.

**The trigger:** A full-pipeline test of a 5-min sleep video was on track to take ~70 min (Chatterbox-on-MPS does 12-21× realtime per sentence, and 5 min of audio = ~80 min minimum). On the prior Hetzner setup with cloud TTS the same render took ~5 min. Niels (correctly) judged that the Mac+native-Chatterbox path is the wrong architecture for his throughput needs — local autoregressive transformer TTS will never beat a cloud API on Apple Silicon, no matter how well it's tuned.

**What this means going forward:**
- Don't propose more Mac-side optimizations to Chatterbox (`~/chatterbox/`), Kokoro, or `~/sleepforge/.venv` unless Niels explicitly asks.
- The four Mac-only Chatterbox patches documented in `project_chatterbox_mac.md` are still correct *if* anyone ever needs to revive the Mac path, but they should not be assumed to be the active deployment.
- Any "make SleepForge faster" question should default to: cloud TTS API (ElevenLabs / OpenAI / Cartesia) for voiceover, kept on a real Linux box, not the Mac.

**Why:** Chatterbox + MPS gave voice cloning quality but at ~16× realtime — the math (5 min audio × 16× = 80 min) doesn't work for any kind of batch production. The architecture mismatch was the surprise; the patches we did were necessary to even *measure* the floor speed.

**How to apply:** When a future session opens this project, check what host/box Niels is on before assuming any TTS architecture. If he's on the desktop PC and asks about SleepForge, that's a fresh deployment surface — ask what's installed before suggesting fixes.
