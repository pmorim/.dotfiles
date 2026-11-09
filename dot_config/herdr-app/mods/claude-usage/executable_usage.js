import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, exec, home, readTextFile } from "herdr";

const WINDOWS = [{ key: "five_hour", label: "5h", span: 5 * 3600 }, { key: "seven_day", label: "7d", span: 7 * 86400 }];

// One gap inside a group (label, bar, percentage, countdown) and a wider one between groups.
const INNER_GAP = 8, GROUP_GAP = 24;

// Seconds as "3h 54m", "6d 23h", "12m".
const left = (s) => s < 3600 ? `${Math.max(1, Math.floor(s / 60))}m` : s < 86400 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;

const money = (m) => `$${Math.floor(m.amount_minor / 10 ** m.exponent)}`;

// Share of this month's weekdays that have started, today included.
function monthPace() {
  const now = new Date();
  const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  let total = 0, elapsed = 0;
  for (let d = 1; d <= days; d++) {
    const weekday = new Date(now.getFullYear(), now.getMonth(), d).getDay();
    if (weekday === 0 || weekday === 6) continue;
    total++;
    if (d <= now.getDate()) elapsed++;
  }
  return { fraction: elapsed / total, percent: Math.round((elapsed / total) * 100), elapsed, total };
}

const REFRESH_MS = 5 * 60000, RETRY_BASE_MS = 15000, RETRY_MAX_MS = 10 * 60000, EVENT_MIN_GAP_MS = 60000, CACHE_KEY = "usage-cache";

export class Usage {
  failures = 0;
  fetchedAt = 0;
  retryAt = 0;
  statuses = new Map();
  loading = false;

  start(cx) {
    this.restore();
    cx.spawn(async (cx) => {
      for (;;) {
        const wait = this.nextFetchAt() - Date.now();
        if (wait > 0) await cx.sleep(wait);
        await this.load();
        cx.notify();
      }
    });
  }

  // A Claude agent leaving "working" means a turn just finished, which is when usage changes.
  onAgents(cx) {
    const now = new Map();
    let finished = false;
    for (const a of agents()) {
      if (!a.app?.includes("claude")) continue;
      now.set(a.address, a.status);
      if (this.statuses.get(a.address) === "working" && a.status !== "working") finished = true;
    }
    this.statuses = now;
    const quiet = Date.now() - this.fetchedAt >= EVENT_MIN_GAP_MS;
    if (!finished || !quiet || this.failures > 0 || this.loading) return;
    cx.spawn(async (cx) => {
      await this.load();
      cx.notify();
    });
  }

