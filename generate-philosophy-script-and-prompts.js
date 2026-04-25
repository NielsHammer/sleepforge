import fs from 'fs';
import path from 'path';

const outputDir = 'assets';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const sections = [
  {
    title: 'Socrates and the hemlock',
    text: 'Socrates chooses death over dishonoring his principles, teaching students in a stone prison courtyard that truth is worth any cost.',
    prompt: 'Dark 16:9 pixel art of Socrates calmly drinking hemlock in a stone prison courtyard while students watch from the shadows, natural ancient Greek philosophy atmosphere, stone-mason carved relief style, no text',
  },
  {
    title: 'Plato and the cave',
    text: 'Plato shows a prisoner the light outside the cave, a turning point for understanding the difference between appearance and reality.',
    prompt: 'Dark 16:9 pixel art of Plato leading a prisoner from a shadowy cave toward an open courtyard bathed in pale sunlight, meaningful allegory of enlightenment, no text',
  },
  {
    title: 'Aristotle classifies life',
    text: 'Aristotle arranges stone animal figures in his academy, demonstrating the first systematic attempt to categorize nature and reason.',
    prompt: 'Dark 16:9 pixel art of Aristotle placing stone animal models on a marble table in a courtyard academy, capturing the act of classifying forms, no text',
  },
  {
    title: 'Marcus Aurelius writing',
    text: 'Marcus Aurelius sits on a street bench writing his journal, making private notes about stoic self-discipline and inner freedom.',
    prompt: 'Dark 16:9 pixel art of Marcus Aurelius seated on a stone street bench writing in a leather notebook, stoic expression, rain-slick marble street, no text',
  },
  {
    title: 'Nietzsche and eternal recurrence',
    text: 'Nietzsche walks a curved stone path past ruins at dusk, reflecting on whether he would gladly relive this life forever.',
    prompt: 'Dark 16:9 pixel art of Nietzsche walking alone along a curved stone path between ancient ruins at dusk, thoughtful and intense, no text',
  },
  {
    title: 'Descartes doubts',
    text: 'Descartes sits alone in a candlelit study, turning over a skull as he questions the certainty of the material world.',
    prompt: 'Dark 16:9 pixel art of Descartes in a candlelit study holding a skull and gazing into the fire, natural philosophical mood, no text',
  },
  {
    title: 'Kant and the moral law',
    text: 'Kant walks under lantern light in Königsberg, thinking about duty and the universal principles that should govern action.',
    prompt: 'Dark 16:9 pixel art of Immanuel Kant pacing beneath lantern-lit arches in Königsberg at night, deep introspection, no text',
  },
  {
    title: 'Locke on experience',
    text: 'Locke writes by a window with apple and key nearby, illustrating that mind and knowledge begin from experience, not from innate ideas.',
    prompt: 'Dark 16:9 pixel art of John Locke writing at a window desk with an apple and key beside him, shadowy study atmosphere, no text',
  },
  {
    title: 'Hume and the senses',
    text: 'Hume sits at a tavern table, watching a river of thought flow past as he considers how impressions form the basis of belief.',
    prompt: 'Dark 16:9 pixel art of David Hume at a stone tavern table watching a river outside the window, thoughtful and skeptical, no text',
  },
  {
    title: 'Mill and the greatest happiness',
    text: 'Mill sits in a garden as bees hover, thinking about how actions should be judged by the happiness they promote for the many.',
    prompt: 'Dark 16:9 pixel art of John Stuart Mill in a quiet garden with bees and flowers, his face absorbed in thought about utility, no text',
  },
  {
    title: 'Confucius teaching virtue',
    text: 'Confucius sits beneath a pine tree instructing his students on the importance of ritual, family, and proper conduct.',
    prompt: 'Dark 16:9 pixel art of Confucius teaching pupils beneath a pine tree in a stone courtyard, calm and wise atmosphere, no text',
  },
  {
    title: 'Buddha under the fig tree',
    text: 'The Buddha meditates beneath the fig tree, embodying the quiet path beyond desire and suffering.',
    prompt: 'Dark 16:9 pixel art of the Buddha meditating beneath a fig tree beside a stone pond, serene and grounded, no text',
  },
  {
    title: 'Ship of Theseus',
    text: 'A wooden ship at a moonlit harbor is rebuilt plank by plank, asking whether the same object survives change.',
    prompt: 'Dark 16:9 pixel art of the Ship of Theseus being repaired in a moonlit harbor, distinct planks visible, philosophical imagery of identity through change, no text',
  },
  {
    title: 'Mind and body split',
    text: 'A stone statue split in two shows a physical body on one side and a thought-filled interior on the other.',
    prompt: 'Dark 16:9 pixel art of a carved statue split between body and mind, one side polished stone, one side glowing inner thought, no text',
  },
  {
    title: 'Free will crossroads',
    text: 'A lone traveler stands at a fork in a dark stone road, contemplating whether actions are chosen freely or predetermined.',
    prompt: 'Dark 16:9 pixel art of a solitary figure at a crossroads on a black stone road under stormy sky, subtle philosophical tension, no text',
  },
  {
    title: 'Ethics of action',
    text: 'A scale balances a stone heart against a stone sword, symbolizing the tension between compassion and duty.',
    prompt: 'Dark 16:9 pixel art of a stone scale balancing a heart and sword in a dim hall, ethical decision-making made visible, no text',
  },
  {
    title: 'Pragmatism in practice',
    text: 'A builder lays stone steps by hand, showing philosophy tested through real outcomes rather than abstract doctrine.',
    prompt: 'Dark 16:9 pixel art of a carpenter building stone steps by candlelight, practical philosophy embodied, no text',
  },
  {
    title: 'Phenomenology of perception',
    text: 'A figure touches a floating stone shape, emphasizing experience over explanation.',
    prompt: 'Dark 16:9 pixel art of a person touching a glowing stone shape in a dark room, philosophical focus on perception, no text',
  },
  {
    title: 'Existential choice',
    text: 'A lone thinker stands on a cliff edge, feeling the weight of self-created meaning in an indifferent landscape.',
    prompt: 'Dark 16:9 pixel art of a solitary thinker on a cliff at twilight, existential mood and personal responsibility, no text',
  },
  {
    title: 'Nihilism emptiness',
    text: 'A dark chamber with a single empty chair captures the unsettling openness of a world without inherent meaning.',
    prompt: 'Dark 16:9 pixel art of an empty chair in a shadowy stone chamber, the mood of nihilism and absence, no text',
  },
  {
    title: 'Sartre in the cafe',
    text: 'Sartre writes in a rain-speckled cafe window, thinking about freedom, bad faith, and human choice.',
    prompt: 'Dark 16:9 pixel art of Jean-Paul Sartre writing in a rain-speckled cafe, inward gaze and existential atmosphere, no text',
  },
  {
    title: 'Aquinas in the monastery',
    text: 'Aquinas works in a dim scriptorium, synthesizing reason and faith in quiet stone corridors.',
    prompt: 'Dark 16:9 pixel art of Thomas Aquinas writing in a monastery scriptorium lit by candles, theological philosophy atmosphere, no text',
  },
  {
    title: 'Philosophy of life',
    text: 'A long stone path leads through changing seasons, symbolizing the search for a meaningful life.',
    prompt: 'Dark 16:9 pixel art of a winding stone path through autumn, winter, and spring, the philosophy of life made visible, no text',
  },
  {
    title: 'Meaning of life horizon',
    text: 'A traveler reaches a bright horizon after a long dark journey, asking whether purpose is on the other side or generated along the way.',
    prompt: 'Dark 16:9 pixel art of a traveler arriving at a bright horizon after a long stone road, deep philosophical meaning of life imagery, no text',
  },
];

