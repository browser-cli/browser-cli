---
title: 限速与并发
description: 在 workflow 上声明限速和并发上限，让并行的多次运行共享一份令牌额度和槽位池 —— 通过 SQLite 跨进程协调。
---

**Rate limit**（限速）是一个令牌桶，用来给出站调用做节流，免得多个并发跑的 workflow 把对方撞进 HTTP 429。限速 **声明在 workflow 顶部**，紧挨着 `schema`，**自动应用** 到匹配的 `page.fetch()` URL，并且 **跨进程共享** —— 通过 SQLite 存储，所以哪怕你 `browser-cli run my-workflow` 起十个并行进程对同一个 host，它们会共用一份额度。

## 默认值（大多数人不用改的部分）

每个 workflow 不写任何配置就自动拿到两个安全默认：

| 默认 | 取值 | 行为 |
| --- | --- | --- |
| `page.fetch` per-host 节流 | **1 qps, burst 1** | 首次调到某 host 直接放行；1 秒内的后续调用要等。 |
| Workflow 并发 | **1** | 整个 workflow 跨所有 `browser-cli run` + daemon tick 同时只跑一个实例。第 2 个并行调用阻塞（FIFO best-effort）直到第 1 个结束。 |

只要默认行为真的让你等了，框架会在 stderr 打一行（每进程每桶一次）提示你怎么改。除非你看到了那行提示，或者明确在写一个需要其他值的 workflow（高吞吐爬虫、需要多 tab 的 server 类 workflow 等），否则不用继续往下读。

完全 opt out 并发默认：`export const concurrency = 0`。提高某 host 的 fetch 额度：在 `rateLimits` 里声明一条（下面一节）。

## 它的形状

workflow 在 `schema` 和 `run` 旁边再导出一个 `rateLimits`：

```ts
import { z } from 'zod'
import type { Browser, RateLimits } from '@browserclijs/browser-cli'

export const schema = z.object({ owner: z.string(), repo: z.string() })

export const rateLimits: RateLimits = {
  // 自动应用：任何打到 api.github.com 的 page.fetch() 都会被限到 1 rps、burst 3。
  'api.github.com':           { rps: 1, burst: 3 },
  // 路径前缀匹配：只针对 GraphQL 端点，不影响同 host 的 REST。
  'api.github.com/graphql':   { rpm: 30 },
  // 手动桶：opt out 自动匹配，只在你用 browser.rateLimit('mutation', ...) 包裹时才生效。
  'mutation':                 { rps: 0.5, manual: true },
}

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()

  // 自动节流 —— URL 命中 `api.github.com`。
  const data = await page.fetch(`https://api.github.com/repos/${args.owner}/${args.repo}`)

  // 手动桶 —— 包裹任意代码块，不限于 fetch。
  await browser.rateLimit('mutation', async () => {
    await page.click('#delete')
    await page.waitForJsonResponse(/\/delete$/)
  })

  return data
}
```

## 声明形状

`rateLimits` 的每一项是一个 key（匹配器或桶名）映射到一个 spec：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `rps` / `rpm` / `rph` | 三选一 | 每秒 / 每分钟 / 每小时请求数。 |
| `burst` | 可选 | 桶的最大令牌数。默认 `max(1, ceil(rps))`。 |
| `manual` | 可选 | 为 `true` 时，桶 **不** 参与 `page.fetch()` URL 自动匹配，只能通过 `browser.rateLimit(name, fn)` 使用。 |

## URL 怎么匹配桶

自动匹配器按 key 长度从长到短遍历声明，命中第一个就停：

- 不含 `/` 的 key（例如 `api.example.com`）：URL 的 hostname 等于这个 key 才命中。
- 含 `/` 的 key（例如 `api.example.com/graphql`）：URL 的 `host + pathname` 以这个 key 开头才命中。

也就是说，host 级粗粒度限速和 path 级细粒度限速可以共存 —— 更具体的声明会赢。

## browser.rateLimit(name, fn)

显式 helper 把任意代码块放进一个具名桶里 —— 适合：

- 想节流的不是 `page.fetch` 调用（比如一连串 click 触发一个慢的后端动作）。
- 同一个 host 的不同动作要不同额度（声明两个 manual 桶，分别包对应路径）。

```ts
await browser.rateLimit('mutation', async () => {
  await page.act('点击删除按钮')
  await page.waitForJsonResponse(/\/delete$/)
})
```

`name` 必须是 `rateLimits` 里声明过的 key（或者 SDK 用法里通过 `withBrowser({ rateLimits })` 传入的 key）；用没声明的名字调用会抛带提示的错。

## 跨进程协调

桶持久化在 `~/.browser-cli/db.sqlite`。每次 acquire 都开一个 `IMMEDIATE` SQLite 事务：读令牌数 → 按经过时间补充 → 扣一个令牌 → 写回，原子完成。两个进程不可能同时认为各自从同一个时间窗口里拿到了令牌 —— 第二个写者会一直阻塞，直到第一个 commit。

WAL 下的争用开销是亚毫秒级的，相对于你节流的浏览器动作的延迟可以忽略。

## workflow 之间的冲突解决

如果两个 workflow 对同一个 key 声明了不同的限速，**最严的赢** —— 取最低 `rps`、最小 `burst`。runner 会在收紧已有桶时打一条 warn 日志。已有的令牌不会退还，下一次 acquire 立刻感受到新限速。

## SDK 用法

`withBrowser` 直接接受同样的声明形状，给不走 workflow runner 的代码用：

```ts
import { withBrowser } from '@browserclijs/browser-cli'

