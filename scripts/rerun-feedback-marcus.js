import "dotenv/config";
import fs from "fs";
import path from "path";
import { reviewVideo } from "../src/feedback-agent.js";

const dir = "output/marcus-aurelius-on-letting-go";
const metadata = JSON.parse(fs.readFileSync(path.join(dir, "metadata.json"), "utf-8"));

const result = await reviewVideo({
  videoPath: path.join(dir, "final.mp4"),
  topic: "Marcus Aurelius on Letting Go",
  metadata,
  outputDir: dir,
});

if (result) {
  console.log(`Score: ${result.score}/10`);
  console.log(`Issues: ${result.issues?.length || 0}`);
  console.log(`Wins: ${result.wins?.length || 0}`);
}