const conceptPrompts = [
  'Dark 16:9 pixel art of Plato\'s cave with chains, shadow puppets, and a distant bright exit, no text',
  'Dark 16:9 pixel art of the Ship of Theseus at a moonlit dock with replaced planks visible, no text',
  'Dark 16:9 pixel art of a stone statue split into body and mind halves, no text',
  'Dark 16:9 pixel art of a lone figure at a crossroads between two stone paths, no text',
  'Dark 16:9 pixel art of a stone scale balancing a heart and a sword, no text',
  'Dark 16:9 pixel art of a carpenter building stone steps by candlelight, no text',
  'Dark 16:9 pixel art of a person touching a glowing stone shape in a dark room, no text',
  'Dark 16:9 pixel art of a solitary thinker on a rocky cliff at twilight, no text',
  'Dark 16:9 pixel art of an empty chair in a shadowy stone chamber, no text',
  'Dark 16:9 pixel art of a winding stone path through seasons, no text',
  'Dark 16:9 pixel art of a traveler arriving at a bright horizon along a stone road, no text',
  'Dark 16:9 pixel art of a blindfolded justice figure in a dark court hall, no text',
  'Dark 16:9 pixel art of a stone wall covered with overlapping carved masks, no text',
  'Dark 16:9 pixel art of a group of figures around a shared stone table exchanging stones, no text',
  'Dark 16:9 pixel art of a stone museum hall with one unusual sculpture lit by a spotlight, no text',
  'Dark 16:9 pixel art of a black marble globe connected by white stone lines, no text',
  'Dark 16:9 pixel art of a shattered stone chain with a white glow around the break, no text',
  'Dark 16:9 pixel art of a figure reaching for a small white flame in a dark cave, no text',
  'Dark 16:9 pixel art of overlapping stone geometry arranged in precise patterns, no text',
  'Dark 16:9 pixel art of a stone theater stage with shadowy actors and a bright doorway, no text',
  'Dark 16:9 pixel art of a dark forest path opening onto a bright stone temple, no text',
  'Dark 16:9 pixel art of a stone archway framing a stormy sea and a single lantern, no text',
  'Dark 16:9 pixel art of a stone pedestal with a glowing white seed sprouting, no text',
  'Dark 16:9 pixel art of a group of stone philosophers walking around a quiet courtyard, no text',
  'Dark 16:9 pixel art of a single white candle burning in a dark stone library, no text',
  'Dark 16:9 pixel art of a carved stone tree with one glowing leaf, no text',
  'Dark 16:9 pixel art of a giant stone book opening in a dark hall, no text',
  'Dark 16:9 pixel art of a pair of stone hands reaching toward each other over a void, no text',
  'Dark 16:9 pixel art of a stone bridge with one white lantern guiding the way, no text',
  'Dark 16:9 pixel art of a dark stone room with a single open window showing the stars, no text',
  'Dark 16:9 pixel art of a stone mask lying on a table beside a hand, no text',
  'Dark 16:9 pixel art of a carved stone avalanche frozen in a moment of motion, no text',
  'Dark 16:9 pixel art of a stone maze seen from above with one bright path, no text',
  'Dark 16:9 pixel art of a solitary stone lantern glowing on a cliff edge, no text',
  'Dark 16:9 pixel art of a group of stone figures holding a glowing rope together, no text',
  'Dark 16:9 pixel art of an old stone library with spiraling shelves, no text',
  'Dark 16:9 pixel art of a stone boat crossing a black stone lake under moonlight, no text',
  'Dark 16:9 pixel art of a carved stone sun breaking through dark clouds, no text',
  'Dark 16:9 pixel art of a stone clock with missing hands, no text',
  'Dark 16:9 pixel art of a dark stone courtyard with a single white gate opening, no text',
  'Dark 16:9 pixel art of a stone puzzle on a table being assembled by glowing hands, no text',
  'Dark 16:9 pixel art of a figure standing before a stone mirror reflecting a different scene, no text',
  'Dark 16:9 pixel art of a large stone spiral staircase disappearing into shadow, no text',
  'Dark 16:9 pixel art of a stone balcony overlooking a starry philosophical city, no text',
  'Dark 16:9 pixel art of a dark mountain path with one bright lantern leading onward, no text',
];

const scriptLines = sections.map((section, index) => `${index + 1}. ${section.title} - ${section.text}`);
const promptLines = [...sections.map(section => section.prompt), ...conceptPrompts];

fs.writeFileSync(path.join(outputDir, 'philosophy-video-script-outline.txt'), scriptLines.join('\n\n'));
fs.writeFileSync(path.join(outputDir, 'philosophy-pixel-art-prompts.txt'), promptLines.join('\n'));

console.log('Generated philosophy script outline and 100 image prompts.');
console.log('Wrote assets/philosophy-video-script-outline.txt and assets/philosophy-pixel-art-prompts.txt');
