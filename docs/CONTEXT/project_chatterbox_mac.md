---
name: Chatterbox on Mac M1 — vendored fixes that live outside the repo
description: Four non-obvious Mac fixes for chatterbox-tts (PM2 process on Niels' M1) that have to be re-applied on every fresh install — they are NOT in the SleepForge repo
type: project
originSessionId: 976a0604-0ad7-46b5-a63b-5255e2b78ed8
---
The PM2 process `chatterbox-tts` on Niels' Mac M1 runs `uvicorn main:app --host 0.0.0.0 --port 4123` from `/Users/nielshammer/chatterbox/`, using the venv at `~/chatterbox/.venv/`. Native Chatterbox (no Docker) on MPS GPU.

Four fixes were applied on 2026-05-02 to get the service healthy AND the SleepForge pipeline able to render a full ~5-minute video. All four live OUTSIDE the SleepForge repo and will be lost on any reinstall:

1. **Patch `~/chatterbox/.venv/lib/python3.11/site-packages/chatterbox/mtl_tts.py` `from_local`** — the multilingual model's `torch.load(ve.pt)` and `torch.load(s3gen.pt)` calls have no `map_location`, so they fail on Mac with "Attempting to deserialize object on a CUDA device but torch.cuda.is_available() is False". Mirror the cpu/mps branch already in `tts.py`/`vc.py`: `if device in ["cpu", "mps"]: map_location = torch.device('cpu') else: map_location = None`, then pass it into the `torch.load` calls AND into `Conditionals.load(builtin_voice, map_location=map_location)`.

2. **Pin setuptools to <81 in the chatterbox venv** — `pip install 'setuptools<81'`. setuptools 81+ removed `pkg_resources`, which `perth/perth_net/__init__.py` still imports. Without it, `perth.PerthImplicitWatermarker` is silently set to `None` (the `try/except ImportError` in `perth/__init__.py` swallows the error), and chatterbox crashes at `self.watermarker = perth.PerthImplicitWatermarker()` with the misleading `'NoneType' object is not callable`.

3. **Patch `~/chatterbox/app/api/endpoints/speech.py` to add an `asyncio.Lock` around every `model.generate()` call.** Chatterbox PyTorch inference is NOT thread-safe: concurrent requests produce tensor-shape mismatches like `stack expects each tensor to be equal size, but got [1, 80] at entry 0 and [1, 144] at entry 1`. The JS-side serialization in `sleepforge/src/chatterbox.js` only protects one Node client; a second client (curl, the long-text background processor, another worker) will collide. There are 3 generate sites in speech.py — wrap each `await loop.run_in_executor(...)` in `async with _GENERATION_LOCK:`.

4. **Patch the same speech.py to (a) cache prepared conditionals across calls and (b) release MPS memory after each generate.** Without these, per-sentence time grows geometrically on MPS: 42s → 99s → 271s → 342s → timeout, because `model.generate(audio_prompt_path=...)` re-runs the heavy `prepare_conditionals` work (librosa.load + s3gen.embed_ref + voice encoder + speech tokenizer) every call AND MPS doesn't auto-release intermediate buffers. Fix:
   - Module-level `_LAST_VOICE_PATH = None`.
   - Inside the `_GENERATION_LOCK` block, before the executor call: if `voice_sample_path == _LAST_VOICE_PATH and getattr(model, "conds", None) is not None`, set `audio_prompt_path=None` so the model reuses its cached `self.conds`.
   - After the executor call: update `_LAST_VOICE_PATH` and call a helper that does `gc.collect()` + `torch.mps.empty_cache()`.

   With (3) and (4) applied, an 8-sentence sequential benchmark stayed flat at 12-21× realtime (no growth) — verified before running the full pipeline.

The standalone `tts.py` and `vc.py` already had the cpu/mps map_location pattern; only `mtl_tts.py` was missing it. The chatterbox app uses the multilingual model (`USE_MULTILINGUAL_MODEL`), so this is the path that fires.

**Known remaining issue (not yet fixed):** Within a single VERY long generation (>~80 sampling iterations), per-token rate on MPS still degrades from ~7 it/s to ~30 s/it. Cause: chatterbox's T3 inference uses the deprecated `past_key_values` tuple-of-tuples KV cache format that PyTorch warns about (`Please convert your cache or use an appropriate Cache class`). For SleepForge's typical sentence lengths (≤200 chars) this hasn't fired since the leak fix, but a future refactor may need to switch chatterbox to the modern Cache class. SleepForge sets `CHATTERBOX_TIMEOUT_MS=600000` in `.env` (10 min) for headroom.

**Why all this matters:** Each error has a misleading surface symptom. The CUDA error correctly fingers map_location; the perth `NoneType` error hides a missing `pkg_resources`; the tensor-shape mismatch hides a thread-safety bug; the geometric slowdown hides MPS memory pressure + redundant conditional prep. Without this memory, the next session on a clean install would re-debug all four from scratch.

**How to apply:** Whenever Niels reinstalls chatterbox on Mac (or moves to a new Mac), re-apply ALL four fixes BEFORE starting `pm2 restart chatterbox-tts`. Verify with `curl http://localhost:4123/health` returning `{"status":"healthy","model_loaded":true,"device":"mps",...}` and then run the 8-sentence benchmark in `/tmp/cbx_bench.sh` (recreate from this memory if missing) — every line should report ≤25× realtime. A long-term fix would be to bundle all four into a SleepForge `scripts/install-chatterbox-mac.sh` that lives in the repo, or upstream the patches to the chatterbox project.
