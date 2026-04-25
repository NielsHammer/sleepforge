import { generatePixelArtImage } from './src/fal.js';
import fs from 'fs';
import path from 'path';

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) {
  throw new Error('FAL_KEY environment variable is required.');
}

const outputDir = path.join('assets', 'images', 'test4');
const baseOutputDir = path.join('assets', 'images');
if (fs.existsSync(baseOutputDir)) {
  fs.rmSync(baseOutputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

const entries = [
  {
    title: 'Socrates Cross-Examining a Youth',
    reason: 'Socrates is the foundation of Western philosophy and his method is about direct questioning, so this prompt makes the action the focus.',
    prompt: 'Dark 16:9 chalk drawing on blackboard of Socrates leaning forward and speaking directly to a young man with an intense questioning expression, close medium shot, hands and face visible, ancient Greek agora with marble columns and olive trees in the background, no text',
  },
  {
    title: 'Plato Guiding the Prisoner',
    reason: 'Plato is critical for the allegory of the cave; this prompt centers on the physical act of guiding someone toward light.',
    prompt: "Dark 16:9 charcoal sketch of Plato with one hand on a chained prisoner's shoulder while pointing toward a narrow shaft of sunlight, close medium shot, ancient Greek cave with torchlight and temple columns outside, no text",
  },
  {
    title: 'Aristotle Writing Definitions',
    reason: 'Aristotle anchors the script through concrete classification, so the image focuses on his writing gesture and prepared forms.',
    prompt: 'Dark 16:9 ink wash drawing of Aristotle writing on a small tablet with animal figurines arranged at his elbow, close medium shot, emphasis on hand and tablet, ancient Greek Lyceum with marble statues and scrolls in the background, no text',
  },
  {
    title: 'Descartes with the Skull',
    reason: 'Descartes is about radical doubt; the skull is the precise action, and the prompt keeps the camera on his thoughtful face and the object.',
    prompt: 'Dark 16:9 pencil sketch of Descartes holding a skull close to his face, candlelight reflecting in his eyes, close medium shot, ancient Greek philosophical texts and busts in the dimly lit study background, no text',
  },
  {
    title: 'Marcus Aurelius Writing',
    reason: 'Marcus is the stoic author of the script sections, so the image should show him actively journaling as the main action.',
    prompt: 'Dark 16:9 conte crayon drawing of Marcus Aurelius writing in a leather journal with a focused expression and quill in hand, close medium shot, Roman villa with Greek columns and olive trees in the background, no text',
  },
  {
    title: 'Kant Framing the Categorical Imperative',
    reason: 'Kant is the moral law thinker; the important action is him explaining or pointing to a rule, with his gesture as the focus.',
    prompt: 'Dark 16:9 pastel drawing of Immanuel Kant pointing to an invisible moral rule with one hand while holding a book in the other, close medium shot, Prussian study with Greek busts and classical columns in the background, no text',
  },
  {
    title: 'Hume Watching the River',
    reason: 'Hume is about impressions, so the relevant moment is him observing a ripple closely rather than a broad landscape.',
    prompt: 'Dark 16:9 watercolor wash of David Hume staring through a rain-speckled tavern window at a close ripple on a river, close medium shot, Scottish tavern with ancient Greek amphitheater motifs in the background, no text',
  },
  {
    title: 'Nietzsche Raising the Hammer',
    reason: 'Nietzsche is about affirmation and force, so the prompt focuses on his intense gesture and face, not a distant ruin.',
    prompt: 'Dark 16:9 etching style drawing of Nietzsche raising a hammer above his head with a fierce expression, close medium shot, mountainous landscape with ancient Greek ruins and olive trees in the background, no text',
  },
  {
    title: 'Confucius Correcting a Student',
    reason: 'Confucius is about ritual action; the key visual is him directly guiding a student through a specific gesture.',
    prompt: 'Dark 16:9 woodcut print of Confucius placing a student’s hands in the proper ritual position, close medium shot, Chinese pavilion with ancient Greek philosophical scrolls in the background, no text',
  },
  {
    title: 'Buddha Opening His Eyes',
    reason: 'Buddha is the script’s spiritual anchor; showing the moment he opens his eyes after meditation makes the action the centerpiece.',
    prompt: 'Dark 16:9 monochrome engraving of the Buddha opening his eyes in meditation with hands in dhyana mudra, close medium shot, forest grove with ancient Greek temple columns in the background, no text',
  },
];

fs.writeFileSync(path.join(outputDir, 'philosophy-specific-10-metadata.json'), JSON.stringify(entries, null, 2));

async function generate() {
  console.log('Generating 10 branded philosophy images in drawing styles in assets/images/test4...');

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    console.log(`\n${i + 1}. ${entry.title}`);
    console.log(`Reason: ${entry.reason}`);
    console.log(`Prompt: ${entry.prompt}`);

    const outputPath = path.join(outputDir, `philosophy-specific-10-${i + 1}.png`);
    try {
      await generatePixelArtImage(entry.prompt, outputPath);
      console.log(`Saved: ${outputPath}`);
    } catch (error) {
      console.error(`Failed to generate ${entry.title}:`, error.message || error);
    }
  }

  console.log('\nDone generating 10 branded philosophy images in drawing styles in assets/images/test4.');
}

generate();
