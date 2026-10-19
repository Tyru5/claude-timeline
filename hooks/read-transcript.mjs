import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { MAX, parseTranscript } from './transcript.mjs'

// Only compact prompt previews cross the process API, never the tool output
// that makes transcripts large. Bound both the retained rows and stdout.
const OUTPUT_BYTES = 48 * 1024
const entries = []
let bytes = 2
try {
  const lines = createInterface({ input: createReadStream(process.argv[2]), crlfDelay: Infinity })
  for await (const line of lines) {
    const entry = parseTranscript(line)[0]
    if (!entry) continue
    entry.text = entry.text.replace(/\s+/g, ' ').trim().slice(0, 512)
    const json = JSON.stringify(entry)
    entries.push(json)
    bytes += Buffer.byteLength(json) + 1
    while (entries.length > MAX || bytes > OUTPUT_BYTES) {
      bytes -= Buffer.byteLength(entries.shift()) + 1
    }
  }
  process.stdout.write(`[${entries.join(',')}]`)
} catch (error) {
  process.stderr.write(`Cannot read transcript: ${error.message}\n`)
  process.exitCode = 1
}
