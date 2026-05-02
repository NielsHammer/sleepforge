import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { generateASS, burnSubtitles } from "../src/subtitles.js";

const dir = "output/marcus-aurelius-on-letting-go";
const whisperPath = path.join(dir, "assets/voiceover-timestamps.json");
const whisper = JSON.parse(fs.readFileSync(whisperPath, "utf-8"));
const words = whisper.words || whisper;

console.log(`Loaded ${words.length} word timestamps`);

const assPath = path.resolve(path.join(dir, "subtitles.ass"));
generateASS(words, assPath);

// Re-burn into raw.mp4 to make a new final.mp4
const rawPath = path.resolve(path.join(dir, "raw.mp4"));
const finalPath = path.resolve(path.join(dir, "final.mp4"));
console.log("Re-burning subtitles...");
const ok = burnSubtitles(rawPath, assPath, finalPath);
console.log(ok ? "Done" : "FAILED");
