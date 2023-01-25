#!/bin/sh

# History
HISTFILE=~/.zsh_history
HISTSIZE=1000000
SAVEHIST=1000000

# Path
export PATH="$HOME/.local/bin":$PATH
export PATH="$HOME/.cargo/bin":$PATH
export PATH="$HOME/.local/share/neovim/bin":$PATH

# Other
export EDITOR="nvim"
export TERMINAL="alacritty"
export BROWSER="brave"
export MANPAGER='nvim +Man!'
export MANWIDTH=999

# NVM
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# Zoxide: a better `cd`
eval "$(zoxide init zsh)"

# Starship
eval "$(starship init zsh)"
