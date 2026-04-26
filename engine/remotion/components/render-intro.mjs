import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";

// ─── Render Intro Animation ─────────────────────────────────────────────────
// Usage: node engine/remotion/components/render-intro.mjs "Video Title Here" [output_path]

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.resolve(__dirname, "../index.jsx");

const videoTitle = process.argv[2] || "The Stoic Philosophy of Marcus Aurelius";
const outputPath = process.argv[3] || path.resolve(__dirname, "intro.mp4");

async function main() {
  console.log(`Rendering intro: "${videoTitle}"`);
  console.log(`Output: ${outputPath}`);

  const bundled = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
  });

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "Intro",
    inputProps: {
      channelName: "Sleepless Philosophers",
      videoTitle,
    },
  });

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: {
      channelName: "Sleepless Philosophers",
      videoTitle,
    },
  });

  console.log(`Intro rendered: ${outputPath}`);
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
