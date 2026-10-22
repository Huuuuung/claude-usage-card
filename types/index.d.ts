/** One local day: messages, tokens (input, output, cache write, cache read), messages per hour, per-model tokens, session indices. */
export type DayStat = {
  m: number
  i: number
  o: number
  cw: number
  cr: number
  h: number[]
  md: Record<string, number[]>
  s: number[]
}

export type UsageData = {
  generatedAt: number
  /** The local date the aggregate was made on, "YYYY-MM-DD". */
  today: string
  files: number
  days: Record<string, DayStat>
}

export type UsageStatus = { isLoading: boolean; error?: string }

export type UsageTab = 'overview' | 'models'

export type UsageRange = 'all' | '30d' | '7d'

declare module 'claude-code' {
  interface PluginState {
    'usage-card': {
      data: UsageData | null
      status: UsageStatus
      tab: UsageTab
      range: UsageRange
      /** True while the conversation has no messages: its first prompt opens the pane. */
      isFresh: boolean
    }
  }
}
