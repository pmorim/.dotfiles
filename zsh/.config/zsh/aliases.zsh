#!/bin/sh

# Colorize grep output (good for log files)
alias grep="grep --color=auto"
alias egrep="egrep --color=auto"
alias fgrep="fgrep --color=auto"

# Confirm before overwriting something
alias cp="cp -i"
alias mv="mv -i"
alias rm="rm -i"

# Easier to read disk
alias df="df -h"      # Human-readable sizes
alias free="free -m"  # Show sizes in MB

# Get top process eating
alias psmem="ps auxf | sort -nr -k 4 | head -5" # Memory
alias pscpu="ps auxf | sort -nr -k 3 | head -5" # CPU

# GPG encryption
alias gpg-check="gpg2 --keyserver-options auto-key-retrieve --verify"
alias gpg-retrieve="gpg2 --keyserver-options auto-key-retrieve --receive-keys"

# Code editors
alias nvimrc="nvim ~/.config/nvim/"

# AMD Drivers update
# https://repo.radeon.com/amdgpu-install/latest/ubuntu/jammy/
alias amd-drivers="sudo sed -i 's/ID=pop/ID=ubuntu/g' /etc/os-release; \
                  amdgpu-install -y --opencl=rocr --vulkan=amdvlk; \
                  sudo sed -i 's/ID=ubuntu/ID=pop/g' /etc/os-release"
