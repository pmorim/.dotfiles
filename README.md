<div align="center">
<img src="https://img.shields.io/github/last-commit/pmorim/.dotfiles?style=for-the-badge&logo=github&color=a6da95&logoColor=D9E0EE&labelColor=302D41"/>
<img src="https://img.shields.io/github/repo-size/pmorim/.dotfiles?style=for-the-badge&logo=dropbox&color=7dc4e4&logoColor=D9E0EE&labelColor=302D41"/>
<img src="https://img.shields.io/github/license/pmorim/.dotfiles?style=for-the-badge&logo=powerpages&color=cba6f7&logoColor=D9E0EE&labelColor=302D41"/>
</div>

# 📁 .dotfiles

My personal dotfiles.

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

# ...or just one module
stow <module>
```

## ⭐ Credits

Inspired by:

- [chris@machine](https://github.com/ChristianChiarulli/Machfiles) - creator of [LunarVim](https://www.lunarvim.org/) and [Zap](https://www.zapzsh.org/).
- [kabinspace](https://github.com/kabinspace/dotfiles) - creator of [AstroNvim](https://astronvim.github.io/).
