# prompt-timeline

A Claude Code mod that shows a timeline of your prompts in the current session, in the style of ampcode's prompt history.

- A `≡ N prompts` toggle sits at the bottom right, just above the prompt box. Press it, or run `/timeline`, to open the list.
- The list is a small box above the toggle, showing 8 prompts at a time with ages like `11m ago` or `3d ago`. The newest prompt is brighter. `▲ N earlier` and `▼ N newer` page through older and newer prompts.
- Pressing a prompt puts its text back in the prompt box.

Prompts and their timestamps come from the session's transcript, so a resumed session lists the prompts it had before. If the transcript is over 4 MiB, the list falls back to the prompts sent since the mod loaded.

## Install

At the prompt of a terminal session:

```
/plugin install prompt-timeline --marketplace Tyru5/claude-timeline
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```
claude plugin install prompt-timeline --marketplace Tyru5/claude-timeline
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Tyru5/claude-timeline`, then Add plugin.

## Develop

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
