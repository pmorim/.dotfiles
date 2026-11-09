import { exec } from "herdr";

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const INFO_FORMAT = "%an%x1f%ae%x1f%aI%x1f%B";

const run = (root, on, args) => exec("git", args, { cwd: root, on });
const text = (r) => (r.stderr || r.stdout).trim();

export async function perform(root, on, action, sha, input) {
  const steps = {
    pick: [["cherry-pick", sha]],
    revert: [["revert", "--no-edit", sha]],
    soft: [["reset", "--soft", sha]],
    mixed: [["reset", "--mixed", sha]],
    hard: [["reset", "--hard", sha]],
    reword: [["commit", "--amend", "--only", "-m", input]],
    undo: [["reset", "--hard", "HEAD@{1}"]],
    checkout: [["switch", "--", input]],
    delete: [["branch", "-d", "--", input]],
  }[action];
  for (const args of steps) {
    const r = await run(root, on, args);
    if (r.code !== 0) return { ok: false, message: text(r) || "git failed", pending: await inProgress(root, on) };
  }
  return { ok: true };
}

export async function inProgress(root, on) {
  for (const [ref, kind] of [["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"]]) {
    if ((await run(root, on, ["rev-parse", "-q", "--verify", ref])).code === 0) return kind;
  }
  return null;
}

export async function abort(root, on, kind) {
  const r = await run(root, on, [kind, "--abort"]);
  return r.code === 0 ? { ok: true } : { ok: false, message: text(r) };
}

export async function lastMove(root, on) {
  const r = await run(root, on, ["reflog", "-1", "--format=%gs"]);
  const count = await run(root, on, ["rev-parse", "-q", "--verify", "HEAD@{1}"]);
  const clean = await run(root, on, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain", "--untracked-files=no"]);
  return { label: r.code === 0 ? r.stdout.trim() : "", canUndo: count.code === 0 && r.stdout.trim() !== "" && !r.stdout.startsWith("checkout:"), clean: clean.code === 0 && clean.stdout.trim() === "" };
}

export async function unpushed(root, on) {
  const r = await run(root, on, ["--no-optional-locks", "rev-list", "HEAD", "--not", "@{upstream}"]);
  return r.code === 0 ? new Set(r.stdout.split("\n").filter(Boolean)) : new Set();
}

export async function commitDetails(root, on, sha) {
  const read = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
  const info = await run(root, on, [...read, "show", "-s", `--format=${INFO_FORMAT}`, sha]);
  if (info.code !== 0) throw new Error(text(info));
  const [author, email, date, ...body] = info.stdout.split("\x1f");
  const parent = await run(root, on, [...read, "rev-parse", "-q", "--verify", `${sha}^1`]);
  const base = parent.code === 0 ? parent.stdout.trim() : EMPTY_TREE;
  const [names, numbers] = await Promise.all([
    run(root, on, [...read, "diff", "--name-status", "-z", "--no-renames", base, sha]),
    run(root, on, [...read, "diff", "--numstat", "-z", "--no-renames", base, sha]),
  ]);
  const stats = new Map();
  for (const entry of numbers.stdout.split("\0").filter(Boolean)) {
    const [add, del, ...path] = entry.split("\t");
    stats.set(path.join("\t"), { add: Number(add) || 0, del: Number(del) || 0 });
  }
  const parts = names.stdout.split("\0").filter(Boolean), files = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    files.push({ status: parts[i][0], path: parts[i + 1], ...(stats.get(parts[i + 1]) ?? { add: 0, del: 0 }) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { author, email, date, message: body.join("\x1f").trim(), files, base, merge: (await run(root, on, [...read, "rev-list", "--parents", "-n1", sha])).stdout.trim().split(" ").length > 2 };
}
