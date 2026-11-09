import { svg } from "gpui-kit";

export const icon = (name, size, color) => svg(`mods/my-git/${name}.svg`).size(size).flex_none().text_color(color);

export function ago(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  if (s < 31536000) return `${Math.floor(s / 604800)}w`;
  return `${Math.floor(s / 31536000)}y`;
}
