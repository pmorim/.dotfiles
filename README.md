<div align="center">
<img src="https://img.shields.io/github/last-commit/pmorim/.dotfiles?style=for-the-badge&logo=github&color=a6da95&logoColor=D9E0EE&labelColor=302D41"/>
<img src="https://img.shields.io/github/repo-size/pmorim/.dotfiles?style=for-the-badge&logo=dropbox&color=7dc4e4&logoColor=D9E0EE&labelColor=302D41"/>
<img src="https://img.shields.io/github/license/pmorim/.dotfiles?style=for-the-badge&logo=powerpages&color=cba6f7&logoColor=D9E0EE&labelColor=302D41"/>
</div>

# 📁 .dotfiles

My personal dotfiles.

## 🖥️ Setup Overview

- **Operating System:** [EndeavourOS](https://endeavouros.com/)
- **Color Palette:** [One Dark](https://github.com/joshdick/onedark.vim)
- **Desktop:**
  - **Window Manager:** [i3wm](https://i3wm.org/) -> updating to [LeftWM](https://github.com/leftwm/leftwm)
  - **Compositor:** [picom](https://github.com/yshui/picom)
  - **App Launcher:** [rofi](https://github.com/davatorium/rofi)
  - **Panel:** [i3blocks](https://github.com/vivien/i3blocks) -> updating to [eww](https://github.com/elkowar/eww)
  - **Notifications:** [dunst](https://dunst-project.org/)
  - **Screenshots:** [main](https://github.com/naelstrof/maim) & [xclip](https://github.com/astrand/xclip)
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
stow <directory-name> # single
stow <directory-1> <directory-2> # multiple
```

## ⭐ Credits

Inspired by:

- [EndeavourOS](https://endeavouros.com/) - the default configs of the OS.
- [chris@machine](https://github.com/ChristianChiarulli/Machfiles) - creator of [LunarVim](https://www.lunarvim.org/) and [Zap](https://www.zapzsh.org/).
- [kabinspace](https://github.com/kabinspace/dotfiles) - creator of [AstroNvim](https://astronvim.github.io/).
