import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

// Render the SleepForge fireplace-particle Remotion composition once and
// cache it as a 60s 1920x1080 mp4. Downstream ffmpeg compose loops it via
// -stream_loop -1 and screen-blends it onto the slideshow.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let _bundleCache = null;

async function bundleOnce() {
  if (_bundleCache) return _bundleCache;
  const entryPoint = path.resolve(__dirname, "..", "engine", "remotion", "index.jsx");
  _bundleCache = await bundle({ entryPoint });
  return _bundleCache;
}

export async function renderFireplaceParticles(outputPath) {
  const serveUrl = await bundleOnce();
  const composition = await selectComposition({
    serveUrl, id: "fireplace-particles", inputProps: {},
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  let lastPct = 0;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: {},
    chromiumOptions: {},
    onProgress: ({ progress }) => {
      const pct = Math.round(progress * 100);
      if (pct > lastPct + 9) {
        process.stdout.write(`  Remotion particles: ${pct}%\n`);
        lastPct = pct;
      }
    },
  });
  return outputPath;
}
