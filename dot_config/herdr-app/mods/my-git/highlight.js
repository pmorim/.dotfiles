import { exec, readTextFile } from "herdr";
import { languageFor, highlightLines } from "./fallback.js";
import { READ } from "./diff.js";

const SCRIPT = [
  "sdk=/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX26.2.sdk",
  '[ -d "$sdk" ] && export SDKROOT="$sdk"',
  "mode=$1; root=$2; base=$3; file=$4; name=${file##*/}",
  'd=$(mktemp -d) || exit 1; trap \'rm -rf "$d"\' EXIT',
  'if [ "$mode" = old ]; then git -C "$root" show "$base:$file" > "$d/$name" 2>/dev/null || exit 1; target="$d/$name"; else target="$root/$file"; fi',
  '[ "$(wc -c < "$target")" -gt 600000 ] && exit 1',
  'cd "$d" || exit 1',
  'tree-sitter highlight --html --style minimal --layout fragment "$target" 2>/dev/null',
].join("\n");

const ENTITIES = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&#x27;": "'" };

// tree-sitter's html fragment -> one token list per source line; spans that cross a line
// (a block comment, a multi-line string) keep their class on every line they cover.
function parseSpans(html) {
  const body = html.slice(html.indexOf("<code>") + 6, html.lastIndexOf("</code>"));
  const lines = [[]], stack = [], re = /<span class='([^']*)'>|<\/span>|\n|[^<\n]+/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1] !== undefined) stack.push(m[1]);
    else if (m[0] === "</span>") stack.pop();
    else if (m[0] === "\n") lines.push([]);
    else lines[lines.length - 1].push({ cls: stack[stack.length - 1] ?? "", text: m[0].replace(/&(?:lt|gt|amp|quot|#39|#x27);/g, (e) => ENTITIES[e]) });
  }
  return lines;
}

// The Swift grammar has no comment capture.
function swiftComments(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i], at = tok.cls === "" ? tok.text.indexOf("//") : -1;
    if (at < 0) { out.push(tok); continue; }
    if (at > 0) out.push({ cls: "", text: tok.text.slice(0, at) });
    out.push({ cls: "comment", text: tok.text.slice(at) + tokens.slice(i + 1).map((x) => x.text).join("") });
    break;
  }
  return out;
}

async function treeSitter(sel, side) {
  const r = await exec("sh", ["-c", SCRIPT, "sh", side, sel.root, sel.base, sel.path], { cwd: sel.root });
  if (r.code !== 0 || !r.stdout.includes("<code>")) return null;
  const lines = parseSpans(r.stdout);
  return sel.path.endsWith(".swift") ? lines.map(swiftComments) : lines;
}

// side: "old" (the file at the base) or "new" (the working tree). Null leaves the text plain.
export async function highlightSide(sel, side) {
  if (!sel.on) {
    const lines = await treeSitter(sel, side).catch(() => null);
    if (lines) return lines;
  }
  const lang = languageFor(sel.path);
  if (!lang) return null;
  const text = side === "old"
    ? (await exec("git", [...READ, "show", `${sel.base}:${sel.path}`], { cwd: sel.root, on: sel.on })).stdout
    : await readTextFile(`${sel.root}/${sel.path}`, { on: sel.on }).catch(() => null);
  return text && text.length < 400000 ? highlightLines(text, lang) : null;
}

const COLOR = {
  keyword: "ansi5", string: "ansi2", character: "ansi2", number: "ansi3", constant: "ansi3", boolean: "ansi3",
  type: "ansi3", constructor: "ansi3", module: "ansi3", attribute: "ansi3", function: "ansi4", label: "ansi4",
  property: "ansi6", escape: "ansi6", tag: "ansi1",
};

export function tokenStyle(cls, t) {
  const [head, sub] = cls.split(" ");
  if (head === "comment") return { color: t.dim, italic: true };
  if (head === "punctuation") return { color: sub === "special" ? t.ansi6 : t.muted };
  if (head === "operator") return { color: t.muted };
  return COLOR[head] ? { color: t[COLOR[head]] } : {};
}
