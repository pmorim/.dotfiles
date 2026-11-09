import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, setShared } from "herdr";
import { READ, listEntries } from "./diff.js";
import { icon, ago } from "./shared.js";
import * as ops from "./ops.js";

export class Stashes {
  constructor(host) {
    this.host = host; this.list = []; this.expanded = new Set(); this.files = new Map(); this.confirm = null;
  }

  async load(root, on) {
    const r = await exec("git", [...READ, "stash", "list", "--format=%gd%x1f%gs%x1f%ct%x1f%H%x1f%P"], { cwd: root, on });
    this.list = r.code !== 0 ? [] : r.stdout.split("\n").filter(Boolean).map((line) => {
      const [ref, subject, ct, hash, parents] = line.split("\x1f");
      return { ref, hash, at: Number(ct) * 1000, base: parents.split(" ")[0], message: subject.replace(/^(WIP on|On) /, "") };
    });
    const live = new Set(this.list.map((s) => s.hash));
    for (const hash of [...this.expanded]) if (!live.has(hash)) { this.expanded.delete(hash); this.files.delete(hash); }
    if (!live.has(this.confirm)) this.confirm = null;
  }

  reset() { this.list = []; this.expanded.clear(); this.files.clear(); this.confirm = null; }

  toggle(s, cx) {
    if (this.expanded.has(s.hash)) { this.expanded.delete(s.hash); cx.notify(); return; }
    this.expanded.add(s.hash);
    if (!this.files.has(s.hash)) {
      const { root, on } = this.host;
      cx.spawn(async (cx) => {
        this.files.set(s.hash, await listEntries(root, on, [s.base, s.hash]).catch(() => []));
        cx.notify();
      });
    }
    cx.notify();
  }

  pick(f, hash, cx) {
    const s = this.list.find((x) => x.hash === hash);
    if (!s) return;
    this.host.open = `stash:${hash}:${f.path}`;
    setShared("git.commit.files", (this.files.get(hash) ?? []).map((x) => ({ path: x.path, status: x.status, add: x.add, del: x.del })));
    this.host.openDiff({ root: this.host.root, on: this.host.on, path: f.path, status: f.status, fresh: false, scope: "commit", base: s.base, head: s.hash, label: s.ref }, cx);
  }

  textButton(id, label, t, action, color, tip) {
    return div().id(id).tooltip(tip ?? label).flex_none().px(6).py(2).rounded(5).text_size(11).cursor_pointer().text_color(color ?? t.muted).hover((s) => s.bg(t.raised))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); action(cx); })
      .child(label);
  }

  run(s, fn, cx) { this.host.act((r, o) => fn(r, o, s.ref, s.hash), cx); }

  row(s, t) {
    const h = this.host, id = `stash-${s.hash}`, hot = h.hover === id && !h.busy, open = this.expanded.has(s.hash);
    return h.hoverable(h_flex().id(id).h(26).flex_none().pl(6).pr(8).gap(6).items_center().rounded(6).cursor_pointer().hover((e) => e.bg(t.hover))
      .on_click((_e, cx) => this.toggle(s, cx))
      .child(icon(open ? "chevron-down" : "chevron-right", 12, t.dim))
      .child(icon("archive", 14, t.muted))
      .child(div().flex_1().min_w(0).truncate().child(s.message))
      .when(hot, (e) => e.child(h_flex().flex_none().gap(2)
        .child(this.textButton(`sa-${s.hash}`, "Apply", t, (cx) => this.run(s, ops.stashApply, cx), undefined, "Apply stash"))
        .child(this.textButton(`sp-${s.hash}`, "Pop", t, (cx) => this.run(s, ops.stashPop, cx), undefined, "Pop stash"))
        .child(h.iconButton(`sd-${s.hash}`, "trash", "Drop stash", t, (cx) => { this.confirm = s.hash; cx.notify(); }))))
      .when(!hot, (e) => e.child(div().flex_none().text_size(10).text_color(t.dim).child(ago(s.at)))), id);
  }

  confirmRow(s, t) {
    return h_flex().flex_none().h(30).mx(4).px(10).gap(8).items_center().rounded(8).bg(t.raised).text_size(12)
      .child(div().flex_1().min_w(0).truncate().child(`Drop ${s.ref}?`))
      .child(this.textButton("sdrop-no", "Cancel", t, (cx) => { this.confirm = null; cx.notify(); }))
      .child(div().id("sdrop-yes").px(8).py(3).rounded(6).cursor_pointer().bg(t.ansi1).text_color(t.solid_foreground).hover((e) => e.opacity(0.88))
        .on_click((_e, cx) => { this.confirm = null; this.run(s, ops.stashDrop, cx); }).child("Drop"));
  }

  body(t) {
    if (this.list.length === 0) {
      return v_flex().flex_1().items_center().justify_center().gap(8).p(20).text_color(t.dim)
        .child(icon("archive", 18, t.dim)).child(div().text_size(12).child("No stashes"));
    }
    return v_flex().id("git-stashes").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1).children(this.rows(t));
  }

  rows(t) {
    const h = this.host, out = [];
    for (const s of this.list) {
      out.push(this.row(s, t));
      if (this.confirm === s.hash) out.push(this.confirmRow(s, t));
      if (!this.expanded.has(s.hash)) continue;
      const files = this.files.get(s.hash);
      if (!files) out.push(div().h(24).pl(34).flex().items_center().text_size(11).text_color(t.dim).child("Loading..."));
      else for (const f of files.map((x) => ({ ...x, name: x.path.slice(x.path.lastIndexOf("/") + 1), parent: x.path.includes("/") ? x.path.slice(0, x.path.lastIndexOf("/")) : "" }))) out.push(h.fileRow(f, t, 1, `stash:${s.hash}`, null));
    }
    return out;
  }
}
