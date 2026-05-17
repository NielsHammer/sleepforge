// Intro templates for Sleepless Astronomer.
// Rotating variants so no two consecutive videos open identically.
// Each template is ~150-175 words (~60-70 seconds at 150 wpm).
// General-purpose framing — no sleep-exclusive language.

const TEMPLATES = [
  (topic) =>
    `Welcome to Sleepless Astronomer.\n\nThese videos are built for listening. Wherever you are right now — settling in for the night, working through something long, sitting in transit, or just looking for something calm to have on — you don't need to watch the screen. Everything here comes through sound. Every distance, every object, every idea in the dark between stars will be described the way a story is described: in words, at a pace that lets them settle.\n\nGet comfortable. Take a breath. Let whatever's been filling your head step back a little.\n\nTonight, we're moving through ${topic}. There's no hurry. The universe has been unfolding for almost fourteen billion years. It doesn't mind if you take your time with it.\n\nHowever you choose to listen — fully present, half-present, eyes open, eyes closed — there's no wrong way to do this. Just let it come to you.\n\nWhenever you're ready, let's begin.`,

  (topic) =>
    `You've found Sleepless Astronomer.\n\nThis is a place to step back from whatever you were doing. These videos are made to be listened to, not watched. Whether you're lying down, sitting at your desk, on a long commute, or settling in for the night, the screen is optional. Everything that matters comes through sound: careful descriptions, long pauses, the unhurried movement through ideas that are genuinely worth taking your time with.\n\nIf you can, let yourself get a little more comfortable than you already are. Take a slow breath. You don't need to be anywhere else for the next little while.\n\nTonight's subject is ${topic}. We'll move through it without rushing — the way you'd want something explained when there's no deadline on understanding it.\n\nHowever this finds you, and however you want to listen, you're welcome here.\n\nLet's begin.`,

  (topic) =>
    `Welcome.\n\nSleepless Astronomer is built around one idea: that the universe makes for good company, however you need it. Whether that means lying in the dark and letting words wash over you, working quietly with something on in the background, or sitting somewhere calm and actually following along — all of that works. These videos are designed to function without you watching. Every image is a description. Every detail is spoken, not shown.\n\nSo do whatever you need to do to be comfortable. Adjust the volume. Find a better position. There's no wrong way to be here.\n\nTonight we're exploring ${topic}. We'll take our time — long sentences, careful phrasing, no rush toward any conclusion. The ideas themselves are worth sitting with.\n\nTake a breath when you're ready.\n\nAnd let's begin.`,
];

let _lastIdx = -1;

export function getChannelIntro(topicTitle) {
  let idx;
  do {
    idx = Math.floor(Math.random() * TEMPLATES.length);
  } while (idx === _lastIdx && TEMPLATES.length > 1);
  _lastIdx = idx;

  return {
    subject:     "intro",
    moment:      "channel welcome",
    action:      "gentle welcome to the listener",
    setting:     "quiet, open space",
    philosopher: "intro",
    narration:   TEMPLATES[idx](topicTitle),
  };
}

// Legacy alias — keep old callers working
export { getChannelIntro as getSleepIntro };
