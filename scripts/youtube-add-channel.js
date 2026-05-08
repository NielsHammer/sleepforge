/**
 * Add a YouTube channel to SleepForge.
 *
 * Usage: node scripts/youtube-add-channel.js
 *
 * 1. Enter a slug name for the channel (e.g. sleepless-philosophers)
 * 2. Script prints an auth URL — open it in the browser signed in to the channel
 * 3. Authorize the app, Google redirects to http://localhost:8080 automatically
 * 4. Token saved to assets/youtube-tokens/<channelName>.json
 */

import http      from "http";
import readline  from "readline";
import fs        from "fs";
import path      from "path";
import { fileURLToPath } from "url";
import { getOAuth2Client, SCOPES, OAUTH_PORT } from "../src/youtube.js";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, "..");
const TOKENS_DIR = path.join(ROOT, "assets", "youtube-tokens");

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║   SleepForge — Add YouTube Channel        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const channelName = (await ask("Channel slug (e.g. sleepless-philosophers): ")).trim();
  rl.close();

  if (!channelName) {
    console.error("Channel name is required.");
    process.exit(1);
  }

  const tokenFile = path.join(TOKENS_DIR, `${channelName}.json`);
  if (fs.existsSync(tokenFile)) {
    console.log(`\nToken already exists: ${tokenFile}`);
    console.log("Delete it and re-run to re-authenticate.");
    process.exit(0);
  }

  const oauth2Client = getOAuth2Client();

  // ── Start local redirect server ────────────────────────────────────────────
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url   = new URL(req.url, `http://localhost:${OAUTH_PORT}`);
        const code  = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h2>Authorization failed: " + error + "</h2><p>You can close this tab.</p>");
          server.close();
          reject(new Error("OAuth error: " + error));
          return;
        }

        if (code) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<h2 style='font-family:sans-serif;color:green'>✓ Authorized!</h2>" +
            "<p style='font-family:sans-serif'>SleepForge is connected. You can close this tab.</p>"
          );
          server.close();
          resolve(code);
        }
      } catch (err) {
        res.writeHead(500);
        res.end("Server error");
        server.close();
        reject(err);
      }
    });

    server.listen(OAUTH_PORT, "localhost", () => {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope:       SCOPES,
        prompt:      "consent",   // force refresh_token on every new auth
      });

      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      console.log("Open this URL in the browser signed in to the YouTube channel:\n");
      console.log("  " + authUrl);
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`\nWaiting for authorization (http://localhost:${OAUTH_PORT})...`);
    });

    server.on("error", (err) => {
      reject(new Error(`Could not start auth server on port ${OAUTH_PORT}: ${err.message}`));
    });
  });

  // ── Exchange code for tokens ───────────────────────────────────────────────
  console.log("\n  Got auth code — exchanging for tokens...");
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.warn(
      "\n  WARNING: No refresh_token returned. This can happen if the account\n" +
      "  was already authorized. Revoke access at https://myaccount.google.com/permissions\n" +
      "  and re-run this script to get a fresh token with refresh capability."
    );
  }

  // ── Save token ────────────────────────────────────────────────────────────
  fs.mkdirSync(TOKENS_DIR, { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(tokens, null, 2));

  console.log(`\n✓ Token saved: ${tokenFile}`);
  console.log(`\nChannel "${channelName}" is ready.`);
  console.log(`\nTest it with:`);
  console.log(`  node -e "import('./src/youtube.js').then(m => m.getVideoStats('dQw4w9WgXcQ', '${channelName}').then(console.log))"`);
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
