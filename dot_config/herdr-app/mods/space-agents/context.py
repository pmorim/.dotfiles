# Each Claude Code session's context, subagents and background work, for the sidebar. Run as: python -I -S context.py <pid>...
# Each pid is a terminal's foreground process. Claude Code writes <config>/sessions/<pid>.json naming its session,
# and the session's transcript ends with the latest turn's usage. Prints {"<pid>": {"tokens": n, "model": "..."}},
# leaving out any pid it can't place. Reads at most the last 512 KiB of each transcript and gives up after 5 s.
import json
import os
import re
import signal
import sys
import time
from datetime import datetime

if hasattr(signal, "alarm"):
    signal.alarm(5)
TAIL = 512 * 1024


def config_dirs():
    home = os.path.expanduser("~")
    dirs = [os.environ["CLAUDE_CONFIG_DIR"]] if os.environ.get("CLAUDE_CONFIG_DIR") else []
    try:
        dirs += sorted(os.path.join(home, d) for d in os.listdir(home) if d.startswith(".claude"))
    except OSError:
        pass
    return [d for d in dict.fromkeys(os.path.realpath(d) for d in dirs) if os.path.isdir(os.path.join(d, "sessions"))]


def transcript(config, session):
    cwd = session.get("cwd") or ""
    sid = session.get("sessionId") or ""
    if not re.fullmatch(r"[0-9A-Za-z-]+", sid):
        return None
    path = os.path.join(config, "projects", re.sub(r"[^A-Za-z0-9]", "-", cwd), sid + ".jsonl")
    if os.path.isfile(path):
        return path
    projects = os.path.join(config, "projects")
    try:
        for d in os.listdir(projects):
            p = os.path.join(projects, d, sid + ".jsonl")
            if os.path.isfile(p):
                return p
    except OSError:
        pass
    return None


def latest_usage(path):
    # A long tool output at the end can push the last usage line out of the tail: look further back.
    for tail in (TAIL, TAIL * 8, TAIL * 32):
        found = usage_in_tail(path, tail)
        if found:
            return found
    return None


