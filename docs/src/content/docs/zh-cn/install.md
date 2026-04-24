---
title: 安装
description: browser-cli 的基础安装步骤，外加可选的 apprise（推送通知）依赖。
---

**browser-cli** 在你已登录的 Chrome 上运行 TypeScript workflow。这一页是让它跑起来的唯一权威文档。基础安装部分覆盖运行 workflow 所需的一切；通知部分是独立的 —— 只有在你要接收推送提醒时才需要装。

<details>
<summary>如果你是正在读这篇文档的 Code Agent（点击展开）</summary>

如果你是 **Claude Code**、**Codex** 或 **opencode**，正在代表用户执行安装：你可以把 browser-cli 配置成直接复用**你自己**的登录态作为 self-heal 的 LLM backend。不需要额外 API key，不需要额外登录 —— 用户机器上已经有你的订阅/认证了，browser-cli 直接搭车。

基础安装 1～4 步照常执行。走到第 5 步时，把 `browser-cli config` 替换成下面这条与你身份对应的一行非交互命令：

- **你是 Claude Code** → `browser-cli config --provider claude-agent-sdk --yes`
  想省 token 也可以加 `--model claude-haiku-4-5`，self-heal 用小模型足够。
- **你是 Codex** → `browser-cli config --provider codex --yes`
  想指定模型可以加 `--model gpt-5.5`，否则走 `~/.codex/config.toml` 的默认值。
- **你是 opencode** → `browser-cli config --provider opencode --model <provider/model> --yes`
  这条**必须**带 model。挑一个你有权限的快且小的模型，常见安全选项：`anthropic/claude-haiku-4-5`、`opencode/claude-haiku-4-5`、`openai/gpt-5-nano`。跑 `opencode models` 看你实际能用哪些。

然后跑第 6 步 `browser-cli doctor`，LLM 那一行应该显示 `[ok]`，provider 标记为你自己。

本页其余内容（基础安装 + 可选功能）是给人类用户看的详细版；每一步都解释了原因，每种 provider / 环境变量组合都列全了。如果你是 agent，上面三条命令就够了。

</details>

## 基础安装

browser-cli 的所有功能都要先装这个。六步。

