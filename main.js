/*
 * Vault Assistant — Obsidian Plugin
 * Chat with Claude about your notes. Works on iOS/iPadOS.
 */

const {
    Plugin,
    PluginSettingTab,
    Setting,
    ItemView,
    Modal,
    Notice,
    requestUrl,
    MarkdownRenderer,
    TFolder,
    TFile,
    setIcon,
} = require('obsidian');

const VIEW_TYPE = 'vault-assistant-view';

const DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'claude-sonnet-4-6',
    maxTokens: 2048,
    savedNotesFolder: '',
};

// ─── Vault Tools (used with the Anthropic tool_use API) ──────────────────────

const VAULT_TOOLS = [
    {
        name: 'read_note',
        description: 'Read the full content of a specific note in the vault. Call this whenever you need to see what a note contains before summarising, editing, translating, or answering questions about it.',
        input_schema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Full vault path, e.g. "Projects/Meeting Notes.md"' },
            },
            required: ['path'],
        },
    },
    {
        name: 'list_folder',
        description: 'List the notes and subfolders directly inside a folder. Use this to explore the vault structure before deciding which files to read.',
        input_schema: {
            type: 'object',
            properties: {
                folder_path: { type: 'string', description: 'Folder path to list, e.g. "Projects" or "" for vault root' },
            },
            required: ['folder_path'],
        },
    },
    {
        name: 'search_notes',
        description: 'Search for notes whose title or content matches a keyword or phrase. Returns up to 20 matching paths with short excerpts. Use before read_note when you are not sure which file contains the relevant information.',
        input_schema: {
            type: 'object',
            properties: {
                query:       { type: 'string', description: 'Text to search for' },
                folder_path: { type: 'string', description: 'Optional — restrict search to this folder and its subfolders' },
            },
            required: ['query'],
        },
    },
];

// ─── Main Plugin ─────────────────────────────────────────────────────────────

class VaultAssistantPlugin extends Plugin {
    async onload() {
        await this.loadSettings();
        this.registerView(VIEW_TYPE, (leaf) => new VaultAssistantView(leaf, this));
        this.addRibbonIcon('message-circle', 'Vault Assistant', () => this.activateView());
        this.addCommand({
            id: 'open-vault-assistant',
            name: 'Open Vault Assistant',
            callback: () => this.activateView(),
        });
        this.addSettingTab(new VaultAssistantSettingTab(this.app, this));
    }

    onunload() {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false) || workspace.getRightLeaf(true);
            await leaf.setViewState({ type: VIEW_TYPE, active: true });
        }
        workspace.revealLeaf(leaf);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// ─── Chat View ────────────────────────────────────────────────────────────────