await withBrowser(
  { rateLimits: { 'api.example.com': { rps: 1 } } },
  async (browser) => {
    const page = await browser.newPage()
    await page.fetch('https://api.example.com/...') // 自动节流
  },
)
```

## 并发限制（和限速是两码事）

令牌桶管 **速率**（每段时间多少次事件）。信号量管 **并发**（同一时刻有多少个事件在跑）。两者独立 —— 一个 workflow 可能两个都要。要限制同一个 workflow 同一时刻最多能起多少个实例，声明：

```ts
export const concurrency = 3
```

runner 在 `run()` 开始前拿一个槽位，所有出口（正常返回、抛错、SIGINT/SIGTERM）都释放。3 个槽位全占完时，第 4 个 `browser-cli run` 调用会 **阻塞**（best-effort FIFO）直到有槽位释放 —— **不会报错**。

```ts
import { z } from 'zod'
import type { Browser } from '@browserclijs/browser-cli'

export const schema = z.object({ /* … */ })

export const concurrency = 3   // 这个 workflow 全局最多同时跑 3 个

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  // ... 你的 workflow 代码 ...
}
```

### 跨进程语义

槽位持久化在 `~/.browser-cli/db.sqlite`，用解析后的 workflow 文件路径作 key，所以所有 `browser-cli run` 调用以及 daemon 的 task tick 都共享这个上限。

如果某个进程崩溃没释放（SIGKILL、OOM 等），下一次 acquire 会通过 `process.kill(pid, 0)` 探测来回收僵尸槽位 —— 但只对同一台 hostname 有效。跨机器没法探测，外机 holder 一律算活的。

### 什么时候用

- 长跑的 server 风格 workflow，打开浏览器 tab 并持有（比如固定登录态的 search-server）—— 限到上游能容忍的并发数
- 有共享状态写入的 workflow（上传、删除），多个并行 run 会打架
- 任何"再多并发也帮不上忙反而碍事"的 workflow

### SDK 用法

```ts
import { acquireSlot } from '@browserclijs/browser-cli'

const slot = await acquireSlot('my-job', 3)
try {
  // ... work ...
} finally {
  slot.release()
}
```

