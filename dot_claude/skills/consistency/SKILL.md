---
name: consistency
description: Consistency with existing code. Use before writing or changing code in an existing codebase.
---

# Consistency

Match the codebase. Consistency beats reinventing the wheel.

1. Find the closest existing code to what you are writing, in the same layer and package. Name at least two files.
2. If they disagree, prefer the most recently created. Check with `git log --diff-filter=A --format=%cs -- <file>`. Old files that were only edited recently still count as old.
3. Copy its structure, naming, helpers and style. Use an existing helper before writing a new one.
4. Deviate only when the precedent is a bug or cannot do the job. Say what differs and why.

Leave unrelated old code alone.
