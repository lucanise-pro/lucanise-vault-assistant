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
    setIcon,
} = require('obsidian');

const VIEW_TYPE = 'vault-assistant-view';

const DEFAULT_SETTINGS = {
    apiKey: '',
    model: 'claude-sonnet-4-6',
    maxTokens: 2048,
    savedNotesFolder: '',
};

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
        this.plugin    = plugin;
        this.messages  = [];
        this.scope     = 'note';
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
        this.buildInputArea(root);

        this.messages.forEach(msg => this.renderMessage(msg, false));
        this.scrollToBottom();
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
            this.textarea.style.height = Math.min(this.textarea.scrollHeight, 160) + 'px';
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
        setIcon(sendBtn, 'arrow-up');
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

        const userMsg = { role: 'user', content: text };
        this.messages.push(userMsg);
        this.renderMessage(userMsg, false);

        const loadingEl = this.messagesEl.createDiv('va-loading');
        ['●', '●', '●'].forEach(dot => loadingEl.createSpan({ text: dot }));
        this.scrollToBottom();

        try {
            const { context, activePath } = await this.buildContext();
            const systemPrompt = this.buildSystemPrompt(context, activePath);
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
        const activePath = active?.path ?? null;
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
            ? (this.folderPath.split('/').pop() || 'root')
            : this.scope.charAt(0).toUpperCase() + this.scope.slice(1);

        let context = `[VAULT SCOPE — ${scopeLabel}]\n`;
        if (activePath) context += `[ACTIVE NOTE — ${activePath}]\n`;
        context += '\n';
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

        return { context, activePath };
    }

    // ── System Prompt ─────────────────────────────────────────────────────────

    buildSystemPrompt(context, activePath) {
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

CRITICAL RULES:
- The currently active note is: ${activePath ? `"${activePath}"` : 'none'}. Always use this exact path when editing it.
- When the user asks to rework, rewrite, update, edit, improve, continue, translate, or change a note in ANY way → you MUST use <claude-edit>. Never show the result as plain text only.
- When the user asks to create a new note → ALWAYS use <claude-edit> with action "create".
- Only reply in plain text (without <claude-edit>) for: answers to questions, summaries shown in chat, analysis, discussion where no file is being changed.
- Place the <claude-edit> block at the very end of your response, after any explanation.
- One <claude-edit> block per response maximum.
- Always use the full vault path exactly as shown in the context below.

CURRENT VAULT CONTEXT:
${context}`;
    }

    // ── API Call ──────────────────────────────────────────────────────────────

    async callClaude(systemPrompt) {
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

        return res.json?.content?.[0]?.text || '';
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
        const isUser      = msg.role === 'user';
        const wrapper     = this.messagesEl.createDiv('va-msg-wrapper ' + (isUser ? 'va-user-wrapper' : 'va-assistant-wrapper'));
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

        new Setting(containerEl)
            .setName('Model')
            .addDropdown(drop => drop
                .addOption('claude-sonnet-4-6',         'Claude Sonnet 4.6 (Recommended)')
                .addOption('claude-haiku-4-5-20251001',  'Claude Haiku 4.5 (Faster)')
                .setValue(this.plugin.settings.model)
                .onChange(async (v) => {
                    this.plugin.settings.model = v;
                    await this.plugin.saveSettings();
                }));

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
            .setDesc('Folder where "Save as note" creates files. Leave empty for vault root.')
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
