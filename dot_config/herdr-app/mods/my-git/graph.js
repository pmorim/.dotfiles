import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, watchFolder, theme, shared, setShared, run } from "herdr";
import { perform, abort, inProgress, lastMove, unpushed, commitDetails } from "./graphops.js";
import { icon } from "./shared.js";

const LIMIT = 300;
const ROW = 28, LANE = 12, MID = ROW / 2, MAX_LANES = 8;
const COLORS = ["ansi4", "ansi5", "ansi2", "ansi3", "ansi6", "ansi1", "ansi12", "ansi13", "ansi10", "ansi11"];
const FORMAT = "%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%cI%x1e";
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const UNCOMMITTED = "uncommitted", MORE = "more", SEEN = 12;
const KEPT = ["rows", "width", "output", "error", "repo", "root", "on", "head", "move", "name", "limit", "hasMore", "dirty"];
const isRefChange = (p) => /\/(HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|packed-refs)$|\/refs\//.test(p);
const inGitDir = (p) => p.includes("/.git/") || p.endsWith("/.git");
const STATUS_COLOR = { A: "ansi2", D: "ansi1", U: "ansi1", M: "blocked" };
const STATUS_ICON = { A: "file-plus", D: "file-minus", U: "file-diff", M: "file-pen" };

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());

function ago(iso) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 43200) return `${Math.floor(minutes / 1440)}d`;
  return `${Math.floor(minutes / 43200)}mo`;
}

// "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1" -> pills;
// a local branch and its remote twin on the same commit share one pill.
function refs(decoration) {
  const names = decoration.split(", ").filter((n) => n && n !== "refs/remotes/origin/HEAD");
  const remotes = new Set(names.map((n) => n.match(/^refs\/remotes\/[^/]+\/(.+)$/)?.[1]).filter(Boolean));
  const local = new Set(names.map((n) => n.replace(/^HEAD -> /, "")).filter((n) => n.startsWith("refs/heads/")).map((n) => n.slice(11)));
  return names.flatMap((n) => {
    if (n === "HEAD") return [{ name: "HEAD", kind: "head" }];
    if (n.startsWith("tag: ")) return [{ name: n.slice(15), kind: "tag" }];
    const head = n.startsWith("HEAD -> ");
    const branch = n.replace(/^HEAD -> /, "").match(/^refs\/heads\/(.+)$/)?.[1];
    if (branch) return [{ name: branch, kind: head ? "head" : "local", local: true, remote: remotes.has(branch) }];
    const remote = n.match(/^refs\/remotes\/[^/]+\/(.+)$/)?.[1];
    return remote && !local.has(remote) ? [{ name: remote, kind: "remote", remote: true }] : [];
  });
}

const WHERE = { local: "Local only", remote: "On origin only", both: "Local and on origin" };
const CHECKS = {
  success: { color: "ansi2", tip: "Checks passed" },
  failure: { color: "ansi1", tip: "Checks failed" },
  pending: { color: "ansi3", tip: "Checks running" },
};

// Each lane waits for one commit. A commit takes the lane waiting for it, its first parent
// keeps that lane, and other parents join the lane already waiting for them or open a new one.
function layout(commits) {
  let lanes = [], next = 0, width = 1;
  const free = () => { const i = lanes.findIndex((l) => !l); return i === -1 ? lanes.length : i; };
  const rows = commits.map((commit) => {
    const ops = [];
    let col = lanes.findIndex((l) => l?.hash === commit.hash), color;
    if (col === -1) { col = free(); color = commit.uncommitted ? -1 : next++; } else color = lanes[col].color < 0 ? next++ : lanes[col].color;
    lanes.forEach((l, j) => {
      if (!l) return;
      if (l.hash !== commit.hash) ops.push({ kind: "line", col: j, top: 0, height: ROW, color: l.color });
      else if (j === col) ops.push({ kind: "line", col: j, top: 0, height: MID, color: l.color });
      else ops.push({ kind: "in", from: j, to: col, color: l.color });
    });
    lanes = lanes.map((l) => (l?.hash === commit.hash ? null : l));
    const [first, ...rest] = commit.parents;
    if (first) {
      lanes[col] = { hash: first, color };
      ops.push({ kind: "line", col, top: MID, height: MID, color });
    }
    for (const parent of rest) {
      let k = lanes.findIndex((l) => l?.hash === parent);
      if (k === -1) { k = free(); lanes[k] = { hash: parent, color: next++ }; }
      ops.push({ kind: "out", from: col, to: k, color: lanes[k].color });
    }
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
    width = Math.max(width, lanes.length, col + 1);
    return { ...commit, col, color, ops };
  });
  return { rows, width };
}

