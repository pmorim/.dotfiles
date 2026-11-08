import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, window, keys } from "herdr";

export default class PaletteHint extends View {
  hint() {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    return h_flex().size_full().px(14).items_center().justify_end().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8)
      .child(div().id("palette").whitespace_nowrap().text_color(t.dim).on_click(() => run("app.palette")).child(this.hint()));
  }
}
