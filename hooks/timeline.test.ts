import { expect, mock, test } from 'claude-code/testing'

import { ago, cleanPrompt, clip, parseTranscript } from './register'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-19T12:00:00Z')

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } as const })

const row = (content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'user',
    timestamp: '2026-10-18T12:00:00.000Z',
    message: { role: 'user', content },
    ...extra,
  })

test('ago reads like amp', () => {
  expect(ago(NOW - 10_000, NOW)).toBe('now')
  expect(ago(NOW - 11 * 60_000, NOW)).toBe('11m ago')
  expect(ago(NOW - 21 * 3_600_000, NOW)).toBe('21h ago')
  expect(ago(NOW - 3 * DAY, NOW)).toBe('3d ago')
  expect(ago(NOW - 65 * DAY, NOW)).toBe('2mo ago')
})

test('transcript keeps typed prompts only', () => {
  const jsonl = [
    row([{ type: 'text', text: 'resolve all findings' }]),
    row('meta note', { isMeta: true }),
    row('in a subagent', { isSidechain: true }),
    row([{ type: 'tool_result', tool_use_id: 't', content: 'ok' }]),
    row('<command-name>/review</command-name><command-message>review</command-message><command-args>staged</command-args>'),
    row('<local-command-stdout>done</local-command-stdout>'),
    row('<command-name>/timeline</command-name><command-args></command-args>'),
    row('[Request interrupted by user]'),
    JSON.stringify({ type: 'assistant', message: { content: 'hi' } }),
    'not json "type":"user"',
  ].join('\n')

  expect(parseTranscript(jsonl)).toEqual([
    { text: 'resolve all findings', at: Date.parse('2026-10-18T12:00:00.000Z') },
    { text: '/review staged', at: Date.parse('2026-10-18T12:00:00.000Z') },
  ])
  expect(cleanPrompt('<bash-input>ls</bash-input>')).toBe('! ls')
  expect(clip('Start   implementing\nthe top tier', 20)).toBe('Start implementing …')
})

const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`band toggles a popover of prompts, press refills (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.env(on, { HOME: '/nonexistent' })
    mock.store(on)
    const filled: string[] = []
    on('prompt.submit', async (_, e) => ({ text: e.text }))
    on('prompt.fill', async (_, e) => {
      filled.push(e.text)
      return { isFilled: true }
    })

    await $.prompt.submit(typed('What would be some unique and helpful features?'))
    await clock.advance(3 * DAY)
    await $.prompt.submit(typed('resolve all findings and continue doing work'))

    const ui = await $.ui.mount({ plugin: 'prompt-timeline', surface, component: 'AbovePrompt', props: BAND })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('≡ 2 prompts')

    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('× 2 prompts')
    expect(await ui.find({ type: 'Text', text: '3d ago' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'now' })).toBeDefined()

    await ui.press({ key: 'prompt:0' })
    expect(filled).toEqual(['What would be some unique and helpful features?'])

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ key: 'prompt:0' })).toBeUndefined()
  })

  test(`popover pages through a long session (${surface})`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.env(on, { HOME: '/nonexistent' })
    mock.store(on)
    on('prompt.submit', async (_, e) => ({ text: e.text }))
    for (let i = 0; i < 12; i++) await $.prompt.submit(typed(`prompt ${i}`))

    const ui = await $.ui.mount({ plugin: 'prompt-timeline', surface, component: 'AbovePrompt', props: BAND })
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ key: 'prompt:3' })).toBeUndefined()
    expect(await ui.find({ key: 'prompt:11' })).toBeDefined()
    expect((await ui.find({ key: 'older' }))?.text).toBe('▲ 4 earlier')

    await ui.press({ key: 'older' })
    expect(await ui.find({ key: 'prompt:0' })).toBeDefined()
    expect(await ui.find({ key: 'prompt:11' })).toBeUndefined()
    expect((await ui.find({ key: 'newer' }))?.text).toBe('▼ 4 newer')
  })
}
