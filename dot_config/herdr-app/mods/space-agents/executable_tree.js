// Works out the sidebar's tree: each space's agents under their statuses, most urgent first.
// No drawing and no app calls, so the rules can be tested. Ranks and the held done agent come from the shipped agents mod.

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
export const STATUSES = [
  { key: "blocked", label: "Needs you" },
  { key: "done", label: "Done" },
  { key: "working", label: "Working" },
  { key: "idle", label: "Idle" },
];
const KEY_OF = Object.fromEntries(Object.entries(RANK).map(([key, rank]) => [rank, key]));

// Agents no listed space holds, which go in a group of their own so none goes missing.
export const NO_SPACE = "no-space";

// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
export function kidStatus(kid, listed) {
  const status = listed.get(kid.address) ?? kid.status;
  return status === "error" ? "blocked" : status === "done" ? "idle" : status;
}

// Live sub-agents of `address`, depth first, each with the tree lines in front of it.
export function subtree(all, address, lead = []) {
  const kids = all.filter((k) => k.parent === address && k.state === "live");
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...subtree(all, k.address, [...lead, last ? "" : "│"])];
  });
}

// Looking at a done agent makes it idle. It stays with Done until you leave it, rather
// than drop away under you. Any other change moves it at once.
export function nextHeld(list, held) {
  const current = list.find((a) => a.focused);
  const same = current && current.address === held?.address;
  if (same && current.status === "idle") return held;
  return current ? { address: current.address, rank: RANK[current.status] ?? 0 } : null;
}

export function rankOf(agent, held) {
  const sawDone = agent.address === held?.address && held.rank === RANK.done && agent.status === "idle";
  return sawDone ? RANK.done : RANK[agent.status] ?? 0;
}

// An agent counts as its most urgent sub-agent.
export function urgencyOf(list, all, held) {
  const listed = new Map(list.map((a) => [a.address, a.status]));
  return new Map(list.map((a) => [a.address, Math.max(
    rankOf(a, held),
    ...subtree(all, a.address).map((s) => RANK[kidStatus(s.t, listed)] ?? 0),
  )]));
}

// space id -> its status groups, only those with agents in them, most urgent first.
// `since(agent)`: when its state last changed, so the newest change leads each group.
export function agentTree(list, spaces, urgency, since) {
  const ids = new Set(), byTab = new Map();
  for (const space of spaces) {
    ids.add(space.id);
    for (const tab of space.tabs ?? []) byTab.set(tab.id, space.id);
  }
  const held = new Map();
  for (const agent of [...list].sort((x, y) => since(y) - since(x) || y.seq - x.seq)) {
    const id = byTab.get(agent.tab) ?? (ids.has(agent.space) ? agent.space : NO_SPACE);
    const key = KEY_OF[urgency.get(agent.address)] ?? "idle";
    if (!held.has(id)) held.set(id, {});
    (held.get(id)[key] ??= []).push(agent);
  }
  const tree = new Map();
  for (const [id, members] of held) {
    tree.set(id, STATUSES.filter((s) => members[s.key]).map((s) => ({ ...s, members: members[s.key] })));
  }
  return tree;
}

// Each agent's name under its space: a tab someone named, else its terminal's name (`hc run --name`), else its own
// title, because an automatic tab number says nothing. Only agents that would still read the same within a space get
// the number, to tell them apart. `labelOf(agent)`: its tab's name. `ownName(agent)`: its title, else its program,
// else null. `nameOf(agent)`: its terminal's name, else null.
export function agentNames(list, labelOf, ownName, nameOf = () => null) {
  const automatic = (a) => /^\d+$/.test(labelOf(a));
  const plain = (a) => (automatic(a) ? nameOf(a) ?? ownName(a) ?? labelOf(a) : labelOf(a));
  const seen = {};
  for (const a of list) {
    const key = `${a.space}\u0000${plain(a)}`;
    seen[key] = (seen[key] ?? 0) + 1;
  }
  return new Map(list.map((a) => {
    const repeated = automatic(a) && seen[`${a.space}\u0000${plain(a)}`] > 1;
    return [a.address, repeated ? `${plain(a)} \u00b7 ${labelOf(a)}` : plain(a)];
  }));
}

// The order agent.next and agent.prev walk: the order they're drawn in.
export function displayOrder(spaceIds, tree) {
  return [...spaceIds, NO_SPACE].flatMap((id) => (tree.get(id) ?? []).flatMap((g) => g.members.map((a) => a.address)));
}

