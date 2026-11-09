import { div, svg, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, Scrollbar, v_virtual_list } from "gpui-base";
import { theme, settings, shared, setShared, props, closeOverlay } from "herdr";
import { loadDiff, buildRows, buildSplit } from "./diff.js";
import { highlightSide, tokenStyle } from "./highlight.js";
import { fetchThreads, threadRows } from "./threads.js";
import { icon } from "./shared.js";
import { parseHunks, hunkAt, buildPatch, applyPatch } from "./patch.js";

const EMPTY_CHARS = 24, RIGHT_PAD = 12, PROBE = 100, FADE = 28;

const fadeRect = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const mix = (base, top, alpha) => {
  const c = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [b, t] = [c(base), c(top)];
  return `#${b.map((v, i) => Math.round(v + (t[i] - v) * alpha).toString(16).padStart(2, "0")).join("")}`;
};
const fade = (from, to) => window.paint_path(fadeRect(), Background.linear_gradient(90, from, to));

const weigh = (text) => { let n = 0; for (const ch of text) n += ch === "\t" ? 4 : ch.codePointAt(0) >= 0x1100 ? 2 : 1; return n; };

export class ReviewTab {
  init(cx) {
    this.rows = []; this.sizes = []; this.diff = []; this.split = []; this.cols = 120; this.seq = 0; this.offL = 0; this.offR = 0; this.width = 0; this.charW = 6.7; this.gutter = 55; this.probe = {}; this.lineW = {}; this.longest = { l: "", r: "" }; this.empty = null; this.maxW = { l: 0, r: 0 };
    this.picked = new Set(); this.anchor = null; this.head = null; this.mode = null; this.hunk = null; this.hitShift = false; this.hitSide = "r"; this.confirm = null; this.err = null;
    this.raw = []; this.header = []; this.hunks = []; this.writable = false;
    this.threads = []; this.threadsAt = 0; this.threadsKey = null; this.expanded = new Set();
    this.load(cx);
  }

  load(cx) {
    const sel = shared("git.selection");
    const signature = sel ? JSON.stringify([sel.root, sel.path, sel.scope, sel.base, sel.section, sel.head, shared("git.tick")]) : "";
    if (signature === this.signature) return;
    if (this.sel?.path !== sel?.path || this.sel?.section !== sel?.section) this.err = null;
    if (this.sel?.path !== sel?.path || this.sel?.section !== sel?.section) { this.offL = 0; this.offR = 0; }
    this.signature = signature; this.sel = sel; this.note = null;
    this.picked = new Set(); this.anchor = null; this.head = null; this.mode = null; this.confirm = null;
    const seq = ++this.seq;
    if (!sel) { this.diff = []; this.compose(); return; }
    cx.spawn(async (cx) => {
      try {
        const { lines, note, header, partial } = await loadDiff(sel);
        if (seq !== this.seq) return;
        if (note) { this.diff = []; this.raw = []; this.hunks = []; this.writable = false; this.note = note; this.compose(); return; }
        const removes = lines.some((l) => l[0] === "-"), index = { ...sel, base: "" };
        const staged = sel.section === "staged", unstaged = sel.section === "unstaged", commit = sel.scope === "commit";
        const [newHl, oldHl] = await Promise.all([
          sel.status === "D" ? null : commit ? highlightSide({ ...sel, base: sel.head }, "old") : staged ? highlightSide(index, "old") : highlightSide(sel, "new"),
          removes ? highlightSide(unstaged ? index : staged ? { ...sel, base: "HEAD" } : sel, "old") : null,
        ]);
        if (seq !== this.seq) return;
        this.diff = buildRows(lines, oldHl, newHl);
        this.diff.forEach((r, i) => { r.idx = i; });
        this.raw = lines; this.header = header ?? []; this.hunks = parseHunks(lines);
        this.writable = Boolean(sel.section) && !(sel.fresh && !staged) && !partial && this.header.length > 0;
        this.compose();
        cx.notify();
        const threadsKey = `${sel.root}:${sel.on}`;
        if (sel.scope !== "commit" && (threadsKey !== this.threadsKey || Date.now() - this.threadsAt > 60000)) {
          this.threadsKey = threadsKey; this.threadsAt = Date.now();
          const threads = await fetchThreads(sel.root, sel.on);
          if (seq !== this.seq) return;
          this.threads = threads;
          this.compose();
        }
      } catch (e) { if (seq === this.seq) { this.diff = []; this.note = `Cannot preview this diff: ${e}`; this.compose(); } }
      finally { cx.notify(); }
    });
  }

