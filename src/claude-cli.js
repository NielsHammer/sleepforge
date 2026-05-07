import { spawn } from "child_process";
import os from "os";

// Routes Claude calls through the Claude Code CLI installed on this server,
// which uses the user's subscription auth instead of a metered API key.
// Each call is its own process — no shared state, behaves like a stateless
// API request from the perspective of the caller.
//
// Two non-obvious settings below:
//
// 1. cwd = os.tmpdir() — without this, the CLI auto-discovers the project's
//    CLAUDE.md and applies its rules to the call, which causes prompts like
//    "return this JSON" to be flagged as injection attempts. A neutral cwd
//    skips CLAUDE.md auto-discovery entirely.
//
// 2. --system-prompt — replaces the default Claude Code agent prompt with
//    a minimal "you are an LLM, return what's asked" framing. We don't want
//    the agent persona, tool reasoning, or project framing for these calls.
//
// Stdin (not argv) for the prompt: prompts can be 8k+ chars, past some argv
// limits, and the `--tools ""` flag eats the next positional arg.

const NEUTRAL_SYSTEM_PROMPT =
  "You are a language model. Return exactly what the user asks for, " +
  "in the exact format requested. Do not add commentary, preamble, or " +
  "explanation. If the user asks for JSON, return only valid JSON.";

export async function callClaudeCLI(prompt, opts = {}) {
  const {
    model = "claude-haiku-4-5-20251001",
    timeoutMs = 180000,
    systemPrompt = NEUTRAL_SYSTEM_PROMPT,
    tools = "",                  // "" = no tools (default). Set to e.g. "Read" for vision tasks.
    addDirs = [],                // extra dirs the CLI can read (for vision frames, etc.)
    permissionMode = null,       // e.g. "bypassPermissions" for unattended tool use
    allowedTools = null,         // pre-approved tools (avoids permission prompt). e.g. "Read"
  } = opts;

  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--model", model,
      "--output-format", "text",
      "--tools", tools,
      "--no-session-persistence",
      "--system-prompt", systemPrompt,
    ];
    if (permissionMode) {
      args.push("--permission-mode", permissionMode);
    }
    if (allowedTools) {
      args.push("--allowedTools", allowedTools);
    }
    for (const d of addDirs) {
      args.push("--add-dir", d);
    }
    // Strip ANTHROPIC_API_KEY from the child env: when set, the CLI prefers
    // it over OAuth/keychain auth, which defeats the whole point of routing
    // through the subscription. Same for the legacy ANTHROPIC_AUTH_TOKEN.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    // shell: true required on Windows — npm CLIs are .cmd files that need cmd.exe
    const child = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: os.tmpdir(),
      env,
      shell: process.platform === 'win32',
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => { stderr += b.toString(); });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${(stderr || stdout).trim()}`));
        return;
      }
      resolve(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}
