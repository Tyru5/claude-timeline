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
    row(
      '<command-name>/review</command-name><command-message>review</command-message><command-args>staged</command-args>',
    ),
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
  test(`band toggles a popover of prompts (${surface})`, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    mock.env(on, { HOME: '/nonexistent' })
    mock.store(on)
    const toasts: string[] = []
    on('prompt.submit', async (_, e) => ({ text: e.text }))
    on('ui.toast', async (_, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })

    await $.prompt.submit(typed('What would be some unique and helpful features?'))
    await clock.advance(3 * DAY)
    await $.prompt.submit(typed('resolve all findings and continue doing work'))

    const ui = await $.ui.mount({
      plugin: 'prompt-timeline',
      surface,
      component: 'AbovePrompt',
      props: BAND,
    })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(1)
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('≡ 2 prompts')

    await ui.press({ key: 'toggle' })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('× 2 prompts')
    expect(await ui.find({ type: 'Text', text: '3d ago' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'now' })).toBeDefined()

    // Live-recorded prompts carry no transcript id yet: nothing to jump to.
    await ui.press({ key: 'prompt:0' })
    expect(toasts).toEqual(['That prompt is not in the transcript yet.'])

    await ui.press({ key: 'toggle' })
    expect(await ui.find({ key: 'prompt:0' })).toBeUndefined()
  })

  test(`popover pages through a long session (${surface})`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.env(on, { HOME: '/nonexistent' })
    mock.store(on)
    on('prompt.submit', async (_, e) => ({ text: e.text }))
    for (let i = 0; i < 12; i++) await $.prompt.submit(typed(`prompt ${i}`))

    const ui = await $.ui.mount({
      plugin: 'prompt-timeline',
      surface,
      component: 'AbovePrompt',
      props: BAND,
    })
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

test('transcript prompts carry their row ids for jumping', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/me' })
  mock.store(on)
  on('command.register', async (_, e) => ({ value: { command: e.name } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'sess-1' }))
  // Loaded after a shell `cd`: the cwd is no guide to the transcript's folder.
  on('session.root', async () => ({ value: '/work/my.repo' }))
  on('session.cwd', async () => ({ value: '/work/my.repo/sub' }))
  on('fs.exists', async (_, e) => ({
    value: e.path === '/home/me/.claude/projects/-work-my-repo/sess-1.jsonl',
  }))
  const reads: string[] = []
  on('fs.read', async (_, e) => {
    reads.push(e.path)
    return {
      value: [row('first prompt', { uuid: 'u-1' }), row('second prompt', { uuid: 'u-2' })].join(
        '\n',
      ),
    }
  })

  const toasts: string[] = []
  on('ui.toast', async (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.start({ cwd: '/work/my.repo/sub', surface: 'terminal', isInteractive: true })
  expect(reads[0]).toBe('/home/me/.claude/projects/-work-my-repo/sess-1.jsonl')

  // The kit cannot scroll a transcript, so a jump that got as far as asking
  // for one fails there; a prompt with no row id never asks.
  const ui = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND,
  })
  await ui.press({ key: 'toggle' })
  await ui.press({ key: 'prompt:0' })
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toStartWith('Cannot jump to that prompt:')
})

test('a mod loaded mid-session finds the transcript wherever it is', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/me' })
  mock.store(on)
  const projects = '/home/me/.claude/projects'
  const path = `${projects}/-work-started-here/sess-2.jsonl`
  on('command.register', async (_, e) => ({ value: { command: e.name } }))
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  on('session.id', async () => ({ value: 'sess-2' }))
  // `/cd` moved the root and a shell `cd` the cwd, both off the start folder.
  on('session.root', async () => ({ value: '/work/elsewhere' }))
  on('session.cwd', async () => ({ value: '/work/elsewhere/deep' }))
  const entry = (name: string) => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })
  on('fs.list', async () => ({
    value: [entry('-work-other'), entry('-work-started-here'), entry('-work-elsewhere')],
  }))
  on('fs.exists', async (_, e) => ({ value: e.path === path }))
  const reads: string[] = []
  on('fs.read', async (_, e) => {
    reads.push(e.path)
    return { value: [row('before install', { uuid: 'u-1' }), row('also before')].join('\n') }
  })

  await $.session.start({ cwd: '/work/elsewhere/deep', surface: 'terminal', isInteractive: true })
  expect(reads).toEqual([path])

  const ui = await $.ui.mount({
    plugin: 'prompt-timeline',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: BAND,
  })
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('≡ 2 prompts')
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`/timeline renders resumed history beyond the read cap (${surface})`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.env(on, { HOME: '/home/me' })
    mock.store(on)
    on('session.id', async () => ({ value: 'large' }))
    on('session.root', async () => ({ value: '/work' }))
    on('session.cwd', async () => ({ value: '/work' }))
    on('fs.exists', async () => ({ value: true }))
    on('fs.read', async () => ({ deny: 'File exceeds 4 MiB read limit' }))
    const calls: string[][] = []
    on('process.run', async (_, e) => {
      calls.push([...e.argv])
      return { value: { exitCode: 0, stderr: '', stdout: JSON.stringify([
        { text: 'prompt from before resume', at: NOW - DAY, id: 'old-1' },
      ]) } }
    })

    await $.command.run({ command: 'timeline' })
    const ui = await $.ui.mount({ plugin: 'prompt-timeline', surface, component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('× 1 prompts')
    expect((await ui.find({ key: 'prompt:0' }))?.text).toBe('prompt from before resume')
    expect(calls[0][0]).toBe('node')
    expect(calls[0][1]).toEndWith('/hooks/read-transcript.mjs')
    expect(calls[0][2]).toBe('/home/me/.claude/projects/-work/large.jsonl')
  })

  test(`/timeline opens even without history (${surface})`, async ($, on) => {
    mock.clock(on, { now: NOW })
    mock.store(on)
    mock.env(on, { HOME: '/nonexistent' })
    on('session.id', async () => ({ value: 'empty' }))
    on('session.root', async () => ({ value: '/work' }))
    on('session.cwd', async () => ({ value: '/work' }))
    on('fs.exists', async () => ({ value: false }))
    on('fs.list', async () => ({ value: [] }))
    await $.command.run({ command: 'timeline' })
    const ui = await $.ui.mount({ plugin: 'prompt-timeline', surface, component: 'AbovePrompt', props: BAND })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('× 0 prompts')
    expect(await ui.find({ type: 'Text', text: 'No prompts loaded yet.' })).toBeDefined()
    await ui.press({ key: 'toggle' })
    expect(await ui.find({ type: 'Text', text: 'No prompts loaded yet.' })).toBeUndefined()
  })
}

test('history read errors remain visible and do not bypass denials', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.id', async () => ({ value: 'denied' }))
  on('session.root', async () => ({ value: '/work' }))
  on('session.cwd', async () => ({ value: '/work' }))
  on('fs.exists', async () => ({ value: true }))
  on('fs.read', async () => ({ deny: 'Permission denied' }))
  let processes = 0
  on('process.run', async () => {
    processes++
    return { value: { exitCode: 0, stdout: '[]', stderr: '' } }
  })
  await $.command.run({ command: 'timeline' })
  const ui = await $.ui.mount({ plugin: 'prompt-timeline', surface: 'terminal', component: 'AbovePrompt', props: BAND })
  expect(processes).toBe(0)
  expect((await ui.findAll({ type: 'Text' })).some(t => t.text?.includes('Could not load prompt history'))).toBe(true)
})
