# pi-dotfiles

Personal dotfiles and configuration for the [pi coding agent](https://github.com/earendil-works/pi-mono).

## What's included

| Path | Description |
|------|-------------|
| `.pi/agent/settings.json` | Agent settings (theme, default model, provider, etc.) |
| `.pi/agent/models.json` | Custom model/provider definitions |
| `.pi/agent/themes/blue-minimal.json` | Custom blue-minimal terminal theme |
| `.pi/agent/extensions/blue-minimal-header.ts` | Custom header/footer extension |
| `.pi/agent/extensions/opencode-layout.ts` | OpenCode-style UI layout (bottom input, minimal chrome) |


## Excluded (sensitive/private)

- `.pi/agent/auth.json` — API keys and credentials
- `.pi/agent/sessions/` — Conversation history
- `.pi/agent/paperclips/` — Saved conversation snippets
- `.pi/agent/bin/` — Third-party binaries

## Installation

```bash
# Clone into home directory
git clone https://github.com/abboskhonov/pi-dotfiles.git ~/pi-dotfiles

# Copy files to their locations (backup originals first)
cp -r ~/pi-dotfiles/.pi ~/.pi
```

## Extensions

### OpenCode Layout

Run `/opencode` in pi to toggle the OpenCode-style layout:

- Minimal header (hidden)
- Blue left-border accent on the input editor
- Status bar in editor borders: model, thinking level, token usage, cwd, git branch
- Minimal working indicator (blue pulse dot)
- Hidden default footer

Run `/opencode-reset` to restore default pi UI.

## License

MIT
