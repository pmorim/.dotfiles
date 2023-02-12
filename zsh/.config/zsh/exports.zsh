#!/bin/sh

# History
HISTFILE=~/.zsh_history
HISTSIZE=1000000
SAVEHIST=1000000

# General
export EDITOR="nvim"
export TERMINAL="alacritty"
export BROWSER="brave"
export MANPAGER="nvim +Man!"
export MANWIDTH=999

# Path
export PATH="$HOME/.local/bin":$PATH
export PATH="$HOME/.cargo/bin":$PATH
export PATH="$HOME/.local/share/neovim/bin":$PATH

# SSH
export SSH_AUTH_SOCK="$XDG_RUNTIME_DIR/ssh-agent.socket"

# Node Version Manager
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# Zoxide: a better `cd`
eval "$(zoxide init zsh)"

# Starship prompt
eval "$(starship init zsh)"
