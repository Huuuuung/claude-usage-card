import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { DayStat, UsageData, UsageRange, UsageStatus, UsageTab } from '../types'

const PANE = 'usage-card'
const STORE_KEY = 'data'
const REFRESH_MS = 10 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
// "Harry Potter and the Philosopher's Stone" runs about 77,000 words, roughly 100,000 tokens.
const BOOK_TOKENS = 100_000
const ACCENT = '#D97757'
const EMPTY_CELL = 'rgba(128,128,128,0.18)'
const MUTED = '#8a8a8a'
const MODEL_COLORS: Record<string, string> = { Opus: ACCENT, Sonnet: '#6A9BCC', Haiku: '#8DA05A' }

const data = atom({ plugin: 'usage-card', key: 'data' } as const, null as UsageData | null)
const status = atom({ plugin: 'usage-card', key: 'status' } as const, { isLoading: false } as UsageStatus)
const tab = atom({ plugin: 'usage-card', key: 'tab' } as const, 'overview' as UsageTab)
const range = atom({ plugin: 'usage-card', key: 'range' } as const, '30d' as UsageRange)
const isFresh = atom({ plugin: 'usage-card', key: 'isFresh' } as const, false)

// Windows names it python or py, macOS and Linux python3. Trying python first skips Windows' Microsoft Store
// python3 stub; where python is missing or Python 2, it fails and python3 runs next.
const PYTHONS = ['python', 'python3', 'py']

async function aggregate($: EngineInterface): Promise<string> {
  const script = `${$.plugin.root}/scripts/aggregate.py`
  let failure = 'Python 3 was not found (tried python, python3 and py)'
  for (const python of PYTHONS) {
    try {
      const ran = await $.process.run([python, script], { timeoutMs: 300_000 })
      if (ran.exitCode === 0 && ran.stdout) return ran.stdout
      failure = ran.stderr.trim().split('\n').pop() || `${python} exited ${ran.exitCode}`
    } catch {
      // Not installed under this name: try the next.
    }
  }
  throw new Error(failure)
}

