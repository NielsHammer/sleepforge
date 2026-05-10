import fs from "fs";
import path from "path";
import { callClaudeCLI } from "./claude-cli.js";

// ─── SleepForge Script Generator ────────────────────────────────────────────
//
// Adapted from VideoForge script-generator.js v40.
// Purpose-built for 1-2 hour philosophy sleep stories.
//
// Key differences from VideoForge:
//   - Uses Claude Haiku (cost: ~$0.10 per video)
//   - Sleep-optimized pacing: slow, meditative, no hooks or retention tricks
//   - Scene markers for image generation: each scene knows WHO and WHAT
//   - Output is structured JSON with narration + scene metadata
//   - No subscribe CTAs, no pattern interrupts — this is sleep content
//
// Output format per scene:
//   { philosopher, moment, narration, image_prompt_context }
//
// The image_prompt_context feeds into craftImagePrompt() later in the pipeline,
// which wraps it in the locked chalk-on-blackboard style template.

const MODEL = "claude-haiku-4-5-20251001"; // CLAUDE.md rule: Haiku for scripts
const WORDS_PER_MINUTE = 110; // Slower than VideoForge's 130 — sleep pacing

// ─── PHILOSOPHER DATABASE ───────────────────────────────────────────────────
// Each philosopher has enough context for Haiku to write accurately without
// hallucinating facts. This replaces VideoForge's reference library approach.

