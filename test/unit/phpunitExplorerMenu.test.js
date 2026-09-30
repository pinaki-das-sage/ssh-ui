// Purpose: Verifies the Explorer context-menu entries for PHPUnit file and folder runs.
// @author    Pinaki Das <pinaki.das@sage.com>
// @copyright 2026 Sage Intacct Corporation, All Rights Reserved

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const packageJson = require('../../package.json');

test('registers a single-file Explorer action using the existing PHPUnit file command', () => {
    const explorerMenu = packageJson.contributes.menus['explorer/context'];
    const fileAction = explorerMenu.find(entry => entry.command === 'ssh-ui.runPhpunitFile');

    assert.ok(fileAction, 'the Explorer menu should provide a PHPUnit file action');
    assert.equal(fileAction.when, 'resourceScheme == file && !explorerResourceIsFolder');
});
