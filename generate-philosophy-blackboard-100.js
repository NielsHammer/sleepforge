import { generateChalkboardImage } from './src/fal.js';
import fs from 'fs';
import path from 'path';

const outputDir = 'assets';
const imageOutputDir = path.join('assets', 'images', 'test8');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
if (fs.existsSync(path.join('assets', 'images'))) {
  fs.rmSync(path.join('assets', 'images'), { recursive: true, force: true });
}
fs.mkdirSync(imageOutputDir, { recursive: true });

const topPhilosophers = [
  {
    name: 'Socrates',
    coreIdea: 'truth through questioning',
    entries: [
      {
        title: 'Socrates Cross-Examining a Youth',
        action: 'leaning forward and questioning a young man',
        why: 'This image captures Socrates in his most iconic role: forcing truth out through relentless questioning.',
      },
      {
        title: 'Socrates Pointing at the Empty Bench',
        action: 'pointing at an empty bench and demanding an answer',
        why: 'It shows his method of probing absence and assumption, highlighting the power of inquiry.',
      },
      {
        title: 'Socrates Writing a Question',
        action: 'sketching a question on the blackboard with jagged chalk',
        why: 'It emphasizes that his philosophy is a practice of asking the right questions rather than stating answers.',
      },
      {
        title: 'Socrates Drinking Hemlock',
        action: 'lifting a cup of hemlock with a steady hand',
        why: 'This moment embodies his commitment to principle over comfort, making the action more important than atmosphere.',
      },
      {
        title: 'Socrates Listening to a Student',
        action: 'listening intently to a young man while tracing a line with chalk',
        why: 'It shows the dialogue style that defines his philosophy and the focus on direct human exchange.',
      },
    ],
  },
  {
    name: 'Plato',
    coreIdea: 'higher reality and the good',
    entries: [
      {
        title: 'Plato Pointing Toward the Light',
        action: 'pointing toward a shaft of light on the blackboard',
        why: 'This image references the allegory of the cave while keeping the focus on Plato guiding the viewer toward the good.',
      },
      {
        title: 'Plato Drawing the Divided Line',
        action: 'drawing a divided line with rough chalk strokes',
        why: 'It captures his theory of knowledge through a simple symbolic diagram on the board.',
      },
      {
        title: 'Plato Holding the Good',
        action: 'holding a faint chalk circle labeled as the good',
        why: 'This emphasizes his central idea that true reality is represented by a single guiding form.',
      },
      {
        title: 'Plato Guiding a Prisoner',
        action: 'touching a chained prisoner\'s shoulder as he turns toward light',
        why: 'It makes the core action of liberation and education the visual anchor of the image.',
      },
      {
        title: 'Plato Sketching the Cave',
        action: 'sketching a cave outline with shadow figures in chalk',
        why: 'It presents his most famous allegory in a direct, hand-drawn way without any background detail.',
      },
    ],
  },
  {
    name: 'Aristotle',
    coreIdea: 'classification and practical knowledge',
    entries: [
      {
        title: 'Aristotle Arranging Models',
        action: 'arranging small animal figures on the blackboard table',
        why: 'This image highlights his method of organizing the world through close observation and classification.',
      },
      {
        title: 'Aristotle Writing Categories',
        action: 'writing category names in chalk with a steady hand',
        why: 'It shows his emphasis on defining kinds and making sense of reality through clear structure.',
      },
      {
        title: 'Aristotle Studying a Bird Wing',
        action: 'tracing the shape of a bird wing in chalk',
        why: 'It captures his empirical focus on living forms and the concrete basis of his philosophy.',
      },
      {
        title: 'Aristotle Pointing at the Golden Mean',
        action: 'pointing at a written golden mean formula',
        why: 'This shows his ethical idea of balance as a simple, memorable chalkboard diagram.',
      },
      {
        title: 'Aristotle Balancing Causes',
        action: 'drawing a set of linked circles to explain causes',
        why: 'It makes his causal theory visible in a single hand-drawn philosophical moment.',
      },
    ],
  },
  {
    name: 'Confucius',
    coreIdea: 'ritual, harmony, and duty',
    entries: [
      {
        title: 'Confucius Correcting a Student\'s Gesture',
        action: 'adjusting a student\'s hand placement with precise chalk lines',
        why: 'This moments shows his teaching through ritual posture and moral refinement.',
      },
      {
        title: 'Confucius Writing a Character',
        action: 'writing a calligraphic character with deliberate chalk strokes',
        why: 'It links his philosophy of proper conduct to slow, careful practice.',
      },
      {
        title: 'Confucius Holding a Ritual Tablet',
        action: 'holding a tablet of ritual instructions in front of the blackboard',
        why: 'It emphasizes the importance of tradition and order in his thinking.',
      },
      {
        title: 'Confucius Pointing to Filial Duty',
        action: 'pointing to a written phrase about family duty',
        why: 'It makes his ethical core immediately legible as an action of guidance.',
      },
      {
        title: 'Confucius Holding a Cup of Tea',
        action: 'holding a cup of tea while listening to a pupil',
        why: 'It gives the image a calm, interpersonal focus without any distracting scenery.',
      },
    ],
  },
  {
    name: 'Buddha',
    coreIdea: 'awakening and release from suffering',
    entries: [
      {
        title: 'Buddha Opening His Eyes',
        action: 'opening his eyes after meditation in a quiet chalk gesture',
        why: 'This moment condenses awakening into a single, powerful action.',
      },
      {
        title: 'Buddha Calling the Earth Witness',
        action: 'touching the blackboard as the earth witness gesture',
        why: 'It references the moment of truth in a simple, iconic chalkboard image.',
      },
      {
        title: 'Buddha Holding an Alms Bowl',
        action: 'holding an empty alms bowl with gentle chalk lines',
        why: 'It emphasizes simplicity and surrender, core themes in his teaching.',
      },
      {
        title: 'Buddha Teaching a Disciple',
        action: 'raising one hand toward a listening disciple',
        why: 'It shows the transmission of insight in a direct philosophical gesture.',
      },
      {
        title: 'Buddha Tracing a Mandala',
        action: 'tracing a circle of chalk to suggest the wheel of dharma',
        why: 'It turns his philosophy into a symbolic, meditative drawing.',
      },
    ],
  },
  {
    name: 'Descartes',
    coreIdea: 'methodical doubt and the thinking self',
    entries: [
      {
        title: 'Descartes Holding a Skull',
        action: 'holding a skull close to his face in chalky detail',
        why: 'This classic image makes his doubt and mortality feel immediate and personal.',
      },
      {
        title: 'Descartes Writing a Formula',
        action: 'writing a mathematical formula with careful chalk',
        why: 'It links his philosophical doubt to the precision of scientific method.',
      },
      {
        title: 'Descartes Looking in a Mirror',
        action: 'looking into a mirror he draws in chalk',
        why: 'It visualizes his search for the thinking subject in a direct symbolic way.',
      },
      {
        title: 'Descartes Tracing a Circle',
        action: 'tracing a perfect circle with chalk on the board',
        why: 'This image represents his rationalist search for certainty through geometry.',
      },
      {
        title: 'Descartes Pointing to Cogito',
        action: 'pointing to the words \"I think\" sketched faintly in chalk',
        why: 'It makes his foundational idea a focused, hand-drawn statement without any real background.',
      },
    ],
  },
  {
    name: 'Kant',
    coreIdea: 'duty, moral law, and universality',
    entries: [
      {
        title: 'Kant Pointing to Duty',
        action: 'pointing to a written moral law on the board',
        why: 'It makes his ethic visible as a single guiding gesture.',
      },
      {
        title: 'Kant Holding a Book',
        action: 'holding a book while framing a rule with chalk',
        why: 'This image blends his scholarly seriousness with the formal structure of his philosophy.',
      },
      {
        title: 'Kant Kneeling in Study',
        action: 'kneeling in a quiet posture before the board',
        why: 'It emphasizes the discipline and reverence of his moral project.',
      },
      {
        title: 'Kant Drawing a Path',
        action: 'drawing a straight path with rough chalk lines',
        why: 'It symbolizes his idea of universal law as a clear, straight course.',
      },
      {
        title: 'Kant Holding a Scale',
        action: 'holding a small scale while writing a command',
        why: 'It links duty and moral balance through a simple, focused action.',
      },
    ],
  },
  {
    name: 'Nietzsche',
    coreIdea: 'affirmation, strength, and new values',
    entries: [
      {
        title: 'Nietzsche Raising a Hammer',
        action: 'raising a hammer above his head with fierce chalk strokes',
        why: 'This image captures his aggressive affirmation and the act of breaking old idols.',
      },
      {
        title: 'Nietzsche Standing on the Ridge',
        action: 'standing with sharp chalk lines at the edge of a ridge',
        why: 'It suggests his lonely search for new perspectives without relying on scenery.',
      },
      {
        title: 'Nietzsche Smashing a Mask',
        action: 'smashing a mask into chalk dust',
        why: 'It represents his critique of false identities in a bold, symbolic action.',
      },
      {
        title: 'Nietzsche Holding a Sun',
        action: 'holding a rough chalk sun in his palm',
        why: 'It evokes his idea of life-affirmation and creativity without textual clutter.',
      },
      {
        title: 'Nietzsche Pointing to the Overman',
        action: 'pointing at a chalk outline of a stronger figure',
        why: 'This makes his ideal of the overman concrete through a single gesture.',
      },
    ],
  },
  {
    name: 'Hume',
    coreIdea: 'impressions, belief, and skepticism',
    entries: [
      {
        title: 'Hume Watching a Droplet',
        action: 'watching a single chalk droplet fall',
        why: 'It shows his philosophy as a close attention to experience and impression.',
      },
      {
        title: 'Hume Turning a Page',
        action: 'turning a page on a sketchy book of experience',
        why: 'It emphasizes the flow of impressions that shape belief.',
      },
      {
        title: 'Hume Holding a Lantern',
        action: 'holding a lantern of faint chalk light',
        why: 'It symbolizes his search for reliable belief in the darkness of uncertainty.',
      },
      {
        title: 'Hume Looking at a Flame',
        action: 'studying a small flame drawn in chalk',
        why: 'It makes his theory of perception feel like a simple sensory moment.',
      },
      {
        title: 'Hume Exchanging Coins',
        action: 'passing chalk coins across the board',
        why: 'It connects his ideas about human custom and value to everyday exchange.',
      },
    ],
  },
  {
    name: 'John Locke',
    coreIdea: 'experience as the source of ideas',
    entries: [
      {
        title: 'Locke Writing a Blank Slate',
        action: 'writing on a blank slate with a rough chalk tip',
        why: 'It makes his famous tabula rasa metaphor concrete and powerful.',
      },
      {
        title: 'Locke Holding a Key',
        action: 'holding a key next to a blank path of chalk',
        why: 'It shows knowledge as something unlocked through experience.',
      },
      {
        title: 'Locke Arranging Sensory Objects',
        action: 'placing simple sensory objects in chalk on the board',
        why: 'It visualizes his idea that knowledge begins with sensation.',
      },
      {
        title: 'Locke Pointing to the Outside World',
        action: 'pointing at a faint chalk horizon beyond the board',
        why: 'It makes the source of ideas feel external and directly experienced.',
      },
      {
        title: 'Locke Needing a Child\'s Hand',
        action: 'stabilizing a child\'s hand as they write in chalk',
        why: 'It underlines his belief in learning through early experience and education.',
      },
    ],
  },
  {
    name: 'Karl Marx',
    coreIdea: 'class struggle and material conditions',
    entries: [
      {
        title: 'Marx Observing Workers',
        action: 'observing workers drawn as simple chalk silhouettes',
        why: 'It captures his focus on labor and the structure of society.',
      },
      {
        title: 'Marx Holding a Pamphlet',
        action: 'holding a rough pamphlet of ideas in chalk',
        why: 'It suggests the power of theory grounded in material analysis.',
      },
      {
        title: 'Marx Breaking Chains',
        action: 'breaking a chain of chalk links',
        why: 'It symbolizes liberation from oppression in a direct visual moment.',
      },
      {
        title: 'Marx Pointing to a Wall',
        action: 'pointing to a rising wall of chalk bricks',
        why: 'It references the structures of class and power with a simple, strong image.',
      },
      {
        title: 'Marx Writing a Manifesto',
        action: 'writing bold lines on the board as if composing a manifesto',
        why: 'It emphasizes the revolutionary force of his ideas in one clear action.',
      },
    ],
  },
  {
    name: 'Seneca',
    coreIdea: 'Stoic calm and control over emotion',
    entries: [
      {
        title: 'Seneca Closing a Scroll',
        action: 'closing a scroll by candlelight in rough chalk',
        why: 'It shows his choice to end a thought deliberately and calmly.',
      },
      {
        title: 'Seneca Gazing at a Candle',
        action: 'gazing at a small chalk candle with steady eyes',
        why: 'It represents his focus on control and inner light rather than external chaos.',
      },
      {
        title: 'Seneca Holding a Sword and Scroll',
        action: 'holding a sword and scroll side by side',
        why: 'It contrasts action and wisdom in a single symbolic gesture.',
      },
      {
        title: 'Seneca Standing Before Storm',
        action: 'standing calm as chalky storm lines swirl around him',
        why: 'It visualizes stoic resilience as inner calm amid outward turmoil.',
      },
      {
        title: 'Seneca Writing by Lamp',
        action: 'writing in a lamp\'s glow with rough chalk strokes',
        why: 'It highlights his reflective practice as the core of his philosophy.',
      },
    ],
  },
  {
    name: 'Marcus Aurelius',
    coreIdea: 'self-examination and duty',
    entries: [
      {
        title: 'Marcus Aurelius Writing a Meditation',
        action: 'writing in a journal with a worn chalk hand',
        why: 'It shows his central practice of daily self-reflection in a simple image.',
      },
      {
        title: 'Marcus Aurelius Gazing at the Sea',
        action: 'gazing toward a chalk sea line on the board',
        why: 'It evokes his calm acceptance of nature and fate.',
      },
      {
        title: 'Marcus Aurelius Standing with Armor Set Aside',
        action: 'standing with a hand resting on a chalk helmet',
        why: 'It symbolizes his choice of inner strength over outward power.',
      },
      {
        title: 'Marcus Aurelius Marking the Stars',
        action: 'marking stars in chalk while writing a note',
        why: 'It connects his recognition of the cosmos to practical duty.',
      },
      {
        title: 'Marcus Aurelius Holding a Scroll',
        action: 'holding a scroll of meditations close to his chest',
        why: 'It highlights the personal, reflective nature of his philosophy.',
      },
    ],
  },
  {
    name: 'Aquinas',
    coreIdea: 'faith and reason in harmony',
    entries: [
      {
        title: 'Aquinas Writing in the Scriptorium',
        action: 'writing with slow chalk strokes in a monastic tone',
        why: 'It presents his synthesis of theology and philosophy as disciplined work.',
      },
      {
        title: 'Aquinas Holding a Cross and Book',
        action: 'holding a cross in one hand and a book in the other',
        why: 'It makes his effort to balance faith and reason visible in a single pose.',
      },
      {
        title: 'Aquinas Teaching a Novice',
        action: 'pointing to a simple diagram while a novice listens',
        why: 'It shows his role as a teacher who connects belief with intellect.',
      },
      {
        title: 'Aquinas Drawing a Diagram',
        action: 'drawing a linked set of ideas with careful chalk lines',
        why: 'It symbolizes his method of organizing theological principles logically.',
      },
      {
        title: 'Aquinas Balancing Two Spheres',
        action: 'balancing a chalk sphere labeled faith against one labeled reason',
        why: 'It makes his central philosophical harmony concrete and simple.',
      },
    ],
  },
  {
    name: 'Sartre',
    coreIdea: 'existence precedes essence and freedom',
    entries: [
      {
        title: 'Sartre Writing in the Cafe',
        action: 'writing with a cigarette in hand at a chalk table',
        why: 'It presents his existential thinking as a direct, lived writing moment.',
      },
      {
        title: 'Sartre Looking at an Empty Chair',
        action: 'looking at an empty chair sketched in chalk',
        why: 'It evokes his idea of freedom and the responsibility of choice in a single frame.',
      },
      {
        title: 'Sartre Holding a Mask',
        action: 'holding a theatrical mask half-drawn in chalk',
        why: 'It symbolizes his critique of inauthenticity and the self-made life.',
      },
      {
        title: 'Sartre Pointing at a Window',
        action: 'pointing toward a faint chalk window while seated',
        why: 'It suggests the possibility of transcendence through action.',
      },
      {
        title: 'Sartre Crossing His Hands',
        action: 'crossing his hands in a tense, thoughtful gesture',
        why: 'It captures the weight of responsibility that defines his philosophy.',
      },
    ],
  },
  {
    name: 'Beauvoir',
    coreIdea: 'selfhood and otherness',
    entries: [
      {
        title: 'Beauvoir Looking in the Mirror',
        action: 'looking into a dark mirror drawn in chalk',
        why: 'It visualizes her exploration of identity and the gaze of the other.',
      },
      {
        title: 'Beauvoir Writing with a Pen',
        action: 'writing intense lines at a chalk desk',
        why: 'It shows her intellectual engagement with freedom and equality.',
      },
      {
        title: 'Beauvoir Holding Two Figures',
        action: 'holding two small chalk figures side by side',
        why: 'It represents the relationship between self and other in a simple image.',
      },
      {
        title: 'Beauvoir Sitting at a Desk',
        action: 'sitting at a desk with a firm, thoughtful posture',
        why: 'It shows the discipline behind her feminist and existential ideas.',
      },
      {
        title: 'Beauvoir Pointing to a Shadow',
        action: 'pointing at a shadow figure on the board',
        why: 'It expresses her concern with how the self is reflected in society.',
      },
    ],
  },
  {
    name: 'Camus',
    coreIdea: 'absurdity and revolt',
    entries: [
      {
        title: 'Camus Standing at the Cliff',
        action: 'standing at the edge of a chalk cliff',
        why: 'It captures his image of the absurd hero confronting life\'s limits.',
      },
      {
        title: 'Camus Lighting a Candle',
        action: 'lighting a candle in rough chalk light',
        why: 'It symbolizes revolt as a small, defiant act against darkness.',
      },
      {
        title: 'Camus Holding a Stone',
        action: 'holding a stone tightly in his hand',
        why: 'It references his famous myth of Sisyphus with a rough, material gesture.',
      },
      {
        title: 'Camus Wearing a Mask',
        action: 'lifting a mask off his face in chalk',
        why: 'It suggests the choice to face absurdity honestly rather than hide.',
      },
      {
        title: 'Camus Looking at the Sun',
        action: 'looking up at a faint chalk sun',
        why: 'It presents his philosophy of living fully despite absurdity.',
      },
    ],
  },
  {
    name: 'Rumi',
    coreIdea: 'mystical union and love',
    entries: [
      {
        title: 'Rumi Spinning in the Meadow',
        action: 'spinning with flowing chalk lines around him',
        why: 'It brings the ecstatic movement of his poetry into a chalkboard form.',
      },
      {
        title: 'Rumi Writing a Poem',
        action: 'writing a line of verse with flourished chalk strokes',
        why: 'It shows his spiritual teaching as an intimate act of creation.',
      },
      {
        title: 'Rumi Embracing in Dance',
        action: 'embracing another figure in a loose chalk dance',
        why: 'It visualizes the unity he finds through love and surrender.',
      },
      {
        title: 'Rumi Holding a Rose',
        action: 'holding a single chalk rose with reverent care',
        why: 'It symbolizes his poetic image of divine love and beauty.',
      },
      {
        title: 'Rumi Gazing at the Moon',
        action: 'gazing at a chalk moon with soft attention',
        why: 'It suggests the mystical longing that runs through his work.',
      },
    ],
  },
  {
    name: 'Laozi',
    coreIdea: 'natural flow and effortless action',
    entries: [
      {
        title: 'Laozi Leaning on a Staff',
        action: 'leaning on a staff with calm chalk lines',
        why: 'It suggests his principle of effortless strength through stillness.',
      },
      {
        title: 'Laozi Writing a Scroll',
        action: 'writing a few characters on a scroll in chalk',
        why: 'It shows the quiet simplicity at the heart of his wisdom.',
      },
      {
        title: 'Laozi Watching the River',
        action: 'tracing a river flow with loose chalk strokes',
        why: 'It makes his water metaphor concrete and minimalist.',
      },
      {
        title: 'Laozi Gesturing to Water',
        action: 'gesturing toward a flowing chalk line of water',
        why: 'It highlights his teaching that softness can overcome strength.',
      },
      {
        title: 'Laozi Standing at a Gate',
        action: 'standing calmly by a faint chalk gate',
        why: 'It symbolizes the threshold between ordinary life and natural harmony.',
      },
    ],
  },
  {
    name: 'Hegel',
    coreIdea: 'dialectic and historical development',
    entries: [
      {
        title: 'Hegel Drawing a Spiral',
        action: 'drawing a spiral of history with bold chalk lines',
        why: 'It makes his idea of development through contradiction visually obvious.',
      },
      {
        title: 'Hegel Holding a Book',
        action: 'holding a book while sketching a process diagram',
        why: 'It connects his theoretical work to an active process of thought.',
      },
      {
        title: 'Hegel Pacing with a Diagram',
        action: 'pacing in front of a drawn dialectic circle',
        why: 'It shows his philosophy as dynamic and evolving rather than static.',
      },
      {
        title: 'Hegel Pointing to Thesis and Antithesis',
        action: 'pointing to two opposing chalk phrases',
        why: 'It makes his key structure of thought easy to grasp in one image.',
      },
      {
        title: 'Hegel Holding a Chain of Events',
        action: 'holding a chalk chain linking events together',
        why: 'It symbolizes the way he sees history as an interconnected process.',
      },
    ],
  },
  {
    name: 'Emerson',
    coreIdea: 'self-reliance and the inner voice',
    entries: [
      {
        title: 'Emerson Standing on a Hill',
        action: 'standing on a faint chalk hill with a journal in hand',
        why: 'It evokes his call to trust oneself and the natural world.',
      },
      {
        title: 'Emerson Writing a Thought',
        action: 'writing a single line about self-reliance in chalk',
        why: 'It makes his central message plain and direct.',
      },
      {
        title: 'Emerson Gazing at the Sky',
        action: 'gazing up with a quiet chalk expression',
        why: 'It reflects his belief that the inner voice is connected to the larger universe.',
      },
      {
        title: 'Emerson Holding a Journal',
        action: 'holding a journal close while pointing to a line of text',
        why: 'It symbolizes the importance of personal reflection in his work.',
      },
      {
        title: 'Emerson Marking a Path',
        action: 'marking a simple path across the blackboard',
        why: 'It captures his idea that each person must choose their own direction.',
      },
    ],
  },
  {
    name: 'Thoreau',
    coreIdea: 'simple living and natural awareness',
    entries: [
      {
        title: 'Thoreau at Walden Pond',
        action: 'sitting with a notebook by a chalk pond',
        why: 'It makes his message of simplicity and observation into a quiet action.',
      },
      {
        title: 'Thoreau Writing by the Water',
        action: 'writing with a rough chalk line of water nearby',
        why: 'It connects his philosophy of deliberate living to a simple scene.',
      },
      {
        title: 'Thoreau Choosing a Cabin',
        action: 'drawing a small cabin with sparse chalk strokes',
        why: 'It represents his commitment to deliberate solitude and simplicity.',
      },
      {
        title: 'Thoreau Observing a Pond',
        action: 'leaning toward a chalk pond with focused attention',
        why: 'It shows the kind of close observation his philosophy requires.',
      },
      {
        title: 'Thoreau Holding a Leaf',
        action: 'holding a single leaf in rough chalk detail',
        why: 'It symbolizes his belief that the smallest natural thing can teach profound lessons.',
      },
    ],
  },
  {
    name: 'Arendt',
    coreIdea: 'the public sphere and responsibility',
    entries: [
      {
        title: 'Arendt Observing a Trial',
        action: 'observing a trial with intent chalk lines',
        why: 'It captures her concern with the political consequences of thought.',
      },
      {
        title: 'Arendt Writing a Note',
        action: 'writing a note about responsibility in chalk',
        why: 'It makes her ethical and political analysis feel direct and urgent.',
      },
      {
        title: 'Arendt Pointing to the Public',
        action: 'pointing to a simple sketch of gathered people',
        why: 'It shows her idea that the public realm is formed through action.',
      },
      {
        title: 'Arendt Studying a Witness',
        action: 'studying a single witness figure on the board',
        why: 'It connects her analysis of totalitarianism to the act of paying attention.',
      },
      {
        title: 'Arendt Holding a Candle',
        action: 'holding a candle while writing a phrase about thought',
        why: 'It symbolizes her belief in thinking as a light against darkness.',
      },
    ],
  },
  {
    name: 'Fanon',
    coreIdea: 'colonial liberation and identity',
    entries: [
      {
        title: 'Fanon Breaking Chains',
        action: 'breaking a chain in rough chalk detail',
        why: 'It makes his call to liberation immediately visible and visceral.',
      },
      {
        title: 'Fanon Holding a Broken Mask',
        action: 'holding a broken mask in one hand',
        why: 'It symbolizes his critique of imposed identity under colonialism.',
      },
      {
        title: 'Fanon Pointing to a Wound',
        action: 'pointing to a chalk wound on a drawn figure',
        why: 'It expresses his attention to the pain inflicted by domination.',
      },
      {
        title: 'Fanon Writing Resistance',
        action: 'writing the word resistance in rough chalk',
        why: 'It conveys his belief in active struggle through a direct visual action.',
      },
      {
        title: 'Fanon Looking at Broken Bars',
        action: 'looking at broken bars sketched in chalk',
        why: 'It shows the hope of freedom through a strong symbolic moment.',
      },
    ],
  },
  {
    name: 'Hypatia',
    coreIdea: 'reason, mathematics, and teaching',
    entries: [
      {
        title: 'Hypatia Teaching Geometry',
        action: 'drawing a geometric diagram on the board',
        why: 'It shows her mastery of mathematics and her role as a teacher in a single, simple act.',
      },
      {
        title: 'Hypatia Holding an Astrolabe',
        action: 'holding an astrolabe while making a note',
        why: 'It emphasizes her combination of astronomy and philosophy through a focused image.',
      },
      {
        title: 'Hypatia Pointing to the Stars',
        action: 'pointing to a chalk sky of stars',
        why: 'It links reason with the larger cosmos in a hand-drawn way.',
      },
      {
        title: 'Hypatia Writing a Theorem',
        action: 'writing a theorem with confident chalk strokes',
        why: 'It captures her dedication to clear, logical thinking.',
      },
      {
        title: 'Hypatia Holding a Scroll',
        action: 'holding a scroll of philosophy close and steady',
        why: 'It emphasizes the preciousness of knowledge and teaching.',
      },
    ],
  },
];

