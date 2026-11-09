import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec } from "herdr";
import { READ } from "./diff.js";
import { icon } from "./shared.js";
import * as ops from "./ops.js";

const SPINNER = "mods/workspace-chrome/spinner.svg";

export class StatusStrip {
  init(cx, onChange) {
    this.info = null; this.op = null; this.error = null;
    this.onChange = onChange;
  }

  reset() { this.token = (this.token ?? 0) + 1; this.info = null; this.error = null; this.op = null; }

  git(args) { return exec("git", [...READ, ...args], { cwd: this.root, on: this.on }); }

  async load(root, on, cx) {
    this.root = root; this.on = on;
    const token = this.token;
    const [sym, head, up] = await Promise.all([
      this.git(["symbolic-ref", "--short", "-q", "HEAD"]),
      this.git(["rev-parse", "--short", "-q", "--verify", "HEAD"]),
      this.git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
    ]);
    if (token !== this.token) return;
    const branch = sym.stdout.trim(), detached = !branch && head.code === 0;
    const upstream = up.code === 0 ? up.stdout.trim() : null;
    let ahead = 0, behind = 0;
    if (upstream) {
      const counts = await this.git(["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
      if (counts.code === 0) [behind, ahead] = counts.stdout.trim().split(/\s+/).map(Number);
    }
    if (token !== this.token) return;
    this.info = { name: detached ? head.stdout.trim() : branch || "no commits", detached, upstream, ahead, behind, hasCommits: head.code === 0 };
    cx.notify();
  }

  async quietFetch(cx) {
    if (!this.root || this.op || !this.info?.upstream) return;
    try { await ops.fetchAll(this.root, this.on); } catch {}
    await this.load(this.root, this.on, cx);
  }

  async write(label, fn, cx) {
    if (this.op || !this.root) return;
    this.op = label; this.error = null; cx.notify();
    try { await fn(this.root, this.on); }
    catch (e) { this.error = String(e.message ?? e); }
    this.op = null;
    this.onChange(cx);
    cx.notify();
  }

  fetch(cx) { cx.spawn((cx) => this.write("fetch", ops.fetchAll, cx)); }
  pull(cx) { cx.spawn((cx) => this.write("pull", ops.pull, cx)); }
  push(cx) { cx.spawn((cx) => this.write("push", this.info?.upstream ? ops.push : ops.publish, cx)); }

  openInVSCode(cx) {
    if (!this.root) return;
    cx.spawn(async (cx) => {
      try { await exec("open", ["-a", "Visual Studio Code", this.root]); }
      catch (e) { this.error = String(e.message ?? e); }
      cx.notify();
    });
  }

  button(id, glyph, label, tip, t, action, busy, disabled) {
    return h_flex().id(id).h(24).px(label ? 7 : 5).gap(5).flex_none().items_center().rounded(6).text_size(11).text_color(disabled ? t.dim : t.muted).tooltip(tip)
      .when(!disabled, (e) => e.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => action(cx)))
      .child(busy ? svg(SPINNER).size(12).flex_none().text_color(t.working).spin(900) : icon(glyph, 13, disabled ? t.dim : t.muted))
      .when(Boolean(label), (e) => e.child(label));
  }

  body(t, cx, refresh) {
    const i = this.info;
    const busy = (k) => this.op === k;
    const strip = h_flex().flex_none().h(34).px(8).gap(2).items_center().border_b(1).border_color(t.border).text_size(12)
      .child(h_flex().flex_none().px(7).gap(6).items_center().child(icon("git-fork", 14, t.muted)).child(div().text_size(12).text_color(t.foreground).child("Git")))
      .when(Boolean(i?.upstream && (i.ahead || i.behind)), (e) => e.child(h_flex().flex_none().gap(6).px(7).text_size(11).text_color(t.dim)
        .when(i.behind > 0, (e) => e.child(h_flex().gap(2).items_center().child(icon("arrow-down", 11, t.dim)).child(String(i.behind))))
        .when(i.ahead > 0, (e) => e.child(h_flex().gap(2).items_center().child(icon("arrow-up", 11, t.dim)).child(String(i.ahead))))))
      .child(div().flex_1())
      .when(Boolean(i), (e) => e
        .child(this.button("git-fetch", "cloud-download", "", "Fetch", t, (cx) => this.fetch(cx), busy("fetch"), Boolean(this.op)))
        .child(this.button("git-pull", "arrow-down", "", "Pull", t, (cx) => this.pull(cx), busy("pull"), Boolean(this.op) || !i.upstream))
        .child(this.button("git-push", "arrow-up", i.upstream ? "" : "Publish", i.upstream ? "Push" : "Publish branch", t, (cx) => this.push(cx), busy("push"), Boolean(this.op) || !i.hasCommits || i.detached)))
      .when(Boolean(this.root) && !this.on, (e) => e.child(this.button("git-vscode", "code", "", "Open worktree in VS Code", t, (cx) => this.openInVSCode(cx))))
      .child(refresh);
    return v_flex().flex_none()
      .child(strip)
      .when(Boolean(this.error), (e) => e.child(h_flex().flex_none().px(10).py(5).gap(6).items_start().border_b(1).border_color(t.border).text_size(11).text_color(t.ansi1)
        .child(div().flex_1().min_w(0).child(this.error))
        .child(div().id("git-error-x").flex_none().cursor_pointer().tooltip("Close").on_click((_e, cx) => { this.error = null; cx.notify(); }).child(icon("x", 12, t.dim)))));
  }
}
