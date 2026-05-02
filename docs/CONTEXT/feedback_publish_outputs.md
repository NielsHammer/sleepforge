---
name: always publish outputs to the file server
description: When making anything for Niels (videos, samples, previews, comparisons), expose it via the running file server at http://157.180.124.232:8080/ and give him the link.
type: feedback
originSessionId: e0b90f3c-6cea-4a03-8229-611734975cf8
---
When producing any artifact Niels would want to view (videos, audio samples, image grids, preview pages, A/B comparisons), publish it under `/opt/sleepforge/` (or whichever project root the file server serves) and **give him the URL**. He's non-technical and on a remote machine — file paths are useless to him; clickable HTTP links are the deliverable.

The SleepForge file server runs as PM2 process `sleepforge-fileserver`, rooted at `/opt/sleepforge/`, on port 8080, bound to 0.0.0.0. Public IP is `157.180.124.232`.

Patterns:
- Videos → write a `preview.html` in the output dir with embedded `<video>` + thumbnail + metadata. Give him `http://.../output/<slug>/preview.html`.
- Image batches / voice samples → drop a small index.html in the dir with thumbnails / `<audio>` tags.
- Always include the canonical "all videos" landing page link: `http://157.180.124.232:8080/output/`.

**Why:** Niels asked explicitly: "when making things for me you have to put them up online so I can see the videos etc". File paths in console output don't help him.

**How to apply:** End every artifact-producing task with one or more clickable HTTP URLs. If the file server isn't running, restart it (`pm2 restart sleepforge-fileserver`) before reporting done.

**Security caveat:** The file server is currently rooted at `/opt/sleepforge/`, which exposes `.env`, `.git/`, and `secrets/`. Flag this if it hasn't been fixed yet — moving the root to `/opt/sleepforge/output/` (or filtering with a real express server) closes the leak.
