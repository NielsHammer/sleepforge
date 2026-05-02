import "dotenv/config";
import fs from "fs";
import path from "path";
import { generateThumbnail } from "../src/thumbnail.js";

const dir = "output/marcus-aurelius-on-letting-go";
const storyboard = JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf-8"));
const topic = "Marcus Aurelius on Letting Go";

console.log("Generating thumbnail for:", topic);
const out = path.join(dir, "thumbnail.png");
await generateThumbnail(topic, storyboard.clips, out);
const size = fs.statSync(out).size;
console.log(`Wrote ${out} (${(size / 1024).toFixed(0)} KB)`);
