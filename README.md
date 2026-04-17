# Vault Assistant

> **Read this before installing.** This plugin sends your note content to an external AI service. Understand what it does before you use it.

Chat with Claude AI about your Obsidian notes. Works on Mac, iPhone, and iPad.

---

## What This Plugin Does

When you send a message, the plugin:

1. **Reads your note(s)** from your local vault — depending on the scope you select (single note, folder, or entire vault)
2. **Sends that content to Anthropic's API** (`api.anthropic.com`) over HTTPS, along with your message
3. **Receives Claude's response** and displays it in the chat panel
4. Optionally **writes back to your vault** if you ask Claude to create or edit a note and you confirm by tapping **Apply**

No data is stored remotely. No server is involved other than Anthropic's own API. The plugin does not phone home, track usage, or send any telemetry.

Your **Anthropic API key** is stored locally in your vault at:
`.obsidian/plugins/vault-assistant/data.json`

This file stays on your device (and in your iCloud if your vault is iCloud-synced). It is **never committed to this repository** — `data.json` is in `.gitignore`.

---

## Installation

### Mac (direct) - Assuming you have the vault in iCloud

1. In Finder, go to your vault folder → `.obsidian/plugins/`
2. Create a folder named `vault-assistant`
3. Copy `main.js`, `manifest.json`, and `styles.css` into it
4. Open Obsidian → Settings → Community Plugins → enable **Vault Assistant**

### iPhone / iPad (via iCloud)

1. On your Mac, open **Files** or **Finder** and navigate to:
   `iCloud Drive / Obsidian / YourVaultName / .obsidian / plugins /`
   > The `.obsidian` folder is hidden — in Finder press `Cmd+Shift+.` to show hidden files
2. Create a folder named `vault-assistant` inside `plugins/`
3. Copy `main.js`, `manifest.json`, and `styles.css` into it
4. Wait for iCloud to sync (a few seconds)
5. On your iPhone/iPad: open Obsidian → Settings → Community Plugins
6. Toggle **Safe Mode** off if prompted, then enable **Vault Assistant**
7. Tap the chat bubble icon in the toolbar to open the panel

---

## Setup

1. Go to **Settings → Vault Assistant**
2. Paste your Anthropic API key (`sk-ant-...`)
   Get one at: https://console.anthropic.com
3. Choose a model (Sonnet = smarter, Haiku = faster/cheaper)
4. Adjust max tokens if needed (default 2048 is fine)

---

## How to Use

Open the panel via the ribbon icon or Command Palette (`Open Vault Assistant`).

**Scope selector** at the top controls what Claude can see:
- **Note** — only the current note
- **Folder** — all notes in a chosen folder
- **Vault** — your entire vault (truncated at ~50k chars)

Just type naturally. Examples:
- "Summarize this note in 3 bullet points"
- "Rewrite the intro more casually"
- "What action items are in this note?"
- "Create a new note called Weekly Review with a template"
- "Translate this note to Italian"

**After every response:**
- **Save as note** → saves Claude's reply as a new `.md` file
- **Add to note** → appends it to the bottom of your current note

**If Claude suggests an edit:**
- **Apply** → writes the change to your vault immediately
- **Discard** → ignores it

---

## Privacy & Security

- Your API key is stored locally in `.obsidian/plugins/vault-assistant/data.json` — on your device only
- `data.json` is excluded from this repository via `.gitignore` — it will never be committed or published
- No analytics, no telemetry, no third-party services beyond Anthropic's API
- The only network call is directly to `api.anthropic.com`
- Delete operations always require explicit confirmation
- You can revoke your API key at any time at https://console.anthropic.com

---

## Notes

- On iOS, after installing or updating the plugin, close and reopen Obsidian to activate it
- The plugin uses the Obsidian mobile API — no Node.js or Electron dependencies

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