const ideaVisualTemplates = [
  {
    titleSuffix: 'in Motion',
    actionSuffix: 'moving across the blackboard with heavy chalk dust',
  },
  {
    titleSuffix: 'Emerging from Shadow',
    actionSuffix: 'emerging from shadow with scratched chalk highlights',
  },
  {
    titleSuffix: 'Etched in Dust',
    actionSuffix: 'etched in dust and rough smudges',
  },
  {
    titleSuffix: 'Held Steady',
    actionSuffix: 'held steady by rough hand-drawn lines',
  },
  {
    titleSuffix: 'Reaching Beyond',
    actionSuffix: 'reaching beyond the edge of the board with dusty strokes',
  },
  {
    titleSuffix: 'Bathed in Light',
    actionSuffix: 'bathed in pale chalk light and grey highlights',
  },
  {
    titleSuffix: 'Fractured and Whole',
    actionSuffix: 'fractured by chalk scratches but remaining coherent',
  },
  {
    titleSuffix: 'Standing Alone',
    actionSuffix: 'standing alone on a bare blackboard with chalk dust',
  },
];

const topIdeas = [
  { idea: 'truth', subjectLabel: 'Beam of Light', why: 'Truth is represented as a light cutting through uncertainty.' },
  { idea: 'justice', subjectLabel: 'Balance Scale', why: 'Justice is symbolized as a careful balance in the face of rough life.' },
  { idea: 'freedom', subjectLabel: 'Open Gate', why: 'Freedom is shown as a gate opening onto possibility without clutter.' },
  { idea: 'empathy', subjectLabel: 'Joined Hands', why: 'Empathy is the action of reaching toward another with shared touch.' },
  { idea: 'courage', subjectLabel: 'Torchbearer', why: 'Courage is carried like a torch into darkness, small but bright.' },
  { idea: 'virtue', subjectLabel: 'Laurel Wreath', why: 'Virtue is represented as a simple wreath of achievement and restraint.' },
  { idea: 'duty', subjectLabel: 'Lantern Path', why: 'Duty is a narrow lit path that one follows regardless of comfort.' },
  { idea: 'wisdom', subjectLabel: 'Oak Tree', why: 'Wisdom is symbolized by a strong tree rooted in rough truth.' },
  { idea: 'existence', subjectLabel: 'Lone Statue', why: 'Existence is shown as a single standing presence on the board.' },
  { idea: 'meaning', subjectLabel: 'Horizon Road', why: 'Meaning is a road that stretches toward something beyond the immediate.' },
  { idea: 'identity', subjectLabel: 'Mask', why: 'Identity is the mask one wears and the choice to remove it.' },
  { idea: 'knowledge', subjectLabel: 'Key', why: 'Knowledge is the key that unlocks questions, not answers alone.' },
  { idea: 'perception', subjectLabel: 'Eye', why: 'Perception is the act of seeing and interpreting what is offered.' },
  { idea: 'reality', subjectLabel: 'Mirror Shard', why: 'Reality is a fractured mirror, partial and hard to grasp.' },
  { idea: 'memory', subjectLabel: 'Stone Tablet', why: 'Memory is carved into the mind like words on stone.' },
  { idea: 'time', subjectLabel: 'Broken Clock', why: 'Time is irregular and worn, not always orderly.' },
  { idea: 'love', subjectLabel: 'Pair of Figures', why: 'Love is a connection between two simple presences.' },
  { idea: 'power', subjectLabel: 'Crown', why: 'Power is an object that can be held lightly or abused.' },
  { idea: 'equality', subjectLabel: 'Twin Pillars', why: 'Equality is reflected in symmetrical forms side by side.' },
  { idea: 'community', subjectLabel: 'Circle of Hands', why: 'Community is the gathered circle that holds one another.' },
  { idea: 'beauty', subjectLabel: 'Carved Rose', why: 'Beauty is a single carved rose on a rough surface.' },
  { idea: 'faith', subjectLabel: 'Open Book', why: 'Faith is shown as a book held open without requiring proof.' },
  { idea: 'reason', subjectLabel: 'Geometry Floor', why: 'Reason is represented by precise lines on an otherwise rough board.' },
  { idea: 'consciousness', subjectLabel: 'Flame in Skull', why: 'Consciousness is a flame burning within a mind-shaped outline.' },
  { idea: 'change', subjectLabel: 'Crumbling Wall', why: 'Change is a wall breaking down into dust and fragments.' },
  { idea: 'impermanence', subjectLabel: 'Falling Leaves', why: 'Impermanence is the quiet drift of leaves into dust.' },
  { idea: 'choice', subjectLabel: 'Diverging Path', why: 'Choice is a fork in the road drawn with rough lines.' },
  { idea: 'responsibility', subjectLabel: 'Heavy Stone', why: 'Responsibility is a stone that must be carried, not ignored.' },
  { idea: 'soul', subjectLabel: 'Flickering Candle', why: 'The soul is a small candle flame that can be tended or extinguished.' },
  { idea: 'morality', subjectLabel: 'Weighing Scales', why: 'Morality is balance and careful judgment in a simple visual form.' },
  { idea: 'democracy', subjectLabel: 'Agora Gathering', why: 'Democracy is a group speaking together, rendered as joined chalk figures.' },
  { idea: 'rights', subjectLabel: 'Burning Torch', why: 'Rights are a torch carried to illuminate what should be protected.' },
  { idea: 'nature', subjectLabel: 'Stone Forest', why: 'Nature is the living stone forms that grow out of the board itself.' },
  { idea: 'silence', subjectLabel: 'Empty Room', why: 'Silence is the quiet emptiness of a fair blackboard surface.' },
  { idea: 'curiosity', subjectLabel: 'Spark', why: 'Curiosity is a spark that jumps from one idea to the next.' },
  { idea: 'wonder', subjectLabel: 'Starry Sky', why: 'Wonder is the sense of awe at a sky full of stars even on a rough board.' },
  { idea: 'authority', subjectLabel: 'Empty Throne', why: 'Authority is an empty throne that still commands attention.' },
  { idea: 'tradition', subjectLabel: 'Ancient Arch', why: 'Tradition is an old arch standing in chalk form against the dark.',
  },
  { idea: 'innovation', subjectLabel: 'Shattered Stone', why: 'Innovation is breaking old forms apart to build something new.' },
  { idea: 'politics', subjectLabel: 'Stone Market', why: 'Politics is the exchange and tension of quiet figures in a marketplace.' },
  { idea: 'economy', subjectLabel: 'Silent Exchange', why: 'Economy is value moving without words along a rough board.',
  },
  { idea: 'violence', subjectLabel: 'Broken Bridge', why: 'Violence is destruction that leaves gaps and unfinished edges.' },
  { idea: 'peace', subjectLabel: 'Stone Garden', why: 'Peace is a still arrangement of stone forms in quiet order.' },
  { idea: 'liberation', subjectLabel: 'Broken Chain', why: 'Liberation is the gap where a chain has been broken free.' },
  { idea: 'logic', subjectLabel: 'Geometric Lines', why: 'Logic is the clarity of lines cutting through chaos on the board.' },
  { idea: 'skepticism', subjectLabel: 'Fog Valley', why: 'Skepticism is a valley covered in fog where nothing is taken for granted.',
  },
  { idea: 'spirit', subjectLabel: 'Rising Spiral', why: 'Spirit is a spiral lifting upward from rough matter.',
  },
  { idea: 'suffering', subjectLabel: 'Cracked Mask', why: 'Suffering is a mask that shows cracks beneath the surface.',
  },
  { idea: 'connection', subjectLabel: 'Bridge of Hands', why: 'Connection is hands reaching across a gap to join together.',
  },
  { idea: 'self', subjectLabel: 'Nested Self', why: 'The self is shown as nested figures inside one another.',
  },
  { idea: 'otherness', subjectLabel: 'Opposing Silhouettes', why: 'Otherness is the tension between two separate but related figures.',
  },
];

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildPhilosopherEntries() {
  return topPhilosophers.flatMap((philosopher) =>
    philosopher.entries.map((entry, index) => ({
      id: `philosopher-${philosopher.name.toLowerCase().replace(/\s+/g, '-')}-${index + 1}`,
      type: 'philosopher',
      philosopher: philosopher.name,
      idea: philosopher.coreIdea,
      title: entry.title,
      why: entry.why,
      prompt: `Dark 16:9 chalk drawing on blackboard of ${philosopher.name} ${entry.action}, close medium shot, rough scratchy white chalk lines, heavy chalk dust, visible smudges, bare blackboard background, no text, no letters, no caption`,
    }))
  );
}