function githubUrl(remote) {
  const match = remote.trim().match(/github\.com[:/](.+?)(\.git)?$/);
  return match ? `https://github.com/${match[1]}` : null;
}

export class GraphTab {
  init(cx) {
    this.rows = []; this.width = 1; this.limit = LIMIT; this.dirty = 0;
    this.seen = new Map(); this.watchToken = 0; this.loadSeq = 0;
    this.input = InputState.new({ placeholder: "" });
    this.input.on("submit", (_e, cx) => this.submitInput(cx));
    this.refresh(cx);
    cx.timer.every(15000, (cx) => this.refresh(cx));
  }

  refresh(cx, force) {
    const { cwd, on } = location(), context = key();
    if (context !== this.context) this.enter(context);
    else if (this.loading) { this.again = true; return; }
    if (!cwd) return;
    const id = ++this.loadSeq, stale = () => this.loadSeq !== id || key() !== context;
    this.loading = true;
    if (force) cx.notify();
    cx.spawn(async (cx) => {
      try {
        const git = (args) => exec("git", [...READ, ...args], { cwd, on });
        const top = await git(["rev-parse", "--show-toplevel"]);
        if (stale()) return;
        if (top.code !== 0) { this.error = "Not a git repository"; this.rows = []; return; }
        const root = top.stdout.trim();
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        if (head.code !== 0) { this.error = "No commits yet"; this.rows = []; this.output = null; return; }
        const [pending, ahead, move, status] = await Promise.all([inProgress(root, on), unpushed(root, on), lastMove(root, on), git(["status", "--porcelain", "--untracked-files=normal"])]);
        if (stale()) return;
        this.root = root; this.on = on; this.head = head.stdout.trim(); this.move = move;
        this.dirty = status.code === 0 ? status.stdout.split("\n").filter(Boolean).length : 0;
        if (!on) this.watch(root, cx);
        if (pending && !this.fail) this.fail = { message: `${pending} in progress`, pending };
        if (!pending && this.fail?.pending && !this.busy) this.fail = null;
        const remote = await git(["remote", "get-url", "origin"]);
        const repo = remote.code === 0 ? githubUrl(remote.stdout) : null;
        const log = await git(["log", "HEAD", ...(await this.sinceTrunk(git)), "--decorate=full", "--topo-order", `--max-count=${this.limit + 1}`, `--format=${FORMAT}`]);
        if (log.code !== 0) throw new Error(log.stderr.trim());
        const signature = `${log.stdout}${[...ahead]}${this.head}${this.dirty}`;
        if (stale() || signature === this.output) return;
        const all = log.stdout.split("\x1e").map((r) => r.trim()).filter(Boolean);
        this.hasMore = all.length > this.limit;
        const commits = all.slice(0, this.limit).map((r) => {
          const [hash, parents, decoration, subject, author, date] = r.split("\x1f");
          return { hash, parents: parents ? parents.split(" ") : [], refs: refs(decoration), subject, author, date, head: hash === this.head, ahead: ahead.has(hash) };
        });
        if (this.dirty > 0) commits.unshift({ hash: UNCOMMITTED, uncommitted: true, parents: [this.head], refs: [], subject: "", date: null });
        Object.assign(this, layout(commits));
        this.output = signature; this.name = root.split("/").pop();
        this.repo = repo;
        this.error = null;
        if (this.selected && !commits.some((c) => c.hash === this.selected)) { this.selected = null; this.details = null; setShared("git.commit.files", []); }
      } catch (e) { if (!stale()) this.error = e.message ?? String(e); }
      finally {
        if (this.loadSeq === id) {
          this.loading = false; cx.notify();
          if (this.again) { this.again = false; this.refresh(cx); }
        }
      }
    });
  }

