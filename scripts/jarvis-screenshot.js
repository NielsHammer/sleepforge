/**
 * Takes 3 screenshots of the JARVIS v2 dashboard:
 *   data/jarvis-v2-screens/center.png  — main idle view
 *   data/jarvis-v2-screens/hover.png   — astronomer card hover state
 *   data/jarvis-v2-screens/idle.png    — 2s later (particles drifted)
 *
 * Requires server already running on port 3001.
 * Usage: node scripts/jarvis-screenshot.js
 */

import puppeteer from 'puppeteer';
import fs        from 'fs';
import path      from 'path';
import { fileURLToPath } from 'url';

const ROOT    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'jarvis-v2-screens');

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1920, height: 1080 },
});

const page = await browser.newPage();
await page.goto('http://localhost:3001', { waitUntil: 'networkidle2', timeout: 15000 });

const wait = ms => new Promise(r => setTimeout(r, ms));

// Wait for fonts + first ripple + channel data fetch attempt
await wait(3500);

// 1. Center / main view
await page.screenshot({ path: path.join(OUT_DIR, 'center.png') });
console.log('  center.png saved');

// 2. Hover over astronomer card
const astroCard = await page.$('#card-astro');
if (astroCard) {
  await astroCard.hover();
  await wait(600);
  await page.screenshot({ path: path.join(OUT_DIR, 'hover.png') });
  console.log('  hover.png saved');
  await page.mouse.move(960, 540);
}

// 3. Idle — 2 seconds later (particles drifted, next ripple)
await wait(2200);
await page.screenshot({ path: path.join(OUT_DIR, 'idle.png') });
console.log('  idle.png saved');

await browser.close();
console.log(`\nScreenshots saved to: ${OUT_DIR}`);