// What a folded space says: how many agents, and the most urgent status among them.
export function foldSummary(groups) {
  return { count: groups.reduce((n, g) => n + g.members.length, 0), top: groups[0]?.key ?? null };
}

// Whether a space's icon glows: an agent in it is working, or a sub-agent of one. An agent
// waiting on you isn't active, and it has its own mark.
export function spaceActive(groups, all, listed) {
  return groups.some((g) => g.members.some((a) => a.status === "working"
    || subtree(all, a.address).some((s) => kidStatus(s.t, listed) === "working")));
}

// Workers that stopped working since the last look: they went idle or done, or ended. `before`: address -> status from
// the last look. A worker with a pane of its own is in agents(), and the app plays its done sound for it, so it's left
// out. An empty list says nothing about workers, because that's what a lost connection looks like.
export function finishedWorkers(before, all, agentAddresses) {
  if (!all.length) return { current: before, finished: [] };
  const current = new Map(all
    .filter((k) => k.parent && k.state === "live" && !agentAddresses.has(k.address))
    .map((k) => [k.address, k.status]));
  const finished = [...before].filter(([address, status]) => status === "working"
    && (!current.has(address) || ["idle", "done"].includes(current.get(address)))).map(([address]) => address);
  return { current, finished };
}

// A fold starts with its space's id, so a fold can go when its space does.
export const foldKey = {
  space: (id) => id,
  project: (id) => `${id}|project`,
  status: (id, status) => `${id}|${status}`,
  kids: (id, address) => `${id}|kids|${address}`,
};

// Drops folds of spaces that have gone. A space on another machine (`win/sp1`) stays while that machine's layout
// isn't ready, because then its spaces are out of the list; once it's ready, a fold for a space it lacks goes.
// `ready`: names of machines whose layout is ready.
export function pruneFolds(folds, spaceIds, ready = []) {
  const ids = new Set([...spaceIds, NO_SPACE]);
  const up = new Set(ready);
  return folds.filter((key) => {
    const id = key.split("|")[0];
    if (ids.has(id)) return true;
    const slash = id.indexOf("/");
    return slash > 0 && !up.has(id.slice(0, slash));
  });
}

// A press on a fold's chevron, this recently, was the chevron's: the row under it doesn't act on the same press.
export const FOLD_PRESS_MS = 600;
export const foldPressed = (at, now) => now - (at ?? -Infinity) < FOLD_PRESS_MS;

// Where a dragged space lands: by id, so a space closing mid-drag can't point at the wrong one.
// Null when either has gone, or they're the same. `index` is space.move's, from 1.
export function dropTarget(spaceIds, fromId, overId) {
  const from = spaceIds.indexOf(fromId), to = spaceIds.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  return { id: fromId, index: to + 1 };
}

// What a blocked terminal is waiting on, from its own report: the message (`approve Bash: ...`), else its kind.
const KINDS = { permission: "needs permission", question: "has a question", auth: "needs a sign-in" };
export function blockedReason(term) {
  const r = term?.report;
  if (typeof r === "string") return r.trim() || null;
  if (typeof r?.msg === "string" && r.msg.trim()) return r.msg.trim();
  return KINDS[r?.kind] ?? null;
}

// Every blocked agent and sub-agent, oldest first. `list`: agents(), `all`: terminals(),
// `since(agent)`: when its state last changed, used when the terminal doesn't say.
export function inbox(list, all, since) {
  const byAddress = new Map(all.map((t) => [t.address, t]));
  const listed = new Set(list.map((a) => a.address));
  const entries = list.filter((a) => a.status === "blocked").map((a) => {
    const t = byAddress.get(a.address);
    return { address: a.address, pane: a.pane, agent: a, sub: false, reason: blockedReason(t), at: t?.status_ms || since(a), seq: a.seq ?? 0 };
  });
  for (const t of all) {
    if (listed.has(t.address) || !t.parent || t.state !== "live" || !["blocked", "error"].includes(t.status)) continue;
    const reason = blockedReason(t) ?? (t.status === "error" ? "stopped on an error" : null);
    entries.push({ address: t.address, pane: null, term: t, sub: true, reason, at: t.status_ms || 0, seq: Infinity });
  }
  // terminals() can leave status_ms null, so the app's seq (higher: changed later) breaks ties among agents.
  const byTime = (x, y) => (x.at || Infinity) - (y.at || Infinity);
  const bySeq = (x, y) => (x.seq === y.seq ? 0 : x.seq - y.seq);
  return entries.sort((x, y) => byTime(x, y) || bySeq(x, y) || x.address.localeCompare(y.address));
}

