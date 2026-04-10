# Vault Assistant

Chat with Claude about your Obsidian notes. Works on Mac, iPhone, and iPad.

---

## Installation

### Mac (direct)

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
- **Folder** — all notes in the same folder
- **Parent** — all notes in the parent folder
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

- Your API key is stored locally in `.obsidian/plugins/vault-assistant/data.json`
- No analytics, no telemetry, no third-party services
- The only network call is directly to `api.anthropic.com`
- Delete operations always require explicit confirmation

---

## Notes

- On iOS, after installing or updating the plugin, close and reopen Obsidian to activate it
- The plugin uses the Obsidian mobile API — no Node.js or Electron dependencies
