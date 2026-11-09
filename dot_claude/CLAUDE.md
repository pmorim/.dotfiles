# Global Instructions

## Writing Text

Make sure to always have the `/unslop` skill in context.

For all agents and subagents, no matter the task.

## Comments

You should avoid commenting as much as possible.
Leave it for the cases where it is strictly necessary.

1. The code should aim to be self explanatory.
2. When not possible, use assertions for documentation.
3. When not possible, leave a short comment with the `/unslop` skill.

## Context budget

Quality drops once the context passes a token limit (the dumb zone), set by `DUMB_ZONE_TOKENS` in `settings.json`. Aim to stay well under it.

- Before any step, ask how much it will add to this context and whether I need that material later or only its conclusion.
- If only the conclusion matters, hand the step to a subagent and ask for a short answer with file paths and line numbers for anything I may need to reread.
- Keep work inline when it depends on the conversation so far or when the output is small.
- A hook injects the current usage once it reaches two thirds of the limit. At that point delegate by default. Past the limit, write a handoff file under `.claude/scratch/` and suggest `/clear`.
