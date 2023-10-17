#!/bin/sh

# History
HISTFILE=~/.zsh_history
HISTSIZE=1000000
SAVEHIST=1000000

# General Vars
export EDITOR="nvim"
export TERMINAL="alacritty"
export BROWSER="brave"
export MANPAGER="nvim +Man!"
export MANWIDTH=999

# General Paths
export PATH="$HOME/.local/bin":$PATH
export PATH="$HOME/.local/share/neovim/bin":$PATH

# Volta
export VOLTA_HOME="$HOME/.volta"
export PATH="$VOLTA_HOME/bin:$PATH"

# Bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
[ -s "/home/pmorim/.bun/_bun" ] && source "/home/pmorim/.bun/_bun"

# Rust
export PATH="$HOME/.cargo/bin":$PATH

# Odin
export PATH="$HOME/.odin/bin":$PATH

# OCaml
[[ ! -r /home/pmorim/.opam/opam-init/init.zsh ]] || source /home/pmorim/.opam/opam-init/init.zsh  > /dev/null 2> /dev/null

# Starship prompt
eval "$(starship init zsh)"
