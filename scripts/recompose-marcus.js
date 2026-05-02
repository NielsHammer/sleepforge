import "dotenv/config";
import path from "path";
import { execSync } from "child_process";
import { composeVideo } from "../src/ffmpeg.js";
import { generateASS, burnSubtitles } from "../src/subtitles.js";
import fs from "fs";

const dir = "output/marcus-aurelius-on-letting-go";
const slideshow = path.join(dir, "slideshow.mp4");
const audio = path.join(dir, "mixed-audio.m4a");
const raw = path.join(dir, "raw.mp4");
const final = path.join(dir, "final.mp4");

// Probe slideshow duration
const dur = parseFloat(
  execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${slideshow}"`).toString().trim()
);
console.log(`Slideshow duration: ${dur.toFixed(1)}s`);

// Re-compose with the fixed particle layer
console.log("Re-composing video (will regen particles + smoke once)...");
composeVideo(slideshow, audio, raw, dur);

// Re-burn subtitles into final.mp4
const assPath = path.resolve(path.join(dir, "subtitles.ass"));
console.log("Burning subtitles...");
burnSubtitles(path.resolve(raw), assPath, path.resolve(final));

const size = (fs.statSync(final).size / 1024 / 1024).toFixed(1);
console.log(`Done — ${final} (${size} MB)`);
