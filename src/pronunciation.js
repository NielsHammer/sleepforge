// Phonetic substitutions applied to TTS input ONLY. Subtitles still display
// the canonical spelling — these substitutions hijack Kokoro's pronunciation
// without affecting on-screen text.
//
// Each entry is [canonical-regex, phonetic-spelling].
//
// Convention: phonetic spellings use plain English letters with hyphens
// between syllables and capitalization on the stressed syllable. Kokoro
// reads these by-syllable, which yields the correct pronunciation.

const NAME_RULES = [
  // Stoics & Roman emperors
  [/\bMarcus Aurelius\b/g, "Marcus Aw-REE-lee-us"],
  [/\bAurelius\b/g, "Aw-REE-lee-us"],
  [/\bSeneca\b/g, "SEH-nuh-kuh"],
  [/\bEpictetus\b/g, "Ep-ick-TEE-tus"],

  // Pre-socratics
  [/\bHeraclitus\b/g, "Hera-CLY-tus"],
  [/\bParmenides\b/g, "Par-MEN-ih-deez"],
  [/\bEmpedocles\b/g, "Em-PED-uh-kleez"],
  [/\bAnaximander\b/g, "Ah-nax-ih-MAN-der"],
  [/\bPythagoras\b/g, "Pi-THAG-uh-rus"],
  [/\bThales\b/g, "THAY-leez"],
  [/\bXenophanes\b/g, "Zee-NOFF-uh-neez"],
  [/\bXenophon\b/g, "ZEN-uh-fon"],

  // Classical Greeks
  [/\bSocrates\b/g, "SOCK-ruh-teez"],
  [/\bPlato\b/g, "PLAY-toe"],
  [/\bAristotle\b/g, "AIR-iss-tot-tul"],
  [/\bDiogenes\b/g, "Die-OJ-uh-neez"],
  [/\bEpicurus\b/g, "Ep-ih-CURE-us"],
  [/\bZeno\b/g, "ZEE-no"],

  // Hellenistic / Roman
  [/\bCicero\b/g, "SISS-er-oh"],
  [/\bLucretius\b/g, "Loo-KREE-shus"],
  [/\bPlutarch\b/g, "PLOO-tark"],
  [/\bBoethius\b/g, "Bo-EE-thee-us"],

  // Eastern / other recurring
  [/\bConfucius\b/g, "Con-FEW-shuss"],
  [/\bLao Tzu\b/g, "Laow-DZUH"],
  [/\bNietzsche\b/g, "NEE-chuh"],
  [/\bSchopenhauer\b/g, "SHOW-pen-how-er"],
  [/\bKierkegaard\b/g, "KEER-kuh-gard"],
];

export function applyPronunciation(text) {
  let out = text;
  for (const [pattern, replacement] of NAME_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
