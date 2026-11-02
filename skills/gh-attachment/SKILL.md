---
name: gh-attachment
description: 把本地图片或视频上传成 GitHub 附件（github.com/user-attachments/assets URL），用于 issue/PR 正文和 comment；需要在 GitHub 上展示截图、录屏时使用。
---

# gh-attachment

```bash
~/.claude/skills/gh-attachment/bin/gh-attachment <owner/repo> <file>...
```

- 每个文件输出一行 `https://github.com/user-attachments/assets/<uuid>`，按参数顺序；在 markdown 里用 `![说明](<URL>)` 或 `<img src="<URL>">` 引用。
- 只收媒体：png、jpg、jpeg、gif、webp、svg、mp4、mov、webm。日志等文本不上传，直接把内容写进正文或 comment。
- `<owner/repo>` 是要展示附件的 repo：附件的可见性跟随该 repo，私有 repo 的附件只有能读该 repo 的人看得到。上传需要该 repo 的写权限。
- 凭据由 `gh` 自己注入（当前 `gh auth` 账号），脚本不读取、不打印 token。
- 上传成功但从未被正文或 comment 引用的附件，别人可能看不到；拿到 URL 后要发布出去。
- 退出码：`0` 全部成功；`1` 上传失败（404 通常是没有写权限，或该 token 类型不被附件接口接受）；`2` 用法错误（参数、文件类型、超出大小）。所有文件先校验再上传。
- `ghc ev run --artifacts` / `ghc ev attach` 通过本脚本上传证据截图（见 `skill://gh-contract`）。