  compose() {
    const path = this.sel?.path, placed = new Map(), loose = [];
    this.split = buildSplit(this.diff);
    const cells = this.split.filter((r) => r.l || r.r);
    this.empty = cells.length === 0 ? null : cells.every((r) => !r.l) ? "l" : cells.every((r) => !r.r) ? "r" : null;
    for (const side of ["l", "r"]) {
      const best = cells.reduce((b, r) => { const text = r[side]?.text ?? "", w = weigh(text); return w > b.w ? { text, w } : b; }, { text: "", w: 0 });
      const m = this.lineW[side];
      this.longest[side] = best.text;
      this.maxW[side] = m && m.text === best.text ? m.w : best.w * this.charW;
    }
    if (this.empty) { this.offL = 0; this.offR = 0; }
    (this.threads ?? []).filter((th) => th.path === path).forEach((th, i) => {
      const id = `${path}#${i}`, line = th.line ?? th.originalLine, left = th.diffSide === "LEFT";
      const at = line ? this.split.findIndex((r) => left ? r.l?.kind === "-" && r.l.number === line : r.r?.number === line) : -1;
      const rows = threadRows(th, id, this.expanded.has(id), this.cols);
      if (at < 0) loose.push(...rows);
      else placed.set(at, [...(placed.get(at) ?? []), ...rows]);
    });
    this.rows = [...loose, ...this.split.flatMap((row, i) => [row, ...(placed.get(i) ?? [])])];
    this.sizes = this.rows.map((r) => r.h ?? 20);
  }

  setRange(head) {
    const lo = Math.min(this.anchor, head), hi = Math.max(this.anchor, head);
    this.head = head;
    this.picked = new Set();
    for (let i = lo; i <= hi; i++) if (this.raw[i]?.[0] === "-" || this.raw[i]?.[0] === "+") this.picked.add(i);
  }

  press(cell, shift, cx) {
    const same = this.anchor !== null && this.mode === "lines" && hunkAt(this.hunks, this.anchor) === hunkAt(this.hunks, cell.idx);
    this.confirm = null;
    if (shift && same) this.setRange(cell.idx);
    else if (this.mode === "lines" && this.picked.size === 1 && this.anchor === cell.idx) { this.picked = new Set(); this.anchor = null; this.mode = null; }
    else { this.anchor = cell.idx; this.setRange(cell.idx); }
    if (this.picked.size) this.mode = "lines";
  }

  pickHunk(at) {
    this.confirm = null; this.anchor = null;
    if (this.mode === "hunk" && this.hunk === at) { this.picked = new Set(); this.mode = null; return; }
    const h = this.hunks[at];
    this.mode = "hunk"; this.hunk = at;
    this.picked = new Set();
    for (let i = h.start + 1; i < h.end; i++) if (this.raw[i][0] === "-" || this.raw[i][0] === "+") this.picked.add(i);
  }

  hit(key, cx) {
    const row = this.rows[Number(key)];
    if (row?.kind === "th" && row.resolved) { this.toggle(row.thread, cx); return; }
    if (!this.writable || !row) return;
    if (row.kind === "@") this.pickHunk(this.hunks.findIndex((h) => h.start === row.idx));
    else if (row.l || row.r) {
      const order = this.hitSide === "l" ? [row.l, row.r] : [row.r, row.l];
      const cell = order.find((c) => c && (c.kind === "-" || c.kind === "+"));
      if (!cell) return;
      this.press(cell, this.hitShift, cx);
    } else return;
    cx.notify();
  }

