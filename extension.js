// extension.js
// Main entry point for the SSH UI VS Code extension

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const SSHHostsProvider = require('./src/sshHostsProvider');
const ConfigManager = require('./src/configManager');
const CredentialManager = require('./src/credentialManager');
const SftpManager = require('./src/sftpManager');
const { shouldIgnore, shouldUploadOnSave } = require('./src/sftpSync');
const PhpUnitRunner = require('./src/phpunitRunner');
const { PhpUnitCodeLensProvider } = require('./src/phpunitCodeLensProvider');
const { pickHost, resolvePhpunitHost } = require('./src/phpunitRunner');
const { formatSftpTargetLabel } = require('./src/sftpTarget');

// Assigned during activate(); allows commands registered before status bar exists
// to call _updateStatusBar() safely.
let _updateStatusBar = () => {};
let _updateSftpStatusBar = () => {};

const CONFIG_FILE = path.join(os.homedir(), '.vscode-ssh-ui-config.json');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Initialize credential manager with VS Code's built-in SecretStorage
    const credentialManager = new CredentialManager(context.secrets);
    const sftpManager = new SftpManager(credentialManager, async (host, fingerprint, isChanged) => {
        const action = isChanged ? 'Replace Trusted Key' : 'Trust and Connect';
        const message = isChanged
            ? `The SFTP host key for "${host.name}" changed. Only replace it if you verified this key with the server owner.\n\n${fingerprint}`
            : `Trust this SFTP server key for "${host.name}"?\n\n${fingerprint}`;
        const choice = await vscode.window.showWarningMessage(message, { modal: true }, action);
        return choice === action;
    });

    // Share credential manager with config manager
    ConfigManager.setCredentialManager(credentialManager);

    // Reused across all SFTP directory listings; disposed with the extension
    const sftpOutputChannel = vscode.window.createOutputChannel('Remote Toolkit — SFTP');
    context.subscriptions.push(sftpOutputChannel);

    const logSftp = (message) => {
        sftpOutputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
    };

    const formatBytes = (bytes) => {
        if (!Number.isFinite(bytes)) return 'unknown size';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    /** Uploads one file with a progress indicator and an output-channel log entry. */
    const uploadWithProgress = async (host, localPath, remotePath, relativeFile, progressLocation) => {
        let size = NaN;
        try {
            size = fs.statSync(localPath).size;
        } catch (_) { /* size is best-effort only */ }

        logSftp(`Uploading ${relativeFile} → ${host.name}:${remotePath} (${formatBytes(size)})`);
        const startedAt = Date.now();
        try {
            await vscode.window.withProgress(
                { location: progressLocation, title: `SFTP: uploading ${relativeFile} → ${host.name}` },
                () => sftpManager.upload(host, localPath, remotePath)
            );
        } catch (err) {
            logSftp(`FAILED ${relativeFile}: ${err.message}`);
            throw err;
        }
        logSftp(`Uploaded ${relativeFile} in ${Date.now() - startedAt}ms`);
    };

    // Tree Data Provider for SSH Hosts
    const sshHostsProvider = new SSHHostsProvider();
    vscode.window.registerTreeDataProvider('sshHostsView', sshHostsProvider);

    // Register commands (wrap async handlers to catch unhandled rejections)
    const isCanceled = (err) => {
        if (!err) return false;
        if (err.name === 'Canceled' || err.message === 'Canceled') return true;
        if (err.code === 'ERR_USE_AFTER_CLOSE') return true;
        if (typeof err.message === 'string' && (
            err.message.includes('disposed') ||
            err.message.includes('cancel')
        )) return true;
        return false;
    };

    const safeAsync = (fn) => (...args) => {
        try {
            const result = fn(...args);
            if (result && typeof result.catch === 'function') {
                result.catch(err => {
                    if (isCanceled(err)) return;
                    try {
                        vscode.window.showErrorMessage('Command error: ' + err.message).then(undefined, () => {});
                    } catch (_) { /* extension host shutting down */ }
                });
            }
            return result;
        } catch (err) {
            if (!isCanceled(err)) {
                try {
                    vscode.window.showErrorMessage('Command error: ' + err.message).then(undefined, () => {});
                } catch (_) { /* extension host shutting down */ }
            }
        }
    };

    context.subscriptions.push(
        vscode.commands.registerCommand('ssh-ui.editConfig', safeAsync(() => ConfigManager.editConfig())),
        vscode.commands.registerCommand('ssh-ui.addHost', safeAsync(async () => {
            await ConfigManager.addHost();
            sshHostsProvider.refresh();
        })),
        vscode.commands.registerCommand('ssh-ui.removeHost', safeAsync(async (item) => {
            await ConfigManager.removeHost(item);
            sshHostsProvider.refresh();
        })),
        vscode.commands.registerCommand('ssh-ui.savePassword', safeAsync((item) => credentialManager.savePassword(item))),
        vscode.commands.registerCommand('ssh-ui.deletePassword', safeAsync((item) => credentialManager.deletePassword(item))),
        vscode.commands.registerCommand('ssh-ui.connect', safeAsync((item) => sshHostsProvider.connectToHost(item))),
        vscode.commands.registerCommand('ssh-ui.editPhpunitConfig', safeAsync(async (item) => {
            await ConfigManager.editPhpunitConfig(item);
            sshHostsProvider.refresh();
            _updateStatusBar();
        })),
        vscode.commands.registerCommand('ssh-ui.setPhpunitDefaultHost', safeAsync(async () => {
            await vscode.commands.executeCommand('ssh-ui.selectSftpTarget');
        })),
        vscode.commands.registerCommand('ssh-ui.sftpUploadActiveFile', safeAsync(async () => {
            const host = await _resolveSftpHost();
            const editor = vscode.window.activeTextEditor;
            if (!host || !editor) return;
            const relativeFile = _toRelativeFile(editor.document.uri);
            if (!relativeFile) return;
            const remoteRoot = host.sftp.remotePath || '/';
            const remotePath = path.posix.join(remoteRoot, relativeFile);
            await uploadWithProgress(
                host, editor.document.uri.fsPath, remotePath, relativeFile,
                vscode.ProgressLocation.Notification
            );
            vscode.window.showInformationMessage(`Uploaded ${relativeFile} to ${host.name}.`);
        })),
        vscode.commands.registerCommand('ssh-ui.sftpDownloadFile', safeAsync(async () => {
            const host = await _resolveSftpHost();
            if (!host) return;
            const remotePath = await vscode.window.showInputBox({
                title: 'Remote Toolkit: Download SFTP File',
                prompt: 'Remote file path',
                value: host.sftp.remotePath || '/',
                validateInput: value => (!value || !value.trim()) ? 'Remote path is required' : null
            });
            if (!remotePath) return;
            const saveUri = await vscode.window.showSaveDialog({
                saveLabel: 'Download',
                defaultUri: vscode.Uri.file(path.basename(remotePath))
            });
            if (!saveUri) return;
            await sftpManager.download(host, remotePath.trim(), saveUri.fsPath);
            vscode.window.showInformationMessage(`Downloaded ${path.basename(remotePath)} from ${host.name}.`);
        })),
        vscode.commands.registerCommand('ssh-ui.sftpListDirectory', safeAsync(async () => {
            const host = await _resolveSftpHost();
            if (!host) return;
            const remotePath = await vscode.window.showInputBox({
                title: 'Remote Toolkit: List SFTP Directory',
                prompt: 'Remote directory path',
                value: host.sftp.remotePath || '/',
                validateInput: value => (!value || !value.trim()) ? 'Remote path is required' : null
            });
            if (!remotePath) return;
            const entries = await sftpManager.list(host, remotePath.trim());
            sftpOutputChannel.clear();
            sftpOutputChannel.appendLine(`${host.name}: ${remotePath.trim()}`);
            for (const entry of entries) {
                sftpOutputChannel.appendLine(`${entry.type === 'd' ? '[DIR] ' : '      '}${entry.name}`);
            }
            sftpOutputChannel.show(true);
        })),
        vscode.commands.registerCommand('ssh-ui.selectSftpTarget', safeAsync(async () => {
            const hosts = ConfigManager.getSftpEnabledHosts();
            if (hosts.length === 0) {
                vscode.window.showWarningMessage('No SFTP-configured hosts found. Add an "sftp" section to a host in the config file.');
                return;
            }
            const current = ConfigManager.getSftpTarget();
            const items = hosts.map(h => ({
                label: h.name,
                description: `${h.user}@${h.host}:${h.port}`,
                detail: h.name === current ? '$(check) Current target' : undefined,
                host: h
            }));
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select SFTP sync target'
            });
            if (!picked) return;
            ConfigManager.setSftpTarget(picked.host.name);
            _updateSftpStatusBar();
            _updateStatusBar();
            vscode.window.showInformationMessage(`SFTP target set to "${picked.host.name}".`);
        })),
        vscode.commands.registerCommand('ssh-ui.sftpSyncFolder', safeAsync(async () => {
            const host = await _resolveSftpHost();
            if (!host) return;
            const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
            if (!workspaceFolder) {
                vscode.window.showWarningMessage('Open a workspace folder before running an SFTP sync.');
                return;
            }
            const syncMode = (host.sftp.syncMode || 'update');
            if (syncMode === 'mirror') {
                const confirm = await vscode.window.showWarningMessage(
                    `Mirror sync will DELETE remote files under "${host.sftp.remotePath}" that don't exist locally on "${host.name}". Continue?`,
                    { modal: true }, 'Sync (Mirror)'
                );
                if (confirm !== 'Sync (Mirror)') return;
            }
            sftpOutputChannel.clear();
            sftpOutputChannel.show(true);
            logSftp(`Sync started: ${workspaceFolder.uri.fsPath} → ${host.name}:${host.sftp.remotePath} (${syncMode})`);
            const result = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `SFTP sync → ${host.name}`,
                    cancellable: false
                },
                (progress) => sftpManager.syncFolder(host, workspaceFolder.uri.fsPath, line => {
                    logSftp(line);
                    progress.report({ message: line });
                })
            );
            logSftp(
                `Sync complete. Uploaded ${result.uploaded.length}, deleted ${result.deleted.length}, skipped ${result.skipped} unchanged.`
            );
            vscode.window.showInformationMessage(`SFTP sync to "${host.name}" complete.`);
        })),

        // PHPUnit runner commands
        vscode.commands.registerCommand('ssh-ui.runPhpunit', safeAsync(async (item) => {
            const host = await _resolvePhpunitHost(item);
            if (!host) return;
            const password = await credentialManager.getPassword(host);
            await PhpUnitRunner.runAll(host, password);
        })),
        vscode.commands.registerCommand('ssh-ui.runPhpunitFile', safeAsync(async (fileUri) => {
            const host = await _resolvePhpunitHost(null);
            if (!host) return;
            const relativeFile = _toRelativeFile(fileUri);
            if (!relativeFile) return;
            const password = await credentialManager.getPassword(host);
            await PhpUnitRunner.runFile(host, password, relativeFile);
        })),
        vscode.commands.registerCommand('ssh-ui.runPhpunitFolder', safeAsync(async (folderUri) => {
            const host = await _resolvePhpunitHost(null);
            if (!host) return;
            const relativeFolder = _toRelativeFile(folderUri);
            if (!relativeFolder) return;
            const password = await credentialManager.getPassword(host);
            await PhpUnitRunner.runFolder(host, password, relativeFolder);
        })),
        vscode.commands.registerCommand('ssh-ui.runPhpunitMethod', safeAsync(async (fileUri, className, methodName) => {
            const host = await _resolvePhpunitHost(null);
            if (!host) return;
            const relativeFile = _toRelativeFile(fileUri);
            if (!relativeFile) return;
            const password = await credentialManager.getPassword(host);
            await PhpUnitRunner.runMethod(host, password, relativeFile, className, methodName);
        }))
    );

    // CodeLens provider for PHP test files
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { language: 'php' },
            new PhpUnitCodeLensProvider(() => ConfigManager.getPhpunitEnabledHosts())
        )
    );

    // Status bar item — shows the SFTP-selected PHPUnit target when a PHP file is active.
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
    statusBarItem.command = 'ssh-ui.selectSftpTarget';
    statusBarItem.tooltip = 'Selected SFTP target is used for PHPUnit — click to change';
    context.subscriptions.push(statusBarItem);

    // Status bar item — shows the current SFTP sync target, always visible when configured
    const sftpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    sftpStatusBarItem.command = 'ssh-ui.selectSftpTarget';
    sftpStatusBarItem.tooltip = 'SFTP sync target — click to change';
    context.subscriptions.push(sftpStatusBarItem);

    _updateSftpStatusBar = () => {
        const hosts = ConfigManager.getSftpEnabledHosts();
        if (hosts.length === 0) {
            sftpStatusBarItem.hide();
            return;
        }
        const target = ConfigManager.getSftpTarget();
        sftpStatusBarItem.text = formatSftpTargetLabel(target);
        sftpStatusBarItem.show();
    };
    _updateSftpStatusBar();

    // Auto-upload on save: track manual-vs-autosave reason per document, then
    // upload after the write completes if the current SFTP target opts in.
    const _pendingSaveReasons = new Map();
    context.subscriptions.push(
        vscode.workspace.onWillSaveTextDocument(event => {
            _pendingSaveReasons.set(event.document.uri.toString(), event.reason);
        }),
        vscode.workspace.onDidSaveTextDocument(safeAsync(async (document) => {
            const key = document.uri.toString();
            const reason = _pendingSaveReasons.get(key);
            _pendingSaveReasons.delete(key);

            const targetName = ConfigManager.getSftpTarget();
            if (!targetName) return;
            const hosts = ConfigManager.getSftpEnabledHosts();
            const host = hosts.find(h => h.name === targetName);
            if (!host) return;

            const relativeFile = _toRelativeFile(document.uri);
            if (!relativeFile) return;
            if (shouldIgnore(relativeFile, host.sftp.ignore)) return;

            const isManualSave = reason === vscode.TextDocumentSaveReason.Manual || reason === undefined;
            if (!shouldUploadOnSave(isManualSave, host.sftp.uploadOnAutoSave)) return;

            const remotePath = path.posix.join(host.sftp.remotePath || '/', relativeFile);
            await uploadWithProgress(
                host, document.uri.fsPath, remotePath, relativeFile,
                vscode.ProgressLocation.Window
            );
        }))
    );

    _updateStatusBar = () => {
        const enabled = ConfigManager.getPhpunitEnabledHosts();
        if (enabled.length === 0) {
            statusBarItem.hide();
            return;
        }
        const sftpTarget = ConfigManager.getSftpTarget();
        const selectedHost = enabled.find(host => host.name === sftpTarget);
        const legacyDefault = ConfigManager.getPhpunitDefault();
        statusBarItem.text = selectedHost
            ? `$(beaker) ${selectedHost.name}`
            : legacyDefault
                ? `$(beaker) ${legacyDefault} (fallback)`
                : '$(beaker) Select SFTP target';
        statusBarItem.show();
    };

    // Show/hide status bar based on active editor language
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor && editor.document.languageId === 'php') {
                _updateStatusBar();
            } else {
                statusBarItem.hide();
            }
        })
    );
    // Also refresh when config file changes
    const origRefresh = sshHostsProvider.refresh.bind(sshHostsProvider);
    sshHostsProvider.refresh = () => { origRefresh(); _updateStatusBar(); _updateSftpStatusBar(); };

    // Watch config file for external changes and auto-refresh the tree
    try {
        const configUri = vscode.Uri.file(CONFIG_FILE);
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(configUri.fsPath.substring(0, configUri.fsPath.lastIndexOf('/')), path.basename(CONFIG_FILE))
        );
        watcher.onDidChange(() => sshHostsProvider.refresh());
        watcher.onDidCreate(() => sshHostsProvider.refresh());
        watcher.onDidDelete(() => sshHostsProvider.refresh());
        context.subscriptions.push(watcher);
    } catch (_) {
        // Fallback: poll-based watcher if createFileSystemWatcher fails for home dir
        let lastMtime = 0;
        const pollInterval = setInterval(() => {
            try {
                const stat = fs.statSync(CONFIG_FILE);
                if (stat.mtimeMs !== lastMtime) {
                    lastMtime = stat.mtimeMs;
                    sshHostsProvider.refresh();
                }
            } catch (_) { /* file may not exist yet */ }
        }, 2000);
        context.subscriptions.push({ dispose: () => clearInterval(pollInterval) });
    }
}

