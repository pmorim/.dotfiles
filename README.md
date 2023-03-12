<div align="center">
<img src="https://img.shields.io/github/last-commit/pmorim/.dotfiles?style=for-the-badge&logo=github&color=a6da95&logoColor=D9E0EE&labelColor=302D41"/>
<img src="https://img.shields.io/github/repo-size/pmorim/.dotfiles?style=for-the-badge&logo=dropbox&color=7dc4e4&logoColor=D9E0EE&labelColor=302D41"/>
<img src="https://img.shields.io/github/license/pmorim/.dotfiles?style=for-the-badge&logo=powerpages&color=cba6f7&logoColor=D9E0EE&labelColor=302D41"/>
</div>

# 📁 .dotfiles

My personal dotfiles.

## 🖥️ Setup Overview

- **Operating System:** [Pop!_OS](https://pop.system76.com/)
- **Color Palette:** [One Dark](https://github.com/joshdick/onedark.vim)
- **Terminal:** [Alacritty](https://alacritty.org/)
  - **Font:** [Hack Nerd Font](https://www.nerdfonts.com/)
  - **Shell:** [zsh](https://github.com/zsh-users/zsh)
    - **Plugin Manager:** [Zap](https://www.zapzsh.org/)
  - **Prompt:** [Starship](https://starship.rs/)
  - **Tool Replacements:**
    - **ls:** [exa](https://github.com/ogham/exa)
    - **cd:** [broot](https://github.com/Canop/broot)
    - **htop:** [bottom](https://github.com/ClementTsang/bottom)
    - **cat:** [bat](https://github.com/sharkdp/bat)
- **Text Editor**: [VSCodium](https://github.com/VSCodium/vscodium) -> updating to [helix](https://helix-editor.com/)

## 📦 Setup

Files are structured to create symlinks using [stow](https://www.gnu.org/software/stow/).

1. Clone the repo

```sh
git clone https://github.com/pmorim/.dotfiles
cd .dotfiles
```

2. Create the symlinks

```sh
# Use all of the dotfiles...
stow */

# ...or choose specific modules
stow <directory> # single
stow <directory-1> <directory-2> <directory-3> # multiple
```

## ⭐ Credits

Inspired by:

- [EndeavourOS](https://endeavouros.com/) - the default configs of the OS.
- [chris@machine](https://github.com/ChristianChiarulli/Machfiles) - creator of [LunarVim](https://www.lunarvim.org/) and [Zap](https://www.zapzsh.org/).
- [kabinspace](https://github.com/kabinspace/dotfiles) - creator of [AstroNvim](https://astronvim.github.io/).
