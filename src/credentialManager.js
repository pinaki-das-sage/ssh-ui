// src/credentialManager.js
// Handles secure storage and retrieval of SSH passwords
// Uses VS Code's built-in SecretStorage API (replaces deprecated keytar)

const vscode = require('vscode');

const KEY_PREFIX = 'ssh-ui:';

class CredentialManager {
    /**
     * @param {vscode.SecretStorage} secretStorage
     */
    constructor(secretStorage) {
        this._secrets = secretStorage;
    }

    async savePassword(item) {
        try {
            if (!item || item.contextValue !== 'host') return;
            // Extract host name from label "name (user@host:port)"
            const label = typeof item.label === 'string' ? item.label : String(item.label);
            const hostName = label.replace(/\s*\(.*\)$/, '');
            const password = await vscode.window.showInputBox({
                prompt: `Enter password for ${hostName}`,
                password: true
            });
            if (password) {
                await this._secrets.store(KEY_PREFIX + hostName, password);
                vscode.window.showInformationMessage('Password saved securely.');
            }
        } catch (err) {
            vscode.window.showErrorMessage('Failed to save password: ' + err.message);
        }
    }

    async deletePassword(item) {
        try {
            if (!item || item.contextValue !== 'host') return;
            // Extract host name from label "name (user@host:port)"
            const label = typeof item.label === 'string' ? item.label : String(item.label);
            const hostName = label.replace(/\s*\(.*\)$/, '');
            await this._secrets.delete(KEY_PREFIX + hostName);
            vscode.window.showInformationMessage('Password deleted.');
        } catch (err) {
            vscode.window.showErrorMessage('Failed to delete password: ' + err.message);
        }
    }

    async getPassword(host) {
        try {
            return await this._secrets.get(KEY_PREFIX + host.name) || null;
        } catch (err) {
            vscode.window.showErrorMessage('Failed to retrieve password: ' + err.message);
            return null;
        }
    }

    /**
     * Store a password by host name (used by addHost flow).
     */
    async storePassword(hostName, password) {
        try {
            await this._secrets.store(KEY_PREFIX + hostName, password);
        } catch (err) {
            vscode.window.showErrorMessage('Failed to store password: ' + err.message);
        }
    }

    /**
     * Delete a stored password by host name (used by removeHost/removeGroup).
     */
    async deletePasswordByName(hostName) {
        try {
            await this._secrets.delete(KEY_PREFIX + hostName);
        } catch (err) {
            // Silently ignore – password may not exist
        }
    }
}

module.exports = CredentialManager;
