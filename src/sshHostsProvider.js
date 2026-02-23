// src/sshHostsProvider.js
// Provides the SSH Hosts tree view (flat list of hosts)

const vscode = require('vscode');
const ConfigManager = require('./configManager');

class SSHHostsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element) {
        return element;
    }

    async getChildren(element) {
        if (!element) {
            return ConfigManager.getHosts();
        }
        return [];
    }

    async connectToHost(item) {
        if (item && item.contextValue === 'host') {
            await ConfigManager.connectToHost(item);
        }
    }
}

module.exports = SSHHostsProvider;
