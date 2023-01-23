#!/bin/sh

# Colorize grep output (good for log files)
alias grep='grep --color=auto'
alias egrep='egrep --color=auto'
alias fgrep='fgrep --color=auto'

# Confirm before overwriting something
alias cp="cp -i"
alias mv='mv -i'
alias rm='rm -i'

# Easier to read disk
alias df='df -h'      # Human-readable sizes
alias free='free -m'  # Show sizes in MB

# Get top process eating:
alias psmem='ps auxf | sort -nr -k 4 | head -5' # Memory
alias pscpu='ps auxf | sort -nr -k 3 | head -5' # CPU

# GPG encryption
alias gpg-check="gpg2 --keyserver-options auto-key-retrieve --verify"
alias gpg-retrieve="gpg2 --keyserver-options auto-key-retrieve --receive-keys"

# Other
alias g='lazygit'
alias zsh-update-plugins="find "$ZDOTDIR/plugins" -type d -exec test -e '{}/.git' ';' -print0 | xargs -I {} -0 git -C {} pull -q"
alias nvimrc='nvim ~/.config/nvim/'
alias yay="paru"
