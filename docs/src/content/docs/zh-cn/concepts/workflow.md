---
title: Workflow
description: browser-cli 的核心单元 —— 一个导出 Zod schema 和异步 run 函数的 TypeScript 模块。
---

**workflow** 是 browser-cli 的核心单元。它是单个 TypeScript 文件，描述「怎么做一件浏览器自动化的事情，一次」。同一个文件可以从 CLI 调用、被调度为 [task](/zh-cn/concepts/task/)，或通过 SDK 作为函数导入。workflow 是无状态、一次性的 —— 它积累的任何状态（去重后的 items、snapshots、运行日志）由 task 层管，workflow 自己不管。

## 它的形状

每个 workflow 恰好导出两样东西：

```ts
export type WorkflowModule<S extends ZodSchema = ZodSchema> = {
  schema: S
  run: (browser: Browser, args: z.infer<S>) => Promise<unknown>
}
```

- `schema` 是一个 [Zod](https://zod.dev) 校验器，描述 workflow 接受的参数。
- `run` 是一个异步函数，拿到一个开箱即用的 `Browser` 包装器和解析好的参数，返回任意值。

整个契约就这些。没有继承、没有装饰器、没有生命周期 hook。

## 为什么是这个形状

把 workflow 拆成 schema 和函数，买来三样东西：

- **不用执行也能反省。** `browser-cli describe <name>` 读 schema 把参数列表打印出来，全程不用启动 Chrome。你能在跑一个 workflow 之前看清它要什么。
- **类型安全的运行时校验。** runner 用 schema 解析 CLI 来的原始参数 —— shell 里的字符串、JSON blob、位置参数。类型不匹配会在任何浏览器工作开始之前以可读的错误浮出来。`run` 内部，`args` 类型完整。
- **零浏览器样板代码。** runner 只在你打开 page 时才在 `Browser` 包装器背后懒加载 Stagehand。`run` 返回（或抛错）时，runner 只关闭你的 workflow 打开的 page，把原有的 tab 留着，把 Stagehand 关掉。你的代码永远不用 `await browser.close()`。

## Runner 生命周期

runner（在 `src/runner.ts`）是一个薄壳：

1. `loadWorkflow(name)` —— 先找项目 workflow（`<git-root>/.browser-cli/workflows/<name>.ts`），找不到再回退到 `~/.browser-cli/workflows/<name>.ts`，转译它，断言模块导出了一个 Zod `schema` 和一个 `run` 函数。
2. `runWorkflow(name, rawArgs)` —— 用 `schema.parse(...)` 解析 `rawArgs`，创建 `Browser` 包装器，调用 `mod.run(browser, parsed)`。
3. `finally` 块关闭运行期间打开的所有 page，保留原有 tab，销毁 Stagehand。

你的 workflow 代码跑在第 2 步里。其他都是管道。

## workflow 住在哪

workflow 可以住在项目里，也可以住在全局 browser-cli home 里：

- **项目 workflow** 住在 `<git-root>/.browser-cli/workflows/<name>.ts`。你在 git 仓库里运行时，它们优先解析。
- **全局 workflow** 住在 `~/.browser-cli/workflows/<name>.ts`。项目里没有同名 workflow 时才回退到这里。

两条约定要记：

- **文件名就是命令名。** 一个叫 `hn-top.ts` 的文件对应 `browser-cli run hn-top`。
- **全局 home 目录是 git 仓库。** track 你的全局 workflow、diff 它们、push 它们、作为订阅分享它们。`browser-cli sync` 会帮你把全局变动 commit 掉。项目 workflow 由外层项目仓库管理版本。

订阅来的 workflow 住在 `~/.browser-cli-subs/<repo>/workflows/<name>.ts`，用带命名空间的名字调用：`browser-cli run <repo>/<name>`。

v1 里 task 和 daemon 仍然是全局的；项目级支持只影响 `list`、`describe` 和 `run` 的 workflow 发现。

## 怎么组织 `run`

`run` 里面，你挑能干完这事的最轻量工具。browser-cli 对此有强烈的立场；[设计哲学](/zh-cn/philosophy/)页有完整论述。粗略勾一下：

- **Layer 1 —— 拦截网络。** 如果页面从某个 endpoint 拉 JSON，就把它抓下来（`page.captureResponses`、`page.waitForJsonResponse`、`page.fetch`）。JSON 结构稳；DOM 都不稳。
- **Layer 2 —— Stagehand 处理 DOM。** 数据或交互只以渲染后的像素存在时，调 `page.act(...)` 或 `page.extract(...)`。selector 会适应漂移；`selfHeal: true` 缓存能跑的结果。
- **逃生舱 —— 裸 Playwright。** 只用于稳得*离谱*的结构（比如 Hacker News 的 `tr.athing`）。留下注释说为什么。

默认 Layer 1。只有数据确实不在网络调用里时，才够到 Layer 2。

## 参数和返回值

参数从 CLI 过来，形式是字符串、JSON blob 或命名 flag。runner 把它们强制转换到 schema 匹配的形状，所以 `browser-cli run hn-top '{"limit":10}'` 和 `browser-cli run hn-top --limit 10` 产生的是同一份类型化 `args`。

`run` 返回 `Promise<unknown>`。CLI 会把返回值以 JSON 美化打印。task 层会对它哈希（snapshot 模式）或对数组去重（items 模式）。SDK 调用者拿到原始值。返回一个对象或对象数组是惯例。

## 一个真实的 workflow

```ts
import { z } from 'zod'
import type { Browser } from '@browserclijs/browser-cli'

export const schema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
})

export async function run(browser: Browser, args: z.infer<typeof schema>) {
  const page = await browser.newPage()
  await page.goto('https://github.com/', { waitUntil: 'domcontentloaded' })

  const data = await page.fetch(
    `https://api.github.com/repos/${args.owner}/${args.repo}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  return data
}
```

有两点值得留意。我们先落到 `github.com` 上，这样后续 `page.fetch` 会继承用户已登录的 session —— GitHub 带鉴权的速率上限比匿名的高一个量级。然后我们彻底跳过 DOM：这个 API 返回 JSON，于是我们用 `page.fetch` 调它然后返回。没有 selector，没有 `extract`，没有 LLM。从头到尾都是 Layer 1。
