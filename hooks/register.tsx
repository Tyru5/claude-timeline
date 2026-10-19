import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry } from '../types'

const COMMAND = 'timeline'
const MAX = 500
const TICK_MS = 30_000
// Popover size: rows of prompts shown at once, and its widest.
const WINDOW = 8
const MAX_WIDTH = 72

const prompts = atom({ plugin: 'prompt-timeline', key: 'prompts' } as const, [])
const now = atom({ plugin: 'prompt-timeline', key: 'now' } as const, 0)
// The transcript file found for the session, kept across reloads.
const transcript = atom({ plugin: 'prompt-timeline', key: 'transcript' } as const, '')
const isOpen = atom({ plugin: 'prompt-timeline', key: 'isOpen' } as const, false)
// How many of the newest prompts the window has paged back past.
const back = atom({ plugin: 'prompt-timeline', key: 'back' } as const, 0)

let ticker: { cancel: () => void } | undefined

// Wrappers the engine adds around what was typed; never part of a prompt.
const NOISE =
  /<(system-reminder|local-command-[a-z]+|bash-std(?:out|err)|command-message)>[\s\S]*?<\/\1>/g

/** "3d ago" style age of `at` relative to `nowMs`. */
export function ago(at: number, nowMs: number): string {
  const m = Math.floor(Math.max(0, nowMs - at) / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

/** What the person typed, out of a transcript row's text; null for none. */
export function cleanPrompt(raw: string): string | null {
  const name = raw.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]
  if (name !== undefined) {
    const args = raw.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? ''
    return `${name.trim()} ${args.trim()}`.trim() || null
  }
  const bash = raw.match(/<bash-input>([\s\S]*?)<\/bash-input>/)?.[1]
  if (bash !== undefined) return `! ${bash.trim()}`
  const text = raw.replace(NOISE, '').trim()
  if (!text || text.startsWith('[Request interrupted') || text.startsWith('Caveat:')) {
    return null
  }
  return text
}

const isOwnCommand = (text: string) => text === `/${COMMAND}` || text.startsWith(`/${COMMAND} `)

/** The person's prompts in a session transcript (JSONL), oldest first. */
export function parseTranscript(jsonl: string): Entry[] {
  const out: Entry[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"type":"user"')) continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.type !== 'user' || row.isMeta || row.isSidechain || row.isCompactSummary) continue
    const content = row.message?.content
    const blocks: any[] =
      typeof content === 'string'
        ? [{ type: 'text', text: content }]
        : Array.isArray(content)
          ? content
          : []
    if (blocks.some(b => b?.type === 'tool_result')) continue
    const text = cleanPrompt(
      blocks
        .filter(b => b?.type === 'text')
        .map(b => b.text)
        .join('\n'),
    )
    if (!text || isOwnCommand(text)) continue
    const at = Date.parse(row.timestamp)
    out.push({ text, at: Number.isNaN(at) ? null : at, id: row.uuid })
  }
  return out.slice(-MAX)
}

/** First line, whitespace collapsed, cut to `width` cells with an ellipsis. */
export function clip(text: string, width: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= width ? line : `${line.slice(0, Math.max(1, width - 1))}…`
}

async function tick($: EngineInterface) {
  const t = await $.clock.now()
  await update($, now, () => t)
}

const projectDir = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-')

// The transcript's folder is named for the directory the session started in,
// which a mod loaded mid-session cannot read off `e.cwd` (a shell `cd` moves
// it): try the likely folders, then every one. Null until the file exists.
async function findTranscript($: EngineInterface): Promise<string | null> {
  const file = `${await $.session.id()}.jsonl`
  const known = await read($, transcript)
  if (known.endsWith(`/${file}`)) return known

  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) || `${await $.env.get('HOME')}/.claude`
  const projects = `${dir}/projects`
  const guesses = [await $.session.root(), await $.session.cwd()].map(
    cwd => `${projects}/${projectDir(cwd)}/${file}`,
  )
  let path: string | undefined
  for (const guess of guesses) {
    if (await $.fs.exists(guess)) {
      path = guess
      break
    }
  }
  if (!path) {
    const all = (await $.fs.list(projects))
      .filter(entry => entry.kind === 'dir')
      .map(entry => `${projects}/${entry.name}/${file}`)
    const found = await Promise.all(all.map(p => $.fs.exists(p)))
    path = all[found.indexOf(true)]
  }
  if (!path) return null
  await update($, transcript, () => path)
  return path
}

