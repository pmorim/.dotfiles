# dotfiles

My Claude Code and Herdr setup, managed with [chezmoi](https://www.chezmoi.io). It runs on Windows and macOS.

## What's in it

| Path in repo | Lands in | Holds |
|---|---|---|
| `dot_claude/` | `~/.claude/` | `CLAUDE.md`, keybindings, settings, agents, my own skills, `skills-lock.json` |
| `dot_config/herdr-app/` | `~/.config/herdr-app/` | keys, settings, my layouts, my mods |

Only files I wrote are tracked. Herdr's shipped mods and layouts, its generated files, and everything Claude Code writes at run time (credentials, history, sessions, projects) stay out.

Third-party skills are not copied here. `skills-lock.json` records where they came from, so reinstall them from the source.

## Install

Install Herdr and Claude Code first and launch each once, so their default files exist. Then:

```sh
# macOS
brew install chezmoi
# Windows
winget install twpayne.chezmoi

chezmoi init --apply pmorim/.dotfiles
```

`init` asks which Herdr mods and Claude skills to install on this machine. The answers go to `~/.config/chezmoi/chezmoi.toml`, which is not in the repo.

Run `chezmoi apply --dry-run --verbose` before the first real apply on a machine with existing config.

## Choosing mods and skills per machine

Edit the two lists in `~/.config/chezmoi/chezmoi.toml`, then run `chezmoi apply`:

```toml
[data]
  herdr_mods = ["filetree", "git-graph"]
  claude_skills = ["unslop"]
```

Anything not listed is skipped. Removing a name from a list stops chezmoi managing it but does not delete files it already applied. Delete those by hand.

Layouts reference mods by name. Select every mod a layout uses.

## Machine differences

- `settings.json` is a template. Hooks and the status line are Windows-only because they call Orca, `herdr-revive` and PowerShell.
- Home paths come from `{{ .chezmoi.homeDir }}`. Never hardcode one.
- `statusline.ps1` is skipped on macOS and Linux.

## Everyday use

```sh
chezmoi re-add             # pull live edits of tracked files into the repo
chezmoi add <path>         # track a new file, one at a time
chezmoi diff               # see what apply would change
chezmoi cd                 # open the repo, then commit and push
```

Never add a whole folder such as `~/.claude`. Add the specific files you want.

## Secrets

Nothing secret belongs here. Env files, keys and credentials are blocked by `.gitignore`. A gitleaks pre-commit hook and a GitHub Action scan every change.

Turn the hook on after cloning:

```sh
git config core.hooksPath .githooks
```

It needs `gitleaks` on your PATH (`brew install gitleaks`, `winget install Gitleaks.Gitleaks`). Without it the hook blocks the commit.

Review `git diff --staged` before every push. A scanner can't tell that a hostname or project name is private.