class VaultAssistantView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin     = plugin;
        this.messages   = [];   // display-only: [{role, content: string}]
        this.apiHistory = [];   // full API history including tool_use blocks
        this.scope      = 'note';
        this.folderPath = null;
    }

    getViewType()    { return VIEW_TYPE; }
    getDisplayText() { return 'Vault Assistant'; }
    getIcon()        { return 'message-circle'; }

    async onOpen() {
        this.buildUI();
        // Update scope hint whenever the user navigates to a different note
        this.registerEvent(
            this.app.workspace.on('file-open', () => this.updateScopeHint())
        );
    }

    async onClose() {}

    // ── UI ────────────────────────────────────────────────────────────────────

    buildUI() {
        const root = this.containerEl.children[1];
        root.empty();
        root.addClass('va-root');

        this.buildHeader(root);
        this.messagesEl = root.createDiv('va-messages');
        this.buildEmptyState();
        this.buildInputArea(root);

        this.messages.forEach(msg => this.renderMessage(msg, false));
        if (this.messages.length === 0) this.showEmptyState();
        this.scrollToBottom();
    }

    buildEmptyState() {
        this.emptyStateEl = this.messagesEl.createDiv('va-empty-state');
        const iconEl = this.emptyStateEl.createDiv('va-empty-icon');
        setIcon(iconEl, 'message-circle');
        this.emptyStateEl.createDiv({ cls: 'va-empty-title', text: 'Vault Assistant' });
        this.emptyStateEl.createDiv({ cls: 'va-empty-sub', text: 'Ask anything about your notes' });
        this.emptyStateEl.style.display = 'none';
    }

    showEmptyState() {
        if (this.emptyStateEl) this.emptyStateEl.style.display = 'flex';
    }

    hideEmptyState() {
        if (this.emptyStateEl) this.emptyStateEl.style.display = 'none';
    }

    buildHeader(parent) {
        // Top bar: segmented scope control + clear button
        const bar = parent.createDiv('va-header');
        this.scopeBarEl = bar;

        const seg = bar.createDiv('va-segment');

        // Note button
        const noteBtn = seg.createEl('button', {
            text: 'Note',
            cls: 'va-seg-btn' + (this.scope === 'note' ? ' va-seg-active' : ''),
        });
        noteBtn.addEventListener('click', () => this.setScope('note', null));

        // Folder button — opens full tree picker
        this.folderScopeBtn = seg.createEl('button', {
            text: this.scope === 'folder' && this.folderPath !== null
                ? this.truncateFolderLabel(this.folderPath)
                : 'Folder ▾',
            cls: 'va-seg-btn va-seg-btn-folder' + (this.scope === 'folder' ? ' va-seg-active' : ''),
        });
        this.folderScopeBtn.addEventListener('click', () => {
            new FolderScopeModal(this.app, this).open();
        });

        // Vault button
        const vaultBtn = seg.createEl('button', {
            text: 'Vault',
            cls: 'va-seg-btn' + (this.scope === 'vault' ? ' va-seg-active' : ''),
        });
        vaultBtn.addEventListener('click', () => this.setScope('vault', null));

        // Clear button (trash icon)
        const clearBtn = bar.createEl('button', {
            cls: 'va-clear-btn',
            attr: { title: 'Clear conversation', 'aria-label': 'Clear conversation' },
        });
        setIcon(clearBtn, 'trash-2');
        clearBtn.addEventListener('click', () => this.clearMessages());

        // Scope hint line — updates on file change
        this.scopeHintEl = parent.createDiv('va-scope-hint');
        this.updateScopeHint();
    }

    updateScopeHint() {
        if (!this.scopeHintEl) return;
        const active = this.app.workspace.getActiveFile();

        if (this.scope === 'note') {
            this.scopeHintEl.textContent = active ? `📄 ${active.name}` : 'No note open';
        } else if (this.scope === 'folder') {
            if (!this.folderPath) {
                this.scopeHintEl.textContent = active?.parent
                    ? `📁 ${active.parent.path || 'root'}`
                    : '📁 No folder';
            } else {
                const count = this.app.vault.getMarkdownFiles()
                    .filter(f => this.folderPath === ''
                        ? true
                        : f.path.startsWith(this.folderPath + '/'))
                    .length;
                this.scopeHintEl.textContent = `📁 ${this.folderPath || 'Vault root'} · ${count} notes`;
            }
        } else {
            const count = this.app.vault.getMarkdownFiles().length;
            this.scopeHintEl.textContent = `🗄 Entire vault · ${count} notes`;
        }
    }

    setScope(scope, folderPath) {
        this.scope      = scope;
        this.folderPath = folderPath;

        // Update segment active state
        if (this.scopeBarEl) {
            this.scopeBarEl.querySelectorAll('.va-seg-btn').forEach(b => b.removeClass('va-seg-active'));
            const btns = this.scopeBarEl.querySelectorAll('.va-seg-btn');
            if (scope === 'note')   btns[0]?.addClass('va-seg-active');
            if (scope === 'folder') btns[1]?.addClass('va-seg-active');
            if (scope === 'vault')  btns[2]?.addClass('va-seg-active');
        }

        // Update folder button label
        if (this.folderScopeBtn) {
            this.folderScopeBtn.textContent = scope === 'folder' && folderPath !== null
                ? this.truncateFolderLabel(folderPath)
                : 'Folder ▾';
        }

        this.updateScopeHint();
    }

    truncateFolderLabel(path) {
        if (path === '' || path === '/') return '/ root ▾';
        const name = path.split('/').pop() || path;
        return (name.length > 10 ? name.slice(0, 9) + '…' : name) + ' ▾';
    }

    buildInputArea(parent) {
        const area = parent.createDiv('va-input-area');
        const box  = area.createDiv('va-input-box');

        this.textarea = box.createEl('textarea', {
            cls: 'va-textarea',
            attr: { placeholder: 'Ask anything about your notes…', rows: '1' },
        });

        this.textarea.addEventListener('input', () => {
            this.textarea.style.height = 'auto';
            const MAX = 140;
            const h = Math.min(this.textarea.scrollHeight, MAX);
            this.textarea.style.height = h + 'px';
            this.textarea.style.overflowY = this.textarea.scrollHeight > MAX ? 'auto' : 'hidden';
        });

        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        const sendBtn = box.createEl('button', {
            cls: 'va-send-btn',
            attr: { 'aria-label': 'Send' },
        });
        // Inline SVG — avoids Obsidian icon currentColor / fill inheritance issues on iOS
        sendBtn.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
        sendBtn.addEventListener('click', () => this.sendMessage());
    }

    // ── Send & Receive ────────────────────────────────────────────────────────

    async sendMessage() {
        const text = this.textarea.value.trim();
        if (!text) return;

        if (!this.plugin.settings.apiKey) {
            new Notice('Add your Anthropic API key in plugin settings.');
            return;
        }

        this.textarea.value = '';
        this.textarea.style.height = 'auto';
        this.textarea.style.overflowY = 'hidden';

        // Add to both display history and full API history
        const userMsg = { role: 'user', content: text };
        this.messages.push(userMsg);
        this.apiHistory.push({ role: 'user', content: text });
        this.renderMessage(userMsg, false);

        const loadingEl = this.messagesEl.createDiv('va-loading');
        ['●', '●', '●'].forEach(dot => loadingEl.createSpan({ text: dot }));
        loadingEl.createSpan({ cls: 'va-loading-label' }); // updated during tool calls
        this.scrollToBottom();

        try {
            const { context, activePath } = await this.buildContext();
            const systemPrompt = this.buildSystemPrompt(context, activePath);
            const reply        = await this.callClaude(systemPrompt, loadingEl);

            loadingEl.remove();
            const assistantMsg = { role: 'assistant', content: reply };
            this.messages.push(assistantMsg);
            // apiHistory already updated inside callClaude
            this.renderMessage(assistantMsg, true);
        } catch (err) {
            loadingEl.remove();
            new Notice('Claude error: ' + (err.message || 'Unknown error'));
        }

        this.scrollToBottom();
    }

    // ── Context Builder ───────────────────────────────────────────────────────

    async buildContext() {
        const { vault, workspace } = this.app;
        const active    = workspace.getActiveFile();
        const activePath = active?.path ?? null;

        const scopeLabel = this.scope === 'folder' && this.folderPath
            ? (this.folderPath.split('/').pop() || 'root')
            : this.scope.charAt(0).toUpperCase() + this.scope.slice(1);

        let context = `[VAULT SCOPE — ${scopeLabel}]\n`;
        if (activePath) context += `[ACTIVE NOTE — ${activePath}]\n`;

        if (this.scope === 'note') {
            // Pre-load the active note directly — no tools needed for single-note work
            context += '\n';
            if (active) {
                const content = await vault.read(active);
                context += `File: ${active.path}\n---\n${content}\n---\n`;
            } else {
                context += '(No active note open)\n';
            }
        } else {
            // Folder / Vault — send the file index only.
            // Claude uses read_note / list_folder / search_notes tools to fetch content on demand.
            const files = this.getScopedFiles(vault.getMarkdownFiles());
            const sorted = [...files].sort((a, b) => {
                const da = a.path.split('/').length, db = b.path.split('/').length;
                if (da !== db) return da - db;
                return a.path.localeCompare(b.path);
            });
            context += `[FILES IN SCOPE — ${sorted.length} note${sorted.length === 1 ? '' : 's'}]\n`;
            sorted.forEach(f => { context += `  • ${f.path}\n`; });
            context += '\nUse the read_note tool to fetch a file\'s content, list_folder to explore subfolders, and search_notes to find relevant files by keyword.\n';
        }

        return { context, activePath };
    }

    // ── Scope Helpers ─────────────────────────────────────────────────────────

    getScopedFiles(allFiles) {
        if (this.scope === 'vault') return allFiles;
        if (this.scope === 'folder') {
            const rawFp = this.folderPath ?? this.app.workspace.getActiveFile()?.parent?.path ?? '';
            const fp = rawFp.replace(/\/+$/, '');
            if (!fp) return allFiles;
            return allFiles.filter(f => f.path.startsWith(fp + '/'));
        }
        if (this.scope === 'note') {
            const active = this.app.workspace.getActiveFile();
            return active ? [active] : [];
        }
        return [];
    }

    isInScope(filePath) {
        if (this.scope === 'vault') return true;
        if (this.scope === 'folder') {
            const rawFp = this.folderPath ?? this.app.workspace.getActiveFile()?.parent?.path ?? '';
            const fp = rawFp.replace(/\/+$/, '');
            if (!fp) return true;
            return filePath.startsWith(fp + '/');
        }
        if (this.scope === 'note') {
            return filePath === (this.app.workspace.getActiveFile()?.path ?? '');
        }
        return false;
    }

    // ── System Prompt ─────────────────────────────────────────────────────────

    buildSystemPrompt(context, activePath) {
        return `You are Vault Assistant, an AI embedded in the user's Obsidian vault. Help them read, edit, organise, and understand their notes through natural conversation — like a pair programmer but for notes.

TOOLS AVAILABLE:
You have three vault tools: read_note, list_folder, search_notes.
- Before answering any question about a note's content, call read_note to fetch it.
- Before editing a note, call read_note first so you have the current content.
- Use search_notes when the user asks about a topic and you need to find the right file.
- Use list_folder to explore an unfamiliar folder structure.
- You may call tools multiple times and chain them freely within a single response.

CAPABILITIES:
- Summarise, analyse, rewrite, translate, extend, or restructure any note
- Adjust tone: shorter, longer, more formal, more casual
- Extract action items, key decisions, or themes across multiple notes
- Compare notes, spot patterns, suggest connections
- Create new notes or organise existing ones
- Answer questions grounded in the actual vault content

WRITING CHANGES TO THE VAULT — use this exact format:

<claude-edit>
{"action":"edit","path":"folder/note.md","content":"full new content"}
</claude-edit>

Supported actions:
- edit   → overwrite an existing note (requires "path" and "content")
- create → create a new note        (requires "path" and "content")
- rename → rename / move a note     (requires "path" and "newPath")
- delete → delete a note            (requires "path") — user must confirm

CRITICAL RULES:
- Active note: ${activePath ? `"${activePath}"` : 'none'}. Use this exact path when the user refers to "this note" or "the current note".
- Always read a note before editing it so your rewrite is based on the real content.
- When the user asks to edit, rewrite, improve, translate, or restructure a note → MUST use <claude-edit>. Do not show the result as chat text only.
- When creating a new note → MUST use <claude-edit> with action "create".
- For answers, summaries, analysis shown in chat only → plain text, no <claude-edit>.
- One <claude-edit> block per response, placed at the very end.
- Use the full vault path exactly as listed in the index below.

VAULT CONTEXT:
${context}`;
    }

    // ── API Call — tool loop ──────────────────────────────────────────────────

    async callClaude(systemPrompt, loadingEl) {
        const MAX_ROUNDS = 12; // safety cap on tool iterations
        let rounds = 0;

        while (rounds < MAX_ROUNDS) {
            const res = await requestUrl({
                url: 'https://api.anthropic.com/v1/messages',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.plugin.settings.apiKey,
                    'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                    model:      this.plugin.settings.model,
                    max_tokens: this.plugin.settings.maxTokens,
                    system:     systemPrompt,
                    messages:   this.apiHistory,
                    tools:      VAULT_TOOLS,
                }),
                throw: false,
            });

            if (res.status < 200 || res.status >= 300) {
                let errMsg;
                try { errMsg = res.json?.error?.message; } catch {}
                if (!errMsg) {
                    if (res.status === 401) errMsg = 'Invalid API key. Check settings.';
                    else if (res.status === 429) errMsg = 'Rate limit — wait a moment and retry.';
                    else if (res.status === 529) errMsg = 'Anthropic is overloaded. Try again shortly.';
                    else errMsg = `HTTP ${res.status}`;
                }
                throw new Error(errMsg);
            }

            const data       = res.json;
            const stopReason = data.stop_reason;
            const content    = data.content || [];

            if (stopReason === 'end_turn' || stopReason === 'stop_sequence') {
                // Final text response — store in apiHistory and return text to caller
                this.apiHistory.push({ role: 'assistant', content });
                const textBlock = content.find(b => b.type === 'text');
                return textBlock?.text ?? '';
            }

            if (stopReason === 'tool_use') {
                // Claude wants to call one or more tools
                this.apiHistory.push({ role: 'assistant', content });

                const toolResults = [];
                const toolUseBlocks = content.filter(b => b.type === 'tool_use');

                for (const tu of toolUseBlocks) {
                    this.updateLoadingLabel(loadingEl, tu.name, tu.input);
                    const result = await this.executeTool(tu.name, tu.input);
                    toolResults.push({
                        type:        'tool_result',
                        tool_use_id: tu.id,
                        content:     result,
                    });
                }

                this.apiHistory.push({ role: 'user', content: toolResults });
                // Reset label to dots for the next API round
                this.updateLoadingLabel(loadingEl, null, null);
                rounds++;
                continue;
            }

            // Unexpected stop_reason — return whatever text we got
            const textBlock = content.find(b => b.type === 'text');
            return textBlock?.text ?? '';
        }

        throw new Error('Too many tool rounds — something may have gone wrong.');
    }

    // ── Tool Execution ────────────────────────────────────────────────────────

    async executeTool(toolName, toolInput) {
        const { vault } = this.app;

        // ── read_note ──────────────────────────────────────────────────────────
        if (toolName === 'read_note') {
            const { path } = toolInput;

            if (!this.isInScope(path)) {
                return `Error: "${path}" is outside the current scope. Ask the user to change scope or provide a path within scope.`;
            }

            let file = vault.getAbstractFileByPath(path);
            if (!file || !(file instanceof TFile)) {
                // Case-insensitive fallback
                const match = vault.getMarkdownFiles().find(
                    f => f.path.toLowerCase() === path.toLowerCase()
                );
                if (match) file = match;
                else return `Error: Note not found: "${path}". Check the file list in the context.`;
            }

            const content = await vault.read(file);
            return `File: ${file.path}\n---\n${content}`;
        }

        // ── list_folder ────────────────────────────────────────────────────────
        if (toolName === 'list_folder') {
            const fp = (toolInput.folder_path || '').replace(/\/+$/, '');
            const scopedFiles = this.getScopedFiles(vault.getMarkdownFiles());
            const folderFiles = fp === ''
                ? scopedFiles
                : scopedFiles.filter(f => f.path.startsWith(fp + '/'));

            if (folderFiles.length === 0) {
                return `"${fp || 'vault root'}" is empty or outside the current scope.`;
            }

            const subfolders  = new Set();
            const directNotes = [];

            folderFiles.forEach(f => {
                const rel   = fp === '' ? f.path : f.path.slice(fp.length + 1);
                const parts = rel.split('/');
                if (parts.length === 1) directNotes.push(f);
                else subfolders.add(parts[0]);
            });

            const lines = [];
            if (subfolders.size > 0) {
                lines.push('Subfolders:');
                [...subfolders].sort().forEach(sub => {
                    const subPath = fp ? `${fp}/${sub}` : sub;
                    const cnt = folderFiles.filter(f => f.path.startsWith(subPath + '/')).length;
                    lines.push(`  📁 ${subPath}/  (${cnt} notes)`);
                });
            }
            if (directNotes.length > 0) {
                lines.push('Notes:');
                directNotes.sort((a, b) => a.name.localeCompare(b.name))
                    .forEach(f => lines.push(`  📄 ${f.path}`));
            }
            return lines.join('\n');
        }

        // ── search_notes ───────────────────────────────────────────────────────
        if (toolName === 'search_notes') {
            const { query, folder_path } = toolInput;
            const fp = folder_path ? folder_path.replace(/\/+$/, '') : null;

            let files = this.getScopedFiles(vault.getMarkdownFiles());
            if (fp) files = files.filter(f => f.path.startsWith(fp + '/'));

            const qLow    = query.toLowerCase();
            const results = [];

            for (const file of files) {
                const titleHit = file.path.toLowerCase().includes(qLow);
                let excerpt    = null;
                try {
                    const body = await vault.read(file);
                    const idx  = body.toLowerCase().indexOf(qLow);
                    if (idx !== -1) {
                        const s = Math.max(0, idx - 60);
                        const e = Math.min(body.length, idx + query.length + 60);
                        excerpt = body.slice(s, e).replace(/\n+/g, ' ').trim();
                    }
                } catch {}

                if (titleHit || excerpt) results.push({ path: file.path, titleHit, excerpt });
            }

            if (results.length === 0) return `No notes found matching "${query}".`;

            return results.slice(0, 20).map(r => {
                const lines = [`📄 ${r.path}`];
                if (r.titleHit) lines.push('   (title match)');
                if (r.excerpt)  lines.push(`   "…${r.excerpt}…"`);
                return lines.join('\n');
            }).join('\n\n') + (results.length > 20 ? `\n\n…and ${results.length - 20} more.` : '');
        }

        return `Error: Unknown tool "${toolName}".`;
    }

    // ── Loading Label ─────────────────────────────────────────────────────────

    updateLoadingLabel(loadingEl, toolName, toolInput) {
        if (!loadingEl) return;
        const labelEl = loadingEl.querySelector('.va-loading-label');
        if (!labelEl) return;

        if (!toolName) { labelEl.textContent = ''; return; }

        if (toolName === 'read_note') {
            const name = (toolInput?.path || '').split('/').pop();
            labelEl.textContent = ` Reading ${name}…`;
        } else if (toolName === 'list_folder') {
            labelEl.textContent = ` Listing ${toolInput?.folder_path || 'vault'}…`;
        } else if (toolName === 'search_notes') {
            labelEl.textContent = ` Searching "${toolInput?.query}"…`;
        }
    }

    // ── Edit Block Parsing ────────────────────────────────────────────────────

    parseEditBlock(content) {
        const match = content.match(/<claude-edit>([\s\S]*?)<\/claude-edit>/);
        if (!match) return null;
        try {
            const edit = JSON.parse(match[1].trim());
            // Claude sometimes double-escapes newlines (\n → literal \\n).
            // JSON.parse then gives us a two-char sequence instead of a real newline.
            // Normalise here so the file always gets proper line breaks.
            if (edit.content && typeof edit.content === 'string') {
                edit.content = edit.content
                    .replace(/\\r\\n/g, '\n')
                    .replace(/\\n/g, '\n')
                    .replace(/\\r/g, '\n');
            }
            return edit;
        } catch { return null; }
    }

    stripEditBlock(content) {
        return content.replace(/<claude-edit>[\s\S]*?<\/claude-edit>/g, '').trim();
    }

    // ── Render Message ────────────────────────────────────────────────────────

    renderMessage(msg, withActions) {
        this.hideEmptyState();
        const isUser      = msg.role === 'user';
        // Group consecutive same-sender messages closer together
        const allWrappers = this.messagesEl.querySelectorAll('.va-msg-wrapper');
        const lastWrapper = allWrappers[allWrappers.length - 1];
        const lastRole    = lastWrapper?.classList.contains(isUser ? 'va-user-wrapper' : 'va-assistant-wrapper');
        const wrapper     = this.messagesEl.createDiv(
            'va-msg-wrapper ' + (isUser ? 'va-user-wrapper' : 'va-assistant-wrapper') +
            (lastRole ? ' va-grouped' : '')
        );
        const editBlock   = !isUser ? this.parseEditBlock(msg.content) : null;
        const displayText = !isUser ? this.stripEditBlock(msg.content) : msg.content;

        const bubble = wrapper.createDiv('va-bubble ' + (isUser ? 'va-user-bubble' : 'va-assistant-bubble'));

        if (isUser) {
            bubble.createDiv({ cls: 'va-bubble-text', text: displayText });
        } else {
            const mdEl = bubble.createDiv('va-bubble-text va-markdown');
            MarkdownRenderer.render(this.app, displayText, mdEl, '', this);
        }

        if (!isUser && withActions) {
            const actionsEl = wrapper.createDiv('va-actions');

            // Copy button
            const copyBtn = actionsEl.createEl('button', { text: 'Copy', cls: 'va-pill-btn' });
            copyBtn.addEventListener('click', () => {
                const done = () => {
                    copyBtn.textContent = '✓ Copied';
                    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
                };
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(displayText).then(done).catch(() => { this.fallbackCopy(displayText); done(); });
                } else {
                    this.fallbackCopy(displayText); done();
                }
            });

            if (editBlock) {
                const targetName = editBlock.path
                    ? editBlock.path.split('/').pop()
                    : this.app.workspace.getActiveFile()?.name ?? 'note';
                const applyLabel = editBlock.action === 'create'
                    ? `Create ${targetName}`
                    : editBlock.action === 'delete'
                    ? `Delete ${targetName}`
                    : `Apply → ${targetName}`;

                const applyBtn   = actionsEl.createEl('button', { text: applyLabel, cls: 'va-pill-btn va-pill-primary' });
                const discardBtn = actionsEl.createEl('button', { text: 'Discard',  cls: 'va-pill-btn' });

                applyBtn.addEventListener('click', async () => {
                    applyBtn.disabled = true;
                    discardBtn.disabled = true;
                    await this.applyEdit(editBlock, actionsEl);
                });
                discardBtn.addEventListener('click', () => {
                    actionsEl.empty();
                    actionsEl.createEl('span', { text: 'Discarded', cls: 'va-status-label' });
                });
            } else {
                const saveBtn = actionsEl.createEl('button', { text: 'New note', cls: 'va-pill-btn' });
                const addBtn  = actionsEl.createEl('button', { text: 'Append',   cls: 'va-pill-btn' });

                saveBtn.addEventListener('click', () => this.saveAsNote(displayText));
                addBtn.addEventListener('click',  () => this.addToNote(displayText));
            }
        }
    }

    // ── File Operations ───────────────────────────────────────────────────────

    async applyEdit(edit, actionsEl) {
        const { vault } = this.app;

        if (edit.action === 'delete') {
            new ConfirmModal(this.app, `Delete "${edit.path}"? This cannot be undone.`, async () => {
                const file = vault.getAbstractFileByPath(edit.path);
                if (file) { await vault.delete(file); new Notice('Deleted: ' + edit.path); }
                else new Notice('File not found: ' + edit.path);
                actionsEl.empty();
                actionsEl.createEl('span', { text: '✓ Deleted', cls: 'va-status-label' });
            }).open();
            return;
        }

        try {
            if (edit.action === 'edit') {
                let file = vault.getAbstractFileByPath(edit.path);
                if (!file) {
                    // fallback to the active open note
                    file = this.app.workspace.getActiveFile();
                    if (!file) throw new Error('File not found and no active note open.');
                }
                await vault.modify(file, edit.content);
                new Notice('Updated: ' + file.name);

            } else if (edit.action === 'create') {
                const parts = edit.path.split('/'); parts.pop();
                if (parts.length > 0) {
                    const fp = parts.join('/');
                    if (!vault.getAbstractFileByPath(fp)) await vault.createFolder(fp);
                }
                await vault.create(edit.path, edit.content || '');
                new Notice('Created: ' + edit.path);

            } else if (edit.action === 'rename' || edit.action === 'move') {
                const file = vault.getAbstractFileByPath(edit.path);
                if (!file) throw new Error('File not found: ' + edit.path);
                await vault.rename(file, edit.newPath);
                new Notice('Moved to: ' + edit.newPath);
            }

            actionsEl.empty();
            actionsEl.createEl('span', { text: '✓ Applied', cls: 'va-status-label va-status-success' });
        } catch (err) {
            new Notice('Apply failed: ' + err.message);
            actionsEl.empty();
            actionsEl.createEl('span', { text: '✗ ' + err.message, cls: 'va-status-label va-status-error' });
        }
    }

    async saveAsNote(content) {
        const ts       = new Date().toISOString().slice(0, 16).replace('T', '_').replaceAll(':', '-');
        const folder   = this.plugin.settings.savedNotesFolder;
        const filename = `Claude Note ${ts}.md`;
        const path     = folder ? `${folder}/${filename}` : filename;
        try {
            if (folder && !this.app.vault.getAbstractFileByPath(folder))
                await this.app.vault.createFolder(folder);
            await this.app.vault.create(path, content);
            new Notice('Saved: ' + path);
        } catch (err) {
            new Notice('Save failed: ' + err.message);
        }
    }

    async addToNote(content) {
        const active = this.app.workspace.getActiveFile();
        if (!active) { new Notice('No active note open.'); return; }
        const existing = await this.app.vault.read(active);
        await this.app.vault.modify(active, existing + '\n\n' + content);
        new Notice('Added to: ' + active.name);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fallbackCopy(text) {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(el);
        el.focus(); el.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(el);
    }

    scrollToBottom() {
        setTimeout(() => { this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }, 50);
    }

    clearMessages() {
        this.messages   = [];
        this.apiHistory = [];
        if (this.messagesEl) {
            this.messagesEl.empty();
            this.buildEmptyState();
            this.showEmptyState();
        }
        new Notice('Conversation cleared.');
    }
}

