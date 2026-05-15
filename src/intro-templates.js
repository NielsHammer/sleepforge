// Sleep audiobook intro templates for Sleepless Astronomer.
// Rotating variants so no two consecutive videos open identically.
// Each template is ~150-175 words (~60-70 seconds at 150 wpm).

const TEMPLATES = [
  (topic) =>
    `Welcome to Sleepless Astronomer.\n\nThese videos are made for one thing: to help you drift gently to sleep while the universe tells its stories.\n\nSo wherever you are right now — in bed, in the dark, or somewhere quiet — take a moment. Let your body settle. Close your eyes if you haven't already. Take a slow breath in.\n\nYou don't need to watch. You don't need to follow along. Everything tonight will be described in words, the way a story is told in the dark. All you have to do is listen.\n\nTonight, we're going to explore ${topic}. There's no hurry. The universe has been here for almost fourteen billion years. It can wait a little longer.\n\nSo let yourself be still. Let your thoughts slow down. And when you're ready — or even if you're not — let's begin.`,

  (topic) =>
    `You've found Sleepless Astronomer.\n\nThis is a place to rest while the cosmos does the talking. These videos are designed for sleep — for the hours when the mind is restless and the night is quiet.\n\nIf you can, lie back. Let your eyes close. Take a deep breath, and feel the weight of the day begin to lift. You don't need to see anything tonight. Every scale, every distance, every wonder will be painted in words — the way a story is told when the lights are off.\n\nYou might fall asleep before the end. That's not only fine — it's the point.\n\nOur subject tonight is ${topic}. We'll take our time with it. There's no rush here. Only the slow, patient turning of the universe, and a voice to keep you company as you drift.\n\nWhenever you're ready.`,

  (topic) =>
    `Welcome.\n\nSleepless Astronomer is built for people who find sleep difficult — and who find the universe easier to think about than whatever kept them awake.\n\nBefore we begin: get comfortable. If you're in bed, pull the covers a little closer. If you're somewhere else, let yourself settle into it. Close your eyes. The screen doesn't matter. Everything that matters tonight comes through sound.\n\nWe're going to move slowly through ${topic}. You'll hear careful descriptions — the kind you'd want told to you in the dark, with long pauses between thoughts. There are no images you need to look at. Just language, and silence between sentences, and the gradual weight of something very old and very vast settling gently around you.\n\nTake a breath. Let your body grow a little heavier.\n\nAnd when you're ready, we'll begin.`,
];

let _lastIdx = -1;

export function getSleepIntro(topicTitle) {
  let idx;
  do {
    idx = Math.floor(Math.random() * TEMPLATES.length);
  } while (idx === _lastIdx && TEMPLATES.length > 1);
  _lastIdx = idx;

  return {
    subject:     "intro",
    moment:      "sleep welcome",
    action:      "gentle welcome to the listener",
    setting:     "quiet, dark space",
    philosopher: "intro",
    narration:   TEMPLATES[idx](topicTitle),
  };
}
