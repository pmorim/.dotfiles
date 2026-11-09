import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, exec, watchFolder, theme, shared, setShared, run, props } from "herdr";
import { GraphTab } from "./graph.js";
import { location, key, resolveBase, onDefaultBranch, listFiles, listSplit } from "./diff.js";
import { ReviewTab } from "./review.js";
import { StatusStrip } from "./status.js";
import { buildRows, compact } from "./tree.js";
import { icon } from "./shared.js";
import { fetchThreads } from "./threads.js";
import { Stashes } from "./stash.js";
import { menuBody, openInEditor } from "./menu.js";
import * as ops from "./ops.js";

const STATUS_COLOR = { A: "ansi2", D: "ansi1", U: "ansi3", M: "blocked" };
const SPINNER = "mods/workspace-chrome/spinner.svg";
const sum = (list, k) => list.reduce((n, f) => n + f[k], 0);

export default class Git extends View {
  init(_props, cx) {
    if (props()?.view === "review") { this.review = new ReviewTab(); return this.review.init(cx); }
    const savedTab = localStorage.getItem("git.tab");
    this.tab = savedTab === "graph" || savedTab === "stash" ? savedTab : "changes";
    this.scope = shared("git.scope") === "branch" ? "branch" : "worktree";
    this.files = []; this.staged = []; this.unstaged = []; this.conflicts = []; this.totals = null; this.menu = null; this.filter = ""; this.filterOpen = false;
    this.stashes = new Stashes(this);
    this.filterInput = InputState.new({ placeholder: "Filter files" });
    this.filterInput.on("change", (_e, cx) => { this.filter = this.filterInput.value(); cx.notify(); });
    this.collapsed = new Set(); this.sectionClosed = new Set(); this.message = ""; this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx));
    this.filterInput.on("focus", (_e, cx) => { this.filterTyping = true; cx.notify(); });
    this.filterInput.on("blur", (_e, cx) => { this.filterTyping = false; cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.status = new StatusStrip();
    this.status.init(cx, (cx) => { this.refresh(cx); this.graph.refresh?.(cx); });
    this.graph = new GraphTab();
    this.graph.init(cx);
    this.graph.showChanges = (cx) => this.showChanges("worktree", cx);
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    cx.timer.every(120000, (cx) => { if (Date.now() - (this.lastRender ?? 0) < 30000) cx.spawn((cx) => this.status.quietFetch(cx)); });
  }

  render(cx) {
    this.lastRender = Date.now();
    return this.review ? this.review.body(cx) : this.renderPanel(cx);
  }

  tabPreview(name) {
    const o = this.totals;
    if (!o) return null;
    if (name === "worktree") {
      if (o.conflicts > 0) return { kind: "alert", n: o.conflicts, tone: "ansi1", tip: `${o.conflicts} ${o.conflicts === 1 ? "file" : "files"} with conflicts` };
      const { add, del } = o.worktree;
      if (add === 0 && del === 0) return null;
      return { kind: "churn", add, del, staged: o.staged > 0, tip: `+${add} -${del} uncommitted${o.staged > 0 ? `, ${o.staged} staged` : ""}` };
    }
    if (name === "branch") {
      if (o.threads > 0) return { kind: "alert", n: o.threads, tone: "ansi3", tip: `${o.threads} unresolved review ${o.threads === 1 ? "thread" : "threads"}` };
      return o.branch.files > 0 ? { kind: "count", n: o.branch.files, tip: `${o.branch.files} ${o.branch.files === 1 ? "file" : "files"} changed vs base` } : null;
    }
    if (name === "stash") return this.stashes.list.length > 0 ? { kind: "count", n: this.stashes.list.length, tip: `${this.stashes.list.length} stashed` } : null;
    return null;
  }

  previewView(p, t) {
    if (this.showCounts) {
      if (p.kind === "churn") {
        return h_flex().flex_none().gap(4).items_center().text_size(10)
          .child(div().text_color(t.ansi2).child(`+${compact(p.add)}`))
          .child(div().text_color(t.ansi1).child(`\u2212${compact(p.del)}`))
          .when(p.staged, (e) => e.child(div().size(5).rounded(3).bg(t.accent)));
      }
      const alert = p.kind === "alert";
      return div().flex_none().min_w(18).px(5).rounded(9).text_size(10).text_center().bg(alert ? t[p.tone] : t.raised).text_color(alert ? t.solid_foreground : t.muted).child(String(p.n));
    }
    if (p.kind === "count") return null;
    return div().flex_none().size(6).rounded(3).bg(p.kind === "alert" ? t[p.tone] : t.accent);
  }

  tabButton(id, label, tip, on, t, glyph, action, preview) {
    const view = !on && preview ? this.previewView(preview, t) : null;
    return h_flex().id(id).tooltip(preview && !on ? `${tip}. ${preview.tip}` : tip).flex_1().min_w(0).h(30).gap(6).items_center().justify_center().rounded(7).text_size(12).cursor_pointer()
      .bg(on ? t.selected : t.background).text_color(on ? t.foreground : t.muted).hover((s) => s.bg(on ? t.selected : t.hover)).on_click(action)
      .child(icon(glyph, 13, on ? t.foreground : t.dim)).child(div().min_w(0).truncate().child(label))
      .when(Boolean(view), (e) => e.child(view));
  }

  showTab(tab, cx) {
    this.tab = tab; localStorage.setItem("git.tab", tab); cx.notify();
  }

  showChanges(scope, cx) {
    this.tab = "changes"; localStorage.setItem("git.tab", "changes");
    this.setScope(scope, cx);
    cx.notify();
  }

  rowsFor(list, section, all) {
    return buildRows(list, { flat: section === "conflicts", collapsed: this.collapsed, section, all });
  }

  collapseAll(cx) {
    for (const [section, list] of this.sections()) for (const r of this.rowsFor(list, section, true)) if (r.dir) this.collapsed.add(r.key);
    cx.notify();
  }

  visible(list) {
    const q = this.filter.trim().toLowerCase();
    return q ? list.filter((f) => f.path.toLowerCase().includes(q)) : list;
  }

  sections() {
    if (this.scope !== "worktree") return [["all", this.visible(this.files)]];
    return [["conflicts", this.visible(this.conflicts)], ["staged", this.visible(this.staged)], ["unstaged", this.visible(this.unstaged)]];
  }

  toggleFilter(cx) {
    if (this.filterOpen) { this.closeFilter(cx); return; }
    this.filterOpen = true; cx.notify();
  }

  closeFilter(cx) {
    this.filterOpen = false; this.filter = ""; this.filterInput.set_value(""); this.handle.focus(); cx.notify();
  }

  hoverable(el, id) {
    return el.on_hover((h, cx) => {
      const next = h ? id : this.hover === id ? null : this.hover;
      if (next !== this.hover) { this.hover = next; cx.notify(); }
    });
  }

  iconButton(id, glyph, tip, t, action, color) {
    return div().id(id).tooltip(tip).flex_none().p(4).rounded(5).cursor_pointer().hover((s) => s.bg(t.raised))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(icon(glyph, 13, color ?? t.muted));
  }

  // ---- writes ----

  act(fn, cx) {
    if (this.busy || !this.root) return;
    const { root, on } = this;
    this.busy = true; this.note = null; cx.notify();
    cx.spawn(async (cx) => {
      try { await fn(root, on); }
      catch (e) { this.note = String(e.message ?? e); }
      finally { this.busy = false; this.refresh(cx); cx.notify(); }
    });
  }

  stagePaths(files, cx) { this.act((r, o) => ops.stage(r, o, files.map((f) => f.path)), cx); }
  unstagePaths(files, cx) { this.act((r, o) => ops.unstage(r, o, files.map((f) => f.path), this.hasHead), cx); }
  askDiscard(files, cx) { this.confirm = files; cx.notify(); }

  doDiscard(cx) {
    const files = this.confirm; this.confirm = null;
    this.act((r, o) => ops.discard(r, o, files), cx);
  }

  setAmend(on, cx) {
    this.amend = on;
    if (!on) { this.message = ""; this.input.set_value(""); cx.notify(); return; }
    cx.spawn(async (cx) => {
      try {
        const text = await ops.headMessage(this.root, this.on);
        this.message = text; this.input.set_value(text);
      } catch (e) { this.note = String(e.message ?? e); this.amend = false; }
      cx.notify();
    });
    cx.notify();
  }

  canCommit() {
    return Boolean(this.message.trim() && this.root && !this.busy && !this.loading && this.scope === "worktree" && (this.staged.length > 0 || this.amend));
  }

  commit(cx) {
    if (!this.canCommit() || this.ctx !== this.context()) return;
    const message = this.message.trim(), amend = this.amend;
    this.act(async (r, o) => {
      await ops.commit(r, o, message, amend);
      this.amend = false; this.message = ""; this.input.set_value("");
    }, cx);
  }

  stash(cx) {
    const message = this.message.trim();
    this.act(async (r, o) => { await ops.stash(r, o, message); this.message = ""; this.input.set_value(""); }, cx);
  }

  // ---- rows ----

  dirRow(r, t, section, actions) {
    const closed = this.collapsed.has(r.key), id = `dir-${r.key}`, hot = this.hover === id;
    return this.hoverable(h_flex().id(id).h(26).flex_none().pl(6 + r.depth * 14).pr(8).gap(4).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { if (closed) this.collapsed.delete(r.key); else this.collapsed.add(r.key); cx.notify(); })
      .child(icon(closed ? "chevron-right" : "chevron-down", 12, t.dim))
      .child(icon(closed ? "folder" : "folder-open", 14, t.muted))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(r.label))
      .when(hot && actions, (e) => e.child(h_flex().flex_none().children(actions(r.files, true))))
      .when(!hot || !actions, (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child(String(r.count)))), id);
  }

  fileActions(section, t) {
    const noun = (dir) => (dir ? "folder" : "file");
    if (section === "staged") return (fs, dir) => [this.iconButton(`u-${fs[0].path}`, "minus", `Unstage ${noun(dir)}`, t, (cx) => this.unstagePaths(fs, cx))];
    if (section === "conflicts") return (fs) => [this.iconButton(`o-${fs[0].path}`, "file-pen", "Open in editor", t, (cx) => cx.spawn(async (cx) => { await openInEditor(this, fs[0]); cx.notify(); }))];
    if (section === "unstaged") return (fs, dir) => [
      this.iconButton(`d-${fs[0].path}`, "undo", dir ? "Discard folder changes" : "Discard changes", t, (cx) => this.askDiscard(fs, cx)),
      this.iconButton(`s-${fs[0].path}`, "plus", `Stage ${noun(dir)}`, t, (cx) => this.stagePaths(fs, cx)),
    ];
    return null;
  }

  isOpen(f, section) {
    const sel = shared("git.selection");
    if (!sel || section.startsWith("stash:") || sel.root !== this.root || sel.scope !== this.scope || sel.path !== f.path) return false;
    return this.scope !== "worktree" || section === sel.section || (section === "conflicts" && sel.section === "unstaged");
  }

  fileRow(f, t, depth, section, actions) {
    const id = `change-${section}-${f.path}`, menuable = !section.startsWith("stash:"), hot = this.hover === id && (actions || menuable), open = this.isOpen(f, section);
    const mark = f.status === "U" ? "C" : f.status === "A" && f.fresh ? "U" : f.status;
    const row = this.hoverable(h_flex().id(id).h(26).flex_none().pl(6 + depth * 14 + 16).pr(8).gap(6).items_center().rounded(6).cursor_pointer().when(open, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f, section, cx))
      .when(menuable, (e) => e.on_mouse_down("right", (_e, cx) => this.toggleMenu(id, f, cx)))
      .child(icon("file", 14, t.muted))
      .child(div().min_w(0).flex_shrink_1().truncate().when(f.status === "D", (e) => e.text_color(t.dim).line_through()).child(f.name))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(f.parent ?? ""))
      .when(hot, (e) => e.child(h_flex().flex_none().children([...(actions?.([f]) ?? []), ...(menuable ? [this.iconButton(`m-${id}`, "ellipsis", "More actions", t, (cx) => this.toggleMenu(id, f, cx))] : [])])))
      .when(!hot && f.add > 0, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi2).child(`+${f.add}`)))
      .when(!hot && f.del > 0, (e) => e.child(div().flex_none().text_size(10).text_color(t.ansi1).child(`−${f.del}`)))
      .child(div().flex_none().w(12).text_size(11).font_semibold().text_right().text_color(t[STATUS_COLOR[f.status]]).child(mark)), id);
    return this.menu?.id === id ? v_flex().flex_none().child(row).child(menuBody(this, t, this.menu)) : row;
  }

  toggleMenu(id, f, cx) {
    this.menu = this.menu?.id === id ? null : { id, f };
    cx.notify();
  }

  sectionHeader(section, title, list, t) {
    const closed = this.sectionClosed.has(section), id = `sec-${section}`, hot = this.hover === id;
    const buttons = section === "conflicts" ? [] : section === "staged"
      ? [this.iconButton("unstage-all", "minus", "Unstage all", t, (cx) => this.unstagePaths(list, cx))]
      : [this.iconButton("discard-all", "undo", "Discard all changes", t, (cx) => this.askDiscard(list, cx)), this.iconButton("stage-all", "plus", "Stage all", t, (cx) => this.stagePaths(list, cx))];
    return this.hoverable(h_flex().id(id).h(26).flex_none().px(6).gap(4).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { if (closed) this.sectionClosed.delete(section); else this.sectionClosed.add(section); cx.notify(); })
      .child(icon(closed ? "chevron-right" : "chevron-down", 12, t.dim))
      .child(div().flex_1().min_w(0).truncate().text_size(11).font_semibold().text_color(t.muted).child(title))
      .when(hot && !this.busy, (e) => e.child(h_flex().flex_none().children(buttons)))
      .child(div().flex_none().min_w(18).px(5).rounded(9).bg(t.raised).text_size(10).text_center().text_color(t.muted).child(String(list.length))), id);
  }

  listRows(t) {
    const out = [], filtering = Boolean(this.filter.trim()), titles = { conflicts: "Merge conflicts", staged: "Staged Changes", unstaged: "Changes" };
    for (const [section, list] of this.sections()) {
      if ((section === "staged" || section === "conflicts" || filtering) && list.length === 0) continue;
      if (section !== "all") {
        out.push(this.sectionHeader(section, titles[section], list, t));
        if (this.sectionClosed.has(section) || list.length === 0) continue;
      }
      const actions = this.fileActions(section, t);
      for (const r of this.rowsFor(list, section)) out.push(r.dir ? this.dirRow(r, t, section, actions) : this.fileRow(r.file, t, r.depth, section, actions));
    }
    if (out.length === 0 && filtering) out.push(div().flex_none().h(40).flex().items_center().justify_center().text_size(12).text_color(t.dim).child("No matches"));
    return out;
  }

  // ---- panel ----

  context() { return key() + this.scope; }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  async loadTotals(root, on, context) {
    const out = {};
    for (const scope of ["worktree", "branch"]) {
      const { base } = await resolveBase(root, on, scope);
      const { files } = await listFiles(root, on, base);
      out[scope] = { add: sum(files, "add"), del: sum(files, "del"), files: files.length };
    }
    const split = await listSplit(root, on);
    const unmerged = new Set([...split.staged, ...split.unstaged].filter((f) => f.status === "U").map((f) => f.path));
    out.conflicts = unmerged.size;
    out.staged = split.staged.filter((f) => !unmerged.has(f.path)).length;
    const cacheKey = `${root}|${on}`;
    if (this.threadCache?.key !== cacheKey || Date.now() - this.threadCache.at > 60000) {
      const threads = await fetchThreads(root, on).catch(() => []);
      this.threadCache = { key: cacheKey, at: Date.now(), open: threads.filter((th) => !th.isResolved).length };
    }
    out.threads = this.threadCache.open;
    if (this.context() === context) this.totals = out;
  }

  refresh(cx) {
    const { cwd, on } = location(), context = this.context();
    if (context === this.ctx && this.loading) { this.again = true; return; }
    if (context !== this.ctx) {
      this.loading = false; this.again = false;
      this.ctx = context; this.root = null; this.files = []; this.staged = []; this.unstaged = []; this.conflicts = []; this.open = null; this.error = null; this.note = null; this.confirm = null; this.menu = null; this.stashes.reset();
      this.watched = null; this.limited = false; this.signature = null; this.loaded = false; this.totals = null; this.status.reset();
      if (key() !== this.repoKey) { this.repoKey = key(); this.message = ""; this.amend = false; this.input.set_value(""); }
    }
    if (this.busy || !cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (this.context() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.staged = []; this.unstaged = []; this.conflicts = []; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim();
        this.onDefault = await onDefaultBranch(root, on);
        if (this.onDefault && this.scope === "branch") { this.scope = "worktree"; setShared("git.scope", "worktree"); setShared("git.selection", null); this.open = null; }
        const { base, label, hasHead } = await resolveBase(root, on, this.scope);
        let files, staged = [], unstaged = [], conflicts = [], limited;
        if (this.scope === "worktree") {
          ({ staged, unstaged, limited } = await listSplit(root, on));
          const unmerged = new Map([...staged, ...unstaged].filter((f) => f.status === "U").map((f) => [f.path, f]));
          conflicts = [...unmerged.values()];
          staged = staged.filter((f) => !unmerged.has(f.path)); unstaged = unstaged.filter((f) => !unmerged.has(f.path));
          files = [...conflicts, ...staged, ...unstaged];
        } else ({ files, limited } = await listFiles(root, on, base));
        await this.stashes.load(root, on).catch(() => {});
        if (this.context() !== context) return;
        Object.assign(this, { root, on, base, baseLabel: label, hasHead, files, staged, unstaged, conflicts, limited, error: null, loaded: true });
        this.watch(root, cx);
        const signature = JSON.stringify([conflicts, staged, unstaged, files]) + base;
        if (signature !== this.signature) {
          this.signature = signature;
          setShared("git.files", [...conflicts.map((f) => ({ ...f, section: "unstaged" })), ...staged.map((f) => ({ ...f, section: "staged" })), ...(this.scope === "worktree" ? unstaged.map((f) => ({ ...f, section: "unstaged" })) : files)]
            .map((f) => ({ path: f.path, status: f.status, fresh: f.fresh, section: f.section })));
          setShared("git.tick", Date.now());
        }
        cx.notify();
        this.loadTotals(root, on, context).catch(() => {}).then(() => cx.notify());
        await this.status.load(root, on, cx);
      } catch (e) { if (this.context() === context) this.error = String(e); }
      finally {
        if (this.context() === context) {
          this.loading = false;
          if (this.again) { this.again = false; this.refresh(cx); }
        }
        cx.notify();
      }
    });
  }

  setScope(scope, cx) {
    if (this.scope === scope) return;
    this.scope = scope; this.open = null;
    setShared("git.scope", scope);
    setShared("git.selection", null);
    cx.notify();
  }

  pick(f, section, cx) {
    this.menu = null;
    if (section.startsWith("stash:")) { this.stashes.pick(f, section.slice(6), cx); return; }
    const realSection = section === "conflicts" ? "unstaged" : section;
    this.open = `${section}:${f.path}`;
    const sel = { root: this.root, on: this.on, path: f.path, status: f.status, fresh: f.fresh, scope: this.scope, base: this.base, label: this.baseLabel };
    if (this.scope === "worktree") sel.section = realSection;
    this.openDiff(sel, cx);
  }

  openDiff(sel, cx) {
    setShared("git.selection", sel);
    const tabs = spaces().find((x) => x.active)?.tabs ?? [], existing = panes().find((p) => p.mod === "my-git" && tabs.some((x) => x.id === p.tab));
    if (existing) run("tab.select", { id: existing.tab });
    else run("tab.new", { name: "Diff", mod: "my-git", props: { view: "review" } });
    cx.notify();
  }

  empty(t, text) {
    return v_flex().flex_1().items_center().justify_center().gap(8).p(20).text_color(t.dim)
      .child(this.loading && !this.loaded ? svg(SPINNER).size(16).flex_none().text_color(t.working).spin(900) : icon("circle-check", 18, t.dim))
      .child(div().text_size(12).child(text));
  }

  listHeader(t) {
    const add = sum(this.files, "add"), del = sum(this.files, "del"), n = this.files.length;
    const worktree = this.scope === "worktree";
    return h_flex().flex_none().h(30).pl(14).pr(6).gap(4).items_center().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().child(worktree ? `${n} uncommitted ${n === 1 ? "file" : "files"}` : `${n} ${n === 1 ? "file" : "files"} changed`))
      .child(div().flex_none().text_color(t.ansi2).child(`+${compact(add)}`)).child(div().flex_none().text_color(t.ansi1).child(`−${compact(del)}`))
      .child(this.iconButton("git-filter", "search", "Filter files", t, (cx) => this.toggleFilter(cx), this.filterOpen ? t.foreground : undefined))
      .child(this.iconButton("git-collapse", "chevrons-down-up", "Collapse all", t, (cx) => this.collapseAll(cx)))
      .child(this.iconButton("git-expand", "chevrons-up-down", "Expand all", t, (cx) => { this.collapsed.clear(); cx.notify(); }));
  }

  filterBox(t) {
    return div().flex_none().px(8).py(6).border_b(1).border_color(t.border)
      .child(div().id("filter-box").h(28).px(10).flex().items_center().rounded(8).border_1().border_color(this.filterTyping ? t.accent : t.border).cursor_text()
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.filterInput).h_full().text_size(12).text_color(t.foreground)));
  }

  commitBox(t) {
    const can = this.canCommit(), noStaged = this.staged.length === 0 && !this.amend;
    return v_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
      .when(Boolean(this.confirm), (e) => e.child(h_flex().h(30).px(10).gap(8).items_center().rounded(8).bg(t.raised).text_size(12)
        .child(div().flex_1().min_w(0).truncate().child(`Discard ${this.confirm.length} ${this.confirm.length === 1 ? "file" : "files"}?`))
        .child(div().id("discard-no").px(8).py(3).rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).text_color(t.muted).on_click((_e, cx) => { this.confirm = null; cx.notify(); }).child("Cancel"))
        .child(div().id("discard-yes").px(8).py(3).rounded(6).cursor_pointer().bg(t.ansi1).text_color(t.solid_foreground).hover((s) => s.opacity(0.88)).on_click((_e, cx) => this.doDiscard(cx)).child("Discard"))))
      .child(h_flex().gap(8)
        .child(div().id("commit-message").flex_1().min_w(0).h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(div().id("commit").h(32).px(14).flex().items_center().rounded(8).bg(can ? t.solid : t.raised).text_color(can ? t.solid_foreground : t.dim).text_size(12).when(can, (e) => e.cursor_pointer()).on_click((_e, cx) => this.commit(cx)).child(this.busy ? "Working…" : this.amend ? "Amend" : "Commit")))
      .child(h_flex().gap(8).items_center().text_size(11).text_color(t.dim)
        .child(h_flex().id("amend").h(22).px(4).gap(6).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.setAmend(!this.amend, cx))
          .child(div().size(13).flex_none().rounded(4).border_1().border_color(this.amend ? t.accent : t.input).bg(this.amend ? t.accent : t.background).flex().items_center().justify_center()
            .when(this.amend, (e) => e.child(icon("check", 10, t.accent_foreground))))
          .child("Amend"))
        .child(div().flex_1().min_w(0).truncate().child(noStaged && this.message.trim() ? "Nothing staged" : ""))
        .child(h_flex().id("stash").h(22).px(6).gap(5).items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.stash(cx))
          .child(icon("archive", 12, t.muted)).child("Stash")));
  }

  renderPanel(cx) {
    if (this.context() !== this.ctx) this.refresh(cx);
    const t = theme(), changes = this.tab === "changes";
    const empty = this.error || (this.loading ? "Loading changes…" : this.root ? (this.scope === "branch" ? "No changes on this branch" : "No uncommitted changes") : "No folder");
    const refresh = div().id("git-refresh").flex_none().p(5).rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("Refresh").on_click((_e, cx) => { this.refresh(cx); this.graph.refresh?.(cx); })
      .child(this.loading ? svg(SPINNER).size(13).text_color(t.working).spin(900) : svg("mods/my-git/refresh.svg").size(13).text_color(t.muted));
    return v_flex().id("git").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.menu) { this.menu = null; cx.stop_propagation(); cx.notify(); }
        else if (this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
        else if (this.filterOpen) { this.closeFilter(cx); cx.stop_propagation(); }
      })
      .child(this.status.body(t, cx, refresh))
      .child(h_flex().id("git-bar").h(42).flex_none().px(8).gap(2).items_center().border_b(1).border_color(t.border)
        .on_size_change((size, cx) => { const show = size.width >= 480; if (show !== this.showCounts) { this.showCounts = show; cx.notify(); } })
        .child(this.tabButton("git-tab-worktree", "Worktree", "Uncommitted changes in this worktree", changes && this.scope === "worktree", t, "file-diff", (_e, cx) => this.showChanges("worktree", cx), this.tabPreview("worktree")))
        .when(!this.onDefault, (e) => e.child(this.tabButton("git-tab-branch", "Branch", "All changes on this branch vs its base", changes && this.scope === "branch", t, "git-branch", (_e, cx) => this.showChanges("branch", cx), this.tabPreview("branch"))))
        .child(this.tabButton("git-tab-graph", "Graph", "Commit history", this.tab === "graph", t, "git-commit", (_e, cx) => this.showTab("graph", cx)))
        .child(this.tabButton("git-tab-stash", "Stash", "Stashed changes", this.tab === "stash", t, "archive", (_e, cx) => this.showTab("stash", cx), this.tabPreview("stash"))))
      .when(this.tab === "graph", (e) => e.child(this.graph.body(cx)))
      .when(this.tab === "stash", (e) => e.child(this.stashes.body(t)))
      .when(changes, (e) => e
        .when(this.root && this.loaded && this.files.length > 0, (e) => e.child(this.listHeader(t)))
        .when(this.root && this.loaded && this.files.length > 0 && this.filterOpen, (e) => e.child(this.filterBox(t)))
        .child(this.files.length
          ? v_flex().id("git-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
            .children(this.listRows(t))
          : this.empty(t, empty))
        .when(this.limited, (e) => e.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
        .when(this.scope === "worktree", (e) => e.child(this.commitBox(t))))
      .when(Boolean(this.note) && this.tab !== "graph", (e) => e.child(h_flex().px(10).py(6).gap(6).items_start().text_size(11).text_color(t.ansi1)
        .child(div().flex_1().min_w(0).child(this.note))
        .child(div().id("note-x").flex_none().cursor_pointer().tooltip("Close").on_click((_e, cx) => { this.note = null; cx.notify(); }).child(icon("x", 12, t.dim)))));
  }
}