  restore() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (!cached?.limits) return;
      this.plan = cached.plan;
      this.limits = cached.limits;
      this.spend = cached.spend;
      this.fetchedAt = cached.fetchedAt;
    } catch {}
  }

  persist() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ plan: this.plan, limits: this.limits, spend: this.spend, fetchedAt: this.fetchedAt }));
    } catch {}
  }

  // Normally every REFRESH_MS, or just after a window resets, since its percentage drops to zero then.
  nextFetchAt() {
    if (this.failures > 0) return this.retryAt;
    const due = this.fetchedAt + REFRESH_MS;
    const resets = (this.limits ?? []).map((l) => l.resetsAt * 1000 + 5000).filter((at) => at > this.fetchedAt && at < due);
    return Math.min(due, ...resets);
  }

  fail(error, retryAfterSeconds) {
    this.stale = true;
    this.error = error;
    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** this.failures);
    const jitter = 1 + Math.random() * 0.2;
    this.failures += 1;
    this.retryAt = Date.now() + Math.max(backoff * jitter, (retryAfterSeconds || 0) * 1000);
  }

  // macOS keeps Claude Code's login in the Keychain; Linux and Windows use the credentials file.
  async readAuth() {
    const keychain = await exec("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"]).catch(() => null);
    const raw = keychain?.code === 0 ? keychain.stdout : await readTextFile(`${home()}/.claude/.credentials.json`);
    return JSON.parse(raw).claudeAiOauth;
  }

  // Same call Claude Code's /usage makes, with the login it already holds. Never writes the credentials.
  async load() {
    this.loading = true;
    try {
      const auth = await this.readAuth();
      const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: { Authorization: `Bearer ${auth.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
      });
      if (!res.ok) return this.fail(`HTTP ${res.status}`, Number(res.headers?.get?.("retry-after")));
      const data = await res.json();
      this.plan = auth.subscriptionType ? auth.subscriptionType.replace(/^\w/, (c) => c.toUpperCase()) : null;
      this.spend = data.spend?.enabled && data.spend.used && data.spend.limit
        ? { used: data.spend.used, limit: data.spend.limit, percent: Math.max(0, Math.min(100, data.spend.percent ?? 0)) }
        : null;
      this.limits = WINDOWS.filter((w) => data[w.key]).map((w) => ({
        ...w,
        used: Math.max(0, Math.min(100, data[w.key].utilization ?? 0)),
        resetsAt: data[w.key].resets_at ? Date.parse(data[w.key].resets_at) / 1000 : null,
      }));
      this.fetchedAt = Date.now();
      this.failures = 0;
      this.stale = false;
      this.error = null;
      this.persist();
    } catch (e) {
      this.fail(String(e.message ?? e));
    } finally {
      this.loading = false;
    }
  }

  color(t, used) {
    return used >= 80 ? t.ansi1 : used >= 50 ? t.ansi3 : t.ansi2;
  }

  items(t) {
    if (!this.limits && !this.spend) {
      return this.error ? [div().id("usage-claude").whitespace_nowrap().text_color(t.dim).tooltip(`Couldn't load usage: ${this.error}. Retrying with backoff.`).child(`Claude usage unavailable (${this.error})`)] : [];
    }
    const now = Date.now() / 1000, W = 56;
    const row = h_flex().id("usage-claude").flex_none().gap(GROUP_GAP).items_center()
      .child(h_flex().gap(INNER_GAP).items_center()
        .child(div().whitespace_nowrap().text_color(t.muted).child("Claude"))
        .when(Boolean(this.plan), (el) => el.child(div().px(5).py(1).rounded(4).bg(t.raised).text_size(10.5).text_color(t.accent).child(this.plan))));
    for (const l of this.limits ?? []) {
      const over = l.resetsAt && l.resetsAt <= now;
      const used = over ? 0 : l.used;
      const remaining = l.resetsAt && !over ? l.resetsAt - now : null;
      const pace = remaining != null ? Math.min(1, Math.max(0, 1 - remaining / l.span)) : null;
      const color = this.color(t, used);
      const bar = div().relative().w(W).h(5).rounded(3).bg(t.raised)
        .child(div().h(5).rounded(3).w(Math.max(used > 0 ? 3 : 0, (used / 100) * W)).bg(color))
        .when(pace != null, (el) => el.child(div().absolute().top(-2).left(Math.min(W - 1, pace * W)).w(1).h(9).rounded(1).bg(t.foreground)));
      const tip = [
        `${l.label}: ${Math.round(used)}% used`,
        remaining != null && `Resets in ${left(remaining)}`,
        this.stale && "Couldn't refresh, showing the last values.",
      ].filter(Boolean).join("\n");
      row.child(h_flex().id(`usage-${l.key}`).gap(INNER_GAP).items_center().tooltip(tip)
        .child(div().whitespace_nowrap().text_color(t.dim).child(l.label))
        .child(bar)
        .child(div().whitespace_nowrap().text_color(color).child(`${Math.round(used)}%`))
        .child(div().whitespace_nowrap().text_color(t.dim).child(remaining != null ? left(remaining) : "")));
    }
    if (this.spend) {
      const color = this.color(t, this.spend.percent);
      const pace = monthPace();
      const tip = [`Monthly spend: ${money(this.spend.used)} of ${money(this.spend.limit)}`, `Pace: ${pace.percent}% (weekday ${pace.elapsed} of ${pace.total})`, this.stale && "Couldn't refresh, showing the last values."].filter(Boolean).join("\n");
      row.child(h_flex().id("usage-spend").gap(INNER_GAP).items_center().tooltip(tip)
        .child(div().whitespace_nowrap().text_color(t.dim).child("Monthly"))
        .child(div().relative().w(W).h(5).rounded(3).bg(t.raised)
          .child(div().h(5).rounded(3).w(Math.max(this.spend.percent > 0 ? 3 : 0, (this.spend.percent / 100) * W)).bg(color))
          .child(div().absolute().top(-2).left(Math.min(W - 1, pace.fraction * W)).w(1).h(9).rounded(1).bg(t.foreground)))
        .child(div().whitespace_nowrap().text_color(color).child(`${Math.round(this.spend.percent)}%`))
        .child(div().whitespace_nowrap().text_color(t.dim).child(`${money(this.spend.used)} / ${money(this.spend.limit)}`)));
    }
    return [row];
  }
}
