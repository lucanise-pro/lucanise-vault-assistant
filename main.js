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
} = require('obsidian');

const VIEW_TYPE = 'vault-assistant-view';

const DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'claude-sonnet-4-6',
    maxTokens: 2048,
    savedNotesFolder: '',
};

// ─── Main Plugin ────────────────────────────────────────────────────────────

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

// ─── Chat View ───────────────────────────────────────────────────────────────

class VaultAssistantView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.messages = []; // { role: 'user' | 'assistant', content: string }
        this.scope = 'note';       // 'note' | 'folder' | 'vault'
        this.folderPath = null;    // string path when scope === 'folder'
    }

    getViewType()    { return VIEW_TYPE; }
    getDisplayText() { return 'Vault Assistant'; }
    getIcon()        { return 'message-circle'; }

    async onOpen()  { this.buildUI(); }
    async onClose() {}

    // ── UI Construction ──────────────────────────────────────────────────────

    buildUI() {
        const root = this.containerEl.children[1];
        root.empty();
        root.addClass('va-root');

        this.buildTopBar(root);
        this.messagesEl = root.createDiv('va-messages');
        this.buildInputArea(root);

        // Restore previous messages (no action buttons on old messages)
        this.messages.forEach(msg => this.renderMessage(msg, false));
        this.scrollToBottom();
    }

    buildTopBar(parent) {
        const bar = parent.createDiv('va-top-bar');
        this.scopeBarEl = bar;
        this.buildScopeSelector(bar);
        const clearBtn = bar.createEl('button', { text: '✕', cls: 'va-clear-btn', attr: { title: 'Clear conversation' } });
        clearBtn.addEventListener('click', () => this.clearMessages());
    }

    buildScopeSelector(bar) {
        // Note
        bar.createEl('button', {
            text: 'Note',
            cls: 'va-scope-btn' + (this.scope === 'note' ? ' va-scope-active' : ''),
        }).addEventListener('click', () => this.setScope('note', null));

        // Folder ▾ — opens picker
        this.folderScopeBtn = bar.createEl('button', {
            text: this.scope === 'folder' && this.folderPath !== null
                ? this.truncateFolderLabel(this.folderPath)
                : 'Folder ▾',
            cls: 'va-scope-btn va-scope-btn-folder' + (this.scope === 'folder' ? ' va-scope-active' : ''),
        });
        this.folderScopeBtn.addEventListener('click', () => {
            const active = this.app.workspace.getActiveFile();
            if (!active?.parent) { new Notice('Open a note first.'); return; }
            new FolderScopeModal(this.app, this).open();
        });

        // Vault
        bar.createEl('button', {
            text: 'Vault',
            cls: 'va-scope-btn' + (this.scope === 'vault' ? ' va-scope-active' : ''),
        }).addEventListener('click', () => this.setScope('vault', null));
    }

    setScope(scope, folderPath) {
        this.scope      = scope;
        this.folderPath = folderPath;

        if (!this.scopeBarEl) return;
        const btns = this.scopeBarEl.querySelectorAll('.va-scope-btn');
        btns.forEach(b => b.removeClass('va-scope-active'));
        if (scope === 'note')    btns[0]?.addClass('va-scope-active');
        if (scope === 'folder')  btns[1]?.addClass('va-scope-active');
        if (scope === 'vault')   btns[2]?.addClass('va-scope-active');

        if (this.folderScopeBtn) {
            this.folderScopeBtn.textContent = scope === 'folder' && folderPath !== null
                ? this.truncateFolderLabel(folderPath)
                : 'Folder ▾';
        }
    }

    truncateFolderLabel(path) {
        if (path === '' || path === '/') return '/ root ▾';
        const name = path.split('/').pop() || path;
        return (name.length > 10 ? name.slice(0, 9) + '…' : name) + ' ▾';
    }

    buildInputArea(parent) {
        const area = parent.createDiv('va-input-area');

        this.textarea = area.createEl('textarea', {
            cls: 'va-textarea',
            attr: { placeholder: 'Ask anything about your notes…', rows: '1' },
        });

        this.textarea.addEventListener('input', () => {
            this.textarea.style.height = 'auto';
            this.textarea.style.height = Math.min(this.textarea.scrollHeight, 120) + 'px';
        });

        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        const sendBtn = area.createEl('button', { text: 'Send', cls: 'va-send-btn' });
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

        // Reset textarea
        this.textarea.value = '';
        this.textarea.style.height = 'auto';

        // User message
        const userMsg = { role: 'user', content: text };
        this.messages.push(userMsg);
        this.renderMessage(userMsg, false);

        // Loading indicator
        const loadingEl = this.messagesEl.createDiv('va-loading');
        ['●', '●', '●'].forEach(dot => loadingEl.createSpan({ text: dot }));
        this.scrollToBottom();

        try {
            const context      = await this.buildContext();
            const systemPrompt = this.buildSystemPrompt(context);
            const reply        = await this.callClaude(systemPrompt);

            loadingEl.remove();

            const assistantMsg = { role: 'assistant', content: reply };
            this.messages.push(assistantMsg);
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
        const active = workspace.getActiveFile();
        let files = [];

        if (this.scope === 'note') {
            if (active) files = [active];
        } else if (this.scope === 'folder') {
            const fp = this.folderPath ?? active?.parent?.path ?? null;
            if (fp === '' || fp === '/') {
                files = vault.getMarkdownFiles();
            } else if (fp !== null) {
                files = vault.getMarkdownFiles().filter(f => f.path.startsWith(fp + '/'));
            }
        } else if (this.scope === 'vault') {
            files = vault.getMarkdownFiles();
        }

        const CHAR_LIMIT = 50000;
        const scopeLabel = this.scope === 'folder' && this.folderPath
            ? this.folderPath.split('/').pop() || 'root'
            : this.scope.charAt(0).toUpperCase() + this.scope.slice(1);
        let context = `[VAULT SCOPE - ${scopeLabel}]\n`;
        let total = 0;
        let truncated = false;

        for (const file of files) {
            const content = await vault.read(file);
            const entry = `File: ${file.path}\n---\n${content}\n---\n\n`;
            if (total + entry.length > CHAR_LIMIT) { truncated = true; break; }
            context += entry;
            total += entry.length;
        }

        if (truncated) context += '[Context truncated to fit token limit]\n';
        if (files.length === 0) context += '(No files in scope or no active note)\n';

        return context;
    }

    // ── System Prompt ─────────────────────────────────────────────────────────

    buildSystemPrompt(context) {
        return `You are Vault Assistant, an AI built into the user's Obsidian vault. Help them read, edit, organize, and understand their notes through natural conversation.

CAPABILITIES:
- Read, edit, summarize, rewrite, translate any note in scope
- Continue writing from where the user left off
- Adjust tone: shorter, longer, more formal, more casual
- Extract action items as a checklist
- Generate new notes on any topic
- Suggest tags and frontmatter improvements
- Answer questions without necessarily editing files
- Perform file operations using the structured format below

FILE OPERATIONS — use this exact format when you want to modify the vault:

<claude-edit>
{"action":"edit","path":"folder/note.md","content":"full new content"}
</claude-edit>

Supported actions:
- edit   → modify existing note (requires "path" and "content")
- create → create new note (requires "path" and "content")
- rename → rename/move note (requires "path" and "newPath")
- move   → move note to folder (requires "path" and "newPath")
- delete → delete note (requires "path") — user will be asked to confirm

Rules:
- Only use <claude-edit> when making a real file change.
- For summaries, answers, or discussion: reply in plain text only.
- One <claude-edit> block per response.
- Always use the full vault path (e.g. "Daily/2024-01-15.md").

CURRENT VAULT CONTEXT:
${context}`;
    }

    // ── API Call ──────────────────────────────────────────────────────────────

    async callClaude(systemPrompt) {
        // Build messages for API (exclude system prompt from messages array)
        const apiMessages = this.messages.map(m => ({ role: m.role, content: m.content }));

        const res = await requestUrl({
            url: 'https://api.anthropic.com/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': this.plugin.settings.apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: this.plugin.settings.model,
                max_tokens: this.plugin.settings.maxTokens,
                system: systemPrompt,
                messages: apiMessages,
            }),
            throw: false,
        });

        if (res.status < 200 || res.status >= 300) {
            let errMsg;
            try { errMsg = res.json?.error?.message; } catch {}
            if (!errMsg) {
                if (res.status === 401) errMsg = 'Invalid API key. Check your key in plugin settings.';
                else if (res.status === 429) errMsg = 'Rate limit reached. Wait a moment and try again.';
                else if (res.status === 529) errMsg = 'Anthropic is overloaded. Try again in a few seconds.';
                else errMsg = `HTTP ${res.status}`;
            }
            throw new Error(errMsg);
        }

        const data = res.json;
        return data.content?.[0]?.text || '';
    }

    // ── Edit Block Parsing ────────────────────────────────────────────────────

    parseEditBlock(content) {
        const match = content.match(/<claude-edit>([\s\S]*?)<\/claude-edit>/);
        if (!match) return null;
        try { return JSON.parse(match[1].trim()); } catch { return null; }
    }

    stripEditBlock(content) {
        return content.replace(/<claude-edit>[\s\S]*?<\/claude-edit>/g, '').trim();
    }

    // ── Render Message ────────────────────────────────────────────────────────

    renderMessage(msg, withActions) {
        const isUser = msg.role === 'user';
        const wrapper = this.messagesEl.createDiv('va-msg-wrapper ' + (isUser ? 'va-user-wrapper' : 'va-assistant-wrapper'));

        const editBlock     = !isUser ? this.parseEditBlock(msg.content) : null;
        const displayText   = editBlock ? this.stripEditBlock(msg.content) : msg.content;

        const bubble = wrapper.createDiv('va-bubble ' + (isUser ? 'va-user-bubble' : 'va-assistant-bubble'));

        if (isUser) {
            bubble.createDiv({ cls: 'va-bubble-text', text: displayText });
        } else {
            const mdEl = bubble.createDiv('va-bubble-text va-markdown');
            MarkdownRenderer.render(this.app, displayText, mdEl, '', this);
        }

        if (!isUser && withActions) {
            const actionsEl = wrapper.createDiv('va-actions');

            // Copy button always available on assistant messages
            const copyBtn = actionsEl.createEl('button', { text: 'Copy', cls: 'va-btn va-btn-copy' });
            copyBtn.addEventListener('click', () => {
                const confirm = () => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
                };
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(displayText).then(confirm).catch(() => {
                        this.fallbackCopy(displayText);
                        confirm();
                    });
                } else {
                    this.fallbackCopy(displayText);
                    confirm();
                }
            });

            if (editBlock) {
                // Show Apply / Discard for file edits
                const applyBtn   = actionsEl.createEl('button', { text: 'Apply',   cls: 'va-btn va-btn-primary' });
                const discardBtn = actionsEl.createEl('button', { text: 'Discard', cls: 'va-btn' });

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
                // Show Save / Add for plain responses
                const saveBtn    = actionsEl.createEl('button', { text: 'Save as note',  cls: 'va-btn' });
                const addBtn     = actionsEl.createEl('button', { text: 'Add to note',   cls: 'va-btn' });
                const replaceBtn = actionsEl.createEl('button', { text: 'Replace note',  cls: 'va-btn va-btn-warning' });

                saveBtn.addEventListener('click',    () => this.saveAsNote(displayText));
                addBtn.addEventListener('click',     () => this.addToNote(displayText));
                replaceBtn.addEventListener('click', () => this.replaceNote(displayText));
            }
        }
    }

    // ── File Operations ───────────────────────────────────────────────────────

    async applyEdit(edit, actionsEl) {
        const { vault } = this.app;

        if (edit.action === 'delete') {
            new ConfirmModal(this.app, `Delete "${edit.path}"? This cannot be undone.`, async () => {
                const file = vault.getAbstractFileByPath(edit.path);
                if (file) {
                    await vault.delete(file);
                    new Notice('Deleted: ' + edit.path);
                } else {
                    new Notice('File not found: ' + edit.path);
                }
                actionsEl.empty();
                actionsEl.createEl('span', { text: '✓ Deleted', cls: 'va-status-label' });
            }).open();
            return;
        }

        try {
            if (edit.action === 'edit') {
                const file = vault.getAbstractFileByPath(edit.path);
                if (!file) throw new Error('File not found: ' + edit.path);
                await vault.modify(file, edit.content);
                new Notice('Updated: ' + edit.path);

            } else if (edit.action === 'create') {
                // Create intermediate folders if needed
                const parts = edit.path.split('/');
                parts.pop();
                if (parts.length > 0) {
                    const folderPath = parts.join('/');
                    if (!vault.getAbstractFileByPath(folderPath)) {
                        await vault.createFolder(folderPath);
                    }
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
            actionsEl.createEl('span', { text: '✗ Failed: ' + err.message, cls: 'va-status-label va-status-error' });
        }
    }

    async saveAsNote(content) {
        const ts = new Date().toISOString().slice(0, 16).replace('T', '_').replaceAll(':', '-');
        const folder = this.plugin.settings.savedNotesFolder;
        const filename = `Claude Note ${ts}.md`;
        const path = folder ? `${folder}/${filename}` : filename;
        try {
            if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
                await this.app.vault.createFolder(folder);
            }
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
        await this.app.vault.modify(active, existing + '\n\n---\n\n' + content);
        new Notice('Added to: ' + active.name);
    }

    async replaceNote(content) {
        const active = this.app.workspace.getActiveFile();
        if (!active) { new Notice('No active note open.'); return; }
        new ConfirmModal(this.app, `Replace the full content of "${active.name}"?`, async () => {
            await this.app.vault.modify(active, content);
            new Notice('Replaced: ' + active.name);
        }, 'Replace').open();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fallbackCopy(text) {
        const el = document.createElement('textarea');
        el.value = text;
        el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(el);
        el.focus();
        el.select();
        try { document.execCommand('copy'); } catch {}
        document.body.removeChild(el);
    }

    scrollToBottom() {
        setTimeout(() => { this.messagesEl.scrollTop = this.messagesEl.scrollHeight; }, 50);
    }

    clearMessages() {
        this.messages = [];
        if (this.messagesEl) this.messagesEl.empty();
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
        contentEl.createEl('p', { text: 'Select which folder Claude can see', cls: 'va-modal-msg va-folder-modal-title' });

        const active = this.app.workspace.getActiveFile();
        if (!active?.parent) {
            contentEl.createEl('p', { text: 'Open a note first.', cls: 'va-modal-msg' });
            return;
        }

        // Walk up the folder tree from the file's parent to root
        const levels = [];
        let folder = active.parent;
        while (folder) {
            levels.push(folder);
            folder = folder.parent;
        }

        const allFiles = this.app.vault.getMarkdownFiles();
        const list = contentEl.createDiv('va-folder-list');

        levels.forEach((f, i) => {
            const isRoot   = f.path === '' || f.path === '/';
            const path     = isRoot ? '' : f.path;
            const name     = isRoot ? 'Vault root' : f.name || f.path;
            const depth    = levels.length - 1 - i; // 0 = deepest (file's direct parent)
            const count    = isRoot
                ? allFiles.length
                : allFiles.filter(file => file.path.startsWith(path + '/')).length;
            const isActive = this.view.folderPath === path;

            const item = list.createDiv('va-folder-item' + (isActive ? ' va-folder-item-active' : ''));

            // Indentation dots to show depth visually
            if (depth > 0) item.createSpan({ text: '  '.repeat(depth) + '↳ ', cls: 'va-folder-indent' });

            item.createSpan({ text: '📁 ' + name, cls: 'va-folder-name' });
            item.createSpan({ text: ` ${count} note${count !== 1 ? 's' : ''}`, cls: 'va-folder-count' });

            item.addEventListener('click', () => {
                this.view.setScope('folder', path);
                this.close();
            });
        });
    }

    onClose() { this.contentEl.empty(); }
}

// ─── Confirm Modal ────────────────────────────────────────────────────────────

class ConfirmModal extends Modal {
    constructor(app, message, onConfirm, confirmLabel = 'Delete') {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
        this.confirmLabel = confirmLabel;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('p', { text: this.message, cls: 'va-modal-msg' });

        const btns = contentEl.createDiv('va-modal-btns');

        const cancelBtn  = btns.createEl('button', { text: 'Cancel',          cls: 'va-btn' });
        const confirmBtn = btns.createEl('button', { text: this.confirmLabel, cls: 'va-btn va-btn-danger' });

        cancelBtn.addEventListener('click',  () => this.close());
        confirmBtn.addEventListener('click', () => { this.onConfirm(); this.close(); });
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

        // API Key
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

        // Model
        new Setting(containerEl)
            .setName('Model')
            .addDropdown(drop => drop
                .addOption('claude-sonnet-4-6',        'Claude Sonnet 4.6 (Recommended)')
                .addOption('claude-haiku-4-5-20251001', 'Claude Haiku 4.5 (Faster)')
                .setValue(this.plugin.settings.model)
                .onChange(async (v) => {
                    this.plugin.settings.model = v;
                    await this.plugin.saveSettings();
                }));

        // Max tokens
        new Setting(containerEl)
            .setName('Max Tokens')
            .setDesc('Maximum length of Claude\'s response (256 – 8192).')
            .addSlider(slider => slider
                .setLimits(256, 8192, 256)
                .setValue(this.plugin.settings.maxTokens)
                .setDynamicTooltip()
                .onChange(async (v) => {
                    this.plugin.settings.maxTokens = v;
                    await this.plugin.saveSettings();
                }));

        // Saved notes folder
        new Setting(containerEl)
            .setName('Saved Notes Folder')
            .setDesc('Folder where "Save as note" creates files. Leave empty for vault root.')
            .addText(text => text
                .setPlaceholder('e.g. AI Notes')
                .setValue(this.plugin.settings.savedNotesFolder)
                .onChange(async (v) => {
                    this.plugin.settings.savedNotesFolder = v.trim();
                    await this.plugin.saveSettings();
                }));

        // Clear conversation
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
