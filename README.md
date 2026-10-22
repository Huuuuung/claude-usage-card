# claude-usage-card: the usage stats card, back in the desktop app

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that brings back the usage stats card the Claude desktop app's Code tab used to show.

[中文说明](./README.zh-CN.md) · An unofficial community project, not affiliated with or endorsed by Anthropic.

Until mid-October 2026 the Code tab's new-session screen showed a card with your Claude Code usage: sessions, messages, tokens, active days, a daily heatmap and a Models tab. Users report it went away in Desktop v2.42304.0 ([anthropics/claude-code#102961](https://github.com/anthropics/claude-code/issues/102961), [#102098](https://github.com/anthropics/claude-code/issues/102098)); the data is still reachable through `/stats`, in a different layout. usage-card draws that card again, as a pane beside the conversation.

## What it shows

Ranges: **All**, **30d** and **7d**, and **↻** to refresh. It also refreshes when a session starts and every 10 minutes.

**Overview**

- Sessions, Messages, Total tokens, Active days, Peak hour, Favorite model
- Current and longest streak of days in a row with Claude Code
- A daily heatmap; hover a day for its tokens and messages
- How many times *Harry Potter and the Philosopher's Stone* your tokens add up to

**Models**

- Tokens per day, stacked by model
- Per model: tokens, share, input, output, cache write and cache read

## When it opens

- In a new conversation, the pane opens with your first message. The new-session screen itself is the app's own and draws nothing from plugins, so the card can't sit exactly where it used to.
- Anywhere else, type `/usage-card`. Close it with its close mark; it won't reopen in that conversation by itself.

The terminal draws the same card, with a block-character heatmap and sparkline in place of the charts.

## Install

Needs **Python 3** on your `PATH` (as `python`, `python3` or `py`). Tested with Claude Code 2.1.304 on Windows. Check yours with `claude --version`.

> **Mods are in early access.** If usage-card installs but nothing shows up, mods may not be on for your setup yet. Add this to `~/.claude/settings.json`, then start a new chat:
>
> ```json
> "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" }
> ```
>
> This turns on mods from every plugin you install, not just this one. Running `claude --debug` prints why a mod didn't load.

In a terminal session of Claude Code:

```
/plugin install usage-card --marketplace Huuuuung/claude-usage-card
```

From a shell:

```bash
claude plugin install usage-card --marketplace Huuuuung/claude-usage-card
```

In the desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Huuuuung/claude-usage-card`, then **Add plugin**.

Or try it without installing, from a clone:

```bash
git clone https://github.com/Huuuuung/claude-usage-card
claude --plugin-dir ./claude-usage-card
```

## How the numbers are counted

The figures come from the Claude Code transcripts on this computer, `~/.claude/projects/**/*.jsonl` (or under `CLAUDE_CONFIG_DIR`). Usage from other computers, the web and claude.ai chats is not included.

- **Each model response counts once.** Claude Code writes one response as several transcript lines (text, each tool call), each carrying the same usage. Forked and resumed sessions copy earlier lines too. usage-card counts each response once, by its message and request id. A tool that adds up every line will show roughly twice as many tokens; the old card's totals looked like that, so expect yours to be lower than you remember.
- **Total tokens** is input + output + cache write. **Cache read**, the earlier context read back from the prompt cache on every request, is usually far larger and is shown apart, on the Models tab.
- **Messages** are your prompts plus Claude's responses. **Sessions** are conversations, subagents left out.
- Days and the peak hour are in your computer's local time.

## Privacy

Everything stays on your computer. usage-card makes no network requests. It reads the transcripts above and keeps a cache of per-response counts in `~/.claude/cache/usage-card.json`, so only changed transcripts are read again. The cache also keeps counts from transcripts Claude Code has since cleaned up, so older history isn't lost. Delete that file to start over.

## How it works

`scripts/aggregate.py` reads the transcripts and prints per-day totals as JSON. The mod (`hooks/register.tsx`) runs it and draws the pane. Mods can't read files over 4 MiB themselves, and transcripts are often larger, hence the script.

Run the tests with `claude plugin test .` and check the mod with `claude plugin validate .`.

## License

[MIT](./LICENSE)
