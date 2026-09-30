// Purpose: Implements opt-in reconnecting SSH terminals through node-pty.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const fs = require('fs');
const path = require('path');

let _pty = null;
let _ptyLoadError = null;
function _loadPty() {
    if (_pty || _ptyLoadError) return _pty;
    try {
        _pty = require('node-pty');
    } catch (err) {
        _ptyLoadError = err;
    }
    return _pty;
}

/** Whether node-pty loaded successfully on this platform. */
function isAvailable() {
    _loadPty();
    return !!_pty;
}

function lastLoadError() {
    return _ptyLoadError;
}

/** True only for a real, positive, finite terminal dimension value. */
function isValidSize(dims) {
    return !!dims && Number.isFinite(dims.cols) && Number.isFinite(dims.rows)
        && dims.cols > 0 && dims.rows > 0;
}

/** Reconnect is enabled only by the concise boolean configuration. */
function isReconnectEnabled(reconnect) {
    return reconnect === true;
}

/**
 * Resolve OpenSSH directly on Windows instead of relying on node-pty's PATH
 * lookup, which can fail even when the Windows OpenSSH client is installed.
 */
function getWindowsOpenSshPath(platform = process.platform, env = process.env, fileExists = fs.existsSync) {
    if (platform !== 'win32') return null;
    const windowsRoot = env.SystemRoot || env.WINDIR;
    const systemSsh = windowsRoot && path.win32.join(windowsRoot, 'System32', 'OpenSSH', 'ssh.exe');
    return systemSsh && fileExists(systemSsh) ? systemSsh : null;
}

function hasWindowsOpenSsh(platform = process.platform, env = process.env, fileExists = fs.existsSync) {
    return platform !== 'win32' || !!getWindowsOpenSshPath(platform, env, fileExists);
}

function resolveSshExecutable(platform = process.platform, env = process.env, fileExists = fs.existsSync) {
    if (platform !== 'win32') return 'ssh';
    return getWindowsOpenSshPath(platform, env, fileExists) || 'ssh.exe';
}

/**
 * Build a VS Code Pseudoterminal that spawns `ssh` via node-pty and
 * automatically offers to reconnect (on any keypress) after the SSH
 * process exits, mirroring PuTTY's reconnect-on-keypress behavior.
 *
 * @param {object} host    Host config (user, host, port, identityFile?)
 * @param {string[]} sshArgs  Arguments to pass to the `ssh` binary
 * @param {object} env     Extra environment variables (e.g. SSH_ASKPASS vars)
 * @returns {vscode.Pseudoterminal}
 */
function createReconnectingSshPty(host, sshArgs, env) {
    const nodePty = _loadPty();
    if (!nodePty) {
        throw _ptyLoadError || new Error('node-pty is not available on this platform.');
    }
    const vscode = require('vscode');

    const writeEmitter = new vscode.EventEmitter();
    const closeEmitter = new vscode.EventEmitter();
    let ptyProcess = null;
    let dimensions = { cols: 80, rows: 24 };
    let awaitingReconnectKey = false;
    let disposed = false;
    let spawnFallbackTimer = null;

    function spawnSsh() {
        awaitingReconnectKey = false;
        const sshExecutable = resolveSshExecutable();
        try {
            ptyProcess = nodePty.spawn(sshExecutable, sshArgs, {
                name: 'xterm-256color',
                cols: dimensions.cols,
                rows: dimensions.rows,
                cwd: process.env.HOME || process.cwd(),
                env: { ...process.env, ...env },
            });
        } catch (err) {
            ptyProcess = null;
            awaitingReconnectKey = true;
            writeEmitter.fire(
                `\r\n\x1b[31mFailed to start SSH (${sshExecutable}): ${err.message}\x1b[0m\r\n` +
                `Make sure OpenSSH is installed and available to VS Code.\r\n` +
                `Press any key to retry.\r\n`
            );
            return;
        }

        ptyProcess.onData(data => writeEmitter.fire(data));

        ptyProcess.onExit(({ exitCode }) => {
            if (disposed) return;
            ptyProcess = null;
            awaitingReconnectKey = true;
            writeEmitter.fire(
                `\r\n\x1b[33mConnection to ${host.name} closed (exit code ${exitCode}).\x1b[0m\r\n` +
                `Press any key to reconnect, or close the terminal to exit.\r\n`
            );
        });
    }

    // Spawning before the real terminal size is known makes the remote shell wrap
    // long lines at the 80-column default, so defer briefly when dimensions are unknown.
    function ensureSpawned() {
        if (ptyProcess || disposed) return;
        if (spawnFallbackTimer) {
            clearTimeout(spawnFallbackTimer);
            spawnFallbackTimer = null;
        }
        spawnSsh();
    }

    return {
        onDidWrite: writeEmitter.event,
        onDidClose: closeEmitter.event,
        open(initialDimensions) {
            if (isValidSize(initialDimensions)) {
                dimensions = initialDimensions;
                ensureSpawned();
                return;
            }
            spawnFallbackTimer = setTimeout(() => {
                spawnFallbackTimer = null;
                ensureSpawned();
            }, 250);
        },
        close() {
            disposed = true;
            if (spawnFallbackTimer) {
                clearTimeout(spawnFallbackTimer);
                spawnFallbackTimer = null;
            }
            if (ptyProcess) ptyProcess.kill();
        },
        handleInput(data) {
            if (awaitingReconnectKey) {
                writeEmitter.fire(`\r\n\x1b[36mReconnecting to ${host.name}...\x1b[0m\r\n`);
                spawnSsh();
                return;
            }
            if (!ptyProcess) return;
            try {
                ptyProcess.write(data);
            } catch (err) {
                writeEmitter.fire(`\r\n\x1b[31mFailed to send input: ${err.message}\x1b[0m\r\n`);
            }
        },
        setDimensions(newDimensions) {
            // VS Code can report 0x0 or undefined during initial terminal panel layout — ignore those.
            if (!isValidSize(newDimensions)) return;
            dimensions = newDimensions;
            if (!ptyProcess) {
                ensureSpawned();
                return;
            }
            try {
                ptyProcess.resize(newDimensions.cols, newDimensions.rows);
            } catch (err) {
                writeEmitter.fire(`\r\n\x1b[31mFailed to resize terminal: ${err.message}\x1b[0m\r\n`);
            }
        },
    };
}

module.exports = {
    isAvailable, lastLoadError, isValidSize, isReconnectEnabled,
    hasWindowsOpenSsh, resolveSshExecutable, createReconnectingSshPty
};