function deactivate() {}

/**
 * Resolve which phpunit-enabled host to run against. The SFTP target is the
 * primary default; phpunitDefault is retained solely for legacy configurations.
 */
async function _resolvePhpunitHost(item) {
    const enabledHosts = ConfigManager.getPhpunitEnabledHosts();
    if (enabledHosts.length === 0) {
        vscode.window.showWarningMessage('No PHPUnit-enabled hosts configured. Right-click a host and select "Edit PHPUnit Config".');
        return null;
    }

    const sftpTargetName = ConfigManager.getSftpTarget();
    const legacyDefaultHostName = ConfigManager.getPhpunitDefault();
    const treeItemName = item && item.label
        ? (typeof item.label === 'string' ? item.label : String(item.label)).replace(/\s*\(.*\)$/, '')
        : null;

    const resolved = resolvePhpunitHost(enabledHosts, sftpTargetName, legacyDefaultHostName, treeItemName);
    if (resolved) return resolved;

    // Multiple hosts, no default — prompt and offer to save selection
    const picked = await vscode.window.showQuickPick(
        enabledHosts.map(h => ({ label: h.name, description: `${h.user}@${h.host}:${h.port}`, host: h })),
        { placeHolder: 'Select SSH host to run PHPUnit on' }
    );
    if (!picked) return null;

    // Offer to save as default so they never see this prompt again
    if (enabledHosts.length > 1) {
        const save = await vscode.window.showInformationMessage(
            `Save "${picked.label}" as your default PHPUnit host?`,
            'Save Default', 'Not Now'
        );
        if (save === 'Save Default') {
            ConfigManager.setPhpunitDefault(picked.label);
            _updateStatusBar();
        }
    }

    return picked.host;
}

