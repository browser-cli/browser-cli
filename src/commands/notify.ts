import { addChannel, listChannels, removeChannel, getChannel } from '../store/channels.ts'
import { notify } from '../notify/index.ts'
import { isAppriseAvailable } from '../sinks/apprise.ts'

const USAGE = `Usage:
  browser-cli notify add <name> <apprise-url>    Register a named notification channel
  browser-cli notify list [--json]               List saved channels
  browser-cli notify test <name>                 Send a test notification
  browser-cli notify rm <name>                   Remove a channel

Apprise URL examples:
  tgram://BOT_TOKEN/CHAT_ID
  discord://WEBHOOK_ID/WEBHOOK_TOKEN
  slack://TOKEN_A/TOKEN_B/TOKEN_C
  mailto://user:pass@host.com?to=me@example.com
  json://hostname         (plain webhook POSTing JSON)

See https://github.com/caronc/apprise/wiki for the full list of services.
`

export async function runNotify(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv
  if (!sub || sub === '-h' || sub === '--help') {
    process.stdout.write(USAGE)
    return
  }

  switch (sub) {
    case 'add':
      return cmdAdd(rest)
    case 'list':
    case 'ls':
      return cmdList(rest)
    case 'test':
      return cmdTest(rest)
    case 'rm':
    case 'remove':
    case 'delete':
      return cmdRemove(rest)
    default:
      process.stderr.write(`Unknown subcommand: notify ${sub}\n\n${USAGE}`)
      process.exit(2)
  }
}

function cmdAdd(args: string[]): void {
  const [name, url] = args
  if (!name || !url) {
    process.stderr.write('Usage: browser-cli notify add <name> <apprise-url>\n')
    process.exit(2)
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/.test(name)) {
    process.stderr.write(
      'name must be 1-50 chars, start alphanumeric, and contain only letters/digits/_/-\n',
    )
    process.exit(2)
  }
  addChannel(name, url)
  if (!isAppriseAvailable()) {
    process.stderr.write(
      'note: channel saved, but `apprise` CLI is not on PATH. Install it before notifications will send:\n' +
        '      pipx install apprise\n',
    )
  }
  process.stdout.write(`channel "${name}" saved\n`)
  process.stdout.write(`test it with: browser-cli notify test ${name}\n`)
}

function cmdList(args: string[]): void {
  const asJson = args.includes('--json')
  const rows = listChannels()
  if (asJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n')
    return
  }
  if (rows.length === 0) {
    process.stderr.write('no channels saved. Add one with: browser-cli notify add <name> <url>\n')
    return
  }
  const nameCol = Math.max(4, ...rows.map((r) => r.name.length))
  process.stdout.write(`${'NAME'.padEnd(nameCol)}  URL\n`)
  process.stdout.write('-'.repeat(nameCol + 2 + 40) + '\n')
  for (const r of rows) {
    process.stdout.write(`${r.name.padEnd(nameCol)}  ${maskUrl(r.url)}\n`)
  }
}

function maskUrl(url: string): string {
  // Mask out secret-looking path segments (tokens) to avoid shoulder-surfing.
  // Keep the scheme + host readable so the user can tell which channel type it is.
  try {
    const m = url.match(/^([a-z]+):\/\/(.*)$/i)
    if (!m) return url
    const rest = m[2]!
    if (rest.length <= 12) return url
    return `${m[1]}://${rest.slice(0, 4)}…${rest.slice(-4)}`
  } catch {
    return url
  }
}

async function cmdTest(args: string[]): Promise<void> {
  const [name] = args
  if (!name) {
    process.stderr.write('Usage: browser-cli notify test <name>\n')
    process.exit(2)
  }
  const ch = getChannel(name)
  if (!ch) {
    process.stderr.write(`channel "${name}" not found\n`)
    process.exit(1)
  }
  process.stdout.write(`sending test notification to "${name}"…\n`)
  const r = await notify(name, {
    title: 'browser-cli test',
    body: `This is a test notification from browser-cli to channel "${name}".`,
  })
  if (r.sent.length > 0) {
    process.stdout.write(`ok — sent via ${r.sent.join(', ')}\n`)
    return
  }
  if (r.missing.length > 0) {
    process.stderr.write(`channel "${name}" vanished between lookups\n`)
    process.exit(1)
  }
  if (r.failed.length > 0) {
    process.stderr.write(`failed: ${r.failed[0]!.reason}\n`)
    process.exit(1)
  }
  process.stderr.write('no dispatch occurred (apprise missing?)\n')
  process.exit(1)
}

function cmdRemove(args: string[]): void {
  const [name] = args
  if (!name) {
    process.stderr.write('Usage: browser-cli notify rm <name>\n')
    process.exit(2)
  }
  const removed = removeChannel(name)
  if (!removed) {
    process.stderr.write(`channel "${name}" not found\n`)
    process.exit(1)
  }
  process.stdout.write(`channel "${name}" removed\n`)
}