def usage_in_tail(path, tail):
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - tail))
        lines = f.read().split(b"\n")
    for line in reversed(lines):
        if b'"usage"' not in line:
            continue
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        message = entry.get("message") if isinstance(entry, dict) else None
        if entry.get("type") != "assistant" or entry.get("isSidechain") or not isinstance(message, dict):
            continue
        usage = message.get("usage") or {}
        tokens = sum(int(usage.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
        if tokens > 0:
            return {"tokens": tokens, "model": message.get("model")}
    return None


def stamp(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return 0


def read_lines(path, limit=24 * 1024 * 1024):
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - limit))
        return f.read().decode("utf-8", "replace").split(chr(10))


def parse(line):
    try:
        return json.loads(line)
    except ValueError:
        return None


DONE_NOTICE = re.compile(r"finished</summary>|<status>(killed|failed|stopped)</status>")


def done_signals(lines):
    said = {}
    for line in lines:
        if "<task-id>" not in line and "Successfully stopped task: " not in line:
            continue
        entry = parse(line)
        if not isinstance(entry, dict):
            continue
        at = stamp(entry.get("timestamp"))
        for m in re.finditer(r"<task-id>([a-z0-9]+)</task-id>(.{0,600})", line):
            if DONE_NOTICE.search(m.group(2)):
                said[m.group(1)] = at
        for m in re.finditer(r"Successfully stopped task: ([a-z0-9]+)", line):
            said[m.group(1)] = at
    return said


def subagents(path, said, now):
    folder = path[:-6] + "/subagents"
    found = []
    try:
        names = [n for n in os.listdir(folder) if n.endswith(".meta.json")]
    except OSError:
        return found
    for name in names:
        log = os.path.join(folder, name[: -len(".meta.json")] + ".jsonl")
        try:
            with open(os.path.join(folder, name)) as f:
                meta = json.load(f)
            modified = os.path.getmtime(log)
            tail = read_lines(log, 64 * 1024)
        except (OSError, ValueError):
            continue
        ident = os.path.basename(log)[:-6]
        records = [e for e in map(parse, tail[-20:]) if isinstance(e, dict) and e.get("timestamp")]
        last = stamp(records[-1]["timestamp"]) if records else 0
        with open(log, "rb") as f:
            first = parse(f.readline().decode("utf-8", "replace"))
        start = stamp(first.get("timestamp")) if isinstance(first, dict) else modified
        replied = any('"type":"assistant"' in line.replace(" ", "") for line in tail)
        told = said.get(ident.removeprefix("agent-"))
        done = bool(meta.get("finished")) or (told is not None and last <= told + 5)
        if not done and not replied and now - modified > 120:
            done = True
        if not done:
            found.append({"id": ident, "desc": meta.get("description") or "", "type": meta.get("agentType") or "", "start": start})
    return found


def background(lines, now):
    uses, deleted, wake = {}, set(), ""
    ended = set()
    relevant = []
    for line in lines:
        if not any(k in line for k in ('"name":"', "backgroundTaskId", '"taskId":"', "humanSchedule", "scheduledFor", "<status>", "Monitor expired", "Successfully stopped")):
            continue
        entry = parse(line)
        if not isinstance(entry, dict):
            continue
        relevant.append(entry)
        for m in re.finditer(r"<task-id>([a-z0-9]+)</task-id>(.{0,600})", line):
            if "<status>" in m.group(2) or "Monitor expired" in m.group(2):
                ended.add(m.group(1))
        ended.update(re.findall(r"Successfully stopped task: ([a-z0-9]+)", line))
    for entry in relevant:
        content = (entry.get("message") or {}).get("content")
        if entry.get("type") == "assistant" and isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    uses[block.get("id")] = block
                    if block.get("name") == "CronDelete":
                        deleted.add((block.get("input") or {}).get("id"))
                    if block.get("name") == "ScheduleWakeup":
                        wake = block.get("id")
    found = []
    for entry in relevant:
        result = entry.get("toolUseResult")
        content = (entry.get("message") or {}).get("content")
        if entry.get("type") != "user" or not isinstance(result, dict):
            continue
        ref = content[0].get("tool_use_id") if isinstance(content, list) and content and isinstance(content[0], dict) else ""
        use = uses.get(ref) or {}
        given = use.get("input") or {}
        at = stamp(entry.get("timestamp"))
        if result.get("backgroundTaskId"):
            kind, ident, desc, sched = "shell", result["backgroundTaskId"], given.get("description") or given.get("command") or "Background command", ""
        elif result.get("taskId") and use.get("name") == "Monitor" and at + (result.get("timeoutMs") or 300000) / 1000 > now:
            kind, ident, desc, sched = "monitor", result["taskId"], given.get("description") or "Monitor", ""
        elif result.get("scheduledFor") and use.get("id") == wake and result["scheduledFor"] / 1000 > now:
            kind, ident, desc, sched = "wakeup", use["id"], given.get("reason") or "Wakeup", ""
        elif result.get("humanSchedule") and result.get("id") not in deleted and (result.get("recurring") or (result.get("nextFireAt") or 0) / 1000 > now - 120) and now - at < 7 * 86400:
            kind, ident, desc, sched = "cron", result.get("id"), given.get("prompt") or "", result["humanSchedule"]
        else:
            continue
        if kind in ("shell", "monitor") and ident in ended:
            continue
        found.append({"kind": kind, "id": ident, "desc": " ".join(str(desc).split())[:200], "at": at, "sched": sched})
    return found


def same_folder(a, b):
    return os.path.normcase(os.path.normpath(a or "")) == os.path.normcase(os.path.normpath(b or ""))


def sessions_for(arg, dirs):
    """A pid names its session file; "cwd:<folder>" takes the newest session started in that folder."""
    found = []
    for config in dirs:
        folder = os.path.join(config, "sessions")
        if arg.isdigit():
            names = [arg + ".json"]
        elif arg.startswith("cwd:"):
            try:
                names = [n for n in os.listdir(folder) if re.fullmatch(r"[0-9]+\.json", n)]
            except OSError:
                continue
        else:
            continue
        for name in names:
            path = os.path.join(folder, name)
            try:
                with open(path) as f:
                    session = json.load(f)
                if arg.startswith("cwd:") and not same_folder(session.get("cwd"), arg[4:]):
                    continue
                found.append((session.get("startedAt") or os.path.getmtime(path), config, session))
            except (OSError, ValueError):
                continue
    found.sort(key=lambda item: item[0], reverse=arg.isdigit())
    return [(config, session) for _, config, session in found]


def alive(pid):
    if sys.platform == "win32":
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))
        if not handle:
            return False
        code = ctypes.c_ulong()
        ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return code.value == 259
    try:
        os.kill(int(pid), 0)
        return True
    except PermissionError:
        return True
    except OSError:
        return False


def usage_of(config, session):
    path = transcript(config, session)
    usage = latest_usage(path) if path else None
    if not usage:
        return {"tokens": 0, "model": None, "subs": [], "tasks": []}
    lines = read_lines(path)
    now = time.time()
    usage["subs"] = subagents(path, done_signals(lines), now)
    usage["tasks"] = background(lines, now)
    return usage


def main(args):
    out = {}
    dirs = config_dirs()
    for arg in args:
        found = sessions_for(arg, dirs)
        if arg.startswith("cwd:"):
            # Every live session in that folder, newest first: more than one agent can share a folder.
            found = [(c, s) for c, s in found if alive(s.get("pid") or 0)]
            out[arg] = [usage_of(c, s) for c, s in found]
        else:
            for config, session in found:
                out[arg] = usage_of(config, session)
                break
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1:])