const PHILOSOPHERS = {
  socrates: {
    name: "Socrates",
    era: "Ancient Athens, 470-399 BC",
    core: "The unexamined life is not worth living. Knowledge through questioning.",
    moments: [
      "Cross-examining a student in the Athenian agora",
      "Drinking the hemlock with calm acceptance",
      "Debating the nature of justice with Thrasymachus",
      "Walking barefoot through Athens at dawn",
      "Questioning whether virtue can be taught",
      "His trial before the Athenian assembly",
      "Teaching that true wisdom is knowing you know nothing",
      "Discussing the immortality of the soul before death",
    ],
    themes: ["questioning, doubt, intellectual humility, moral courage, dialectic, death with dignity"],
  },
  plato: {
    name: "Plato",
    era: "Ancient Athens, 428-348 BC",
    core: "Reality is shadows on a cave wall. The Form of the Good is the highest truth.",
    moments: [
      "Describing prisoners chained in the cave",
      "A prisoner turning toward the light for the first time",
      "Founding the Academy beneath the olive trees",
      "Writing the Republic by lamplight",
      "Explaining the divided line of knowledge",
      "The allegory of the charioteer — reason guiding desire",
      "Teaching that the soul existed before the body",
      "Describing the philosopher-king who governs with wisdom",
    ],
    themes: ["forms, shadows, light, truth, education, the soul, ideal governance"],
  },
  aristotle: {
    name: "Aristotle",
    era: "Ancient Athens/Stagira, 384-322 BC",
    core: "Virtue is the golden mean between extremes. Knowledge comes from observation.",
    moments: [
      "Walking the Lyceum pathways while teaching — the peripatetic method",
      "Classifying animals by examining them one by one",
      "Teaching young Alexander of Macedon",
      "Explaining that courage lies between cowardice and recklessness",
      "Dissecting a cuttlefish to understand its anatomy",
      "Arguing that happiness is the purpose of human life",
      "Writing the Nicomachean Ethics for his son",
      "Observing the stars from the hills above Stagira",
    ],
    themes: ["observation, classification, virtue, moderation, purpose, natural philosophy"],
  },
  "marcus-aurelius": {
    name: "Marcus Aurelius",
    era: "Roman Empire, 121-180 AD",
    core: "Control what you can. Accept what you cannot. Your thoughts shape your world.",
    moments: [
      "Writing his Meditations alone in a campaign tent",
      "Standing unmoved while his generals deliver bad news",
      "Reminding himself that even emperors return to dust",
      "Watching the Danube river from the frontier at dawn",
      "Choosing mercy for a defeated enemy against advisors' wishes",
      "Reflecting that the universe is change and life is opinion",
      "Walking the Roman forum before the city wakes",
      "Accepting the plague that ravaged his legions without complaint",
    ],
    themes: ["duty, impermanence, inner fortress, acceptance, discipline, nature of time"],
  },
  epictetus: {
    name: "Epictetus",
    era: "Roman Empire, 50-135 AD",
    core: "It is not things that disturb us but our judgments about things. Freedom is internal.",
    moments: [
      "Teaching students in his small school at Nicopolis",
      "Explaining that a slave can be freer than his master",
      "Breaking down the dichotomy of control for the first time",
      "Calmly enduring his master breaking his leg without a word",
      "Telling a student that suffering is a choice of perception",
      "Comparing life to a banquet where you take what is offered",
      "Explaining that philosophy is not theory but daily practice",
      "Sitting quietly while a storm rages outside his window",
    ],
    themes: ["control, perception, freedom, suffering, simplicity, inner strength"],
  },
  seneca: {
    name: "Seneca",
    era: "Roman Empire, 4 BC - 65 AD",
    core: "We suffer more in imagination than reality. Time is our most precious resource.",
    moments: [
      "Writing letters to Lucilius by candlelight",
      "Standing calm before Nero's death sentence",
      "Explaining that anger is temporary madness",
      "Watching a ship disappear over the horizon — metaphor for life",
      "Choosing exile over compromising his principles",
      "Reminding a grieving friend that all things are borrowed",
      "Describing how most people waste their lives on things that do not matter",
      "His final bath — opening his veins with philosophical composure",
    ],
    themes: ["time, mortality, anger, wealth, exile, courage, friendship, letters"],
  },
  diogenes: {
    name: "Diogenes of Sinope",
    era: "Ancient Athens, 412-323 BC",
    core: "Live according to nature. Civilization is a cage we built for ourselves.",
    moments: [
      "Living in a barrel in the Athenian marketplace",
      "Carrying a lantern in daylight searching for an honest man",
      "Telling Alexander the Great to step out of his sunlight",
      "Throwing away his cup after seeing a child drink from cupped hands",
      "Rolling his barrel up and down the hill while Athens prepared for war",
      "Eating raw onions while philosophers debated luxury",
      "Mocking Plato's definition of man as a featherless biped",
      "Sleeping on the ground beneath the stars by choice",
    ],
    themes: ["simplicity, nature, defiance, honesty, freedom from possessions"],
  },
  heraclitus: {
    name: "Heraclitus",
    era: "Ephesus, 535-475 BC",
    core: "Everything flows. You cannot step into the same river twice. Opposites are one.",
    moments: [
      "Standing at the riverbank watching water flow past forever",
      "Declaring that fire is the fundamental element of all things",
      "Writing his fragments in the temple of Artemis",
      "Observing that the road up and the road down are the same",
      "Withdrawing from Ephesus to live alone in the mountains",
      "Teaching that war is the father of all things",
      "Watching a fire consume and create at the same moment",
      "Lamenting that most people live as if asleep",
    ],
    themes: ["change, flux, fire, opposites, logos, solitude, awakening"],
  },
};

// ─── SLEEP VOICE RULES ──────────────────────────────────────────────────────

const SLEEP_VOICE_RULES = `
You are writing a sleep story narration script. This will be read aloud by a calm,
slow narrator to help people fall asleep. Every sentence must be soothing and meditative.

VOICE — NON-NEGOTIABLE:
- Contractions always: "you've", "that's", "it's", "wouldn't", "they'd"
- Slow rhythm. Short sentences followed by long flowing ones.
- Present tense for scenes: "Socrates stands in the agora. The morning sun..."
- Second person for transitions: "You can imagine him there. Standing quietly."
- Poetic but never purple. Simple words. Never showy.
- Pauses between paragraphs — each blank line is a breath for the listener.
- No excitement, no urgency, no hooks. This is the opposite of a YouTube video.
- The goal is to make the listener feel safe, contemplative, and drowsy.

PACING:
- Each scene should last 2-4 paragraphs of narration (~200-400 words)
- Blank lines between paragraphs create natural pauses
- Repeat key ideas gently — sleep listeners drift in and out
- End each scene with a quiet settling sentence before moving on

NUMBER RULES:
- Spell out ALL numbers as words: "four hundred years" not "400 years"
- Spell out years naturally: "four seventy BC" not "470 BC"
- This is read by text-to-speech. Write EXACTLY how it should sound.

BANNED FOREVER — these words will not appear anywhere:
"dive into", "delve", "landscape", "game-changer", "let's unpack", "it's worth noting",
"in today's world", "at the end of the day", "picture this", "fast forward",
"fascinating", "interesting", "incredible", "amazing", "unbelievable",
"but first", "stay tuned", "subscribe", "like and share", "without further ado",
"buckle up", "mind-blowing", "jaw-dropping", "epic"

BANNED SENTENCE STARTERS:
Never start a sentence with "As", "While", "Furthermore", "Additionally",
"It's important to note", "It's worth mentioning", "Picture this"

FORMAT:
- Write ONLY narration text — no [brackets], no stage directions, no (notes)
- Blank lines between paragraphs
- No headers, no bullet points, no markdown — pure narration only
`;

