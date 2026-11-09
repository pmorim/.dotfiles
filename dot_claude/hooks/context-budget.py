import json
import os
import sys

LIMIT = int(os.environ["DUMB_ZONE_TOKENS"])
WARN = LIMIT * 2 // 3

data = json.load(sys.stdin)
event = data.get("hook_event_name", "PostToolUse")

tokens = 0
try:
    with open(data["transcript_path"]) as f:
        for line in f:
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("isSidechain"):
                continue
            message = entry.get("message")
            usage = message.get("usage") if isinstance(message, dict) else None
            if usage:
                tokens = (
                    usage.get("input_tokens", 0)
                    + usage.get("cache_creation_input_tokens", 0)
                    + usage.get("cache_read_input_tokens", 0)
                )
except (KeyError, OSError):
    sys.exit(0)

if tokens < WARN:
    sys.exit(0)

used = f"{tokens // 1000}k/{LIMIT // 1000}k"
if tokens < LIMIT:
    note = f"Context at {used}. Near the dumb zone: delegate work that would add bulk to this context."
else:
    note = f"Context at {used}, past the dumb zone. Delegate everything except small actions, or write a handoff file and suggest /clear."

print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": note}}))