1. **Node ≥ 22.18。** 用 `node --version` 查版本。如果旧了，用 [nvm](https://github.com/nvm-sh/nvm)、[Homebrew](https://formulae.brew.sh/formula/node) 或者系统自带的包管理器装一个。

2. **全局安装 CLI。**

   ```bash
   pnpm add -g @browserclijs/browser-cli
   # or:
   npm install -g @browserclijs/browser-cli
   ```

3. **全局安装 `playwriter`。** browser-cli 通过 [playwriter](https://playwriter.dev/) 这个 CDP relay 驱动你的 Chrome。它是 peer dependency，必须单独安装。

   ```bash
   pnpm add -g playwriter
   # or:
   npm install -g playwriter
   ```

4. **安装 playwriter 的 Chrome 扩展。** 访问 [https://playwriter.dev/](https://playwriter.dev/) 按页面上的说明装。在 Chrome 里点一下扩展图标 —— relay 跑起来且扩展握手成功后它会变绿。这一步必须手动做，没办法从终端装 Chrome 扩展。

5. **配置 LLM provider。** 必须。Stagehand 里每次 `act` / `extract` / `observe` 调用都会走 LLM，所以没有凭据的话，任何碰 DOM 的 workflow 都会抛 `No LLM credentials found` 然后停住。

   交互式设置会写到 `~/.browser-cli/.env`：

   ```bash
   browser-cli config
   ```

   或者设置以下任一组环境变量（按优先级检查）：

   | 变量 | 含义 |
   |---|---|
   | `LLM_PROVIDER=claude-agent-sdk` | 使用你已登录的 Claude Code 订阅。`@anthropic-ai/claude-agent-sdk` 已作为 browser-cli 的直接依赖随包安装，不需要额外 install；同机有可用的 [Claude Code](https://claude.com/claude-code) 登录即可（先跑一次 `claude`）。 |
   | `LLM_PROVIDER=codex` | 使用你的 [Codex CLI](https://developers.openai.com/codex) 登录。`@openai/codex-sdk` 已随包安装。支持 `codex login` 的 ChatGPT 订阅或 `OPENAI_API_KEY`。`LLM_MODEL` 可选。 |
   | `LLM_PROVIDER=opencode` | 使用你的 [opencode](https://opencode.ai) 配置。`@opencode-ai/sdk` 已随包安装。需要 `~/.config/opencode/opencode.json` 配好 provider（`opencode auth login`）。`LLM_MODEL` 格式 `provider/model`，例如 `anthropic/claude-sonnet-4-5`。 |
   | `LLM_API_KEY` + `LLM_BASE_URL` + `LLM_MODEL` | 任何 OpenAI 兼容的 gateway（Together、Groq、LiteLLM、本地 vLLM 等） |
   | `OPENAI_API_KEY` | 直连 OpenAI。默认模型 `gpt-4o-mini`。 |
   | `ANTHROPIC_API_KEY` | 直连 Anthropic。默认模型 `claude-sonnet-4-5`。 |

   三个 Code Agent SDK（Claude Agent SDK、Codex SDK、OpenCode SDK）都作为 browser-cli 的普通 `dependencies` 发布，`pnpm add -g @browserclijs/browser-cli` 一并装好。你只需要保证对应的 CLI 在同机**已登录**。

   `~/.browser-cli/.env` 里的环境变量会在每次执行 `browser-cli` 时自动加载。

6. **验证。**

   ```bash
   browser-cli doctor
   ```

   必选项每一行都应该显示 `[ok]`。`apprise` 那一行出现 `[warn]` 是正常的，除非你装了它（见下文 [通知](#通知)）。

完事了 —— `browser-cli run <workflow>` 现在可以端到端跑通。

## 可选功能

### 通知

**它做什么。** 给 task 加上推送通道 —— 比如「这个 task 抓到新条目就发 Telegram」「这个页面变了就发邮件」。通道用 `browser-cli notify add` 创建。browser-cli 通过调用 [Apprise](https://github.com/caronc/apprise) CLI 来发消息。

**没装会怎样。** `apprise` 是可选的。task 照常运行；workflow 的输出、RSS feed 和 sqlite 状态都不受影响。只有通知这一步会被跳过，同时 stderr 打一行警告。

**安装（macOS，推荐用 Homebrew）：**

```bash
brew install apprise
```

**安装（Linux / WSL，推荐用 pipx）：**

```bash
pipx install apprise
# if the binary isn't found after install, add pipx's bin dir to PATH:
pipx ensurepath
```

**验证：**

```bash
apprise --version
browser-cli doctor          # the `apprise` row should now say [ok]
```

## 故障排查

**`browser-cli doctor` 说找不到 `playwriter`，但 `which playwriter` 明明能找到。** 你的 `pnpm` / `npm` 全局 bin 目录不在 browser-cli 所处 shell 能看到的 PATH 里。跑 `pnpm config get global-bin-dir`（或 `npm config get prefix`），把它加到 `~/.zshrc` / `~/.bashrc` / `~/.config/fish/config.fish`，然后重启 shell。

**Relay 连不上 / 扩展图标一直是灰色。** Relay 会在你第一次跑任何 `playwriter` CLI 命令时自动启动。你也可以用 `playwriter session new` 显式拉起它（或者用 `playwriter serve --replace` 强制重启一个卡死的）。用 `lsof -i :19988` 确认端口上有东西在监听。CLI 和扩展版本不匹配也会有这个症状 —— 两边都更新：`pnpm add -g playwriter@latest`，然后从 [playwriter.dev](https://playwriter.dev/) 重装扩展。

**`pipx install apprise` 成功了，但 `apprise --version` 报 "command not found"。** 跑 `pipx ensurepath`，然后 `exec $SHELL -l`。

**workflow 在 import 时找不到 `zod` 或 `@browserbasehq/stagehand`。** `browser-cli init` 会在 `~/.browser-cli/` 里重建 `node_modules` 软链接。跑一次，然后重试。

**`browser-cli doctor` 自己启动不了。** 大概率是 Node 版本低于 22.18 —— `node --version` 确认。browser-cli 要求 Node 22.18+，因为它用了 `process.loadEnvFile` 和较新的 ESM loader 标志。