// ─── SCENE MARKER SYSTEM ────────────────────────────────────────────────────
// This is the key innovation from VideoForge's craftAIPrompt adapted for sleep.
// Each scene carries metadata so image generation knows:
//   WHO (specific philosopher by name)
//   WHAT (the exact philosophical moment)
//   ACTION (what the philosopher is doing physically)
//
// The pipeline later wraps this into the chalk-on-blackboard style prompt.

const SCENE_OUTPUT_FORMAT = `
OUTPUT FORMAT — CRITICAL:
Return a JSON array of scene objects. Each scene represents 30-45 seconds of narration.
You MUST produce exactly the number of scenes specified — this is non-negotiable.

[
  {
    "philosopher": "Name of the philosopher featured in this scene",
    "moment": "The specific philosophical moment or teaching (e.g. 'drinking the hemlock')",
    "action": "What the philosopher is physically doing — ONE specific pose or gesture (e.g. 'raising a cup to his lips with steady hands')",
    "setting": "Brief setting description (e.g. 'the stone prison cell, a crumbling Doric column')",
    "narration": "The narration text for this scene. 55-80 words. 1-2 short paragraphs separated by \\n\\n"
  }
]

RULES FOR SCENES:
- Each scene = 30-45 seconds of narration = 55-80 words. NO MORE.
- Each scene must focus on ONE philosopher and ONE specific moment
- The "action" field must describe a single physical gesture or pose — this drives the image
- The "action" field must NEVER mention light sources: no candle, fire, flame, lantern, torch, lamp, glow — these break the image style
- The "setting" field must include at least one Greek/Roman architectural element
- Scenes should flow naturally from one to the next — the narration is continuous
- A viewer should be able to tell WHO this philosopher is and WHAT moment this is from the action alone
- Alternate between philosophers — never put the same philosopher in consecutive scenes
- Each scene needs a DIFFERENT action/pose — never repeat "standing" or "sitting" across scenes
`;

// ─── SCRIPT STRUCTURE ───────────────────────────────────────────────────────