  // Leaving a folder keeps what it showed, so coming back is instant while refresh reads it again.
  enter(context) {
    if (this.context && this.rows.length) {
      this.seen.delete(this.context);
      this.seen.set(this.context, Object.fromEntries(KEPT.map((k) => [k, this[k]])));
      if (this.seen.size > SEEN) this.seen.delete(this.seen.keys().next().value);
    }
    this.context = context; this.watchToken++; this.watching = null;
    Object.assign(this, { rows: [], width: 1, output: null, error: null, repo: null, root: null, hasMore: false, limit: LIMIT, dirty: 0, moreAsked: null,
      selected: null, details: null, menu: null, fail: null, again: false }, this.seen.get(context));
    setShared("git.commit.files", []);
  }

  // Ref moves reload the history; other edits only the uncommitted row. At most every 1.5 s.
  watch(root, cx) {
    if (this.watching === root) return;
    this.watching = root;
    const token = this.watchToken;
    const loop = (dir, gitDir) => cx.spawn(async (cx) => {
      try {
        while (token === this.watchToken) {
          const paths = (await watchFolder(dir)).map((p) => p.replace(/\\/g, "/"));
          if (token !== this.watchToken) return;
          if (paths.some((p) => (gitDir || inGitDir(p)) ? isRefChange(p) : true)) this.soon(cx);
        }
      } catch { if (token === this.watchToken) this.watching = null; }
    });
    loop(root, false);
    // A linked worktree keeps its refs in the main checkout's .git.
    cx.spawn(async (cx) => {
      const common = (await exec("git", [...READ, "rev-parse", "--git-common-dir"], { cwd: root })).stdout.trim();
      const dir = /^([a-zA-Z]:)?[\\/]/.test(common) ? common : `${root}/${common}`;
      if (token === this.watchToken && !dir.startsWith(`${root}/`)) loop(dir, true);
    });
  }

  soon(cx) {
    if (this.soonTimer) return;
    this.soonTimer = true;
    cx.timer.after(Math.max(0, 1500 - (Date.now() - (this.lastSoon ?? 0))), (cx) => {
      this.soonTimer = false; this.lastSoon = Date.now(); this.refresh(cx);
    });
  }

  loadMore(cx) { this.limit += LIMIT; this.refresh(cx); cx.notify(); }

  // The commits between HEAD and where it left the default branch, and that fork commit itself.
  // On the default branch there is no path, so it shows the latest commits.
  async sinceTrunk(git) {
    const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
    const origin = (await git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).stdout.trim();
    for (const ref of [origin, "origin/main", "origin/master", "main", "master"].filter(Boolean)) {
      const merge = await git(["merge-base", "HEAD", ref]);
      const fork = merge.stdout.trim();
      if (merge.code === 0) return fork === head ? [] : ["--not", `${fork}^@`];
    }
    return [];
  }

  lanes(row, t) {
    const x = (j) => j * LANE + LANE / 2, color = (c) => (c < 0 ? t.dim : t[COLORS[c % COLORS.length]]);
    const head = row.head || row.uncommitted;
    return div().relative().flex_none().w(Math.min(this.width, MAX_LANES) * LANE + 4).h(ROW).overflow_hidden()
      .children(row.ops.map((op) => {
        if (op.kind === "line") return div().absolute().left(x(op.col) - 1).top(op.top).w(2).h(op.height).bg(color(op.color));
        const [a, b] = op.kind === "out" ? [op.from, op.to] : [op.to, op.from];
        const right = b > a, elbow = div().absolute().left(x(Math.min(a, b)) - 1).w(Math.abs(x(b) - x(a)) + 2).h(MID + 1).border_color(color(op.color));
        if (op.kind === "out") return right ? elbow.top(MID - 1).border_t(2).border_r(2).rounded_tr(6) : elbow.top(MID - 1).border_t(2).border_l(2).rounded_tl(6);
        return right ? elbow.top(0).border_b(2).border_r(2).rounded_br(6) : elbow.top(0).border_b(2).border_l(2).rounded_bl(6);
      }))
      .child(head
        ? div().absolute().left(x(row.col) - 5).top(MID - 5).size(10).rounded(5).bg(t.background).border_2().border_color(color(row.color))
        : div().absolute().left(x(row.col) - 4).top(MID - 4).size(8).rounded(4).bg(color(row.color)));
  }

