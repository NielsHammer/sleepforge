/**
 * rethumb-content-sets.js — one-shot script to regenerate thumbnails
 * for the 5 existing content sets that have CSS placeholder thumbnails.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const { generateThumbnailV3, closeBrowser } = await import('../src/thumbnail-v3.js');

const TRADITION_TONE = {
  'Stoicism':       'stoic, disciplined, ancient Roman marble, period-authentic art',
  'Taoism':         'tranquil, flowing, ancient Chinese ink wash painting, period-authentic art',
  'Buddhism':       'serene, meditative, ancient Buddhist sculpture or thangka, period-authentic art',
  'Epicureanism':   'peaceful, gentle, ancient Greek or Hellenistic art, period-authentic art',
  'Platonism':      'contemplative, idealist, ancient Greek sculpture, period-authentic art',
  'Aristotelianism':'scholarly, balanced, ancient Greek or Byzantine art, period-authentic art',
  'Confucianism':   'harmonious, ordered, ancient Chinese scroll painting, period-authentic art',
  'Existentialism': 'introspective, modern philosophical, painterly, no modern photos',
  'default':        'calm, meditative, philosophical, period-authentic ancient art',
};

const SETS = [
  { id: '821a5a5a', title: 'Epicureanism for Sleep: The Ancient Philosophy of Simple Pleasures & Inner Peace', tradition: 'Epicureanism' },
  { id: '9d255905', title: 'Wu Wei Sleep: Fall Asleep by Letting Go | Taoist Philosophy for Insomnia',         tradition: 'Taoism' },
  { id: '40d8eb94', title: 'Marcus Aurelius on Anxiety and Rest | Stoic Philosophy to Fall Asleep To',         tradition: 'Stoicism' },
  { id: '60e95590', title: "Aristotle's Contemplative Life: Philosophy to Fall Asleep To | Sleep Meditation",  tradition: 'Aristotelianism' },
  { id: '188e551d', title: 'Fall Asleep to Schopenhauer: The Art of Resignation and Acceptance',               tradition: 'Other' },
];

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   Re-thumbnail 5 existing content sets               ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

for (const set of SETS) {
  const setDir = path.join(ROOT, 'data', 'content-sets', set.id);
  const tone   = TRADITION_TONE[set.tradition] || TRADITION_TONE.default;
  console.log(`\n── ${set.id} ─────────────────────────────────────────`);
  console.log(`   "${set.title}"`);
  try {
    await generateThumbnailV3({
      outputDir:  setDir,
      title:      set.title,
      scriptText: '',
      niche:      'philosophy',
      tone:       `calm, meditative, philosophical, ${tone}, no modern faces, no contemporary makeup, no plucked eyebrows, no current-era hairstyles`,
    });
    console.log(`   ✓ thumbnail.png saved`);
  } catch (e) {
    console.log(`   ✗ Failed: ${e.message.slice(0, 150)}`);
  }
}

await closeBrowser().catch(() => {});
console.log('\n✓ Done.');
