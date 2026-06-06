# Lucanise Vault Assistant

> **Your AI thinking partner, living inside Obsidian.**

Chat with Claude — Anthropic's most capable AI — directly inside Obsidian. Ask questions about your notes, get summaries, draft new content, rewrite sections, and let Claude edit your vault seamlessly. Works on Mac, iPhone, and iPad.

---

## Why This Plugin Exists

Most AI tools treat your notes as an afterthought — you copy text out, paste it in, copy the result back. That breaks your flow and loses context.

**Lucanise Vault Assistant is different.** Claude has direct access to your vault. It reads what it needs, when it needs it. When it proposes a change, a single tap writes it to your file — no copy-pasting, no broken markdown, no character artefacts. It works the way you'd expect a real AI assistant to work.

Think of it like having a senior editor, researcher, and writing partner available 24/7, who has actually read your notes.

---

## What It Can Do

| Task | Example prompt |
|---|---|
| **Summarise** | "Give me a 3-bullet summary of this note" |
| **Rewrite** | "Rewrite the intro more casually" |
| **Translate** | "Translate this note to Italian" |
| **Research across notes** | "What decisions did I make last month?" |
| **Find connections** | "Which notes mention the project deadline?" |
| **Extract insights** | "List all action items across my Projects folder" |
| **Create new notes** | "Create a Weekly Review template and save it" |
| **Edit existing notes** | "Add a summary section at the top of this note" |

Claude reads your vault on demand — fetching only the files it actually needs, not dumping everything into the prompt at once. This keeps it fast, accurate, and cost-efficient.

---

## Privacy First

> **Read this before installing.** This plugin sends your note content to an external AI service.

- Your note content is sent to **Anthropic's API only** (`api.anthropic.com`, HTTPS) — and only when Claude needs to read it
- Your **API key** is stored locally at `.obsidian/plugins/lucanise-vault-assistant/data.json` — on your device only, never committed to this repo
- **No analytics, no telemetry, no third-party services** beyond Anthropic's own API
- **No data stored remotely** — Anthropic processes your request and returns a response; nothing is retained by this plugin
- You can revoke your API key at any time at https://console.anthropic.com

---

## How It Works

When you send a message, the plugin:

1. **Reads the scope you selected** — the active note, a folder, or your entire vault
2. **Sends your message + a file index to Claude** — Claude decides which notes to actually open
3. **Claude uses vault tools on demand** — reading, searching, and writing files as needed
4. **Proposes edits as a confirmation card** — you review and tap Apply; the file is saved instantly with correct markdown

No round-trips. No broken formatting. No copy-pasting.

---

## Installation

### Mac — assuming your vault is in iCloud

1. In Finder, go to your vault folder → `.obsidian/plugins/`
2. Create a folder named `lucanise-vault-assistant`
3. Copy `main.js`, `manifest.json`, and `styles.css` into it
4. Open Obsidian → Settings → Community Plugins → enable **Lucanise Vault Assistant**

### iPhone / iPad (via iCloud)

1. On your Mac, open **Finder** and navigate to:
   `iCloud Drive / Obsidian / YourVaultName / .obsidian / plugins /`
   > The `.obsidian` folder is hidden — press `Cmd+Shift+.` to show hidden files
2. Create a folder named `lucanise-vault-assistant` inside `plugins/`
3. Copy `main.js`, `manifest.json`, and `styles.css` into it
4. Wait for iCloud to sync (a few seconds to a minute)
5. On your iPhone/iPad: open Obsidian → Settings → Community Plugins
6. Toggle **Safe Mode** off if prompted, then enable **Lucanise Vault Assistant**
7. Tap the chat bubble icon in the toolbar to open the panel

---

## Setup

1. Go to **Settings → Lucanise Vault Assistant**
2. Paste your Anthropic API key (`sk-ant-...`)
   Get one at: https://console.anthropic.com
3. Choose a model — fetched live from Anthropic each time you open settings:
   - **Opus** — most powerful; best for complex writing, deep analysis, cross-note synthesis
   - **Sonnet** — recommended; excellent balance of quality, speed, and cost *(default)*
   - **Haiku** — fastest and cheapest; great for quick questions and simple edits
4. Set **Max Tokens** — default 8192; raise to 16384 if edits are cut short on large notes
5. Optionally set a **Saved Notes Folder** for notes created by Claude

---

## Using the Plugin

Open the panel via the ribbon icon or Command Palette (`Open Vault Assistant`).

### Scope — your working directory

The **scope selector** at the top tells Claude which part of your vault to operate in. Think of it like a working directory in a terminal.

| Scope | What Claude can access |
|---|---|
| **Note** | The currently open note — pre-loaded and ready |
| **Folder ▾** | All notes inside a selected folder and its subfolders |
| **Vault** | Your entire vault |

For Folder and Vault scope, Claude receives a full file index and fetches notes on demand. You'll see live status like *"Reading meeting-notes.md…"* or *"Searching notes…"* while Claude works.

### Edit proposals

When Claude proposes creating or editing a note, a **proposal card** appears inline in the chat:

```
✏️  Edit: meeting-notes.md
    "Rewrote introduction for clarity"
┌────────────────────────────────┐
│ # Meeting Notes                │  ← tap to expand preview
│ Revised content here...        │
└────────────────────────────────┘
  [Apply]  [Discard]
```

- **Tap the preview** to expand and read the full proposed content before deciding
- **Apply** → writes the file instantly, with clean markdown — no artefacts
- **Discard** → ignores the proposal, nothing is changed

### Response actions

Every Claude response also has three quick actions:

- **New note** → saves the reply as a new `.md` file in your vault
- **Append** → appends it to the bottom of the currently open note
- **Copy** → copies the text to your clipboard

---

## Token Efficiency & Caching

The plugin is designed to be as cost-efficient as possible:

- **Prompt caching** — the system prompt is cached automatically. From the second turn onwards, system prompt tokens cost ~80% less
- **On-demand reads** — Claude only reads the files it actually needs, not your whole vault upfront
- **Sliding window** — older turns are compressed to keep conversation context lean without losing important history
- **Note cache** — recently read notes are cached in-session so Claude doesn't re-fetch the same file repeatedly

The note cache auto-invalidates:
- **Immediately** when a file is modified in Obsidian
- **After 10 minutes** (TTL safety net for files changed by external apps or sync)
- **At 50 entries max** (LRU eviction)

You can also clear it manually via **Settings → Clear Note Cache** if Claude seems to be reading stale content.

---

## Notes & Known Behaviour

- On **iOS/iPadOS**, after installing or updating the plugin, close and reopen Obsidian fully to activate it
- The plugin uses the **Obsidian mobile API** — no Node.js or Electron dependencies, works natively on iPhone and iPad
- **Tool calls** (read, list, search, edit, create) each count as API usage toward your Anthropic account
- The plugin does **not** access the internet except to call `api.anthropic.com`
- Delete operations always require your explicit confirmation before executing

---

## Contributing & Repository Policy

This repository is **public for transparency** — so you can read the source code and verify exactly what the plugin does with your data.

**This is a personal project. External contributions are not accepted.**

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
