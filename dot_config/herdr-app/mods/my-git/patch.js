import { exec } from "herdr";

export function parseHunks(lines) {
  const starts = [];
  lines.forEach((l, i) => { if (l.startsWith("@@ ")) starts.push(i); });
  return starts.map((start, n) => {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(lines[start]);
    return {
      start, end: starts[n + 1] ?? lines.length,
      oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2],
      newStart: +m[3], newCount: m[4] === undefined ? 1 : +m[4],
      tail: m[5],
    };
  });
}

export const hunkAt = (hunks, idx) => hunks.findIndex((h) => idx >= h.start && idx < h.end);

// Converts a partial selection into a patch git can apply on its own. Forward (stage) patches match
// the old side, so unselected '-' stay as context and unselected '+' vanish; reverse patches (unstage,
// discard) match the new side, so unselected '+' stay as context and unselected '-' vanish.
// picked: Set of line indexes, or null for the whole hunk. Returns null when nothing would change.
export function buildPatch(header, lines, hunk, picked, reverse, path) {
  const body = [];
  let oldCount = 0, newCount = 0, changed = false, keep = true;
  for (let i = hunk.start + 1; i < hunk.end; i++) {
    const line = lines[i], kind = line[0];
    if (kind === "\\") { if (keep) body.push(line); continue; }
    const chosen = !picked || picked.has(i);
    keep = true;
    if (kind === " " || line === "") { body.push(line === "" ? " " : line); oldCount++; newCount++; continue; }
    if (kind !== "-" && kind !== "+") continue;
    if (chosen) {
      body.push(line); changed = true;
      if (kind === "-") oldCount++; else newCount++;
    } else if ((kind === "-") !== reverse) {
      body.push(` ${line.slice(1)}`); oldCount++; newCount++;
    } else keep = false;
  }
  if (!changed) return null;
  const target = reverse ? hunk.newStart : hunk.oldStart, targetCount = reverse ? hunk.newCount : hunk.oldCount;
  const first = targetCount > 0 ? target : target + 1;
  const otherCount = reverse ? oldCount : newCount;
  const other = otherCount > 0 ? first : first - 1;
  const [os, ns] = reverse ? [other, target] : [target, other];
  const head = picked ? partialHeader(header, path) : header;
  return `${[...head, `@@ -${os},${oldCount} +${ns},${newCount} @@${hunk.tail}`, ...body].join("\n")}\n`;
}

function partialHeader(header, path) {
  const adds = header.some((l) => l.startsWith("new file mode")), dels = header.some((l) => l.startsWith("deleted file mode"));
  if (!adds && !dels) return header;
  return header.filter((l) => !l.startsWith("new file mode") && !l.startsWith("deleted file mode"))
    .map((l) => (adds && l === "--- /dev/null" ? `--- a/${path}` : dels && l === "+++ /dev/null" ? `+++ b/${path}` : l));
}

const MODES = {
  stage: ["--cached"],
  unstage: ["--cached", "--reverse"],
  discard: ["--reverse"],
};

export async function applyPatch(root, on, patch, mode) {
  const script = 'p=$1; shift; printf %s "$p" | git apply --recount --whitespace=nowarn "$@"';
  const r = await exec("sh", ["-c", script, "sh", patch, ...MODES[mode]], { cwd: root, on });
  return r.code === 0 ? null : (r.stderr.trim().split("\n")[0] || "git apply failed");
}
