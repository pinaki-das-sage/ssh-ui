// Purpose: Runs PHPUnit on SSH hosts and streams output to a VS Code Output Channel.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved
//
// Pure functions (buildRemoteCommand, buildSshArgs) are exported for unit
// testing and do not require the VS Code API.

'use strict';

const { spawn } = require('child_process');
const { createAskpassEnvironment } = require('./sshAuth');

// ── Concurrent run guard ──────────────────────────────────────────────────────
// Keyed by host.name — prevents spawning two SSH processes for the same host.
const _activeRuns = new Set();

// ── Output channel (lazy, singleton) ─────────────────────────────────────────
let _outputChannel = null;
function _getOutputChannel() {
    const vscode = require('vscode');
    if (!_outputChannel) {
        _outputChannel = vscode.window.createOutputChannel('Remote Toolkit \u2014 PHPUnit');
    }
    return _outputChannel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (testable without VS Code)
// ─────────────────────────────────────────────────────────────────────────────

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the remote shell command to pass to SSH.
 *
 * @param {string} remotePath   Absolute path on the remote server (phpunit.remotePath)
 * @param {string} bin          PHPUnit binary (phpunit.bin), e.g. './vendor/bin/phpunit'
 * @param {string|null} relativeFile  Workspace-relative file path, or null for run-all
 * @param {string|null} className     PHP class name, or null
 * @param {string|null} methodName    PHP method name, or null
 * @returns {string}
 */
function buildRemoteCommand(remotePath, bin, relativeFile, className, methodName) {
    let cmd = `cd ${shellQuote(remotePath)} && ${shellQuote(bin)}`;
    if (className && methodName) {
        cmd += ` --filter ${shellQuote(`^${className}::${methodName}$`)}`;
    }
    if (relativeFile) {
        cmd += ` ${shellQuote(relativeFile)}`;
    }
    return cmd;
}

function buildTerminalCommand(host, remoteCommand) {
    const parts = ['ssh', '-p', String(host.port)];
    if (host.identityFile) {
        parts.push('-i', shellQuote(host.identityFile));
    }
    parts.push(`${host.user}@${host.host}`);
    parts.push(shellQuote(remoteCommand));
    return parts.join(' ');
}

/**
 * Build SSH argument array and environment object for child_process.spawn.
 *
 * Auth priority:
 *   1. identityFile (key-based) — appends -i flag, no SSH_ASKPASS
 *   2. password (stored credential) — writes askpass script, injects env vars
 *   3. neither — returns bare args; caller should fall back to terminal
 *
 * @param {object} host          Host config object (user, host, port, identityFile?)
 * @param {string|null} password Stored password, or null
 * @param {string} remoteCommand The remote shell command string
 * @returns {{ args: string[], env: object, cleanup: () => void }}
 */
function buildSshArgs(host, password, remoteCommand) {
    const args = [
        // BatchMode=yes disables all password prompts, including SSH_ASKPASS.
        // Saved credentials use the forced private askpass helper, so allow that
        // one non-interactive path while keeping key-only runs batch-safe.
        '-o', password ? 'BatchMode=no' : 'BatchMode=yes',
        '-p', String(host.port),
    ];
    let askpass = null;

    if (host.identityFile) {
        args.push('-i', host.identityFile);
    }
    if (password) {
        askpass = createAskpassEnvironment(password);
    }

    args.push(`${host.user}@${host.host}`, remoteCommand);

    return { args, env: askpass ? askpass.env : {}, cleanup: askpass ? askpass.cleanup : () => {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// Host resolution (pure, testable without VS Code)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve which phpunit-enabled host to use, without any VS Code UI interaction.
 *
 * Priority order:
 *   1. treeItemName  — explicit host from tree context menu click
 *   2. defaultHostName — persisted user preference
 *   3. only one host available — use it automatically
 *   4. null — caller must prompt the user
 *
 * @param {object[]} enabledHosts   All hosts with phpunit.enabled === true
 * @param {string|null} defaultHostName  Persisted default (from config phpunitDefault)
 * @param {string|null} treeItemName     Host name from tree item label, if invoked from tree
 * @returns {object|null}  Resolved host config, or null if user prompt needed
 */
function pickHost(enabledHosts, defaultHostName, treeItemName) {
    if (enabledHosts.length === 0) return null;

    if (treeItemName) {
        const found = enabledHosts.find(h => h.name === treeItemName);
        if (found) return found;
    }

    if (defaultHostName) {
        const found = enabledHosts.find(h => h.name === defaultHostName);
        if (found) return found;
        // Default is stale (host removed or phpunit disabled) — fall through to prompt
    }

    if (enabledHosts.length === 1) return enabledHosts[0];

    return null; // Multiple hosts, no default set — caller must prompt
}

/**
 * Resolve the PHPUnit host. The currently selected SFTP target is the normal
 * default, while the retired phpunitDefault setting remains a compatibility
 * fallback for configurations that have no eligible SFTP target selected.
 */
function resolvePhpunitHost(enabledHosts, sftpTargetName, legacyDefaultHostName, treeItemName) {
    if (enabledHosts.length === 0) return null;

    if (treeItemName) {
        const explicitHost = enabledHosts.find(h => h.name === treeItemName);
        if (explicitHost) return explicitHost;
    }

    if (sftpTargetName) {
        const sftpTarget = enabledHosts.find(h => h.name === sftpTargetName);
        if (sftpTarget) return sftpTarget;
    }

    return pickHost(enabledHosts, legacyDefaultHostName, null);
}

// ─────────────────────────────────────────────────────────────────────────────
// VS Code dependent runner (requires extension host)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Core runner — spawns SSH, streams output to Output Channel.
 *
 * @param {object} host
 * @param {string|null} password
 * @param {string} remoteCommand
 * @param {string} label  Human-readable scope label (e.g. "All tests", "FooTest::testBar")
 */
async function _run(host, password, remoteCommand, label) {
    const vscode = require('vscode');

    if (_activeRuns.has(host.name)) {
        vscode.window.showWarningMessage(`PHPUnit is already running for host "${host.name}".`);
        return;
    }

    // Terminal fallback: no password AND no identityFile
    if (!password && !host.identityFile) {
        const terminal = vscode.window.createTerminal({ name: `PHPUnit: ${host.name}` });
        terminal.sendText(buildTerminalCommand(host, remoteCommand));
        terminal.show();
        return;
    }

    const { args, env, cleanup } = buildSshArgs(host, password, remoteCommand);
    const channel = _getOutputChannel();
    channel.show(true);

    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    channel.appendLine(`\n${'─'.repeat(60)}`);
    channel.appendLine(`[${now}]  Host: ${host.name}  |  Scope: ${label}`);
    channel.appendLine('─'.repeat(60));

    _activeRuns.add(host.name);

    try {
        await new Promise((resolve) => {
            let completed = false;
            const finish = () => {
                if (completed) return;
                completed = true;
                _activeRuns.delete(host.name);
                cleanup();
                resolve();
            };
            const proc = spawn('ssh', args, {
                env: { ...process.env, ...env },
            });

            proc.stdout.on('data', (data) => channel.append(data.toString()));
            proc.stderr.on('data', (data) => channel.append(data.toString()));

            proc.on('close', (code) => {
                channel.appendLine('─'.repeat(60));
                channel.appendLine(`Exit code: ${code}  |  ${code === 0 ? '\u2705 PASSED' : '\u274c FAILED'}`);
                channel.appendLine('─'.repeat(60));
                finish();
            });

            proc.on('error', (err) => {
                channel.appendLine(`\u274c Error spawning SSH: ${err.message}`);
                finish();
            });
        });
    } catch (err) {
        _activeRuns.delete(host.name);
        cleanup();
        throw err;
    }
}

/**
 * Run all PHPUnit tests for a host.
 * @param {object} host     Full host config including phpunit sub-object
 * @param {string|null} password
 */
async function runAll(host, password) {
    const phpunit = host.phpunit || {};
    const remoteCommand = buildRemoteCommand(phpunit.remotePath, phpunit.bin, null, null, null);
    await _run(host, password, remoteCommand, 'All tests');
}

/**
 * Run PHPUnit for a single file.
 * @param {object} host
 * @param {string|null} password
 * @param {string} remoteFile  Workspace-relative file path
 */
async function runFile(host, password, remoteFile) {
    const phpunit = host.phpunit || {};
    const remoteCommand = buildRemoteCommand(phpunit.remotePath, phpunit.bin, remoteFile, null, null);
    await _run(host, password, remoteCommand, remoteFile);
}

/**
 * Run all PHPUnit tests discovered under a workspace-relative folder.
 *
 * @param {object} host
 * @param {string|null} password
 * @param {string} remoteFolder  Workspace-relative folder path
 */
async function runFolder(host, password, remoteFolder) {
    const phpunit = host.phpunit || {};
    const remoteCommand = buildRemoteCommand(phpunit.remotePath, phpunit.bin, remoteFolder, null, null);
    await _run(host, password, remoteCommand, `Folder: ${remoteFolder}`);
}

/**
 * Run a single PHPUnit test method.
 * @param {object} host
 * @param {string|null} password
 * @param {string} remoteFile
 * @param {string} className
 * @param {string} methodName
 */
async function runMethod(host, password, remoteFile, className, methodName) {
    const phpunit = host.phpunit || {};
    const remoteCommand = buildRemoteCommand(phpunit.remotePath, phpunit.bin, remoteFile, className, methodName);
    await _run(host, password, remoteCommand, `${className}::${methodName}`);
}

module.exports = {
    buildRemoteCommand, buildSshArgs, buildTerminalCommand, pickHost, resolvePhpunitHost, runAll, runFile, runFolder, runMethod
};
