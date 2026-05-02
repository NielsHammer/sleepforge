# SleepForge — Hetzner → Mac migration walkthrough

This is the friendly version. The technical script is `migrate-to-mac.sh`.

> **Don't cancel the Hetzner server until you're sure the Mac works.**
> Both can run at the same time — they don't conflict.

---

## What you need before you start

1. A **Mac with Apple Silicon** (M1/M2/M3/M4). Intel will work but no GPU acceleration.
2. **~15 GB of free disk space** (Python wheels + models + Node modules)
3. **Admin password** for your Mac (Homebrew + PM2 startup will ask once)
4. **Internet** — script downloads ~3 GB during install
5. **Your `.env` file from Hetzner** — you'll copy it over manually (instructions below)

> **No Docker required.** Chatterbox is installed natively in its own
> Python venv so it can use Apple Silicon's GPU (MPS) for ~5× faster
> inference than CPU. This also saves ~3 GB of RAM vs. Docker Desktop —
> important on an 8 GB Mac.

---

## Step 1 — Run the migration script

Open **Terminal** (Applications → Utilities → Terminal) and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/NielsHammer/sleepforge/main/migrate-to-mac.sh -o ~/migrate-to-mac.sh
chmod +x ~/migrate-to-mac.sh
~/migrate-to-mac.sh
```

The script is **idempotent** — if anything fails halfway, just re-run it.
It picks up where it left off.

What it does (in order, with progress banners):

| # | Step | Approx time |
|---|------|-------------|
| 1 | Verify macOS | instant |
| 2 | Install Homebrew (if missing) | 1-3 min |
| 3 | Install node, ffmpeg, python@3.11, git, jq, espeak-ng | 3-5 min |
| 4 | Clone SleepForge to `~/sleepforge` | 30 sec |
| 5 | SleepForge venv: kokoro, whisper, torch (MPS) | 5-10 min |
| 6 | `npm ci` for SleepForge | 1-2 min |
| 7 | PM2 + login auto-start | 30 sec |
| 8 | Clone chatterbox-tts-api → its own venv with MPS torch | 5-10 min |
| 9 | Start Chatterbox under PM2, upload archer voice | 2-3 min |
| 10 | File server on port 8080 + self-test | 10 sec |

Total first-run time: **~20-30 minutes**.

If you re-run later (after a reboot or a `git pull`), it's much faster — usually under a minute.

---

## Step 2 — Copy your `.env`

The script will tell you when this is needed. From your Mac terminal:

```bash
scp root@157.180.124.232:/opt/sleepforge/.env ~/sleepforge/.env
```

You'll be asked for the Hetzner root password. (If you don't remember it,
log in to Hetzner Cloud Console → SleepForge server → "Reset root password".)

This file contains the Anthropic, Fal, and other API keys. **Don't commit it
to GitHub** — `.gitignore` already excludes it.

---

## Step 3 — Test it

After the script says "✓ Migration complete":

1. Open Safari/Chrome and go to **http://localhost:8080/output/**
   You should see the videos already rendered on Hetzner — no, wait, you won't.
   `output/` is in `.gitignore` so the rendered videos didn't migrate. You'll
   see an empty list. That's fine.

2. Render a fresh test video:
   ```bash
   cd ~/sleepforge
   node run-pipeline-test.js
   ```
   This renders a 5-minute Marcus Aurelius sleep video using:
   - Claude Code CLI for the script (so it goes against your subscription, not API credits)
   - Chatterbox archer voice for narration
   - Flux Schnell for chalk images (~$0.13)
   - Remotion for the fireplace particle overlay
   - ffmpeg for the final compose

   Total time: **~15-25 min on Apple Silicon (MPS), ~1-2 hours on Intel**
   (Chatterbox runs natively against your M1 GPU, ~5× faster than CPU).

3. When it's done, the URL it prints should work in your browser:
   `http://localhost:8080/output/marcus-aurelius-on-letting-go/preview.html`

---

## Daily use after migration

- **Start the server**: nothing to do — PM2 auto-starts on login.
- **Manual restart if needed**: `pm2 restart all`
- **See what's running**: `pm2 list`
- **View logs**: `pm2 logs`
- **Render a video**: `cd ~/sleepforge && node run-pipeline-test.js`
- **Update from GitHub**: `cd ~/sleepforge && git pull && npm install`

---

## When something breaks

1. Look at PM2 logs: `pm2 logs --lines 50`
2. Check Chatterbox: `curl http://localhost:4123/health`
   - If it returns something, the API is alive.
   - If not: `pm2 logs chatterbox-tts --lines 80` to see what crashed it.
   - Restart it: `pm2 restart chatterbox-tts`
3. Check the file server: visit http://localhost:8080/ — should show the
   `output/` directory listing.
4. If everything is broken: re-run `~/migrate-to-mac.sh`. It's idempotent.

---

## Cancelling Hetzner

Only after you've rendered at least one full 5-min video successfully on
your Mac AND you're happy with the result.

1. Make sure you've SCP'd the `.env` (Step 2 above).
2. Log in to Hetzner Cloud Console.
3. Confirm the server you're cancelling is the SleepForge one (IP
   `157.180.124.232`).
4. Stop and delete it.

The GitHub repo is the source of truth — any code change you made on
Hetzner that wasn't pushed is gone after this. So check `git status` in
`/opt/sleepforge` on Hetzner before you cancel.

---

## What lives where after migration

| Component | Hetzner path | Mac path |
|-----------|--------------|----------|
| SleepForge code | `/opt/sleepforge` | `~/sleepforge` |
| SleepForge venv | `/opt/sleepforge/.venv` | `~/sleepforge/.venv` |
| Chatterbox API code | `/opt/chatterbox` (Docker) | `~/chatterbox` (native venv) |
| Chatterbox venv | n/a (in container) | `~/chatterbox/.venv` |
| File server | port 8080 | port 8080 |
| Chatterbox API | port 4123 | port 4123 |
| Chatterbox device | `cpu` | **`mps` (Apple GPU)** |
| `.env` | `/opt/sleepforge/.env` | `~/sleepforge/.env` |
| Archer voice ref | `assets/voices/archer/` | `assets/voices/archer/` (in repo) |
| Rendered videos | `output/` | `output/` (regenerated) |

---

## Context for future Claude sessions

When you open Claude Code on the Mac, the AI won't have memory of past
conversations from Hetzner. To give it the same context:

1. The repo includes `docs/CONTEXT/` — read those files (they're the same
   memory entries that lived in `~/.claude/projects/-root/memory/` on Hetzner).
2. Or, copy them into your Mac's Claude memory:
   ```bash
   mkdir -p ~/.claude/projects/-Users-niels-sleepforge/memory
   cp ~/sleepforge/docs/CONTEXT/*.md ~/.claude/projects/-Users-niels-sleepforge/memory/
   ```
   (Adjust the path to match your Mac's home directory.)
