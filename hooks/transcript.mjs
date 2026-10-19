export const MAX = 500

// Wrappers added by the engine, rather than typed by the person.
const NOISE =
  /<(system-reminder|local-command-[a-z]+|bash-std(?:out|err)|command-message)>[\s\S]*?<\/\1>/g

export function cleanPrompt(raw) {
  const name = raw.match(/<command-name>([\s\S]*?)<\/command-name>/)?.[1]
  if (name !== undefined) {
    const args = raw.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? ''
    return `${name.trim()} ${args.trim()}`.trim() || null
  }
  const bash = raw.match(/<bash-input>([\s\S]*?)<\/bash-input>/)?.[1]
  if (bash !== undefined) return `! ${bash.trim()}`
  const text = raw.replace(NOISE, '').trim()
  if (!text || text.startsWith('[Request interrupted') || text.startsWith('Caveat:')) return null
  return text
}

export function parseTranscript(jsonl) {
  const out = []
  for (const line of jsonl.split('\n')) {
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row?.type !== 'user' || row.isMeta || row.isSidechain || row.isCompactSummary) continue
    const content = row.message?.content
    const blocks = typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : Array.isArray(content) ? content : []
    if (blocks.some(b => b?.type === 'tool_result')) continue
    const text = cleanPrompt(blocks.filter(b => b?.type === 'text').map(b => b.text).join('\n'))
    if (!text || text === '/timeline' || text.startsWith('/timeline ')) continue
    const at = Date.parse(row.timestamp)
    out.push({ text, at: Number.isNaN(at) ? null : at, id: row.uuid })
  }
  return out.slice(-MAX)
}
