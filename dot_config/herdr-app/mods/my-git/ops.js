import { exec } from "herdr";

const run = async (root, on, args) => {
  const r = await exec("git", ["--literal-pathspecs", ...args], { cwd: root, on });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").filter(Boolean).slice(-1)[0] ?? "git failed");
  return r.stdout;
};

const verified = async (root, on, ref, hash) => {
  if ((await run(root, on, ["rev-parse", "--verify", "-q", ref])).trim() !== hash) throw new Error("Stash list changed, refresh first");
};

export const stashApply = async (root, on, ref, hash) => { await verified(root, on, ref, hash); return run(root, on, ["stash", "apply", ref]); };
export const stashPop = async (root, on, ref, hash) => { await verified(root, on, ref, hash); return run(root, on, ["stash", "pop", ref]); };
export const stashDrop = async (root, on, ref, hash) => { await verified(root, on, ref, hash); return run(root, on, ["stash", "drop", ref]); };

const chunks = (paths, size = 200) => Array.from({ length: Math.ceil(paths.length / size) }, (_, i) => paths.slice(i * size, (i + 1) * size));

const each = async (root, on, paths, make) => {
  for (const part of chunks(paths)) await run(root, on, make(part));
};

export const stage = (root, on, paths) => each(root, on, paths, (p) => ["add", "-A", "--", ...p]);

export const unstage = async (root, on, paths, hasHead) =>
  each(root, on, paths, (p) => (hasHead ? ["restore", "--staged", "--", ...p] : ["rm", "--cached", "-r", "-q", "--", ...p]));

export async function discard(root, on, files) {
  const tracked = files.filter((f) => !f.fresh).map((f) => f.path), fresh = files.filter((f) => f.fresh).map((f) => f.path);
  await each(root, on, tracked, (p) => ["restore", "--", ...p]);
  await each(root, on, fresh, (p) => ["clean", "-f", "-q", "--", ...p]);
}

export const commit = (root, on, message, amend) => run(root, on, ["commit", ...(amend ? ["--amend"] : []), "-m", message]);

export const stash = (root, on, message) => run(root, on, ["stash", "push", "-u", "-m", message || "stash"]);

export async function headMessage(root, on) {
  return (await run(root, on, ["log", "-1", "--format=%B"])).trim();
}

export const fetchAll = (root, on) => run(root, on, ["fetch", "--prune"]);
export const pull = (root, on) => run(root, on, ["pull", "--ff-only"]);
export const push = (root, on) => run(root, on, ["push"]);
export const publish = (root, on) => run(root, on, ["push", "-u", "origin", "HEAD"]);
