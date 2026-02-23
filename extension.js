// extension.js
// Main entry point for the SSH UI VS Code extension

const vscode = require('vscode');
const path = require('path');
const SSHHostsProvider = require('./src/sshHostsProvider');
const ConfigManager = require('./src/configManager');
const CredentialManager = require('./src/credentialManager');

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
    const safeAsync = (fn) => (...args) => {
        const result = fn(...args);
        if (result && typeof result.catch === 'function') {
            result.catch(err => {
                // Ignore "Canceled" errors (e.g., when the window is closed)
                if (err && err.message === 'Canceled') return;
                vscode.window.showErrorMessage('Command error: ' + err.message).then(undefined, () => {});
            });
        }
        return result;
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
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
