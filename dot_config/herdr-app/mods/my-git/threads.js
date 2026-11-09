import { exec } from "herdr";

const QUERY = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved isOutdated path line originalLine diffSide comments(first:30){nodes{author{login} body createdAt}}}}}}}";

export async function fetchThreads(root, on) {
  const gh = (args) => exec("gh", args, { cwd: root, on });
  const [pr, repo] = await Promise.all([
    gh(["pr", "view", "--json", "number", "-q", ".number"]),
    gh(["repo", "view", "--json", "owner,name", "-q", '.owner.login+"/"+.name']),
  ]);
  if (pr.code !== 0 || repo.code !== 0) return [];
  const [owner, name] = repo.stdout.trim().split("/");
  const r = await gh(["api", "graphql", "-f", `query=${QUERY}`, "-f", `owner=${owner}`, "-f", `name=${name}`, "-F", `number=${pr.stdout.trim()}`]);
  if (r.code !== 0) return [];
  try { return JSON.parse(r.stdout).data.repository.pullRequest.reviewThreads.nodes; }
  catch { return []; }
}

export function ago(iso) {
  const minutes = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 43200) return `${Math.floor(minutes / 1440)}d`;
  return `${Math.floor(minutes / 43200)}mo`;
}

function wrap(text, cols) {
  return text.replace(/\r/g, "").split("\n").flatMap((line) => {
    if (line.length <= cols) return [line || " "];
    const out = [];
    let rest = line;
    while (rest.length > cols) {
      let cut = rest.lastIndexOf(" ", cols);
      if (cut < cols / 2) cut = cols;
      out.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
    return out;
  });
}

// A thread as fixed-height rows, so it can sit between diff lines in the virtual list.
export function threadRows(thread, id, open, cols) {
  const comments = thread.comments.nodes, first = comments[0];
  if (!first) return [];
  const base = { thread: id, resolved: thread.isResolved, outdated: thread.isOutdated };
  const head = { ...base, kind: "th", h: 26, author: first.author?.login ?? "ghost", when: ago(first.createdAt), count: comments.length };
  if (thread.isResolved && !open) return [{ ...head, summary: first.body.split("\n")[0].slice(0, 120) }];
  const rows = [head];
  comments.forEach((c, i) => {
    if (i > 0) rows.push({ ...base, kind: "tc", h: 22, author: c.author?.login ?? "ghost", when: ago(c.createdAt) });
    for (const text of wrap(c.body, cols)) rows.push({ ...base, kind: "tb", h: 20, text });
  });
  rows.push({ ...base, kind: "ts", h: 8 });
  return rows;
}
