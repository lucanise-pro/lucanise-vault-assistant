# Vault Assistant

> **Read this before installing.** This plugin sends your note content to an external AI service. Understand what it does before you use it.

Chat with Claude AI about your Obsidian notes. Works on Mac, iPhone, and iPad.

---

## What This Plugin Does

When you send a message, the plugin:

1. **Sends your message to Anthropic's API** (`api.anthropic.com`) over HTTPS, along with a file index of the notes in scope
2. **Claude reads files on demand** — using built-in vault tools, Claude fetches only the notes it actually needs to answer your question
3. **Receives Claude's response** and displays it in the chat panel
4. **Proposes edits** as a confirmation card — you tap Apply and the file is saved seamlessly, with no character artefacts

No data is stored remotely. No server is involved other than Anthropic's own API. The plugin does not phone home, track usage, or send any telemetry.

Your **Anthropic API key** is stored locally in your vault at:
`.obsidian/plugins/lucanise-vault-assistant/data.json`

This file stays on your device (and in your iCloud if your vault is iCloud-synced). It is **never committed to this repository** — `data.json` is in `.gitignore`.

---

## Installation

### Mac (direct) — assuming your vault is in iCloud

1. In Finder, go to your vault folder → `.obsidian/plugins/`
2. Create a folder named `lucanise-vault-assistant`
3. Copy `main.js`, `manifest.json`, and `styles.css` into it
4. Open Obsidian → Settings → Community Plugins → enable **Lucanise Vault Assistant**

### iPhone / iPad (via iCloud)

1. On your Mac, open **Files** or **Finder** and navigate to:
   `iCloud Drive / Obsidian / YourVaultName / .obsidian / plugins /`
   > The `.obsidian` folder is hidden — in Finder press `Cmd+Shift+.` to show hidden files
2. Create a folder named `lucanise-vault-assistant` inside `plugins/`
3. Copy `main.js`, `manifest.json`, and `styles.css` into it
4. Wait for iCloud to sync (a few seconds)
5. On your iPhone/iPad: open Obsidian → Settings → Community Plugins
6. Toggle **Safe Mode** off if prompted, then enable **Lucanise Vault Assistant**
7. Tap the chat bubble icon in the toolbar to open the panel

---

## Setup

1. Go to **Settings → Lucanise Vault Assistant**
2. Paste your Anthropic API key (`sk-ant-...`)
   Get one at: https://console.anthropic.com
3. Choose a model — fetched live from Anthropic each time you open settings
   - **Opus** — most powerful, best for complex writing and cross-note analysis
   - **Sonnet** — recommended balance of quality and speed
   - **Haiku** — fastest and cheapest, good for quick questions
4. Set **Max Tokens** — default 8192, raise if edits are cut short on large notes
5. Optionally set a **Saved Notes Folder** for Claude-created notes

---

## How to Use

Open the panel via the ribbon icon or Command Palette (`Open Vault Assistant`).

### Scope selector

The **scope** at the top works like a working directory — it tells Claude which part of your vault to operate in:

| Scope | What Claude can access |
|---|---|
| **Note** | The currently open note (pre-loaded) |
| **Folder ▾** | All notes inside the selected folder and its subfolders |
| **Vault** | Your entire vault |

For Folder and Vault scope, Claude receives a file index and fetches specific notes on demand using tools. You will see a live status like *"Reading filename.md…"* or *"Searching notes…"* while Claude is working.

### What Claude can do

- Summarise, analyse, rewrite, translate, extend, or restructure any note
- Search across notes for a topic, then synthesise an answer
- Compare multiple notes and spot connections
- Extract action items, decisions, or themes
- Create new notes or reorganise existing ones
- Answer questions grounded in your actual vault content

### Example prompts

- "Summarise this note in 3 bullet points"
- "Rewrite the intro more casually"
- "What are all my action items across the Projects folder?"
- "Find every note that mentions the word budget and summarise them"
- "Create a new note called Weekly Review with a template"
- "Translate this note to Italian"
- "What decisions did I make last month?" *(Vault scope)*

### Edit proposals

When Claude proposes creating or editing a note, a **proposal card** appears:

```
✏️ Edit: meeting-notes.md
"Rewrote introduction for clarity"
┌────────────────────────────┐
│ # Meeting Notes            │  ← tap to expand preview
│ New content here...        │
└────────────────────────────┘
[Apply]  [Discard]
```

- **Tap the preview** to expand and see more content before deciding
- **Apply** → writes the change to your vault instantly, with correct markdown
- **Discard** → ignores it

### Standard response actions

- **New note** → saves Claude's reply as a new `.md` file
- **Append** → appends it to the bottom of the currently open note
- **Copy** → copies the reply text to the clipboard

---

## Privacy & Security

- Your API key is stored locally in `.obsidian/plugins/lucanise-vault-assistant/data.json` — on your device only
- `data.json` is excluded from this repository via `.gitignore` — it will never be committed or published
- No analytics, no telemetry, no third-party services beyond Anthropic's API
- The only network call is directly to `api.anthropic.com`
- Note content is sent to Anthropic only when Claude actually needs to read it (on-demand via tools)
- Delete operations always require explicit confirmation
- You can revoke your API key at any time at https://console.anthropic.com

---

## Note Cache

The plugin caches note reads within a session for token efficiency. The cache auto-invalidates:

- **Immediately** when a file is modified in Obsidian
- **After 10 minutes** (TTL safety net)
- **At 50 entries max** (LRU eviction)

You can also clear it manually via **Settings → Clear Note Cache**.

---

## Notes

- On iOS, after installing or updating the plugin, close and reopen Obsidian to activate it
- The plugin uses the Obsidian mobile API — no Node.js or Electron dependencies
- Tool calls (read, list, search, edit, create) count toward your Anthropic API usage
- Prompt caching is enabled automatically — subsequent turns in a conversation cost ~80% less on system prompt tokens

---

## Contributing & Repository Policy

This repository is **public for transparency** — so you can read the source code and verify exactly what the plugin does.

**However, this is a personal project with no external contributions accepted.**

- Pull requests will not be reviewed or merged
- Issues may be read but responses are not guaranteed
- Only the author (@Lucanise) has write access to this repository
- Forking for personal use is permitted under the terms of the LICENSE

---

## Disclaimer

> **USE AT YOUR OWN RISK. BY INSTALLING OR USING THIS PLUGIN YOU ACKNOWLEDGE AND AGREE TO THE FOLLOWING:**

This plugin is provided **as-is**, with **no warranties of any kind**, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement.

**The author assumes absolutely no responsibility or liability for:**

- Any data sent to Anthropic's API, including the content of your notes
- Any API costs, overages, or charges incurred through your Anthropic account
- Any data loss, corruption, or unintended modifications to your vault or notes
- Any security breach, unauthorized access, or exposure of your API key or note content
- Any misuse of the plugin, intentional or unintentional
- Any consequences arising from actions taken based on AI-generated responses
- Any downtime, errors, or unexpected behaviour of the Anthropic API or third-party services
- Any violation of Anthropic's [Terms of Service](https://www.anthropic.com/policies/usage) by the end user

**Your responsibilities as a user:**

- You are solely responsible for understanding the implications of sending your note content to a third-party AI service
- You are solely responsible for all API costs and usage under your Anthropic account
- You must ensure that the content you send complies with Anthropic's Terms of Service and all applicable laws
- Always maintain independent backups of your vault — do not rely on this plugin as a data safety mechanism

This plugin is an **independent, unofficial tool** and is not affiliated with, endorsed by, or supported by Anthropic or Obsidian in any way.

The author reserves the right to discontinue development or support at any time without notice.
