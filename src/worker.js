/**
 * worker.js — SleepForge production queue worker
 *
 * STATUS: NOT YET PORTED TO WINDOWS
 *
 * The production worker (polling loop + job runner) lives on the Linux server
 * at /opt/sleepforge/src/worker.js. This stub exists so `npm run worker`
 * fails with a clear message rather than a confusing "file not found" error.
 *
 * To port: read /opt/sleepforge/src/worker.js on the server, adapt for Windows
 * paths and the local Kokoro TTS setup (CUDA, no PM2).
 *
 * Reference implementation: /opt/videvo/engine/src/worker.js
 */

console.error('worker.js has not been ported to Windows yet.');
console.error('See src/worker.js for instructions.');
process.exit(1);
