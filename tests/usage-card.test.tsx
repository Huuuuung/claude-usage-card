import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'usage-card',
  component: 'Pane',
  requestId: 'usage-card',
  props: {
    title: 'Usage',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const hours = (at: number, n: number) => Array.from({ length: 24 }, (_, h) => (h === at ? n : 0))

const SAMPLE = {
  generatedAt: 0,
  today: '2026-10-22',
  files: 3,
  days: {
    '2026-10-20': { m: 10, i: 100, o: 400_000, cw: 100_000, cr: 9_000_000, h: hours(21, 10), md: { 'claude-opus-5-5': [100, 400_000, 100_000, 9_000_000] }, s: [0, 1] },
    '2026-10-21': { m: 4, i: 0, o: 50_000, cw: 0, cr: 0, h: hours(9, 4), md: { 'claude-sonnet-5-5': [0, 50_000, 0, 0] }, s: [1] },
    '2026-10-22': { m: 2, i: 0, o: 1_000, cw: 0, cr: 0, h: hours(9, 2), md: { 'claude-opus-5-5': [0, 1_000, 0, 0] }, s: [2] },
  },
}

test('the card reads the aggregate and draws both tabs on every surface', async ($, on) => {
  mock.clock(on, { now: 60_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'usage-card' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: JSON.stringify(SAMPLE), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'refresh' })
    await ui.press({ key: 'range-7d' })

    expect((await ui.find({ type: 'Text', text: /^Sessions$/ }))?.text).toBe('Sessions')
    expect((await ui.find({ type: 'Text', text: /^551\.1K$/ }))?.text).toBe('551.1K')
    expect((await ui.find({ type: 'Text', text: /^3\/7$/ }))?.text).toBe('3/7')
    expect((await ui.find({ type: 'Text', text: /^9 PM$/ }))?.text).toBe('9 PM')
    expect((await ui.find({ type: 'Text', text: /Current streak/ }))?.text).toContain('3d')
    expect((await ui.find({ type: 'Text', text: /Harry Potter/ }))?.text).toContain('5.5×')

    await ui.press({ key: 'tab-models' })
    expect((await ui.find({ type: 'Text', text: /Sonnet 5\.5/ }))?.text).toContain('Sonnet 5.5')
    await ui.press({ key: 'tab-overview' })
    await ui.unmount()
  }
})

test('the first prompt of a new conversation opens the pane, and only the first', async ($, on) => {
  const opened: string[] = []
  mock.clock(on, { now: 60_000 })
  mock.store(on, { data: SAMPLE })
  on('command.register', () => ({ value: { command: 'usage-card' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(opened).toEqual([])

  await $.prompt.submit({ text: 'hello' })
  await $.prompt.submit({ text: 'again' })
  expect(opened).toEqual(['usage-card'])
})
