// Changed from Herdr's shipped `spaces` and `agents` mods (Apache-2.0): see NOTICE.md.
// Spaces and their agents in one sidebar list, in place of the shipped spaces and agents blocks. Each space folds, and
// under it its agents sit in folds by status, most urgent first. A space keeps what the spaces mod gives it: colored
// worktrees under their checkout, a header per machine, git after the name, right-click menu, drag to reorder.
// Its git reading is that mod's, unchanged. The tree's rules are in tree.js.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, machines, run, openOverlay, exec, hc, theme, shared, setShared, setAgentOrder, settings, playSound, watchFolder, notify, window, layout, appHome, home, nextCommand } from "herdr";
import {
  CONTEXT_LAP, CONTEXT_WARN, NO_SPACE, RANK, agentNames, agentTree, blockedReason, changedPaths, contextShare, displayOrder, dropTarget, finishedWorkers, fleetCounts,
  foldKey, foldPressed, foldSummary, inbox, kidStatus, nextHeld, pruneFolds, sharedEdits, spaceActive, subtree, terminalName, unseenCount, urgencyOf,
} from "./tree.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

const SPARK = "mods/space-agents/spark.svg";
const BRANCH = "mods/workspace-chrome/branch.svg";
const BOT = "mods/space-agents/bot.svg";
const SUBAGENT = "mods/space-agents/subagent.svg";
const CPU = "mods/space-agents/cpu.svg";
const CLOCK = "mods/space-agents/clock.svg";
const PR_MS = 300000; // Pull request counts, and a fetch so ahead/behind is true, every five minutes.
const CONFIRM_MS = 4000; // A push takes a second click within this long.
const WORKER_SOUND = "mods/space-agents/worker.mp3";
const WORKER_SOUND_GAP_MS = 1500; // Workers finishing together play it once.
// Render looks for finished workers with what it has already read. This catches them when render hasn't run lately.
const WORKER_CHECK_MS = 2000;
// How often each local Claude Code session's context is read, by a helper that reads the end of its transcript.
const CONTEXT_MS = 8000;
const CONTEXT_HELPER = "mods/space-agents/context.py";
const GLOW_MS = 1800;
// Rings stacked behind the icon, faintest and widest first, which fades out softly as there's no blur to use.
const GLOW = [{ size: 30, to: 0.05 }, { size: 26, to: 0.07 }, { size: 22, to: 0.09 }, { size: 18, to: 0.12 }, { size: 14, to: 0.16 }];

// The tree: a header's line drops from under its status mark and each child branches off it.
// A checkout sits RAIL_STEP in from its project, and its agents hang off a line one step further in.
const RAIL_X = 16;
const RAIL_STEP = 24;
const TICK = 11;
const LEVEL = 13;
const CHECKOUT_GAP = 8; // how far each level of sub-terminals sits in from the one above
const STATUS = "mods/space-agents/status";

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all) {
  const mine = all.filter((p) => p.tab === tab.id && p.terminal);
  return mine.find((p) => p.program?.agent) ?? mine.find((p) => p.focused) ?? mine[0];
}

// A terminal's own title, unless it only repeats the program or says where the shell is.
function telling(raw, program) {
  const live = clean(raw);
  const says = live && live !== program?.name && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== program?.key;
  return says ? live : null;
}

