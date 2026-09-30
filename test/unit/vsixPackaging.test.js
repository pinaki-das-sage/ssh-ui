// Purpose: Guards VSIX packaging exclusions while retaining node-pty runtime artifacts.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const fs = require('fs');
const path = require('path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ignoreFile = path.join(__dirname, '..', '..', '.vscodeignore');
const ignorePatterns = new Set(
    fs.readFileSync(ignoreFile, 'utf8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
);

test('excludes node-pty build inputs and debug symbols from the VSIX', () => {
    const expectedPatterns = [
        'node_modules/node-pty/binding.gyp',
        'node_modules/node-pty/deps/**',
        'node_modules/node-pty/scripts/**',
        'node_modules/node-pty/src/**',
        'node_modules/node-pty/third_party/**',
        'node_modules/node-pty/typings/**',
        'node_modules/node-pty/**/*.pdb',
    ];

    for (const pattern of expectedPatterns) {
        assert.ok(ignorePatterns.has(pattern), `expected VSIX exclusion: ${pattern}`);
    }
});

test('keeps node-pty prebuilt runtime artifacts available to the extension', () => {
    const runtimeArtifacts = [
        'node_modules/node-pty/lib/index.js',
        'node_modules/node-pty/prebuilds/darwin-arm64/pty.node',
        'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper',
        'node_modules/node-pty/prebuilds/win32-x64/conpty.node',
        'node_modules/node-pty/prebuilds/win32-x64/winpty-agent.exe',
        'node_modules/node-pty/prebuilds/win32-x64/winpty.dll',
    ];

    for (const artifact of runtimeArtifacts) {
        assert.equal(fs.existsSync(path.join(__dirname, '..', '..', artifact)), true, `missing runtime artifact: ${artifact}`);
    }
});
