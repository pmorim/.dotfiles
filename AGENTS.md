# Agent instructions

This repo is a chezmoi source directory for Claude Code and Herdr config. It is public.

## Rules

- Never commit secrets, tokens, `.env*` files, credentials, history or session data.
- Never hardcode a home path or username. Use `{{ .chezmoi.homeDir }}` in templates.
- Track files one at a time with `chezmoi add <path>`. Never add `~/.claude` or `~/.config/herdr-app` as a whole.
- Don't track what the apps generate or ship. That means Herdr's shipped mods and layouts, `gpui-kit.d.ts`, `jsconfig.json`, Claude's runtime folders, and third-party skills.
- Keep Windows-only and macOS-only settings behind `.chezmoi.os` conditions.

## Layout

- `dot_claude/` becomes `~/.claude/`.
- `dot_config/herdr-app/` becomes `~/.config/herdr-app/`.
- `.chezmoiignore` drops unselected mods and skills. The selection lists live in `~/.config/chezmoi/chezmoi.toml`, outside the repo.
- `AGENTS.md`, `CLAUDE.md` and `README.md` are for this repo only and are ignored by chezmoi.

## Before you commit

1. Run `chezmoi diff` and `chezmoi apply --dry-run --verbose`.
2. Run `gitleaks dir . --redact --no-banner`.
3. Read `git diff --staged`.

The pre-commit hook runs gitleaks too. Don't bypass it.

## Writing

Keep docs short and plain. Comment code only when it can't speak for itself.
