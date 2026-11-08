# dotfiles

Managed with [chezmoi](https://www.chezmoi.io). Covers Claude Code and the Herdr app.

```sh
chezmoi init --apply pmorim/.dotfiles
```

`init` asks which Herdr mods and Claude skills to install on the machine. The answers live in `~/.config/chezmoi/chezmoi.toml`, outside the repo. Change them there and run `chezmoi apply`.

Secrets never go in this repo. A gitleaks pre-commit hook (`git config core.hooksPath .githooks`) and a CI scan back that up.
