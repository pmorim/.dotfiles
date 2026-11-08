import { View } from "gpui-kit";
import { h_flex } from "gpui-base";
import { Usage } from "./usage.js";
import { theme } from "herdr";

export default class ClaudeUsage extends View {
  init(_props, cx) {
    this.usage = new Usage();
    this.usage.start(cx);
  }

  render(cx) {
    this.usage.onAgents(cx);
    const t = theme();
    return h_flex().size_full().px(14).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .children(this.usage.items(t));
  }
}