// The transcript is the source of truth (timestamps, history before a resume);
// when it is missing or over the 4 MiB read cap, the live list stands.
async function reload($: EngineInterface) {
  try {
    const path = await findTranscript($)
    if (!path) throw new Error('no transcript yet')
    const list = parseTranscript(await $.fs.read(path))
    if (list.length > 0) await update($, prompts, () => list)
  } catch {
    // keep the live list
  }
  await tick($)
}

// A transcript row moves only for the person's own input, so this runs from a press.
async function jump($: EngineInterface, entry: Entry) {
  if (!entry.id) {
    $.ui.toast('That prompt is not in the transcript yet.')
    return
  }
  const { deny } = await $.ui
    .scroll({ to: { requestId: entry.id }, block: 'start' })
    .catch((error: unknown) => ({ deny: String(error) }))
  if (deny) $.ui.toast(`Cannot jump to that prompt: ${deny}`)
}

async function setOpen($: EngineInterface, open: boolean) {
  ticker?.cancel()
  ticker = undefined
  if (open) {
    await reload($)
    await update($, back, () => 0)
    ticker = $.clock.every(TICK_MS, () => tick($))
  }
  await update($, isOpen, () => open)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Toggle the timeline of your prompts this session',
      immediate: true,
    })
    await reload($)
    // A hot reload drops the ticker; bring it back for a popover left open.
    if (await read($, isOpen)) await setOpen($, true)

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const open = !(await read($, isOpen))
    await setOpen($, open)

    return { text: open ? 'Prompt timeline opened.' : 'Prompt timeline closed.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // Never let bookkeeping hold up a prompt.
    if (!e.isMeta && e.command?.name !== COMMAND) {
      try {
        const text = cleanPrompt(e.text) ?? e.text.trim()
        const at = await $.clock.now()
        if (text) await update($, prompts, list => [...list, { text, at }].slice(-MAX))
        await update($, now, () => at)
        await update($, back, () => 0)
      } catch {
        // drop this one; the next reload picks it up from the transcript
      }
    }

    const entered = await next(e)
    // The prompt is in the transcript now: pick up its row id for jumping.
    if (!e.isMeta) await reload($).catch(() => undefined)

    return entered
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await reload($)

    return next(e)
  })

  // amp-style: a toggle at the bottom right of the band, the popover above it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, prompts)
    if (e.props.hasSurvey || list.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const open = await read($, isOpen)
    // Rows, not alignItems: a column does not carry a Button to its right edge.
    const toggle = (
      <Box key="toggle-row" flexDirection="row" justifyContent="flex-end">
        <Button
          key="toggle"
          plain
          dimColor={!open}
          label={open ? `× ${list.length} prompts` : `≡ ${list.length} prompts`}
          onPress={() => setOpen($, !open)}
        />
      </Box>
    )
    if (!open) return toggle

    const t = await read($, now)
    const skipped = Math.min(await read($, back), Math.max(0, list.length - WINDOW))
    const end = list.length - skipped
    const start = Math.max(0, end - WINDOW)
    const width = Math.min(MAX_WIDTH, e.props.bodyColumns)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="flex-end">
          <Box flexDirection="column" width={width} borderStyle="round" borderDimColor paddingX={1}>
            {start > 0 && (
              <Button
                key="older"
                plain
                dimColor
                label={`▲ ${start} earlier`}
                onPress={() => update($, back, n => Math.min(n + WINDOW, list.length - WINDOW))}
              />
            )}
            {list.slice(start, end).map((entry, j) => {
              const i = start + j
              const isLatest = i === list.length - 1
              const when = entry.at === null ? '' : ago(entry.at, t)
              // border and padding take four cells, the gap before the age one
              const room = Math.max(8, width - 4 - when.length - 1)

              return (
                <Box key={`row:${i}`} flexDirection="row" justifyContent="space-between">
                  <Button
                    key={`prompt:${i}`}
                    plain
                    label={clip(entry.text, room)}
                    dimColor={!isLatest}
                    onPress={() => jump($, entry)}
                  />
                  <Text dimColor={!isLatest} bold={isLatest}>
                    {when}
                  </Text>
                </Box>
              )
            })}
            {skipped > 0 && (
              <Button
                key="newer"
                plain
                dimColor
                label={`▼ ${skipped} newer`}
                onPress={() => update($, back, n => Math.max(0, n - WINDOW))}
              />
            )}
          </Box>
        </Box>
        {toggle}
      </Box>
    )
  })
}
