export type RssConfig = {
  title: string
  link: string
  description?: string
  itemTitle?: string
  itemLink?: string
  itemDescription?: string
  itemPubDate?: string
  maxItems?: number
}

export type NotifyConfig = {
  channels: string[]
  onChangeTemplate?: string
  onError?: string[]
}

export type TaskConfig = {
  workflow: string
  args?: Record<string, unknown>
  schedule: string
  itemKey?: string
  output?: {
    rss?: RssConfig
  }
  notify?: NotifyConfig
}

export type LoadedTask = {
  name: string
  path: string
  config: TaskConfig
  configHash: string
}
