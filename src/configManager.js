// src/configManager.js
// Handles SSH config file operations and connection logic

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_FILE = path.join(os.homedir(), '.vscode-ssh-ui-config.json');
const DEFAULT_CONFIG = JSON.stringify({ hosts: [] }, null, 2);

let _credentialManager = null;

const ConfigManager = {
    /**
     * Set the credential manager instance (injected from extension.js)
     * @param {import('./credentialManager')} credentialManager
     */
    setCredentialManager(credentialManager) {
        _credentialManager = credentialManager;
    },

    editConfig: async function () {
        try {
            if (!fs.existsSync(CONFIG_FILE)) {
                fs.writeFileSync(CONFIG_FILE, DEFAULT_CONFIG, 'utf8');
            }
            const doc = await vscode.workspace.openTextDocument(CONFIG_FILE);
            vscode.window.showTextDocument(doc);
        } catch (err) {
            vscode.window.showErrorMessage('Unable to open SSH UI config: ' + err.message);
        }
    },

    /**
     * Return all hosts as TreeItems for the flat list view.
     */
    getHosts: function () {
        const config = this._readConfig();
        return (config.hosts || []).map(host => {
            const item = new vscode.TreeItem(
                `${host.name}`,
                vscode.TreeItemCollapsibleState.None
            );
            item.contextValue = 'host';
            item.iconPath = new vscode.ThemeIcon('terminal');
            item.command = {
                command: 'ssh-ui.connect',
                title: 'Connect',
                arguments: [item]
            };
            return item;
        });
    },

    /**
     * Find a host config entry by its display name.
     */
    _findHost: function (displayName) {
        const config = this._readConfig();
        // displayName may be "name (user@host:port)" — extract just the name part
        const hostName = typeof displayName === 'string'
            ? displayName.replace(/\s*\(.*\)$/, '')
            : String(displayName);
        return (config.hosts || []).find(h => h.name === hostName);
    },

    connectToHost: async function (item) {
        try {
            if (!item) return;
            const host = this._findHost(item.label);
            if (!host) return;
            // Retrieve stored password
            let password = _credentialManager ? await _credentialManager.getPassword(host) : null;

            const sshTarget = `${host.user}@${host.host}`;
            const identityArg = host.identityFile ? ` -i ${host.identityFile}` : '';

            if (password && !host.identityFile) {
                // Use SSH_ASKPASS to auto-enter password (cross-platform, works on Windows/macOS/Linux)
                // SSH_ASKPASS_REQUIRE=force tells OpenSSH 8.4+ to use askpass even with a TTY
                const tmpDir = os.tmpdir();
                const isWindows = process.platform === 'win32';
                let askpassPath;

                if (isWindows) {
                    // Write a .cmd script that echoes the password from env
                    askpassPath = path.join(tmpDir, '.ssh-ui-askpass.cmd');
                    fs.writeFileSync(askpassPath, '@echo off\r\necho %_SSH_UI_PASS%\r\n', { mode: 0o700 });
                } else {
                    // Write a .sh script that echoes the password from env
                    askpassPath = path.join(tmpDir, '.ssh-ui-askpass.sh');
                    fs.writeFileSync(askpassPath, '#!/bin/sh\necho "$_SSH_UI_PASS"\n', { mode: 0o700 });
                }

                const terminal = vscode.window.createTerminal({
                    name: `SSH: ${host.name}`,
                    env: {
                        _SSH_UI_PASS: password,
                        SSH_ASKPASS: askpassPath,
                        SSH_ASKPASS_REQUIRE: 'force',
                        DISPLAY: ':0'  // needed on some systems for SSH_ASKPASS
                    }
                });
                terminal.sendText(`ssh -t ${sshTarget} -p ${host.port}`);
                terminal.show();
            } else {
                // Key-based auth or no password — plain ssh
                const terminal = vscode.window.createTerminal({
                    name: `SSH: ${host.name}`
                });
                terminal.sendText(`ssh -t ${sshTarget} -p ${host.port}${identityArg}`);
                terminal.show();
            }
        } catch (err) {
            vscode.window.showErrorMessage('Failed to connect: ' + err.message);
        }
    },
//CurrentYardWouldUp
    // ── CRUD helpers ──────────────────────────────────────────────────

    _readConfig: function () {
        if (!fs.existsSync(CONFIG_FILE)) {
            fs.writeFileSync(CONFIG_FILE, DEFAULT_CONFIG, 'utf8');
        }
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    },

    _writeConfig: function (config) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    },

    /**
     * Multi-step popup to add a new SSH host.
     * Collects: display name, hostname, port, username, identity file, password.
     */
    addHost: async function () {
        try {
            // Step 1: Display name
            const name = await vscode.window.showInputBox({
                title: 'Add SSH Host (1/5)',
                prompt: 'Display name for this host',
                placeHolder: 'e.g. Web Server 1',
                validateInput: v => (!v || !v.trim()) ? 'Name is required' : null
            });
            if (!name) return;

            // Step 2: Hostname / IP
            const host = await vscode.window.showInputBox({
                title: 'Add SSH Host (2/5)',
                prompt: 'Hostname or IP address',
                placeHolder: 'e.g. 192.168.1.10 or server.example.com',
                validateInput: v => (!v || !v.trim()) ? 'Hostname is required' : null
            });
            if (!host) return;

            // Step 3: Port
            const portStr = await vscode.window.showInputBox({
                title: 'Add SSH Host (3/5)',
                prompt: 'SSH port',
                value: '22',
                validateInput: v => {
                    const n = parseInt(v, 10);
                    if (isNaN(n) || n < 1 || n > 65535) return 'Enter a valid port (1-65535)';
                    return null;
                }
            });
            if (!portStr) return;
            const port = parseInt(portStr, 10);

            // Step 4: Username
            const user = await vscode.window.showInputBox({
                title: 'Add SSH Host (4/5)',
                prompt: 'SSH username',
                placeHolder: 'e.g. root, ubuntu, admin',
                validateInput: v => (!v || !v.trim()) ? 'Username is required' : null
            });
            if (!user) return;

            // Step 5: Identity file (optional)
            const identityFile = await vscode.window.showInputBox({
                title: 'Add SSH Host (5/5)',
                prompt: 'Path to SSH identity file (optional, leave blank for password auth)',
                placeHolder: 'e.g. ~/.ssh/id_rsa'
            });

            // Build host entry
            const hostEntry = {
                name: name.trim(),
                host: host.trim(),
                port,
                user: user.trim()
            };
            if (identityFile && identityFile.trim()) {
                hostEntry.identityFile = identityFile.trim();
            }

            // Save to config
            const config = this._readConfig();
            config.hosts = config.hosts || [];
            config.hosts.push(hostEntry);
            this._writeConfig(config);

            // Prompt for password (optional)
            const savePass = await vscode.window.showInformationMessage(
                `Host "${name.trim()}" added. Save a password for this host?`,
                'Save Password', 'Skip'
            );
            if (savePass === 'Save Password' && _credentialManager) {
                const password = await vscode.window.showInputBox({
                    prompt: `Enter SSH password for ${name.trim()}`,
                    password: true
                });
                if (password) {
                    await _credentialManager.storePassword(name.trim(), password);
                    vscode.window.showInformationMessage('Password saved securely.');
                }
            }

            return hostEntry;
        } catch (err) {
            vscode.window.showErrorMessage('Failed to add host: ' + err.message);
        }
    },

    /**
     * Remove a host and delete its stored password.
     */
    removeHost: async function (hostItem) {
        try {
            if (!hostItem || hostItem.contextValue !== 'host') return;
            const label = hostItem.label;
            const hostName = typeof label === 'string' ? label.replace(/\s*\(.*\)$/, '') : String(label);

            const confirm = await vscode.window.showWarningMessage(
                `Delete host "${hostName}"?`, { modal: true }, 'Delete'
            );
            if (confirm !== 'Delete') return;

            const config = this._readConfig();
            config.hosts = (config.hosts || []).filter(h => h.name !== hostName);
            this._writeConfig(config);

            if (_credentialManager) {
                await _credentialManager.deletePasswordByName(hostName);
            }
            vscode.window.showInformationMessage(`Host "${hostName}" removed.`);
        } catch (err) {
            vscode.window.showErrorMessage('Failed to remove host: ' + err.message);
        }
    }
};

module.exports = ConfigManager;
