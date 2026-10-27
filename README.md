# DSH Plugins 社区

DeepSeek Harness 插件目录。把五个公开来源去重后做成静态站：检索、下载、本机注册登录、上传 zip。

这不是 DeepSeek 官方市场，也不会在页面里执行插件。

## 来源

去重键是小写 `owner/repo`，没有仓库时用 npm 包名。

1. GitHub topic [`dsh-plugin`](https://github.com/topics/dsh-plugin)。搜索接口最多 1000 条，用的是创意工坊同一份快照。
2. [dshmarket](https://dshmarket.com/) format 1。
3. [awesome-dsh-plugin](https://awesome-dsh-plugin.com/) 全量目录，CC0。
4. [创意工坊](https://dsh-plugin.github.io/) 的 topic 快照。
5. [dsh.so](https://www.dsh.so/zh/artifacts/) 精简索引，CC BY 4.0。条目链回原详情页，并保留 `generatedAt`。整库再分发请先联系 hello@dsh.so。

dsh.so 的 L1–L5 只是它自己的标注，本站没有复验。

## 本地

```bash
npm run build
npm start
```

打开 <http://127.0.0.1:4173>。`npm run build` 会读取 `data/raw/`；没有缓存时才重新下载。

示例包：

```bash
npm run pack:example
```

`public/samples/dsh-hello-community-0.1.0.zip` 可以试上传和下载。不要装进正在使用的 profile。

## 账号

注册和登录可用。密码用 PBKDF2-SHA256 存在这台浏览器里，不明文保存。上传的 zip 在 IndexedDB，只有这台浏览器能下载。GitHub Pages 没有共享用户库，所以账号不会在设备之间同步。

## 部署

静态文件在 `public/`。推到 [`ygunoil/dsh-plugins`](https://github.com/ygunoil/dsh-plugins) 的 `main` 后，Actions 会重新拉取四个源，再把 `public/` 发布到 GitHub Pages。同一套构建每小时跑一次。页面上的「同步最新」不等这次构建，直接在浏览器里核对源站。

公开地址：<https://ygunoil.github.io/dsh-plugins/>

本地预览用 <http://localhost:4173/>。应用内浏览器访问 `127.0.0.1` 会被拒绝。

`https://dsh-plugins.github.io/` 仍由组织仓库提供，并 301 到 <https://dsh-plug.in/>。那是组织官网，不要覆盖。
