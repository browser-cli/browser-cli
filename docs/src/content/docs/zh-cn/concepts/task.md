---
title: Task
description: 对 workflow 的一层定时、有状态的封装 —— 对数组 items 按 key 去重写入 Atom feed，或者对 snapshot 哈希后在变化时通知你。
---

**task** 是让一次性 [workflow](/zh-cn/concepts/workflow/) 变成定时作业的方式。它是一份小配置，把 workflow 绑到 cron 计划上、记住上次看到的内容、在东西变了时给出有用的输出 —— 一条新 RSS item、一次通知、一个 diff。

workflow 回答*做什么*。task 回答*什么时候做、怎么追踪结果、通知谁*。

## 它的形状

一个 task 是一个 TypeScript 文件，导出单个 `config`：

```ts
export type TaskConfig = {
  workflow: string                  // name of the workflow to run
  args?: Record<string, unknown>    // arguments passed to workflow.run
  schedule: string                  // cron expression
  itemKey?: string                  // presence decides the mode (see below)
  output?: { rss?: RssConfig }      // optional Atom feed
  notify?: NotifyConfig             // notification channels
}
```

task 文件住在 `~/.browser-cli/tasks/<name>.ts`。文件名就是 task 名（`browser-cli task show hn-monitor`）。

## 两种模式：items 和 snapshot

一个 task 在 **items 模式**还是 **snapshot 模式**，取决于一个字段：`itemKey`。

**items 模式**（设了 `itemKey`）。workflow 被期望返回一个*数组*。每个元素必须携带一个以你给 `itemKey` 的名字命名的字段（一般是 `url` 或 `id`）。daemon 对照这个 task 见过的一切去重，把新的存进 SQLite，可选地写入 `~/.browser-cli/feeds/<name>.xml` 下的 Atom 1.0 feed，用「*X 条新条目*」加预览通知你。这种模式用于「给我一个新东西的 feed」—— Hacker News、论坛帖子、招聘信息。

**snapshot 模式**（没设 `itemKey`）。workflow 返回任意 JSON 可序列化的值。daemon 把输出稳定 stringify，做 SHA-256，和上次存的哈希比。哈希变了，就存下新的 snapshot 并带着前后 payload 通知你。这种模式用于「这个东西变了告诉我」—— 某个商品的价格、库存横幅、状态页。

整个概念就这么分岔。同一套 daemon、同一套调度器、同一套通知系统；唯一区别就是 `itemKey` 有没有定义。

## 调度

`schedule` 是一条标准 cron 表达式，由 [`croner`](https://github.com/hexagon/croner) 解析：`'*/15 * * * *'` 是每 15 分钟，`'0 9 * * *'` 是每天早上 9 点。daemon（`browser-cli daemon`，或加 `--detach` 后台跑）在该醒的时候醒来，找出 `nextRunAt` 已过的 task，跑它们。每次跑完重算下次触发时间，更新数据库。

## 状态

状态住在 `~/.browser-cli/db.sqlite`（通过 `better-sqlite3` 的 SQLite），有四张表：

| 表 | 作用 |
|---|---|
| `tasks` | 注册表：名字、enabled 标志、配置哈希、上次运行、下次运行 |
| `items` | items 模式存储：按 key 的条目，first-seen / last-seen 时间戳 |
| `snapshots` | snapshot 模式存储：上次 payload + 哈希 |
| `runs` | 每次执行的日志：状态、started / ended、新条目数、错误信息 |

`config hash` 是 daemon 快速识别「你改了 task 文件」并重设其调度的方式。`items` 和 `snapshots` 表是让无状态 workflow 变成有状态 task 的持久记忆。

## 输出

根据一个 task 怎么配置，每次运行会产生：

- **RSS/Atom feed** —— 只在 items 模式下，且设了 `output.rss` 时。最新条目在前，按 `maxItems` 截断，用 `itemTitle` / `itemLink` / `itemDescription` 映射到 feed 字段。
- **控制台输出** —— `browser-cli task run <name>` 临时执行一次 task 并打印结果。
- **通知** —— `notify.channels` 列出具名的 apprise 通道（通过 `browser-cli notify add` 配置），有新内容时收到模板化消息。`notify.onError` 是单独的列表，只在 workflow 抛错时触发。

任何组合都可以：只 feed、只通知、两者都要、都不要。

## 生命周期

task 通过 CLI 管理：

- `task create <name>` —— 脚手架新建一个 task 文件
- `task list` —— 列所有 task，带 enabled 状态、上次/下次运行
- `task show <name>` —— 显示配置 + 最近运行 + 当前状态
- `task run <name>` —— 跑一次，忽略调度
- `task enable <name>` / `task disable <name>` —— 翻 enabled 标志；daemon 会自动识别，不用重启
- `task rm <name>` —— 删文件和对应的行

enable / disable 只翻数据库里的标志；磁盘上的文件不动。

## 一个真实的 task

```ts
import type { TaskConfig } from '@browserclijs/browser-cli'

export const config: TaskConfig = {
  workflow: 'hn-top',
  args: { limit: 10 },
  schedule: '*/15 * * * *',     // every 15 minutes
  itemKey: 'url',               // items mode — dedupe by url
  output: {
    rss: {
      title: 'HN top stories',
      link: 'https://news.ycombinator.com',
      itemTitle: 'title',
      itemLink: 'url',
    },
  },
  notify: { channels: ['telegram'], onError: ['telegram'] },
}
```

每 15 分钟 daemon 跑一次 `hn-top` workflow，问「这些 URL 里哪些我没见过？」，把新的存下来并写入 Atom feed，带预览推到 Telegram。如果 workflow 抛错 —— 网络抖动、HN 宕了、selector 坏了 —— Telegram 会收到错误。

一个价格监控就是同样的形状，只是没有 `itemKey` 和 `output.rss`：workflow 返回 `{ price, stock }`，daemon 对比哈希，变了就通知。
