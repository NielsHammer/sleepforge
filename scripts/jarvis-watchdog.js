/**
 * jarvis-watchdog.js — Keeps the JARVIS server alive.
 *
 * Pings http://localhost:3001/api/status every 30 seconds.
 * If the server is down, spawns jarvis/server.js and logs the restart.
 *
 * Logs to data/jarvis-watchdog.log
 *
 * Run this once at login (Task Scheduler or startup script).
 * It is separate from the server so it survives server crashes.
 */

import fs   from 'fs';
import http  from 'http';
import path  from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname    = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

const LOG_FILE   = path.join(PROJECT_ROOT, 'data', 'jarvis-watchdog.log');
const SERVER_URL = 'http://localhost:3001/api/status';
const POLL_MS    = 30_000;
const TIMEOUT_MS = 8_000;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch {}
}

function ping() {
  return new Promise(resolve => {
    const req = http.get(SERVER_URL, { timeout: TIMEOUT_MS }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

let serverProc = null;
let restartCount = 0;

function spawnServer() {
  const serverScript = path.join(PROJECT_ROOT, 'jarvis', 'server.js');
  const logOut = path.join(PROJECT_ROOT, 'data', 'jarvis-server.log');
  const logErr = path.join(PROJECT_ROOT, 'data', 'jarvis-server.err');

  const outStream = fs.openSync(logOut, 'a');
  const errStream = fs.openSync(logErr, 'a');

  serverProc = spawn(process.execPath, [serverScript], {
    cwd:   PROJECT_ROOT,
    stdio: ['ignore', outStream, errStream],
    env:   process.env,
    detached: false,
  });

  serverProc.on('exit', (code, signal) => {
    log(`Server exited (code=${code} signal=${signal})`);
    serverProc = null;
  });

  serverProc.on('error', err => {
    log(`Server spawn error: ${err.message}`);
    serverProc = null;
  });

  log(`Server spawned PID=${serverProc.pid}`);
}

async function tick() {
  const alive = await ping();
  if (!alive) {
    restartCount++;
    log(`Server DOWN (restart #${restartCount}) — spawning...`);
    if (serverProc) {
      try { serverProc.kill(); } catch {}
      serverProc = null;
      await new Promise(r => setTimeout(r, 2000));
    }
    spawnServer();
    // Give it time to boot before next ping
    await new Promise(r => setTimeout(r, 10_000));
  }
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────

log('Watchdog started. Monitoring http://localhost:3001');

tick(); // immediate check
setInterval(tick, POLL_MS);

process.on('SIGTERM', () => {
  log('SIGTERM — shutting down watchdog');
  if (serverProc) try { serverProc.kill(); } catch {}
  process.exit(0);
});