// ─── Folder Scope Modal ───────────────────────────────────────────────────────

class FolderScopeModal extends Modal {
    constructor(app, view) {
        super(app);
        this.view = view;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('p', { text: 'Select folder scope', cls: 'va-modal-title' });

        // Search input
        const searchInput = contentEl.createEl('input', {
            cls: 'va-folder-search',
            attr: { type: 'text', placeholder: 'Search folders…' },
        });

        const listEl   = contentEl.createDiv('va-folder-list');
        const allFiles = this.app.vault.getMarkdownFiles();

        // Build flat sorted list of all folders in the vault
        const folders = [];
        const walk = (folder, depth) => {
            folders.push({ folder, depth });
            folder.children
                .filter(c => c instanceof TFolder)
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach(child => walk(child, depth + 1));
        };

        const root = this.app.vault.getRoot();
        folders.push({ folder: root, depth: 0 }); // vault root entry
        root.children
            .filter(c => c instanceof TFolder)
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach(child => walk(child, 1));

        const renderList = (filter = '') => {
            listEl.empty();

            const filtered = filter
                ? folders.filter(({ folder }) =>
                    (folder.path || 'root').toLowerCase().includes(filter.toLowerCase()))
                : folders;

            if (filtered.length === 0) {
                listEl.createDiv({ cls: 'va-folder-empty', text: 'No folders match.' });
                return;
            }

            filtered.forEach(({ folder, depth }) => {
                const isRoot   = folder.path === '' || folder.path === '/';
                const path     = isRoot ? '' : folder.path;
                const name     = isRoot ? 'Vault root' : folder.name;
                const count    = isRoot
                    ? allFiles.length
                    : allFiles.filter(f => f.path.startsWith(path + '/')).length;
                const isActive = this.view.folderPath === path;

                const item = listEl.createDiv('va-folder-item' + (isActive ? ' va-folder-item-active' : ''));

                const left = item.createDiv('va-folder-item-left');

                // Indentation (only when not filtering)
                if (!filter && depth > 0) {
                    left.createSpan({ text: '  '.repeat(depth - 1) + '↳ ', cls: 'va-folder-indent' });
                }

                left.createSpan({ text: isRoot ? '🗄 ' : '📁 ', cls: 'va-folder-icon' });
                left.createSpan({
                    text: filter ? (path || 'Vault root') : name,
                    cls: 'va-folder-name',
                });

                item.createSpan({ text: String(count), cls: 'va-folder-count' });

                item.addEventListener('click', () => {
                    this.view.setScope('folder', path);
                    this.close();
                });
            });
        };

        renderList();

        searchInput.addEventListener('input', () => renderList(searchInput.value.trim()));

        // Auto-focus search on open
        setTimeout(() => searchInput.focus(), 80);
    }