function buildSleepPhilosophyPrompt(topic, duration, philosophers) {
  const targetWords = Math.round(parseInt(duration) * WORDS_PER_MINUTE);
  const minWords = Math.round(targetWords * 0.92);
  const maxWords = Math.round(targetWords * 1.08);
  const sceneCount = Math.max(2, Math.round(parseInt(duration) * 60 / 37)); // ~37 seconds per scene

  // Build philosopher reference block
  const philBlock = philosophers.map(key => {
    const p = PHILOSOPHERS[key];
    if (!p) return null;
    return `
${p.name} (${p.era})
Core teaching: ${p.core}
Key moments: ${p.moments.join("; ")}
Themes: ${p.themes}`;
  }).filter(Boolean).join("\n");

  return `You are writing a ${duration}-minute sleep philosophy narration — a calm, meditative
exploration of ancient philosophical wisdom meant to help listeners drift to sleep.

TOPIC: "${topic}"
TARGET DURATION: ${duration} minutes (~${targetWords} words at ${WORDS_PER_MINUTE} wpm)
NUMBER OF SCENES: exactly ${sceneCount} scenes (each ~37 seconds / ~65 words)

═══ PHILOSOPHER REFERENCE ═══
Use ONLY these philosophers and their real teachings. Do not invent quotes or moments.
${philBlock}

═══ HARD CONSTRAINTS — VIOLATIONS WILL BE REJECTED ═══

1. NO FICTIONAL NAMED CHARACTERS.
   - Every named person in the narration must be a real historical figure from the
     PHILOSOPHER REFERENCE block above, OR a documented historical contemporary
     of one of those philosophers (e.g. Crito, Xanthippe, Lucilius, Faustina,
     a named student/wife/friend who actually existed).
   - DO NOT invent characters like "Aurelia", "Theron", "Marcus's friend Justus",
     "a young student named Lyra", etc. If you need a generic figure, use roles:
     "a student", "a soldier", "a young woman in the agora", "a merchant" — never
     give them invented proper names.
   - DO NOT use Marcus Aurelius's real wife/family without their documented names
     (Faustina, Commodus, etc.) and documented relationships.

2. NO ANACHRONISTIC OBJECTS.
   - The world is ancient Greece / Rome. Only objects that existed in those eras
     may be referenced: oil lamps, scrolls, wax tablets, amphorae, togas, tunics,
     sandals, stylus, lyre, marble, chariots, swords, shields, bread, olives,
     wine, water from a well or fountain, cool stone, candle flames, hearth fire.
   - NEVER reference: clocks, watches, glass windows, paper books, pencils,
     metal cans, plastic, electricity, machinery, modern weapons, modern foods
     like coffee/tea/tobacco/sugar, modern furniture (chairs with backs and arms
     existed but no sofas/recliners), modern clothing (no buttons, zippers, suits).

3. NO MODERN PHRASING.
   - Avoid contemporary idioms ("at the end of the day", "let that sink in",
     "circle back", "process emotions", "self-care"). Use plain, timeless prose.

4. EVERY NAMED PHILOSOPHER MUST EXIST.
   - If unsure whether a person is real, replace with a role.
   - If a quote is attributed, the quote must be one this philosopher actually
     wrote or said (paraphrase is fine; fabrication is not).

═══ NARRATIVE ARC ═══

OPENING (first scene):
Begin in a specific place. Not "long ago" — but a real setting.
"The stone steps of the Athenian agora are cool beneath bare feet. The market stalls
have closed for the evening. Somewhere in the fading light, an old man sits on a bench
and waits. His name is Socrates."
Ground the listener in place. Make them feel they are there.

BODY (middle scenes):
Move through different philosophers and their key moments. Each scene should:
- Open with a vivid sensory detail from the setting
- Present ONE teaching or moment from that philosopher's life
- Explain the idea simply, as if to someone drifting off to sleep
- Close with a quiet, settling thought

The scenes should feel like wandering through a museum at night — moving from
one philosopher to the next, spending time with each, finding connections.

CLOSE (final 2 scenes):
Bring the themes together. The final scene should be the most peaceful —
a philosopher at rest, the setting quiet, the ideas settling like dust.
End with silence implied. The listener should already be asleep.

${SLEEP_VOICE_RULES}

${SCENE_OUTPUT_FORMAT}

WORD COUNT — CRITICAL:
Total narration across all scenes: ${minWords}–${maxWords} words
Each scene: ~${WORDS_PER_MINUTE * 3} words (3 minutes)
Number of scenes: ${sceneCount}

Return ONLY the JSON array. No preamble, no markdown fences, no explanation.`;
}

// ─── BLOCK GENERATION ───────────────────────────────────────────────────────
// For videos >20 min, generate in blocks to stay within token limits.

const BLOCK_SIZE_MINUTES = 15;

