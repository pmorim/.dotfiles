import { div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { exec, run } from "herdr";

const GUI = new Set(["code", "cursor", "windsurf", "subl", "zed", "mate", "idea", "webstorm", "atom", "bbedit", "xed", "open"]);

async function configuredEditor() {
  const probe = 'printf "%s" "${VISUAL:-$EDITOR}"';
  for (const [program, args] of [["sh", ["-c", probe]], ["zsh", ["-lc", probe]]]) {
    const r = await exec(program, args).catch(() => null);
    const value = r?.stdout.trim().split("\n").pop();
    if (value) return value;
  }
  return "";
}

export async function openInEditor(host, f) {
  const target = `${host.root}/${f.path}`;
  try {
    const editor = await configuredEditor();
    if (!editor) { await exec("open", ["-t", target]); return; }
    const argv = editor.split(/\s+/).filter(Boolean);
    if (GUI.has(argv[0].split("/").pop())) await exec(argv[0], [...argv.slice(1), target]);
    else run("pane.split", { direction: "right", argv: [...argv, target] });
  } catch (e) { host.note = String(e.message ?? e); }
}

export function menuBody(host, t, m) {
  const { f } = m, local = !host.on;
  const close = (fn) => (cx) => { host.menu = null; fn(cx); cx.notify(); };
  const items = [
    local && ["Open in editor", close((cx) => cx.spawn(async (cx) => { await openInEditor(host, f); cx.notify(); }))],
    ["Copy path", close((cx) => cx.write_to_clipboard(f.path))],
  ].filter(Boolean);
  return v_flex().flex_none().mx(8).my(2).p(4).gap(1).rounded(8).bg(t.raised).border_1().border_color(t.border).text_size(12)
    .children(items.map(([label, action]) => div().id(`menu-${label}`).flex_none().h(26).px(8).flex().items_center().rounded(6).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => action(cx)).child(label)));
}
