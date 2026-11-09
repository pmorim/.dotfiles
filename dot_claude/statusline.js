const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const raw = fs.readFileSync(0, "utf8");

const orca = path.join(os.homedir(), ".orca", "agent-hooks", "claude-statusline.cmd");
if (process.platform === "win32" && fs.existsSync(orca)) {
  spawnSync("cmd", ["/c", orca], { input: raw, stdio: ["pipe", "ignore", "ignore"] });
}

const data = JSON.parse(raw);
const dim = "\x1b[2m";
const reset = "\x1b[0m";

const effortRaw = data.effort?.level || data.reasoning_effort;
const effort = effortRaw && effortRaw[0].toUpperCase() + effortRaw.slice(1);
const head = [data.model?.display_name, effort].filter(Boolean).join(" · ");

const cw = data.context_window ?? {};
const u = cw.current_usage;
const tokens = u
  ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  : ((cw.used_percentage ?? 0) * (cw.context_window_size ?? 0)) / 100;

const formatTokens = n => {
  if (n >= 1000000) return `${Math.round(n / 100000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
};

const width = 20;
const dumbZoneTokens = 150000;
const filled = Math.min(width, Math.floor((tokens * width) / dumbZoneTokens));
const bar = "█".repeat(filled) + dim + "░".repeat(width - filled) + reset;

console.log(`${head}${dim} │ ${reset}${bar} ${formatTokens(tokens)} ${dim}/ ${formatTokens(dumbZoneTokens)} (${formatTokens(cw.context_window_size ?? 0)})${reset}`);
