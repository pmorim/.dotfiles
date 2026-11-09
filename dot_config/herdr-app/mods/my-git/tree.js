export const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

// VS Code style: nested folders, a chain of single-child folders shown as one row ("src/a/b").
// `all` ignores collapsed folders (used to collect every folder key).
export function buildRows(list, { flat, collapsed, section, all }) {
  const keyOf = (path) => `${section}:${path}`;
  if (flat) {
    return [...list].sort((x, y) => x.path.localeCompare(y.path)).map((f) => {
      const at = f.path.lastIndexOf("/");
      return { dir: false, file: { ...f, name: f.path.slice(at + 1), parent: at > 0 ? f.path.slice(0, at) : "" }, depth: 0 };
    });
  }
  const root = { dirs: new Map(), files: [] };
  for (const f of list) {
    const parts = f.path.split("/"), name = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ ...f, name });
  }
  const count = (n) => n.files.length + [...n.dirs.values()].reduce((c, d) => c + count(d), 0);
  const out = [];
  const walk = (node, prefix, depth) => {
    const dirs = [...node.dirs].sort(([x], [y]) => x.localeCompare(y));
    for (let [name, child] of dirs) {
      let label = name;
      while (child.files.length === 0 && child.dirs.size === 1) {
        const [[next, sub]] = child.dirs;
        label += `/${next}`; child = sub;
      }
      const path = prefix ? `${prefix}/${label}` : label;
      out.push({ dir: true, label, path, key: keyOf(path), depth, count: count(child), files: collectFiles(child) });
      if (all || !collapsed.has(keyOf(path))) walk(child, path, depth + 1);
    }
    for (const f of node.files.sort((x, y) => x.name.localeCompare(y.name))) out.push({ dir: false, file: f, depth });
  };
  walk(root, "", 0);
  return out;
}

function collectFiles(node) {
  return [...node.files, ...[...node.dirs.values()].flatMap(collectFiles)];
}