  pill(ref, c, t, id) {
    if (ref.kind === "tag") return div().flex_none().max_w(150).truncate().px(6).rounded(9).border_1().border_color(`${c}88`).bg(`${c}2e`).text_size(11).text_color(c).child(`# ${ref.name}`);
    const head = ref.kind === "head", fg = head ? t.background : ref.kind === "remote" ? t.muted : c;
    const pill = h_flex().id(id).flex_none().max_w(170).gap(3).items_center().px(6).rounded(9).text_size(11)
      .tooltip(WHERE[ref.local && ref.remote ? "both" : ref.local ? "local" : "remote"]);
    return (head ? pill.bg(c).font_semibold() : pill.border_1().border_color(ref.kind === "remote" ? t.border : `${c}88`).bg(ref.kind === "remote" ? t.background : `${c}2e`))
      .when(Boolean(ref.local), (e) => e.child(svg("mods/my-git/local.svg").flex_none().size(10).text_color(fg)))
      .when(Boolean(ref.remote), (e) => e.child(svg("mods/my-git/cloud.svg").flex_none().size(10).text_color(fg)))
      .child(div().min_w(0).truncate().text_color(fg).child(ref.name))
      .when(Boolean(ref.pr), (e) => e.child(div().flex_none().font_semibold().text_color(fg).child(`#${ref.pr?.number}`)));
  }

  // A branch's PR and CI come from the PRs panel.
  pr(ref) {
    const name = this.repo?.split("/").pop();
    return ref.kind === "tag" ? null : (shared("pulls.branches") ?? []).find((b) => b.repo === name && b.branch === ref.name && b.number);
  }

