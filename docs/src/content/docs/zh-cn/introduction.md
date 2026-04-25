---
title: 介绍
description: browser-cli 是什么、给谁用，以及它背后的思路。
---

**browser-cli** 在你已登录的 Chrome 上运行 TypeScript 自动化 workflow。你写一个文件，CLI 跑它，你拿到想要的数据 —— 不用搭爬虫集群、不用维护一堆脆弱的 selector，也不用租一台机器养 cron job。

## 它解决什么问题

互联网的很大一部分已经悄悄变成「没有浏览器就只读」了。网站砍掉 RSS feed。公开 API 消失到鉴权墙后面。以前直接吐 HTML 的页面，如今启动一个 SPA，从私有 JSON 接口 hydrate。数据还在那儿 —— 只是锁在 *你的* session、你的 cookie、你的 Chrome profile 后面。

常见的绕路办法都各有毛病：

- **Headless 爬虫集群** 不知道你是谁。它们被限速、被指纹识别、被挑战、被封。
- **定制的 Playwright 脚本** 在网站改一个 CSS class 的瞬间就废了。
- **云端调度器**（Lambda、VPS 上的 cron）为了一行抓取代码逼你维护一整套基础设施。

browser-cli 站在这些方案的下面一层。它通过本地 CDP relay 自动化 *你自己* 的真实 Chrome，所以网站看到的 session 跟你亲自访问时一模一样。workflow 是 TypeScript 文件。调度器就是你笔记本或已有服务器上的一个 daemon。网站 DOM 变了，Stagehand 基于 LLM 的 selector 会自动适应，不会像脆弱的查询那样崩。

## 它适合谁

- **自动化自己账号的开发者。** 你想从 GitHub、银行、公司内部 dashboard、邮箱这些你本人登录过的地方拉数据。不是 bot，就是你自己，只是按点定时做一下。
- **RSS DIY 党。** 那些停掉 feed 的网站（Twitter/X、Medium、论坛）可以用一份 task 配置重新做成 Atom feed。
- **不想搞运维的定时抓取。** 不要 Kubernetes，不要 Lambda 冷启动。一台笔记本、一个 Chrome、一个 `browser-cli daemon` 就够了。
- **Code agent 用户。** browser-cli 自带一个 skill，支持 Claude Code、Codex、OpenCode。你在对话里描述需求，agent 帮你起草、运行、调试 workflow —— 不用手写。

## 它*不*适合谁

- **大规模匿名爬取。** browser-cli 依赖你真实的 session 和真实的指纹。它没有多账号轮换，没有代理池，没有反检测层。这是设计上的取舍。
- **商业化数据采集。** 一台机器、一个浏览器、一个用户。架构不会横向扩展，我们也不打算让它扩展。
- **bot 框架。** 没有内置的拟人化，没有点击抖动，没有图灵规避。如果一个网站主动反 bot，你会输。

## 心智模型

你写一个 **workflow** —— 一个 TypeScript 文件，导出一个描述参数的 Zod schema 和一个异步的 `run(browser, args)` 函数。CLI 加载文件、校验参数、把一个开箱即用的 `Browser` 包装器交给你，然后让开。浏览器生命周期不用你管，runner 管。

`run` 里面，你挑能干完这事的最轻量工具。不需要浏览器时直接用公共 `fetch`。页面自己已经在拉 JSON，就用 [网络拦截](/zh-cn/philosophy/#layer-1--拦截网络)（`page.captureResponses`、`page.fetch`）。DOM 是唯一通路且 selector 可能漂移时，用 [Stagehand 的 LLM 驱动](/zh-cn/philosophy/#layer-2--stagehand-处理-dom) `page.act` 和 `page.extract`。[设计哲学](/zh-cn/philosophy/)那页把这套分诊讲透了 —— 这是我们最在意的东西。

你可以用 `browser-cli run <name>` 直接跑一个 workflow，也可以用一个 **task** 把它包起来 —— 一份小配置，把 workflow 绑到 cron 计划上，对结果去重，写出 Atom feed，新条目或页面变化时提醒你。task 就是让一次性 workflow 变成 feed 和告警的方式。

一个 **daemon**（`browser-cli daemon --detach`）在后台跑 task。状态存在 `~/.browser-cli/` 下的 SQLite 里。home 目录是一个 git 仓库，你的 workflow、task 和历史都有版本、能 diff、能迁移。

就这些。四个部件：**workflow**（做什么）、**task**（什么时候做 + 怎么追踪）、**daemon**（循环）、**Stagehand**（DOM 安全网）。这些文档里其他内容都是细节。