async function _resolveSftpHost() {
    const hosts = ConfigManager.getSftpEnabledHosts();
    if (hosts.length === 0) {
        vscode.window.showWarningMessage('No SFTP-configured hosts found. Add an "sftp" section to a host in the config file.');
        return null;
    }

    const targetName = ConfigManager.getSftpTarget();
    const resolved = pickHost(hosts, targetName, null);
    if (resolved) return resolved;

    const picked = await vscode.window.showQuickPick(
        hosts.map(host => ({ label: host.name, description: `${host.user}@${host.host}:${host.port}`, host })),
        { placeHolder: 'Select SFTP host' }
    );
    if (!picked) return null;

    if (hosts.length > 1) {
        const save = await vscode.window.showInformationMessage(
            `Save "${picked.label}" as your SFTP sync target?`,
            'Save Target', 'Not Now'
        );
        if (save === 'Save Target') {
            ConfigManager.setSftpTarget(picked.label);
            _updateSftpStatusBar();
        }
    }

    return picked.host;
}

/**
 * Convert an absolute file path or URI to a workspace-relative path.
 * Returns null if the file is not inside any workspace folder.
 */
function _toRelativeFile(fileUri) {
    let uri = typeof fileUri === 'string' ? vscode.Uri.file(fileUri) : fileUri;
    if (!uri) {
        // Fallback: use the active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) return null;
        uri = editor.document.uri;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('Remote Toolkit only works with files inside the current workspace.');
        return null;
    }

    const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        vscode.window.showWarningMessage('Remote Toolkit only works with files inside the current workspace.');
        return null;
    }

    return relativePath.split(path.sep).join('/');
}

module.exports = {
    activate,
    deactivate
};
