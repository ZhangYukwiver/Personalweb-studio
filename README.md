# 张宇个人主页

- `index.html`：页面样式和交互，不用改。
- `content.js`：**所有文字、链接、图片列表**，改这个文件就行（长文用 Markdown）。
- `editor.html`：可视化编辑器，左边改、右边实时预览，可一键发布到 GitHub。
- `assets/`：图片和简历 PDF。

## 线上地址

- 仓库：`https://github.com/ZhangYukwiver/Personalweb-studio`（`main` 分支根目录就是网站）
- 网页：`https://zhangyukwiver.github.io/Personalweb-studio/`
- 编辑器：`https://zhangyukwiver.github.io/Personalweb-studio/editor.html`

本地改完想推上去：

```bash
cd /Users/a0000/Documents/1project/zhangyu-homepage
git add -A && git commit -m "更新内容" && git push
```

## 上线后改内容

1. 打开 `https://zhangyukwiver.github.io/Personalweb-studio/editor.html`。
2. 点“发布设置”，填用户名 `ZhangYukwiver`、仓库名 `Personalweb-studio`、分支 `main`，以及一个 Token：
   GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → 只选这个仓库，Permissions 里 Contents 设为 Read and write。Token 只存在你自己浏览器里。
3. 改内容、加图片（自动压缩），右边实时预览；满意后点“发布到 GitHub”，一分钟左右线上更新。
4. 换电脑或清了浏览器数据，重新填一次设置即可；“重新读取”会丢掉本机草稿、按线上内容重来。

## 本地查看

- 直接双击 `index.html` 就能看页面。
- 编辑器的实时预览需要通过本地服务器打开：

```bash
cd /Users/a0000/Documents/1project/zhangyu-homepage && python3 -m http.server 8765
```

然后访问 `http://localhost:8765/editor.html`；本地没法“发布”到本机文件，用“下载 content.js”替换同名文件即可。