// The header's counts, from what the list and the inbox show, so they can't disagree. `tree`: agentTree's,
// `waiting`: inbox(), `all`: terminals(), `listed`: address -> status from agents().
// Working: every agent, sub-agent and worker drawn with a spinner, each once. Waiting on you: the inbox, which has
// blocked sub-agents and workers too. Done: what the Done folds hold, so a done agent you're looking at still counts.
export function fleetCounts(tree, waiting, all, listed) {
  const working = new Set();
  let done = 0;
  for (const groups of tree.values()) {
    for (const g of groups) {
      if (g.key === "done") done += g.members.length;
      for (const a of g.members) {
        if (a.status === "working") working.add(a.address);
        for (const s of subtree(all, a.address)) if (kidStatus(s.t, listed) === "working") working.add(s.t.address);
      }
    }
  }
  return { working: working.size, blocked: waiting.length, done };
}

// A terminal's own name, given with `hc run --name`, or null when it has none.
export function terminalName(term) {
  return typeof term?.name === "string" && term.name.trim() ? term.name.trim() : null;
}

// The chat pane's unseen rows, from shared `chat.unseen`, which may be absent or not in the shape expected:
// a count, a list, or a map of counts.
export function unseenCount(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") {
    if (typeof value.count === "number") return unseenCount(value.count);
    return Object.values(value).reduce((n, v) => n + (typeof v === "number" ? unseenCount(v) : Array.isArray(v) ? v.length : 0), 0);
  }
  return 0;
}

// Paths `git status --porcelain=v2` says are changed or new, relative to the checkout's top.
export function changedPaths(porcelain) {
  const out = [];
  for (const line of (porcelain ?? "").split("\n")) {
    if (line.startsWith("1 ")) out.push(line.split(" ").slice(8).join(" "));
    else if (line.startsWith("2 ")) out.push(line.split("\t")[0].split(" ").slice(9).join(" "));
    else if (line.startsWith("u ")) out.push(line.split(" ").slice(10).join(" "));
    else if (line.startsWith("? ")) out.push(line.slice(2));
  }
  return out.filter(Boolean);
}

// Spaces whose checkouts of one repo have the same files changed. `places`: [{ id, repo, top, files }], one per
// space. Two spaces in the same checkout aren't a clash. Returns space id -> the shared paths, sorted.
export function sharedEdits(places) {
  const byFile = new Map();
  for (const p of places) {
    if (!p.repo || !p.top) continue;
    for (const f of p.files ?? []) {
      const k = `${p.repo}\u0000${f}`;
      if (!byFile.has(k)) byFile.set(k, []);
      byFile.get(k).push(p);
    }
  }
  const out = new Map();
  for (const [k, ps] of byFile) {
    if (new Set(ps.map((p) => p.top)).size < 2) continue;
    const file = k.split("\u0000")[1];
    for (const p of ps) {
      if (!out.has(p.id)) out.set(p.id, new Set());
      out.get(p.id).add(file);
    }
  }
  return new Map([...out].map(([id, files]) => [id, [...files].sort()]));
}

// A session's share of its context, as the status line's `context:` shows it: of the usable 80% of the window.
// The transcript names the model but not its window. 1M for a model from generation 5 on (claude-haiku-5-5 read
// 9.2% at 73.9k, so 1M), for one marked [1m], or one seen past 200k (`big`); 200k otherwise.
export const CONTEXT_WARN = 60;
export const CONTEXT_LAP = 150000;
export function contextWindow(tokens, model, big = new Set()) {
  const generation = Number(/^claude-[a-z]+-(\d+)/.exec(model ?? "")?.[1] ?? 0);
  return tokens > 200000 || big.has(model) || /\[1m\]/i.test(model ?? "") || generation >= 5 ? 1000000 : 200000;
}
// One lap of the ring is 150k tokens. Past that the ring keeps filling: `laps` counts the full laps, `pct` is
// the progress into the current one, and the total stops at the model's window.
// `limit` is the dumb zone from settings.json when the helper found one; anything else gets CONTEXT_LAP.
export function contextShare(tokens, model, big = new Set(), limit = null) {
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  const lap = Number.isFinite(limit) && limit > 0 ? limit : CONTEXT_LAP;
  const window = contextWindow(tokens, model, big);
  const turns = Math.min(tokens, window) / lap;
  const laps = Math.floor(turns);
  return { laps, pct: Math.round((turns - laps) * 100), window, lap, first: Math.round(Math.min(turns, 1) * 100) };
}
