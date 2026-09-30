// src/configManager.js
// Handles SSH config file operations and connection logic

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const sshPty = require('./sshPty');
const { createAskpassEnvironment, buildInteractiveSshCommand } = require('./sshAuth');

const CONFIG_FILE = path.join(os.homedir(), '.vscode-ssh-ui-config.json');
const DEFAULT_CONFIG = JSON.stringify({ hosts: [] }, null, 2);

let _credentialManager = null;

function registerAskpassCleanup(terminal, askpass) {
    if (!askpass) return;
    const listener = vscode.window.onDidCloseTerminal(closedTerminal => {
        if (closedTerminal !== terminal) return;
        askpass.cleanup();
        listener.dispose();
    });
}

function openStandardSshTerminal(host, password) {
    const askpass = password ? createAskpassEnvironment(password) : null;
    const terminal = vscode.window.createTerminal({
        name: `SSH: ${host.name}`,
        ...(askpass ? { env: askpass.env } : {}),
    });
    registerAskpassCleanup(terminal, askpass);
    terminal.sendText(buildInteractiveSshCommand(host));
    terminal.show();
}

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
            item.contextValue = host.phpunit && host.phpunit.enabled ? 'phpunitHost' : 'host';
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
            // Retrieve stored password (used for password auth OR key passphrase)
            let password = _credentialManager ? await _credentialManager.getPassword(host) : null;

            if (sshPty.isReconnectEnabled(host.reconnect)) {
                this._connectWithReconnect(host, password);
                return;
            }
            openStandardSshTerminal(host, password);
        } catch (err) {
            vscode.window.showErrorMessage('Failed to connect: ' + err.message);
        }
    },

    /**
     * Opt-in connect path: uses node-pty so the terminal can detect
     * disconnects and offer to reconnect on keypress (PuTTY-style).
     * Falls back to the standard terminal if node-pty is unavailable.
     */
    _connectWithReconnect: function (host, password) {
        if (!sshPty.isAvailable()) {
            const err = sshPty.lastLoadError();
            vscode.window.showWarningMessage(
                `Auto-reconnect is unavailable on this platform (${err ? err.message : 'node-pty failed to load'}). ` +
                `Connecting with the standard terminal instead.`
            );
            openStandardSshTerminal(host, password);
            return;
        }

        if (process.platform === 'win32' && !sshPty.hasWindowsOpenSsh()) {
            vscode.window.showWarningMessage(
                'Auto-reconnect requires the Windows OpenSSH client. Connecting with the standard terminal instead.'
            );
            openStandardSshTerminal(host, password);
            return;
        }

        // Keepalive probes so a dropped network is detected within ~10s instead of
        // hanging on a dead socket — required for the reconnect prompt to trigger.
        const sshArgs = [
            '-tt',
            '-o', 'ServerAliveInterval=5',
            '-o', 'ServerAliveCountMax=2',
            '-o', 'ConnectTimeout=10',
            '-p', String(host.port),
        ];
        if (host.identityFile) sshArgs.push('-i', host.identityFile);
        sshArgs.push(`${host.user}@${host.host}`);

        const askpass = password ? createAskpassEnvironment(password) : null;
        let pty;
        try {
            pty = sshPty.createReconnectingSshPty(host, sshArgs, askpass ? askpass.env : {});
        } catch (err) {
            if (askpass) askpass.cleanup();
            throw err;
        }
        const terminal = vscode.window.createTerminal({ name: `SSH: ${host.name} (auto-reconnect)`, pty });
        registerAskpassCleanup(terminal, askpass);
        terminal.show();
    },
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

            // Optional: Configure PHPUnit remote runner
            const enablePhpunit = await vscode.window.showInformationMessage(
                `Host "${name.trim()}" added. Configure PHPUnit remote runner for this host?`,
                'Configure PHPUnit', 'Skip'
            );
            if (enablePhpunit === 'Configure PHPUnit') {
                const remotePath = await vscode.window.showInputBox({
                    title: 'PHPUnit Config (1/2)',
                    prompt: 'Remote project root path',
                    placeHolder: 'e.g. /var/www/myapp',
                    validateInput: v => (!v || !v.trim()) ? 'Remote path is required' : null
                });
                if (remotePath && remotePath.trim()) {
                    const bin = await vscode.window.showInputBox({
                        title: 'PHPUnit Config (2/2)',
                        prompt: 'PHPUnit binary path (relative to project root)',
                        value: './vendor/bin/phpunit',
                        placeHolder: 'e.g. ./vendor/bin/phpunit',
                        validateInput: v => (!v || !v.trim()) ? 'Binary path is required' : null
                    });
                    if (bin && bin.trim()) {
                        hostEntry.phpunit = {
                            enabled: true,
                            remotePath: remotePath.trim(),
                            bin: bin.trim()
                        };
                    }
                }
            }

            // Save to config
            const config = this._readConfig();
            config.hosts = config.hosts || [];
            config.hosts.push(hostEntry);
            this._writeConfig(config);

            // Prompt for password (optional)
            const savePass = await vscode.window.showInformationMessage(
                `Save a password for "${name.trim()}"?`,
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
     * Edit PHPUnit runner config for an existing host.
     */
    editPhpunitConfig: async function (hostItem) {
        try {
            if (!hostItem || (hostItem.contextValue !== 'host' && hostItem.contextValue !== 'phpunitHost')) return;
            const label = typeof hostItem.label === 'string' ? hostItem.label : String(hostItem.label);
            const hostName = label.replace(/\s*\(.*\)$/, '');
            const config = this._readConfig();
            const hostEntry = (config.hosts || []).find(h => h.name === hostName);
            if (!hostEntry) return;

            const current = hostEntry.phpunit || {};
            const enabled = await vscode.window.showQuickPick(['Yes', 'No'], {
                title: `PHPUnit for "${hostName}" — enabled?`,
                placeHolder: current.enabled ? 'Yes' : 'No'
            });
            if (!enabled) return;

            const remotePath = await vscode.window.showInputBox({
                title: 'PHPUnit Config (1/2)',
                prompt: 'Remote project root path',
                value: current.remotePath || '',
                placeHolder: 'e.g. /var/www/myapp',
                validateInput: v => (!v || !v.trim()) ? 'Remote path is required' : null
            });
            if (!remotePath) return;

            const bin = await vscode.window.showInputBox({
                title: 'PHPUnit Config (2/2)',
                prompt: 'PHPUnit binary path (relative to project root)',
                value: current.bin || './vendor/bin/phpunit',
                validateInput: v => (!v || !v.trim()) ? 'Binary path is required' : null
            });
            if (!bin) return;

            hostEntry.phpunit = {
                enabled: enabled === 'Yes',
                remotePath: remotePath.trim(),
                bin: bin.trim()
            };
            this._writeConfig(config);
            vscode.window.showInformationMessage(`PHPUnit config saved for "${hostName}".`);
        } catch (err) {
            vscode.window.showErrorMessage('Failed to save PHPUnit config: ' + err.message);
        }
    },

    /**
     * Return all hosts that have phpunit.enabled === true.
     * @returns {object[]}
     */
    getPhpunitEnabledHosts: function () {
        const config = this._readConfig();
        return (config.hosts || []).filter(h => h.phpunit && h.phpunit.enabled === true);
    },

    /**
     * Return all hosts with a usable SFTP config (a "sftp" object with remotePath set).
     * @returns {object[]}
     */
    getSftpEnabledHosts: function () {
        const config = this._readConfig();
        return (config.hosts || []).filter(h => h.sftp && h.sftp.remotePath);
    },

    /**
     * Get the persisted SFTP sync target host name, or null if not set.
     * @returns {string|null}
     */
    getSftpTarget: function () {
        const config = this._readConfig();
        return config.sftpTarget || null;
    },

    /**
     * Persist the SFTP sync target host name. Pass null to clear it.
     * @param {string|null} hostName
     */
    setSftpTarget: function (hostName) {
        const config = this._readConfig();
        if (hostName) {
            config.sftpTarget = hostName;
        } else {
            delete config.sftpTarget;
        }
        this._writeConfig(config);
    },

    /**
     * Get the persisted default PHPUnit host name, or null if not set.
     * @returns {string|null}
     */
    getPhpunitDefault: function () {
        const config = this._readConfig();
        return config.phpunitDefault || null;
    },

    /**
     * Persist the default PHPUnit host name.
     * Pass null to clear the default.
     * @param {string|null} hostName
     */
    setPhpunitDefault: function (hostName) {
        const config = this._readConfig();
        if (hostName) {
            config.phpunitDefault = hostName;
        } else {
            delete config.phpunitDefault;
        }
        this._writeConfig(config);
    },

    /**
     * Remove a host and delete its stored password.
     */
    removeHost: async function (hostItem) {
        try {
            if (!hostItem || (hostItem.contextValue !== 'host' && hostItem.contextValue !== 'phpunitHost')) return;
            const label = hostItem.label;
            const hostName = typeof label === 'string' ? label.replace(/\s*\(.*\)$/, '') : String(label);

            const confirm = await vscode.window.showWarningMessage(
                `Delete host "${hostName}"?`, { modal: true }, 'Delete'
            );
            if (confirm !== 'Delete') return;

            const config = this._readConfig();
            const removedHost = (config.hosts || []).find(h => h.name === hostName);
            config.hosts = (config.hosts || []).filter(h => h.name !== hostName);
            this._writeConfig(config);

            if (_credentialManager) {
                await _credentialManager.deletePasswordByName(hostName);
                if (removedHost) await _credentialManager.deleteSftpHostFingerprint(removedHost);
            }
            vscode.window.showInformationMessage(`Host "${hostName}" removed.`);
        } catch (err) {
            vscode.window.showErrorMessage('Failed to remove host: ' + err.message);
        }
    }
};

module.exports = ConfigManager;