async function generateScriptBlock(topic, blockNum, totalBlocks, philosophers, duration) {
  const blockMinutes = Math.min(BLOCK_SIZE_MINUTES, duration - (blockNum - 1) * BLOCK_SIZE_MINUTES);
  const sceneCount = Math.max(2, Math.round(blockMinutes * 60 / 37)); // ~37 seconds per scene
  const targetWords = Math.round(blockMinutes * WORDS_PER_MINUTE);

  // Rotate philosophers across blocks so we don't cluster
  const blockPhilosophers = [];
  for (let i = 0; i < sceneCount; i++) {
    const philIndex = ((blockNum - 1) * sceneCount + i) % philosophers.length;
    if (!blockPhilosophers.includes(philosophers[philIndex])) {
      blockPhilosophers.push(philosophers[philIndex]);
    }
  }

  const continuityNote = blockNum > 1
    ? `\nCONTINUITY: This is block ${blockNum} of ${totalBlocks}. The listener has been listening for ${(blockNum - 1) * BLOCK_SIZE_MINUTES} minutes. They may be half asleep. Do NOT re-introduce concepts. Flow naturally from the previous section. The pace should be even slower now.\n`
    : "";

  const closingNote = blockNum === totalBlocks
    ? `\nFINAL BLOCK: This is the ending. The last 2 scenes should be the most peaceful and quiet of the entire video. Bring the themes to rest. End with implied silence.\n`
    : "";

  const prompt = buildSleepPhilosophyPrompt(topic, blockMinutes.toString(), blockPhilosophers)
    + continuityNote + closingNote;

  // Scale timeout with block size — 15-min blocks need up to 6 min at Haiku's pace
  const blockTimeoutMs = Math.max(180000, blockMinutes * 24000);
  const raw = await callClaudeCLI(prompt, { model: MODEL, timeoutMs: blockTimeoutMs });
  const text = raw.trim()
    .replace(/^```(?:json)?\s*/gm, "").replace(/```\s*$/gm, "").trim();

  return JSON.parse(text);
}

// ─── CRAFT IMAGE PROMPT ─────────────────────────────────────────────────────
// Equivalent of VideoForge's craftAIPrompt — takes scene context and wraps it
// in the locked chalk-on-blackboard style from test10.
//
// This is called by the pipeline when generating images, NOT during script gen.
// Included here so the prompt template lives next to the scene format.

const CHALK_STYLE_PREFIX = "Chalk street art drawing on dark blackboard, rough imperfect white chalk strokes on pure black surface, visible chalk dust and smudges, heavy chalk texture on all surfaces including skin and clothing, strictly monochrome white and grey chalk only, absolutely no color no warm tones no gold no orange no brown, NOT a photograph NOT photorealistic NOT a painting, hand-drawn chalk lines only,";
const CHALK_STYLE_SUFFIX = "medium distance three-quarter body shot, subject centered horizontally in the frame with balanced negative space on both left and right sides, dark blackboard texture background visible, chalk dust particles in air, no light sources no fire no candle no lantern no glow no flame no stars, no text no writing no words no letters, no signature no watermark no artist mark, 16:9 landscape composition";

// variant 0 = standard; 1 = wider establishing; 2 = hands/detail close-up
export function craftImagePrompt(scene, variant = 0) {
  const who = scene.philosopher;
  const setting = scene.setting || "";

  const lightWords = /candle\w*|fire\w*|flame\w*|lantern\w*|torch\w*|lamp\w*|glow\w*|burn\w*|lit |light\w*/gi;
  const action = scene.action.replace(lightWords, "").replace(/\s{2,}/g, " ").trim();

  const archElements = setting.match(/column|temple|agora|forum|portico|arch|step|wall|gate|pillar|amphitheatre|lyceum|academy/i);
  const archDetail = archElements ? archElements[0].toLowerCase() : "Doric column";

  // Variant-specific composition adjustments
  const compositions = [
    `medium distance three-quarter body shot, subject centered`,
    `wide establishing shot showing full environment, figure smaller in frame`,
    `close detail of hands and posture, gestural chalk strokes`,
  ];
  const compDetail = compositions[variant % compositions.length];

  // Replace the suffix's default composition hint with the variant one
  const suffixVariant = CHALK_STYLE_SUFFIX.replace("medium distance three-quarter body shot, subject centered horizontally in the frame with balanced negative space on both left and right sides", compDetail);

  return `${CHALK_STYLE_PREFIX} ${who} in ancient Greek toga ${action}, swirling chalk dust and atmospheric chalk strokes around the figure, ${archDetail} visible in background, ${suffixVariant}`;
}

// ─── CONSTRAINT LINT ────────────────────────────────────────────────────────
// Flags proper-noun names in scene narration that aren't real historical figures.
// Catches "Aurelia"-style hallucinations that slip past the prompt constraints.

