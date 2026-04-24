---
title: 特性
description: 用上 browser-cli 之后，你白赚到的东西 —— 并发隔离、自愈 selector、自带 Chrome、定时 feed、可分享的 workflow。
---

[介绍](/zh-cn/introduction/)页讲的是 browser-cli *是什么*。这一页讲的是你用上它之后白赚到哪些东西。

## 并发 workflow 不会互相踩

在五个不同网站上同时跑五个 workflow，不应该把任何一个的 session 搞坏。browser-cli 天然保证这点，你根本不用想。

每次 workflow 运行都会拿到一个形如 `bc-{pid}-{base36-timestamp}` 的唯一 CDP client ID，拼到 Playwriter 的 relay 路径后面。Playwriter 会为每个 client ID 起一个全新的浏览器 context，底下还是同一个 Chrome profile。cookie 和 local storage 在各个 context 之间共享（所以每次运行都是已登录状态），但每个 context 有自己的 page、自己的内存态、自己的生命周期。

实际效果：Telegram 抓取、GitHub 通知、商品价格监控可以在同一分钟一起跑，谁也不会踩到谁的 tab、共用半加载好的页面、或者看到别人的下载。隔离是免费且自动的。

## Stagehand 自愈吸收 DOM 漂移

传统 Playwright 脚本在网站改一个 CSS class 的瞬间就挂了。browser-cli 默认打开 Stagehand 的 `selfHeal: true`。

机制很简单。当 `stagehand.act("click the 'Export' button")` 跑起来时，Stagehand 让 LLM 基于活 DOM 解析这条指令，把解析出来的 selector 缓存到 `~/.browser-cli/.cache/`，下次直接复用。如果缓存的 selector 失败了 —— 因为按钮挪了、class 改名了、组件重渲染了 —— Stagehand 会透明地再问一次 LLM，挑一个新的 selector，更新缓存。你的 workflow 继续跑，只有你翻日志时才看得到。

这也是为什么[设计哲学](/zh-cn/philosophy/)页引导你：任何要碰 DOM 的交互都交给 Stagehand —— selector 漂移变成一次 cache miss，而不是崩溃。

## 自带 Chrome

默认的 CDP 目标是 Playwriter 的本地 relay（`ws://127.0.0.1:19988/cdp/{clientId}`），用你日常的 Chrome。这也是我们推荐的路径，因为它继承你真实的指纹和真实的 session。

但你可以把任何一次 run 指到任意 CDP endpoint：

- 命令行加 `--cdp-url ws://...` 对单次 run 生效。
- 环境变量 `BROWSER_CLI_CDP_URL=...`（或写到 `~/.browser-cli/.env`）全局覆盖。

解析器支持 `ws://`、`wss://`、`http://`、`https://`。把它指到一个指纹浏览器（AdsPower、Multilogin），VPS 上的远程 Chrome，容器里的 headless 实例 —— 随你。workflow 代码不用改；只有目标 endpoint 变。

## 定时 feed 和变化检测，开箱即用

[task](/zh-cn/concepts/task/) 系统根据你是否设置 `itemKey`，把任何 workflow 变成 Atom RSS feed，或者变化检测告警。

- **feed 模式（items）**：workflow 返回数组，daemon 按 key 去重，新条目写入 `~/.browser-cli/feeds/<task>.xml` —— 任何阅读器都能直接订阅。
- **告警模式（snapshots）**：workflow 返回任意 JSON，daemon 做哈希，hash 变了就带着前后对比通知你。

两种模式共用同一套 cron 调度、同一批通知通道（Telegram、Discord、Slack、email、webhook —— [apprise](https://github.com/caronc/apprise) 支持的都能用）、同一套失败上报。你配置 task 一次，daemon 帮你处理重试、状态、feed 和推送。

## 订阅：以 git 仓库形式分享 workflow

workflow 就是一个 git 仓库里的 TypeScript 文件，天然易分享。

```
browser-cli sub add https://github.com/friend/their-workflows --name friend
browser-cli run friend/twitter-bookmarks
```

订阅的仓库 clone 到 `~/.browser-cli-subs/<name>/`，按惯例是**只读**的 —— `browser-cli sub update` 会拉新 commit 但不动你本地的改动。你想把某个订阅的 workflow fork 成可编辑版本时，`browser-cli sub copy friend/twitter-bookmarks my-twitter` 会把它复制到你自己的 `~/.browser-cli/workflows/`，从那儿开始分叉。

`~/.browser-cli/subs.json` 里的注册表记录订阅的仓库、对应的 revision、以及软链接指向哪里。

## 一切都是 git 仓库

你第一次跑 CLI 时，`~/.browser-cli/` 本身就被初始化为一个 git 仓库。你的 workflow、task、notification 都在被 track 的文件里。`browser-cli sync` 以合理的信息提交任何变动，让你 push 到自己的 remote 做备份和迁移。

这是最便宜的「云同步」：数据是纯文本，历史是 `git log`，换新机器就 `git clone` 加 `browser-cli init`。
