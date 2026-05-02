# SleepForge — Hetzner → Mac migration walkthrough

This is the friendly version. The technical script is `migrate-to-mac.sh`.

> **Don't cancel the Hetzner server until you're sure the Mac works.**
> Both can run at the same time — they don't conflict.

---

## What you need before you start

1. A **Mac** — Apple Silicon recommended (M1/M2/M3/M4). Intel works but slower.
2. **~30 GB of free disk space** (Docker images + Python wheels + Node modules)
3. **Admin password** for your Mac (Homebrew + PM2 startup will ask once)
4. **Internet** — script downloads ~5 GB during install
5. **Your `.env` file from Hetzner** — you'll copy it over manually (instructions below)

---

## Step 1 — Install Docker Desktop (manual)

This is the only thing the script can't do for you.

1. Go to https://www.docker.com/products/docker-desktop/
2. Download "Docker Desktop for Mac" (Apple Silicon or Intel — pick what matches)
3. Open the .dmg, drag Docker.app to Applications
4. Open Docker.app from Applications. Accept the prompts.
5. Wait for the whale icon in your menu bar to stop animating (= "Docker is running")

You don't need an account. Skip the sign-up if it nags.

---

## Step 2 — Run the migration script

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
| 3 | Install node, ffmpeg, python3, git, jq | 3-5 min |
| 4 | Clone the SleepForge repo to `~/sleepforge` | 30 sec |
| 5 | Install Python deps in a venv (Kokoro, Whisper, Torch) | 5-10 min |
| 6 | `npm install` for SleepForge | 1-2 min |
| 7 | Install PM2 + register login auto-start | 30 sec |
| 8 | Verify Docker Desktop is running | instant |
| 9 | Build + start Chatterbox container, upload archer voice | **8-15 min** (first time only) |
| 10 | Start the file server on port 8080 + run a self-test | 10 sec |

Total first-run time: **~25-35 minutes**.

If you re-run later (e.g. after a reboot or a `git pull`), it's much faster — usually under a minute.

---

## Step 3 — Copy your `.env`

The script will tell you when this is needed. From your Mac terminal:

```bash
scp root@157.180.124.232:/opt/sleepforge/.env ~/sleepforge/.env
```

You'll be asked for the Hetzner root password. (If you don't remember it,
log in to Hetzner Cloud Console → SleepForge server → "Reset root password".)

This file contains the Anthropic, Fal, and other API keys. **Don't commit it
to GitHub** — `.gitignore` already excludes it.

---

## Step 4 — Test it

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

   Total time: **~30-50 min on Apple Silicon, ~1-2 hours on Intel**
   (mostly Chatterbox CPU TTS — 4-6× slower than realtime).

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
   - If it returns something, the container is alive.
   - If not: `docker ps` to see if the container crashed; `docker logs chatterbox-tts-api-cpu`
3. Check the file server: visit http://localhost:8080/ — should show the
   `output/` directory listing.
4. If everything is broken: re-run `~/migrate-to-mac.sh`. It's idempotent.

---

## Cancelling Hetzner

Only after you've rendered at least one full 5-min video successfully on
your Mac AND you're happy with the result.

1. Make sure you've SCP'd the `.env` (Step 3 above).
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
| Chatterbox container | `/opt/chatterbox` | `~/chatterbox` |
| File server | port 8080 | port 8080 |
| Chatterbox API | port 4123 | port 4123 |
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
