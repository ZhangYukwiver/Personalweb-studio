# 主页工坊

一个面向 macOS 和 Windows 的离线个人主页生成器。填写资料、作品与联系方式，即可实时预览并导出独立的 `index.html` 文件。

## 本地开发

```bash
npm install
npm run dev
```

## 桌面应用

Tauri 需要 Rust 工具链。安装后可运行：

```bash
npm run tauri dev
npm run tauri build
```

安装包为未签名测试版。macOS 用户可能需在“系统设置 > 隐私与安全性”中允许打开；Windows 用户可能看到 SmartScreen 提示。

## 发布测试版

推送形如 `v0.1.0` 的 Git 标签会触发 GitHub Actions，在 GitHub Releases 中创建草稿预发布，生成 macOS `.dmg` 和 Windows `.exe` 安装包。发布前请在 GitHub 中检查下载文件和说明。
