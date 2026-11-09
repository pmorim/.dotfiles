<div align="center">

# dotfiles

My [Claude Code](https://claude.com/claude-code) and [Herdr](https://herdr.dev) setup, one command per machine.

[![Managed with chezmoi](.github/badges/chezmoi.svg)](https://www.chezmoi.io)
[![Windows and macOS](.github/badges/platforms.svg)](#install)
[![For Claude Code and Herdr](.github/badges/apps.svg)](#contents)
[![Scanned with gitleaks](.github/badges/gitleaks.svg)](#secrets)

</div>

## Contents

| In the repo | Applied to | What it is |
|---|---|---|
| `dot_claude/CLAUDE.md` | `~/.claude/CLAUDE.md` | Global instructions |
| `dot_claude/create_settings.json.tmpl` | `~/.claude/settings.json` | Model, plugins, marketplaces, theme. Written once, never overwritten |
| `dot_claude/keybindings.json` | `~/.claude/keybindings.json` | Key bindings |
| `dot_claude/statusline.js` | `~/.claude/statusline.js` | Status line (needs `node`) |
| `dot_claude/skills/` | `~/.claude/skills/` | My own skills |
| `dot_config/herdr-app/keys.json` | `~/.config/herdr-app/keys.json` | Herdr key bindings |
| `dot_config/herdr-app/layouts/` | `~/.config/herdr-app/layouts/` | My Herdr layout |
| `dot_config/herdr-app/mods/` | `~/.config/herdr-app/mods/` | My Herdr mods |

Chezmoi spells a leading dot as `dot_`, so `dot_claude` becomes `.claude`. A file starting with `.` in the repo would be ignored by chezmoi.

Only things I wrote are here. Anything an app ships, generates or rewrites stays out. That covers Herdr's shipped mods, Claude Code's credentials, history and sessions, and tool-installed hooks. Plugins reinstall themselves from `enabledPlugins`.

### Herdr mods

| Mod | Role |
|---|---|
| `filetree` | IDE-style file tree with git status, search and Material Icon Theme icons |
| `my-git` | Git panel: changes, commit graph with actions, stash and review |
| `claude-usage` | Claude plan usage and limits |
| `space-agents` | One sidebar list of spaces with their agents grouped by status |
| `tabs-graph` | Tab bar, cloned from Herdr's `tabs` mod |
| `palette-hint` | Shows the command palette shortcut |

## Install

Install Herdr and Claude Code first and launch each once, so their default files exist.

**Windows**

```powershell
winget install twpayne.chezmoi
chezmoi init --apply pmorim/.dotfiles
```

**macOS**

```sh
brew install chezmoi
chezmoi init --apply pmorim/.dotfiles
```

`init` asks which Herdr mods and Claude skills to install on that machine. On an existing setup, run `chezmoi apply --dry-run --verbose` first to see what would change.

## Pick mods and skills per machine

The answers from `init` live in `~/.config/chezmoi/chezmoi.toml`, outside the repo. Edit the lists and run `chezmoi apply`:

```toml
[data]
  herdr_mods = ["filetree", "my-git"]
  claude_skills = ["unslop"]
```

- A mod or skill that isn't listed is skipped.
- Removing a name stops chezmoi managing it but doesn't delete files already applied.
- Layouts refer to mods by name, so select every mod your layout uses.

## Machine differences

- `settings.json` is only created when missing. Claude Code and other tools (Orca, for example) add hooks to it, and a later `apply` would wipe them. To push a settings change to a machine that has the file, edit it there by hand.
- Templates read the home folder from chezmoi, so no path is hardcoded.

## Everyday use

```sh
chezmoi re-add      # pull live edits of tracked files into the repo
chezmoi add <path>  # track one new file
chezmoi diff        # preview what apply would change
chezmoi cd          # open the repo to commit and push
```

Add files one at a time. Never add `~/.claude` or `~/.config/herdr-app` as a whole.

## Secrets

Nothing secret belongs in this repo.

- `.gitignore` blocks env files, keys, credentials and `.jsonl` logs.
- A gitleaks pre-commit hook scans each commit. Enable it after cloning with `git config core.hooksPath .githooks`. It needs `gitleaks` on your PATH (`winget install Gitleaks.Gitleaks` or `brew install gitleaks`) and blocks commits without it.
- A GitHub Action runs gitleaks on every push and pull request.

A scanner can't tell that a hostname or project name is private. Read `git diff --staged` before each push.

## Credits

- `filetree` is a port of [claude-code-filetree](https://github.com/data-goblin/claude-code-filetree) by Kurt Buhler (MIT) and bundles [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) icons (MIT).
- `space-agents` is a changed copy of Herdr's shipped `spaces` and `agents` mods (Apache-2.0, see its `NOTICE.md`).
- `my-git` is a clone of Herdr's shipped `git` mod, with a reworked graph tab.
- `tabs-graph` is a clone of Herdr's `tabs` mod.

Each mod keeps its own license files.
