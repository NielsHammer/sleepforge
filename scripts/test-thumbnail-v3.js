/**
 * Standalone test for thumbnail-v3.
 *
 * Usage:
 *   node scripts/test-thumbnail-v3.js
 *   node scripts/test-thumbnail-v3.js "Custom Title" "philosophy"
 *
 * Outputs to: output/thumbnail-test/
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { generateThumbnailV3, closeBrowser } from '../src/thumbnail-v3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const title = process.argv[2] || 'Marcus Aurelius on Letting Go of What You Cannot Control';
const niche = process.argv[3] || 'philosophy';
const tone = 'calm, meditative, philosophical, ancient wisdom';

const outputDir = path.join(PROJECT_ROOT, 'output', 'thumbnail-test');

console.log(`\nTest thumbnail for: "${title}"`);
console.log(`Niche: ${niche}`);
console.log(`Output: ${outputDir}\n`);

try {
  const pngPath = await generateThumbnailV3({ outputDir, title, niche, tone });
  console.log('\n✅ Done: ' + pngPath);
} catch (err) {
  console.error('\n✗ Failed:', err.message);
} finally {
  await closeBrowser();
}
