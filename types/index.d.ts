/**
 * One prompt the person sent; `at` is ms since the epoch, null when unknown;
 * `id` is its transcript row's uuid, absent until the transcript is read.
 */
export type Entry = { text: string; at: number | null; id?: string }

declare module 'claude-code' {
  interface PluginState {
    'prompt-timeline': {
      prompts: Entry[]
      now: number
      cwd: string
      isOpen: boolean
      back: number
    }
  }
}
