/** One prompt the person sent; `at` is ms since the epoch, null when unknown. */
export type Entry = { text: string; at: number | null }

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