const ALLOWED_HISTORICAL_NAMES = new Set([
  // Pre-Socratics + Classical Greek
  "Heraclitus", "Parmenides", "Empedocles", "Anaximander", "Pythagoras", "Thales",
  "Xenophanes", "Xenophon", "Socrates", "Plato", "Aristotle", "Diogenes",
  "Protagoras", "Gorgias", "Antisthenes", "Crito", "Phaedo", "Alcibiades",
  "Critias", "Glaucon", "Adeimantus", "Theaetetus", "Meno", "Hippias", "Lysis",
  "Aspasia", "Xanthippe", "Crates", "Hipparchia", "Speusippus", "Theophrastus",
  // Hellenistic
  "Zeno", "Cleanthes", "Chrysippus", "Epicurus", "Lucretius", "Pyrrho",
  "Sextus Empiricus", "Epaphroditus",
  // Roman Stoics + their circle
  "Marcus", "Aurelius", "Seneca", "Epictetus", "Cicero", "Cato", "Brutus",
  "Lucilius", "Faustina", "Commodus", "Antoninus", "Hadrian", "Nero", "Plutarch",
  "Boethius", "Musonius", "Rufus", "Pliny", "Tacitus",
  // Place names (proper nouns but not "named characters")
  "Athens", "Rome", "Sparta", "Corinth", "Thebes", "Delphi", "Olympia", "Ephesus",
  "Miletus", "Samos", "Crete", "Sicily", "Greece", "Italy", "Egypt", "Persia",
  "Asia", "Europe", "Mediterranean", "Aegean", "Tiber", "Danube", "Rhine",
  "Acropolis", "Parthenon", "Lyceum", "Academy", "Stoa", "Agora", "Forum",
  "Capitoline", "Palatine", "Nicopolis", "Epirus", "Macedonia", "Carthage",
  "Alexandria", "Syracuse", "Argos", "Mycenae", "Lesbos", "Rhodes", "Cyprus",
  "Anatolia", "Gaul", "Britannia", "Hispania", "Pannonia", "Antioch", "Smyrna",
  "Pergamon", "Halicarnassus", "Cyrene", "Tarsus", "Capua", "Ostia", "Pompeii",
  "Hellespont", "Bosphorus", "Nile", "Apennines", "Olympus",
]);

