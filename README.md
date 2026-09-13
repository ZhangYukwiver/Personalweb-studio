# 张宇个人主页

- `index.html`：页面样式和交互，不用改。
- `content.js`：**所有文字、链接、图片列表**，改这个文件就行（长文用 Markdown）。
- `editor.html`：可视化编辑器，左边改、右边实时预览，可一键发布到 GitHub。
- `assets/`：图片和简历 PDF。

## 线上地址

- 网页：`https://zzzhangyu.hi.cn/`（GitHub Pages 原地址 `https://zhangyukwiver.github.io/Personalweb-studio/` 会自动跳转过来）
- 编辑器：`https://zzzhangyu.hi.cn/editor.html`
- 仓库：`https://github.com/ZhangYukwiver/Personalweb-studio`（`main` 分支根目录就是网站，`CNAME` 文件里是域名，别删）

## 域名解析（DNSPod）

域名 `zzzhangyu.hi.cn` 的 DNS 托管在 DNSPod。在 DNSPod 控制台给这个域名添加下面的记录，主机记录填 `@`：

| 记录类型 | 主机记录 | 记录值 |
| --- | --- | --- |
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

可选：`www` 做 CNAME 指到 `zhangyukwiver.github.io`。记录生效（一般几分钟到一小时）后，GitHub 会自动签发 HTTPS 证书，然后在仓库 Settings → Pages 勾上 “Enforce HTTPS”。

本地改完想推上去（这台 Mac 的 gh 默认账号是 Kerwin-WUKO，推之前先切到 ZhangYukwiver）：

```bash
cd /Users/a0000/Documents/1project/zhangyu-homepage
gh auth switch --user ZhangYukwiver
git add -A && git commit -m "更新内容" && git push
```

## 上线后改内容

1. 打开 `https://zzzhangyu.hi.cn/editor.html`。
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
