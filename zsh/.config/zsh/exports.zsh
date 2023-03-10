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

# Volta (Node.js version manager)
export VOLTA_HOME="$HOME/.volta"

# Path
export PATH="$HOME/.local/bin":$PATH
export PATH="$HOME/.cargo/bin":$PATH
export PATH="$HOME/.local/share/neovim/bin":$PATH
export PATH="$VOLTA_HOME/bin:$PATH"

# Starship prompt
eval "$(starship init zsh)"