// Scan scene narration for capitalized words that look like a proper name
// (not at start of sentence). Returns flagged names.
function lintForFictionalNames(scenes) {
  const flagged = new Map(); // name → first sentence it appeared in
  for (const scene of scenes) {
    const text = scene.narration || "";
    // Split into sentences, then for each sentence skip the first word and look
    // at subsequent capitalized words. Two-word capitalized sequences get joined.
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const tokens = sentence.split(/\s+/);
      for (let i = 1; i < tokens.length; i++) {
        const raw = tokens[i].replace(/[^A-Za-z'-]/g, "");
        if (!/^[A-Z][a-z]+$/.test(raw)) continue;
        if (ALLOWED_HISTORICAL_NAMES.has(raw)) continue;
        // Allow common capitalized words that aren't names: "I", "Stoic", "Greek", "Roman", etc.
        if (/^(I|Stoic|Stoics|Greek|Greeks|Roman|Romans|God|Gods|Olympian|Olympians|Spartan|Spartans|Cynic|Cynics|Epicurean|Epicureans|Skeptic|Skeptics|Platonist|Platonists|Aristotelian|Sophist|Sophists|Persian|Persians|Egyptian|Egyptians|Sicilian|Sicilians|Athenian|Athenians|Theban|Thebans|Imperial|Empire|Republic|Senate|Consul|Praetor|Tribune|Legion|North|South|East|West|Northern|Southern|Eastern|Western|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Spring|Summer|Autumn|Winter)$/.test(raw)) continue;
        if (!flagged.has(raw)) flagged.set(raw, sentence.trim().slice(0, 100));
      }
    }
  }
  return flagged;
}

// ─── MAIN EXPORT ────────────────────────────────────────────────────────────

export async function generateScript(topic, options = {}) {
  const duration = parseInt(options.duration) || 60; // Default 60 min for sleep
  const outputDir = options.output || "./scripts";
  const philosopherKeys = options.philosophers
    || ["socrates", "plato", "aristotle", "marcus-aurelius", "epictetus", "seneca"];

  // Validate philosopher keys
  const validPhilosophers = philosopherKeys.filter(k => PHILOSOPHERS[k]);
  if (validPhilosophers.length === 0) {
    throw new Error(`No valid philosophers found. Available: ${Object.keys(PHILOSOPHERS).join(", ")}`);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n  SleepForge Script Generator`);
  console.log(`  Topic: "${topic}"`);
  console.log(`  Duration: ${duration} min`);
  console.log(`  Philosophers: ${validPhilosophers.map(k => PHILOSOPHERS[k].name).join(", ")}`);
  console.log(`  Model: ${MODEL} (target cost: ~$0.10)`);

  const totalBlocks = Math.max(1, Math.ceil(duration / BLOCK_SIZE_MINUTES));
  const allScenes = [];

  for (let i = 1; i <= totalBlocks; i++) {
    const blockLabel = `block ${i}/${totalBlocks}`;
    console.log(`  Writing ${blockLabel}...`);

    try {
      const scenes = await generateScriptBlock(topic, i, totalBlocks, validPhilosophers, duration);
      allScenes.push(...scenes);
      console.log(`  ${blockLabel}: ${scenes.length} scenes`);
    } catch (err) {
      console.error(`  ${blockLabel} failed: ${err.message}`);
      // Retry once
      console.log(`  Retrying ${blockLabel}...`);
      await new Promise(r => setTimeout(r, 3000));
      try {
        const scenes = await generateScriptBlock(topic, i, totalBlocks, validPhilosophers, duration);
        allScenes.push(...scenes);
      } catch (retryErr) {
        console.error(`  ${blockLabel} retry failed: ${retryErr.message}`);
        throw retryErr;
      }
    }
  }

  // Constraint lint — flag any fictional names that slipped through.
  // We log them but don't throw: ASR-corrupted Whisper text or genuine new
  // historical figures should not block the pipeline. The signal is enough
  // to spot patterns over time.
  const flaggedNames = lintForFictionalNames(allScenes);
  if (flaggedNames.size > 0) {
    console.log(`  ⚠ Constraint lint flagged ${flaggedNames.size} possibly-fictional name(s):`);
    for (const [name, sentence] of flaggedNames) {
      console.log(`     ${name}: "${sentence}…"`);
    }
  } else {
    console.log(`  ✓ Constraint lint: no suspicious named characters`);
  }

  // Build outputs
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

  // 1. Full structured JSON (scenes with metadata — used by pipeline)
  const jsonPath = path.join(outputDir, `${slug}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(allScenes, null, 2));

  // 2. Plain narration text (used by TTS)
  const narrationText = allScenes.map(s => s.narration).join("\n\n\n");
  const txtPath = path.join(outputDir, `${slug}.txt`);
  fs.writeFileSync(txtPath, narrationText);

  // 3. Image prompts (pre-computed for batch generation)
  const imagePrompts = allScenes.map((s, i) => ({
    index: i,
    philosopher: s.philosopher,
    moment: s.moment,
    prompt: craftImagePrompt(s),
  }));
  const promptsPath = path.join(outputDir, `${slug}-image-prompts.json`);
  fs.writeFileSync(promptsPath, JSON.stringify(imagePrompts, null, 2));

  // Stats
  const totalWords = narrationText.split(/\s+/).length;
  const estMinutes = (totalWords / WORDS_PER_MINUTE).toFixed(1);

  console.log(`\n  Script complete!`);
  console.log(`  Scenes: ${allScenes.length}`);
  console.log(`  Words: ${totalWords} (~${estMinutes} min at ${WORDS_PER_MINUTE} wpm)`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  Text: ${txtPath}`);
  console.log(`  Image prompts: ${promptsPath}`);

  return {
    scenes: allScenes,
    jsonPath,
    txtPath,
    promptsPath,
    imagePrompts,
    wordCount: totalWords,
    estMinutes: parseFloat(estMinutes),
    sceneCount: allScenes.length,
  };
}