  row(row, t) {
    if (row.uncommitted) {
      return h_flex().h(ROW).w_full().pr(10).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .child(this.lanes(row, t))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(`Uncommitted changes (${this.dirty})`));
    }
    const c = t[COLORS[row.color % COLORS.length]], shown = row.refs.slice(0, 2), ci = shared("pulls.checks")?.[row.hash];
    return h_flex().h(ROW).w_full().pr(10).gap(6).items_center().cursor_pointer()
      .when(row.head, (e) => e.bg(`${c}14`))
      .when(this.selected === row.hash, (e) => e.bg(t.selected))
      .hover((s) => s.bg(this.selected === row.hash ? t.selected : t.hover))
      .child(this.lanes(row, t))
      .children(shown.map((ref) => this.pill({ ...ref, pr: this.pr(ref) }, c, t, `ref-${row.hash}-${ref.name}`)))
      .when(row.refs.length > shown.length, (e) => e.child(div().flex_none().text_size(11).text_color(t.dim).child(`+${row.refs.length - shown.length}`)))
      .when(Boolean(CHECKS[ci]), (e) => e.child(div().id(`ci-${row.hash}`).flex_none().tooltip(CHECKS[ci].tip)
        .child(svg(`mods/pulls/ci-${ci}.svg`).size(12).text_color(t[CHECKS[ci].color]))))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(row.parents.length > 1 ? t.muted : t.foreground).when(row.head, (e) => e.font_semibold()).child(row.subject))
      .when(row.ahead, (e) => e.child(svg("mods/my-git/arrow-up.svg").flex_none().size(11).text_color(t.accent)))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(row.date)));
  }

  select(hash, cx) {
    this.menu = null;
    if (this.selected === hash) { this.selected = null; this.details = null; setShared("git.commit.files", []); cx.notify(); return; }
    this.selected = hash; this.details = null; this.detailError = null;
    setShared("git.commit.files", []);
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      try {
        const details = await commitDetails(root, on, hash);
        if (this.selected === hash && this.context === context) {
          this.details = details;
          setShared("git.commit.files", details.files.map((f) => ({ path: f.path, status: f.status, add: f.add, del: f.del })));
        }
      } catch (e) { if (this.selected === hash) this.detailError = e.message ?? String(e); }
      cx.notify();
    });
    cx.notify();
  }

  open(file, cx) {
    const sha = this.selected;
    setShared("git.selection", { root: this.root, on: this.on, path: file.path, status: file.status, fresh: false, scope: "commit", base: this.details?.base ?? `${sha}^`, head: sha, label: sha.slice(0, 7) });
    const tabs = spaces().find((x) => x.active)?.tabs ?? [], existing = panes().find((p) => p.mod === "git" && tabs.some((x) => x.id === p.tab));
    if (existing) run("tab.select", { id: existing.tab });
    else run("tab.new", { name: "Diff", mod: "my-git", props: { view: "review" } });
    cx.notify();
  }

  go(action, sha, input, cx) {
    if (this.busy) return;
    const root = this.root, on = this.on;
    this.busy = true; this.menu = null; this.fail = null;
    cx.spawn(async (cx) => {
      try {
        const result = await perform(root, on, action, sha, input);
        if (!result.ok) this.fail = { message: result.message, pending: result.pending };
      } catch (e) { this.fail = { message: e.message ?? String(e) }; }
      finally {
        this.busy = false; this.output = null;
        if (this.loading) this.again = true; else this.refresh(cx);
        cx.notify();
      }
    });
    cx.notify();
  }

  abortPending(cx) {
    const kind = this.fail?.pending, root = this.root, on = this.on;
    cx.spawn(async (cx) => {
      const result = await abort(root, on, kind);
      this.fail = result.ok ? null : { message: result.message, pending: kind };
      this.output = null; this.refresh(cx); cx.notify();
    });
  }

  submitInput(cx) {
    const value = this.input.value().trim();
    if (this.menu?.mode !== "input" || !value || value.startsWith("-")) return;
    this.go(this.menu.action, this.menu.sha, value, cx);
  }

  choose(item, sha, cx) {
    if (item.action === "copy") {
      exec("sh", ["-c", 'printf %s "$1" | pbcopy', "sh", sha]);
      this.menu = null;
    } else if (item.action === "hard") this.menu = { sha, mode: "confirm", action: "hard" };
    else if (item.action === "reword") {
      this.menu = { sha, mode: "input", action: item.action };
      this.input.set_value(this.rows.find((r) => r.hash === sha)?.subject ?? "");
      this.focusInput = true;
    } else return this.go(item.action, sha, item.arg ?? null, cx);
    cx.notify();
  }

  items(sha) {
    return [
      { label: "Copy SHA", action: "copy" },
      { label: "Cherry-pick", action: "pick" },
      { label: "Revert", action: "revert" },
      { label: "Reset soft to here", action: "soft" },
      { label: "Reset mixed to here", action: "mixed" },
      { label: "Reset hard to here", action: "hard", danger: true },
      ...(sha === this.head ? [{ label: "Reword", action: "reword" }] : []),
      ...(this.rows.find((r) => r.hash === sha)?.refs ?? []).filter((r) => r.kind === "local" || r.kind === "remote")
        .flatMap((r) => [{ label: `Checkout ${r.name}`, action: "checkout", arg: r.name }, ...(r.local ? [{ label: `Delete ${r.name}`, action: "delete", arg: r.name, danger: true }] : [])]),
    ];
  }

  button(id, label, bg, fg, onClick, t) {
    return div().id(id).h(26).px(10).flex().items_center().rounded(6).border_1().border_color(bg === t.raised ? t.input : bg).bg(bg).text_color(fg).text_size(12).cursor_pointer().hover((s) => s.opacity(0.88)).on_click(onClick).child(label);
  }

  menuCard(t) {
    const { sha, mode } = this.menu, short = sha.slice(0, 7);
    const card = v_flex().id("graph-menu").absolute().top(34).right(8).w(230).p(6).gap(2).rounded(8).border_1().border_color(t.border).bg(t.popover).shadow_md().text_size(12)
      .on_mouse_down_out((_e, cx) => { this.menu = null; cx.notify(); });
    if (mode === "menu") {
      return card.child(div().px(8).py(3).text_size(11).text_color(t.dim).child(short))
        .children(this.items(sha).map((item) => h_flex().id(`gm-${item.action}-${item.arg ?? ""}`).h(26).px(8).items_center().rounded(5).cursor_pointer()
          .text_color(item.danger ? t.ansi1 : t.foreground).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.choose(item, sha, cx)).child(div().min_w(0).truncate().child(item.label))));
    }
    if (mode === "confirm") {
      return card.p(10).gap(8).child(div().text_color(t.foreground).child(`Hard reset to ${short}? Uncommitted changes are lost.`))
        .child(h_flex().justify_end().gap(6)
          .child(this.button("gm-no", "Cancel", t.raised, t.foreground, (_e, cx) => { this.menu = null; cx.notify(); }, t))
          .child(this.button("gm-yes", "Reset", t.ansi1, t.background, (_e, cx) => this.go("hard", sha, null, cx), t)));
    }
    if (mode === "undo") {
      const clean = this.move?.clean;
      return card.p(10).gap(8).w(260).child(div().text_color(t.foreground).child(`Undo: ${this.move?.label}`))
        .when(!clean, (e) => e.child(div().text_size(11).text_color(t.ansi1).child("Working tree has uncommitted changes. Commit or stash them first.")))
        .child(h_flex().justify_end().gap(6)
          .child(this.button("gm-no", clean ? "Cancel" : "Close", t.raised, t.foreground, (_e, cx) => { this.menu = null; cx.notify(); }, t))
          .when(clean, (e) => e.child(this.button("gm-yes", "Undo", t.ansi1, t.background, (_e, cx) => this.go("undo", sha, null, cx), t))));
    }
    return card.p(10).gap(8).child(div().text_color(t.foreground).child(`New message (${short})`))
      .child(div().id("gm-input").h(30).px(8).flex().items_center().rounded(6).border_1().border_color(t.accent).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.input).h_full().w_full().text_size(12).text_color(t.foreground)))
      .child(h_flex().justify_end().gap(6)
        .child(this.button("gm-no", "Cancel", t.raised, t.foreground, (_e, cx) => { this.menu = null; cx.notify(); }, t))
        .child(this.button("gm-yes", "OK", t.solid, t.solid_foreground, (_e, cx) => this.submitInput(cx), t)));
  }

  fileTree() {
    const rows = []; let dir = null;
    for (const f of this.details?.files ?? []) {
      const at = f.path.lastIndexOf("/"), parent = at === -1 ? "" : f.path.slice(0, at);
      if (parent !== dir) { dir = parent; if (parent) rows.push({ dir: parent }); }
      rows.push({ file: f, name: f.path.slice(at + 1), indented: Boolean(parent) });
    }
    return rows;
  }

  fileRow(r, t) {
    if (r.dir) return h_flex().h(22).flex_none().px(6).gap(5).items_center().text_size(11).text_color(t.dim)
      .child(icon("folder", 12, t.dim)).child(div().min_w(0).truncate().child(r.dir));
    const f = r.file, color = t[STATUS_COLOR[f.status] ?? "blocked"];
    return h_flex().id(`cf-${f.path}`).h(24).flex_none().pl(r.indented ? 22 : 6).pr(6).gap(6).items_center().rounded(5).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.open(f, cx))
      .child(icon(STATUS_ICON[f.status] ?? "file-pen", 13, color))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(r.name))
      .child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${f.add}`))
      .child(div().flex_none().text_size(11).text_color(t.ansi1).child(`\u2212${f.del}`));
  }

  detailPanel(t) {
    const d = this.details, row = this.rows.find((r) => r.hash === this.selected) ?? this.rows[0];
    const message = d?.message ?? row.subject;
    return v_flex().flex_none().border_t(1).border_color(t.border)
      .child(h_flex().flex_none().h(30).px(10).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${row.hash.slice(0, 7)}${d ? `  ${d.author}  ${d.date.slice(0, 10)}` : ""}${d?.merge ? "  (merge, vs first parent)" : ""}`))
        .when(Boolean(this.repo), (e) => e.child(div().id("detail-github").px(5).py(2).rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).text_size(11).text_color(t.muted)
          .on_click(() => exec("open", [`${this.repo}/commit/${row.hash}`])).child("GitHub")))
        .child(div().id("detail-menu").p(4).rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("More actions")
          .on_click((_e, cx) => { this.menu = { sha: row.hash, mode: "menu" }; cx.notify(); }).child(div().text_size(12).text_color(t.muted).child("\u2026")))
        .child(div().id("detail-close").p(4).rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Close").on_click((_e, cx) => this.select(row.hash, cx)).child(icon("x", 12, t.muted))))
      .child(v_flex().id("detail-body").max_h(250).overflow_y_scrollbar().px(10).pb(8).gap(6)
        .child(div().text_size(12).text_color(t.foreground).max_h(110).overflow_hidden().child(message.length > 800 ? `${message.slice(0, 800)}...` : message))
        .when(Boolean(this.detailError), (e) => e.child(div().text_size(11).text_color(t.ansi1).child(this.detailError)))
        .when(!d && !this.detailError, (e) => e.child(div().text_size(11).text_color(t.dim).child("Loading files...")))
        .when(d?.files.length === 0, (e) => e.child(div().text_size(11).text_color(t.dim).child("No file changes")))
        .child(v_flex().gap(1).children(this.fileTree().map((r) => this.fileRow(r, t)))));
  }

  topBar(t) {
    const move = this.move, pending = this.fail?.pending;
    return v_flex().flex_none()
      .when(Boolean(move?.canUndo), (e) => e.child(h_flex().id("graph-undo").h(26).px(10).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.menu = { sha: this.head, mode: "undo" }; cx.notify(); })
        .child(icon("undo", 12, t.muted))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(`Undo: ${move.label}`))))
      .when(Boolean(this.fail), (e) => e.child(h_flex().id("graph-fail").min_h(26).px(10).gap(6).items_center().bg(`${t.ansi1}1f`).tooltip(this.fail.message)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.ansi1).child(this.fail.message.split("\n").filter(Boolean)[0] ?? ""))
        .when(Boolean(pending), (e) => e.child(this.button("fail-abort", "Abort", t.raised, t.foreground, (_e, cx) => this.abortPending(cx), t)))
        .child(div().id("fail-x").p(4).rounded(5).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Close").on_click((_e, cx) => { this.fail = null; cx.notify(); }).child(icon("x", 11, t.ansi1)))));
  }

  body(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme();
    if (this.focusInput && this.menu?.mode === "input") { this.focusInput = false; this.input.focus(); }
    const empty = this.error || (this.loading ? "Loading commits..." : "No folder for this space");
    return this.rows.length
      ? v_flex().flex_1().min_h(0).relative()
        .child(this.topBar(t))
        .child(div().flex_1().min_h(0).relative().pt(4).pl(8).pr(4)
          .child(div().size_full().child(v_virtual_list("graph-list", this.rows.length + (this.hasMore ? 1 : 0), ROW, (i) => this.rows[i]?.hash ?? MORE,
            (range, cx) => {
              if (range.end > this.rows.length && this.hasMore && !this.loading && this.moreAsked !== this.limit) {
                this.moreAsked = this.limit;
                cx.spawn(async (cx) => this.loadMore(cx));
              }
              return Array.from({ length: range.end - range.start }, (_x, k) => range.start + k).map((i) => i < this.rows.length
                ? this.row(this.rows[i], t)
                : div().id("graph-more").h(ROW).flex_none().px(10).flex().items_center().text_size(12).text_color(t.accent).child(this.loading ? "Loading more commits..." : "Load more commits"));
            }).size_full()
            .on_item_click((hash, cx) => (hash === UNCOMMITTED ? this.showChanges?.(cx) : hash === MORE ? this.loadMore(cx) : this.select(hash, cx)))
            .on_item_secondary_click((hash, _e, cx) => { if (hash !== UNCOMMITTED && hash !== MORE) { this.menu = { sha: hash, mode: "menu" }; cx.notify(); } })))
          .child(Scrollbar.vertical("graph-list").viewport_from_layout().absolute().inset_0()))
        .when(Boolean(this.selected), (e) => e.child(this.detailPanel(t)))
        .when(Boolean(this.menu), (e) => e.child(this.menuCard(t)))
      : div().p(14).text_color(this.error ? t.ansi1 : t.dim).child(empty);
  }
}
