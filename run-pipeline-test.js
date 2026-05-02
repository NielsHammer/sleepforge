import "dotenv/config";
import { generateVideo } from "./src/pipeline.js";

await generateVideo({
  topic: "Marcus Aurelius on Letting Go",
  duration: 5,
  voice: "af_heart",
});