function title(tab, l) {
  const live = telling(l?.title, l?.program);
  return tab.name === l?.program?.name && live ? live : tab.name;
}

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class SpaceAgents extends View {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.machinesFolded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.folded = new Set(JSON.parse(localStorage.getItem("folded") ?? "[]"));
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.held = null;
    this.workers = new Map(); // address -> status at the last look
    this.workerSoundAt = 0;
    this.workersAt = 0; // when finished workers were last looked for
    this.foldPressAt = null; // when a chevron last took a press
    this.context = JSON.parse(localStorage.getItem("context.last") ?? "{}"); // agent address -> { tokens, model }
    this.bigModels = new Set(JSON.parse(localStorage.getItem("context.big") ?? "[]")); // models seen past 200k
    this.prs = {}; // repo -> { open, review } open pull requests, and those asking for your review
    this.confirming = null; // { id, at }: a push waiting for its second click
    this.working = new Set(); // badge ids whose git command is running
    this.refreshMachines(cx);
    cx.timer.every(PR_MS, (cx) => this.refreshPrs(cx));
    cx.timer.after(3000, (cx) => this.refreshPrs(cx));
    cx.timer.every(15000, (cx) => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
    cx.timer.every(WORKER_CHECK_MS, () => {
      if (Date.now() - this.workersAt >= WORKER_CHECK_MS) this.checkWorkers(Date.now(), terminals(), agents());
    });
    cx.timer.every(30000, (cx) => cx.notify());
    this.readContext(cx);
    cx.timer.every(CONTEXT_MS, (cx) => this.readContext(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        try {
          await watchFolder(`${home()}/.claude/projects`);
          this.readContext(cx);
        } catch {
          await new Promise((resolve) => cx.timer.after(30000, resolve));
        }
      }
    });
    cx.timer.every(1500, (cx) => {
      const signature = agents().map((a) => `${a.address}:${a.status}`).join();
      if (signature === this.statusSignature) return;
      this.statusSignature = signature;
      this.readContext(cx);
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "oldest-blocked") this.jumpToOldest();
        cx.notify();
      }
    });
  }

  // The key's jump: the agent that has waited on you longest.
  jumpToOldest() {
    const first = inbox(agents(), terminals(), (a) => this.since(a))[0];
    if (first) this.focusEntry(first);
  }

  focusEntry(e) {
    if (e.pane) run("pane.focus", { pane: e.pane });
    else run("agent.focus", { terminal: e.address });
  }

  // `python3` is a Microsoft Store stub on Windows, so `python` is the second try.
  async python(args) {
    for (const bin of this.pythonBin ? [this.pythonBin] : ["python3", "python"]) {
      try {
        const r = await exec(bin, args);
        if (r.code === 0) { this.pythonBin = bin; return r; }
      } catch {}
    }
    return { code: 1, stdout: "", stderr: "" };
  }

  // Each local Claude Code session's latest usage, through a helper that reads the end of its transcript.
  readContext(cx) {
    if (this.readingContext) { this.contextAgain = true; return; }
    const all = terminals();
    const pids = {};
    const byAddress = (x, y) => x.address.localeCompare(y.address, undefined, { numeric: true });
    for (const a of [...agents()].sort(byAddress)) {
      if (a.address.includes("/") || (a.app !== "claude-code" && a.program?.key !== "claude")) continue;
      const fg = all.find((t) => t.address === a.address);
      // Where the shell is the foreground (Windows), Claude is its child: the session is found by folder instead.
      const key = fg?.foreground?.pid && !fg.foreground.name?.match(/^(pwsh|powershell|cmd|bash|zsh|fish|sh)(\.exe)?$/i) ? String(fg.foreground.pid) : fg?.cwd ? `cwd:${fg.cwd}` : null;
      if (key) (pids[key] ??= []).push(a.address);
    }
    if (!Object.keys(pids).length) { this.context = {}; return; }
    this.readingContext = true;
    cx.spawn(async (cx) => {
      try {
        const r = await this.python(["-I", "-S", `${appHome()}/${CONTEXT_HELPER}`, ...Object.keys(pids)]);
        if (r.code !== 0) return;
        const seen = JSON.parse(r.stdout);
        const next = {};
        for (const [key, value] of Object.entries(seen)) {
          const list = Array.isArray(value) ? value : [value];
          list.forEach((usage, i) => { if (usage && pids[key]?.[i]) next[pids[key][i]] = usage; });
          for (const usage of list) if (usage && usage.tokens > 200000 && usage.model && !this.bigModels.has(usage.model)) {
            this.bigModels.add(usage.model);
            localStorage.setItem("context.big", JSON.stringify([...this.bigModels]));
          }
        }
        // A read that misses an agent (its transcript mid-write) keeps what it showed while the agent lives.
        const live = new Set(Object.values(pids).flat());
        for (const [address, usage] of Object.entries(this.context)) if (live.has(address) && !next[address]) next[address] = usage;
        this.context = next;
        localStorage.setItem("context.last", JSON.stringify(next));
      } catch {} finally {
        this.readingContext = false;
        cx.notify();
        if (this.contextAgain) {
          this.contextAgain = false;
          cx.timer.after(1000, (cx) => this.readContext(cx));
        }
      }
    });
  }

  // The app has sounds for an agent that needs you or finishes, and none for a worker, so that one's played here.
  // `all` and `list`: terminals() and agents(), as the caller read them.
  checkWorkers(now, all, list) {
    this.workersAt = now;
    const { current, finished } = finishedWorkers(this.workers, all, new Set(list.map((a) => a.address)));
    this.workers = current;
    if (!finished.length || settings().sounds?.enabled === false || now - this.workerSoundAt < WORKER_SOUND_GAP_MS) return;
    this.workerSoundAt = now;
    playSound(WORKER_SOUND);
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id))) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.machinesFolded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async (cx) => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      this.prune();
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      // Paths from the checkout's top, not the folder, so two spaces' changed files compare.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "status.relativePaths=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = {
        name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git`,
        top: top.stdout.trim(), files: changedPaths(r.stdout),
      };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  // Open pull requests per repo, and how many ask for your review. `gh` answers for a GitHub remote only.
  refreshPrs(cx) {
    if (this.fetchingPrs) return;
    this.fetchingPrs = true;
    const repos = new Map();
    for (const g of Object.values(this.git)) if (g && !repos.has(g.repo)) repos.set(g.repo, g);
    cx.spawn(async (cx) => {
      try {
        for (const [repo, g] of repos) {
          const on = JSON.parse(repo)[0];
          const count = async (extra) => {
            const r = await exec("gh", ["pr", "list", "--state", "open", "--json", "number", "--limit", "100", ...extra], { cwd: g.top, on });
            return r.code === 0 ? JSON.parse(r.stdout).length : null;
          };
          try {
            const open = await count([]);
            this.prs[repo] = open === null ? null : { open, review: open ? await count(["--search", "review-requested:@me"]) ?? 0 : 0 };
          } catch { this.prs[repo] ??= null; }
          if (!on) await exec("git", ["fetch", "--quiet"], { cwd: g.top }).catch(() => {});
        }
      } finally {
        this.fetchingPrs = false;
        this.refreshGit(Object.keys(this.git), cx);
        cx.notify();
      }
    });
  }

  // Runs one git command for a badge, then looks at the place again. A failure says why.
  gitAction(id, g, args, label, cx) {
    if (this.working.has(id)) return;
    this.working.add(id);
    const [on] = JSON.parse(g.repo);
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("git", args, { cwd: g.top, on });
        if (r.code !== 0) notify({ title: `${label} failed`, body: (r.stderr || r.stdout).trim().slice(-200), level: "error" });
      } catch (e) {
        notify({ title: `${label} failed`, body: String(e), level: "error" });
      } finally {
        this.working.delete(id);
        this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === g.repo), cx);
        cx.notify();
      }
    });
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  toggle(key) {
    this.folded.has(key) ? this.folded.delete(key) : this.folded.add(key);
    this.prune(true);
  }

  // Folds of spaces that have gone. Another machine's only once it's connected and its layout has been read.
  prune(changed = false) {
    const connected = new Set(this.machines.filter((m) => m.state === "connected").map((m) => m.name));
    const docs = machines();
    const ready = docs.filter((m) => m.name && m.layout === "ready" && connected.has(m.name)).map((m) => m.name);
    // Before this computer's layout is read its spaces aren't listed yet, and every fold would look gone.
    const kept = docs.some((m) => m.name === null && m.layout === "ready")
      ? pruneFolds([...this.folded], spaces().map((s) => s.id), ready) : [...this.folded];
    if (!changed && kept.length === this.folded.size) return;
    this.folded = new Set(kept);
    localStorage.setItem("folded", JSON.stringify(kept));
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered() {
    const sp = spaces(), ps = panes();
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null })).filter((r) => this.shown.has(r.w.id));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    return out;
  }

  // One bordered card per project: a lone space, or a project header over its checkouts.
  cards(rows, t, tree) {
    const groups = [];
    for (const r of rows) {
      if (!r.tree || !groups.length) groups.push([]);
      groups[groups.length - 1].push(r);
    }
    return groups.map((g) => v_flex().flex_none().mx(6).mb(8).p(4).rounded(11).bg(t.surface).border(1).border_color(t.border)
      .children(this.projectRows(g, t, tree)));
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, collapsed, rows, tree) {
    const draw = (r) => this.compact(r, t, tree);
    const remote = [...new Set([...rows.map((r) => r.w.machine).filter(Boolean), ...this.machines.map((m) => m.name)])].sort();
    const loading = (m) => {
      const layout = machines().find((k) => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some((k) => k.name === m && k.state === "connected"))
        || spaces().some((s) => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = (m) => div().id(`machine-loading-${m ?? "local"}`).h(28).flex_none().px(8).text_size(12).text_color(t.dim).child("…");
    const cards = (list) => (collapsed ? list.flatMap(draw) : this.cards(list, t, tree));
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : cards(rows);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const machine = this.machines.find((k) => k.name === m);
      const connected = !m || machine?.state === "connected";
      const folded = this.machinesFolded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).h(26).flex_none().px(collapsed ? 2 : 8).gap(7).items_center().text_size(11).text_color(t.dim)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.machinesFolded.delete(m) : this.machinesFolded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.machinesFolded]));
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .when(!collapsed, (el) => el.child(div().flex_1().truncate().child(m ?? "This computer"))
          .when(!connected, (el) => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(connected, (el) => el.child(div().id(`machine-add-${m ?? "local"}`).flex_none().px(4).rounded(4).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); run("space.new", m ? { machine: m } : {}); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/workspace-chrome/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none()));
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).h(28).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(12).text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("space.new", m ? { machine: m } : {}))
        .child(svg("mods/workspace-chrome/plus.svg").size(12)).when(!collapsed, (el) => el.child("New space"));
      return [head, ...(folded ? [] : mine.length ? cards(mine) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Only what's unusual, after the name: "herdr · spike ↑2 ↓1". The repo or
  // branch goes when the name already says it (a worktree is named after its branch),
  // and master/main go: nearly every space is on one.
  gitText(g, checkout, name) {
    const raw = g.branch ?? "detached";
    const same = (a) => a.toLowerCase() === name.toLowerCase();
    const branch = same(raw) || raw === "master" || raw === "main" ? "" : raw;
    const repo = checkout || same(g.name) ? "" : g.name;
    return [repo, branch].filter(Boolean).join(" · ") || (checkout ? "" : raw);
  }

  // What a space row says besides its name, and how tall that makes it.
  rowFacts({ w, g }, checkout, primary) {
    const label = checkout && primary ? (g?.branch ?? w.name) : w.name;
    const clash = this.clashes?.get(w.id) ?? [];
    const line = Boolean(g) && (!checkout || g.ahead > 0 || g.behind > 0 || clash.length > 0 || Boolean(this.gitText(g, true, label)));
    return { label, line, height: (checkout ? 28 : 30) + (line ? 12 : 0) };
  }

  prBadge(g, t) {
    const p = this.prs[g.repo];
    if (!(p?.open > 0)) return null;
    return this.badge(`pr-${g.top}`, t, {
      text: `PR ${p.open}`, color: p.review > 0 ? t.ansi1 : t.dim,
      tip: p.review > 0 ? `${p.open} open pull requests, ${p.review} ask for your review` : `${p.open} open pull request${p.open > 1 ? "s" : ""}`,
      press: () => exec("gh", ["pr", "list", "--web"], { cwd: g.top, on: JSON.parse(g.repo)[0] }).catch(() => {}),
    });
  }

  gitLine(g, checkout, name, t, withPr = true, clash = [], id = "") {
    const where = this.gitText(g, checkout, name);
    return h_flex()
      .min_w(0)
      .gap(6)
      .items_center()
      .text_size(11)
      .text_color(t.dim)
      .when(Boolean(where), (el) => el.child(div().min_w(0).truncate().child(where)))
      .when(g.ahead > 0, (el) => el.child(this.badge(`push-${g.top}`, t, {
        text: this.confirmingPush(`push-${g.top}`) ? `↑${g.ahead} push?` : `↑${g.ahead}`, color: t.ansi2,
        tip: `${g.ahead} commit${g.ahead > 1 ? "s" : ""} to push: click twice`,
        press: (cx) => {
          const id = `push-${g.top}`;
          if (!this.confirmingPush(id)) {
            this.confirming = { id, at: Date.now() };
            cx.timer.after(CONFIRM_MS, (cx) => cx.notify());
          } else {
            this.confirming = null;
            this.gitAction(id, g, ["push"], "Push", cx);
          }
        },
      })))
      .when(g.behind > 0, (el) => el.child(this.badge(`pull-${g.top}`, t, {
        text: `↓${g.behind}`, color: t.ansi1, tip: `${g.behind} commit${g.behind > 1 ? "s" : ""} to pull (fast-forward only)`,
        press: (cx) => this.gitAction(`pull-${g.top}`, g, ["pull", "--ff-only"], "Pull", cx),
      })))
      .when(withPr && Boolean(this.prBadge(g, t)), (el) => el.child(this.prBadge(g, t)))
      .when(clash.length > 0, (el) => el.child(h_flex().id(`clash-${id}`).flex_none().gap(3).items_center().text_color(t.ansi3)
        .tooltip(`Also changed in another worktree: ${clash.slice(0, 6).join(", ")}${clash.length > 6 ? ` and ${clash.length - 6} more` : ""}`)
        .child(svg("mods/workspace-chrome/git-compare.svg").size(11).flex_none()).child(String(clash.length))));
  }

  confirmingPush(id) {
    return this.confirming?.id === id && Date.now() - this.confirming.at < CONFIRM_MS;
  }

  // A clickable figure inside a row: it takes the press, so the row doesn't select or start a drag.
  badge(id, t, { text, color, tip, press }) {
    const busy = this.working.has(id);
    return div().id(id).flex_none().px(3).rounded(4).text_color(color).opacity(busy ? 0.5 : 1).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        this.foldPressAt = Date.now();
        press(cx);
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .child(busy ? "…" : text);
  }

  // The fold control on a row that presses for something else. Acts on the press, and stops it, so the row underneath
  // doesn't select or start a drag. Folded, it says how many and the most urgent status, unless that's idle.
  foldToggle(key, { count, top }, t) {
    const open = !this.folded.has(key);
    return h_flex()
      .id(`fold-${key}`)
      .flex_none()
      .h(20)
      .pl(open ? 0 : 4)
      .gap(5)
      .items_center()
      .rounded(4)
      .text_size(11)
      .text_color(t.dim)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => {
        cx.stop_propagation();
        // Stopping the press should keep it from the row, and the time is there in case it doesn't (see foldPressed).
        this.foldPressAt = Date.now();
        this.toggle(key);
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .when(!open && Boolean(top) && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
      .when(!open, (el) => el.child(String(count)))
      .child(div().w(18).flex_none().flex().items_center().justify_center().child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none()));
  }

  // A card's rows. A lone space is its header with its agents on a line below it. With worktrees, the project is a header
  // that folds the lot, and its own checkout is one of the checkouts, a sibling of the worktrees, each with its agents.
  projectRows(group, t, tree) {
    if (group.length > 1) return [this.projectHead(group, t, tree), ...(this.folded.has(foldKey.project(group[0].w.id)) ? [] : group.map((r, i) => this.checkout(r, t, tree, i, i === group.length - 1)))];
    const [r] = group;
    const groups = tree.get(r.w.id) ?? [];
    return [this.row(r, t, groups), ...(this.folded.has(foldKey.space(r.w.id)) ? [] : this.agentList(r.w.id, groups, t, RAIL_X))];
  }

  projectHead(group, t, tree) {
    const main = group[0];
    const key = foldKey.project(main.w.id);
    const open = !this.folded.has(key);
    const sums = group.map((r) => foldSummary(tree.get(r.w.id) ?? []));
    const count = sums.reduce((n, s) => n + s.count, 0);
    const top = sums.reduce((m, s) => ((RANK[s.top] ?? 0) > (RANK[m] ?? 0) ? s.top : m), null);
    const pr = main.g ? this.prBadge(main.g, t) : null;
    return h_flex()
      .id(`project-${main.w.id}`)
      .h(30)
      .flex_none()
      .mb(open ? 3 : 0)
      .px(8)
      .gap(7)
      .items_center()
      .rounded(6)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        if (foldPressed(this.foldPressAt, Date.now())) return;
        this.toggle(key);
        cx.notify();
      })
      .child(this.statusDot(top, t))
      .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(main.w.name))
      .child(div().flex_1())
      .when(Boolean(pr), (el) => el.child(pr))
      .child(this.foldToggle(key, { count, top }, t));
  }

  // One checkout of a project: its header, then its agents on a line of their own, hung off the project's line.
  checkout(r, t, tree, index, last) {
    const groups = tree.get(r.w.id) ?? [];
    const facts = this.rowFacts(r, true, index === 0);
    const agents = this.folded.has(foldKey.space(r.w.id)) ? [] : this.agentList(r.w.id, groups, t, RAIL_X + RAIL_STEP);
    const gap = index === 0 ? 0 : CHECKOUT_GAP;
    return v_flex().relative().flex_none()
      .children([...(gap ? [div().h(gap).flex_none()] : []), this.row(r, t, groups, { checkout: true, primary: index === 0 }), ...agents, ...this.guide(t, RAIL_X, last ? "└" : "├", gap + (facts.line ? 13 : 14))]);
  }

  // One piece of the tree at x: "│" runs through the row, "├" adds an elbow `at` px down, "└" ends in a curved elbow.
  guide(t, x, kind, at) {
    const run = () => div().absolute().left(x).top(0).bottom(0).w(1.5).bg(t.input);
    const tick = () => div().absolute().left(x).top(at).w(TICK).h(1.5).bg(t.input);
    if (kind === "│") return [run()];
    if (kind === "├") return [run(), tick()];
    if (kind === "└") return [div().absolute().left(x).top(0).w(TICK).h(at + 0.75).border_l(1.5).border_b(1.5).border_color(t.input).rounded_bl(6)];
    return [];
  }

  // A space's icon, in the theme's accent with a slow glow behind it while an agent in the space is working.
  mark(path, active, t) {
    return div()
      .relative()
      .size(18)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .when(active, (el) => el
        .children(GLOW.map(({ size, to }) => div().absolute().left((18 - size) / 2).top((18 - size) / 2).size(size).rounded_full().bg(t.accent)
          .loop("opacity", { from: to / 4, to, period: GLOW_MS }))))
      .child(svg(path).size(14).text_color(active ? t.accent : t.dim));
  }

  // The most urgent status under a header, as the same badge an agent gets. A header with nothing under it gets a faint ring.
  statusDot(top, t) {
    return div().size(18).flex_none().flex().items_center().justify_center()
      .child(top ? this.statusMark(top, t) : this.statusMark("idle", t).opacity(0.4));
  }

  // The 12px badge for a status: a ring while idle, a spinning arc while working, a filled disc with a check when done, with a bang when blocked.
  statusMark(status, t, spin = true) {
    if (status === "working") return (spin ? svg("mods/workspace-chrome/spinner.svg").spin(900) : svg("mods/workspace-chrome/spinner.svg")).size(12).flex_none().text_color(t.working);
    const color = status === "blocked" ? t.blocked : status === "done" ? t.done : t.idle ?? t.dim;
    return svg(`${STATUS}/${status === "blocked" || status === "done" ? status : "idle"}.svg`).size(12).flex_none().text_color(color);
  }

  // A drag that ends anywhere but on a row: released elsewhere in the list, or the pointer left the list.
  endDrag(cx) {
    if (this.pressed === null && this.over === null) return;
    this.pressed = null;
    this.over = null;
    cx.notify();
  }

  // The drag holds space ids, not places in the list, so a space that closes mid-drag can't move the wrong one.
  row(r, t, groups, { checkout = false, primary = false } = {}) {
    const { w, i, g } = r;
    const facts = this.rowFacts(r, checkout, primary);
    const on = w.active;
    const from = this.pressed === null ? -1 : this.spaceIds.indexOf(this.pressed);
    const clash = this.clashes?.get(w.id) ?? [];
    const top = groups[0]?.key ?? null;
    const tag = checkout ? primary : this.hasKids(g);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .pl(checkout ? RAIL_X + 15 : 8)
      .pr(8)
      .h(facts.height)
      .flex_none()
      .justify_center()
      .rounded(6)
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(from >= 0 && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(from < i, (line) => line.bottom(0))
          .when(from > i, (line) => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        if (foldPressed(this.foldPressAt, Date.now())) return;
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        if (this.pressed === null) return;
        const source = spaces().find((s) => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        const move = from !== null && over === w.id ? dropTarget(spaces().map((s) => s.id), from, w.id) : null;
        if (move) run("space.move", move);
        else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(
        h_flex()
          .gap(7)
          .items_center()
          .child(this.statusDot(top, t))
          .child(div().min_w(0).truncate().text_color(checkout ? t.muted : t.foreground).when(checkout, (el) => el.font_medium()).when(!checkout, (el) => el.font_semibold()).child(facts.label))
          .when(tag, (el) => el.child(div().flex_none().px(5).h(15).rounded(4).border(1).border_color(t.border).text_size(10).text_color(t.muted).flex().items_center().child("primary")))
          .child(div().flex_1())
          .when(groups.length > 0, (el) => el.child(this.foldToggle(foldKey.space(w.id), foldSummary(groups), t))),
      )
      .when(facts.line, (el) => el.child(div().pl(25).pr(4).min_w(0).child(this.gitLine(g, checkout, facts.label, t, !checkout, clash, w.id))));
  }

  // A space's agents, each hung off a line at rx.
  agentList(id, groups, t, rx) {
    const members = groups.flatMap((g) => g.members);
    return members.map((a, i) => this.agentWithKids(id, a, t, rx, i === members.length - 1));
  }

  agentWithKids(id, a, t, rx, last) {
    let subs = subtree(this.all, a.address);
    const work = this.work(a);
    const key = foldKey.kids(id, a.address);
    const open = !this.folded.has(key);
    const pa = rx + 15;
    const kx = pa + 7;
    const at = (a.status === "blocked" && this.reasons.get(a.address) ? 40 : 28) / 2;
    const row = this.agentRow(a, t, subs, key, pa, work.length, open);
    let kids = [];
    if (open) {
      // The line runs on past the last terminal and its own children into what Claude started itself.
      if (work.length) {
        const end = subs.reduce((m, s, i) => (s.lines.length === 1 ? i : m), -1);
        subs = subs.map((s, i) => (i < end ? s : i === end ? { ...s, lines: ["├"] } : { ...s, lines: ["│", ...s.lines.slice(1)] }));
      }
      kids = [...subs.map((s) => this.subRow(t, s, kx)), ...work.map((w, i) => this.workRow(t, w, i === work.length - 1 ? "└" : "├", kx))];
    }
    return v_flex().relative().flex_none().children([row, ...kids, ...this.guide(t, rx, last ? "└" : "├", at)]);
  }

  // What an agent started inside Claude Code: subagents, background commands and monitors, scheduled prompts.
  work(a) {
    const c = this.context[a.address];
    if (!c) return [];
    const subs = (c.subs ?? []).map((x) => ({ id: x.id, icon: SUBAGENT, size: 13, name: x.desc || x.type || "Subagent", at: x.start * 1000, tip: `Subagent${x.type ? ` · ${x.type}` : ""}` }));
    const kinds = { shell: [CPU, "Background command"], monitor: [CPU, "Monitor"], cron: [CLOCK, "Scheduled prompt"], wakeup: [CLOCK, "Wakes itself up"] };
    const tasks = (c.tasks ?? []).map((x) => ({
      id: x.id, icon: kinds[x.kind][0], size: 11, name: x.desc || kinds[x.kind][1], at: x.at * 1000, sched: x.sched, tip: `${kinds[x.kind][1]}${x.sched ? ` · ${x.sched}` : ""}`,
    }));
    return [...subs, ...tasks];
  }

  workRow(t, w, line, kx) {
    return h_flex()
      .id(`work-${w.id}`)
      .relative()
      .pl(kx + 17)
      .pr(8)
      .h(22)
      .flex_none()
      .items_center()
      .gap(7)
      .text_size(12)
      .tooltip(w.tip)
      .child(div().w(14).flex_none().flex().items_center().justify_center().child(svg(w.icon).size(w.size).flex_none().text_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(w.name))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(w.sched || duration(this.now - w.at)))
      .children(this.guide(t, kx, line, 11));
  }

  hasKids(g) {
    return Boolean(g && !g.linked && Object.values(this.git).some((o) => o?.linked && o.repo === g.repo));
  }

  agentRow(a, t, subs, key, pa, extra = 0, open = true) {
    const pic = icon(a.program, 16, t.foreground);
    const idle = a.status === "idle" && !a.focused;
    const kids = subs.map((s) => kidStatus(s.t, this.listed));
    const top = kids.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
    const reason = a.status === "blocked" ? this.reasons.get(a.address) : null;
    const name = div().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(this.agentNames.get(a.address));
    return h_flex()
      .id(`ag-${a.address}`)
      .relative()
      .pl(pa)
      .pr(8)
      .h(reason ? 40 : 28)
      .flex_none()
      .rounded(6)
      .items_center()
      .gap(8)
      .text_size(12.5)
      .when(a.focused, (el) => el.bg(t.selected))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => {
        if (!foldPressed(this.foldPressAt, Date.now())) run("pane.focus", { pane: a.pane });
      })
      .when(Boolean(pic), (el) => el.child(idle ? div().opacity(0.5).child(pic) : pic))
      .child(reason
        ? v_flex().flex_1().min_w(0).child(name).child(div().min_w(0).truncate().text_size(11).text_color(t.blocked).child(reason))
        : name.flex_1())
      .when(subs.length + extra > 0, (el) => el.child(this.foldToggle(key, { count: subs.length + extra, top }, t)))
      .child(this.contextTag(a, t))
      .child(this.status(t, a, true))
      .when(subs.length + extra > 0 && open, (el) => el.child(div().absolute().left(pa + 7).top((reason ? 40 : 28) / 2 + 9).bottom(0).w(1.5).bg(t.input)));
  }

  // A ring for how full the session's context is: yellow from 60%, red from 80%, the point to wrap up and start fresh.
  contextTag(a, t) {
    const c = this.context[a.address];
    const share = c ? contextShare(c.tokens, c.model, this.bigModels) : null;
    if (!share) return div().flex_none();
    const step = Math.min(100, Math.round(share.pct / 5) * 5);
    const color = share.first >= 80 ? t.ansi1 : share.first >= CONTEXT_WARN ? t.ansi3 : t.muted;
    const layer = (file, opacity) => div().absolute().top(0).left(0).size(14).opacity(opacity)
      .child(svg(`mods/space-agents/ring/${file}.svg`).size(14).text_color(color));
    const laps = Array.from({ length: share.laps }, () => layer("100", 0.4));
    const partial = share.laps === 0 ? Math.max(5, step) : step;
    return div().id(`ctx-${a.address}`).flex_none().relative().size(14)
      .tooltip(`${Math.round(c.tokens / 1000)}k tokens, ring fills at ${CONTEXT_LAP / 1000}k${share.laps ? `, lap ${share.laps + 1}` : ""}`)
      .child(svg("mods/space-agents/ring/track.svg").absolute().top(0).left(0).size(14).text_color(t.border))
      .children(laps)
      .when(partial > 0, (el) => el.child(layer(String(partial), 1)));
  }

  // Every agent waiting on you, oldest first, with what it's waiting on. A press goes to it; nothing here answers.
  inboxRows(entries, t) {
    if (!entries.length) return [];
    const head = h_flex().id("inbox-head").h(26).flex_none().px(8).gap(6).items_center().text_size(11).font_medium()
      .child(this.statusMark("blocked", t)).child(div().text_color(t.blocked).child("Needs you")).child(div().text_color(t.dim).child(String(entries.length)));
    const rows = entries.map((e) => {
      const a = e.agent;
      const name = a ? this.agentNames.get(a.address) : e.term.name || e.term.template || e.term.program?.name || e.address;
      const where = a?.space_name ?? (e.term.labels?.where ?? "").split(" / ")[0];
      const pic = icon(a?.program ?? e.term.program, 16, t.foreground);
      return h_flex().id(`inbox-${e.address}`).h(40).flex_none().pl(12).pr(8).gap(8).items_center().rounded(8)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click(() => this.focusEntry(e))
        .when(Boolean(pic), (el) => el.child(pic))
        .child(v_flex().flex_1().min_w(0)
          .child(h_flex().min_w(0).gap(6).child(div().min_w(0).truncate().text_color(t.foreground).child(name))
            .when(Boolean(where), (el) => el.child(div().flex_none().max_w(90).truncate().text_size(11).text_color(t.dim).child(where))))
          .child(div().min_w(0).truncate().text_size(11).text_color(t.blocked).child(e.reason ?? "needs you")))
        .when(e.at > 0, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(this.now - e.at))));
    });
    return [head, ...rows, div().h(1).mx(8).my(4).flex_none().bg(t.border)];
  }

  // Working, waiting on you and done across every space, and the chat's unseen rows when it has any.
  // `n`: fleetCounts, taken from the same tree and inbox the list draws.
  fleet(t, n) {
    const unseen = unseenCount(shared("chat.unseen"));
    // The same badges the rows use, most urgent first. A count of zero fades; waiting on you tints and goes to the oldest.
    const count = (key) => {
      const live = n[key] > 0;
      const alert = key === "blocked" && live;
      return h_flex().id(`fleet-${key}`).flex_none().h(22).gap(5).px(6).items_center().rounded(6).text_size(11.5).font_medium()
        .text_color(alert ? t.blocked : live ? t.foreground : t.dim)
        .opacity(live ? 1 : 0.5)
        .tooltip({ working: "working", blocked: "waiting on you: click to go to the oldest", done: "done" }[key])
        .when(alert, (el) => el.bg(t.blocked + "26").cursor_pointer().hover((s) => s.bg(t.blocked + "40")).on_click(() => this.jumpToOldest()))
        .child(this.statusMark(key, t, live))
        .child(String(n[key]));
    };
    return h_flex().flex_1().min_w(0).gap(2).items_center().justify_end()
      .child(count("blocked"))
      .child(count("done"))
      .child(count("working"))
      .when(unseen > 0, (el) => el.child(div().id("chat-unseen").flex_none().px(6).h(17).rounded(9).bg(t.accent).text_color(t.accent_foreground)
        .text_size(10.5).font_semibold().flex().items_center().tooltip("unseen in chat").child(String(unseen))));
  }

  // A terminal an agent started. `kx` is where its parent's line is; each deeper level sits LEVEL further in.
  subRow(t, s, kx) {
    const k = s.t;
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === this.shownAgent;
    return h_flex()
      .id(`sub-${k.address}`)
      .relative()
      .pl(kx + (s.lines.length - 1) * LEVEL + 17)
      .pr(8)
      .rounded(6)
      .h(26)
      .flex_none()
      .gap(7)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("terminal.peek", { terminal: k.address }))
      .when(Boolean(pic), (el) => el.child(div().w(14).flex_none().flex().items_center().justify_center().child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: kidStatus(k, this.listed) }, true))
      .children(s.lines.flatMap((l, n) => this.guide(t, kx + n * LEVEL, l, 13)));
  }

  // The badge for a status. Not compact: blocked says "Needs you" in words.
  status(t, a, compact = false) {
    if (a.status === "blocked" && !compact) return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
    return div().w(18).flex_none().flex().items_center().justify_center().child(this.statusMark(a.status, t));
  }

  // On the rail: a space's icon and number, which ctrl plus that number selects, and its agents below it,
  // whatever's folded, because a rail has no room for folds.
  compact({ w, i, tree: branch }, t, tree) {
    const groups = tree.get(w.id) ?? [];
    const tile = h_flex()
      .id(`space-${w.id}`)
      .h(28)
      .flex_none()
      .gap(5)
      .justify_center()
      .items_center()
      .rounded(6)
      .when(w.active, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(this.mark(branch ? BRANCH : SPARK, spaceActive(groups, this.all, this.listed), t))
      .child(div().text_size(11).text_color(w.active ? t.foreground : t.dim).child(String(i + 1)));
    const rows = groups.flatMap((g) => g.members).map((a) => this.compactAgent(a, t));
    return [tile, ...rows];
  }

  compactAgent(a, t) {
    const pic = icon(a.program, 14, t.foreground);
    return h_flex()
      .id(`ag-${a.address}`)
      .h(24)
      .flex_none()
      .gap(6)
      .items_center()
      .justify_center()
      .rounded(6)
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
  }

  // Agents no listed space holds, so none goes missing.
  noSpaceRows(t, collapsed, tree) {
    const groups = tree.get(NO_SPACE) ?? [];
    if (!groups.length) return [];
    if (collapsed) return groups.flatMap((g) => g.members).map((a) => this.compactAgent(a, t));
    return [div().px(8).pt(8).h(28).flex_none().text_size(11).text_color(t.dim).child("No space"), ...this.agentList(NO_SPACE, groups, t, RAIL_X)];
  }

  names(list) {
    const tabs = spaces().flatMap((s) => s.tabs);
    const all = panes();
    const labelOf = (a) => {
      const tab = tabs.find((tab) => tab.id === a.tab);
      return tab ? title(tab, lead(tab, all)) : a.title || a.program?.name || "";
    };
    const terms = new Map((this.all ?? []).map((k) => [k.address, k]));
    return agentNames(list, labelOf, (a) => telling(a.title, a.program) || a.program?.name || null, (a) => terminalName(terms.get(a.address)));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    // Space colors stay assigned because the space picker still draws them.
    const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
    const sp = spaces();
    const ids = new Set(sp.map((p) => p.id));
    const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
    let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
    for (const p of sp) {
      if (kept[p.id] || p.name === "~") continue;
      const uses = (c) => Object.values(kept).filter((v) => v === c).length;
      kept[p.id] = palette.reduce((best, c) => (uses(c) < uses(best) ? c : best));
      changed = true;
    }
    if (changed) setShared("space.colors", kept);

    const list = agents();
    this.now = Date.now();
    this.all = terminals();
    this.checkWorkers(this.now, this.all, list);
    this.spaceIds = sp.map((s) => s.id);
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    this.reasons = new Map(this.all.filter((k) => k.status === "blocked").map((k) => [k.address, blockedReason(k)]));
    this.shownAgent = focused()?.agent;
    this.track(list, this.now);
    this.held = nextHeld(list, this.held);
    this.agentNames = this.names(list);
    const tree = agentTree(list, sp, urgencyOf(list, this.all, this.held), (a) => this.since(a));
    const rows = this.ordered();
    setAgentOrder(displayOrder(rows.map((r) => r.w.id), tree));
    this.clashes = sharedEdits(rows.map((r) => ({ id: r.w.id, repo: r.g?.repo, top: r.g?.top, files: r.g?.files })));
    const waiting = collapsed ? [] : inbox(list, this.all, (a) => this.since(a));

    return v_flex().id("space-agents").size_full().min_h(0).bg(t.chrome).text_size(13)
      // A drag released outside a row, or outside the list, ends there.
      .on_hover((hovered, cx) => { if (!hovered) this.endDrag(cx); })
      .on_mouse_up("left", (_e, cx) => this.endDrag(cx))
      .on_mouse_down_out((_e, cx) => this.endDrag(cx))
      .child(h_flex().h(38).pl(16).pr(10).flex_none().items_center().justify_between().gap(6).text_size(12).font_medium().text_color(t.muted)
        .when(!collapsed, (el) => el.child(div().flex_none().child("Spaces")).child(this.fleet(t, fleetCounts(tree, waiting, this.all, this.listed))))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(6).hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .child(v_flex().id("space-list").flex_1().min_h(0).px(8).pb(14).overflow_y_scrollbar().mode("always")
        .children([...this.inboxRows(waiting, t), ...this.grouped(t, collapsed, rows, tree), ...this.noSpaceRows(t, collapsed, tree)]))
      .when(collapsed, (el) => el.child(h_flex().h(28).flex_none().items_center().justify_center()
        .child(div().id("collapse").text_size(13).text_color(t.dim).hover((s) => s.text_color(t.foreground)).on_click(toggleSidebar).child("»"))));
  }
}
