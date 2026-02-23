// extension.js
// Main entry point for the SSH UI VS Code extension

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const SSHHostsProvider = require('./src/sshHostsProvider');
const ConfigManager = require('./src/configManager');
const CredentialManager = require('./src/credentialManager');

const CONFIG_FILE = path.join(os.homedir(), '.vscode-ssh-ui-config.json');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    // Initialize credential manager with VS Code's built-in SecretStorage
    const credentialManager = new CredentialManager(context.secrets);

    // Share credential manager with config manager
    ConfigManager.setCredentialManager(credentialManager);

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
        vscode.commands.registerCommand('ssh-ui.connect', safeAsync((item) => sshHostsProvider.connectToHost(item)))
    );

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

module.exports = {
    activate,
    deactivate
};