function buildIdeaEntries() {
  return topIdeas.flatMap((item) =>
    ideaVisualTemplates.map((template, index) => ({
      id: `idea-${item.idea.replace(/\s+/g, '-')}-${index + 1}`,
      type: 'idea',
      idea: item.idea,
      title: `${item.subjectLabel} ${template.titleSuffix}`,
      why: `${item.subjectLabel} is used to represent ${item.idea} as a simple chalkboard concept, with this variation emphasizing ${item.why.toLowerCase()}`,
      prompt: `Dark 16:9 chalk drawing on blackboard of ${item.subjectLabel.toLowerCase()} ${template.actionSuffix}, close medium shot, rough scratchy white chalk lines, heavy chalk dust, bare blackboard background, no text, no letters, no caption`,
    }))
  );
}

const philosopherEntries = buildPhilosopherEntries();
const ideaEntries = buildIdeaEntries();
const candidateEntries = [...philosopherEntries, ...ideaEntries].slice(0, 500);

const topPhilosopherNames = topPhilosophers.map((item) => item.name);
const topIdeaNames = topIdeas.map((item) => item.idea);

function selectTop100(entries) {
  const selected = [];
  const usedIds = new Set();

  for (const name of topPhilosopherNames) {
    const candidate = entries.find((entry) => entry.philosopher === name);
    if (candidate) {
      selected.push(candidate);
      usedIds.add(candidate.id);
    }
  }

  for (const idea of topIdeaNames) {
    const candidate = entries.find((entry) => entry.type === 'idea' && entry.idea === idea);
    if (candidate && !usedIds.has(candidate.id)) {
      selected.push(candidate);
      usedIds.add(candidate.id);
    }
  }

  const remaining = entries.filter((entry) => !usedIds.has(entry.id));
  remaining.sort((a, b) => {
    const aScore = (a.type === 'philosopher' ? 2 : 1) + (a.why.length > b.why.length ? 0.5 : 0);
    const bScore = (b.type === 'philosopher' ? 2 : 1) + (b.why.length > a.why.length ? 0.5 : 0);
    return bScore - aScore;
  });

  for (const entry of remaining) {
    if (selected.length >= 100) break;
    selected.push(entry);
    usedIds.add(entry.id);
  }

  return selected.slice(0, 100);
}