  write(mode, hunk, cx) {
    const sel = this.sel, h = this.hunks[hunk ?? hunkAt(this.hunks, this.anchor)];
    const patch = h ? buildPatch(this.header, this.raw, h, this.mode === "lines" ? this.picked : null, mode !== "stage", sel.path) : null;
    this.confirm = null;
    if (!patch) { cx.notify(); return; }
    cx.spawn(async (cx) => {
      this.err = await applyPatch(sel.root, sel.on, patch, mode);
      this.signature = null;
      this.load(cx);
      cx.notify();
    });
  }

  button(id, label, color, onPress, tip) {
    const t = theme();
    return div().id(id).tooltip(tip ?? label).flex_none().px(6).h(16).rounded(4).flex().items_center().text_size(10).text_color(color).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => onPress(cx)).child(label);
  }

  actions(idsuffix, hunk, t) {
    const staged = this.sel?.section === "staged", noun = hunk === null ? "lines" : "hunk", long = hunk === null ? "selected lines" : "hunk", id = (n) => `${n}-${idsuffix}`;
    if (this.confirm === idsuffix) {
      return h_flex().flex_none().gap(2).items_center()
        .child(div().text_size(10).text_color(t.ansi1).child("Discard?"))
        .child(this.button(id("yes"), "Yes", t.ansi1, (cx) => this.write("discard", hunk, cx)))
        .child(this.button(id("no"), "No", t.muted, (cx) => { this.confirm = null; cx.notify(); }));
    }
    return h_flex().flex_none().gap(2).items_center()
      .child(staged
        ? this.button(id("unstage"), `Unstage ${noun}`, t.accent, (cx) => this.write("unstage", hunk, cx), `Unstage ${long}`)
        : this.button(id("stage"), `Stage ${noun}`, t.accent, (cx) => this.write("stage", hunk, cx), `Stage ${long}`))
      .when(!staged, (e) => e.child(this.button(id("discard"), `Discard ${noun}`, t.ansi1, (cx) => { this.confirm = idsuffix; cx.notify(); }, `Discard ${long}`)));
  }

  hunkRow(row, t) {
    const at = this.hunks.findIndex((h) => h.start === row.idx), on = this.mode === "hunk" && this.hunk === at;
    return h_flex().w_full().h(20).flex_none().px(12).gap(8).items_center().bg(on ? `${t.accent}33` : t.raised)
      .child(div().flex_1().min_w(0).truncate().text_color(on ? t.foreground : t.dim).child(row.text));
  }

  toggle(id, cx) {
    if (this.expanded.has(id)) this.expanded.delete(id); else this.expanded.add(id);
    this.compose(); cx.notify();
  }

  fileList(sel) {
    return (sel?.scope === "commit" ? shared("git.commit.files") : shared("git.files")) ?? [];
  }

  step(by, cx) {
    const sel = shared("git.selection"), files = this.fileList(sel);
    const next = files[files.findIndex((f) => f.path === sel?.path && f.section === sel?.section) + by];
    if (next) setShared("git.selection", { ...sel, path: next.path, status: next.status, fresh: next.fresh ?? false, section: next.section });
    cx.notify();
  }

  token({ cls, text }, t) {
    const style = tokenStyle(cls, t);
    return div().flex_none().when(Boolean(style.color), (e) => e.text_color(style.color)).when(Boolean(style.italic), (e) => e.italic()).child(text);
  }

  card(row, t, content) {
    return h_flex().w_full().h(row.h).flex_none().pl(46).pr(14)
      .child(div().flex_1().min_w(0).h_full().bg(t.raised).border_l(2).border_color(row.resolved ? t.dim : t.accent).px(10).flex().items_center().child(content));
  }

  measureLine(side, text, width, cx) {
    if (this.lineW[side]?.text === text && Math.abs(this.lineW[side].w - width) < 0.5) return;
    this.lineW[side] = { text, w: width };
    this.compose(); cx.notify();
  }

  unit(px) { return px / ((settings().zoom ?? 1) || 1); }

  minEmpty() { return this.gutter + EMPTY_CHARS * this.charW; }

  measure(key, value, cx) {
    this.probe[key] = value;
    const { text, row } = this.probe;
    if (!text || !row) return;
    const charW = text / PROBE, gutter = row - text;
    if (Math.abs(charW - this.charW) < 0.01 && Math.abs(gutter - this.gutter) < 0.5) return;
    this.charW = charW; this.gutter = gutter;
    this.compose(); cx.notify();
  }

  fullW() {
    if (!this.empty || !this.width) return null;
    const own = this.maxW[this.empty === "l" ? "r" : "l"] + this.gutter + RIGHT_PAD, min = this.minEmpty();
    return Math.max(0, Math.min(this.width - 1 - min, Math.max(min, own)));
  }

  fit(el, side) {
    const fw = this.fullW();
    if (this.empty === side) return el.flex_1().min_w(this.unit(this.minEmpty()));
    return this.empty && fw !== null ? el.w(this.unit(fw)).flex_none() : el.flex_1();
  }

  wheel(e, cx) {
    const { x, y } = e.delta, dx = Math.abs(x) >= Math.abs(y) ? x : e.modifiers?.shift ? y : 0;
    if (!dx || !e.bounds || !e.local_position) return;
    const w = e.bounds.width, side = this.empty === "l" ? "r" : this.empty === "r" ? "l" : e.local_position.x > w / 2 ? "r" : "l";
    const half = this.empty ? this.fullW() ?? w - 1 - this.minEmpty() : (w - 1) / 2, key = side === "l" ? "offL" : "offR";
    const next = Math.min(Math.max(0, this.maxW[side] + RIGHT_PAD - (half - this.gutter)), Math.max(0, this[key] - dx));
    if (next !== this[key]) { this[key] = next; cx.notify(); }
  }

  limit(side) {
    const w = this.width;
    if (!w) return 0;
    const half = this.empty ? this.fullW() ?? w - 1 - this.minEmpty() : (w - 1) / 2;
    return Math.max(0, this.maxW[side] + RIGHT_PAD - (half - this.gutter));
  }

  half(cell, t, side) {
    const color = cell?.kind === "-" ? t.ansi1 : cell?.kind === "+" ? t.ansi2 : null;
    const picked = Boolean(cell) && this.picked.has(cell.idx);
    const off = side === "l" ? this.offL : this.offR;
    const fill = !cell ? t.raised : color ? mix(t.background, color, picked ? 0x55 / 255 : 0x1c / 255) : t.background;
    const lim = this.limit(side), left = Math.min(1, off / FADE), right = Math.min(1, Math.max(0, lim - off) / FADE);
    return this.fit(h_flex().relative().min_w(0).h_full().overflow_hidden().gap(8), side).when(Boolean(color), (e) => e.bg(`${color}${picked ? "55" : "1c"}`)).when(!cell, (e) => e.bg(t.raised))
      .child(div().w(3).h_full().flex_none().when(Boolean(color), (e) => e.bg(color)))
      .child(div().w(36).flex_none().text_right().text_color(color ?? t.dim).child(cell ? String(cell.number) : ""))
      .when(Boolean(cell), (e) => e.child(div().flex_1().min_w(0).overflow_hidden()
        .child(cell.tokens
          ? h_flex().flex_none().whitespace_nowrap().ml(-this.unit(off)).children(cell.tokens.map((tok) => this.token(tok, t)))
          : div().flex_none().whitespace_nowrap().ml(-this.unit(off)).child(cell.text))))
      .when(left > 0.01, (e) => e.child(div().absolute().top(0).bottom(0).left(this.unit(this.gutter)).w(FADE).opacity(left).child(fade(fill, `${fill}00`).size_full())))
      .when(right > 0.01, (e) => e.child(div().absolute().top(0).bottom(0).right(0).w(FADE).opacity(right).child(fade(`${fill}00`, fill).size_full())));
  }

  rowElement(row, t) {
    if (row.kind === "@") return this.hunkRow(row, t);
    if (row.kind === "th") {
      const content = h_flex().w_full().min_w(0).gap(8).items_center()
        .child(icon(row.resolved ? "circle-check" : "message", 13, row.resolved ? t.ansi2 : t.accent)).child(div().font_semibold().child(row.author)).child(div().text_size(11).text_color(t.dim).child(row.when))
        .when(row.count > 1, (e) => e.child(div().text_size(11).text_color(t.dim).child(`${row.count} comments`)))
        .when(row.outdated, (e) => e.child(div().px(5).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child("Outdated")))
        .when(row.resolved, (e) => e.child(div().px(5).rounded(4).border_1().border_color(t.ansi2).text_size(10).text_color(t.ansi2).child("Resolved")))
        .when(Boolean(row.summary), (e) => e.child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(row.summary)));
      return this.card(row, t, content);
    }
    if (row.kind === "tc") return this.card(row, t, h_flex().gap(8).items_center().child(div().font_semibold().child(row.author)).child(div().text_size(11).text_color(t.dim).child(row.when)));
    if (row.kind === "tb") return this.card(row, t, div().w_full().min_w(0).truncate().child(row.text));
    if (row.kind === "ts") return this.card(row, t, div());
    return h_flex().w_full().h(20).flex_none().child(this.half(row.l, t, "l")).child(div().w(1).h_full().flex_none().bg(t.border)).child(this.half(row.r, t, "r"));
  }

  body(cx) {
    this.load(cx);
    const t = theme(), sel = this.sel, files = this.fileList(sel), at = files.findIndex((f) => f.path === sel?.path && f.section === sel?.section);
    const add = this.diff.filter((r) => r.kind === "+").length, del = this.diff.filter((r) => r.kind === "-").length;
    const parts = (sel?.path ?? "").split("/"), name = parts.pop();
    const stop = (_e, cx) => cx.stop_propagation();
    const labels = sel?.scope === "commit" ? ["Parent", sel.label] : sel?.section === "staged" ? ["HEAD", "Index"] : sel?.section === "unstaged" ? ["Index", "Working tree"]
      : [sel?.scope === "branch" ? `Base · ${sel.label}` : "Before · HEAD", "After · working tree"];
    const nav = (id, glyph, tip, by, on) => div().id(id).tooltip(tip).p(5).rounded(6).on_mouse_down("left", stop).when(on, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.step(by, cx))).child(icon(glyph, 13, on ? t.muted : t.border));
    return v_flex().id("git-review").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => {
        if (this.empty && Math.abs(size.width - this.width) >= 4) { this.width = size.width; cx.notify(); } else this.width = size.width;
        const cols = Math.max(40, Math.floor((size.width - 130) / 6.7));
        if (Math.abs(cols - this.cols) >= 4) { this.cols = cols; this.compose(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(icon("file-diff", 14, t.muted))
        .child(h_flex().flex_1().min_w(0).overflow_hidden().child(div().min_w(0).text_color(t.dim).truncate().child(parts.length ? `${parts.join("/")}/` : "")).child(div().flex_none().font_semibold().child(name ?? "Review")))
        .when(this.diff.length > 0, (e) => e.child(div().flex_none().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().flex_none().text_size(11).text_color(t.ansi1).child(`−${del}`)))
        .child(nav("review-prev", "arrow-up", "Previous file", -1, at > 0)).child(nav("review-next", "arrow-down", "Next file", 1, at >= 0 && at < files.length - 1))
        .when(Boolean(props()?.overlay), (e) => e.child(div().id("review-close").tooltip("Close").p(5).rounded(6).cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop).on_click(() => closeOverlay(props().overlay))
          .child(svg("mods/workspace-chrome/x.svg").size(13).text_color(t.muted)))))
      .child(h_flex().h(24).flex_none().border_b(1).border_color(t.border).text_size(11).text_color(t.dim)
        .child(this.fit(div().min_w(0), "l").overflow_hidden().px(this.empty === "l" ? 6 : 14).flex().items_center().truncate().child(labels[0]))
        .child(div().w(1).h_full().flex_none().bg(t.border))
        .child(this.fit(div().min_w(0), "r").overflow_hidden().px(this.empty === "r" ? 6 : 14).flex().items_center().truncate().child(labels[1])))
      .when(Boolean(this.err), (e) => e.child(h_flex().h(24).flex_none().px(14).gap(8).items_center().bg(`${t.ansi1}22`).text_size(11).text_color(t.ansi1)
        .child(div().flex_1().min_w(0).truncate().child(this.err))
        .child(this.button("review-err-x", "Dismiss", t.muted, (cx) => { this.err = null; cx.notify(); }))))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11).on_scroll_wheel((e, cx) => this.wheel(e, cx)).on_mouse_down("left", (e, cx) => {
          this.hitShift = Boolean(e.modifiers?.shift);
          this.hitSide = this.empty ? (this.empty === "l" ? "r" : "l") : e.local_position && e.bounds && e.local_position.x > e.bounds.width / 2 ? "r" : "l";
          cx.stop_propagation();
        })
        .child(v_virtual_list("git-diff", this.rows.length, this.sizes, (i) => String(i),
          (range) => this.rows.slice(range.start, range.end).map((row) => this.rowElement(row, t))).size_full().on_item_click((key, cx) => this.hit(key, cx)))
        .child(h_flex().absolute().top(0).left(0).w(30000).h(0).overflow_hidden().opacity(0)
          .child(div().id("probe-text").flex_none().whitespace_nowrap().on_size_change((size, cx) => this.measure("text", size.width, cx)).child("0".repeat(PROBE))))
        .child(h_flex().absolute().top(0).left(0).w(30000).h(0).overflow_hidden().opacity(0)
          .child(h_flex().id("probe-row").flex_none().gap(8).on_size_change((size, cx) => this.measure("row", size.width, cx))
            .child(div().w(3).flex_none()).child(div().w(36).flex_none()).child(div().flex_none().whitespace_nowrap().child("0".repeat(PROBE)))))
        .children(["l", "r"].filter((side) => this.longest[side]).map((side) => h_flex().absolute().top(0).left(0).w(30000).h(0).overflow_hidden().opacity(0)
          .child(div().id(`probe-line-${side}`).flex_none().whitespace_nowrap().on_size_change((size, cx) => this.measureLine(side, this.longest[side], size.width, cx)).child(this.longest[side]))))
        .child(Scrollbar.vertical("git-diff").viewport_from_layout().absolute().inset_0())
        .when(this.writable && this.picked.size > 0, (e) => e.child(h_flex().absolute().bottom(14).right(22).h(28).px(10).gap(8).items_center().rounded(8).bg(t.popover).border_1().border_color(t.border).shadow_md().text_size(11)
          .child(div().text_color(t.muted).child(this.mode === "hunk" ? "Hunk" : `${this.picked.size} selected`))
          .child(this.actions("sel", this.mode === "hunk" ? this.hunk : null, t))
          .child(this.button("sel-clear", "Clear", t.muted, (cx) => { this.picked = new Set(); this.anchor = null; this.mode = null; this.confirm = null; cx.notify(); }))))
        .when(!this.rows.length, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child(this.note ?? (sel ? "Loading…" : "Select a file in the Git panel")))));
  }
}
