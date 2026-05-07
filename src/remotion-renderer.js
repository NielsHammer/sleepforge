import { bundle }                       from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path                              from "path";
import { fileURLToPath }                 from "url";
import fs                                from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = path.resolve(__dirname, "../engine/remotion/index.jsx");

// Bundle is reused across multiple renderAnimation() calls in the same process.
let _bundleUrl = null;

async function getBundleUrl() {
  if (_bundleUrl) return _bundleUrl;
  console.log("  Bundling Remotion (one-time per session, ~15s)...");
  _bundleUrl = await bundle({ entryPoint: ENTRY_POINT, webpackOverride: (c) => c });
  return _bundleUrl;
}

/**
 * Render a Remotion composition to an MP4.
 * Output is cached — won't re-render if the file already exists and is > 10 KB.
 *
 * @param {string} compositionId - ID registered in engine/remotion/index.jsx
 * @param {string} outputPath    - Absolute path to write the MP4
 * @param {object} opts
 * @param {number} opts.durationInFrames  - Override composition length (default from registration)
 * @param {object} opts.inputProps        - Props passed to the Remotion component
 * @param {number} opts.concurrency       - Parallel frame renders (default 4)
 */
export async function renderAnimation(compositionId, outputPath, opts = {}) {
  const { inputProps = {}, concurrency = 4 } = opts;

  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
    console.log(`  Animation cached: ${path.basename(outputPath)}`);
    return outputPath;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const bundleUrl    = await getBundleUrl();
  const composition  = await selectComposition({ serveUrl: bundleUrl, id: compositionId, inputProps });

  const durationInFrames = opts.durationInFrames || composition.durationInFrames;

  console.log(`  Rendering ${compositionId} (${durationInFrames} frames @ ${composition.fps}fps)...`);
  const t0 = Date.now();

  await renderMedia({
    composition: { ...composition, durationInFrames },
    serveUrl: bundleUrl,
    codec: "h264",
    outputLocation: outputPath,
    concurrency,
    inputProps,
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ${compositionId} rendered in ${elapsed}s → ${path.basename(outputPath)}`);
  return outputPath;
}