async function refresh($: EngineInterface) {
  if ((await read($, status)).isLoading) return
  await update($, status, () => ({ isLoading: true }))
  try {
    const fresh = JSON.parse(await aggregate($)) as UsageData
    await update($, data, () => fresh)
    await $.store.set(STORE_KEY, fresh)
    await update($, status, () => ({ isLoading: false }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, status, () => ({ isLoading: false, error: message }))
  }
}

// Date keys are local days ("YYYY-MM-DD"); step them as UTC dates so the module's own time zone never matters.
const toTime = (key: string) => Date.parse(`${key}T00:00:00Z`)
const toKey = (time: number) => new Date(time).toISOString().slice(0, 10)
const weekday = (key: string) => new Date(toTime(key)).getUTCDay()

function rangeKeys(usage: UsageData, chosen: UsageRange): string[] {
  const end = toTime(usage.today)
  const known = Object.keys(usage.days).sort()
  const first = known.length > 0 ? toTime(known[0]) : end
  const start = chosen === '7d' ? end - 6 * DAY_MS : chosen === '30d' ? end - 29 * DAY_MS : Math.min(first, end)
  const keys: string[] = []
  for (let t = start; t <= end; t += DAY_MS) keys.push(toKey(t))
  return keys
}

const dayTokens = (day: DayStat | undefined) => (day ? day.i + day.o + day.cw : 0)

type Summary = {
  keys: string[]
  sessions: number
  messages: number
  tokens: number
  activeDays: number
  peakHour: number | null
  favorite: string | null
  longest: number
  current: number
  perModel: [string, number[]][]
}

function summarize(usage: UsageData, chosen: UsageRange): Summary {
  const keys = rangeKeys(usage, chosen)
  const sessions = new Set<number>()
  const hours = new Array<number>(24).fill(0)
  const models = new Map<string, number[]>()
  let messages = 0
  let tokens = 0
  let activeDays = 0
  let longest = 0
  let run = 0
  for (const key of keys) {
    const day = usage.days[key]
    if (!day || day.m === 0) {
      run = 0
      continue
    }
    activeDays += 1
    run += 1
    longest = Math.max(longest, run)
    messages += day.m
    tokens += dayTokens(day)
    day.s.forEach(s => sessions.add(s))
    day.h.forEach((n, h) => (hours[h] += n))
    for (const [model, counts] of Object.entries(day.md)) {
      const held = models.get(model) ?? [0, 0, 0, 0]
      models.set(model, held.map((n, i) => n + (counts[i] ?? 0)))
    }
  }
  // Today not used yet does not break the streak: count back from yesterday then.
  let current = 0
  let index = keys.length - 1
  if (index >= 0 && !usage.days[keys[index]]?.m) index -= 1
  while (index >= 0 && usage.days[keys[index]]?.m) {
    current += 1
    index -= 1
  }
  const peak = Math.max(...hours)
  const perModel = [...models.entries()].sort((a, b) => modelTokens(b[1]) - modelTokens(a[1]))
  return {
    keys,
    sessions: sessions.size,
    messages,
    tokens,
    activeDays,
    peakHour: peak > 0 ? hours.indexOf(peak) : null,
    favorite: perModel.length > 0 ? perModel[0][0] : null,
    longest,
    current,
    perModel,
  }
}

const modelTokens = (counts: number[]) => counts[0] + counts[1] + counts[2]

function modelName(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(model)
  if (!match) return model
  return `${match[1][0].toUpperCase()}${match[1].slice(1)} ${match[2]}.${match[3]}`
}

const modelColor = (model: string) => MODEL_COLORS[modelName(model).split(' ')[0]] ?? '#B0A090'

function fmt(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`

function ago(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function levels(values: number[]): (v: number) => number {
  const sorted = values.filter(v => v > 0).sort((a, b) => a - b)
  const cut = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  const edges = sorted.length > 0 ? [cut(0.25), cut(0.5), cut(0.75)] : []
  return v => (v <= 0 ? 0 : 1 + edges.filter(edge => v > edge).length)
}

const OPACITY = [0, 0.3, 0.5, 0.75, 1]

function heatmapSvg(usage: UsageData, keys: string[]): string {
  const shown = keys.slice(-53 * 7)
  const cell = 12
  const gap = 3
  const left = 28
  const top = 16
  const lead = weekday(shown[0])
  const columns = Math.ceil((lead + shown.length) / 7)
  const width = left + columns * (cell + gap)
  const height = top + 7 * (cell + gap)
  const level = levels(shown.map(key => dayTokens(usage.days[key])))
  const parts: string[] = []
  let lastMonth = ''
  shown.forEach((key, n) => {
    const slot = lead + n
    const x = left + Math.floor(slot / 7) * (cell + gap)
    const y = top + (slot % 7) * (cell + gap)
    const day = usage.days[key]
    const tokens = dayTokens(day)
    const step = level(tokens)
    const fill = step === 0 ? EMPTY_CELL : ACCENT
    const month = key.slice(0, 7)
    if (month !== lastMonth && slot % 7 === 0) {
      const name = new Date(toTime(key)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
      parts.push(`<text x="${x}" y="10" font-size="10" fill="${MUTED}">${name}</text>`)
      lastMonth = month
    }
    const tip = `${key}: ${fmt(tokens)} tokens, ${day?.m ?? 0} messages`
    parts.push(
      `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${fill}"` +
        (step > 0 ? ` fill-opacity="${OPACITY[step]}"` : '') +
        `><title>${tip}</title></rect>`,
    )
  })
  ;[
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ].forEach(([row, name]) => {
    parts.push(`<text x="0" y="${top + Number(row) * (cell + gap) + 10}" font-size="10" fill="${MUTED}">${name}</text>`)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif">${parts.join('')}</svg>`
}

function barsSvg(usage: UsageData, keys: string[], models: string[]): string {
  const width = 560
  const height = 170
  const top = 18
  const bottom = 20
  const plot = height - top - bottom
  const slot = width / keys.length
  const bar = Math.max(1, slot * 0.7)
  const max = Math.max(1, ...keys.map(key => dayTokens(usage.days[key])))
  const parts: string[] = [
    `<text x="0" y="11" font-size="10" fill="${MUTED}">${fmt(max)} tokens</text>`,
    `<line x1="0" y1="${top + plot}" x2="${width}" y2="${top + plot}" stroke="${MUTED}" stroke-opacity="0.4"/>`,
  ]
  keys.forEach((key, n) => {
    const day = usage.days[key]
    if (!day) return
    let y = top + plot
    for (const model of models) {
      const counts = day.md[model]
      if (!counts) continue
      const h = (modelTokens(counts) / max) * plot
      y -= h
      parts.push(
        `<rect x="${(n * slot + (slot - bar) / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${bar.toFixed(1)}" height="${h.toFixed(1)}" fill="${modelColor(model)}">` +
          `<title>${key} ${modelName(model)}: ${fmt(modelTokens(counts))} tokens</title></rect>`,
      )
    }
  })
  parts.push(`<text x="0" y="${height - 4}" font-size="10" fill="${MUTED}">${keys[0]}</text>`)
  parts.push(`<text x="${width}" y="${height - 4}" font-size="10" fill="${MUTED}" text-anchor="end">${keys[keys.length - 1]}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif">${parts.join('')}</svg>`
}

// The terminal draws no Svg: a block-character heatmap and sparkline stand in.
function heatmapText(usage: UsageData, keys: string[]): string[] {
  const shown = keys.slice(-26 * 7)
  const lead = weekday(shown[0])
  const level = levels(shown.map(key => dayTokens(usage.days[key])))
  const glyphs = ['·', '░', '▒', '▓', '█']
  const rows = Array.from({ length: 7 }, () => '')
  for (let slot = 0; slot < lead; slot += 1) rows[slot] += ' '
  shown.forEach((key, n) => {
    rows[(lead + n) % 7] += glyphs[level(dayTokens(usage.days[key]))]
  })
  return rows
}

function sparkline(usage: UsageData, keys: string[]): string {
  const glyphs = '▁▂▃▄▅▆▇█'
  const values = keys.slice(-60).map(key => dayTokens(usage.days[key]))
  const max = Math.max(1, ...values)
  return values.map(v => (v === 0 ? ' ' : glyphs[Math.min(7, Math.floor((v / max) * 7.99))])).join('')
}

async function drawCard($: EngineInterface, e: RenderInput) {
  const elements = $.ui.resolve(e)
  const { Box, Text, Button } = elements
  const Svg = 'Svg' in elements ? elements.Svg : undefined
  const usage = await read($, data)
  const state = await read($, status)
  const shownTab = await read($, tab)
  const shownRange = await read($, range)
  const now = await $.clock.now()

  const header = (
    <Box flexDirection="row" justifyContent="space-between" flexWrap="wrap" gap={1}>
      <Box flexDirection="row" gap={1}>
        {(['overview', 'models'] as const).map(name => (
          <Button
            key={`tab-${name}`}
            label={name === 'overview' ? 'Overview' : 'Models'}
            variant={shownTab === name ? 'primary' : 'secondary'}
            onPress={() => update($, tab, () => name)}
          />
        ))}
      </Box>
      <Box flexDirection="row" gap={1}>
        {(['all', '30d', '7d'] as const).map(name => (
          <Button
            key={`range-${name}`}
            label={name === 'all' ? 'All' : name}
            variant={shownRange === name ? 'primary' : 'secondary'}
            onPress={() => update($, range, () => name)}
          />
        ))}
        <Button key="refresh" label="↻" onPress={() => refresh($)} />
      </Box>
    </Box>
  )

  const footer = (
    <Text dimColor>
      {state.isLoading
        ? 'Updating…'
        : state.error
          ? `Could not update: ${state.error}`
          : usage
            ? `Updated ${ago(now - usage.generatedAt)} · from this computer's Claude Code history`
            : ''}
    </Text>
  )

  if (!usage) {
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {header}
        <Text dimColor>Reading your usage history…</Text>
        {footer}
      </Box>
    )
  }

  const summary = summarize(usage, shownRange)
  const tile = (label: string, value: string) => (
    <Box key={`tile-${label}`} flexDirection="column" paddingX={1} paddingY={0} minWidth={16} borderStyle="round" borderDimColor>
      <Text dimColor>
        {label}
      </Text>
      <Text bold>
        {value}
      </Text>
    </Box>
  )

  if (shownTab === 'overview') {
    const books = summary.tokens / BOOK_TOKENS
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        {header}
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {tile('Sessions', fmt(summary.sessions))}
          {tile('Messages', fmt(summary.messages))}
          {tile('Total tokens', fmt(summary.tokens))}
          {tile('Active days', `${summary.activeDays}/${summary.keys.length}`)}
          {tile('Peak hour', summary.peakHour === null ? '—' : hourLabel(summary.peakHour))}
          {tile('Favorite model', summary.favorite ? modelName(summary.favorite) : '—')}
        </Box>
        <Text dimColor>
          Current streak <Text bold>{summary.current}d</Text> · Longest streak{' '}
          <Text bold>{summary.longest}d</Text>
        </Text>
        {Svg ? (
          <Svg
            source={heatmapSvg(usage, summary.keys)}
            alt={`Daily activity heatmap, ${summary.activeDays} active days`}
            isInteractive
          />
        ) : (
          <Box flexDirection="column">
            {heatmapText(usage, summary.keys).map((row, n) => (
              <Text key={`heat-${n}`} color="claude">
                {row}
              </Text>
            ))}
          </Box>
        )}
        {books >= 1 && (
          <Text>
            You've used ~{books >= 10 ? Math.round(books) : books.toFixed(1)}× more tokens than{' '}
            <Text italic>Harry Potter and the Philosopher's Stone</Text>.
          </Text>
        )}
        {footer}
      </Box>
    )
  }

  const models = summary.perModel.map(([model]) => model)
  return (
    <Box flexDirection="column" gap={1} padding={1}>
      {header}
      <Text bold>Tokens per day</Text>
      {Svg ? (
        <Svg source={barsSvg(usage, summary.keys, models)} alt="Tokens per day, stacked by model" isInteractive />
      ) : (
        <Text color="claude">{sparkline(usage, summary.keys)}</Text>
      )}
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Box width="30%">
            <Text dimColor>
              Model
            </Text>
          </Box>
          {['Tokens', 'Share', 'Input', 'Output', 'Cache write', 'Cache read'].map(name => (
            <Box key={`head-${name}`} width="14%">
              <Text dimColor>
                {name}
              </Text>
            </Box>
          ))}
        </Box>
        {summary.perModel.map(([model, counts]) => (
          <Box key={`model-${model}`} flexDirection="row">
            <Box width="30%">
              <Text>
                <Text color={modelColor(model)}>■</Text> {modelName(model)}
              </Text>
            </Box>
            {[
              fmt(modelTokens(counts)),
              summary.tokens > 0 ? `${((modelTokens(counts) / summary.tokens) * 100).toFixed(1)}%` : '—',
              fmt(counts[0]),
              fmt(counts[1]),
              fmt(counts[2]),
              fmt(counts[3]),
            ].map((value, n) => (
              <Box key={`cell-${model}-${n}`} width="14%">
                <Text>{value}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
      <Text dimColor>
        Tokens = input + output + cache write. Cache reads re-use earlier context and are shown apart.
      </Text>
      {footer}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-card',
      description: 'Show the usage stats card: sessions, tokens, streaks, heatmap and models',
    })
    const cached = (await $.store.get(STORE_KEY)) as UsageData | undefined
    if (cached?.today && !(await read($, data))) await update($, data, () => cached)
    await update($, status, held => ({ ...held, isLoading: false }))
    const isEmpty = (await $.session.messages()).length === 0
    await update($, isFresh, () => isEmpty)
    $.clock.after(1000, () => refresh($))
    $.clock.every(REFRESH_MS, () => refresh($))

    return next(e)
  })

  // The desktop's start screen draws no plugin sites, so a new conversation opens the pane with its first prompt instead.
  on('prompt.submit', async ($, e, next) => {
    if (await read($, isFresh)) {
      await update($, isFresh, () => false)
      void $.ui.open({ id: PANE, title: 'Usage' })
    }

    return next(e)
  })

  on('command.run', { command: 'usage-card' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Usage' })
    void refresh($)

    return { text: 'Usage card opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => drawCard($, e))
}
