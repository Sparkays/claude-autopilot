#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CLAUDE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".claude",
);

const SKILLS_DIR = path.join(CLAUDE_DIR, "skills", "claude-autopilot");
const COMMANDS_DIR = path.join(CLAUDE_DIR, "commands");
const HOOKS_DIR = path.join(CLAUDE_DIR, "hooks");
const SETTINGS_FILE = path.join(CLAUDE_DIR, "settings.json");

const PKG_ROOT = path.resolve(__dirname, "..");

function log(msg) {
  console.log(`  ${msg}`);
}

function logStep(msg) {
  console.log(`\n> ${msg}`);
}

function fileExists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
  log(`Copied ${path.basename(dest)}`);
}

function checkGSD() {
  const globalPath = path.join(
    CLAUDE_DIR,
    "get-shit-done",
    "bin",
    "gsd-tools.cjs",
  );
  if (fileExists(globalPath)) return globalPath;

  const cacheBase = path.join(CLAUDE_DIR, "plugins", "cache");
  if (fileExists(cacheBase)) {
    try {
      const result = execSync(
        `find "${cacheBase}" -path "*/get-shit-done/*/bin/gsd-tools.cjs" 2>/dev/null || true`,
        { encoding: "utf-8" },
      ).trim();
      if (result) return result.split("\n")[0];
    } catch {}
  }

  return null;
}

function registerStopHook() {
  if (!fileExists(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({}, null, 2));
  }

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    settings = {};
  }

  if (!settings.hooks) settings.hooks = {};
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];

  const hookCommand =
    process.platform === "win32"
      ? `bash "${path.join(HOOKS_DIR, "claude-autopilot-stop.sh").replace(/\\/g, "/")}"`
      : path.join(HOOKS_DIR, "claude-autopilot-stop.sh");

  const alreadyRegistered = settings.hooks.Stop.some(
    (h) => h.command && h.command.includes("claude-autopilot-stop"),
  );

  if (!alreadyRegistered) {
    settings.hooks.Stop.push({
      matcher: "",
      command: hookCommand,
    });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    log("Registered stop hook in settings.json");
  } else {
    log("Stop hook already registered");
  }
}

// ── Main ──

console.log("\n  claude-autopilot v1.0.0");
console.log("  Self-driving GSD orchestrator for Claude Code\n");

const command = process.argv[2];

if (command === "uninstall") {
  logStep("Removing claude-autopilot...");

  const targets = [
    SKILLS_DIR,
    path.join(COMMANDS_DIR, "auto-work.md"),
    path.join(HOOKS_DIR, "claude-autopilot-stop.sh"),
  ];

  for (const t of targets) {
    if (fileExists(t)) {
      fs.rmSync(t, { recursive: true, force: true });
      log(`Removed ${path.basename(t)}`);
    }
  }

  // Remove hook from settings
  if (fileExists(SETTINGS_FILE)) {
    try {
      const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      if (settings.hooks && Array.isArray(settings.hooks.Stop)) {
        settings.hooks.Stop = settings.hooks.Stop.filter(
          (h) => !h.command || !h.command.includes("claude-autopilot-stop"),
        );
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        log("Removed stop hook from settings.json");
      }
    } catch {}
  }

  console.log("\n  Uninstalled. GSD was not removed (manage it separately).\n");
  process.exit(0);
}

// ── Install ──

logStep("Checking GSD...");
const gsdPath = checkGSD();
if (gsdPath) {
  log(`Found GSD at ${gsdPath}`);
} else {
  log("GSD not found. Installing...");
  try {
    execSync("npx get-shit-done-cc@latest --claude --global", {
      stdio: "inherit",
    });
    const verifyPath = checkGSD();
    if (!verifyPath) {
      console.error("\n  ERROR: GSD installation failed. Install it manually:");
      console.error("  npx get-shit-done-cc@latest --claude --global\n");
      process.exit(1);
    }
    log("GSD installed successfully");
  } catch (err) {
    console.error("\n  ERROR: GSD installation failed. Install it manually:");
    console.error("  npx get-shit-done-cc@latest --claude --global\n");
    process.exit(1);
  }
}

logStep("Installing skill...");
ensureDir(SKILLS_DIR);
copyFile(
  path.join(PKG_ROOT, "skills", "claude-autopilot", "SKILL.md"),
  path.join(SKILLS_DIR, "SKILL.md"),
);

logStep("Installing command...");
ensureDir(COMMANDS_DIR);
copyFile(
  path.join(PKG_ROOT, "commands", "auto-work.md"),
  path.join(COMMANDS_DIR, "auto-work.md"),
);

logStep("Installing stop hook...");
ensureDir(HOOKS_DIR);
const hookSrc = path.join(PKG_ROOT, "hooks", "claude-autopilot-stop.sh");
const hookDest = path.join(HOOKS_DIR, "claude-autopilot-stop.sh");
copyFile(hookSrc, hookDest);

if (process.platform !== "win32") {
  fs.chmodSync(hookDest, 0o755);
}

registerStopHook();

console.log("\n  -----------------------------------------------");
console.log("  claude-autopilot installed successfully!");
console.log("  -----------------------------------------------");
console.log("");
console.log('  Usage:   /auto-work "describe what you want"');
console.log("");
console.log("  Flags:   --quick          Force quick-task mode");
console.log("           --no-loop        Plan + execute once, no loop");
console.log("           --resume         Resume a previous session");
console.log("           --max-iterations N   Cap iterations (default: 25)");
console.log("");
console.log("  Uninstall: npx claude-autopilot uninstall");
console.log("");
