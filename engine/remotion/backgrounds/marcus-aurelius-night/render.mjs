import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import { fileURLToPath } from "url";

// ─── Pre-render Greek Library Background ────────────────────────────────────
// Renders the animated background ONCE per channel.
// Output: bg.mp4 — looped in the pipeline via FFmpeg.
//
// Usage: node engine/remotion/backgrounds/marcus-aurelius-night/render.mjs [duration_seconds]

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPoint = path.resolve(__dirname, "../../index.jsx");
const outputPath = path.resolve(__dirname, "bg.mp4");

const durationSeconds = parseInt(process.argv[2]) || 120; // default 2 min loop
const fps = 30;

async function main() {
  console.log(`Rendering Greek Library background (${durationSeconds}s)...`);
  console.log(`Entry: ${entryPoint}`);
  console.log(`Output: ${outputPath}`);

  const bundled = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
  });

  const composition = await selectComposition({
    serveUrl: bundled,
    id: "GreekLibrary",
    inputProps: {
      images: [],
      imageDuration: 12,
    },
  });

  // Override duration to requested length
  composition.durationInFrames = durationSeconds * fps;

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: {
      images: [],
      imageDuration: 12,
    },
  });

  console.log(`Background rendered: ${outputPath}`);
}

main().catch((err) => {
  console.error("Render failed:", err);
  process.exit(1);
});
