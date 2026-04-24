---
title: 设计哲学
description: 一套三层分诊，决定 workflow 怎么拿数据 —— 能绕过浏览器就绕过、必须用浏览器就拦网络、实在要碰 DOM 就让 LLM 通过 Stagehand 来开。
---

browser-cli 对「你该怎么拿数据」只有一个观点，而这个观点塑造了整个工具：

> **能绕过浏览器就绕过。必须用浏览器时，优先拦网络请求而不是解析 DOM。实在要碰 DOM，就通过 Stagehand 让 LLM 来开车。**

这是一套分诊，不是一本规则书。每个 workflow 都从上往下走这三层，在第一层能跑通的层停下来。每一层都比下一层快，但对变化的抗性也更弱。越往下走，你用速度换韧性。

## Layer 0 — 跳过浏览器

在你打开 browser-cli 之前，先问自己：

- 有没有公开的 REST 或 GraphQL API？
- 网站自己发布 Atom 或 RSS feed 吗？
- 能不能用静态 token、API key、或者 basic auth 复现鉴权？

只要其中一个答案是「能」，别写 workflow。写个 shell 脚本加一行 cron。你省掉了启动 Chrome 的成本、保持 CDP 连接的成本、管理 page 生命周期的成本。循环用 `curl` 和 `jq` 就能调通。你也不用担心凌晨三点有幽灵浏览器进程在漏内存。

Reddit 的 `/r/<sub>.json`、大部分 GitHub 数据、任何有公开 API 的东西 —— 这些都不该进 browser-cli。

## Layer 1 — 拦截网络

当浏览器是唯一入口时 —— 因为鉴权 cookie、CSRF 握手、客户端路由 —— 浏览器是交通工具，不是目的地。你真正想要的是页面自己已经在拉的那份 JSON。那就把它抓下来。

```
captureResponses(page, matcher)   // bulk XHR/fetch spy
waitForJsonResponse(page, url)    // wait for the first matching JSON
pageFetch(page, url, init)        // fire an authenticated request yourself
```

这三个 helper 住在 `src/helpers/network.ts`。批量 spy 在 page init 时以字符串形式注入，所以它能捕获每一个请求 —— `fetch`、`XMLHttpRequest` 都能 —— 存进一个滚动的 500 条缓冲区。两个 waiter helper 从这个缓冲区里轮询。

JSON 在所有重要维度上都碾压 DOM：

- **稳定性**：endpoint 版本迭代慢；class 名字在每次 A/B 测试都会变。
- **结构性**：解 JSON 是解析；解 DOM 是考古。
- **可调试性**：两份 JSON 响应可以 diff。两份渲染过的 DOM 没法有意义地 diff。
- **鉴权免费**：`pageFetch` 在页面自己的 JS 上下文里跑，自动继承 cookie 和 origin。

如果页面已经在拉你要的数据，就拦它的请求。别去刮屏幕。

## Layer 2 — Stagehand 处理 DOM

有些数据只存在于渲染后的 DOM。有些交互 —— 点按钮、填表单、关模态框 —— 只存在于像素里。当你走到这一层，交给 [Stagehand](https://github.com/browserbase/stagehand)：

```
stagehand.act("click the 'Export' button")
stagehand.extract({ schema, instruction })
```

Stagehand 的 selector 是 LLM 驱动的：它把你的意图在运行时翻译成一个真实的元素。网站重排 DOM 或改 CSS class 名字时，你的 workflow 照跑，因为 Stagehand 是从指令重新解析的，不是从一个缓存的 XPath。我们开了 `selfHeal: true`，成功的定位会被缓存；缓存的 selector 后来失败了，Stagehand 会透明地再问一次 LLM 并更新缓存。

这一层慢（每次 `act` 或 `extract` 要几秒钟），也烧 token。这是韧性的价格。

## 逃生舱 —— 以及它为什么危险

裸 `page.evaluate` + `document.querySelector` **不是默认选项**。它是一个逃生舱。只有当 DOM *稳得离谱* —— 结构多年没变过，也不在 A/B 测试下 —— 才用它。Hacker News 是教科书例子：`tr.athing` 经历过每一次改版。

陷阱在于 *每个* 页面乍看都稳得离谱。然后网站上一个新的 class 名字前缀，你的 selector 碎掉，workflow 静默失败。如果你要落到裸 DOM 查询，留一段注释说清楚这页为什么可以豁免。假设任何 reviewer（包括未来的你）都会挑战它。

## 为什么是这个排序

| 层 | 速度 | 抗漂移 | 可调试性 | token 成本 |
|---|---|---|---|---|
| 0 — curl/fetch | ~50 ms | 只有 API 变了才挂 | 毫无门槛 | 无 |
| 1 — 拦截 | ~500 ms | 只有 JSON 契约变了才挂 | JSON 日志 | 无 |
| 2 — Stagehand | 2–5 s | 能适应 selector 漂移 | LLM 推理轨迹 | 每次调用 ~1–2 k |

每下一层慢 10 倍，但容错高 10 倍。选能跑通的最高一层，不要贪最低的。

## 决策树

1. **有公开 API、RSS 或静态数据源吗？** → 别用 browser-cli，用 `curl`。
2. **页面客户端拉的 JSON 里有你要的数据吗？** → Layer 1（`captureResponses` / `waitForJsonResponse` / `pageFetch`）。
3. **数据只在 DOM 里渲染？** → Layer 2（用 Zod schema 调 `stagehand.extract`）。
4. **要点击、填写、交互？** → Layer 2（`stagehand.act`）。
5. **结构稳得离谱*而且* LLM 延迟是硬伤？** → 裸 `page.evaluate`，作为例外写明理由。

每一层都有自己的尖角 —— 跨域 cookie、spy 安装的竞态、POST 触发 Cloudflare bot 挑战 —— 我们会在专门的 gotchas 指南里记。哲学是地图；gotchas 是地形。
