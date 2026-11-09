const words = (s) => new Set(s.split(" "));

const JS = words("as async await break case catch class const continue debugger declare default delete do else enum export extends finally for from function if implements import in instanceof interface keyof let namespace new of private protected public readonly return satisfies static super switch this throw try type typeof var void while with yield");
const C = words("abstract as async await auto break case catch chan class const continue crate data default defer do dyn else enum extends extern final finally fn for fun func go goto if impl implements import in interface is let loop match mod move mut namespace new object override package private protected pub public range ref return sealed select self Self sizeof static struct super switch template this throw throws trait try type typedef typename union unsafe use using val var virtual void volatile when where while");
const PY = words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda match case nonlocal not or pass raise return try while with yield self");
const SH = words("case do done elif else esac export fi for function if in local return select then until while");
const RB = words("alias and begin break case class def do else elsif end ensure for if in module next not or redo rescue retry return self super then unless until when while yield");
const SQL = words("select from where and or not insert into values update set delete create table alter drop index join left right inner outer on group by order having limit offset as distinct union all case when then else end is null primary key references default");
const LUA = words("and break do else elseif end for function goto if in local not or repeat return then until while");
const CONST = words("true false null undefined nil None True False NaN Infinity");

const cLike = (keywords, extra = {}) => ({ line: ["//"], block: [["/*", "*/"]], quotes: "'\"", keywords, ...extra });
const hashLike = (keywords, extra = {}) => ({ line: ["#"], block: [], quotes: "'\"", keywords, ...extra });

const JS_LANG = cLike(JS, { quotes: "'\"`", multiline: "`" });
const LANGS = {
  js: JS_LANG, jsx: JS_LANG, mjs: JS_LANG, cjs: JS_LANG, ts: JS_LANG, tsx: JS_LANG, mts: JS_LANG, cts: JS_LANG,
  rs: cLike(C), go: cLike(C, { quotes: "'\"`", multiline: "`" }), java: cLike(C), kt: cLike(C), kts: cLike(C), swift: cLike(C),
  c: cLike(C), h: cLike(C), cc: cLike(C), cpp: cLike(C), hpp: cLike(C), m: cLike(C), mm: cLike(C), cs: cLike(C),
  dart: cLike(C), scala: cLike(C), php: cLike(C, { line: ["//", "#"] }), zig: cLike(C), groovy: cLike(C), gradle: cLike(C),
  css: cLike(new Set(), { line: [] }), scss: cLike(new Set()), less: cLike(new Set()),
  json: cLike(new Set()), jsonc: cLike(new Set()), json5: cLike(new Set()),
  py: hashLike(PY, { triple: true }), pyi: hashLike(PY, { triple: true }),
  sh: hashLike(SH), bash: hashLike(SH), zsh: hashLike(SH), fish: hashLike(SH), env: hashLike(SH),
  rb: hashLike(RB), rake: hashLike(RB), yml: hashLike(new Set()), yaml: hashLike(new Set()), toml: hashLike(new Set()),
  ini: hashLike(new Set(), { line: ["#", ";"] }), conf: hashLike(new Set()), properties: hashLike(new Set()),
  sql: { line: ["--"], block: [["/*", "*/"]], quotes: "'\"", keywords: SQL, nocase: true },
  lua: { line: ["--"], block: [["--[[", "]]"]], quotes: "'\"", keywords: LUA },
  html: { line: [], block: [["<!--", "-->"]], quotes: "'\"", keywords: new Set() },
  xml: { line: [], block: [["<!--", "-->"]], quotes: "'\"", keywords: new Set() },
  svg: { line: [], block: [["<!--", "-->"]], quotes: "'\"", keywords: new Set() },
  vue: cLike(JS, { quotes: "'\"`", multiline: "`", block: [["/*", "*/"], ["<!--", "-->"]] }),
  svelte: cLike(JS, { quotes: "'\"`", multiline: "`", block: [["/*", "*/"], ["<!--", "-->"]] }),
};
const NAMES = { Dockerfile: hashLike(SH), Makefile: hashLike(SH), Gemfile: hashLike(RB), Podfile: hashLike(RB), Fastfile: hashLike(RB), ".gitignore": hashLike(new Set()) };

export function languageFor(path) {
  const name = path.split("/").pop();
  return NAMES[name] ?? LANGS[name.includes(".") ? name.split(".").pop().toLowerCase() : ""] ?? null;
}

const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)[a-zA-Z%]*/;
const IDENT = /^[A-Za-z_$][\w$]*/;

// Returns [tokens, state]; state carries an open block comment or multi-line string to the next line.
export function tokenize(text, lang, state = null) {
  const tokens = [];
  const push = (kind, value) => {
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += value;
    else tokens.push({ kind, text: value });
  };
  let i = 0;
  if (state) {
    const end = text.indexOf(state.close);
    if (end < 0) { push(state.kind, text); return [tokens, state]; }
    push(state.kind, text.slice(0, end + state.close.length));
    i = end + state.close.length;
    state = null;
  }
  while (i < text.length) {
    const rest = text.slice(i);
    if (lang.line.some((p) => rest.startsWith(p)) && !lang.block.some(([open]) => rest.startsWith(open))) { push("comment", rest); break; }
    const block = lang.block.find(([open]) => rest.startsWith(open));
    if (block) {
      const end = rest.indexOf(block[1], block[0].length);
      if (end < 0) { push("comment", rest); return [tokens, { kind: "comment", close: block[1] }]; }
      push("comment", rest.slice(0, end + block[1].length)); i += end + block[1].length; continue;
    }
    const ch = text[i];
    if (lang.triple && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const q = rest.slice(0, 3), end = rest.indexOf(q, 3);
      if (end < 0) { push("string", rest); return [tokens, { kind: "string", close: q }]; }
      push("string", rest.slice(0, end + 3)); i += end + 3; continue;
    }
    if (lang.quotes.includes(ch)) {
      let j = i + 1;
      while (j < text.length && text[j] !== ch) j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length && lang.multiline === ch) { push("string", rest); return [tokens, { kind: "string", close: ch }]; }
      push("string", text.slice(i, j + 1)); i = j + 1; continue;
    }
    if (/\d/.test(ch) && !/[\w$]/.test(text[i - 1] ?? "")) {
      const m = NUMBER.exec(rest); push("number", m[0]); i += m[0].length; continue;
    }
    const id = IDENT.exec(rest);
    if (id) {
      const word = id[0], after = text.slice(i + word.length).trimStart()[0], member = text[i - 1] === ".";
      const kw = lang.nocase ? word.toLowerCase() : word;
      const kind = !member && lang.keywords.has(kw) ? "keyword" : CONST.has(word) ? "constant" : after === "(" ? "function" : /^[A-Z][a-z]/.test(word) ? "type" : "plain";
      push(kind, word); i += word.length; continue;
    }
    push("plain", ch); i++;
  }
  return [tokens, state];
}

export function highlightLines(text, lang) {
  let state = null;
  return text.replace(/\r$/gm, "").split("\n").map((line) => {
    const [tokens, next] = tokenize(line, lang, state);
    state = next;
    return tokens.map((t) => ({ cls: t.kind === "plain" ? "" : t.kind, text: t.text }));
  });
}
