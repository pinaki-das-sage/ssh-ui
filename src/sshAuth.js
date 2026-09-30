// Purpose: Provides secure SSH askpass helpers and shell-safe interactive SSH command construction.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Create a private, per-connection askpass helper. The script itself contains
 * no credential; SSH receives the password only through its child environment.
 *
 * @param {string} password
 * @returns {{env: object, cleanup: () => void}}
 */
function createAskpassEnvironment(password) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ssh-ui-askpass-'));
    const isWindows = process.platform === 'win32';
    const scriptPath = path.join(directory, isWindows ? 'askpass.cmd' : 'askpass.sh');

    try {
        fs.chmodSync(directory, 0o700);
        fs.writeFileSync(
            scriptPath,
            isWindows ? '@echo off\r\necho %_SSH_UI_PASS%\r\n' : '#!/bin/sh\necho "$_SSH_UI_PASS"\n',
            { encoding: 'utf8', mode: 0o700, flag: 'wx' }
        );
    } catch (err) {
        fs.rmSync(directory, { recursive: true, force: true });
        throw err;
    }

    let cleaned = false;
    return {
        env: {
            _SSH_UI_PASS: password,
            SSH_ASKPASS: scriptPath,
            SSH_ASKPASS_REQUIRE: 'force',
            DISPLAY: process.env.DISPLAY || ':0',
        },
        cleanup: () => {
            if (cleaned) return;
            cleaned = true;
            fs.rmSync(directory, { recursive: true, force: true });
        },
    };
}

/** Build a shell-safe SSH command for VS Code's integrated terminal. */
function buildInteractiveSshCommand(host) {
    const parts = ['ssh', '-t', '-p', shellQuote(host.port)];
    if (host.identityFile) parts.push('-i', shellQuote(host.identityFile));
    parts.push(shellQuote(`${host.user}@${host.host}`));
    return parts.join(' ');
}

module.exports = { createAskpassEnvironment, buildInteractiveSshCommand };