    onClose() { this.contentEl.empty(); }
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

class ConfirmModal extends Modal {
    constructor(app, message, onConfirm, confirmLabel = 'Delete') {
        super(app);
        this.message      = message;
        this.onConfirm    = onConfirm;
        this.confirmLabel = confirmLabel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('p', { text: this.message, cls: 'va-modal-msg' });
        const btns = contentEl.createDiv('va-modal-btns');
        btns.createEl('button', { text: 'Cancel', cls: 'va-pill-btn' })
            .addEventListener('click', () => this.close());
        btns.createEl('button', { text: this.confirmLabel, cls: 'va-pill-btn va-pill-danger' })
            .addEventListener('click', () => { this.onConfirm(); this.close(); });
    }

    onClose() { this.contentEl.empty(); }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class VaultAssistantSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Vault Assistant' });

        new Setting(containerEl)
            .setName('Anthropic API Key')
            .setDesc('Get yours at console.anthropic.com. Stored locally only.')
            .addText(text => {
                text.setPlaceholder('sk-ant-...')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (v) => {
                        this.plugin.settings.apiKey = v.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
            });

        const FALLBACK_MODELS = [
            { id: 'claude-opus-4-5',           label: 'Claude Opus 4.5 (Most powerful)' },
            { id: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6 (Recommended)' },
            { id: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 (Faster)' },
        ];

        const modelSetting = new Setting(containerEl)
            .setName('Model')
            .setDesc('Loading models…');

        let dropdownComponent = null;
        modelSetting.addDropdown(drop => {
            dropdownComponent = drop;
            // Seed with fallback list immediately so UI isn't empty
            FALLBACK_MODELS.forEach(m => drop.addOption(m.id, m.label));
            // Ensure the saved model is selectable even if not in fallback list
            if (!FALLBACK_MODELS.find(m => m.id === this.plugin.settings.model)) {
                drop.addOption(this.plugin.settings.model, this.plugin.settings.model);
            }
            drop.setValue(this.plugin.settings.model)
                .onChange(async (v) => {
                    this.plugin.settings.model = v;
                    await this.plugin.saveSettings();
                });
        });

        // Async fetch — runs after the UI is rendered
        (async () => {
            const apiKey = this.plugin.settings.apiKey;
            if (!apiKey) {
                modelSetting.setDesc('Enter your API key above to load available models.');
                return;
            }
            try {
                const res = await requestUrl({
                    url: 'https://api.anthropic.com/v1/models?limit=100',
                    method: 'GET',
                    headers: {
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                    },
                });
                const data = res.json;
                if (!data || !Array.isArray(data.data)) throw new Error('Unexpected response');

                // Filter to Claude models only
                const claudeModels = data.data.filter(m => m.id && m.id.startsWith('claude-'));

                if (claudeModels.length === 0) throw new Error('No Claude models returned');

                // Sort: opus first, sonnet second, haiku third, others last; within tier sort by name desc (newest first)
                const tierOf = id => {
                    const l = id.toLowerCase();
                    if (l.includes('opus'))   return 0;
                    if (l.includes('sonnet')) return 1;
                    if (l.includes('haiku'))  return 2;
                    return 3;
                };
                claudeModels.sort((a, b) => {
                    const td = tierOf(a.id) - tierOf(b.id);
                    if (td !== 0) return td;
                    return b.id.localeCompare(a.id); // newest ID first within tier
                });

                // Rebuild dropdown
                const selectEl = dropdownComponent.selectEl;
                // Clear existing options
                while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);

                claudeModels.forEach(m => {
                    const displayName = m.display_name || m.id;
                    dropdownComponent.addOption(m.id, displayName);
                });

                // Restore saved selection; fall back to first option
                const savedModel = this.plugin.settings.model;
                if (claudeModels.find(m => m.id === savedModel)) {
                    dropdownComponent.setValue(savedModel);
                } else {
                    dropdownComponent.setValue(claudeModels[0].id);
                    this.plugin.settings.model = claudeModels[0].id;
                    await this.plugin.saveSettings();
                }

                modelSetting.setDesc(`${claudeModels.length} models loaded from Anthropic — refreshes each time you open settings.`);
            } catch (e) {
                // Fallback already in place — just update description
                modelSetting.setDesc('Could not fetch live models — showing defaults. Check your API key.');
            }
        })();

        new Setting(containerEl)
            .setName('Max Tokens')
            .setDesc('Maximum length of Claude\'s response (256–8192).')
            .addSlider(slider => slider
                .setLimits(256, 8192, 256)
                .setValue(this.plugin.settings.maxTokens)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.maxTokens = v;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Saved Notes Folder')
            .setDesc('Folder where "New note" creates files. Leave empty for vault root.')
            .addText(text => text
                .setPlaceholder('e.g. AI Notes')
                .setValue(this.plugin.settings.savedNotesFolder)
                .onChange(async (v) => {
                    this.plugin.settings.savedNotesFolder = v.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Clear Conversation')
            .setDesc('Wipe the current chat history.')
            .addButton(btn => btn
                .setButtonText('Clear')
                .setWarning()
                .onClick(() => {
                    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
                    leaves.forEach(leaf => leaf.view?.clearMessages?.());
                }));
    }
}

module.exports = VaultAssistantPlugin;