const top100Entries = selectTop100(candidateEntries);

fs.writeFileSync(path.join(outputDir, 'philosophy-blackboard-candidates-500.json'), JSON.stringify(candidateEntries, null, 2));
fs.writeFileSync(path.join(outputDir, 'philosophy-blackboard-top-100.json'), JSON.stringify(top100Entries, null, 2));
fs.writeFileSync(path.join(outputDir, 'philosophy-blackboard-top-100-prompts.txt'), top100Entries.map((entry) => entry.prompt).join('\n') + '\n');
fs.writeFileSync(
  path.join(outputDir, 'philosophy-blackboard-top-100-outline.txt'),
  top100Entries.map((entry, index) => `${index + 1}. ${entry.title} - ${entry.why}`).join('\n\n') + '\n'
);

async function generateImages() {
  const generateEntries = top100Entries.slice(0, 10);
  for (let i = 0; i < generateEntries.length; i++) {
    const entry = generateEntries[i];
    const outputPath = path.join(imageOutputDir, `philosophy-blackboard-100-${i + 1}.png`);
    console.log(`Generating ${i + 1}/10: ${entry.title}`);
    try {
      await generateChalkboardImage(entry.prompt, outputPath);
      console.log(`Saved: ${outputPath}`);
    } catch (err) {
      console.error(`Failed: ${entry.title}`, err.message || err);
    }
  }
}

(async () => {
  console.log('Generated chalkboard candidate collection and top 100 selection.');
  console.log('Saving 500 candidates and the top 100 chalkboard image prompts.');
  await generateImages();
  console.log('Finished generating 10 chalkboard test images in assets/images/test8');
})();
