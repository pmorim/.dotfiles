import { spaces, panes, focused, exec, readTextFile } from "herdr";

// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function location() {

  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
export const key = () => JSON.stringify(location());

const git = (root, on, args) => exec("git", [...READ, ...args], { cwd: root, on });

const baseRefs = new Map();

// The ref this branch was cut from: its open PR's target, else the closest branch on origin
// (fewest commits of ours on top), with the default branch winning ties. Cached for a minute.
async function findBaseRef(root, on) {
  const name = (await git(root, on, ["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
  const cacheKey = `${root}|${on}|${name}`, cached = baseRefs.get(cacheKey);
  if (cached && Date.now() - cached.at < 60000) return cached.ref;
  const valid = async (ref) => (await git(root, on, ["merge-base", "HEAD", ref])).code === 0;
  let ref = null;
  const pr = await exec("gh", ["pr", "view", "--json", "baseRefName", "-q", ".baseRefName"], { cwd: root, on }).catch(() => null);
  const target = pr?.code === 0 ? `origin/${pr.stdout.trim()}` : null;
  if (target && await valid(target)) ref = target;
  if (!ref) {
    const origin = (await git(root, on, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).stdout.trim();
    const listed = (await git(root, on, ["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/remotes/origin"])).stdout.split("\n")
      .filter((r) => r && r !== "origin" && r !== origin && r !== "origin/HEAD" && r !== `origin/${name}`).slice(0, 60);
    let best = Infinity;
    for (const candidate of [origin, "origin/main", "origin/master", ...listed].filter(Boolean)) {
      const count = await git(root, on, ["rev-list", "--count", `${candidate}..HEAD`]);
      const n = count.code === 0 ? Number(count.stdout) : Infinity;
      if (n < best) { best = n; ref = candidate; }
    }
  }
  baseRefs.set(cacheKey, { ref, at: Date.now() });
  return ref;
}

export async function onDefaultBranch(root, on) {
  const [name, origin] = await Promise.all([
    git(root, on, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(root, on, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
  ]);
  return origin.code === 0 && name.stdout.trim() === origin.stdout.trim().replace(/^origin\//, "");
}

export async function resolveBase(root, on, scope) {
  const head = await git(root, on, ["rev-parse", "--verify", "HEAD"]);
  if (head.code !== 0) return { base: EMPTY_TREE, label: "", hasHead: false };
  if (scope !== "branch") return { base: "HEAD", label: "HEAD", hasHead: true };
  const ref = await findBaseRef(root, on);
  const merge = ref ? await git(root, on, ["merge-base", "HEAD", ref]) : null;
  return merge?.code === 0 ? { base: merge.stdout.trim(), label: ref, hasHead: true } : { base: "HEAD", label: "HEAD", hasHead: true };
}

export async function listFiles(root, on, base) {
  const [names, numbers, untracked] = await Promise.all([
    git(root, on, ["diff", "--name-status", "-z", "--no-renames", base]),
    git(root, on, ["diff", "--numstat", "-z", "--no-renames", base]),
    git(root, on, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (names.code !== 0) throw new Error(names.stderr);
  const stats = {};
  for (const entry of numbers.stdout.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (parts.length) stats[parts.join("\t")] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
  }
  const parts = names.stdout.split("\0").filter(Boolean), files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i][0], path = parts[i + 1];
    if (code === "M" && !stats[path]) continue;
    files.push({ path, status: code === "U" || code === "D" || code === "A" ? code : "M", fresh: false, add: 0, del: 0, ...stats[path] });
  }
  const seen = new Set(files.map((f) => f.path));
  for (const path of untracked.stdout.split("\0").filter(Boolean)) {
    if (!seen.has(path)) files.push({ path, status: "A", fresh: true, add: 0, del: 0 });
  }
  return { files: files.slice(0, 1000), limited: files.length > 1000 };
}

export async function listEntries(root, on, args, worktree = false) {
  const [names, numbers] = await Promise.all([
    git(root, on, ["diff", "--name-status", "-z", "--no-renames", ...args]),
    git(root, on, ["diff", "--numstat", "-z", "--no-renames", ...args]),
  ]);
  if (names.code !== 0) throw new Error(names.stderr);
  const stats = {};
  for (const entry of numbers.stdout.split("\0")) {
    const [a, d, ...parts] = entry.split("\t");
    if (parts.length) stats[parts.join("\t")] = { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" };
  }
  const parts = names.stdout.split("\0").filter(Boolean), files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i][0], path = parts[i + 1];
    if (worktree && code === "M" && !stats[path]) continue;
    files.push({ path, status: code === "U" || code === "D" || code === "A" ? code : "M", fresh: false, add: 0, del: 0, ...stats[path] });
  }
  return files;
}

// Reads never refresh the index, so a file whose timestamp changed but not its content still shows
// in --name-status; numstat compares content, so an "M" with no stats is not a change.
// Worktree scope with the index in play: a file can be in both lists.
export async function listSplit(root, on) {
  const [staged, unstaged, untracked] = await Promise.all([
    listEntries(root, on, ["--cached"]),
    listEntries(root, on, [], true),
    git(root, on, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  const seen = new Set(unstaged.map((f) => f.path));
  for (const path of untracked.stdout.split("\0").filter(Boolean)) {
    if (!seen.has(path)) unstaged.push({ path, status: "A", fresh: true, add: 0, del: 0 });
  }
  return { staged: staged.slice(0, 1000), unstaged: unstaged.slice(0, 1000), limited: staged.length > 1000 || unstaged.length > 1000 };
}

export async function loadDiff(sel) {
  if (sel.fresh && sel.section !== "staged") {
    const text = await readTextFile(`${sel.root}/${sel.path}`, { on: sel.on }).catch(() => null);
    if (text === null) return { note: "Cannot preview this file (binary, too large, or unreadable)" };
    if (text.includes("\0")) return { note: "Binary file - no text diff" };
    const body = text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500);
    return { lines: [`@@ -0,0 +1,${body.length} @@`, ...body.map((l) => `+${l}`)] };
  }
  const against = sel.scope === "commit" ? [sel.base, sel.head] : sel.section === "staged" ? ["--cached"] : sel.section === "unstaged" ? [] : [sel.base];
  const r = await git(sel.root, sel.on, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", ...against, "--", sel.path]);
  if (r.code !== 0) throw new Error(r.stderr);
  const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return { note: "No text diff available" };
  const shown = all.slice(first, first + 1500);
  const partial = all.length - first > 1500 || shown.some((l) => l.length > 4000);
  return { lines: shown.map((l) => l.length > 4000 ? `${l.slice(0, 4000)}... (line truncated)` : l), header: all.slice(0, first), partial };
}

// Numbers each diff line once and attaches its colored tokens: removed lines come from the old
// file's highlight, everything else from the new one, so a frame only draws the rows on screen.
export function buildRows(lines, oldHl, newHl) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0], text = line.slice(1) || " ";
    if (kind === "-") { const number = old++; return { kind, number, text, tokens: oldHl?.[number - 1] }; }
    if (kind === "+") { const number = next++; return { kind, number, text, tokens: newHl?.[number - 1] }; }
    if (kind === " ") { old++; const number = next++; return { kind, number, text, tokens: newHl?.[number - 1] }; }
    return { kind: "", text: line };
  });
}

// Pairs a unified diff for side-by-side view: each run of removals sits next to the additions
// that replace it (old file left, new file right); context lines appear on both sides.
export function buildSplit(rows) {
  const out = [];
  let dels = [], adds = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ l: dels[i] ?? null, r: adds[i] ?? null });
    dels = []; adds = [];
  };
  for (const row of rows) {
    if (row.kind === "-") dels.push(row);
    else if (row.kind === "+") adds.push(row);
    else { flush(); out.push(row.kind === " " ? { l: row, r: row } : row); }
  }
  flush();
  return out;
}
