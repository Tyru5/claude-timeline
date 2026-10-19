import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const helper = fileURLToPath(new URL('./read-transcript.mjs', import.meta.url))
const row = (text, extra = {}) => JSON.stringify({ type: 'user', message: { content: text }, timestamp: '2026-10-19T12:00:00Z', ...extra })

test('streams prompts around more than 4 MiB of tool output, with ids and timestamps', () => {
  const dir = mkdtempSync(join(tmpdir(), 'timeline-'))
  try {
    const path = join(dir, 'transcript with spaces.jsonl')
    writeFileSync(path, [
      row('before tools', { uuid: 'before' }),
      row([{ type: 'tool_result', content: 'x'.repeat(5 * 1024 * 1024) }]),
      row('hidden', { isMeta: true }),
      row('summary', { isCompactSummary: true }),
      row('subagent', { isSidechain: true }),
      row('<local-command-stdout>output</local-command-stdout>'),
      row('<command-name>/timeline</command-name>'),
      row('after tools', { uuid: 'after' }),
      '{partial',
    ].join('\n'))
    const result = spawnSync(process.execPath, [helper, path], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), [
      { text: 'before tools', at: Date.parse('2026-10-19T12:00:00Z'), id: 'before' },
      { text: 'after tools', at: Date.parse('2026-10-19T12:00:00Z'), id: 'after' },
    ])
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('bounds UTF-8 output and retains the newest prompts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'timeline-'))
  try {
    const path = join(dir, 'large.jsonl')
    writeFileSync(path, Array.from({ length: 700 }, (_, i) => row('界'.repeat(1000), { uuid: `p${i}` })).join('\n'))
    const result = spawnSync(process.execPath, [helper, path], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const entries = JSON.parse(result.stdout)
    assert.ok(Buffer.byteLength(result.stdout) <= 48 * 1024)
    assert.ok(entries.length > 0 && entries.length <= 500)
    assert.equal(entries.at(-1).id, 'p699')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('unreadable history fails explicitly', () => {
  const result = spawnSync(process.execPath, [helper, '/nonexistent/timeline.jsonl'], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Cannot read transcript/)
})
